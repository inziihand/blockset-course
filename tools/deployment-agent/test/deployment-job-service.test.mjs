import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDeploymentJobService } from '../src/deployment-job-service.mjs';
import { DeploymentOperationError } from '../src/executor.mjs';
import { createDeploymentJobStore } from '../src/job-store.mjs';
import { createDeploymentLeaseStore } from '../src/lease-store.mjs';

const packageJobId = '00000000-0000-4000-8000-000000000000';
const actor = {
  uid: 'admin-1', email: 'admin@example.com', permissions: ['deployment:manage', 'app:quotes:access'],
};
const policy = JSON.parse(await readFile(
  new URL('../../../infrastructure/deployment-agent.policy.json', import.meta.url),
  'utf8',
));

function deploymentPlan(fingerprint = 'a'.repeat(64)) {
  return {
    schemaVersion: 1,
    jobId: packageJobId,
    planKind: 'app-runtime-impact',
    mode: 'read-only',
    decision: 'reviewable',
    planFingerprint: fingerprint,
    package: {
      appKey: 'quotes', version: '1.0.0', packageSha256: 'b'.repeat(64),
      signatureStatus: 'trusted-signed', publisherId: 'publisher.test', keyId: 'release-1',
    },
    app: {
      displayName: 'Quotes', category: 'application', removable: true, protected: false,
      requiredServices: ['quotes-api'],
      entitlements: [{ key: 'realtime', displayName: '即時報價' }],
    },
    installation: { installationKey: 'customer-a', projectId: 'customer-a-project', region: 'asia-east1' },
    changes: {
      files: [], services: [], routes: [], secretReferences: [],
      cloudResources: [{ action: 'add', type: 'cloud-run-service', serviceKey: 'quotes-api' }],
    },
    services: [{
      serviceKey: 'quotes-api', selectedTarget: 'cloud-run-service', region: 'asia-east1',
      serviceName: 'customer-a-quotes', publicIngress: true,
    }],
    requirements: {
      deploymentAgentIamRoles: [
        { role: 'roles/run.admin', missing: false },
        { role: 'roles/iam.serviceAccountUser', missing: false },
      ],
    },
    migrations: [{ serviceKey: 'quotes-api', reversible: true, backupRequired: false }],
    blockers: [],
  };
}

async function fixture({ executor, settingsProvider, lifecycleProvider, now = () => new Date('2026-09-18T00:00:00.000Z'), operationTimeoutMs } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-deployment-agent-'));
  const store = createDeploymentJobStore({ stateRoot: root, maxJobs: 50 });
  const leases = createDeploymentLeaseStore({ stateRoot: root, leaseSeconds: 60, now });
  let currentPlan = deploymentPlan();
  const calls = [];
  const activeExecutor = executor ?? {
    capabilities: { mode: 'fixture', supportedTargets: ['cloud-run-service'] },
    async apply(context) { calls.push(['apply', context]); return { outcome: 'succeeded', revision: 'quotes-00001', artifactDigest: 'c'.repeat(64), message: 'token=must-not-leak' }; },
    async verify(context) { calls.push(['verify', context]); return { outcome: 'succeeded', revision: 'quotes-00001', artifactDigest: 'c'.repeat(64) }; },
    async promote(context) { calls.push(['promote', context]); return { outcome: 'succeeded', revision: 'quotes-00001', artifactDigest: 'c'.repeat(64) }; },
    async rollback(context) { calls.push(['rollback', context]); return { outcome: 'succeeded', revision: 'quotes-00000', artifactDigest: 'd'.repeat(64) }; },
    async reconcile(context) { calls.push(['reconcile', context]); return { outcome: 'succeeded', revision: 'quotes-00001', artifactDigest: 'c'.repeat(64) }; },
  };
  const activeLifecycle = lifecycleProvider ?? {
    async activate({ appKey, activation }) {
      calls.push(['activate', activation]);
      return { appKey, status: 'installed', runtimeRevision: activation.runtimeRevision };
    },
  };
  const service = createDeploymentJobService({
    store,
    leases,
    planProvider: async () => structuredClone(currentPlan),
    executor: activeExecutor,
    policy,
    installationProvider: async () => ({
      installationKey: 'customer-a', gcpProjectId: 'customer-a-project', region: 'asia-east1',
    }),
    settingsProvider,
    lifecycleProvider: activeLifecycle,
    now,
    operationTimeoutMs,
  });
  return {
    root, store, service, calls,
    setPlan(plan) { currentPlan = plan; },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function inspectAndApprove(target) {
  const inspected = await target.service.inspect({
    packageJobId, installationKey: 'customer-a', appKey: 'quotes', token: 'firebase-token', actor,
  });
  assert.equal(inspected.status, 'awaiting-approval');
  return target.service.approve({
    jobId: inspected.jobId,
    confirmation: `APPROVE quotes@1.0.0 ${inspected.planFingerprint}`,
    planFingerprint: inspected.planFingerprint,
    packageSha256: inspected.package.packageSha256,
    appVersion: inspected.package.version,
    riskConfirmations: inspected.requiredRiskConfirmations,
    actor,
  });
}

test('binds approval to immutable inputs and records apply, verify and rollback evidence', async () => {
  const target = await fixture();
  try {
    const approved = await inspectAndApprove(target);
    assert.equal(approved.status, 'approved');
    const applied = await target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor });
    assert.equal(applied.status, 'applied');
    assert.equal(target.calls[0][1].idempotencyKey.length, 64);
    assert.equal(Object.hasOwn(target.calls[0][1], 'token'), false);
    await assert.rejects(
      () => target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor }),
      /not approved for apply/,
    );
    assert.equal(target.calls.filter(([name]) => name === 'apply').length, 1);
    const verified = await target.service.verify({ jobId: approved.jobId, actor });
    assert.equal(verified.status, 'verified');
    const rolledBack = await target.service.rollback({
      jobId: approved.jobId,
      confirmation: 'ROLLBACK quotes@1.0.0 quotes-00001',
      actor,
    });
    assert.equal(rolledBack.status, 'rolled-back');
    const evidence = await target.service.evidence(approved.jobId);
    assert.deepEqual(evidence.events.map((item) => item.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(JSON.stringify(evidence).includes('must-not-leak'), false);
    assert.equal(JSON.stringify(evidence).includes('firebase-token'), false);
  } finally { await target.cleanup(); }
});

