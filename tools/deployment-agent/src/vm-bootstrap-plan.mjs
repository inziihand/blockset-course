const hostPattern = /^gce:\/\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/([a-z0-9-]+)\/([a-z][a-z0-9-]{0,62})$/;

export function createVmBootstrapPlan({ installation, placement, policy }) {
  const match = hostPattern.exec(placement?.targetConfig?.hostRef ?? '');
  if (!match || match[1] !== installation.gcpProjectId) throw new Error('VM bootstrap hostRef must identify the installation GCP project.');
  if (placement.selectedTarget !== 'vm-docker') throw new Error('VM bootstrap plan accepts only vm-docker placement.');
  const [, projectId, zone, instanceName] = match;
  const agentIdentity = `stratexec-vm-${instanceName}`.slice(0, 30).replace(/-+$/, '');
  const ownerConfirmation = `BOOTSTRAP VM ${installation.installationKey} ${instanceName}`;
  return Object.freeze({
    schemaVersion: 1,
    mode: 'plan-only',
    installationKey: installation.installationKey,
    hostRef: placement.targetConfig.hostRef,
    projectId,
    zone,
    instanceName,
    ownerConfirmation,
    access: {
      interactiveSshKeys: false,
      iapTcpForwarding: true,
      osLogin: true,
      serialPortAccess: false,
    },
    identity: {
      mode: 'attached-vm-service-account',
      serviceAccountId: agentIdentity,
      jsonKeysAllowed: false,
      roles: [...policy.vmDocker.agentServiceAccountRoles],
    },
    agent: {
      transport: 'mtls',
      port: policy.vmDocker.agentPort,
      desiredStateSignature: policy.vmDocker.desiredStateSignature,
      acceptsShell: false,
      certificateRotation: 'secret-manager-versioned',
      revocation: ['disable-client-certificate-version', 'revoke-desired-state-key', 'disable-vm-service-account'],
    },
    storage: {
      persistentDataPath: placement.targetConfig.persistentDataPath,
      backupRequired: true,
      preserveOnRollback: true,
      preserveOnAgentRemoval: true,
    },
    writes: [
      'enable-reviewed-compute-iap-oslogin-apis', 'create-or-update-vm-service-account',
      'create-or-update-vm', 'install-vm-agent', 'issue-mtls-certificate',
    ],
    blockers: [
      'owner-confirmation-required-for-first-vm-or-iam-expansion',
      'runtime-deployment-remains-disabled-until-agent-mtls-and-workload-identity-are-verified',
    ],
  });
}
