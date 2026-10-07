import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packFixtureApp } from '../../../scripts/test/package-fixture.mjs';
import { createPackageJobService } from '../src/package-job-service.mjs';

const workspaceRoot = new URL('../../../', import.meta.url);

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function prepareTarget(base) {
  const target = join(base, 'target');
  await mkdir(join(target, 'infrastructure', 'apps'), { recursive: true });
  await mkdir(join(target, 'infrastructure', 'services'), { recursive: true });
  await mkdir(join(target, 'infrastructure', 'app-services'), { recursive: true });
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

test('quarantines an upload and blocks unsigned apply by default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-package-agent-blocked-'));
  try {
    const packed = await packFixtureApp({ directory, outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    const jobs = createPackageJobService({ rootPath: target, stateRoot: join(directory, 'state') });
    const inspected = await jobs.inspect({
      content: await readFile(packed.zipPath),
      fileName: 'package-fixture-0.1.0.zip',
      actor: { uid: 'admin-1', email: 'admin@example.com' },
    });
    assert.equal(inspected.status, 'blocked');
    assert.equal(inspected.applyAllowed, false);
    assert.match(inspected.blockers.join(' '), /Development-unsigned package apply is disabled/);
    assert.equal('artifactPath' in inspected, false);
    assert.equal((await jobs.listJobs()).length, 1);
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'apps', 'package-fixture')), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('applies a confirmed job serially and records the durable result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-package-agent-apply-'));
  try {
    const packed = await packFixtureApp({ directory, outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    let validations = 0;
    const activations = [];
    const jobs = createPackageJobService({
      rootPath: target,
      stateRoot: join(directory, 'state'),
      allowUnsignedApply: true,
      validateInstall: async () => { validations += 1; },
      sourceActivator: { activate: async (input) => { activations.push(input); } },
    });
    const inspected = await jobs.inspect({
      content: await readFile(packed.zipPath),
      fileName: 'package-fixture-0.1.0.zip',
      actor: { uid: 'admin-1', email: 'admin@example.com' },
    });
    assert.equal(inspected.status, 'ready');
    assert.equal(inspected.applyAllowed, true);
    const restrictiveJobs = createPackageJobService({
      rootPath: target,
      stateRoot: join(directory, 'state'),
      allowUnsignedApply: false,
      validateInstall: async () => { throw new Error('must not validate'); },
    });
    await assert.rejects(
      () => restrictiveJobs.apply({
        jobId: inspected.jobId,
        confirmation: 'package-fixture@0.1.0',
        actor: { uid: 'admin-1', email: 'admin@example.com' },
      }),
      (error) => error.status === 403 && /current Package Agent policy/.test(error.message),
    );
    await assert.rejects(
      () => jobs.apply({ jobId: inspected.jobId, confirmation: 'package-fixture', actor: { uid: 'admin-1' } }),
      /exact confirmation/,
    );
    const applied = await jobs.apply({
      jobId: inspected.jobId,
      confirmation: 'package-fixture@0.1.0',
      actor: { uid: 'admin-1', email: 'admin@example.com' },
      token: 'firebase-token',
    });
    assert.equal(applied.status, 'succeeded');
    assert.equal(applied.result.applied, true);
    assert.equal(validations, 1);
    assert.equal(activations.length, 1);
    assert.equal(activations[0].token, 'firebase-token');
    assert.deepEqual(activations[0].activation.allowedAccessModes, ['public']);
    assert.equal(applied.sourceRegistration.status, 'succeeded');
    assert.equal(await exists(join(target, 'apps', 'console', 'src', 'apps', 'package-fixture', 'FixtureApp.tsx')), true);
    const history = await jobs.listJobs();
    assert.equal(history[0].status, 'succeeded');
    assert.equal('artifactPath' in history[0], false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('allows a trusted signed package without enabling development-unsigned apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-package-agent-signed-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signing = {
      publisherId: 'stratexec.test',
      keyId: 'release-2026-01',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const packed = await packFixtureApp({ directory, outputDirectory: join(directory, 'packages'), signing });
    const target = await prepareTarget(directory);
    await writeFile(
      join(target, 'infrastructure', 'app-publisher-trust.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        publishers: [{
          publisherId: signing.publisherId,
          displayName: 'Test Publisher',
          status: 'active',
          keys: [{
            keyId: signing.keyId,
            algorithm: 'ed25519',
            status: 'trusted',
            publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          }],
        }],
      }, null, 2)}\n`,
    );
    await mkdir(join(target, 'infrastructure', 'environments'), { recursive: true });
    await writeFile(
      join(target, 'infrastructure', 'environments', 'fixture-installation.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        installationKey: 'fixture-installation',
        gcpProjectId: 'fixture-project',
        region: 'asia-east1',
        servicePlacements: [],
      }, null, 2)}\n`,
    );
    const jobs = createPackageJobService({
      rootPath: target,
      stateRoot: join(directory, 'state'),
      allowUnsignedApply: false,
      inventoryProvider: async () => ({
        schemaVersion: 1,
        installationKey: 'fixture-installation',
        projectId: 'fixture-project',
        observedAt: '2026-09-18T00:00:00.000Z',
        collectionStatus: 'complete',
        collector: { mode: 'fixture', principal: 'admin@example.com' },
        enabledApis: [], grantedIamRoles: [], resources: [], hostingRoutes: [], secrets: [], errors: [],
      }),
      validateInstall: async () => {},
    });
    const inspected = await jobs.inspect({
      content: await readFile(packed.zipPath),
      fileName: 'package-fixture-0.1.0.zip',
      actor: { uid: 'admin-1', email: 'admin@example.com' },
    });
    assert.equal(inspected.status, 'ready');
    assert.equal(inspected.signatureStatus, 'trusted-signed');
    assert.equal(inspected.publisherId, signing.publisherId);
    const deploymentPlan = await jobs.planDeployment({
      jobId: inspected.jobId,
      installationKey: 'fixture-installation',
    });
    assert.equal(deploymentPlan.mode, 'read-only');
    assert.equal(deploymentPlan.decision, 'reviewable');
    assert.equal(deploymentPlan.package.signatureStatus, 'trusted-signed');
    const applied = await jobs.apply({
      jobId: inspected.jobId,
      confirmation: 'package-fixture@0.1.0',
      actor: { uid: 'admin-1', email: 'admin@example.com' },
    });
    assert.equal(applied.status, 'succeeded');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalidates an inspected job when owned repository files change before apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stratexec-package-agent-drift-'));
  try {
    const packed = await packFixtureApp({ directory, outputDirectory: join(directory, 'packages') });
    const target = await prepareTarget(directory);
    const jobs = createPackageJobService({
      rootPath: target,
      stateRoot: join(directory, 'state'),
      allowUnsignedApply: true,
      validateInstall: async () => {},
    });
    const inspected = await jobs.inspect({
      content: await readFile(packed.zipPath),
      fileName: 'package-fixture-0.1.0.zip',
      actor: { uid: 'admin-1', email: 'admin@example.com' },
    });
    const appSource = join(target, 'apps', 'console', 'src', 'apps', 'package-fixture');
    await mkdir(appSource, { recursive: true });
    await writeFile(join(appSource, 'FixtureApp.tsx'), '// changed after inspection\n');
    await assert.rejects(
      () => jobs.apply({
        jobId: inspected.jobId,
        confirmation: 'package-fixture@0.1.0',
        actor: { uid: 'admin-1', email: 'admin@example.com' },
      }),
      (error) => error.status === 409 && /inspect the ZIP again/.test(error.message),
    );
    const history = await jobs.listJobs();
    assert.equal(history[0].status, 'failed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
