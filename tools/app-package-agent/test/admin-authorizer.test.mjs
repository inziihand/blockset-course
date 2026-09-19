import assert from 'node:assert/strict';
import test from 'node:test';
import { bearerToken, createIdentityAdminAuthorizer } from '../src/admin-authorizer.mjs';

test('forwards the Firebase token and accepts only an active verified administrator', async () => {
  let request;
  const authorize = createIdentityAdminAuthorizer({
    baseUrl: 'http://127.0.0.1:8180',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        uid: 'admin-1', email: 'admin@example.com', role: 'admin', status: 'active', emailVerified: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.deepEqual(await authorize('firebase-token'), { uid: 'admin-1', email: 'admin@example.com' });
  assert.equal(request.url, 'http://127.0.0.1:8180/api/identity/v1/me');
  assert.equal(request.init.headers.Authorization, 'Bearer firebase-token');
  assert.equal(bearerToken({ authorization: 'Bearer firebase-token' }), 'firebase-token');
});

test('fails closed for a member, disabled administrator or unavailable Identity API', async () => {
  for (const member of [
    { uid: 'member-1', email: 'member@example.com', role: 'member', status: 'active', emailVerified: true },
    { uid: 'admin-1', email: 'admin@example.com', role: 'admin', status: 'disabled', emailVerified: true },
  ]) {
    const authorize = createIdentityAdminAuthorizer({
      baseUrl: 'https://identity.example',
      fetchImpl: async () => new Response(JSON.stringify(member), { status: 200 }),
    });
    await assert.rejects(() => authorize('token'), (error) => error.status === 403);
  }
  const unavailable = createIdentityAdminAuthorizer({
    baseUrl: 'https://identity.example',
    fetchImpl: async () => { throw new Error('offline'); },
  });
  await assert.rejects(() => unavailable('token'), (error) => error.status === 503);
  assert.throws(() => bearerToken({}), (error) => error.status === 401);
});
