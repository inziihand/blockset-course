import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deploymentIdentityPlan, validateDeploymentAgentPolicy } from '../lib/deployment-agent-policy.mjs';

const policy = JSON.parse(await readFile(
  new URL('../../infrastructure/deployment-agent.policy.json', import.meta.url),
  'utf8',
));

test('creates an installation-scoped keyless deployer identity from the allowlist', () => {
  validateDeploymentAgentPolicy(policy);
  assert.equal(policy.secretManager.requireAppScopedLabels, true);
  assert.equal(policy.cloudRun.requireImmutableImageDigest, true);
  assert.ok(policy.allowedOperations.includes('promote'));
  assert.ok(policy.allowedRuntimeIamRoles.includes('roles/secretmanager.secretAccessor'));
  assert.ok(policy.cloudRun.builderServiceAccountRoles.includes('roles/artifactregistry.writer'));
  assert.ok(policy.allowedTargets.includes('vm-docker'));
  assert.equal(policy.vmDocker.requireMtls, true);
  assert.equal(policy.vmDocker.allowSshKeys, false);
  assert.equal(policy.vmDocker.tradingActivationFromDeployment, false);
  assert.equal(policy.limits.maxSecretBytes, 32768);
  const plan = deploymentIdentityPlan({
    installation: { installationKey: 'customer-a', gcpProjectId: 'customer-project-12345' },
    policy,
    requiredRoles: ['roles/run.admin', 'roles/iam.serviceAccountUser'],
  });
  assert.equal(plan.serviceAccountEmail, 'stratexec-deployer-customer-a@customer-project-12345.iam.gserviceaccount.com');
  assert.equal(plan.keyFilesAllowed, false);
  assert.equal(plan.decision, 'allowlisted');
});

test('blocks roles outside the Deployment Agent allowlist', () => {
  const plan = deploymentIdentityPlan({
    installation: { installationKey: 'customer-a', gcpProjectId: 'customer-a-project' },
    policy,
    requiredRoles: ['roles/owner'],
  });
  assert.equal(plan.decision, 'blocked');
  assert.deepEqual(plan.disallowedRoles, ['roles/owner']);
});
