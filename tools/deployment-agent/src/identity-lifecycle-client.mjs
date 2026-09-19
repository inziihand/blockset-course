export class IdentityLifecycleError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'IdentityLifecycleError';
    this.status = status;
  }
}

export function createIdentityLifecycleClient({
  baseUrl = process.env.STRATEXEC_IDENTITY_BASE_URL || 'http://127.0.0.1:8180',
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  const origin = new URL(baseUrl);
  const loopback = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !loopback) throw new Error('Identity URL must use HTTPS except for loopback development.');
  const normalizedOrigin = origin.toString().replace(/\/$/, '');
  return Object.freeze({
    async activate({ appKey, token, activation }) {
      if (!/^[a-z][a-z0-9-]*$/.test(appKey ?? '') || !token) {
        throw new IdentityLifecycleError('Verified App activation context is invalid.', 422);
      }
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `${normalizedOrigin}/api/identity/v1/admin/app-installations/${encodeURIComponent(appKey)}/verified-activation`,
          {
            method: 'POST',
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(activation),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          let detail = '';
          try { detail = String((await response.json())?.detail ?? ''); } catch { /* ignore */ }
          throw new IdentityLifecycleError(detail || 'Identity API rejected verified App activation.', response.status);
        }
        return response.json();
      } catch (error) {
        if (error instanceof IdentityLifecycleError) throw error;
        throw new IdentityLifecycleError('Identity API is unavailable during verified App activation.', 503);
      } finally { clearTimeout(deadline); }
    },
  });
}
