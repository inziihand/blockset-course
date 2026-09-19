export class DeploymentPlanProviderError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'DeploymentPlanProviderError';
    this.status = status;
  }
}

export function createPackageAgentPlanProvider({
  baseUrl = process.env.STRATEXEC_APP_PACKAGE_AGENT_BASE_URL || 'http://127.0.0.1:8182',
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  const origin = new URL(baseUrl);
  const loopback = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !loopback) throw new Error('Package Agent URL must use HTTPS except for loopback development.');
  const normalizedOrigin = origin.toString().replace(/\/$/, '');
  return async function providePlan({ packageJobId, installationKey, token }) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(
        `${normalizedOrigin}/api/app-packages/v1/jobs/${encodeURIComponent(packageJobId)}/deployment-plan?installationKey=${encodeURIComponent(installationKey)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new DeploymentPlanProviderError(
          typeof body.error === 'string' ? body.error : 'Package Agent could not produce a deployment plan.',
          [401, 403, 404, 409, 422].includes(response.status) ? response.status : 503,
        );
      }
      if (body?.mode !== 'read-only' || body?.planKind !== 'app-runtime-impact'
        || !/^[a-f0-9]{64}$/.test(body.planFingerprint ?? '')) {
        throw new DeploymentPlanProviderError('Package Agent returned an invalid deployment plan.', 502);
      }
      return body;
    } catch (error) {
      if (error instanceof DeploymentPlanProviderError) throw error;
      throw new DeploymentPlanProviderError('Package Agent is unavailable.', 503);
    } finally {
      clearTimeout(deadline);
    }
  };
}
