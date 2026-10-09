import archiver from 'archiver';
import { createHash, sign as signBytes, verify as verifyBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { loadAppManifests } from './deployment-plan.mjs';
import { loadMergedServiceRegistry } from './service-catalog.mjs';
import { shouldOmitAppSourceEntry } from './app-source-filter.mjs';

const MAX_ENTRIES = 10_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const FIXED_ARCHIVE_DATE = new Date('1980-01-01T00:00:00.000Z');
const SIGNATURE_CONTEXT = Buffer.from('stratexec-app-signature-v1\0', 'utf8');
const DEPLOYMENT_TARGETS = new Set([
  'firebase-hosting', 'firebase-functions-v2', 'cloud-run-service',
  'cloud-run-job', 'cloud-run-worker-pool', 'vm-docker',
]);
const FORBIDDEN_DEPLOYMENT_KEYS = new Set(['command', 'commands', 'script', 'scripts', 'shell', 'args', 'entrypoint', 'hooks']);
const CONFIGURATION_INPUT_TYPES = new Set(['string', 'integer', 'boolean', 'select']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const slash = (value) => value.split(sep).join('/');

function sameValues(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function canonicalRecord(value) {
  if (Array.isArray(value)) return value.map(canonicalRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, canonicalRecord(child)]));
}

function sameRecords(left, right) {
  const normalize = (values) => [...values]
    .map(canonicalRecord)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !sameValues(Object.keys(value), keys)) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function rejectDeploymentCommands(value, path = 'deployment') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectDeploymentCommands(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DEPLOYMENT_KEYS.has(key.toLowerCase())) {
      throw new Error(`Deployment contract cannot declare executable field ${path}.${key}.`);
    }
    rejectDeploymentCommands(child, `${path}.${key}`);
  }
}

