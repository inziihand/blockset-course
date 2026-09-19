import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDeploymentAgentApp } from '../src/app.mjs';

const jobId = '10000000-0000-4000-8000-000000000000';
const job = { jobId, appKey: 'quotes', status: 'awaiting-approval' };

test('authenticates deployment permission and target App access for every job action', async () => {
  const calls = [];
  const jobs = {
    policy: () => ({ executorMode: 'fixture' }),
    listJobs: async () => [job],
    getJob: async () => job,
    inspect: async (input) => { calls.push(['inspect', input]); return job; },
    plan: async (input) => { calls.push(['plan', input]); return job; },
    approve: async (input) => { calls.push(['approve', input]); return { ...job, status: 'approved' }; },
    apply: async (input) => { calls.push(['apply', input]); return { ...job, status: 'applied' }; },
    verify: async (input) => { calls.push(['verify', input]); return { ...job, status: 'verified' }; },
    promote: async (input) => { calls.push(['promote', input]); return { ...job, status: 'verified' }; },
    rollback: async (input) => { calls.push(['rollback', input]); return { ...job, status: 'rolled-back' }; },
    reconcile: async (input) => { calls.push(['reconcile', input]); return job; },
    cancel: async (input) => { calls.push(['cancel', input]); return { ...job, status: 'cancelled' }; },
    activate: async (input) => { calls.push(['activate', input]); return { ...job, status: 'verified' }; },
    events: async () => [{ sequence: 1 }],
    evidence: async () => ({ jobId, events: [] }),
  };
  const authorizations = [];
  const app = createDeploymentAgentApp({
    jobs,
    authorizeDeployment: async (token, appKey) => {
      authorizations.push({ token, appKey });
      return {
        uid: 'admin-1', email: 'admin@example.com',
        permissions: ['deployment:manage', ...(appKey ? [`app:${appKey}:access`] : [])],
      };
    },
  });
  const headers = { authorization: 'Bearer firebase-token' };
  const inspected = await app({
    method: 'POST', url: '/api/deployments/v1/inspect', headers,
    body: Buffer.from(JSON.stringify({ packageJobId: jobId, installationKey: 'customer-a', appKey: 'quotes' })),
  });
  assert.equal(inspected.status, 201);
  assert.equal(authorizations.at(-1).appKey, 'quotes');

  for (const action of ['plan', 'approve', 'apply', 'verify', 'promote', 'rollback', 'reconcile', 'cancel', 'activate']) {
    const result = await app({
      method: 'POST', url: `/api/deployments/v1/jobs/${jobId}/${action}`, headers,
      body: Buffer.from(action === 'approve' ? '{}' : ['promote', 'rollback', 'activate'].includes(action) ? '{"confirmation":"value"}' : ''),
    });
    assert.equal(result.status, 200, action);
  }
  assert.ok(calls.some(([name]) => name === 'apply'));
  assert.ok(authorizations.filter((item) => item.appKey === 'quotes').length >= 7);
});

test('returns JSON 401 before reading a deployment job', async () => {
  let read = false;
  const app = createDeploymentAgentApp({
    jobs: { policy: () => ({}), getJob: async () => { read = true; return job; } },
    authorizeDeployment: async () => { throw Object.assign(new Error('denied'), { name: 'DeploymentAuthorizationError', status: 401 }); },
  });
  const result = await app({ method: 'GET', url: `/api/deployments/v1/jobs/${jobId}` });
  assert.equal(result.status, 401);
  assert.equal(read, false);
  assert.match(result.headers['Content-Type'], /application\/json/);
});

test('publishes secured inspect through verified activation contracts', async () => {
  const contract = JSON.parse(await readFile(new URL('../../../contracts/deployments/openapi.json', import.meta.url), 'utf8'));
  assert.match(contract.openapi, /^3\./);
  for (const path of [
    '/api/deployments/v1/inspect',
    '/api/deployments/v1/jobs/{jobId}/plan',
    '/api/deployments/v1/jobs/{jobId}/approve',
    '/api/deployments/v1/jobs/{jobId}/apply',
    '/api/deployments/v1/jobs/{jobId}/verify',
    '/api/deployments/v1/jobs/{jobId}/promote',
    '/api/deployments/v1/jobs/{jobId}/rollback',
    '/api/deployments/v1/jobs/{jobId}/cancel',
    '/api/deployments/v1/jobs/{jobId}/activate',
  ]) {
    assert.deepEqual(contract.paths[path].post.security, [{ firebaseIdToken: [] }], path);
  }
  assert.deepEqual(
    contract.paths['/api/deployments/v1/installations/{installationKey}/apps/{appKey}/settings'].get.security,
    [{ firebaseIdToken: [] }],
  );
  const secretInput = contract.paths['/api/deployments/v1/installations/{installationKey}/apps/{appKey}/settings/services/{serviceKey}/secrets/{environment}/versions']
    .post.requestBody.content['application/json'].schema.properties.secretValue;
  assert.equal(secretInput.writeOnly, true);
});

test('protects schema-driven settings and passes secret payload only to the secret service', async () => {
  const secretValues = [];
  const settings = {
    getAppSettings: async ({ appKey }) => ({ schemaVersion: 1, scope: 'app', appKey, services: [] }),
    getPlatformSettings: async () => ({ schemaVersion: 1, scope: 'platform', appKey: 'platform', services: [] }),
    createSecretVersion: async ({ secretValue }) => {
      secretValues.push(secretValue);
      return { secretResource: 'projects/customer-a/secrets/key', version: '2', state: 'ENABLED' };
    },
  };
  const authorizations = [];
  const app = createDeploymentAgentApp({
    jobs: { policy: () => ({}), listJobs: async () => [] },
    settings,
    authorizeDeployment: async (token, appKey) => {
      authorizations.push({ token, appKey });
      return { uid: 'admin-1', email: 'admin@example.com', permissions: ['deployment:manage', ...(appKey ? [`app:${appKey}:access`] : [])] };
    },
  });
  const headers = { authorization: 'Bearer firebase-token' };
  const described = await app({
    method: 'GET', url: '/api/deployments/v1/installations/customer-a/apps/course-app/settings', headers,
  });
  assert.equal(described.status, 200);
  assert.equal(authorizations.at(-1).appKey, 'course-app');
  const created = await app({
    method: 'POST',
    url: '/api/deployments/v1/installations/customer-a/apps/course-app/settings/services/course-api/secrets/COURSE_API_KEY/versions',
    headers,
    body: Buffer.from(JSON.stringify({ secretValue: 'browser-only-secret' })),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(secretValues, ['browser-only-secret']);
  assert.equal(JSON.stringify(created.body).includes('browser-only-secret'), false);
});
