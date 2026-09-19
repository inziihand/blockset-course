import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildNormalizedAppDeploymentPlan } from '../lib/app-deployment-impact-plan.mjs';

const requiredApis = [
  'artifactregistry.googleapis.com',
  'cloudbuild.googleapis.com',
  'firebase.googleapis.com',
  'firebasehosting.googleapis.com',
  'iam.googleapis.com',
  'run.googleapis.com',
  'serviceusage.googleapis.com',
  'storage.googleapis.com',
];
const requiredRoles = [
  'roles/artifactregistry.admin',
  'roles/cloudbuild.builds.editor',
  'roles/firebasehosting.admin',
  'roles/iam.serviceAccountAdmin',
  'roles/iam.serviceAccountUser',
  'roles/resourcemanager.projectIamAdmin',
  'roles/run.admin',
  'roles/storage.objectCreator',
];
const installation = {
  installationKey: 'fixture-installation',
  gcpProjectId: 'fixture-project',
  region: 'asia-east1',
  servicePlacements: [{
    serviceKey: 'quotes-api',
    selectedTarget: 'cloud-run-service',
    region: 'asia-east1',
    serviceName: 'fixture-quotes',
    status: 'planned',
  }],
};
const service = {
  key: 'quotes-api',
  ownerApp: 'quotes',
  routes: ['/api/quotes/v1/**'],
  deployment: {
    workloadClass: 'request-http',
    artifact: { type: 'oci', context: 'services/quotes-api', dockerfile: 'services/quotes-api/Dockerfile' },
    recommendedTarget: 'cloud-run-service',
    productionReadiness: 'ready',
    cloudRun: {
      ingress: 'all', iamInvocation: 'public-app-auth', cpu: '1', memory: '256Mi',
      timeoutSeconds: 30, concurrency: 20, minInstances: 0, maxInstances: 1,
      serviceAccountRoles: [], secrets: [],
    },
  },
};
const deployment = {
  schemaVersion: 1,
  appKey: 'quotes',
  appVersion: '1.0.0',
  services: [{
    serviceKey: 'quotes-api',
    allowedTargets: ['cloud-run-service'],
    routes: ['/api/quotes/v1/**'],
    healthPath: '/healthz',
    readinessPath: '/health/ready',
    configuration: [{
      name: 'GOOGLE_CLOUD_PROJECT', source: 'project-id', purpose: 'Token audience project.',
    }],
    secrets: [],
    migration: {
      strategy: 'none', reversible: true, backupRequired: false, maintenanceWindow: 'not-required',
    },
    rollback: { strategy: 'target-revision', data: 'not-required' },
  }],
  dataMigrations: [],
  sourceRollback: { strategy: 'transaction-backup' },
};
const sourcePlan = {
  appKey: 'quotes',
  version: '1.0.0',
  packageSha256: 'a'.repeat(64),
  planFingerprint: 'b'.repeat(64),
  blockers: [],
  changes: [{ path: 'apps/console/src/apps/quotes/App.tsx', action: 'add' }],
  verification: {
    signatureStatus: 'trusted-signed', publisherId: 'publisher.test', keyId: 'release-1',
  },
};
const appManifest = {
  appKey: 'quotes',
  displayName: 'Quotes',
  category: 'application',
  removable: true,
  access: {
    defaultMode: 'all_members',
    allowedModes: ['all_members', 'grant_required', 'admins_only', 'disabled'],
    entitlements: [{ key: 'realtime', displayName: '即時報價' }],
    adminAllowed: true,
  },
  requiredServices: ['quotes-api'],
};

async function inventoryFixture() {
  const inventory = JSON.parse(await readFile(
    new URL('../../infrastructure/fixtures/deployment-inventory.empty.json', import.meta.url),
    'utf8',
  ));
  inventory.enabledApis = requiredApis;
  inventory.grantedIamRoles = requiredRoles;
  return inventory;
}

test('builds a deterministic read-only App runtime plan from normalized fixture inventory', async () => {
  const inventory = await inventoryFixture();
  const first = buildNormalizedAppDeploymentPlan({
    sourcePlan, deployment, appManifest, nextServices: [service], installation, inventory,
  });
  const second = buildNormalizedAppDeploymentPlan({
    sourcePlan, deployment, appManifest, nextServices: [service], installation, inventory,
  });

  assert.equal(first.mode, 'read-only');
  assert.equal(first.decision, 'reviewable');
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.deepEqual(first.app.entitlements, [{ key: 'realtime', displayName: '即時報價' }]);
  assert.deepEqual(first.services[0], {
    serviceKey: 'quotes-api',
    dependsOn: [],
    routes: ['/api/quotes/v1/**'],
    artifact: { type: 'oci', context: 'services/quotes-api', dockerfile: 'services/quotes-api/Dockerfile' },
    healthPath: '/healthz',
    readinessPath: '/health/ready',
    verification: { unauthenticatedRequests: [], authenticatedRequests: [] },
    planState: 'planned',
    contractReadiness: 'ready',
    observedDeployment: 'absent',
    verificationState: 'unverified',
    selectedTarget: 'cloud-run-service',
    region: 'asia-east1',
    serviceName: 'fixture-quotes',
    resources: {
      cpu: '1', memory: '256Mi', minInstances: 0, maxInstances: 1, concurrency: 20, timeoutSeconds: 30,
    },
    publicIngress: true,
    ingress: 'all',
    costTier: 'low-variable',
    downtimeImpact: 'none-new-resource',
    vm: null,
  });
  assert.ok(first.changes.cloudResources.some((item) => item.type === 'cloud-run-service' && item.action === 'add'));
  assert.deepEqual(first.requirements.configuration[0], {
    serviceKey: 'quotes-api', name: 'GOOGLE_CLOUD_PROJECT', purpose: 'Token audience project.',
    source: 'project-id', validation: 'gcp-project-id', availability: 'platform-derived', dependency: null,
  });
  assert.deepEqual(first.migrations[0].blockers, []);
});

