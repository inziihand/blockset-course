import { describe, expect, test, vi } from 'vitest';
import { fetchInstalledAppKeys } from '../src/shared/api/appLifecycle';

describe('App lifecycle catalog', () => {
  test('loads the server-owned installed App set', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      appKeys: ['access-control', 'premium-course'],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await fetchInstalledAppKeys(request);

    expect([...result]).toEqual(['access-control', 'premium-course']);
    expect(request).toHaveBeenCalledWith('/api/identity/v1/apps', expect.objectContaining({ cache: 'no-store' }));
  });

  test('rejects an invalid catalog instead of guessing installation state', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ appKeys: [42] }), { status: 200 }));

    await expect(fetchInstalledAppKeys(request)).rejects.toThrow('invalid payload');
  });
});
