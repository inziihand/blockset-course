import { describe, expect, test, vi } from 'vitest';
import { fetchInstalledAppCatalog, fetchInstalledAppKeys, fetchRegisteredAppOrder } from '../src/shared/api/appLifecycle';

describe('App lifecycle catalog', () => {
  test('loads the server-owned installed App set', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      appKeys: ['access-control', 'premium-course'],
      apps: [
        { appKey: 'access-control', accessMode: 'admins_only' },
        { appKey: 'premium-course', accessMode: 'grant_required' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const catalog = await fetchInstalledAppCatalog(request);

    expect([...catalog]).toEqual([
      ['access-control', 'admins_only'],
      ['premium-course', 'grant_required'],
    ]);
    expect(request).toHaveBeenCalledWith('/api/identity/v1/apps', expect.objectContaining({ cache: 'no-store' }));
  });

  test('keeps the installed-key compatibility helper on the policy-aware catalog', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      appKeys: ['public-demo'],
      apps: [{ appKey: 'public-demo', accessMode: 'public' }],
    }), { status: 200 }));

    expect([...(await fetchInstalledAppKeys(request))]).toEqual(['public-demo']);
  });

  test('uses appKeys as the canonical display order', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      appKeys: ['premium-course', 'access-control'],
      apps: [
        { appKey: 'access-control', accessMode: 'admins_only' },
        { appKey: 'premium-course', accessMode: 'grant_required' },
      ],
    }), { status: 200 }));

    expect([...(await fetchInstalledAppCatalog(request)).keys()]).toEqual([
      'premium-course', 'access-control',
    ]);
  });

  test('rejects an invalid catalog instead of guessing installation state', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      appKeys: ['premium-course'],
      apps: [{ appKey: 'different-app', accessMode: 'grant_required' }],
    }), { status: 200 }));

    await expect(fetchInstalledAppCatalog(request)).rejects.toThrow('invalid payload');
  });

  test('loads complete administrator order including an uninstalled preview', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ installations: [
      { appKey: 'deristrat-console', status: 'uninstalled' },
      { appKey: 'taifex-console', status: 'installed' },
    ] }), { status: 200 }));
    expect(await fetchRegisteredAppOrder(async () => 'firebase-id-token', request)).toEqual([
      'deristrat-console', 'taifex-console',
    ]);
    expect(request).toHaveBeenCalledWith('/api/identity/v1/admin/app-installations', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer firebase-id-token' },
      cache: 'no-store',
    }));
  });
});
