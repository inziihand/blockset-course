import { createPublicKey, verify } from 'node:crypto';

const keyPattern = /^[a-z][a-z0-9-]{1,62}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const forbidden = new Set(['args', 'command', 'commands', 'entrypoint', 'hook', 'hooks', 'script', 'scripts', 'shell']);

export class DesiredStateError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'DesiredStateError';
    this.status = status;
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DesiredStateError(`${label} must be an object.`);
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new DesiredStateError(`${label} contains unsupported fields: ${extras.join(', ')}.`);
}

function scanForbidden(value, path = 'desiredState') {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(key.toLowerCase())) throw new DesiredStateError(`${path}.${key} is forbidden; VM Agent never accepts shell instructions.`);
    scanForbidden(item, `${path}.${key}`);
  }
}

export function validateDesiredState(state, now = new Date()) {
  scanForbidden(state);
  exactKeys(state, [
    'schemaVersion', 'generation', 'operation', 'issuedAt', 'expiresAt', 'installationKey', 'hostRef',
    'serviceKey', 'revision', 'image', 'runtime', 'data', 'account', 'bindings', 'preflight', 'trading',
  ], 'desiredState');
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.generation) || state.generation < 1) {
    throw new DesiredStateError('Desired state requires schemaVersion 1 and a positive integer generation.');
  }
  if (!['deploy', 'rollback'].includes(state.operation)) throw new DesiredStateError('Desired state operation must be deploy or rollback.');
  if (!keyPattern.test(state.installationKey ?? '') || !keyPattern.test(state.serviceKey ?? '')
    || !revisionPattern.test(state.revision ?? '') || !/^gce:\/\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9-]+\/[a-z][a-z0-9-]{0,62}$/.test(state.hostRef ?? '')) {
    throw new DesiredStateError('Desired state installation, host, service or revision is invalid.');
  }
  const issuedAt = new Date(state.issuedAt);
  const expiresAt = new Date(state.expiresAt);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= issuedAt
    || issuedAt.getTime() > now.getTime() + 60_000 || expiresAt.getTime() < now.getTime()
    || expiresAt.getTime() - issuedAt.getTime() > 15 * 60_000) {
    throw new DesiredStateError('Desired state issue/expiry window is invalid or expired.', 409);
  }
  exactKeys(state.image, ['uri', 'digest'], 'desiredState.image');
  if (!digestPattern.test(state.image.digest ?? '') || !String(state.image.uri ?? '').endsWith(`@${state.image.digest}`)) {
    throw new DesiredStateError('VM deployment requires an immutable image URI with the matching sha256 digest.');
  }
  exactKeys(state.runtime, ['containerName', 'runAsUser', 'readOnlyRootFilesystem', 'restartPolicy', 'environmentFile'], 'desiredState.runtime');
  if (!keyPattern.test(state.runtime.containerName ?? '') || !/^\d{1,10}:\d{1,10}$/.test(state.runtime.runAsUser ?? '')
    || state.runtime.readOnlyRootFilesystem !== true || state.runtime.restartPolicy !== 'unless-stopped'
    || state.runtime.environmentFile !== `${state.data?.mountPath}/runtime.env`) {
    throw new DesiredStateError('VM runtime must use a non-root UID:GID, read-only root filesystem and unless-stopped restart policy.');
  }
  exactKeys(state.data, ['mountPath', 'minimumFreeBytes', 'backupRequired', 'backupMaxAgeSeconds'], 'desiredState.data');
  if (!/^\/var\/lib\/stratexec\/[a-z0-9][a-z0-9._/-]*$/.test(state.data.mountPath ?? '')
    || String(state.data.mountPath).split('/').includes('..') || !Number.isSafeInteger(state.data.minimumFreeBytes)
    || state.data.minimumFreeBytes < 1_073_741_824 || typeof state.data.backupRequired !== 'boolean'
    || !Number.isSafeInteger(state.data.backupMaxAgeSeconds) || state.data.backupMaxAgeSeconds < 60) {
    throw new DesiredStateError('VM data volume policy is invalid.');
  }
  exactKeys(state.account, ['scope', 'lockPath'], 'desiredState.account');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(state.account.scope ?? '')
    || state.account.lockPath !== `${state.data.mountPath}/account.lock`) {
    throw new DesiredStateError('Account scope and host-local account lock are required.');
  }
  exactKeys(state.bindings, ['configuration', 'secrets'], 'desiredState.bindings');
  if (!Array.isArray(state.bindings.configuration) || !Array.isArray(state.bindings.secrets)) {
    throw new DesiredStateError('VM runtime bindings must be arrays.');
  }
  for (const item of state.bindings.configuration) {
    exactKeys(item, ['name', 'value'], 'desiredState.bindings.configuration[]');
    if (!/^[A-Z][A-Z0-9_]*$/.test(item.name ?? '') || typeof item.value !== 'string' || item.value.length > 4096
      || /[\0\r\n]/.test(item.value)) throw new DesiredStateError('VM runtime configuration binding is invalid.');
  }
  const projectId = String(state.hostRef).split('/')[2];
  for (const item of state.bindings.secrets) {
    exactKeys(item, ['environment', 'resource', 'version'], 'desiredState.bindings.secrets[]');
    if (!/^[A-Z][A-Z0-9_]*$/.test(item.environment ?? '')
      || !new RegExp(`^projects/${projectId}/secrets/[a-z][a-z0-9-]*/versions/[1-9][0-9]*$`).test(item.resource ?? '')
      || String(item.version) !== String(item.resource).split('/').at(-1)) {
      throw new DesiredStateError('VM secret binding must reference a concrete version in the installation project.');
    }
  }
  exactKeys(state.preflight, [
    'allowedSqliteSchemaVersions', 'expectedOpenOrders', 'expectedPositionFingerprint',
    'requireReconciliation', 'requireAgentLease', 'requireBackup',
  ], 'desiredState.preflight');
  if (!Array.isArray(state.preflight.allowedSqliteSchemaVersions) || state.preflight.allowedSqliteSchemaVersions.length === 0
    || state.preflight.allowedSqliteSchemaVersions.some((item) => !Number.isSafeInteger(item) || item < 1)
    || !Number.isSafeInteger(state.preflight.expectedOpenOrders) || state.preflight.expectedOpenOrders < 0
    || !/^[a-f0-9]{64}$/.test(state.preflight.expectedPositionFingerprint ?? '')
    || state.preflight.requireReconciliation !== true || state.preflight.requireAgentLease !== true
    || state.preflight.requireBackup !== state.data.backupRequired) {
    throw new DesiredStateError('VM safety preflight contract is invalid.');
  }
  exactKeys(state.trading, ['mode', 'activationRequired'], 'desiredState.trading');
  if (state.trading.mode !== 'disabled' || state.trading.activationRequired !== true) {
    throw new DesiredStateError('App deployment cannot authorize PAPER or LIVE trading.');
  }
  return structuredClone(state);
}