test('requires staged verification and exact confirmation before production promotion', async () => {
  const calls = [];
  const executor = {
    capabilities: { mode: 'fixture', supportedTargets: ['cloud-run-service'], requiresPromotion: true },
    async apply(context) { calls.push(['apply', context]); return { outcome: 'succeeded', revision: 'quotes-00001', artifactDigest: 'c'.repeat(64) }; },
    async verify(context) { calls.push(['verify', context]); return { outcome: 'succeeded', revision: 'quotes-00001', artifactDigest: 'c'.repeat(64) }; },
    async promote(context) { calls.push(['promote', context]); return { outcome: 'succeeded', revision: 'quotes-00001', artifactDigest: 'c'.repeat(64) }; },
    async rollback(context) { calls.push(['rollback', context]); return { outcome: 'succeeded', revision: 'quotes-00000', artifactDigest: 'd'.repeat(64) }; },
    async reconcile() { return { outcome: 'unknown' }; },
  };
  const target = await fixture({ executor });
  try {
    const approved = await inspectAndApprove(target);
    await target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor });
    await assert.rejects(
      () => target.service.promote({ jobId: approved.jobId, confirmation: 'PROMOTE now', actor }),
      /staged verification/,
    );
    const staged = await target.service.verify({ jobId: approved.jobId, token: 'firebase-token', actor });
    assert.equal(staged.status, 'staged-verified');
    await assert.rejects(
      () => target.service.promote({ jobId: approved.jobId, confirmation: 'PROMOTE now', actor }),
      /exact confirmation/,
    );
    const promoted = await target.service.promote({
      jobId: approved.jobId,
      confirmation: `PROMOTE quotes@1.0.0 ${approved.planFingerprint.slice(0, 12)}`,
      actor,
    });
    assert.equal(promoted.status, 'verified');
    assert.equal(calls.filter(([name]) => name === 'promote').length, 1);
    assert.equal((await target.service.evidence(approved.jobId)).promotionEvidence.revision, 'quotes-00001');
  } finally { await target.cleanup(); }
});

test('invalidates approval when the read-only plan fingerprint changes', async () => {
  const target = await fixture();
  try {
    const approved = await inspectAndApprove(target);
    target.setPlan(deploymentPlan('d'.repeat(64)));
    await assert.rejects(
      () => target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor }),
      /plan changed after approval/,
    );
    const job = await target.service.getJob(approved.jobId);
    assert.equal(job.status, 'awaiting-approval');
    assert.equal(job.approval, null);
    assert.equal(job.planFingerprint, 'd'.repeat(64));
  } finally { await target.cleanup(); }
});

