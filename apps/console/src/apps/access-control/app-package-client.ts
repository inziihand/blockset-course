export type AppPackageChangeAction = 'add' | 'update' | 'delete' | 'unchanged';
export type AppPackageJobStatus = 'ready' | 'blocked' | 'applying' | 'succeeded' | 'failed' | 'no-op';

export type AppPackageJob = {
  schemaVersion: 1;
  jobId: string;
  fileName: string;
  status: AppPackageJobStatus;
  appKey: string;
  version: string;
  previousVersion?: string | null;
  installStatus: 'new' | 'update' | 'downgrade' | 'no-op';
  packageSha256: string;
  planFingerprint: string;
  planContext: {
    platformContractDigest: string;
    serviceRegistryDigest: string;
    packageLockDigest: string;
    installationContextDigest: string;
  };
  signatureStatus: 'development-unsigned' | 'trusted-signed';
  publisherId?: string | null;
  keyId?: string | null;
  signedContentDigest?: string | null;
  applyAllowed: boolean;
  confirmation: string;
  blockers: string[];
  changes: Array<{ path: string; action: AppPackageChangeAction }>;
  options: { adoptExisting: boolean; allowDowngrade: boolean };
  createdAt: string;
  updatedAt: string;
  createdBy: { uid: string; email: string };
  appliedBy?: { uid: string; email: string };
  error?: string;
  result?: { applied: boolean };
};

export type AppPackageInspectOptions = {
  adoptExisting: boolean;
  allowDowngrade: boolean;
};

export type AppPackageApi = {
  listJobs(signal?: AbortSignal): Promise<AppPackageJob[]>;
  inspectPackage(file: File, options: AppPackageInspectOptions, signal?: AbortSignal): Promise<AppPackageJob>;
  applyJob(jobId: string, confirmation: string, signal?: AbortSignal): Promise<AppPackageJob>;
};

type GetToken = (forceRefresh?: boolean) => Promise<string>;
type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function safeHeaderFileName(name: string) {
  const normalized = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return normalized.toLowerCase().endsWith('.zip') ? normalized : `${normalized}.zip`;
}

export function createAppPackageApi(getToken: GetToken, request: Request = fetch): AppPackageApi {
  const send = async <T>(path: string, init: RequestInit = {}, signal?: AbortSignal) => {
    const token = await getToken();
    const response = await request(`/api/app-packages/v1/${path}`, {
      ...init,
      signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('此環境尚未啟動本機 App Package Agent。');
    }
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.json() as { error?: unknown }).error ?? ''); } catch { /* ignored */ }
      throw new Error(detail || `App 套件代理回應 ${response.status}。`);
    }
    return response.json() as Promise<T>;
  };

  return {
    async listJobs(signal) {
      const result = await send<{ jobs: AppPackageJob[] }>('jobs', {}, signal);
      if (!Array.isArray(result.jobs)) throw new Error('App 套件工作清單格式不正確。');
      return result.jobs;
    },
    inspectPackage(file, options, signal) {
      const query = new URLSearchParams({
        adoptExisting: String(options.adoptExisting),
        allowDowngrade: String(options.allowDowngrade),
      });
      return send<AppPackageJob>(`inspect?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'X-StratExec-Package-Name': safeHeaderFileName(file.name),
        },
        body: file,
      }, signal);
    },
    applyJob(jobId, confirmation, signal) {
      return send<AppPackageJob>(`jobs/${encodeURIComponent(jobId)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      }, signal);
    },
  };
}
