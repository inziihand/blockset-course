export class DeploymentAuthorizationError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'DeploymentAuthorizationError';
    this.status = status;
  }
}

export function bearerToken(headers = {}) {
  const authorization = typeof headers.get === 'function'
    ? headers.get('authorization')
    : headers.authorization ?? headers.Authorization;
  const match = /^Bearer ([^\s]+)$/.exec(String(authorization ?? ''));
  if (!match) throw new DeploymentAuthorizationError('Bearer token is required.', 401);
  return match[1];
}

async function identityRequest({ origin, token, path, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const denied = [401, 403, 404].includes(response.status);
      throw new DeploymentAuthorizationError(
        denied ? 'Deployment authorization was rejected.' : 'Identity API is unavailable.',
        denied ? response.status : 503,
      );
    }
    return response.json();
  } catch (error) {
    if (error instanceof DeploymentAuthorizationError) throw error;
    throw new DeploymentAuthorizationError('Identity API is unavailable.', 503);
  } finally {
    clearTimeout(deadline);
  }
}

export function createIdentityDeploymentAuthorizer({
  baseUrl = process.env.STRATEXEC_IDENTITY_BASE_URL || 'http://127.0.0.1:8180',
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  const origin = new URL(baseUrl);
  const loopback = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !loopback) throw new Error('Identity URL must use HTTPS except for loopback development.');
  const normalizedOrigin = origin.toString().replace(/\/$/, '');
  return async function authorizeDeployment(token, appKey) {
    const member = await identityRequest({
      origin: normalizedOrigin, token, path: '/api/identity/v1/me', fetchImpl, timeoutMs,
    });
    if (!member?.uid || !member?.email || member.role !== 'admin'
      || member.status !== 'active' || member.emailVerified !== true) {
      throw new DeploymentAuthorizationError('Active verified administrator access is required.', 403);
    }
    if (appKey) {
      if (!/^[a-z][a-z0-9-]*$/.test(appKey)) throw new DeploymentAuthorizationError('Invalid App key.', 422);
      const access = await identityRequest({
        origin: normalizedOrigin,
        token,
        path: `/api/identity/v1/admin/deployment-access/${encodeURIComponent(appKey)}`,
        fetchImpl,
        timeoutMs,
      });
      if (access?.appKey !== appKey || access.allowed !== true
        || !Array.isArray(access.permissions) || !access.permissions.includes('deployment:manage')) {
        throw new DeploymentAuthorizationError('Administrator is not allowed to manage this App.', 403);
      }
    }
    return {
      uid: member.uid,
      email: member.email,
      permissions: appKey ? ['deployment:manage', `app:${appKey}:access`] : ['deployment:manage'],
    };
  };
}
