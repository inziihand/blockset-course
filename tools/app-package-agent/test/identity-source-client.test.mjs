import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdentitySourceClient } from '../src/identity-source-client.mjs';

test('forwards a transient administrator token to source App activation', async () => {
  let request;
  const client = createIdentitySourceClient({
    baseUrl: 'http://127.0.0.1:8180',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ appKey: 'fixture-lab', status: 'installed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const activation = { displayName: '選擇權策略分析', allowedAccessModes: ['grant_required'] };
  const result = await client.activate({ appKey: 'fixture-lab', token: 'firebase-token', activation });

  assert.equal(result.status, 'installed');
  assert.equal(request.url, 'http://127.0.0.1:8180/api/identity/v1/admin/app-installations/fixture-lab/source-activation');
  assert.equal(request.init.headers.Authorization, 'Bearer firebase-token');
  assert.deepEqual(JSON.parse(request.init.body), activation);
});
