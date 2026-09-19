export type DeploymentSettingValue = string | number | boolean;

export type DeploymentSettingInput = {
  label: string;
  type: 'string' | 'integer' | 'boolean' | 'select';
  required: boolean;
  impact: 'normal' | 'high';
  description: string | null;
  default?: DeploymentSettingValue;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  options?: Array<{ value: string; label: string }>;
};

export type DeploymentSecretReference = {
  secretResource: string;
  version: string;
  state: string;
  createTime: string | null;
  updatedAt: string;
  updatedBy: { uid: string; email: string };
};

export type DeploymentSettingsDocument = {
  schemaVersion: 1;
  scope: 'app' | 'platform';
  installation: { installationKey: string; projectId: string; region: string };
  appKey: string;
  appVersion: string;
  secretManagerMode: 'disabled' | 'gcp-secret-manager';
  platformConfiguration: {
    managedSeparately?: boolean;
    endpoint?: string;
    oauthBrandDisplayName?: string | null;
    supportEmail?: string | null;
    authorizedDomains?: string[];
    note?: string;
  };
  services: Array<{
    serviceKey: string;
    configuration: Array<{
      name: string;
      source: 'project-id' | 'service-url' | 'operator-input';
      purpose: string;
      input: DeploymentSettingInput | null;
      current: { configuredValue: DeploymentSettingValue; updatedAt: string; updatedBy: { uid: string; email: string } } | null;
    }>;
    secrets: Array<{
      environment: string;
      secretName: string;
      temporary: boolean;
      purpose: string;
      writeOnly: true;
      current: DeploymentSecretReference | null;
      versions: Array<{ version: string; state: string; createTime: string | null; destroyTime: string | null; etag: string | null }>;
    }>;
  }>;
  stateRevision: number;
};

export type DeploymentSettingsApi = {
  getAppSettings(installationKey: string, appKey: string, signal?: AbortSignal): Promise<DeploymentSettingsDocument>;
  getPlatformSettings(installationKey: string, signal?: AbortSignal): Promise<DeploymentSettingsDocument>;
  setConfiguration(installationKey: string, appKey: string, serviceKey: string, environment: string,
    configuredValue: DeploymentSettingValue, confirmation?: string, signal?: AbortSignal): Promise<unknown>;
  createSecretVersion(installationKey: string, appKey: string, serviceKey: string, environment: string,
    secretValue: string, signal?: AbortSignal): Promise<DeploymentSecretReference>;
  setSecretReference(installationKey: string, appKey: string, serviceKey: string, environment: string,
    input: { secretResource: string; version: string; confirmation: string }, signal?: AbortSignal): Promise<DeploymentSecretReference>;
  disableSecretVersion(installationKey: string, appKey: string, serviceKey: string, environment: string,
    version: string, confirmation: string, signal?: AbortSignal): Promise<unknown>;
  rollbackSecret(installationKey: string, appKey: string, serviceKey: string, environment: string,
    version: string, confirmation: string, signal?: AbortSignal): Promise<DeploymentSecretReference>;
  deleteSecret(installationKey: string, appKey: string, serviceKey: string, environment: string,
    confirmation: string, signal?: AbortSignal): Promise<unknown>;
};

type GetToken = (forceRefresh?: boolean) => Promise<string>;
type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createDeploymentSettingsApi(getToken: GetToken, request: Request = fetch): DeploymentSettingsApi {
  const send = async <T>(path: string, init: RequestInit = {}, signal?: AbortSignal) => {
    const token = await getToken();
    const response = await request(`/api/deployments/v1/${path}`, {
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
      throw new Error('此環境尚未啟動 Deployment Agent。');
    }
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.json() as { error?: unknown }).error ?? ''); } catch { /* ignored */ }
      throw new Error(detail || `Deployment Agent 回應 ${response.status}。`);
    }
    return response.json() as Promise<T>;
  };
  const base = (installationKey: string, appKey: string) => (
    `installations/${encodeURIComponent(installationKey)}/apps/${encodeURIComponent(appKey)}/settings`
  );
  const field = (installationKey: string, appKey: string, serviceKey: string, kind: 'configuration' | 'secrets', environment: string) => (
    `${base(installationKey, appKey)}/services/${encodeURIComponent(serviceKey)}/${kind}/${encodeURIComponent(environment)}`
  );
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    getAppSettings(installationKey, appKey, signal) {
      return send<DeploymentSettingsDocument>(base(installationKey, appKey), {}, signal);
    },
    getPlatformSettings(installationKey, signal) {
      return send<DeploymentSettingsDocument>(`installations/${encodeURIComponent(installationKey)}/platform-settings`, {}, signal);
    },
    setConfiguration(installationKey, appKey, serviceKey, environment, configuredValue, confirmation, signal) {
      return send(field(installationKey, appKey, serviceKey, 'configuration', environment),
        json('PUT', { configuredValue, confirmation }), signal);
    },
    createSecretVersion(installationKey, appKey, serviceKey, environment, secretValue, signal) {
      return send<DeploymentSecretReference>(`${field(installationKey, appKey, serviceKey, 'secrets', environment)}/versions`,
        json('POST', { secretValue }), signal);
    },
    setSecretReference(installationKey, appKey, serviceKey, environment, input, signal) {
      return send<DeploymentSecretReference>(`${field(installationKey, appKey, serviceKey, 'secrets', environment)}/reference`,
        json('PUT', input), signal);
    },
    disableSecretVersion(installationKey, appKey, serviceKey, environment, version, confirmation, signal) {
      return send(`${field(installationKey, appKey, serviceKey, 'secrets', environment)}/versions/${encodeURIComponent(version)}/disable`,
        json('POST', { confirmation }), signal);
    },
    rollbackSecret(installationKey, appKey, serviceKey, environment, version, confirmation, signal) {
      return send<DeploymentSecretReference>(`${field(installationKey, appKey, serviceKey, 'secrets', environment)}/rollback`,
        json('POST', { version, confirmation }), signal);
    },
    deleteSecret(installationKey, appKey, serviceKey, environment, confirmation, signal) {
      return send(`${field(installationKey, appKey, serviceKey, 'secrets', environment)}/delete`,
        json('DELETE', { confirmation }), signal);
    },
  };
}
