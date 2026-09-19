export class AdminAuthorizationError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'AdminAuthorizationError';
    this.status = status;
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value || 'http://127.0.0.1:8180');
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('STRATEXEC_IDENTITY_BASE_URL must use HTTPS, except for loopback development.');
  }
  return url.toString().replace(/\/$/, '');
}

export function bearerToken(headers = {}) {
  const authorization = typeof headers.get === 'function'
    ? headers.get('authorization')
    : headers.authorization ?? headers.Authorization;
  const match = /^Bearer ([^\s]+)$/.exec(String(authorization ?? ''));
  if (!match) throw new AdminAuthorizationError('Bearer token is required.', 401);
  return match[1];
}

export function createIdentityAdminAuthorizer({
  baseUrl = process.env.STRATEXEC_IDENTITY_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  const origin = normalizeBaseUrl(baseUrl);
  return async function authorizeAdmin(token) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${origin}/api/identity/v1/me`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const denied = [401, 403].includes(response.status);
        throw new AdminAuthorizationError(
          denied ? 'Administrator authentication was rejected.' : 'Identity API is unavailable.',
          denied ? response.status : 503,
        );
      }
      const member = await response.json();
      if (!member?.uid || !member?.email || member.role !== 'admin'
        || member.status !== 'active' || member.emailVerified !== true) {
        throw new AdminAuthorizationError('Active verified administrator access is required.', 403);
      }
      return { uid: member.uid, email: member.email };
    } catch (error) {
      if (error instanceof AdminAuthorizationError) throw error;
      throw new AdminAuthorizationError('Identity API is unavailable.', 503);
    } finally {
      clearTimeout(deadline);
    }
  };
}
