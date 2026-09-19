import assert from 'node:assert/strict';
import test from 'node:test';
import { assertKeylessCredentialConfiguration, resolveDeploymentAgentConfig } from '../src/runtime-config.mjs';

test('defaults to a separate loopback Deployment Agent', () => {
  const config = resolveDeploymentAgentConfig({ STRATEXEC_REPOSITORY_ROOT: 'D:\\work\\platform' });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8183);
  assert.match(config.stateRoot, /deployment-agent$/);
  assert.equal(config.secretManagerMode, 'disabled');
  assert.equal(config.targetMode, 'disabled');
});

test('rejects managed or public binding until external durability and target drivers exist', () => {
  assert.throws(() => resolveDeploymentAgentConfig({ PORT: '8080' }), /external durable job store/);
  assert.throws(() => resolveDeploymentAgentConfig({ STRATEXEC_DEPLOYMENT_AGENT_HOST: '0.0.0.0' }), /127\.0\.0\.1/);
  assert.throws(() => resolveDeploymentAgentConfig({ GOOGLE_SERVICE_ACCOUNT_JSON: '{}' }), /forbidden/);
  assert.throws(() => resolveDeploymentAgentConfig({ STRATEXEC_DEPLOYER_SERVICE_ACCOUNT_KEY: 'secret' }), /forbidden/);
  assert.throws(() => resolveDeploymentAgentConfig({ STRATEXEC_SECRET_MANAGER_MODE: 'plaintext-file' }), /disabled or gcp/);
  assert.throws(() => resolveDeploymentAgentConfig({ STRATEXEC_DEPLOYMENT_TARGET_MODE: 'shell' }), /disabled, gcp-cloud-run or gcp-vm-docker/);
  assert.throws(() => resolveDeploymentAgentConfig({ STRATEXEC_DEPLOYMENT_TARGET_MODE: 'gcp-vm-docker' }), /signing key and mTLS/);
});

test('accepts only external signing and mTLS paths for VM Docker mode', () => {
  const config = resolveDeploymentAgentConfig({
    STRATEXEC_DEPLOYMENT_TARGET_MODE: 'gcp-vm-docker',
    STRATEXEC_VM_DESIRED_STATE_KEY_ID: 'deployment-control',
    STRATEXEC_VM_DESIRED_STATE_PRIVATE_KEY_PATH: 'D:\\secure\\desired-state.pem',
    STRATEXEC_VM_AGENT_CLIENT_CERT_PATH: 'D:\\secure\\client.crt',
    STRATEXEC_VM_AGENT_CLIENT_KEY_PATH: 'D:\\secure\\client.key',
    STRATEXEC_VM_AGENT_CA_PATH: 'D:\\secure\\ca.crt',
  });
  assert.equal(config.targetMode, 'gcp-vm-docker');
  assert.equal(config.vm.signingKeyId, 'deployment-control');
});

test('accepts federation config metadata and rejects service-account private keys', async () => {
  const read = async (path) => JSON.stringify(path === 'federation.json'
    ? { type: 'external_account' }
    : { type: 'service_account', private_key: 'do-not-log' });
  assert.deepEqual(
    await assertKeylessCredentialConfiguration({ GOOGLE_APPLICATION_CREDENTIALS: 'federation.json' }, read),
    { mode: 'workload-identity-federation', credentialType: 'external_account' },
  );
  await assert.rejects(
    () => assertKeylessCredentialConfiguration({ GOOGLE_APPLICATION_CREDENTIALS: 'key.json' }, read),
    /keys are forbidden/,
  );
});
