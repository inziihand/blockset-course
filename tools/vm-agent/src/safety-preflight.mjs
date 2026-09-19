export class VmSafetyError extends Error {
  constructor(message, blockers = []) {
    super(message);
    this.name = 'VmSafetyError';
    this.status = 409;
    this.blockers = blockers;
  }
}

export function evaluateVmSafetyPreflight(desired, snapshot, now = new Date()) {
  const blockers = [];
  if (snapshot?.vm?.bootstrapped !== true || snapshot?.vm?.identityVerified !== true) blockers.push('VM bootstrap identity is not verified.');
  if (snapshot?.agent?.connected !== true || snapshot?.agent?.mtls !== true) blockers.push('VM Agent mTLS channel is not healthy.');
  if (desired.preflight.requireAgentLease && (snapshot?.agent?.leaseValid !== true
    || new Date(snapshot?.agent?.leaseExpiresAt ?? 0).getTime() <= now.getTime())) blockers.push('VM Agent lease is missing or expired.');
  if (!Number.isSafeInteger(snapshot?.vm?.diskFreeBytes) || snapshot.vm.diskFreeBytes < desired.data.minimumFreeBytes) blockers.push('Persistent data volume has insufficient free space.');
  if (!desired.preflight.allowedSqliteSchemaVersions.includes(snapshot?.worker?.sqliteSchemaVersion)) blockers.push('SQLite schema version is not approved for this release.');
  if (snapshot?.worker?.instanceCount > 1) blockers.push('More than one Account Worker is present for this host.');
  if (snapshot?.worker?.accountScope && snapshot.worker.accountScope !== desired.account.scope) blockers.push('Existing Worker owns a different execution account.');
  if (snapshot?.worker?.lock?.held === true && snapshot.worker.lock.accountScope !== desired.account.scope) blockers.push('Host-local account lock belongs to another account scope.');
  if (snapshot?.worker?.openOrders !== desired.preflight.expectedOpenOrders) blockers.push('Open-order count differs from the reviewed deployment state.');
  if (snapshot?.worker?.positionFingerprint !== desired.preflight.expectedPositionFingerprint) blockers.push('Position snapshot differs from the reviewed deployment state.');
  if (snapshot?.worker?.externalExposure === true) blockers.push('Unowned external exposure requires manual reconciliation.');
  if (snapshot?.reconciliation?.consistent !== true || Number(snapshot?.reconciliation?.unknownWrites ?? 1) !== 0) blockers.push('Account reconciliation is incomplete or contains UNKNOWN writes.');
  if (desired.preflight.requireBackup) {
    const verifiedAt = new Date(snapshot?.data?.backup?.verifiedAt ?? 0).getTime();
    if (snapshot?.data?.backup?.verified !== true || now.getTime() - verifiedAt > desired.data.backupMaxAgeSeconds * 1000) {
      blockers.push('A recent verified data backup is required.');
    }
  }
  if (snapshot?.strategy?.state && !['disabled', 'stopped'].includes(snapshot.strategy.state)) blockers.push('Strategy must be stopped before runtime replacement.');
  return Object.freeze({ allowed: blockers.length === 0, blockers, checkedAt: now.toISOString() });
}

export function assertVmSafetyPreflight(desired, snapshot, now = new Date()) {
  const result = evaluateVmSafetyPreflight(desired, snapshot, now);
  if (!result.allowed) throw new VmSafetyError('VM deployment safety preflight failed.', result.blockers);
  return result;
}
