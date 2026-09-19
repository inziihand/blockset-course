import { bearerToken, createIdentityDeploymentAuthorizer, DeploymentAuthorizationError } from './authorizer.mjs';
import { DeploymentJobError } from './deployment-job-service.mjs';
import { DeploymentSettingsError } from './deployment-settings-service.mjs';

const responseHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};
const response = (status, body, extraHeaders = {}) => ({ status, body, headers: { ...responseHeaders, ...extraHeaders } });

function parseJsonBody(body) {
  try { return JSON.parse(Buffer.from(body ?? []).toString('utf8')); }
  catch { throw new DeploymentJobError('Request body must be valid JSON.'); }
}

function jobRoute(pathname) {
  const match = pathname.match(/^\/api\/deployments\/v1\/jobs\/([^/]+)(?:\/(plan|approve|apply|verify|promote|rollback|reconcile|cancel|activate|events|evidence))?$/);
  return match ? { jobId: match[1], action: match[2] ?? null } : null;
}

function settingsRoute(pathname) {
  const base = pathname.match(/^\/api\/deployments\/v1\/installations\/([^/]+)\/(platform-settings|apps\/([^/]+)\/settings)(?:\/services\/([^/]+)\/(configuration|secrets)\/([^/]+)(?:\/(versions|reference|rollback|delete))?(?:\/([^/]+)\/(disable))?)?(?:\/(bindings))?$/);
  if (!base) return null;
  return {
    installationKey: decodeURIComponent(base[1]),
    platform: base[2] === 'platform-settings',
    appKey: base[2] === 'platform-settings' ? 'platform' : decodeURIComponent(base[3]),
    serviceKey: base[4] ? decodeURIComponent(base[4]) : null,
    fieldKind: base[5] ?? null,
    environment: base[6] ? decodeURIComponent(base[6]) : null,
    action: base[7] ?? (base[10] ? 'bindings' : null),
    version: base[8] ? decodeURIComponent(base[8]) : null,
    versionAction: base[9] ?? null,
  };
}

