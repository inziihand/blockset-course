const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const serviceKeyPattern = /^[a-z][a-z0-9-]*$/;
const httpsUrl = (value) => {
  if (value == null) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new DeploymentOperationError('Deployment executor returned a non-HTTPS runtime URL.', { indeterminate: true, status: 502 });
  return parsed.toString().replace(/\/$/, '');
};

function safeMessage(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

export class DeploymentOperationError extends Error {
  constructor(message, { indeterminate = false, status = 409 } = {}) {
    super(message);
    this.name = 'DeploymentOperationError';
    this.indeterminate = indeterminate;
    this.status = status;
  }
}

export function createUnavailableDeploymentExecutor() {
  return Object.freeze({
    capabilities: Object.freeze({ mode: 'disabled-until-target-driver', supportedTargets: [] }),
    async apply() { throw new DeploymentOperationError('Runtime deployment driver is disabled.', { status: 501 }); },
    async verify() { throw new DeploymentOperationError('Runtime verification driver is disabled.', { status: 501 }); },
    async promote() { throw new DeploymentOperationError('Runtime traffic promotion driver is disabled.', { status: 501 }); },
    async rollback() { throw new DeploymentOperationError('Runtime rollback driver is disabled.', { status: 501 }); },
    async reconcile() { return { outcome: 'unknown', message: 'No target driver is available for reconciliation.' }; },
  });
}

export function normalizeOperationResult(result) {
  if (!['succeeded', 'failed', 'unknown', 'absent'].includes(result?.outcome)) {
    throw new DeploymentOperationError('Deployment executor returned an invalid outcome.', { indeterminate: true, status: 502 });
  }
  if (result.revision != null && !revisionPattern.test(result.revision)) {
    throw new DeploymentOperationError('Deployment executor returned an invalid revision.', { indeterminate: true, status: 502 });
  }
  if (result.artifactDigest != null && !digestPattern.test(result.artifactDigest)) {
    throw new DeploymentOperationError('Deployment executor returned an invalid artifact digest.', { indeterminate: true, status: 502 });
  }
  const services = result.services == null ? null : result.services.map((service) => {
    if (!serviceKeyPattern.test(service?.serviceKey ?? '') || !revisionPattern.test(service?.revision ?? '')) {
      throw new DeploymentOperationError('Deployment executor returned invalid service evidence.', { indeterminate: true, status: 502 });
    }
    const imageDigest = service.imageDigest ?? null;
    if (imageDigest != null && !digestPattern.test(imageDigest)) {
      throw new DeploymentOperationError('Deployment executor returned an invalid service image digest.', { indeterminate: true, status: 502 });
    }
    return {
      ...structuredClone(service),
      imageDigest,
      serviceUrl: httpsUrl(service.serviceUrl),
      candidateUrl: httpsUrl(service.candidateUrl),
    };
  });
  return {
    outcome: result.outcome,
    revision: result.revision ?? null,
    artifactDigest: result.artifactDigest ?? null,
    message: safeMessage(result.message),
    services,
    hosting: result.hosting ? structuredClone(result.hosting) : null,
  };
}

export function maskDeploymentError(error, fallback) {
  return safeMessage(error instanceof Error ? error.message : fallback) ?? fallback;
}
