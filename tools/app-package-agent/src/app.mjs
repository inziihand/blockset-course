import { AdminAuthorizationError, bearerToken, createIdentityAdminAuthorizer } from './admin-authorizer.mjs';
import { PackageJobError } from './package-job-service.mjs';

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

const response = (status, body, extraHeaders = {}) => ({ status, body, headers: { ...headers, ...extraHeaders } });

function header(requestHeaders, name) {
  if (typeof requestHeaders?.get === 'function') return requestHeaders.get(name);
  return requestHeaders?.[name] ?? requestHeaders?.[name.toLowerCase()] ?? requestHeaders?.[name.toUpperCase()];
}

function booleanQuery(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) return false;
  if (value !== 'true' && value !== 'false') throw new PackageJobError(`${name} must be true or false.`);
  return value === 'true';
}

function parseJsonBody(body) {
  try { return JSON.parse(Buffer.from(body ?? []).toString('utf8')); }
  catch { throw new PackageJobError('Request body must be valid JSON.'); }
}

export function createPackageAgentApp({ jobs, authorizeAdmin = createIdentityAdminAuthorizer() }) {
  if (!jobs) throw new Error('Package Agent app requires a job service.');
  return async function handle({ method = 'GET', url = '/', headers: requestHeaders = {}, body = Buffer.alloc(0) }) {
    const requestUrl = new URL(url, 'http://127.0.0.1');
    if (method === 'GET' && requestUrl.pathname === '/healthz') {
      return response(200, { status: 'ok', service: 'app-package-agent', policy: jobs.policy() });
    }
    if (!requestUrl.pathname.startsWith('/api/app-packages/v1/')) {
      return response(404, { error: '找不到 App 套件管理 API。' });
    }
    let actor;
    let token;
    try {
      token = bearerToken(requestHeaders);
      actor = await authorizeAdmin(token);
    } catch (error) {
      const status = error instanceof AdminAuthorizationError ? error.status : 503;
      return response(status, { error: status === 401 ? '請先登入。' : status === 403 ? '需要平台管理員權限。' : '平台權限服務暫時無法使用。' },
        status === 401 ? { 'WWW-Authenticate': 'Bearer realm="app-package-agent"' } : {});
    }
    try {
      if (method === 'GET' && requestUrl.pathname === '/api/app-packages/v1/jobs') {
        return response(200, { jobs: await jobs.listJobs() });
      }
      if (method === 'POST' && requestUrl.pathname === '/api/app-packages/v1/inspect') {
        const fileName = header(requestHeaders, 'x-stratexec-package-name');
        const job = await jobs.inspect({
          content: Buffer.from(body),
          fileName,
          actor,
          adoptExisting: booleanQuery(requestUrl, 'adoptExisting'),
          allowDowngrade: booleanQuery(requestUrl, 'allowDowngrade'),
        });
        return response(201, job);
      }
      const deploymentPlanMatch = requestUrl.pathname.match(/^\/api\/app-packages\/v1\/jobs\/([^/]+)\/deployment-plan$/);
      if (method === 'GET' && deploymentPlanMatch) {
        const installationKey = requestUrl.searchParams.get('installationKey');
        if (!installationKey) throw new PackageJobError('installationKey is required.');
        return response(200, await jobs.planDeployment({ jobId: deploymentPlanMatch[1], installationKey, actor }));
      }
      const applyMatch = requestUrl.pathname.match(/^\/api\/app-packages\/v1\/jobs\/([^/]+)\/apply$/);
      if (method === 'POST' && applyMatch) {
        const payload = parseJsonBody(body);
        const job = await jobs.apply({ jobId: applyMatch[1], confirmation: payload.confirmation, actor, token });
        return response(200, job);
      }
      const frontendReleaseMatch = requestUrl.pathname.match(/^\/api\/app-packages\/v1\/jobs\/([^/]+)\/frontend-release$/);
      if (method === 'POST' && frontendReleaseMatch) {
        const payload = parseJsonBody(body);
        return response(200, await jobs.installAndPublish({
          jobId: frontendReleaseMatch[1], confirmation: payload.confirmation,
          installationKey: payload.installationKey, actor, token,
        }));
      }
      const sourceActivationMatch = requestUrl.pathname.match(/^\/api\/app-packages\/v1\/jobs\/([^/]+)\/source-activation$/);
      if (method === 'POST' && sourceActivationMatch) {
        return response(200, await jobs.activateSource({ jobId: sourceActivationMatch[1], actor, token }));
      }
      return response(404, { error: '找不到 App 套件管理 API。' });
    } catch (error) {
      const status = error instanceof PackageJobError ? error.status : 500;
      return response(status, { error: error instanceof Error ? error.message : 'App 套件工作失敗。' });
    }
  };
}
