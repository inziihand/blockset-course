import assert from 'node:assert/strict';
import test from 'node:test';
import { createVmDockerDeploymentExecutor } from '../src/vm-docker-executor.mjs';

const imageDigest = 'a'.repeat(64);
const previousDigest = 'b'.repeat(64);
const service = {
  serviceKey: 'account-worker', selectedTarget: 'vm-docker', serviceName: 'account-worker',
  artifact: { context: 'services/account-worker', dockerfile: 'services/account-worker/Dockerfile' },
  vm: {
    hostRef: 'gce://customer-project/asia-east1-b/worker-1', agentUrl: 'https://10.0.0.2:8443',
    persistentDataPath: '/var/lib/stratexec/account-worker', accountScope: 'shioaji:person-a:futures-1',
    containerName: 'account-worker', runAsUser: '10001:10001', minimumFreeBytes: 2_147_483_648,
    backupMaxAgeSeconds: 3600, allowedSqliteSchemaVersions: [3], expectedOpenOrders: 0,
    expectedPositionFingerprint: 'c'.repeat(64),
  },
};
const context = {
  installation: { installationKey: 'customer-a', projectId: 'customer-project', region: 'asia-east1' },
  services: [service], runtimeBindings: { configuration: [], secrets: [] }, requirements: { configuration: [], secrets: [] },
};

test('publishes a signed immutable desired state and keeps trading disabled', async () => {
  let submitted;
  const state = {
    schemaVersion: 1, generation: 8, status: 'ready',
    current: {
      revision: 'account-worker-aaaaaaaaaaaa', imageDigest, image: `repo/worker@sha256:${imageDigest}`,
      layers: { vm: 'ready', agent: 'ready', worker: 'ready', strategy: 'disabled' }, tradingEnabled: false,
    },
  };
  const before = {
    generation: 7, status: 'ready',
    current: { revision: 'account-worker-old', imageDigest: previousDigest, image: `repo/worker@sha256:${previousDigest}` },
  };
  let currentState = before;
  const client = {
    state: async () => currentState,
    apply: async (envelope) => { submitted = envelope; currentState = state; return state; },
    reconcile: async () => state,
  };
  const executor = createVmDockerDeploymentExecutor({
    sourceProvider: { prepare: async () => ({ archive: Buffer.from('source') }) },
    imageBuilder: async () => ({ image: `repo/worker@sha256:${imageDigest}`, imageDigest }),
    signer: { sign: async (desiredState) => ({ desiredState, signature: { algorithm: 'Ed25519', keyId: 'test', value: 'signature' } }) },
    clientForService: () => client,
    policy: { cloudRun: { artifactRepository: 'stratexec' } },
  });
  const applied = await executor.apply(context);
  assert.equal(applied.outcome, 'succeeded');
  assert.equal(submitted.desiredState.image.digest, `sha256:${imageDigest}`);
  assert.equal(submitted.desiredState.trading.mode, 'disabled');
  assert.equal(submitted.desiredState.generation, 8);
  assert.equal(applied.services[0].runtimeStatus.strategy, 'disabled');
  assert.equal(applied.services[0].runtimeStatus.tradingEnabled, false);

  const verified = await executor.verify(context);
  assert.equal(verified.outcome, 'succeeded');
  assert.match(verified.message, /trading remain disabled/i);
});

test('rolls back only to the reviewed prior immutable image', async () => {
  let submitted;
  const client = {
    state: async () => ({ generation: 9, current: { revision: 'current', imageDigest, image: `repo/worker@sha256:${imageDigest}` } }),
    apply: async (envelope) => {
      submitted = envelope;
      return {
        generation: 10, status: 'ready', current: {
          revision: 'account-worker-old', imageDigest: previousDigest, image: `repo/worker@sha256:${previousDigest}`,
          layers: { vm: 'ready', agent: 'ready', worker: 'ready', strategy: 'disabled' }, tradingEnabled: false,
        },
      };
    },
  };
  const executor = createVmDockerDeploymentExecutor({
    sourceProvider: { prepare: async () => ({ archive: Buffer.alloc(0) }) }, imageBuilder: async () => ({}),
    signer: { sign: async (desiredState) => ({ desiredState, signature: {} }) }, clientForService: () => client,
    policy: { cloudRun: { artifactRepository: 'stratexec' } },
  });
  const rolledBack = await executor.rollback({
    ...context,
    priorRuntime: { services: [{ previousRevision: 'account-worker-old', previousImage: `repo/worker@sha256:${previousDigest}`, previousImageDigest: previousDigest }] },
  });
  assert.equal(rolledBack.outcome, 'succeeded');
  assert.equal(submitted.desiredState.operation, 'rollback');
  assert.equal(submitted.desiredState.revision, 'account-worker-old');
  assert.equal(submitted.desiredState.image.digest, `sha256:${previousDigest}`);
});
