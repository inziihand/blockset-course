import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeploymentPlan } from '../lib/deployment-plan.mjs';

const appManifests = [
  { appKey: 'platform', kind: 'platform', requiredServices: ['identity-api'] },
  { appKey: 'offline-demo', kind: 'frontend-app', requiredServices: [] },
  { appKey: 'quotes', kind: 'frontend-app', requiredServices: ['quotes-api'] },
];
const service = (key, ownerApp = 'platform') => ({
  key,
  ownerApp,
  dependsOn: [],
  deployment: {
    workloadClass: 'request-http', recommendedTarget: 'cloud-run-service',
    allowedTargets: ['cloud-run-service', 'vm-docker'], productionReadiness: 'ready',
    blockers: [], artifact: { type: 'oci', context: key, dockerfile: `${key}/Dockerfile` },
    cloudRun: {}, stateful: false,
  },
});
const registry = { services: [service('identity-api'), service('quotes-api', 'quotes')] };
const base = {
  installationKey: 'customer', gcpProjectId: 'customer-project', enabledApps: ['offline-demo'],
  servicePlacements: [
    { serviceKey: 'identity-api', selectedTarget: 'cloud-run-service', region: 'asia-east1', serviceName: 'identity', status: 'planned' },
  ],
};

test('always selects platform services but skips disabled App services', () => {
  const plan = createDeploymentPlan({ installation: base, registry, appManifests });
  assert.deepEqual(plan.selectedApps, ['platform', 'offline-demo']);
  assert.deepEqual(plan.requiredServiceKeys, ['identity-api']);
  assert.equal(plan.plan[0].deploymentDriver, 'cloud-run-service');
  assert.equal(plan.plan[0].executor, 'scripts/deployment/executors/cloud-run-service.ps1');
  assert.equal(plan.plan[0].deployable, true);
});

test('expands service dependencies and orders providers before consumers', () => {
  const installation = structuredClone(base);
  installation.enabledApps.push('quotes');
  installation.servicePlacements.push({
    serviceKey: 'quotes-api', selectedTarget: 'cloud-run-service', region: 'asia-east1', serviceName: 'quotes', status: 'planned',
  });
  const dependentRegistry = structuredClone(registry);
  dependentRegistry.services.find((item) => item.key === 'quotes-api').dependsOn = ['identity-api'];
  const plan = createDeploymentPlan({ installation, registry: dependentRegistry, appManifests });
  assert.deepEqual(plan.requiredServiceKeys, ['identity-api', 'quotes-api']);
  assert.deepEqual(plan.plan[0].requiredByServices, ['quotes-api']);
  assert.deepEqual(plan.plan[1].requiredByApps, ['quotes']);
});

test('requires placements only when an enabled App depends on the service', () => {
  const installation = structuredClone(base);
  installation.enabledApps.push('quotes');
  assert.throws(
    () => createDeploymentPlan({ installation, registry, appManifests }),
    /missing required service placement: quotes-api/,
  );
});

test('VM Docker becomes deployable only with the reviewed Agent and account safety contract', () => {
  const installation = structuredClone(base);
  installation.enabledApps.push('quotes');
  installation.servicePlacements.push({
    serviceKey: 'quotes-api', selectedTarget: 'vm-docker', region: 'asia-east1', serviceName: 'quotes', status: 'planned',
    targetConfig: {
      hostRef: 'gce://customer-project/asia-east1-b/worker-1',
      agentUrl: 'https://10.0.0.2:8443',
      persistentDataPath: '/var/lib/stratexec/quotes-api',
      accountScope: 'broker:customer:account-1',
      allowedSqliteSchemaVersions: [1],
      expectedOpenOrders: 0,
      expectedPositionFingerprint: 'a'.repeat(64),
      minimumFreeBytes: 2147483648,
      backupMaxAgeSeconds: 3600,
      runAsUser: '10001:10001',
    },
  });
  const plan = createDeploymentPlan({ installation, registry, appManifests });
  const quotes = plan.plan.find((entry) => entry.serviceKey === 'quotes-api');
  assert.equal(quotes.driverApplySupport, 'implemented');
  assert.equal(quotes.executor, 'deployment-agent:vm-docker');
  assert.equal(quotes.deployable, true);
});