test('reports inventory drift and missing API/IAM capabilities without changing external state', async () => {
  const inventory = await inventoryFixture();
  inventory.enabledApis = inventory.enabledApis.filter((item) => item !== 'run.googleapis.com');
  inventory.grantedIamRoles = inventory.grantedIamRoles.filter((item) => item !== 'roles/run.admin');
  inventory.resources.push({
    resourceKey: 'cloud-run-service:fixture-project:asia-east1:fixture-quotes',
    type: 'cloud-run-service',
    name: 'fixture-quotes',
    region: 'asia-east1',
    serviceKey: 'quotes-api',
    ownerApp: 'quotes',
    state: 'deployed',
    spec: {
      target: 'cloud-run-service', cpu: '2', memory: '512Mi', minInstances: 1,
      maxInstances: 2, ingress: 'all', publicIngress: true,
    },
  });
  const plan = buildNormalizedAppDeploymentPlan({
    sourcePlan, deployment, nextServices: [service], previousServices: [service], installation, inventory,
  });

  assert.equal(plan.decision, 'blocked');
  assert.equal(plan.services[0].observedDeployment, 'deployed');
  assert.equal(plan.services[0].verificationState, 'unverified');
  assert.ok(plan.inventory.drift.some((item) => item.kind === 'configuration-drift'));
  assert.ok(plan.blockers.some((item) => item.includes('run.googleapis.com')));
  assert.ok(plan.blockers.some((item) => item.includes('roles/run.admin')));
  assert.equal(plan.requirements.apis.find((item) => item.name === 'run.googleapis.com').missing, true);
  assert.equal(plan.requirements.deploymentAgentIamRoles.find((item) => item.role === 'roles/run.admin').missing, true);
});

test('produces a reviewable VM Worker plan with account and backup safety inputs', async () => {
  const inventory = await inventoryFixture();
  inventory.enabledApis = [
    'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'compute.googleapis.com',
    'iam.googleapis.com', 'iap.googleapis.com', 'oslogin.googleapis.com', 'secretmanager.googleapis.com',
  ];
  inventory.grantedIamRoles = [
    'roles/artifactregistry.admin', 'roles/cloudbuild.builds.editor', 'roles/compute.instanceAdmin.v1',
    'roles/compute.osAdminLogin', 'roles/iam.serviceAccountAdmin', 'roles/iam.serviceAccountUser',
    'roles/iap.tunnelResourceAccessor', 'roles/resourcemanager.projectIamAdmin', 'roles/secretmanager.admin',
    'roles/storage.objectCreator',
  ];
  const vmInstallation = structuredClone(installation);
  vmInstallation.servicePlacements[0] = {
    serviceKey: 'quotes-api', selectedTarget: 'vm-docker', region: 'asia-east1', serviceName: 'account-worker', status: 'planned',
    targetConfig: {
      hostRef: 'gce://fixture-project/asia-east1-b/worker-1', agentUrl: 'https://10.0.0.2:8443',
      persistentDataPath: '/var/lib/stratexec/account-worker', accountScope: 'broker:person:account-1',
      containerName: 'account-worker', runAsUser: '10001:10001', allowedSqliteSchemaVersions: [3],
      expectedOpenOrders: 0, expectedPositionFingerprint: 'c'.repeat(64), minimumFreeBytes: 2147483648,
      backupMaxAgeSeconds: 3600,
    },
  };
  const vmService = structuredClone(service);
  vmService.deployment.workloadClass = 'continuous-worker';
  vmService.deployment.stateful = true;
  vmService.deployment.continuous = true;
  vmService.deployment.allowedTargets = ['vm-docker'];
  const vmDeployment = structuredClone(deployment);
  vmDeployment.services[0].allowedTargets = ['vm-docker'];
  const plan = buildNormalizedAppDeploymentPlan({
    sourcePlan, deployment: vmDeployment, nextServices: [vmService], installation: vmInstallation, inventory,
  });
  assert.equal(plan.decision, 'reviewable');
  assert.equal(plan.services[0].selectedTarget, 'vm-docker');
  assert.equal(plan.services[0].vm.accountScope, 'broker:person:account-1');
  assert.equal(plan.services[0].vm.expectedOpenOrders, 0);
  assert.ok(plan.changes.cloudResources.some((item) => item.type === 'gce-instance'));
  assert.ok(plan.changes.cloudResources.some((item) => item.type === 'persistent-disk'));
  assert.ok(plan.requirements.runtimeServiceAccountRoles.some((item) => item.role === 'roles/artifactregistry.reader'));
  assert.match(plan.warnings.join(' '), /does not authorize PAPER or LIVE/);
});
