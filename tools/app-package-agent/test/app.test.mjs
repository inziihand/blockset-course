import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPackageAgentApp } from '../src/app.mjs';

const actor = { uid: 'admin-1', email: 'admin@example.com' };
const sampleJob = {
  jobId: '00000000-0000-4000-8000-000000000000',
  status: 'ready',
  appKey: 'demo',
  version: '1.0.0',
  confirmation: 'demo@1.0.0',
};

test('requires administrator authentication for every package route', async () => {
  const app = createPackageAgentApp({
    jobs: { policy: () => ({}), listJobs: async () => [] },
    authorizeAdmin: async () => { throw Object.assign(new Error('denied'), { name: 'AdminAuthorizationError', status: 403 }); },
  });
  const response = await app({ method: 'GET', url: '/api/app-packages/v1/jobs', headers: {} });
  assert.equal(response.status, 401);
});

test('creates inspect jobs and applies them through the authenticated API', async () => {
  const calls = [];
  const app = createPackageAgentApp({
    jobs: {
      policy: () => ({ allowUnsignedApply: true }),
      listJobs: async () => [sampleJob],
      inspect: async (input) => { calls.push(['inspect', input]); return sampleJob; },
      planDeployment: async (input) => {
        calls.push(['planDeployment', input]);
        return { jobId: sampleJob.jobId, mode: 'read-only', decision: 'reviewable' };
      },
      apply: async (input) => { calls.push(['apply', input]); return { ...sampleJob, status: 'succeeded' }; },
      activateSource: async (input) => { calls.push(['activateSource', input]); return { ...sampleJob, status: 'succeeded' }; },
    },
    authorizeAdmin: async (token) => { assert.equal(token, 'firebase-token'); return actor; },
  });
  const inspect = await app({
    method: 'POST',
    url: '/api/app-packages/v1/inspect?adoptExisting=true',
    headers: { authorization: 'Bearer firebase-token', 'x-stratexec-package-name': 'demo.zip' },
    body: Buffer.from('zip'),
  });
  assert.equal(inspect.status, 201);
  assert.equal(calls[0][1].adoptExisting, true);
  assert.deepEqual(calls[0][1].actor, actor);

  const plan = await app({
    method: 'GET',
    url: `/api/app-packages/v1/jobs/${sampleJob.jobId}/deployment-plan?installationKey=customer-a`,
    headers: { authorization: 'Bearer firebase-token' },
  });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.mode, 'read-only');
  assert.equal(calls[1][1].installationKey, 'customer-a');

  const applied = await app({
    method: 'POST',
    url: `/api/app-packages/v1/jobs/${sampleJob.jobId}/apply`,
    headers: { authorization: 'Bearer firebase-token' },
    body: Buffer.from(JSON.stringify({ confirmation: 'demo@1.0.0' })),
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.status, 'succeeded');
  assert.equal(calls[2][1].token, 'firebase-token');

  const activated = await app({
    method: 'POST',
    url: `/api/app-packages/v1/jobs/${sampleJob.jobId}/source-activation`,
    headers: { authorization: 'Bearer firebase-token' },
    body: Buffer.from('{}'),
  });
  assert.equal(activated.status, 200);
  assert.equal(calls[3][0], 'activateSource');
});

test('publishes an OpenAPI contract for package and read-only deployment-plan routes', async () => {
  const contract = JSON.parse(await readFile(new URL('../../../contracts/app-packages/openapi.json', import.meta.url), 'utf8'));
  assert.match(contract.openapi, /^3\./);
  assert.ok(contract.paths['/api/app-packages/v1/inspect'].post);
  assert.ok(contract.paths['/api/app-packages/v1/jobs/{jobId}/deployment-plan'].get);
  assert.deepEqual(contract.paths['/api/app-packages/v1/jobs/{jobId}/deployment-plan'].get.security, [{ firebaseIdToken: [] }]);
  assert.ok(contract.paths['/api/app-packages/v1/jobs/{jobId}/apply'].post);
  assert.deepEqual(contract.paths['/api/app-packages/v1/jobs/{jobId}/apply'].post.security, [{ firebaseIdToken: [] }]);
  assert.ok(contract.paths['/api/app-packages/v1/jobs/{jobId}/source-activation'].post);
  assert.deepEqual(contract.paths['/api/app-packages/v1/jobs/{jobId}/source-activation'].post.security, [{ firebaseIdToken: [] }]);
});
