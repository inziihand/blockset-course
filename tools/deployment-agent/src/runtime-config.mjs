import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const defaultRepositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

function integer(value, fallback, name, minimum, maximum) {
  const parsed = Number(String(value ?? '').trim() || fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function safeBaseUrl(value, name, fallback) {
  const url = new URL(value?.trim() || fallback);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new Error(`${name} must use HTTPS except for loopback development.`);
  return url.toString().replace(/\/$/, '');
}

export function resolveDeploymentAgentConfig(environment = process.env) {
  for (const name of ['STRATEXEC_DEPLOYER_SERVICE_ACCOUNT_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
    if (environment[name]?.trim()) throw new Error(`${name} is forbidden; use an attached service account or Workload Identity.`);
  }
  if (environment.PORT?.trim()) {
    throw new Error('Managed runtime deployment is disabled until an external durable job store and target driver are installed.');
  }
  const port = integer(
    environment.STRATEXEC_DEPLOYMENT_AGENT_PORT,
    '8183',
    'STRATEXEC_DEPLOYMENT_AGENT_PORT',
    1,
    65535,
  );
  const host = environment.STRATEXEC_DEPLOYMENT_AGENT_HOST?.trim() || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('Batch 6 Deployment Agent must bind to 127.0.0.1.');
  const repositoryRoot = resolve(environment.STRATEXEC_REPOSITORY_ROOT?.trim() || defaultRepositoryRoot);
  const secretManagerMode = environment.STRATEXEC_SECRET_MANAGER_MODE?.trim() || 'disabled';
  if (!['disabled', 'gcp'].includes(secretManagerMode)) {
    throw new Error('STRATEXEC_SECRET_MANAGER_MODE must be disabled or gcp.');
  }
  const targetMode = environment.STRATEXEC_DEPLOYMENT_TARGET_MODE?.trim() || 'disabled';
  if (!['disabled', 'gcp-cloud-run', 'gcp-vm-docker'].includes(targetMode)) {
    throw new Error('STRATEXEC_DEPLOYMENT_TARGET_MODE must be disabled, gcp-cloud-run or gcp-vm-docker.');
  }
  const vm = {
    signingKeyId: environment.STRATEXEC_VM_DESIRED_STATE_KEY_ID?.trim() || '',
    signingPrivateKeyPath: environment.STRATEXEC_VM_DESIRED_STATE_PRIVATE_KEY_PATH?.trim() || '',
    clientCertificatePath: environment.STRATEXEC_VM_AGENT_CLIENT_CERT_PATH?.trim() || '',
    clientPrivateKeyPath: environment.STRATEXEC_VM_AGENT_CLIENT_KEY_PATH?.trim() || '',
    certificateAuthorityPath: environment.STRATEXEC_VM_AGENT_CA_PATH?.trim() || '',
  };
  if (targetMode === 'gcp-vm-docker' && Object.values(vm).some((item) => !item)) {
    throw new Error('gcp-vm-docker requires external desired-state signing key and mTLS client credential paths.');
  }
  return {
    host,
    port,
    repositoryRoot,
    stateRoot: resolve(environment.STRATEXEC_DEPLOYMENT_AGENT_STATE_ROOT?.trim()
      || repositoryRoot, environment.STRATEXEC_DEPLOYMENT_AGENT_STATE_ROOT?.trim() ? '' : '.stratexec/deployment-agent'),
    policyPath: resolve(repositoryRoot, 'infrastructure', 'deployment-agent.policy.json'),
    identityBaseUrl: safeBaseUrl(environment.STRATEXEC_IDENTITY_BASE_URL, 'STRATEXEC_IDENTITY_BASE_URL', 'http://127.0.0.1:8180'),
    packageAgentBaseUrl: safeBaseUrl(environment.STRATEXEC_APP_PACKAGE_AGENT_BASE_URL, 'STRATEXEC_APP_PACKAGE_AGENT_BASE_URL', 'http://127.0.0.1:8182'),
    secretManagerMode,
    targetMode,
    vm,
  };
}

export async function assertKeylessCredentialConfiguration(
  environment = process.env,
  readFileImpl = readFile,
) {
  const path = environment.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!path) return { mode: 'ambient-attached-identity' };
  let document;
  try { document = JSON.parse(await readFileImpl(path, 'utf8')); }
  catch { throw new Error('GOOGLE_APPLICATION_CREDENTIALS must be a readable external-account configuration.'); }
  if (document?.type === 'service_account' || document?.private_key || document?.private_key_id) {
    throw new Error('Long-lived service account JSON keys are forbidden for Deployment Agent.');
  }
  if (!['external_account', 'external_account_authorized_user'].includes(document?.type)) {
    throw new Error('Deployment Agent accepts only attached identity or external-account federation credentials.');
  }
  return { mode: 'workload-identity-federation', credentialType: document.type };
}