test('blocks a package that requests a runtime IAM role outside the platform allowlist', async () => {
  const target = await fixture();
  try {
    const unsafe = deploymentPlan();
    unsafe.requirements.runtimeServiceAccountRoles = [{ serviceKey: 'quotes-api', role: 'roles/owner' }];
    target.setPlan(unsafe);
    const inspected = await target.service.inspect({
      packageJobId, installationKey: 'customer-a', appKey: 'quotes', token: 'firebase-token', actor,
    });
    assert.equal(inspected.status, 'blocked');
    assert.ok(inspected.blockers.some((item) => item.includes('roles/owner')));
    assert.equal(target.calls.length, 0);
  } finally { await target.cleanup(); }
});

test('binds concrete secret versions to approval and invalidates when settings rotate', async () => {
  let revision = 1;
  const settingsProvider = async () => ({
    schemaVersion: 1,
    installationKey: 'customer-a',
    appKey: 'quotes',
    stateRevision: revision,
    bindingsFingerprint: (revision === 1 ? 'e' : 'f').repeat(64),
    configuration: [{ serviceKey: 'quotes-api', environment: 'TIMEOUT_MS', source: 'operator-input', configuredValue: 5000 }],
    secrets: [{
      serviceKey: 'quotes-api', environment: 'QUOTES_API_KEY',
      secretResource: 'projects/customer-a-project/secrets/quotes-api-key', version: String(revision),
    }],
    blockers: [],
  });
  const target = await fixture({ settingsProvider });
  try {
    const approved = await inspectAndApprove(target);
    revision = 2;
    await assert.rejects(
      () => target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor }),
      /plan changed after approval/,
    );
    const job = await target.service.getJob(approved.jobId);
    assert.equal(job.approval, null);
    assert.equal(job.settingsBindings.secrets[0].version, '2');
    assert.equal(JSON.stringify(job).includes('secretValue'), false);
    assert.equal(target.calls.length, 0);
  } finally { await target.cleanup(); }
});

test('reconciles UNKNOWN before permitting another apply', async () => {
  let applyCalls = 0;
  const executor = {
    capabilities: { mode: 'fixture', supportedTargets: ['cloud-run-service'] },
    async apply() { applyCalls += 1; throw new DeploymentOperationError('authorization=top-secret', { indeterminate: true, status: 504 }); },
    async verify() { return { outcome: 'failed' }; },
    async rollback() { return { outcome: 'failed' }; },
    async reconcile() { return { outcome: 'absent', message: 'No revision exists.' }; },
  };
  const target = await fixture({ executor });
  try {
    const approved = await inspectAndApprove(target);
    await assert.rejects(() => target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor }), /REDACTED/);
    assert.equal((await target.service.getJob(approved.jobId)).status, 'unknown');
    const reconciled = await target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor });
    assert.equal(reconciled.status, 'awaiting-approval');
    assert.equal(reconciled.approval, null);
    assert.equal(applyCalls, 1);
  } finally { await target.cleanup(); }
});

test('recovers a crashed transient job by read-only reconciliation', async () => {
  const target = await fixture();
  try {
    const approved = await inspectAndApprove(target);
    const job = await target.store.read(approved.jobId);
    await target.store.write({
      ...job,
      status: 'applying',
      lastOperation: { type: 'apply', idempotencyKey: 'e'.repeat(64), startedAt: job.updatedAt },
    });
    const result = await target.service.recover();
    assert.deepEqual(result, [{ jobId: approved.jobId, status: 'applied' }]);
    assert.equal((await target.service.getJob(approved.jobId)).status, 'applied');
    assert.equal(target.calls[0][0], 'reconcile');
  } finally { await target.cleanup(); }
});

test('rejects plan payloads that try to smuggle secret values into durable state', async () => {
  const target = await fixture();
  try {
    const unsafe = deploymentPlan();
    unsafe.requirements.secrets = [{ secretName: 'api-secret', secretValue: 'must-not-persist' }];
    target.setPlan(unsafe);
    await assert.rejects(
      () => target.service.inspect({
        packageJobId, installationKey: 'customer-a', appKey: 'quotes', token: 'firebase-token', actor,
      }),
      /forbidden sensitive field: secretValue/,
    );
    assert.equal((await target.service.listJobs()).length, 0);
  } finally { await target.cleanup(); }
});

test('expires approval before apply and requires a fresh review', async () => {
  let clock = new Date('2026-09-18T00:00:00.000Z');
  const target = await fixture({ now: () => clock });
  try {
    const approved = await inspectAndApprove(target);
    clock = new Date('2026-09-18T00:15:01.000Z');
    await assert.rejects(
      () => target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor }),
      /approval expired/i,
    );
    const job = await target.service.getJob(approved.jobId);
    assert.equal(job.status, 'awaiting-approval');
    assert.equal(job.approval, null);
  } finally { await target.cleanup(); }
});

