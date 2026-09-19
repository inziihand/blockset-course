import assert from 'node:assert/strict';
import test from 'node:test';
import { createGcpSecretResolver } from '../src/gcp-secret-resolver.mjs';

test('reads only a concrete Secret Manager version and returns a wipeable buffer', async () => {
  const calls = [];
  const resolver = createGcpSecretResolver({
    request: async (input) => {
      calls.push(input);
      return { payload: { data: Buffer.from('secret-value').toString('base64') } };
    },
  });
  const value = await resolver.access('projects/customer-project/secrets/worker-token/versions/7');
  assert.equal(value.toString('utf8'), 'secret-value');
  assert.match(calls[0].url, /versions\/7:access$/);
  value.fill(0);
  assert.equal(value.every((item) => item === 0), true);
  await assert.rejects(() => resolver.access('projects/customer-project/secrets/worker-token/versions/latest'), /concrete/);
});
