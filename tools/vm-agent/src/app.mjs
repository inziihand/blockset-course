import { DesiredStateError } from './desired-state.mjs';
import { VmAgentOperationError } from './agent-service.mjs';
import { VmSafetyError } from './safety-preflight.mjs';

const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
const response = (status, body) => ({ status, body, headers });

export function createVmAgentApp({ service }) {
  return async ({ method = 'GET', url = '/', body = Buffer.alloc(0), peerAuthorized = false }) => {
    const path = new URL(url, 'https://vm-agent.local').pathname;
    if (path === '/health/live' && method === 'GET') return response(200, { status: 'ok', service: 'vm-agent' });
    if (!peerAuthorized) return response(401, { error: 'VM Agent requires an authenticated mTLS peer.' });
    try {
      if (path === '/api/vm-agent/v1/state' && method === 'GET') return response(200, await service.status());
      if (path === '/api/vm-agent/v1/desired-state' && method === 'PUT') {
        let payload;
        try { payload = JSON.parse(Buffer.from(body).toString('utf8')); } catch { throw new DesiredStateError('Request body must be valid JSON.'); }
        return response(200, await service.apply(payload));
      }
      if (path === '/api/vm-agent/v1/reconcile' && method === 'POST') return response(200, await service.reconcile());
      return response(404, { error: 'VM Agent route was not found.' });
    } catch (error) {
      const known = error instanceof DesiredStateError || error instanceof VmSafetyError || error instanceof VmAgentOperationError;
      return response(known ? error.status ?? 409 : 500, {
        error: known ? error.message : 'VM Agent operation failed.',
        ...(error instanceof VmSafetyError ? { blockers: error.blockers } : {}),
      });
    }
  };
}
