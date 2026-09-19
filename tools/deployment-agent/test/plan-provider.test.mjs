import assert from 'node:assert/strict';
import test from 'node:test';
import { createPackageAgentPlanProvider } from '../src/plan-provider.mjs';

test('reads a normalized plan from Package Agent without persisting the Firebase token', async () => {
  let request;
  const provider = createPackageAgentPlanProvider({
    baseUrl: 'http://127.0.0.1:8182',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        jobId: '00000000-0000-4000-8000-000000000000',
        mode: 'read-only',
        planKind: 'app-runtime-impact',
        planFingerprint: 'a'.repeat(64),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const plan = await provider({
    packageJobId: '00000000-0000-4000-8000-000000000000', installationKey: 'customer-a', token: 'firebase-token',
  });
  assert.equal(plan.mode, 'read-only');
  assert.match(request.url, /installationKey=customer-a/);
  assert.equal(request.init.headers.Authorization, 'Bearer firebase-token');
  assert.equal(JSON.stringify(plan).includes('firebase-token'), false);
});
