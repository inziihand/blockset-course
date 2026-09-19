import type { IdentityAppGrant, IdentityMember } from '../../shared/auth/identityClient';

export type AppAccessMode = 'public' | 'all_members' | 'grant_required' | 'admins_only' | 'disabled';
export type AppEntitlement = { key: string; displayName: string; description?: string | null };

export type AppPolicy = {
  appKey: string;
  displayName: string;
  accessMode: AppAccessMode;
  allowedAccessModes: AppAccessMode[];
  entitlements: AppEntitlement[];
  adminAllowed: boolean;
  protected: boolean;
  updatedAt: string;
  updatedBy?: string | null;
};

export type MemberPatch = { role?: 'member' | 'admin'; status?: 'active' | 'disabled' };
export type AppGrantPatch = Pick<IdentityAppGrant, 'enabled'>
  & Partial<Pick<IdentityAppGrant, 'source' | 'productKey' | 'validFrom' | 'validUntil'>>
  & { roles?: string[]; entitlements?: string[] };
export type AppPolicyPatch = Pick<AppPolicy, 'accessMode' | 'adminAllowed'>;
export type AppInstallationStatus = 'installed' | 'disabled' | 'uninstalled';
export type AppLifecycleAction = 'install' | 'disable' | 'enable' | 'uninstall';
export type AppInstallation = {
  appKey: string;
  displayName: string;
  status: AppInstallationStatus;
  category: 'core' | 'sample' | 'application';
  removable: boolean;
  protected: boolean;
  requiredServices: string[];
  deploymentJobId?: string | null;
  runtimeRevision?: string | null;
  runtimeVerifiedAt?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
};

export type AccessControlApi = {
  listMembers(signal?: AbortSignal): Promise<IdentityMember[]>;
  listPolicies(signal?: AbortSignal): Promise<AppPolicy[]>;
  listInstallations(signal?: AbortSignal): Promise<AppInstallation[]>;
  updateMember(uid: string, patch: MemberPatch, signal?: AbortSignal): Promise<IdentityMember>;
  setGrant(uid: string, appKey: string, patch: AppGrantPatch, signal?: AbortSignal): Promise<IdentityMember>;
  setPolicy(appKey: string, patch: AppPolicyPatch, signal?: AbortSignal): Promise<AppPolicy>;
  updateInstallation(appKey: string, action: AppLifecycleAction, signal?: AbortSignal): Promise<AppInstallation>;
};

type GetToken = (forceRefresh?: boolean) => Promise<string>;
type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createAccessControlApi(getToken: GetToken, request: Request = fetch): AccessControlApi {
  const send = async <T>(path: string, init: RequestInit = {}, signal?: AbortSignal) => {
    const token = await getToken();
    const response = await request(`/api/identity/v1/admin/${path}`, {
      ...init,
      signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.json() as { detail?: unknown }).detail ?? ''); } catch { /* ignored */ }
      throw new Error(detail || `會員權限服務回應 ${response.status}。`);
    }
    return response.json() as Promise<T>;
  };

  return {
    async listMembers(signal) {
      const result = await send<{ members: IdentityMember[] }>('members', {}, signal);
      if (!Array.isArray(result.members)) throw new Error('會員清單格式不正確。');
      return result.members;
    },
    async listPolicies(signal) {
      const result = await send<{ policies: AppPolicy[] }>('app-policies', {}, signal);
      if (!Array.isArray(result.policies)) throw new Error('App 權限清單格式不正確。');
      return result.policies;
    },
    async listInstallations(signal) {
      const result = await send<{ installations: AppInstallation[] }>('app-installations', {}, signal);
      if (!Array.isArray(result.installations)) throw new Error('App 安裝清單格式不正確。');
      return result.installations;
    },
    updateMember(uid, patch, signal) {
      return send<IdentityMember>(`members/${encodeURIComponent(uid)}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      }, signal);
    },
    setGrant(uid, appKey, patch, signal) {
      return send<IdentityMember>(`members/${encodeURIComponent(uid)}/app-grants/${encodeURIComponent(appKey)}`, {
        method: 'PUT', body: JSON.stringify({ roles: [], entitlements: [], source: 'manual', ...patch }),
      }, signal);
    },
    setPolicy(appKey, patch, signal) {
      return send<AppPolicy>(`app-policies/${encodeURIComponent(appKey)}`, {
        method: 'PUT', body: JSON.stringify(patch),
      }, signal);
    },
    updateInstallation(appKey, action, signal) {
      return send<AppInstallation>(`app-installations/${encodeURIComponent(appKey)}`, {
        method: 'PUT', body: JSON.stringify({ action }),
      }, signal);
    },
  };
}