export function createDesiredStateVerifier({ keys, now = () => new Date() }) {
  const trusted = new Map((keys ?? []).filter((item) => item.status === 'trusted').map((item) => [item.keyId, item]));
  return Object.freeze({
    verify(envelope) {
      exactKeys(envelope, ['desiredState', 'signature'], 'envelope');
      exactKeys(envelope.signature, ['algorithm', 'keyId', 'value'], 'envelope.signature');
      if (envelope.signature.algorithm !== 'Ed25519' || !keyPattern.test(envelope.signature.keyId ?? '')) {
        throw new DesiredStateError('Desired state signature metadata is invalid.', 401);
      }
      const key = trusted.get(envelope.signature.keyId);
      if (!key) throw new DesiredStateError('Desired state signing key is not trusted or has been revoked.', 403);
      let signature;
      try { signature = Buffer.from(envelope.signature.value, 'base64'); } catch { throw new DesiredStateError('Desired state signature is invalid.', 401); }
      const payload = Buffer.from(`stratexec-vm-desired-state-v1\0${canonicalJson(envelope.desiredState)}`);
      if (signature.length !== 64 || !verify(null, payload, createPublicKey(key.publicKeyPem), signature)) {
        throw new DesiredStateError('Desired state signature verification failed.', 401);
      }
      return validateDesiredState(envelope.desiredState, now());
    },
  });
}
