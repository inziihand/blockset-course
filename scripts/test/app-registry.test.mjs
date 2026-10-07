import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateAppRegistrySource } from '../lib/app-registry.mjs';

const schema = JSON.parse(await readFile(new URL('../../infrastructure/app-manifest.schema.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../../infrastructure/apps/access-control.json', import.meta.url), 'utf8'));
const frontendSchema = schema.properties.frontend;

test('keep-alive is optional and defaults to the original unmount policy', () => {
  const app = structuredClone(manifest);
  delete app.frontend.keepAlive;
  assert.ok(!frontendSchema.required.includes('keepAlive'));
  assert.doesNotMatch(generateAppRegistrySource([app]), /keepAlive:/);
});

test('the manifest schema and generated Registry preserve explicit keep-alive policies', () => {
  assert.deepEqual(frontendSchema.properties.keepAlive, { type: 'boolean' });
  for (const enabled of [true, false]) {
    const app = structuredClone(manifest);
    app.frontend.keepAlive = enabled;
    assert.match(generateAppRegistrySource([app]), new RegExp(`keepAlive: ${enabled},`));
  }
});

test('invalid keep-alive policies cannot enter the generated Registry', () => {
  for (const invalid of ['true', 1, null, {}]) {
    const app = structuredClone(manifest);
    app.frontend.keepAlive = invalid;
    assert.throws(() => generateAppRegistrySource([app]), /Invalid App keepAlive policy/);
  }
});
