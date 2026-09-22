import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateAppRegistrySource } from './app-registry.mjs';
import { readZipEntries, verifyAppPackage } from './app-package.mjs';
import { loadAppManifests } from './deployment-plan.mjs';
import { loadMergedServiceRegistry, renderServiceRegistry } from './service-catalog.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const slash = (value) => value.split(sep).join('/');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const stableJson = (value) => JSON.stringify(value, (_, item) => (
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item
));

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function repoUrl(rootPath) {
  return pathToFileURL(`${resolve(rootPath)}${sep}`);
}

function absoluteInRoot(rootPath, relativePath) {
  const absolute = resolve(rootPath, relativePath);
  const fromRoot = relative(resolve(rootPath), absolute);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    if (!fromRoot) return absolute;
    throw new Error(`App installation path escapes the repository: ${relativePath}`);
  }
  return absolute;
}

function isInside(path, directory) {
  return path === directory || path.startsWith(`${directory}/`);
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value ?? '');
    if (!match) throw new Error(`Invalid semantic version: ${value}`);
    return match.slice(1, 4).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function deriveRoots(app, fragment) {
  const expectedSource = `apps/console/src/apps/${app.appKey}`;
  const expectedDeploymentManifest = `infrastructure/app-deployments/${app.appKey}.json`;
  if (app.source !== expectedSource || app.deploymentDocument !== `${expectedSource}/DEPLOYMENT.md`
    || app.deploymentManifest !== expectedDeploymentManifest) {
    throw new Error(`Installable App must use its canonical source directory: ${app.appKey}`);
  }
  const roots = [
    { path: expectedSource, kind: 'directory' },
    { path: `infrastructure/apps/${app.appKey}.json`, kind: 'file' },
    { path: expectedDeploymentManifest, kind: 'file' },
  ];
  if (fragment) {
    roots.push({ path: `infrastructure/app-services/${app.appKey}.json`, kind: 'file' });
    for (const service of fragment.services) {
      if (service.source !== `services/${service.key}` || !/^contracts\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.json$/.test(service.contract)
        || service.contract.includes('..')) {
        throw new Error(`Service paths are not package-installable: ${service.key}`);
      }
      roots.push({ path: service.source, kind: 'directory' });
      roots.push({ path: service.contract, kind: 'file' });
    }
  }
  return collapseRoots(roots);
}

function collapseRoots(roots) {
  const unique = [...new Map(roots.map((root) => [root.path, root])).values()]
    .sort((left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path));
  const result = [];
  for (const root of unique) {
    if (result.some((existing) => existing.kind === 'directory' && isInside(root.path, existing.path))) continue;
    result.push(root);
  }
  return result;
}

