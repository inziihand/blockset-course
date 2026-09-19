import { request as httpsRequest } from 'node:https';

export class VmAgentClientError extends Error {
  constructor(message, { status = 503, indeterminate = false } = {}) {
    super(message);
    this.name = 'VmAgentClientError';
    this.status = status;
    this.indeterminate = indeterminate;
  }
}

export function createMtlsJsonRequest({ certificate, privateKey, certificateAuthority, requestImpl = httpsRequest, timeoutMs = 30_000 }) {
  if (!certificate || !privateKey || !certificateAuthority) throw new Error('VM Agent client requires mTLS certificate, private key and CA.');
  return ({ method, url, body }) => new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const request = requestImpl(new URL(url), {
      method, cert: certificate, key: privateKey, ca: certificateAuthority, rejectUnauthorized: true,
      minVersion: 'TLSv1.3', timeout: timeoutMs,
      headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.byteLength } : {}) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* handled below */ }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new VmAgentClientError(typeof parsed.error === 'string' ? parsed.error : 'VM Agent rejected the request.', { status: response.statusCode }));
        } else resolve(parsed);
      });
    });
    request.on('timeout', () => request.destroy(new VmAgentClientError('VM Agent request timed out.', { indeterminate: method !== 'GET' })));
    request.on('error', (error) => reject(error instanceof VmAgentClientError ? error
      : new VmAgentClientError('VM Agent connection failed.', { indeterminate: method !== 'GET' })));
    if (payload) request.write(payload);
    request.end();
  });
}

export function createVmAgentClient({ baseUrl, request }) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:') throw new Error('VM Agent endpoint must use HTTPS with mTLS.');
  const send = (method, path, body) => request({ method, url: new URL(path, `${origin.toString().replace(/\/$/, '')}/`).toString(), body });
  return Object.freeze({
    state: () => send('GET', '/api/vm-agent/v1/state'),
    apply: (envelope) => send('PUT', '/api/vm-agent/v1/desired-state', envelope),
    reconcile: () => send('POST', '/api/vm-agent/v1/reconcile'),
  });
}
