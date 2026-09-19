import assert from 'node:assert/strict';
import test from 'node:test';
import { bearerToken, createIdentityDeploymentAuthorizer } from '../src/authorizer.mjs';

test('requires an active verified administrator and server-side App access', async () => {
  const requests = [];
  const authorize = createIdentityDeploymentAuthorizer({
    baseUrl: 'http://127.0.0.1:8180',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const body = url.endsWith('/api/identity/v1/me')
        ? { uid: 'admin-1', email: 'admin@example.com', role: 'admin', status: 'active', emailVerified: true }
        : { appKey: 'quotes', allowed: true, reason: 'active_admin_app_manager', permissions: ['deployment:manage'] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const actor = await authorize('firebase-token', 'quotes');
  assert.deepEqual(actor.permissions, ['deployment:manage', 'app:quotes:access']);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].init.headers.Authorization, 'Bearer firebase-token');
  assert.equal(bearerToken({ authorization: 'Bearer firebase-token' }), 'firebase-token');
});

test('fails closed for a member, denied App, missing token or unavailable Identity API', async () => {
  const member = createIdentityDeploymentAuthorizer({
    baseUrl: 'https://identity.example',
    fetchImpl: async () => new Response(JSON.stringify({
      uid: 'member-1', email: 'member@example.com', role: 'member', status: 'active', emailVerified: true,
    }), { status: 200 }),
  });
  await assert.rejects(() => member('token'), (error) => error.status === 403);

  let call = 0;
  const denied = createIdentityDeploymentAuthorizer({
    baseUrl: 'https://identity.example',
    fetchImpl: async () => new Response(JSON.stringify(++call === 1
      ? { uid: 'admin-1', email: 'admin@example.com', role: 'admin', status: 'active', emailVerified: true }
      : { appKey: 'quotes', allowed: false }), { status: 200 }),
  });
  await assert.rejects(() => denied('token', 'quotes'), (error) => error.status === 403);

  const unavailable = createIdentityDeploymentAuthorizer({
    baseUrl: 'https://identity.example', fetchImpl: async () => { throw new Error('offline'); },
  });
  await assert.rejects(() => unavailable('token'), (error) => error.status === 503);
  assert.throws(() => bearerToken({}), (error) => error.status === 401);
});