test('rejects concurrent apply across jobs for the same installation', async () => {
  let releaseFirst;
  let startedFirst;
  const firstStarted = new Promise((resolve) => { startedFirst = resolve; });
  let call = 0;
  const executor = {
    capabilities: { mode: 'fixture', supportedTargets: ['cloud-run-service'] },
    async apply() {
      call += 1;
      if (call === 1) {
        startedFirst();
        await new Promise((resolve) => { releaseFirst = resolve; });
      }
      return { outcome: 'succeeded', revision: `quotes-0000${call}`, artifactDigest: 'c'.repeat(64) };
    },
    async verify() { return { outcome: 'succeeded' }; },
    async rollback() { return { outcome: 'succeeded' }; },
    async reconcile() { return { outcome: 'unknown' }; },
  };
  const target = await fixture({ executor });
  try {
    const first = await inspectAndApprove(target);
    const second = await inspectAndApprove(target);
    const applying = target.service.apply({ jobId: first.jobId, token: 'firebase-token', actor });
    await firstStarted;
    await assert.rejects(
      () => target.service.apply({ jobId: second.jobId, token: 'firebase-token', actor }),
      /leased by another deployment job/,
    );
    assert.equal((await target.service.getJob(second.jobId)).status, 'failed');
    releaseFirst();
    assert.equal((await applying).status, 'applied');
  } finally { await target.cleanup(); }
});

test('turns a target timeout into UNKNOWN and does not blind retry', async () => {
  let applyCalls = 0;
  const executor = {
    capabilities: { mode: 'fixture', supportedTargets: ['cloud-run-service'] },
    async apply() { applyCalls += 1; return new Promise(() => {}); },
    async verify() { return { outcome: 'failed' }; },
    async rollback() { return { outcome: 'failed' }; },
    async reconcile() { return { outcome: 'unknown', message: 'Still indeterminate.' }; },
  };
  const target = await fixture({ executor, operationTimeoutMs: 10 });
  try {
    const approved = await inspectAndApprove(target);
    await assert.rejects(
      () => target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor }),
      /timed out/,
    );
    assert.equal((await target.service.getJob(approved.jobId)).status, 'unknown');
    const reconciled = await target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor });
    assert.equal(reconciled.status, 'unknown');
    assert.equal(applyCalls, 1);
  } finally { await target.cleanup(); }
});

test('cancels only before external writes and preserves a terminal audit event', async () => {
  const target = await fixture();
  try {
    const inspected = await target.service.inspect({
      packageJobId, installationKey: 'customer-a', appKey: 'quotes', token: 'firebase-token', actor,
    });
    const cancelled = await target.service.cancel({ jobId: inspected.jobId, actor });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await target.service.events(inspected.jobId)).at(-1).type, 'job.cancelled');
    await assert.rejects(() => target.service.cancel({ jobId: inspected.jobId, actor }), /without external writes/);
    await assert.rejects(
      () => target.service.plan({ jobId: inspected.jobId, token: 'firebase-token', actor }),
      /cannot be reopened/,
    );
  } finally { await target.cleanup(); }
});

test('activates logical App access only after verified runtime evidence', async () => {
  const target = await fixture();
  try {
    const approved = await inspectAndApprove(target);
    await assert.rejects(
      () => target.service.activate({ jobId: approved.jobId, confirmation: 'ENABLE quotes@1.0.0', token: 'firebase-token', actor }),
      /deployed and verified/,
    );
    await target.service.apply({ jobId: approved.jobId, token: 'firebase-token', actor });
    const verified = await target.service.verify({ jobId: approved.jobId, token: 'firebase-token', actor });
    await assert.rejects(
      () => target.service.activate({ jobId: approved.jobId, confirmation: 'ENABLE wrong', token: 'firebase-token', actor }),
      /exact confirmation/,
    );
    const activated = await target.service.activate({
      jobId: verified.jobId, confirmation: 'ENABLE quotes@1.0.0', token: 'firebase-token', actor,
    });
    assert.equal(activated.status, 'verified');
    assert.equal(activated.activationEvidence.runtimeRevision, 'quotes-00001');
    const call = target.calls.find(([name]) => name === 'activate');
    assert.equal(call[1].deploymentJobId, verified.jobId);
    assert.equal(call[1].planFingerprint, verified.planFingerprint);
    assert.equal(call[1].requiredServices[0], 'quotes-api');
    assert.deepEqual(call[1].entitlements, [{ key: 'realtime', displayName: '即時報價' }]);
    assert.equal(Object.hasOwn(call[1], 'token'), false);
  } finally { await target.cleanup(); }
});
