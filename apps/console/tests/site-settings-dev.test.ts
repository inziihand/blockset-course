import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSiteSettingsDevHandler } from '../server/siteSettingsDev';
import { defaultSiteSettings } from '../src/shared/site/siteSettings';

let server: Server | null = null;
let directory = '';

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = null;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('DEV site settings route', () => {
  it('keeps settings local and requires an active Identity administrator for writes', async () => {
    directory = await mkdtemp(join(tmpdir(), 'stratexec-site-test-'));
    let role = 'member';
    const identityFetch = vi.fn(async () => new Response(JSON.stringify({ role, status: 'active' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
    const handler = createSiteSettingsDevHandler(directory, 'http://127.0.0.1:8180', identityFetch);
    server = createServer((request, response) => { void handler(request, response, () => response.end()); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server address unavailable');
    const base = `http://127.0.0.1:${address.port}`;
    const get = async () => fetch(`${base}/api/dev/site-settings`).then(response => response.json());
    const put = (body: unknown, token?: string) => fetch(`${base}/api/dev/site-settings`, {
      method: 'PUT',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    expect(await get()).toEqual(defaultSiteSettings);
    expect((await put(defaultSiteSettings)).status).toBe(401);
    expect((await put(defaultSiteSettings, 'member-token')).status).toBe(403);
    role = 'admin';
    const updated = { ...defaultSiteSettings, title: '新網站', defaultTheme: 'paper', cornerStyle: 'square' };
    expect((await put(updated, 'admin-token')).status).toBe(200);
    expect(await get()).toEqual(updated);
    expect((await put({ ...updated, logoDataUrl: 'data:image/png;base64,AAAA' }, 'admin-token')).status).toBe(400);
    expect(await get()).toEqual(updated);
    expect(identityFetch).toHaveBeenCalledWith('http://127.0.0.1:8180/api/identity/v1/me', expect.objectContaining({
      headers: { Authorization: 'Bearer admin-token' },
    }));
  });
});
