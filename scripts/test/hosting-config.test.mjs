import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostingConfig } from '../lib/hosting-config.mjs';

const installation = {
  gcpProjectId: 'example-project',
  servicePlacements: [
    { serviceKey: 'identity-api', selectedTarget: 'cloud-run-service', region: 'asia-east1', serviceName: 'identity' },
    { serviceKey: 'sample-api', selectedTarget: 'cloud-run-service', region: 'asia-east1', serviceName: 'sample' },
  ],
};
const registry = {
  services: [
    { key: 'identity-api', routes: ['/api/identity/v1/**'], deployment: { productionReadiness: 'ready' } },
    { key: 'sample-api', routes: ['/api/sample/v1/**'], deployment: { productionReadiness: 'ready' } },
  ],
};

test('routes ready Cloud Run services before the SPA fallback', () => {
  const result = createHostingConfig(installation, registry);
  assert.equal(result.hosting.site, 'example-project');
  assert.deepEqual(result.hosting.rewrites, [
    {
      source: '/api/identity/v1/**',
      run: { serviceId: 'identity', region: 'asia-east1', pinTag: true },
    },
    {
      source: '/api/sample/v1/**',
      run: { serviceId: 'sample', region: 'asia-east1', pinTag: true },
    },
    { source: '**', destination: '/index.html' },
  ]);
});

test('never publishes a blocked service route', () => {
  const blockedRegistry = structuredClone(registry);
  blockedRegistry.services[1].deployment.productionReadiness = 'blocked';
  const serialized = JSON.stringify(createHostingConfig(installation, blockedRegistry));
  assert.doesNotMatch(serialized, /api\/sample/);
  assert.doesNotMatch(serialized, /"sample"/);
});

test('accepts a generated-config-relative Hosting public directory', () => {
  const result = createHostingConfig(installation, registry, { publicDirectory: '../../../apps/console/dist' });
  assert.equal(result.hosting.public, '../../../apps/console/dist');
});

test('does not publish routes for services that are not required by enabled Apps', () => {
  const result = createHostingConfig(installation, registry, { selectedServiceKeys: ['identity-api'] });
  assert.deepEqual(result.hosting.rewrites, [
    {
      source: '/api/identity/v1/**',
      run: { serviceId: 'identity', region: 'asia-east1', pinTag: true },
    },
    { source: '**', destination: '/index.html' },
  ]);
});
