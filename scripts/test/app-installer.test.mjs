import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installAppPackage, planAppPackageInstall } from '../lib/app-installer.mjs';
import { packApp } from '../lib/app-package.mjs';

const workspaceRoot = new URL('../../', import.meta.url);

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function prepareTarget(base) {
  const target = join(base, 'target');
  await mkdir(join(target, 'infrastructure', 'apps'), { recursive: true });
  await mkdir(join(target, 'infrastructure', 'services'), { recursive: true });
  await mkdir(join(target, 'apps', 'console', 'src', 'shell'), { recursive: true });
  await writeFile(
    join(target, 'infrastructure', 'platform-contract.json'),
    await readFile(new URL('infrastructure/platform-contract.json', workspaceRoot)),
  );
  await writeFile(
    join(target, 'infrastructure', 'apps', 'platform.json'),
    await readFile(new URL('infrastructure/apps/platform.json', workspaceRoot)),
  );
  await writeFile(
    join(target, 'infrastructure', 'services', 'platform.json'),
    `${JSON.stringify({ schemaVersion: 3, ownerApp: 'platform', services: [] }, null, 2)}\n`,
  );
  await writeFile(
    join(target, 'infrastructure', 'app-packages.lock.json'),
    `${JSON.stringify({ schemaVersion: 1, packages: {} }, null, 2)}\n`,
  );
  return target;
}

test('dry-runs and atomically installs a verified App package into an isolated target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-install-'));
  try {
    const packed = await packApp({ appKey: 'demo', outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    const plan = await planAppPackageInstall({ zipPath: packed.zipPath, rootPath: target });
    assert.equal(plan.status, 'new');
    assert.equal(plan.blockers.length, 0);
    assert.ok(plan.changes.some((change) => change.action === 'add'));
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'apps', 'demo')), false);

    const installed = await installAppPackage({
      zipPath: packed.zipPath,
      rootPath: target,
      apply: true,
      confirmation: 'demo@0.1.0',
    });
    assert.equal(installed.applied, true);
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'apps', 'demo', 'DemoApp.tsx')), true);
    const generated = await readFile(join(target, 'apps', 'console', 'src', 'shell', 'generatedAppRegistry.ts'), 'utf8');
    assert.match(generated, /key: "demo"/);
    const lock = JSON.parse(await readFile(join(target, 'infrastructure', 'app-packages.lock.json'), 'utf8'));
    assert.equal(lock.packages.demo.version, '0.1.0');

    const repeated = await installAppPackage({ zipPath: packed.zipPath, rootPath: target, apply: false });
    assert.equal(repeated.status, 'no-op');
    assert.equal(repeated.applied, false);

    await writeFile(
      join(target, 'apps', 'console', 'src', 'apps', 'demo', 'DemoApp.tsx'),
      '// locally customized after installation\n',
    );
    const drifted = await planAppPackageInstall({ zipPath: packed.zipPath, rootPath: target });
    assert.ok(drifted.blockers.some((blocker) => blocker.includes('Managed App has local drift')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binds plan fingerprints to installation settings and repository control state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-plan-context-'));
  try {
    const packed = await packApp({ appKey: 'demo', outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    const initial = await planAppPackageInstall({
      zipPath: packed.zipPath,
      rootPath: target,
      installationContext: { installationKey: 'customer-a', settings: { region: 'asia-east1' } },
    });
    const changedSettings = await planAppPackageInstall({
      zipPath: packed.zipPath,
      rootPath: target,
      installationContext: { installationKey: 'customer-a', settings: { region: 'us-central1' } },
    });
    assert.notEqual(initial.planFingerprint, changedSettings.planFingerprint);
    assert.match(initial.planContext.platformContractDigest, /^[a-f0-9]{64}$/);
    assert.match(initial.planContext.serviceRegistryDigest, /^[a-f0-9]{64}$/);
    assert.match(initial.planContext.packageLockDigest, /^[a-f0-9]{64}$/);
    assert.match(initial.planContext.installationContextDigest, /^[a-f0-9]{64}$/);

    await writeFile(
      join(target, 'infrastructure', 'app-packages.lock.json'),
      `${JSON.stringify({ schemaVersion: 1, packages: { unrelated: { version: '1.0.0', files: {} } } }, null, 2)}\n`,
    );
    const changedLock = await planAppPackageInstall({
      zipPath: packed.zipPath,
      rootPath: target,
      installationContext: { installationKey: 'customer-a', settings: { region: 'asia-east1' } },
    });
    assert.notEqual(initial.planFingerprint, changedLock.planFingerprint);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rolls source and derived files back when post-install validation fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-rollback-'));
  try {
    const packed = await packApp({ appKey: 'demo', outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    await assert.rejects(
      () => installAppPackage({
        zipPath: packed.zipPath,
        rootPath: target,
        apply: true,
        confirmation: 'demo@0.1.0',
        postApply: async () => { throw new Error('simulated validation failure'); },
      }),
      /simulated validation failure/,
    );
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'apps', 'demo')), false);
    assert.equal(await exists(join(target, 'infrastructure', 'apps', 'demo.json')), false);
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'shell', 'generatedAppRegistry.ts')), false);
    const lock = JSON.parse(await readFile(join(target, 'infrastructure', 'app-packages.lock.json'), 'utf8'));
    assert.deepEqual(lock.packages, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not delete an untouched target when the backup phase fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-backup-failure-'));
  try {
    const packed = await packApp({ appKey: 'demo', outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    const servicesPath = join(target, 'infrastructure', 'services.json');
    const lockPath = join(target, 'infrastructure', 'app-packages.lock.json');
    const originalServices = '{"sentinel":"services"}\n';
    const originalLock = await readFile(lockPath, 'utf8');
    await writeFile(servicesPath, originalServices);
    let failed = false;

    await assert.rejects(
      () => installAppPackage({
        zipPath: packed.zipPath,
        rootPath: target,
        apply: true,
        confirmation: 'demo@0.1.0',
        transactionOperations: {
          rename: async (source, destination) => {
            if (!failed && source === lockPath) {
              failed = true;
              throw new Error('simulated backup failure');
            }
            await rename(source, destination);
          },
        },
      }),
      /simulated backup failure/,
    );

    assert.equal(await readFile(servicesPath, 'utf8'), originalServices);
    assert.equal(await readFile(lockPath, 'utf8'), originalLock);
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'apps', 'demo')), false);
    const transactions = join(target, '.stratexec', 'app-installations');
    assert.deepEqual(await import('node:fs/promises').then(({ readdir }) => readdir(transactions)), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('requires exact confirmation and refuses packaging a platform-owned core App', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-app-confirm-'));
  try {
    const packed = await packApp({ appKey: 'demo', outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    await assert.rejects(
      () => installAppPackage({ zipPath: packed.zipPath, rootPath: target, apply: true, confirmation: 'demo' }),
      /exact confirmation: demo@0.1.0/,
    );
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'apps', 'demo')), false);
    await assert.rejects(
      () => packApp({ appKey: 'access-control', outputDirectory: join(directory, 'packages') }),
      /Installable frontend App not found/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
