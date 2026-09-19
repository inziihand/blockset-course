import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdentityLifecycleClient, IdentityLifecycleError } from '../src/identity-lifecycle-client.mjs';

test('forwards verified activation with a transient administrator token', async () => {
  const calls = [];
  const client = createIdentityLifecycleClient({
    baseUrl: 'http://127.0.0.1:8180',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ appKey: 'quotes', status: 'installed', runtimeRevision: 'quotes-1' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  const activation = {
    displayName: 'Quotes', requiredServices: ['quotes-api'], deploymentJobId: 'job-id',
    planFingerprint: 'a'.repeat(64), runtimeRevision: 'quotes-1', verifiedAt: '2026-09-19T00:00:00Z',
  };
  const result = await client.activate({ appKey: 'quotes', token: 'firebase-token', activation });
  assert.equal(result.status, 'installed');
  assert.equal(calls[0].url, 'http://127.0.0.1:8180/api/identity/v1/admin/app-installations/quotes/verified-activation');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer firebase-token');
  assert.deepEqual(JSON.parse(calls[0].init.body), activation);
  assert.equal(JSON.stringify(result).includes('firebase-token'), false);
});

test('fails closed when Identity rejects verified activation', async () => {
  const client = createIdentityLifecycleClient({
    fetchImpl: async () => new Response(JSON.stringify({ detail: 'verification rejected' }), {
      status: 409, headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(
    () => client.activate({ appKey: 'quotes', token: 'token', activation: {} }),
    (error) => error instanceof IdentityLifecycleError && error.status === 409 && /verification rejected/.test(error.message),
  );
});