export function validateDeploymentContract({ deployment, app, services, platform, deploymentDocument }) {
  rejectDeploymentCommands(deployment);
  assertExactKeys(deployment, ['schemaVersion', 'appKey', 'appVersion', 'services', 'dataMigrations', 'sourceRollback'], 'App deployment contract');
  if (deployment.schemaVersion !== platform.appDeploymentSchemaVersion
    || deployment.appKey !== app.appKey || deployment.appVersion !== app.version
    || !Array.isArray(deployment.services) || !Array.isArray(deployment.dataMigrations)
    || deployment.dataMigrations.length !== 0) {
    throw new Error('App deployment contract identity, schema, or migration policy is invalid.');
  }
  assertExactKeys(deployment.sourceRollback, ['strategy'], 'App source rollback policy');
  if (deployment.sourceRollback.strategy !== 'transaction-backup') {
    throw new Error('App deployment contract requires transaction-backup source rollback.');
  }
  const serviceCatalog = new Map(services.map((service) => [service.key, service]));
  if (!sameValues(deployment.services.map((service) => service.serviceKey), serviceCatalog.keys())) {
    throw new Error('App deployment services differ from its owned Service fragment.');
  }
  const seen = new Set();
  for (const declared of deployment.services) {
    assertExactKeys(declared, [
      'serviceKey', 'allowedTargets', 'routes', 'healthPath', 'readinessPath', 'configuration', 'secrets', 'migration', 'rollback',
    ], `Deployment service ${declared.serviceKey ?? 'unknown'}`);
    const service = serviceCatalog.get(declared.serviceKey);
    if (!service || seen.has(declared.serviceKey)) throw new Error('App deployment contract has an unknown or duplicate service.');
    seen.add(declared.serviceKey);
    if (!Array.isArray(declared.allowedTargets) || declared.allowedTargets.length === 0
      || declared.allowedTargets.some((target) => !DEPLOYMENT_TARGETS.has(target))
      || !sameValues(declared.allowedTargets, service.deployment?.allowedTargets ?? [])
      || !sameValues(declared.routes ?? [], service.routes ?? [])
      || declared.healthPath !== service.deployment?.listen?.healthPath
      || declared.readinessPath !== service.deployment?.listen?.readinessPath) {
      throw new Error(`Deployment topology differs from Service fragment: ${service.key}`);
    }
    const runtimeBindings = service.deployment?.workloadClass === 'continuous-worker'
      ? service.deployment?.vmDocker : service.deployment?.cloudRun;
    const expectedConfiguration = runtimeBindings?.environment ?? [];
    if (!Array.isArray(declared.configuration)
      || declared.configuration.some((item) => !item.purpose || typeof item.purpose !== 'string')
      || declared.configuration.some((item) => (
        item.source === 'operator-input'
          ? !item.input || !item.input.label || !CONFIGURATION_INPUT_TYPES.has(item.input.type)
            || typeof item.input.required !== 'boolean' || !['normal', 'high'].includes(item.input.impact)
          : item.input !== undefined
      ))
      || !sameRecords(
        declared.configuration.map(({ name, source, serviceKey, input }) => (
          serviceKey === undefined
            ? input === undefined ? { name, source } : { name, source, input }
            : input === undefined ? { name, source, serviceKey } : { name, source, serviceKey, input }
        )),
        expectedConfiguration,
      )) {
      throw new Error(`Deployment configuration differs from Service fragment: ${service.key}`);
    }
    const expectedSecrets = (runtimeBindings?.secrets ?? [])
      .map(({ environment, secretName, temporary }) => ({ environment, secretName, temporary }));
    if (!Array.isArray(declared.secrets)
      || declared.secrets.some((secret) => !secret.purpose || typeof secret.purpose !== 'string')
      || !sameRecords(
        declared.secrets.map(({ environment, secretName, temporary }) => ({ environment, secretName, temporary })),
        expectedSecrets,
      )) {
      throw new Error(`Deployment secrets differ from Service fragment: ${service.key}`);
    }
    assertExactKeys(
      declared.migration,
      ['strategy', 'reversible', 'backupRequired', 'maintenanceWindow'],
      `Deployment migration ${service.key}`,
    );
    assertExactKeys(declared.rollback, ['strategy', 'data'], `Deployment rollback ${service.key}`);
    if (!['none', 'platform-driver'].includes(declared.migration.strategy)
      || typeof declared.migration.reversible !== 'boolean'
      || typeof declared.migration.backupRequired !== 'boolean'
      || !['not-required', 'recommended', 'required'].includes(declared.migration.maintenanceWindow)
      || (declared.migration.strategy === 'none'
        && (!declared.migration.reversible || declared.migration.backupRequired
          || declared.migration.maintenanceWindow !== 'not-required'))
      || !['none', 'target-revision', 'platform-driver'].includes(declared.rollback.strategy)
      || !['not-required', 'manual', 'unsupported'].includes(declared.rollback.data)) {
      throw new Error(`Deployment migration or rollback policy is invalid: ${service.key}`);
    }
  }
  if (typeof deploymentDocument !== 'string' || !deploymentDocument.includes(`\`${app.deploymentManifest}\``)
    || services.some((service) => !deploymentDocument.includes(`\`${service.key}\``))) {
    throw new Error('DEPLOYMENT.md does not reference the machine deployment contract and owned services.');
  }
}

function signatureDigest(packageJson, checksumsJson) {
  return createHash('sha256').update(SIGNATURE_CONTEXT).update(packageJson).update(checksumsJson).digest();
}

