import assert from 'node:assert/strict';
import test from 'node:test';
import { appSecretIdentity, createGcpSecretManager } from '../src/secret-manager.mjs';

test('derives installation and App scoped secret resources', () => {
  const identity = appSecretIdentity({
    projectId: 'customer-a-project', installationKey: 'customer-a', appKey: 'course-app',
    serviceKey: 'course-api', environment: 'COURSE_API_KEY', secretName: 'course-key',
  });
  assert.equal(identity.resource, 'projects/customer-a-project/secrets/stratexec-customer-a-course-app-course-api-course-key');
  assert.equal(identity.labels['stratexec-app'], 'course-app');
  assert.equal(identity.labels['stratexec-environment'], 'course-api-key');
});

test('creates a Secret Manager version without returning or retaining plaintext', async () => {
  const calls = [];
  const manager = createGcpSecretManager({ request: async (input) => {
    calls.push(structuredClone(input));
    if (input.method === 'GET') throw Object.assign(new Error('missing'), { status: 404 });
    if (input.url.includes(':addVersion')) {
      return { name: 'projects/customer-a-project/secrets/app-key/versions/7', state: 'ENABLED', createTime: '2026-09-18T00:00:00Z' };
    }
    return { name: 'projects/customer-a-project/secrets/app-key' };
  } });
  const bytes = Buffer.from('top-secret-value');
  const result = await manager.createVersion({
    projectId: 'customer-a-project',
    resource: 'projects/customer-a-project/secrets/app-key',
    labels: { 'stratexec-app': 'course-app' },
    secretBytes: bytes,
  });
  assert.deepEqual(result, {
    resource: 'projects/customer-a-project/secrets/app-key', version: '7', state: 'ENABLED',
    createTime: '2026-09-18T00:00:00Z', destroyTime: null, etag: null,
  });
  assert.equal(bytes.every((byte) => byte === 0), true);
  assert.equal(JSON.stringify(result).includes('top-secret-value'), false);
  assert.equal(calls.some((call) => call.url.includes(':addVersion')), true);
});

test('wipes the caller buffer when Secret Manager rejects the write', async () => {
  const secretBytes = Buffer.from('must-not-survive');
  const manager = createGcpSecretManager({
    request: async () => { throw Object.assign(new Error('denied'), { status: 403 }); },
  });
  await assert.rejects(() => manager.createVersion({
    projectId: 'customer-project',
    resource: 'projects/customer-project/secrets/stratexec-customer-a-course-api-key',
    labels: {},
    secretBytes,
  }), /Secret Manager operation failed/);
  assert.deepEqual([...secretBytes], new Array(secretBytes.length).fill(0));
});
