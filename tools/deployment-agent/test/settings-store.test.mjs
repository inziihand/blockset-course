import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDeploymentSettingsStore } from '../src/settings-store.mjs';

test('persists ordinary settings and secret references without secret payload fields', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createDeploymentSettingsStore({ stateRoot: root });
  await store.update('customer-a', 'course-app', (draft) => {
    draft.configuration['api:TIMEOUT_MS'] = { configuredValue: 5000, updatedAt: 'now', updatedBy: { uid: 'a', email: 'a@example.com' } };
    draft.secretReferences['api:API_KEY'] = {
      secretResource: 'projects/customer-a-project/secrets/key', version: '3', state: 'ENABLED',
      updatedAt: 'now', updatedBy: { uid: 'a', email: 'a@example.com' },
    };
    return draft;
  });
  const state = await store.read('customer-a', 'course-app');
  assert.equal(state.configuration['api:TIMEOUT_MS'].configuredValue, 5000);
  assert.equal(state.secretReferences['api:API_KEY'].version, '3');
  const raw = await readFile(join(root, 'settings', 'customer-a', 'course-app.json'), 'utf8');
  assert.doesNotMatch(raw, /secretValue|private_key|Bearer /i);
});

test('rejects sensitive payload fields before writing local state', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createDeploymentSettingsStore({ stateRoot: root });
  await assert.rejects(() => store.update('customer-a', 'course-app', (draft) => {
    draft.secretReferences.bad = { secretValue: 'must-not-persist' };
    return draft;
  }), /Sensitive field cannot be persisted/);
});