function validateTrustStore(store) {
  if (store?.schemaVersion !== 1 || !Array.isArray(store.publishers)) {
    throw new Error('Invalid App publisher trust store.');
  }
  const publishers = new Set();
  for (const publisher of store.publishers) {
    if (!/^[a-z][a-z0-9.-]*$/.test(publisher.publisherId ?? '') || !publisher.displayName
      || !['active', 'disabled'].includes(publisher.status)
      || !Array.isArray(publisher.keys) || publishers.has(publisher.publisherId)) {
      throw new Error('Invalid or duplicate App publisher trust policy.');
    }
    publishers.add(publisher.publisherId);
    const keys = new Set();
    for (const key of publisher.keys) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key.keyId ?? '') || keys.has(key.keyId)
        || key.algorithm !== 'ed25519' || !['trusted', 'disabled', 'revoked'].includes(key.status)
        || typeof key.publicKeyPem !== 'string' || !key.publicKeyPem) {
        throw new Error(`Invalid App publisher key policy: ${publisher.publisherId}`);
      }
      for (const field of ['notBefore', 'notAfter']) {
        if (key[field] !== undefined && Number.isNaN(new Date(key[field]).getTime())) {
          throw new Error(`Invalid App publisher key trust window: ${publisher.publisherId}/${key.keyId}`);
        }
      }
      if (key.notBefore && key.notAfter && new Date(key.notBefore) >= new Date(key.notAfter)) {
        throw new Error(`Invalid App publisher key trust window: ${publisher.publisherId}/${key.keyId}`);
      }
      keys.add(key.keyId);
    }
  }
  return store;
}

async function evaluateSignature({ packageManifest, packageJson, checksumsJson, entries, root, trustStore, now }) {
  const signatureFile = packageManifest.integrity?.signatureFile;
  if (signatureFile === null && packageManifest.publisher === null) {
    if (entries.has('signature.json')) throw new Error('Unsigned package contains an unexpected signature file.');
    return { signatureStatus: 'development-unsigned', publisherId: null, keyId: null, signatureFormatVersion: null, signedContentDigest: null };
  }
  if (signatureFile !== 'signature.json' || !packageManifest.publisher || !entries.has('signature.json')) {
    throw new Error('Signed package publisher and signature metadata are incomplete.');
  }
  const signature = JSON.parse(entries.get('signature.json').toString('utf8'));
  assertExactKeys(signature, ['formatVersion', 'algorithm', 'publisherId', 'keyId', 'signedContentDigest', 'signature'], 'App package signature');
  const digest = signatureDigest(packageJson, checksumsJson);
  if (signature.formatVersion !== 1 || signature.algorithm !== 'ed25519'
    || signature.publisherId !== packageManifest.publisher.publisherId
    || signature.keyId !== packageManifest.publisher.keyId
    || signature.signedContentDigest !== digest.toString('hex')
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature.signature ?? '')) {
    throw new Error('App package signature metadata is invalid.');
  }
  const resolvedTrustStore = validateTrustStore(trustStore ?? JSON.parse(
    await readFile(new URL('infrastructure/app-publisher-trust.json', root), 'utf8'),
  ));
  const publisher = resolvedTrustStore.publishers.find((item) => item.publisherId === signature.publisherId);
  const key = publisher?.keys.find((item) => item.keyId === signature.keyId);
  if (!key) throw new Error(`App package publisher key is not trusted: ${signature.publisherId}/${signature.keyId}`);
  if (publisher.status === 'disabled' || key.status === 'disabled') {
    throw new Error(`App package publisher key is disabled: ${signature.publisherId}/${signature.keyId}`);
  }
  if (key.status === 'revoked') {
    const error = new Error(`App package publisher key is revoked: ${signature.publisherId}/${signature.keyId}`);
    error.signatureStatus = 'revoked';
    throw error;
  }
  const currentTime = (now ?? new Date()).getTime();
  if ((key.notBefore && currentTime < new Date(key.notBefore).getTime())
    || (key.notAfter && currentTime > new Date(key.notAfter).getTime())) {
    throw new Error(`App package publisher key is outside its trust window: ${signature.publisherId}/${signature.keyId}`);
  }
  let valid = false;
  try {
    valid = verifyBytes(null, digest, key.publicKeyPem, Buffer.from(signature.signature, 'base64'));
  } catch {
    valid = false;
  }
  if (!valid) throw new Error('App package signature verification failed.');
  return {
    signatureStatus: 'trusted-signed', publisherId: signature.publisherId, keyId: signature.keyId,
    signatureFormatVersion: signature.formatVersion, signedContentDigest: signature.signedContentDigest,
    signature: signature.signature,
  };
}

