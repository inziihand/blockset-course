import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDeploymentSettingsService } from '../src/deployment-settings-service.mjs';
import { appSecretIdentity } from '../src/secret-manager.mjs';
import { createDeploymentSettingsStore } from '../src/settings-store.mjs';

const actor = { uid: 'admin-1', email: 'admin@example.com', permissions: ['deployment:manage', 'app:course-app:access'] };
const installation = {
  installationKey: 'customer-a', gcpProjectId: 'customer-a-project', region: 'asia-east1',
  auth: { oauthBrandDisplayName: 'Customer A', supportEmail: 'owner@example.com', authorizedDomains: ['example.com'] },
};
const contract = {
  schemaVersion: 1, appKey: 'course-app', appVersion: '1.0.0', services: [{
    serviceKey: 'course-api',
    configuration: [{
      name: 'RATE_LIMIT', source: 'operator-input', purpose: 'request quota',
      input: { label: 'Rate limit', type: 'integer', required: true, impact: 'high', default: 60, minimum: 10, maximum: 600 },
    }],
    secrets: [{ environment: 'COURSE_API_KEY', secretName: 'course-key', temporary: false, purpose: 'provider authentication' }],
  }],
};

function fixture(root) {
  const created = [];
  const identity = appSecretIdentity({
    projectId: installation.gcpProjectId, installationKey: installation.installationKey,
    appKey: 'course-app', serviceKey: 'course-api', environment: 'COURSE_API_KEY', secretName: 'course-key',
  });
  const secretManager = {
    mode: 'gcp-secret-manager',
    async createVersion({ resource, secretBytes }) {
      created.push(Buffer.from(secretBytes).toString('utf8'));
      return { resource, version: '5', state: 'ENABLED', createTime: '2026-09-18T00:00:00Z' };
    },
    async getSecretMetadata(resource) { return { resource, labels: identity.labels }; },
    async getVersionMetadata(resource, version) { return { resource, version: String(version), state: 'ENABLED', createTime: null }; },
    async listVersions() { return [{ version: '4', state: 'ENABLED', createTime: null }]; },
    async disableVersion(resource, version) { return { resource, version: String(version), state: 'DISABLED' }; },
    async deleteSecret(resource) { return { resource, deleted: true }; },
  };
  const service = createDeploymentSettingsService({
    store: createDeploymentSettingsStore({ stateRoot: root }), secretManager,
    installationProvider: async () => installation,
    deploymentProvider: async () => contract,
    platformServiceProvider: async () => ({ schemaVersion: 3, ownerApp: 'platform', services: [] }),
    now: () => new Date('2026-09-18T01:00:00Z'),
  });
  return { service, created };
}

test('requires confirmation for high-impact values and stores only secret metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-deployment-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { service, created } = fixture(root);
  await assert.rejects(() => service.setConfiguration({
    installationKey: 'customer-a', appKey: 'course-app', serviceKey: 'course-api', environment: 'RATE_LIMIT',
    configuredValue: 120, actor,
  }), /exact confirmation/);
  await service.setConfiguration({
    installationKey: 'customer-a', appKey: 'course-app', serviceKey: 'course-api', environment: 'RATE_LIMIT',
    configuredValue: 120, confirmation: 'SET course-app/course-api/RATE_LIMIT', actor,
  });
  const reference = await service.createSecretVersion({
    installationKey: 'customer-a', appKey: 'course-app', serviceKey: 'course-api', environment: 'COURSE_API_KEY',
    secretValue: 'never-write-this-value', actor,
  });
  assert.equal(reference.version, '5');
  assert.deepEqual(created, ['never-write-this-value']);
  const raw = await readFile(join(root, 'settings', 'customer-a', 'course-app.json'), 'utf8');
  assert.equal(raw.includes('never-write-this-value'), false);
  const bindings = await service.resolveBindings({ installationKey: 'customer-a', appKey: 'course-app', actor });
  assert.equal(bindings.blockers.length, 0);
  assert.deepEqual(bindings.secrets[0], {
    serviceKey: 'course-api', environment: 'COURSE_API_KEY',
    secretResource: reference.secretResource, version: '5',
  });
});

test('keeps existing references scoped and requires independent delete confirmation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stratexec-deployment-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { service } = fixture(root);
  const identity = appSecretIdentity({
    projectId: installation.gcpProjectId, installationKey: installation.installationKey,
    appKey: 'course-app', serviceKey: 'course-api', environment: 'COURSE_API_KEY', secretName: 'course-key',
  });
  await service.setSecretReference({
    installationKey: 'customer-a', appKey: 'course-app', serviceKey: 'course-api', environment: 'COURSE_API_KEY',
    secretResource: identity.resource, version: '4',
    confirmation: 'REFERENCE course-app/course-api/COURSE_API_KEY@4', actor,
  });
  await assert.rejects(() => service.deleteSecret({
    installationKey: 'customer-a', appKey: 'course-app', serviceKey: 'course-api', environment: 'COURSE_API_KEY',
    confirmation: 'DELETE', actor,
  }), /independent exact confirmation/);
  assert.deepEqual(await service.deleteSecret({
    installationKey: 'customer-a', appKey: 'course-app', serviceKey: 'course-api', environment: 'COURSE_API_KEY',
    confirmation: 'DELETE SECRET course-app/course-api/COURSE_API_KEY', actor,
  }), { deleted: true, secretResource: identity.resource });
});
