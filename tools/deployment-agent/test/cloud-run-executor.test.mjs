import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudRunDeploymentExecutor } from '../src/cloud-run-executor.mjs';

const digest = 'c'.repeat(64);
const context = {
  jobId: '00000000-0000-4000-8000-000000000000',
  idempotencyKey: 'd'.repeat(64),
  planFingerprint: 'e'.repeat(64),
  installation: { installationKey: 'customer-a', projectId: 'customer-project', region: 'asia-east1' },
  package: { appKey: 'sample-backend-app', version: '1.0.0', packageSha256: 'a'.repeat(64) },
  services: [{
    serviceKey: 'sample-api', dependsOn: ['identity-api'], routes: ['/api/sample/v1/**'],
    artifact: { context: 'services/sample-api', dockerfile: 'services/sample-api/Dockerfile' },
    healthPath: '/health/live', readinessPath: '/health/ready', verification: {
      unauthenticatedRequests: [{ method: 'GET', path: '/api/sample/v1/items', expectedStatus: 401 }],
      authenticatedRequests: [{ method: 'GET', path: '/api/sample/v1/items', expectedStatus: 200, audience: 'active-member' }],
    }, selectedTarget: 'cloud-run-service', region: 'asia-east1', serviceName: 'customer-market-data',
    resources: { cpu: '1', memory: '256Mi', minInstances: 0, maxInstances: 1, concurrency: 20, timeoutSeconds: 30 },
    publicIngress: true, ingress: 'all', costTier: 'low-variable',
  }],
  changes: { services: [], routes: [], secretReferences: [], cloudResources: [] },
  requirements: {
    configuration: [
      { serviceKey: 'sample-api', name: 'GOOGLE_CLOUD_PROJECT', source: 'project-id' },
      { serviceKey: 'sample-api', name: 'STRATEXEC_IDENTITY_BASE_URL', source: 'service-url', dependency: { serviceKey: 'identity-api', region: 'asia-east1', serviceName: 'customer-identity' } },
      { serviceKey: 'sample-api', name: 'STRATEXEC_SAMPLE_CACHE_TTL_MS', source: 'operator-input' },
    ],
    secrets: [], runtimeServiceAccountRoles: [],
  },
  runtimeBindings: {
    stateRevision: 1, bindingsFingerprint: 'f'.repeat(64),
    configuration: [{ serviceKey: 'sample-api', environment: 'STRATEXEC_SAMPLE_CACHE_TTL_MS', source: 'operator-input', configuredValue: 15000 }],
    secrets: [],
  },
  migrations: [], priorRuntime: null, priorVerification: null,
};

function fixture({ failAuthenticated = false } = {}) {
  const calls = [];
  const control = {
    async buildImmutableImage({ source, builderRoles }) { calls.push('build'); assert.ok(source.archive.byteLength); assert.deepEqual(builderRoles, ['roles/artifactregistry.writer']); return { buildId: 'build-1', imageDigest: digest, image: `asia-docker.pkg.dev/p/r/i@sha256:${digest}` }; },
    async ensureRuntimeIdentity() { calls.push('identity'); return { email: 'runtime@customer-project.iam.gserviceaccount.com' }; },
    async resolveServiceUrl() { calls.push('dependency'); return 'https://identity.example.test'; },
    async deployCandidate(input) {
      calls.push('deploy');
      assert.equal(input.noProductionTraffic, true);
      assert.ok(input.configuration.some((item) => item.name === 'STRATEXEC_IDENTITY_BASE_URL' && item.value === 'https://identity.example.test'));
      return { revision: 'customer-market-data-candidate', serviceUrl: 'https://service.example.test', candidateUrl: 'https://candidate.example.test', previousRevision: 'customer-market-data-old', previousTraffic: [{ revision: 'customer-market-data-old', percent: 100 }] };
    },
    async verifyRequest(input) {
      calls.push(input.token ? 'authenticated-check' : input.requireJsonError ? 'unauthorized-check' : 'health-check');
      if (input.token && failAuthenticated) throw new Error('verification failed');
      return { status: input.expectedStatus };
    },
    async promoteCandidate() { calls.push('promote'); return { serviceUrl: 'https://service.example.test', promotedAt: '2026-09-19T00:00:00.000Z' }; },
    async deployHostingRoutes() { calls.push('hosting'); return { site: 'customer-project', version: 'sites/customer/versions/2', release: 'release-2', url: 'https://customer-project.web.app', releasedAt: '2026-09-19T00:00:00.000Z' }; },
    async restoreTraffic() { calls.push('restore'); return { revision: 'customer-market-data-old', serviceUrl: 'https://service.example.test', revisionUrl: 'https://old.example.test', rolledBackAt: '2026-09-19T00:00:00.000Z' }; },
    async reconcile() { return null; },
  };
  const sourceProvider = { async prepare() { return { archive: Buffer.from('archive'), archiveSha256: '1'.repeat(64), fileCount: 2 }; } };
  return { calls, executor: createCloudRunDeploymentExecutor({ control, sourceProvider, policy: { cloudRun: {
    artifactRepository: 'stratexec', builderServiceAccountRoles: ['roles/artifactregistry.writer'],
  } } }) };
}

test('stages, verifies and explicitly promotes a sample backend App without early Hosting traffic', async () => {
  const { calls, executor } = fixture();
  const applied = await executor.apply(context);
  assert.equal(applied.outcome, 'succeeded');
  assert.equal(applied.services[0].previousRevision, 'customer-market-data-old');
  assert.ok(calls.indexOf('unauthorized-check') < calls.indexOf('authenticated-check') || !calls.includes('authenticated-check'));
  assert.equal(calls.includes('promote'), false);
  assert.equal(calls.includes('hosting'), false);

  const verified = await executor.verify({ ...context, priorRuntime: applied, verificationToken: 'transient-id-token' });
  assert.equal(verified.services[0].authenticatedChecks[0].status, 200);
  assert.equal(calls.includes('promote'), false);

  const promoted = await executor.promote({ ...context, priorRuntime: applied, priorVerification: verified });
  assert.equal(promoted.hosting.url, 'https://customer-project.web.app');
  assert.ok(calls.indexOf('promote') < calls.indexOf('hosting'));
});

test('keeps prior traffic when staged verification fails and supports explicit rollback', async () => {
  const { calls, executor } = fixture({ failAuthenticated: true });
  const applied = await executor.apply(context);
  await assert.rejects(() => executor.verify({ ...context, priorRuntime: applied, verificationToken: 'transient-id-token' }), /verification failed/);
  assert.equal(calls.includes('promote'), false);
  assert.equal(calls.includes('hosting'), false);
  const rolledBack = await executor.rollback({ ...context, priorRuntime: applied });
  assert.equal(rolledBack.services[0].revision, 'customer-market-data-old');
  assert.ok(calls.includes('restore'));
});

test('repeating the same immutable deployment keeps the same idempotency-bound build inputs', async () => {
  const { executor } = fixture();
  const first = await executor.apply(context);
  const second = await executor.apply(context);
  assert.equal(first.services[0].imageDigest, second.services[0].imageDigest);
  assert.equal(first.services[0].revision, second.services[0].revision);
});