function safeArchivePath(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`Unsafe App package path: ${name}`);
  }
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe App package path: ${name}`);
  }
  return name;
}

function parseVersion(value) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.exec(value ?? '');
  if (!match) throw new Error(`Invalid semantic version: ${value ?? 'missing'}`);
  return match.slice(1, 4).map(Number);
}

function versionAtLeast(current, minimum) {
  const left = parseVersion(current);
  const right = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

async function collectDirectory(rootPath, relativePath, files) {
  const absolute = resolve(rootPath, relativePath);
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (shouldOmitAppSourceEntry(entry.name, entry.isDirectory())) continue;
    const childRelative = slash(`${relativePath}/${entry.name}`);
    const childAbsolute = resolve(rootPath, childRelative);
    const stats = await lstat(childAbsolute);
    if (stats.isSymbolicLink()) throw new Error(`App package cannot contain symbolic links: ${childRelative}`);
    if (stats.isDirectory()) await collectDirectory(rootPath, childRelative, files);
    else if (stats.isFile()) files.add(childRelative);
  }
}

function insideRoot(rootPath, relativePath) {
  const absolute = resolve(rootPath, relativePath);
  const fromRoot = relative(rootPath, absolute);
  if (!fromRoot || fromRoot.startsWith('..') || fromRoot.includes(`..${sep}`)) {
    if (!fromRoot) return absolute;
    throw new Error(`Package source must remain inside the repository: ${relativePath}`);
  }
  return absolute;
}

async function appendZip(targetPath, entries) {
  await mkdir(dirname(targetPath), { recursive: true });
  await new Promise((resolvePromise, rejectPromise) => {
    const output = createWriteStream(targetPath, { flags: 'w' });
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolvePromise);
    output.on('error', rejectPromise);
    archive.on('warning', rejectPromise);
    archive.on('error', rejectPromise);
    archive.pipe(output);
    for (const [name, content] of entries) {
      archive.append(content, { name, date: FIXED_ARCHIVE_DATE, mode: 0o100644 });
    }
    archive.finalize().catch(rejectPromise);
  });
}

export async function packApp({
  appKey,
  outputDirectory = 'dist/app-packages',
  root = new URL('../../', import.meta.url),
  signing = null,
}) {
  if (!/^[a-z][a-z0-9-]*$/.test(appKey ?? '')) throw new Error('Provide a valid --app key.');
  if (signing && (!/^[a-z][a-z0-9.-]*$/.test(signing.publisherId ?? '')
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(signing.keyId ?? '')
    || typeof signing.privateKeyPem !== 'string' || !signing.privateKeyPem)) {
    throw new Error('Signing requires publisherId, keyId, and an Ed25519 private key.');
  }
  const rootPath = fileURLToPath(root);
  const platform = JSON.parse(await readFile(new URL('infrastructure/platform-contract.json', root), 'utf8'));
  const apps = await loadAppManifests(root);
  const app = apps.find((item) => item.appKey === appKey);
  if (!app || app.kind !== 'frontend-app' || app.package?.installable !== true || app.package.ownerApp !== appKey) {
    throw new Error(`Installable frontend App not found: ${appKey}`);
  }
  if (app.platformCompatibility?.appContractVersion !== platform.appContractVersion
    || !versionAtLeast(platform.platformVersion, app.platformCompatibility?.minimumVersion)) {
    throw new Error(`App ${appKey} is incompatible with platform ${platform.platformVersion}.`);
  }
  const registry = await loadMergedServiceRegistry(root);
  const serviceCatalog = new Map(registry.services.map((service) => [service.key, service]));
  const ownedServices = registry.services.filter((service) => service.ownerApp === appKey);
  const providedServiceKeys = ownedServices.map((service) => service.key);
  const providedServiceSet = new Set(providedServiceKeys);
  const serviceClosure = new Set();
  const visitService = (serviceKey) => {
    if (serviceClosure.has(serviceKey)) return;
    const service = serviceCatalog.get(serviceKey);
    if (!service) throw new Error(`App ${appKey} requires unknown service ${serviceKey}.`);
    serviceClosure.add(serviceKey);
    for (const dependency of service.dependsOn ?? []) visitService(dependency);
  };
  for (const serviceKey of app.requiredServices) visitService(serviceKey);
  const externalServiceDependencies = [...serviceClosure]
    .filter((serviceKey) => !providedServiceSet.has(serviceKey)).sort();
  const sourceFiles = new Set();
  await collectDirectory(rootPath, app.source, sourceFiles);
  const appManifestRelative = `infrastructure/apps/${appKey}.json`;
  sourceFiles.add(appManifestRelative);
  const deploymentManifestRelative = `infrastructure/app-deployments/${appKey}.json`;
  if (app.deploymentManifest !== deploymentManifestRelative) {
    throw new Error(`Installable App must use its canonical deployment manifest: ${appKey}`);
  }
  sourceFiles.add(deploymentManifestRelative);
  const serviceFragmentRelative = `infrastructure/app-services/${appKey}.json`;
  let hasServiceFragment = false;
  try {
    await lstat(insideRoot(rootPath, serviceFragmentRelative));
    sourceFiles.add(serviceFragmentRelative);
    hasServiceFragment = true;
  } catch (error) {
    if (ownedServices.length > 0) throw error;
  }
  for (const service of ownedServices) {
    await collectDirectory(rootPath, service.source, sourceFiles);
    sourceFiles.add(service.contract);
  }

  const deployment = JSON.parse(await readFile(insideRoot(rootPath, deploymentManifestRelative), 'utf8'));
  const deploymentDocument = await readFile(insideRoot(rootPath, app.deploymentDocument), 'utf8');
  validateDeploymentContract({ deployment, app, services: ownedServices, platform, deploymentDocument });

  if (sourceFiles.size > MAX_ENTRIES) throw new Error('App package contains too many files.');
  const payload = new Map();
  let totalBytes = 0;
  for (const relativePath of [...sourceFiles].sort()) {
    const content = await readFile(insideRoot(rootPath, relativePath));
    if (content.byteLength > MAX_FILE_BYTES) throw new Error(`App package file is too large: ${relativePath}`);
    totalBytes += content.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('App package payload exceeds 256 MiB.');
    payload.set(safeArchivePath(`payload/${slash(relativePath)}`), content);
  }
  const checksums = {
    algorithm: 'sha256',
    files: Object.fromEntries([...payload].map(([name, content]) => [name, sha256(content)])),
  };
  const packageManifest = {
    schemaVersion: platform.appPackageSchemaVersion,
    packageType: 'stratexec-app',
    appKey,
    version: app.version,
    displayName: app.displayName,
    platformCompatibility: app.platformCompatibility,
    requiredServices: app.requiredServices,
    providedServices: providedServiceKeys,
    externalServiceDependencies,
    appManifest: `payload/${appManifestRelative}`,
    deploymentManifest: `payload/${deploymentManifestRelative}`,
    serviceFragment: hasServiceFragment ? `payload/${serviceFragmentRelative}` : null,
    payloadRoot: 'payload',
    publisher: signing ? { publisherId: signing.publisherId, keyId: signing.keyId } : null,
    integrity: { algorithm: 'sha256', checksumsFile: 'checksums.json', signatureFile: signing ? 'signature.json' : null },
  };
  const packageJson = json(packageManifest);
  const checksumsJson = json(checksums);
  let signatureRecord = null;
  if (signing) {
    const digest = signatureDigest(packageJson, checksumsJson);
    let signature;
    try {
      signature = signBytes(null, digest, signing.privateKeyPem).toString('base64');
    } catch (error) {
      throw new Error(`Unable to sign App package with the supplied Ed25519 key: ${error.message}`);
    }
    signatureRecord = {
      formatVersion: 1,
      algorithm: 'ed25519',
      publisherId: signing.publisherId,
      keyId: signing.keyId,
      signedContentDigest: digest.toString('hex'),
      signature,
    };
  }
  const entries = new Map([
    ['package.json', packageJson],
    ['checksums.json', checksumsJson],
    ...(signatureRecord ? [['signature.json', json(signatureRecord)]] : []),
    ...payload,
  ]);
  const outputRoot = resolve(rootPath, outputDirectory);
  const zipPath = resolve(outputRoot, `${appKey}-${app.version}.zip`);
  await appendZip(zipPath, entries);
  const zipContent = await readFile(zipPath);
  const zipHash = sha256(zipContent);
  await writeFile(`${zipPath}.sha256`, `${zipHash}  ${basename(zipPath)}\n`, 'utf8');
  const report = {
    reportSchemaVersion: 2,
    package: basename(zipPath), appKey, version: app.version,
    platformCompatibility: app.platformCompatibility,
    requiredServices: app.requiredServices,
    providedServices: providedServiceKeys,
    externalServiceDependencies,
    deploymentManifest: app.deploymentManifest,
    deploymentServices: deployment.services.map((service) => service.serviceKey),
    fileCount: payload.size,
    payloadBytes: totalBytes,
    zipBytes: zipContent.byteLength,
    sha256: zipHash,
    artifact: { algorithm: 'sha256', digest: zipHash },
    publisherId: signing?.publisherId ?? null,
    keyId: signing?.keyId ?? null,
    signatureFormatVersion: signatureRecord?.formatVersion ?? null,
    signedContentDigest: signatureRecord?.signedContentDigest ?? null,
    signature: signatureRecord?.signature ?? null,
    signatureStatus: signing ? 'signed-unverified' : 'development-unsigned',
  };
  const reportPath = `${zipPath}.package-report.json`;
  await writeFile(reportPath, json(report), 'utf8');
  return { zipPath, checksumPath: `${zipPath}.sha256`, reportPath, report };
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Invalid ZIP: end-of-central-directory record was not found.');
}

export function readZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > MAX_ENTRIES) throw new Error('App package contains too many ZIP entries.');
  const entries = new Map();
  let totalBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Invalid ZIP central directory.');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x1) throw new Error(`Encrypted ZIP entries are not accepted: ${name}`);
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) throw new Error(`Symbolic links are not accepted: ${name}`);
    if (name.endsWith('/')) continue;
    safeArchivePath(name);
    if (entries.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    if (size > MAX_FILE_BYTES) throw new Error(`ZIP entry is too large: ${name}`);
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Expanded App package exceeds 256 MiB.');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (compressed.length !== compressedSize) throw new Error(`Truncated ZIP entry: ${name}`);
    const content = method === 0 ? Buffer.from(compressed)
      : method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_FILE_BYTES })
        : (() => { throw new Error(`Unsupported ZIP compression method ${method}: ${name}`); })();
    if (content.byteLength !== size) throw new Error(`ZIP entry size mismatch: ${name}`);
    entries.set(name, content);
  }
  return entries;
}

export async function verifyAppPackage({
  zipPath,
  reportPath,
  root = new URL('../../', import.meta.url),
  trustStore,
  now,
}) {
  const content = await readFile(zipPath);
  if (content.byteLength > MAX_TOTAL_BYTES) throw new Error('App package ZIP exceeds 256 MiB.');
  const entries = readZipEntries(content);
  for (const required of ['package.json', 'checksums.json']) {
    if (!entries.has(required)) throw new Error(`App package is missing ${required}.`);
  }
  for (const name of entries.keys()) {
    if (!['package.json', 'checksums.json', 'signature.json'].includes(name) && !name.startsWith('payload/')) {
      throw new Error(`Unexpected top-level App package entry: ${name}`);
    }
  }
  const packageJson = entries.get('package.json');
  const checksumsJson = entries.get('checksums.json');
  const packageManifest = JSON.parse(packageJson.toString('utf8'));
  const checksums = JSON.parse(checksumsJson.toString('utf8'));
  const platform = JSON.parse(await readFile(new URL('infrastructure/platform-contract.json', root), 'utf8'));
  assertExactKeys(packageManifest, [
    'schemaVersion', 'packageType', 'appKey', 'version', 'displayName', 'platformCompatibility',
    'requiredServices', 'providedServices', 'externalServiceDependencies', 'appManifest',
    'deploymentManifest', 'serviceFragment', 'payloadRoot', 'publisher', 'integrity',
  ], 'App package manifest');
  assertExactKeys(checksums, ['algorithm', 'files'], 'App package checksum inventory');
  if (packageManifest.publisher !== null) {
    assertExactKeys(packageManifest.publisher, ['publisherId', 'keyId'], 'App package publisher');
  }
  assertExactKeys(packageManifest.integrity, ['algorithm', 'checksumsFile', 'signatureFile'], 'App package integrity policy');
  if (packageManifest.schemaVersion !== platform.appPackageSchemaVersion
    || packageManifest.packageType !== 'stratexec-app'
    || !/^[a-z][a-z0-9-]*$/.test(packageManifest.appKey ?? '')) {
    throw new Error('Unsupported or invalid StratExec App package manifest.');
  }
  parseVersion(packageManifest.version);
  if (packageManifest.platformCompatibility?.appContractVersion !== platform.appContractVersion
    || !versionAtLeast(platform.platformVersion, packageManifest.platformCompatibility?.minimumVersion)) {
    throw new Error(`App package is incompatible with platform ${platform.platformVersion}.`);
  }
  if (packageManifest.integrity?.algorithm !== 'sha256'
    || packageManifest.integrity?.checksumsFile !== 'checksums.json'
    || ![null, 'signature.json'].includes(packageManifest.integrity?.signatureFile)
    || checksums.algorithm !== 'sha256' || typeof checksums.files !== 'object') {
    throw new Error('Unsupported App package integrity policy.');
  }
  const trust = await evaluateSignature({ packageManifest, packageJson, checksumsJson, entries, root, trustStore, now });
  const payloadNames = [...entries.keys()].filter((name) => name.startsWith('payload/')).sort();
  const checksumNames = Object.keys(checksums.files).sort();
  if (JSON.stringify(payloadNames) !== JSON.stringify(checksumNames)) {
    throw new Error('App package checksum inventory differs from its payload.');
  }
  for (const name of payloadNames) {
    if (sha256(entries.get(name)) !== checksums.files[name]) throw new Error(`Checksum mismatch: ${name}`);
  }
  const appManifestContent = entries.get(packageManifest.appManifest);
  if (!appManifestContent) throw new Error('Packaged App manifest is missing.');
  const app = JSON.parse(appManifestContent.toString('utf8'));
  if (app.appKey !== packageManifest.appKey || app.version !== packageManifest.version
    || app.displayName !== packageManifest.displayName || app.kind !== 'frontend-app'
    || app.package?.installable !== true || app.package.ownerApp !== app.appKey
    || packageManifest.appManifest !== `payload/infrastructure/apps/${app.appKey}.json`
    || packageManifest.deploymentManifest !== `payload/infrastructure/app-deployments/${app.appKey}.json`
    || app.deploymentManifest !== `infrastructure/app-deployments/${app.appKey}.json`
    || packageManifest.payloadRoot !== 'payload'
    || JSON.stringify(app.platformCompatibility) !== JSON.stringify(packageManifest.platformCompatibility)) {
    throw new Error('Packaged App manifest identity differs from package.json.');
  }
  const requiredServices = [...(app.requiredServices ?? [])].sort();
  const declaredRequiredServices = [...(packageManifest.requiredServices ?? [])].sort();
  if (JSON.stringify(requiredServices) !== JSON.stringify(declaredRequiredServices)) {
    throw new Error('Packaged App service requirements differ from package.json.');
  }
  let providedServices = [];
  let fragmentServices = [];
  if (packageManifest.serviceFragment !== null) {
    if (packageManifest.serviceFragment !== `payload/infrastructure/app-services/${app.appKey}.json`) {
      throw new Error('Packaged service fragment path differs from the App identity.');
    }
    const fragmentContent = entries.get(packageManifest.serviceFragment);
    if (!fragmentContent) throw new Error('Declared App service fragment is missing.');
    const fragment = JSON.parse(fragmentContent.toString('utf8'));
    if (fragment.schemaVersion !== platform.serviceRegistryVersion || fragment.ownerApp !== app.appKey
      || !Array.isArray(fragment.services)) {
      throw new Error('Packaged service fragment is incompatible or belongs to another App.');
    }
    const fragmentKeys = new Set();
    for (const service of fragment.services) {
      if (service.ownerApp !== app.appKey || !/^[a-z][a-z0-9-]*$/.test(service.key ?? '')
        || fragmentKeys.has(service.key) || !Array.isArray(service.dependsOn)
        || service.dependsOn.some((serviceKey) => !/^[a-z][a-z0-9-]*$/.test(serviceKey))) {
        throw new Error('Packaged service fragment contains an invalid or foreign service.');
      }
      fragmentKeys.add(service.key);
    }
    fragmentServices = fragment.services;
    providedServices = fragmentServices.map((service) => service.key).sort();
  }
  const declaredProvidedServices = [...(packageManifest.providedServices ?? [])].sort();
  const fragmentCatalog = new Map(fragmentServices.map((service) => [service.key, service]));
  if (JSON.stringify(providedServices) !== JSON.stringify(declaredProvidedServices)) {
    throw new Error('Packaged provided services differ from its App dependency contract.');
  }
  const reachable = new Set();
  const visiting = new Set();
  const expectedExternalDependencySet = new Set();
  const visitDependency = (serviceKey) => {
    if (reachable.has(serviceKey)) return;
    const service = fragmentCatalog.get(serviceKey);
    if (!service) {
      reachable.add(serviceKey);
      expectedExternalDependencySet.add(serviceKey);
      return;
    }
    if (visiting.has(serviceKey)) throw new Error(`Packaged service dependency cycle includes ${serviceKey}.`);
    visiting.add(serviceKey);
    for (const dependency of service.dependsOn ?? []) visitDependency(dependency);
    visiting.delete(serviceKey);
    reachable.add(serviceKey);
  };
  for (const serviceKey of requiredServices) visitDependency(serviceKey);
  const expectedExternalDependencies = [...expectedExternalDependencySet].sort();
  const declaredExternalDependencies = [...(packageManifest.externalServiceDependencies ?? [])].sort();
  if (JSON.stringify(expectedExternalDependencies) !== JSON.stringify(declaredExternalDependencies)) {
    throw new Error('Packaged external service dependencies differ from its App dependency contract.');
  }
  const deploymentContent = entries.get(packageManifest.deploymentManifest);
  if (!deploymentContent) throw new Error('Packaged App deployment contract is missing.');
  const deployment = JSON.parse(deploymentContent.toString('utf8'));
  const deploymentDocumentContent = entries.get(`payload/${app.deploymentDocument}`);
  if (!deploymentDocumentContent) throw new Error('Packaged App DEPLOYMENT.md is missing.');
  validateDeploymentContract({
    deployment,
    app,
    services: fragmentServices,
    platform,
    deploymentDocument: deploymentDocumentContent.toString('utf8'),
  });
  const report = {
    reportSchemaVersion: 2,
    package: basename(zipPath), appKey: app.appKey, version: app.version,
    platformVersion: platform.platformVersion,
    compatible: true,
    requiredServices,
    providedServices,
    externalServiceDependencies: expectedExternalDependencies,
    deploymentManifest: app.deploymentManifest,
    deploymentServices: deployment.services.map((service) => service.serviceKey),
    fileCount: payloadNames.length,
    expandedBytes: payloadNames.reduce((sum, name) => sum + entries.get(name).byteLength, 0),
    sha256: sha256(content),
    artifact: { algorithm: 'sha256', digest: sha256(content) },
    publisherId: trust.publisherId,
    keyId: trust.keyId,
    signatureFormatVersion: trust.signatureFormatVersion,
    signedContentDigest: trust.signedContentDigest,
    signature: trust.signature ?? null,
    signatureStatus: trust.signatureStatus,
    deployable: trust.signatureStatus === 'trusted-signed',
  };
  if (reportPath) {
    await mkdir(dirname(resolve(reportPath)), { recursive: true });
    await writeFile(resolve(reportPath), json(report), 'utf8');
  }
  return report;
}
