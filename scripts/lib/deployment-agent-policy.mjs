import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const installationKeyPattern = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const rolePattern = /^roles\/[A-Za-z0-9.]+$/;
const allowedTargets = new Set(['cloud-run-service', 'firebase-hosting', 'vm-docker']);
const allowedOperations = new Set(['inspect', 'plan', 'approve', 'apply', 'verify', 'promote', 'rollback', 'reconcile', 'cancel', 'activate']);
const allowedSecretOperations = new Set(['metadata', 'create-version', 'reference', 'disable-version', 'rollback-reference', 'delete-secret']);
const allowedRuntimeIamRoles = new Set([
  'roles/artifactregistry.reader', 'roles/datastore.user', 'roles/firebaseauth.admin',
  'roles/logging.logWriter', 'roles/monitoring.metricWriter', 'roles/secretmanager.secretAccessor',
]);
const allowedBuilderIamRoles = new Set(['roles/artifactregistry.writer', 'roles/logging.logWriter', 'roles/serviceusage.serviceUsageConsumer', 'roles/storage.objectViewer']);

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

export function validateDeploymentAgentPolicy(policy) {
  if (policy?.schemaVersion !== 1
    || policy.credentialMode !== 'attached-service-account-or-workload-identity'
    || policy.allowServiceAccountKeys !== false
    || policy.deployerServiceAccountTemplate !== 'stratexec-deployer-{installationKey}'
    || !Array.isArray(policy.allowedTargets)
    || !Array.isArray(policy.allowedOperations)
    || !Array.isArray(policy.allowedIamRoles)
    || !Array.isArray(policy.allowedRuntimeIamRoles)
    || policy.secretManager?.driver !== 'gcp-secret-manager'
    || policy.secretManager?.requireAppScopedLabels !== true
    || !Array.isArray(policy.secretManager?.allowedOperations)
    || policy.cloudRun?.artifactRepository !== 'stratexec'
    || policy.cloudRun?.buildSourceBucketTemplate !== '{projectId}_cloudbuild'
    || policy.cloudRun?.hostingSiteTemplate !== '{projectId}'
    || !Array.isArray(policy.cloudRun?.builderServiceAccountRoles)
    || policy.cloudRun?.requireImmutableImageDigest !== true
    || policy.cloudRun?.requireStagedVerification !== true
    || policy.vmDocker?.agentPort !== 8443
    || policy.vmDocker?.requireIap !== true
    || policy.vmDocker?.requireOsLogin !== true
    || policy.vmDocker?.allowSshKeys !== false
    || policy.vmDocker?.requireMtls !== true
    || policy.vmDocker?.desiredStateSignature !== 'Ed25519'
    || !Array.isArray(policy.vmDocker?.agentServiceAccountRoles)
    || policy.vmDocker?.requireImmutableImageDigest !== true
    || policy.vmDocker?.requireHostLocalAccountLock !== true
    || policy.vmDocker?.requireVerifiedBackup !== true
    || policy.vmDocker?.tradingActivationFromDeployment !== false
    || !policy.limits) {
    throw new Error('Deployment Agent policy is incomplete or unsafe.');
  }
  if (policy.allowedTargets.some((item) => !allowedTargets.has(item))) {
    throw new Error('Deployment Agent policy contains an unsupported target.');
  }
  if (policy.allowedOperations.some((item) => !allowedOperations.has(item))) {
    throw new Error('Deployment Agent policy contains an unsupported operation.');
  }
  if (policy.allowedIamRoles.some((item) => !rolePattern.test(item))) {
    throw new Error('Deployment Agent policy contains an invalid IAM role.');
  }
  if (policy.allowedRuntimeIamRoles.some((item) => !allowedRuntimeIamRoles.has(item))) {
    throw new Error('Deployment Agent policy contains an unsupported runtime IAM role.');
  }
  if (policy.cloudRun.builderServiceAccountRoles.some((item) => !allowedBuilderIamRoles.has(item))) {
    throw new Error('Deployment Agent policy contains an unsupported builder IAM role.');
  }
  if (policy.vmDocker.agentServiceAccountRoles.some((item) => !allowedRuntimeIamRoles.has(item))) {
    throw new Error('Deployment Agent policy contains an unsupported VM Agent IAM role.');
  }
  if (policy.secretManager.allowedOperations.some((item) => !allowedSecretOperations.has(item))) {
    throw new Error('Deployment Agent policy contains an unsupported secret operation.');
  }
  requireInteger(policy.limits.requestBytes, 'limits.requestBytes', 1024, 1_048_576);
  requireInteger(policy.limits.maxSecretBytes, 'limits.maxSecretBytes', 1, 65_536);
  requireInteger(policy.limits.maxBuildSourceBytes, 'limits.maxBuildSourceBytes', 1_048_576, 268_435_456);
  requireInteger(policy.limits.operationTimeoutSeconds, 'limits.operationTimeoutSeconds', 30, 3600);
  requireInteger(policy.limits.leaseSeconds, 'limits.leaseSeconds', 15, 300);
  requireInteger(policy.limits.approvalTtlSeconds, 'limits.approvalTtlSeconds', 60, 3600);
  requireInteger(policy.limits.maxJobs, 'limits.maxJobs', 10, 10_000);
  requireInteger(policy.limits.maxEventsPerJob, 'limits.maxEventsPerJob', 10, 1000);
  return policy;
}

export async function loadDeploymentAgentPolicy(path) {
  return validateDeploymentAgentPolicy(JSON.parse(await readFile(path, 'utf8')));
}

export function deploymentIdentityPlan({ installation, policy, requiredRoles = [] }) {
  validateDeploymentAgentPolicy(policy);
  if (!installationKeyPattern.test(installation?.installationKey ?? '')) {
    throw new Error('Invalid installation key for Deployment Agent identity.');
  }
  if (!projectPattern.test(installation?.gcpProjectId ?? '')) {
    throw new Error('Invalid GCP project for Deployment Agent identity.');
  }
  const requestedAccountId = policy.deployerServiceAccountTemplate.replace('{installationKey}', installation.installationKey);
  const suffix = createHash('sha256').update(installation.installationKey).digest('hex').slice(0, 8);
  const accountId = requestedAccountId.length <= 30
    ? requestedAccountId
    : `stratexec-${installation.installationKey.slice(0, 10).replace(/-+$/, '')}-${suffix}`;
  const requested = [...new Set(requiredRoles)].sort();
  const disallowedRoles = requested.filter((role) => !policy.allowedIamRoles.includes(role));
  return {
    installationKey: installation.installationKey,
    projectId: installation.gcpProjectId,
    credentialMode: policy.credentialMode,
    serviceAccountId: accountId,
    serviceAccountEmail: `${accountId}@${installation.gcpProjectId}.iam.gserviceaccount.com`,
    keyFilesAllowed: false,
    requestedRoles: requested,
    disallowedRoles,
    decision: disallowedRoles.length === 0 ? 'allowlisted' : 'blocked',
  };
}
