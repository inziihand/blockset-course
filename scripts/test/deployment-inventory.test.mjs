import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDeploymentInventory } from '../lib/deployment-inventory.mjs';

test('collects normalized GCP and Firebase inventory using read-only commands only', async () => {
  const calls = [];
  const installation = {
    installationKey: 'fixture-installation',
    gcpProjectId: 'fixture-project',
    region: 'asia-east1',
    servicePlacements: [{
      serviceKey: 'quotes-api', selectedTarget: 'cloud-run-service', region: 'asia-east1',
      serviceName: 'fixture-quotes', status: 'planned',
    }, {
      serviceKey: 'account-worker', selectedTarget: 'vm-docker', region: 'asia-east1',
      serviceName: 'account-worker', status: 'planned',
      targetConfig: {
        hostRef: 'gce://fixture-project/asia-east1-b/worker-1', persistentDataPath: '/var/lib/stratexec/account-worker',
        accountScope: 'broker:person:account-1', minimumFreeBytes: 2147483648, backupMaxAgeSeconds: 3600,
      },
    }],
  };
  const roles = [
    'roles/artifactregistry.admin', 'roles/cloudbuild.builds.editor', 'roles/firebasehosting.admin',
    'roles/iam.serviceAccountAdmin', 'roles/iam.serviceAccountUser', 'roles/run.admin',
  ];
  const runJson = async (command, args) => {
    calls.push([command, ...args]);
    const key = args.slice(0, 3).join(' ');
    if (key === 'auth list --filter=status:ACTIVE') return { ok: true, data: [{ account: 'admin@example.com' }] };
    if (key === 'projects describe fixture-project') return { ok: true, data: { projectId: 'fixture-project' } };
    if (key === 'services list --enabled') return { ok: true, data: [{ config: { name: 'run.googleapis.com' } }] };
    if (key === 'projects get-iam-policy fixture-project') return {
      ok: true,
      data: { bindings: roles.map((role) => ({ role, members: ['user:admin@example.com'] })) },
    };
    if (key === 'run services list') return {
      ok: true,
      data: [{
        metadata: {
          name: 'fixture-quotes',
          annotations: {
            'autoscaling.knative.dev/minScale': '0',
            'autoscaling.knative.dev/maxScale': '1',
            'run.googleapis.com/ingress': 'all',
          },
        },
        spec: { template: { spec: { containers: [{ resources: { limits: { cpu: '1', memory: '256Mi' } } }] } } },
      }],
    };
    if (key === 'run services get-iam-policy') return {
      ok: true, data: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] },
    };
    if (key === 'secrets list --project') return { ok: true, data: [{ name: 'projects/fixture-project/secrets/course-token' }] };
    if (key === 'artifacts repositories list') return { ok: true, data: [{ name: 'projects/x/locations/asia-east1/repositories/stratexec' }] };
    if (key === 'iam service-accounts list') return { ok: true, data: [{ email: 'fixture-quotes-runtime@fixture-project.iam.gserviceaccount.com' }] };
    if (key === 'firestore databases list') return { ok: true, data: [{ name: '(default)', locationId: 'asia-east1' }] };
    if (key === 'projects:list --json') return { ok: true, data: { result: [{ projectId: 'fixture-project' }] } };
    if (key === 'hosting:sites:list --project fixture-project') return { ok: true, data: { result: { sites: [{ name: 'fixture-site' }] } } };
    if (key === 'compute instances list') return { ok: true, data: [{
      name: 'worker-1', zone: 'projects/fixture-project/zones/asia-east1-b',
      disks: [{ boot: true, source: 'projects/x/zones/asia-east1-b/disks/boot' }, { boot: false, source: 'projects/x/zones/asia-east1-b/disks/worker-data' }],
    }] };
    if (key === 'compute disks list') return { ok: true, data: [{ name: 'worker-data', zone: 'projects/x/zones/asia-east1-b' }] };
    if (key === 'auth print-access-token --format=json') return { ok: true, data: 'token-value' };
    return { ok: false, error: `Unexpected command: ${command} ${args.join(' ')}` };
  };
  const fetchJson = async (url, token) => {
    assert.equal(token, 'token-value');
    if (url.includes('/releases?')) return { releases: [{ version: { name: 'sites/fixture-site/versions/1' } }] };
    return { config: { rewrites: [{ glob: '/api/quotes/v1/**', run: { serviceId: 'fixture-quotes', region: 'asia-east1' } }] } };
  };
  const inventory = await collectDeploymentInventory({
    installation,
    runJson,
    fetchJson,
    now: () => new Date('2026-09-18T00:00:00.000Z'),
  });

  assert.equal(inventory.collectionStatus, 'complete');
  assert.equal(inventory.collector.principal, 'admin@example.com');
  assert.ok(inventory.resources.some((item) => item.type === 'cloud-run-service'));
  assert.ok(inventory.resources.some((item) => item.type === 'firebase-project'));
  assert.ok(inventory.resources.some((item) => item.type === 'gce-instance' && item.serviceKey === 'account-worker'));
  assert.ok(inventory.resources.some((item) => item.type === 'persistent-disk' && item.serviceKey === null));
  assert.deepEqual(inventory.secrets, [{ secretName: 'course-token', exists: true, ownerApp: null }]);
  assert.equal(inventory.hostingRoutes[0].route, '/api/quotes/v1/**');
  const forbidden = new Set(['create', 'deploy', 'update', 'delete', 'enable', 'disable', 'add-iam-policy-binding', 'set-iam-policy']);
  for (const call of calls) {
    assert.equal(call.some((part) => forbidden.has(part)), false, `Mutating command found: ${call.join(' ')}`);
  }
});
