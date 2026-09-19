export type DeploymentJobStatus =
  | 'blocked' | 'awaiting-approval' | 'approved' | 'applying' | 'applied'
  | 'verifying' | 'staged-verified' | 'promoting' | 'verified'
  | 'failed' | 'verification-failed' | 'promotion-failed' | 'unknown'
  | 'rolling-back' | 'rollback-failed' | 'rolled-back' | 'cancelled';

export type DeploymentJob = {
  jobId: string;
  packageJobId: string;
  appKey: string;
  status: DeploymentJobStatus;
  package: { appKey: string; version: string; packageSha256: string; signatureStatus: string };
  installation: { installationKey: string; projectId: string; region: string };
  planFingerprint: string;
  plan: {
    app?: { displayName?: string; requiredServices?: string[] };
    services: Array<{ serviceKey: string; selectedTarget: string; serviceName?: string; region?: string }>;
    warnings?: string[];
  };
  blockers: string[];
  requiredRiskConfirmations: string[];
  approval?: { expiresAt: string } | null;
  runtimeEvidence?: {
    revision?: string; artifactDigest?: string; appliedAt?: string;
    services?: Array<{
      serviceKey: string; revision: string; imageDigest?: string; vmHostRef?: string;
      runtimeStatus?: { vm?: string; agent?: string; worker?: string; strategy?: string; tradingEnabled?: boolean };
    }>;
  } | null;
  verificationEvidence?: {
    revision?: string; verifiedAt?: string;
    services?: Array<{
      serviceKey: string; revision: string; imageDigest?: string; vmHostRef?: string;
      runtimeStatus?: { vm?: string; agent?: string; worker?: string; strategy?: string; tradingEnabled?: boolean };
    }>;
  } | null;
  promotionEvidence?: { revision?: string; promotedAt?: string } | null;
  activationEvidence?: { activatedAt?: string; status?: string; runtimeRevision?: string } | null;
  lastError?: string | null;
  revision: number;
  updatedAt: string;
};

export type DeploymentEvidence = Record<string, unknown> & { jobId: string; status: string };
export type DeploymentEvent = { sequence: number; type: string; at: string; status?: string; outcome?: string };

type GetToken = (forceRefresh?: boolean) => Promise<string>;
type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DeploymentApi = {
  listJobs(signal?: AbortSignal): Promise<DeploymentJob[]>;
  inspect(packageJobId: string, installationKey: string, appKey: string, signal?: AbortSignal): Promise<DeploymentJob>;
  plan(jobId: string, signal?: AbortSignal): Promise<DeploymentJob>;
  approve(job: DeploymentJob, confirmation: string, signal?: AbortSignal): Promise<DeploymentJob>;
  apply(jobId: string, signal?: AbortSignal): Promise<DeploymentJob>;
  verify(jobId: string, signal?: AbortSignal): Promise<DeploymentJob>;
  promote(jobId: string, confirmation: string, signal?: AbortSignal): Promise<DeploymentJob>;
  rollback(jobId: string, confirmation: string, signal?: AbortSignal): Promise<DeploymentJob>;
  reconcile(jobId: string, signal?: AbortSignal): Promise<DeploymentJob>;
  cancel(jobId: string, signal?: AbortSignal): Promise<DeploymentJob>;
  activate(jobId: string, confirmation: string, signal?: AbortSignal): Promise<DeploymentJob>;
  evidence(jobId: string, signal?: AbortSignal): Promise<DeploymentEvidence>;
  events(jobId: string, signal?: AbortSignal): Promise<DeploymentEvent[]>;
};

export function createDeploymentApi(getToken: GetToken, request: Request = fetch): DeploymentApi {
  const send = async <T>(path: string, init: RequestInit = {}, signal?: AbortSignal) => {
    const token = await getToken();
    const response = await request(`/api/deployments/v1/${path}`, {
      ...init,
      signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json', Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers,
      },
    });
    if (!response.ok) {
      let message = '';
      try { message = String((await response.json() as { error?: unknown }).error ?? ''); } catch { /* ignore */ }
      throw new Error(message || `Deployment Agent 回應 ${response.status}。`);
    }
    return response.json() as Promise<T>;
  };
  const action = (jobId: string, name: string, body?: object, signal?: AbortSignal) => send<DeploymentJob>(
    `jobs/${encodeURIComponent(jobId)}/${name}`,
    { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }, signal,
  );
  return {
    async listJobs(signal) {
      const result = await send<{ jobs: DeploymentJob[] }>('jobs', {}, signal);
      if (!Array.isArray(result.jobs)) throw new Error('部署工作清單格式不正確。');
      return result.jobs;
    },
    inspect: (packageJobId, installationKey, appKey, signal) => send('inspect', {
      method: 'POST', body: JSON.stringify({ packageJobId, installationKey, appKey }),
    }, signal),
    plan: (jobId, signal) => action(jobId, 'plan', undefined, signal),
    approve: (job, confirmation, signal) => action(job.jobId, 'approve', {
      confirmation,
      planFingerprint: job.planFingerprint,
      packageSha256: job.package.packageSha256,
      appVersion: job.package.version,
      riskConfirmations: job.requiredRiskConfirmations,
    }, signal),
    apply: (jobId, signal) => action(jobId, 'apply', undefined, signal),
    verify: (jobId, signal) => action(jobId, 'verify', undefined, signal),
    promote: (jobId, confirmation, signal) => action(jobId, 'promote', { confirmation }, signal),
    rollback: (jobId, confirmation, signal) => action(jobId, 'rollback', { confirmation }, signal),
    reconcile: (jobId, signal) => action(jobId, 'reconcile', undefined, signal),
    cancel: (jobId, signal) => action(jobId, 'cancel', undefined, signal),
    activate: (jobId, confirmation, signal) => action(jobId, 'activate', { confirmation }, signal),
    evidence: (jobId, signal) => send(`jobs/${encodeURIComponent(jobId)}/evidence`, {}, signal),
    async events(jobId, signal) {
      const result = await send<{ events: DeploymentEvent[] }>(`jobs/${encodeURIComponent(jobId)}/events`, {}, signal);
      if (!Array.isArray(result.events)) throw new Error('部署事件格式不正確。');
      return result.events;
    },
  };
}
