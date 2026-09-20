export class IdentitySourceActivationError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'IdentitySourceActivationError';
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

export function createIdentitySourceClient({
  baseUrl = process.env.STRATEXEC_IDENTITY_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  const origin = normalizeBaseUrl(baseUrl);
  return Object.freeze({
    async activate({ appKey, token, activation }) {
      if (!/^[a-z][a-z0-9-]*$/.test(appKey ?? '') || !token) {
        throw new IdentitySourceActivationError('Source App activation context is invalid.', 422);
      }
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `${origin}/api/identity/v1/admin/app-installations/${encodeURIComponent(appKey)}/source-activation`,
          {
            method: 'POST',
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(activation),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          let detail = '';
          try { detail = String((await response.json())?.detail ?? ''); } catch { /* ignored */ }
          throw new IdentitySourceActivationError(detail || 'Identity API rejected source App activation.', response.status);
        }
        return response.json();
      } catch (error) {
        if (error instanceof IdentitySourceActivationError) throw error;
        throw new IdentitySourceActivationError('Identity API is unavailable during source App activation.', 503);
      } finally {
        clearTimeout(deadline);
      }
    },
  });
}
