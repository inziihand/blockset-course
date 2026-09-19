export const vmDockerDriver = Object.freeze({
  key: 'vm-docker',
  applySupport: 'implemented',
  executor: 'deployment-agent:vm-docker',
  validate({ service, placement }) {
    const blockers = [];
    if (service.deployment.workloadClass === 'static-web') {
      blockers.push('Static web workloads should not use the VM Docker driver.');
    }
    const target = placement.targetConfig ?? {};
    if (!/^gce:\/\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9-]+\/[a-z][a-z0-9-]{0,62}$/.test(target.hostRef ?? '')) {
      blockers.push('VM Docker placement requires targetConfig.hostRef.');
    }
    if (service.deployment.stateful && (!/^\/var\/lib\/stratexec\/[a-z0-9][a-z0-9._/-]*$/.test(target.persistentDataPath ?? '')
      || String(target.persistentDataPath).split('/').includes('..'))) {
      blockers.push('Stateful VM Docker service requires targetConfig.persistentDataPath.');
    }
    if (!/^https:\/\//.test(target.agentUrl ?? '')) blockers.push('VM Docker placement requires an HTTPS mTLS Agent URL.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(target.accountScope ?? '')) blockers.push('VM Docker placement requires an execution account scope.');
    if (!Array.isArray(target.allowedSqliteSchemaVersions) || target.allowedSqliteSchemaVersions.length === 0
      || target.allowedSqliteSchemaVersions.some((item) => !Number.isInteger(item) || item < 1)) {
      blockers.push('VM Docker placement requires reviewed SQLite schema versions.');
    }
    if (!Number.isInteger(target.expectedOpenOrders) || target.expectedOpenOrders < 0
      || !/^[a-f0-9]{64}$/.test(target.expectedPositionFingerprint ?? '')) {
      blockers.push('VM Docker placement requires a reviewed order count and position fingerprint.');
    }
    if (!Number.isInteger(target.minimumFreeBytes) || target.minimumFreeBytes < 1_073_741_824
      || !Number.isInteger(target.backupMaxAgeSeconds) || target.backupMaxAgeSeconds < 60) {
      blockers.push('VM Docker placement requires disk and backup safety thresholds.');
    }
    if (!/^\d{1,10}:\d{1,10}$/.test(target.runAsUser ?? '')) blockers.push('VM Docker placement requires a non-root UID:GID.');
    return blockers;
  },
});
