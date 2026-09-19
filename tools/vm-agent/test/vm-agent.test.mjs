import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVmAgentService } from '../src/agent-service.mjs';
import { createVmAgentApp } from '../src/app.mjs';
import { canonicalJson, createDesiredStateVerifier } from '../src/desired-state.mjs';
import { evaluateVmSafetyPreflight } from '../src/safety-preflight.mjs';
import { createVmAgentStateStore } from '../src/state-store.mjs';

const clock = new Date('2026-09-19T04:00:00.000Z');
const desired = (patch = {}) => ({
  schemaVersion: 1,
  generation: 1,
  operation: 'deploy',
  issuedAt: '2026-09-19T03:59:00.000Z',
  expiresAt: '2026-09-19T04:09:00.000Z',
  installationKey: 'customer-a',
  hostRef: 'gce://customer-project/asia-east1-b/worker-1',
  serviceKey: 'account-worker',
  revision: 'account-worker-00001',
  image: { uri: `asia-east1-docker.pkg.dev/customer-project/stratexec/account-worker@sha256:${'a'.repeat(64)}`, digest: `sha256:${'a'.repeat(64)}` },
  runtime: { containerName: 'account-worker', runAsUser: '10001:10001', readOnlyRootFilesystem: true, restartPolicy: 'unless-stopped', environmentFile: '/var/lib/stratexec/account-worker/runtime.env' },
  data: { mountPath: '/var/lib/stratexec/account-worker', minimumFreeBytes: 2_147_483_648, backupRequired: true, backupMaxAgeSeconds: 3600 },
  account: { scope: 'shioaji:person-a:futures-1', lockPath: '/var/lib/stratexec/account-worker/account.lock' },
  bindings: { configuration: [], secrets: [] },
  preflight: {
    allowedSqliteSchemaVersions: [3], expectedOpenOrders: 0, expectedPositionFingerprint: 'b'.repeat(64),
    requireReconciliation: true, requireAgentLease: true, requireBackup: true,
  },
  trading: { mode: 'disabled', activationRequired: true },
  ...patch,
});
const safeSnapshot = () => ({
  vm: { bootstrapped: true, identityVerified: true, diskFreeBytes: 5_000_000_000 },
  agent: { connected: true, mtls: true, leaseValid: true, leaseExpiresAt: '2026-09-19T04:05:00.000Z' },
  worker: {
    instanceCount: 1, accountScope: 'shioaji:person-a:futures-1', sqliteSchemaVersion: 3,
    lock: { held: true, accountScope: 'shioaji:person-a:futures-1' }, openOrders: 0,
    positionFingerprint: 'b'.repeat(64), externalExposure: false,
  },
  reconciliation: { consistent: true, unknownWrites: 0 },
  data: { backup: { verified: true, verifiedAt: '2026-09-19T03:50:00.000Z' } },
  strategy: { state: 'stopped' },
});

function signingFixture() {
  const pair = generateKeyPairSync('ed25519');
  const verifier = createDesiredStateVerifier({
    keys: [{ keyId: 'deployment-control', status: 'trusted', publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }) }],
    now: () => clock,
  });
  const envelope = (state) => ({
    desiredState: state,
    signature: {
      algorithm: 'Ed25519', keyId: 'deployment-control',
      value: sign(null, Buffer.from(`stratexec-vm-desired-state-v1\0${canonicalJson(state)}`), pair.privateKey).toString('base64'),
    },
  });
  return { verifier, envelope };
}

test('accepts only a trusted signed declarative state and never trading activation', () => {
  const { verifier, envelope } = signingFixture();
  assert.equal(verifier.verify(envelope(desired())).revision, 'account-worker-00001');
  const tampered = envelope(desired());
  tampered.desiredState.revision = 'tampered';
  assert.throws(() => verifier.verify(tampered), /verification failed/);
  assert.throws(() => verifier.verify(envelope(desired({ trading: { mode: 'live', activationRequired: false } }))), /cannot authorize PAPER or LIVE/);
  assert.throws(() => verifier.verify(envelope({ ...desired(), command: 'docker run anything' })), /never accepts shell instructions/);
});

test('fails closed on external exposure, UNKNOWN writes or stale agent lease', () => {
  const snapshot = safeSnapshot();
  snapshot.worker.externalExposure = true;
  snapshot.reconciliation.unknownWrites = 1;
  snapshot.agent.leaseValid = false;
  const result = evaluateVmSafetyPreflight(desired(), snapshot, clock);
  assert.equal(result.allowed, false);
  assert.match(result.blockers.join(' '), /external exposure/i);
  assert.match(result.blockers.join(' '), /UNKNOWN/);
  assert.match(result.blockers.join(' '), /lease/);
});

test('applies and reports VM, Agent, Worker and Strategy layers without enabling trading', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-vm-agent-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { verifier, envelope } = signingFixture();
  const runtime = {
    mode: 'fixture',
    inspect: async () => safeSnapshot(),
    prepareBindings: async () => undefined,
    stage: async () => ({ imageDigest: 'a'.repeat(64) }),
    activate: async () => ({ revision: 'account-worker-00001', layers: { vm: 'ready', worker: 'ready' } }),
    reconcile: async () => ({ outcome: 'succeeded', layers: { vm: 'ready', agent: 'ready', worker: 'ready', strategy: 'disabled' } }),
  };
  const service = createVmAgentService({ verifier, store: createVmAgentStateStore({ stateRoot: root }), runtime, now: () => clock });
  const app = createVmAgentApp({ service });
  const unauthorized = await app({ method: 'GET', url: '/api/vm-agent/v1/state', peerAuthorized: false });
  assert.equal(unauthorized.status, 401);
  const result = await app({
    method: 'PUT', url: '/api/vm-agent/v1/desired-state', peerAuthorized: true,
    body: Buffer.from(JSON.stringify(envelope(desired()))),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.current.layers, { vm: 'ready', agent: 'ready', worker: 'ready', strategy: 'disabled' });
  assert.equal(result.body.current.tradingEnabled, false);
  assert.equal(result.body.status, 'ready');
});
