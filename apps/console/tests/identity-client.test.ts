import { describe, expect, test, vi } from 'vitest';
import { hasAppEntitlement, IdentityApiError, synchronizeIdentitySession } from '../src/shared/auth/identityClient';

describe('Identity session client', () => {
  test('sends the Firebase ID Token only to the same-origin session endpoint', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      uid: 'admin-1', email: 'admin@example.com', provider: 'google.com', emailVerified: true,
      role: 'admin', status: 'active', plan: 'free', appGrants: [], appAccess: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const member = await synchronizeIdentitySession('verified-token', request);

    expect(member.role).toBe('admin');
    expect(request).toHaveBeenCalledWith('/api/identity/v1/session', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer verified-token' }),
    }));
  });

  test('does not accept an empty token', async () => {
    await expect(synchronizeIdentitySession(' ', vi.fn())).rejects.toThrow('不可為空');
  });

  test('checks a server-resolved App feature entitlement', () => {
    const member = {
      uid: 'member-1', email: 'member@example.com', provider: 'google.com', emailVerified: true,
      role: 'member' as const, status: 'active' as const, plan: 'free', appGrants: [],
      appAccess: [{ appKey: 'course-app', allowed: true, reason: 'all_members', entitlements: ['course'] }],
    };

    expect(hasAppEntitlement(member, 'course-app', 'course')).toBe(true);
    expect(hasAppEntitlement(member, 'course-app', 'greeks')).toBe(false);
    expect(hasAppEntitlement(null, 'course-app', 'course')).toBe(false);
  });

  test('keeps backend authorization failures explicit', async () => {
    const request = vi.fn(async () => new Response('{}', { status: 403 }));
    await expect(synchronizeIdentitySession('token', request)).rejects.toMatchObject<Partial<IdentityApiError>>({
      status: 403,
      message: '平台拒絕目前的登入身分。',
    });
  });

  test('rejects malformed member responses', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ uid: 'member-1' }), { status: 200 }));
    await expect(synchronizeIdentitySession('token', request)).rejects.toThrow('無效會員資料');
  });
});
