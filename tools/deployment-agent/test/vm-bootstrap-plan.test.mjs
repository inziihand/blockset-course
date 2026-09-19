import assert from 'node:assert/strict';
import test from 'node:test';
import { createVmBootstrapPlan } from '../src/vm-bootstrap-plan.mjs';

const policy = {
  vmDocker: {
    agentPort: 8443,
    desiredStateSignature: 'Ed25519',
    agentServiceAccountRoles: ['roles/artifactregistry.reader', 'roles/logging.logWriter'],
  },
};

test('defines keyless IAP/OS Login bootstrap without SSH private keys', () => {
  const plan = createVmBootstrapPlan({
    installation: { installationKey: 'customer-a', gcpProjectId: 'customer-project' },
    placement: {
      selectedTarget: 'vm-docker',
      targetConfig: {
        hostRef: 'gce://customer-project/asia-east1-b/worker-1',
        persistentDataPath: '/var/lib/stratexec/account-worker',
      },
    },
    policy,
  });
  assert.equal(plan.access.interactiveSshKeys, false);
  assert.equal(plan.access.iapTcpForwarding, true);
  assert.equal(plan.access.osLogin, true);
  assert.equal(plan.identity.jsonKeysAllowed, false);
  assert.equal(plan.agent.transport, 'mtls');
  assert.equal(plan.agent.acceptsShell, false);
  assert.equal(plan.ownerConfirmation, 'BOOTSTRAP VM customer-a worker-1');
});

test('rejects a VM host outside the installation project', () => {
  assert.throws(() => createVmBootstrapPlan({
    installation: { installationKey: 'customer-a', gcpProjectId: 'customer-project' },
    placement: { selectedTarget: 'vm-docker', targetConfig: { hostRef: 'gce://other-project/zone/worker', persistentDataPath: '/var/lib/stratexec/worker' } },
    policy,
  }), /installation GCP project/);
});