async function readJsonIfPresent(path) {
  if (!(await exists(path))) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function collectFiles(rootPath, root) {
  const absolute = absoluteInRoot(rootPath, root.path);
  if (!(await exists(absolute))) return [];
  if (root.kind === 'file') return [root.path];
  const files = [];
  async function walk(directory, relativeDirectory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = slash(posix.join(relativeDirectory, entry.name));
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Existing App source contains a symbolic link: ${relativePath}`);
      if (entry.isDirectory()) await walk(absolutePath, relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  }
  await walk(absolute, root.path);
  return files;
}

async function writeStagingPayload(stageRoot, payload) {
  for (const [relativePath, content] of payload) {
    const target = absoluteInRoot(stageRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

async function regenerateDerivedFiles(rootPath) {
  const root = repoUrl(rootPath);
  const registry = await loadMergedServiceRegistry(root);
  await writeFile(absoluteInRoot(rootPath, 'infrastructure/services.json'), renderServiceRegistry(registry), 'utf8');
  const manifests = await loadAppManifests(root);
  await writeFile(
    absoluteInRoot(rootPath, 'apps/console/src/shell/generatedAppRegistry.ts'),
    generateAppRegistrySource(manifests),
    'utf8',
  );
}

function describeStatus(existingVersion, nextVersion, changes) {
  if (!existingVersion) return 'new';
  if (changes.every((change) => change.action === 'unchanged')) return 'no-op';
  return compareVersions(nextVersion, existingVersion) < 0 ? 'downgrade' : 'update';
}

export async function planAppPackageInstall({
  zipPath,
  rootPath = fileURLToPath(new URL('../../', import.meta.url)),
  adoptExisting = false,
  allowDowngrade = false,
  installationContext = { installationKey: 'repository-local', settings: {} },
}) {
  const resolvedRoot = resolve(rootPath);
  const verification = await verifyAppPackage({ zipPath, root: repoUrl(resolvedRoot) });
  const entries = readZipEntries(await readFile(zipPath));
  const packageManifest = JSON.parse(entries.get('package.json').toString('utf8'));
  const app = JSON.parse(entries.get(packageManifest.appManifest).toString('utf8'));
  if (app.package?.installable !== true || app.package.ownerApp !== app.appKey
    || app.lifecycle?.removable !== true || app.access?.protected === true) {
    throw new Error(`App package is not eligible for source installation: ${app.appKey}`);
  }
  const fragment = packageManifest.serviceFragment
    ? JSON.parse(entries.get(packageManifest.serviceFragment).toString('utf8'))
    : null;
  const nextRoots = deriveRoots(app, fragment);
  const payload = new Map([...entries]
    .filter(([name]) => name.startsWith('payload/'))
    .map(([name, content]) => [name.slice('payload/'.length), content]));
  for (const path of payload.keys()) {
    if (!nextRoots.some((root) => root.kind === 'file' ? path === root.path : isInside(path, root.path))) {
      throw new Error(`Package payload is outside its owned roots: ${path}`);
    }
  }

  const currentManifestPath = absoluteInRoot(resolvedRoot, `infrastructure/apps/${app.appKey}.json`);
  const currentApp = await readJsonIfPresent(currentManifestPath);
  if (currentApp?.access?.protected === true || currentApp?.lifecycle?.removable === false) {
    throw new Error(`Existing App is protected from package replacement: ${app.appKey}`);
  }
  const currentFragment = await readJsonIfPresent(
    absoluteInRoot(resolvedRoot, `infrastructure/app-services/${app.appKey}.json`),
  );
  const previousRoots = currentApp ? deriveRoots(currentApp, currentFragment) : [];

  const manifests = await loadAppManifests(repoUrl(resolvedRoot));
  for (const manifest of manifests) {
    if (manifest.appKey === app.appKey || manifest.package.ownerApp === app.appKey) continue;
    if (manifest.source === app.source && manifest.package.ownerApp !== app.package.ownerApp) {
      throw new Error(`App source is already owned by ${manifest.package.ownerApp}: ${app.source}`);
    }
  }
  const registry = await loadMergedServiceRegistry(repoUrl(resolvedRoot));
  const newServices = fragment?.services ?? [];
  for (const service of newServices) {
    const existing = registry.services.find((item) => item.key === service.key);
    if (existing && existing.ownerApp !== app.appKey) throw new Error(`Service key is already owned: ${service.key}`);
    const sourceOwner = registry.services.find((item) => item.source === service.source && item.ownerApp !== app.appKey);
    if (sourceOwner) throw new Error(`Service source is already owned by ${sourceOwner.ownerApp}: ${service.source}`);
    const contractOwner = registry.services.find((item) => item.contract === service.contract && item.ownerApp !== app.appKey);
    if (contractOwner) throw new Error(`Service contract is already owned by ${contractOwner.ownerApp}: ${service.contract}`);
  }

  const blockers = [];
  const serviceKeys = new Set(registry.services.map((service) => service.key));
  for (const dependency of verification.externalServiceDependencies) {
    if (!serviceKeys.has(dependency)) blockers.push(`Missing external service dependency: ${dependency}`);
  }

  const allRoots = collapseRoots([...previousRoots, ...nextRoots]);
  const currentPaths = new Set();
  for (const root of allRoots) {
    for (const path of await collectFiles(resolvedRoot, root)) currentPaths.add(path);
  }
  const changes = [];
  const currentFileHashes = {};
  for (const path of [...new Set([...currentPaths, ...payload.keys()])].sort()) {
    const next = payload.get(path);
    const current = currentPaths.has(path) ? await readFile(absoluteInRoot(resolvedRoot, path)) : null;
    currentFileHashes[path] = current ? sha256(current) : null;
    if (!next) {
      changes.push({ path, action: 'delete' });
      continue;
    }
    if (!currentPaths.has(path)) {
      changes.push({ path, action: 'add' });
      continue;
    }
    changes.push({ path, action: current.equals(next) ? 'unchanged' : 'update' });
  }

  const lockPath = absoluteInRoot(resolvedRoot, 'infrastructure/app-packages.lock.json');
  const lock = await readJsonIfPresent(lockPath) ?? { schemaVersion: 1, packages: {} };
  if (lock.schemaVersion !== 1 || typeof lock.packages !== 'object') throw new Error('Invalid App package lock.');
  const locked = lock.packages[app.appKey];
  if (locked) {
    for (const [path, expectedHash] of Object.entries(locked.files ?? {})) {
      const absolute = absoluteInRoot(resolvedRoot, path);
      if (!(await exists(absolute)) || sha256(await readFile(absolute)) !== expectedHash) {
        blockers.push(`Managed App has local drift: ${path}`);
      }
    }
  } else if (currentApp && changes.some((change) => change.action !== 'unchanged') && !adoptExisting) {
    blockers.push('Existing App is not package-managed; review changes and use adopt-existing explicitly.');
  }
  if (currentApp) {
    const comparison = compareVersions(app.version, currentApp.version);
    if (comparison === 0 && changes.some((change) => change.action !== 'unchanged')) {
      blockers.push('A published App version is immutable; bump the version before installing changed content.');
    }
    if (comparison < 0 && !allowDowngrade) blockers.push('Downgrade requires allow-downgrade explicitly.');
  }

  const uniqueBlockers = [...new Set(blockers)];
  const platformContract = await readFile(absoluteInRoot(resolvedRoot, 'infrastructure/platform-contract.json'));
  const planContext = {
    platformContractDigest: sha256(platformContract),
    serviceRegistryDigest: sha256(Buffer.from(renderServiceRegistry(registry))),
    packageLockDigest: sha256(Buffer.from(stableJson(lock))),
    installationContextDigest: sha256(Buffer.from(stableJson(installationContext))),
  };
  const planFingerprint = sha256(Buffer.from(JSON.stringify({
    appKey: app.appKey,
    version: app.version,
    previousVersion: currentApp?.version ?? null,
    packageSha256: verification.sha256,
    currentFileHashes,
    planContext,
    blockers: uniqueBlockers,
    adoptExisting: Boolean(adoptExisting),
    allowDowngrade: Boolean(allowDowngrade),
  })));
  return {
    appKey: app.appKey,
    version: app.version,
    previousVersion: currentApp?.version ?? null,
    status: describeStatus(currentApp?.version, app.version, changes),
    packageSha256: verification.sha256,
    verification,
    blockers: uniqueBlockers,
    changes,
    planFingerprint,
    planContext,
    payload,
    roots: allRoots,
    nextRoots,
    app,
    lock,
    adoptedExisting: Boolean(currentApp && !locked && adoptExisting),
  };
}

export async function installAppPackage({
  zipPath,
  rootPath,
  apply = false,
  confirmation,
  adoptExisting = false,
  allowDowngrade = false,
  expectedPlanFingerprint,
  installationContext = { installationKey: 'repository-local', settings: {} },
  postApply,
  transactionOperations = {},
}) {
  const resolvedRoot = resolve(rootPath ?? fileURLToPath(new URL('../../', import.meta.url)));
  const plan = await planAppPackageInstall({
    zipPath, rootPath: resolvedRoot, adoptExisting, allowDowngrade, installationContext,
  });
  if (expectedPlanFingerprint && plan.planFingerprint !== expectedPlanFingerprint) {
    throw new Error('Repository changed after App package inspection; inspect the package again.');
  }
  const publicPlan = {
    appKey: plan.appKey,
    version: plan.version,
    previousVersion: plan.previousVersion,
    status: plan.status,
    packageSha256: plan.packageSha256,
    blockers: plan.blockers,
    changes: plan.changes,
    planFingerprint: plan.planFingerprint,
    planContext: plan.planContext,
  };
  if (!apply || (plan.status === 'no-op' && !plan.adoptedExisting)) {
    return { ...publicPlan, applied: false };
  }
  if (plan.blockers.length > 0) throw new Error(`App package install is blocked: ${plan.blockers.join(' | ')}`);
  const expectedConfirmation = `${plan.appKey}@${plan.version}`;
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Apply requires exact confirmation: ${expectedConfirmation}`);
  }

  const transactionBase = absoluteInRoot(resolvedRoot, '.stratexec/app-installations');
  await mkdir(transactionBase, { recursive: true });
  const transactionRoot = resolve(transactionBase, `${plan.appKey}-${randomUUID()}`);
  const stageRoot = resolve(transactionRoot, 'stage');
  const backupRoot = resolve(transactionRoot, 'backup');
  await mkdir(stageRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await writeStagingPayload(stageRoot, plan.payload);

  const derivedRoots = [
    { path: 'infrastructure/services.json', kind: 'file' },
    { path: 'apps/console/src/shell/generatedAppRegistry.ts', kind: 'file' },
    { path: 'infrastructure/app-packages.lock.json', kind: 'file' },
  ];
  const transactionRoots = collapseRoots([...plan.roots, ...derivedRoots]);
  const backedUp = new Set();
  const changedTargets = new Set();
  const movePath = transactionOperations.rename ?? rename;
  let preserveTransaction = false;
  try {
    for (const root of transactionRoots) {
      const target = absoluteInRoot(resolvedRoot, root.path);
      if (!(await exists(target))) continue;
      const backup = absoluteInRoot(backupRoot, root.path);
      await mkdir(dirname(backup), { recursive: true });
      await movePath(target, backup);
      backedUp.add(root.path);
    }
    for (const root of plan.nextRoots) {
      const staged = absoluteInRoot(stageRoot, root.path);
      if (!(await exists(staged))) throw new Error(`Staged package root is missing: ${root.path}`);
      const target = absoluteInRoot(resolvedRoot, root.path);
      await mkdir(dirname(target), { recursive: true });
      await movePath(staged, target);
      changedTargets.add(root.path);
    }
    for (const root of derivedRoots) changedTargets.add(root.path);
    await regenerateDerivedFiles(resolvedRoot);
    if (postApply) await postApply({ rootPath: resolvedRoot, plan: publicPlan });
    plan.lock.packages[plan.appKey] = {
      version: plan.version,
      packageSha256: plan.packageSha256,
      installedAt: new Date().toISOString(),
      files: Object.fromEntries([...plan.payload].map(([path, content]) => [path, sha256(content)])),
    };
    await writeFile(
      absoluteInRoot(resolvedRoot, 'infrastructure/app-packages.lock.json'),
      json(plan.lock),
      'utf8',
    );
  } catch (error) {
    const rollbackErrors = [];
    for (const root of [...transactionRoots].reverse()) {
      const target = absoluteInRoot(resolvedRoot, root.path);
      try {
        if ((changedTargets.has(root.path) || backedUp.has(root.path)) && await exists(target)) {
          await rm(target, { recursive: true, force: true });
        }
        if (backedUp.has(root.path)) {
          const backup = absoluteInRoot(backupRoot, root.path);
          await mkdir(dirname(target), { recursive: true });
          await movePath(backup, target);
        }
      } catch (rollbackError) {
        rollbackErrors.push(new Error(`Failed to restore ${root.path}: ${rollbackError.message}`, { cause: rollbackError }));
      }
    }
    if (rollbackErrors.length > 0) {
      preserveTransaction = true;
      throw new AggregateError(
        [error, ...rollbackErrors],
        `App package install failed and rollback was incomplete. Recovery files are preserved at ${transactionRoot}. Original error: ${error.message}`,
      );
    }
    throw error;
  } finally {
    if (!preserveTransaction) await rm(transactionRoot, { recursive: true, force: true });
  }
  return { ...publicPlan, applied: true };
}
