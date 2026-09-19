export type IdentityMember = {
  uid: string;
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
  provider: string;
  emailVerified: boolean;
  role: 'member' | 'admin';
  status: 'active' | 'disabled';
  plan: string;
  appGrants: IdentityAppGrant[];
  appAccess: IdentityAppAccess[];
};

export type IdentityAppGrant = {
  appKey: string;
  enabled: boolean;
  roles: string[];
  entitlements: string[];
  source: 'manual' | 'purchase' | 'migration' | 'promotion';
  productKey?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
};

export type IdentityAppAccess = {
  appKey: string;
  allowed: boolean;
  reason: string;
  entitlements: string[];
};

export function hasAppEntitlement(member: IdentityMember | null, appKey: string, entitlement: string) {
  return member?.appAccess.some((access) => (
    access.appKey === appKey && access.allowed && access.entitlements.includes(entitlement)
  )) === true;
}

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class IdentityApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'IdentityApiError';
  }
}

export async function synchronizeIdentitySession(token: string, request: Request = fetch): Promise<IdentityMember> {
  if (!token.trim()) throw new IdentityApiError('Firebase ID Token 不可為空。');
  const response = await request('/api/identity/v1/session', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new IdentityApiError(
      response.status === 401 || response.status === 403
        ? '平台拒絕目前的登入身分。'
        : '平台權限服務暫時無法使用。',
      response.status,
    );
  }
  const member = await response.json() as Partial<IdentityMember>;
  if (!member.uid || !member.email || !['member', 'admin'].includes(member.role ?? '')
    || !['active', 'disabled'].includes(member.status ?? '')
    || !Array.isArray(member.appGrants) || !Array.isArray(member.appAccess)) {
    throw new IdentityApiError('平台權限服務回傳無效會員資料。');
  }
  return member as IdentityMember;
}