export function createDeploymentAgentApp({ jobs, settings, authorizeDeployment = createIdentityDeploymentAuthorizer() }) {
  if (!jobs) throw new Error('Deployment Agent app requires a job service.');
  return async function handle({ method = 'GET', url = '/', headers = {}, body = Buffer.alloc(0) }) {
    const requestUrl = new URL(url, 'http://127.0.0.1');
    if (method === 'GET' && requestUrl.pathname === '/healthz') {
      return response(200, { status: 'ok', service: 'deployment-agent', policy: jobs.policy() });
    }
    if (!requestUrl.pathname.startsWith('/api/deployments/v1/')) {
      return response(404, { error: '找不到 Deployment Agent API。' });
    }
    let token;
    let actor;
    try {
      token = bearerToken(headers);
      actor = await authorizeDeployment(token);
    } catch (error) {
      const status = error instanceof DeploymentAuthorizationError ? error.status : 503;
      return response(status, {
        error: status === 401 ? '請先登入。' : status === 403 ? '需要有效的平台部署管理權限。' : '平台權限服務暫時無法使用。',
      }, status === 401 ? { 'WWW-Authenticate': 'Bearer realm="deployment-agent"' } : {});
    }

    try {
      const settingsRequest = settingsRoute(requestUrl.pathname);
      if (settingsRequest) {
        if (!settings) return response(503, { error: 'Deployment settings service is unavailable.' });
        if (!settingsRequest.platform) actor = await authorizeDeployment(token, settingsRequest.appKey);
        const scope = {
          installationKey: settingsRequest.installationKey,
          appKey: settingsRequest.appKey,
          platform: settingsRequest.platform,
          actor,
        };
        if (!settingsRequest.serviceKey && method === 'GET') {
          return response(200, settingsRequest.platform
            ? await settings.getPlatformSettings(scope)
            : await settings.getAppSettings(scope));
        }
        if (settingsRequest.action === 'bindings' && method === 'GET' && !settingsRequest.platform) {
          return response(200, await settings.resolveBindings(scope));
        }
        const field = {
          ...scope,
          serviceKey: settingsRequest.serviceKey,
          environment: settingsRequest.environment,
        };
        const payload = body?.byteLength ? parseJsonBody(body) : {};
        if (settingsRequest.fieldKind === 'configuration' && !settingsRequest.action && method === 'PUT') {
          return response(200, await settings.setConfiguration({
            ...field, configuredValue: payload.configuredValue, confirmation: payload.confirmation,
          }));
        }
        if (settingsRequest.fieldKind === 'secrets' && settingsRequest.action === 'versions' && method === 'POST') {
          return response(201, await settings.createSecretVersion({ ...field, secretValue: payload.secretValue }));
        }
        if (settingsRequest.fieldKind === 'secrets' && settingsRequest.action === 'reference' && method === 'PUT') {
          return response(200, await settings.setSecretReference({
            ...field, secretResource: payload.secretResource, version: payload.version, confirmation: payload.confirmation,
          }));
        }
        if (settingsRequest.fieldKind === 'secrets' && settingsRequest.versionAction === 'disable' && method === 'POST') {
          return response(200, await settings.disableSecretVersion({
            ...field, version: settingsRequest.version, confirmation: payload.confirmation,
          }));
        }
        if (settingsRequest.fieldKind === 'secrets' && settingsRequest.action === 'rollback' && method === 'POST') {
          return response(200, await settings.rollbackSecretReference({
            ...field, version: payload.version, confirmation: payload.confirmation,
          }));
        }
        if (settingsRequest.fieldKind === 'secrets' && settingsRequest.action === 'delete' && method === 'DELETE') {
          return response(200, await settings.deleteSecret({ ...field, confirmation: payload.confirmation }));
        }
        return response(405, { error: '不支援的 Deployment Settings 方法。' });
      }
      if (method === 'GET' && requestUrl.pathname === '/api/deployments/v1/jobs') {
        return response(200, { jobs: await jobs.listJobs() });
      }
      if (method === 'POST' && requestUrl.pathname === '/api/deployments/v1/inspect') {
        const payload = parseJsonBody(body);
        actor = await authorizeDeployment(token, payload.appKey);
        return response(201, await jobs.inspect({
          packageJobId: payload.packageJobId,
          installationKey: payload.installationKey,
          appKey: payload.appKey,
          token,
          actor,
        }));
      }
      const route = jobRoute(requestUrl.pathname);
      if (!route) return response(404, { error: '找不到 Deployment Agent API。' });
      const existing = await jobs.getJob(route.jobId);
      actor = await authorizeDeployment(token, existing.appKey);
      if (method === 'GET' && route.action === null) return response(200, existing);
      if (method === 'GET' && route.action === 'events') return response(200, { events: await jobs.events(route.jobId) });
      if (method === 'GET' && route.action === 'evidence') return response(200, await jobs.evidence(route.jobId));
      if (method !== 'POST') return response(405, { error: '不支援的 Deployment Agent 方法。' }, { Allow: route.action ? 'POST' : 'GET' });
      const payload = body?.byteLength ? parseJsonBody(body) : {};
      if (route.action === 'plan') return response(200, await jobs.plan({ jobId: route.jobId, token, actor }));
      if (route.action === 'approve') return response(200, await jobs.approve({ jobId: route.jobId, ...payload, actor }));
      if (route.action === 'apply') return response(200, await jobs.apply({ jobId: route.jobId, token, actor }));
      if (route.action === 'verify') return response(200, await jobs.verify({ jobId: route.jobId, actor, token }));
      if (route.action === 'promote') return response(200, await jobs.promote({ jobId: route.jobId, confirmation: payload.confirmation, actor }));
      if (route.action === 'rollback') return response(200, await jobs.rollback({ jobId: route.jobId, confirmation: payload.confirmation, actor }));
      if (route.action === 'reconcile') return response(200, await jobs.reconcile({ jobId: route.jobId, actor }));
      if (route.action === 'cancel') return response(200, await jobs.cancel({ jobId: route.jobId, actor }));
      if (route.action === 'activate') return response(200, await jobs.activate({ jobId: route.jobId, confirmation: payload.confirmation, token, actor }));
      return response(404, { error: '找不到 Deployment Agent API。' });
    } catch (error) {
      const status = Number(error?.status) || 500;
      const publicMessage = error instanceof DeploymentJobError || error instanceof DeploymentAuthorizationError
        || error instanceof DeploymentSettingsError
        ? error.message
        : 'Deployment Agent 工作失敗。';
      return response(status, { error: publicMessage });
    }
  };
}
