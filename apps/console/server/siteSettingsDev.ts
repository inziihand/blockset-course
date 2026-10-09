/** Local DEV site settings. This route is not included in a production server. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { defaultSiteSettings, isSiteSettings, SITE_SETTINGS_PATH, type SiteSettings } from '../src/shared/site/siteSettings';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_BODY_BYTES = 400_000;

function reply(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function validLogo(dataUrl: string | null): boolean {
  if (!dataUrl) return true;
  const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP';
}

export function createSiteSettingsDevHandler(root: string, identityOrigin: string, fetchImpl: typeof fetch = fetch) {
  const folder = join(root, '.stratexec');
  const file = join(folder, 'site-settings.dev.json');
  const readSettings = async (): Promise<SiteSettings> => {
    try {
      const data: unknown = JSON.parse(await readFile(file, 'utf8'));
      return isSiteSettings(data) && validLogo(data.logoDataUrl) ? data : defaultSiteSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSiteSettings;
      throw error;
    }
  };
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = new URL(request.url ?? '/', 'http://local.invalid').pathname;
    if (path !== SITE_SETTINGS_PATH) { next(); return; }
    if (!LOOPBACK.has(request.socket.remoteAddress ?? '')) {
      reply(response, 403, { detail: '網站設定僅供本機存取。' }); return;
    }
    if (request.method === 'GET') {
      try { reply(response, 200, await readSettings()); }
      catch { reply(response, 500, { detail: '無法讀取本機網站設定。' }); }
      return;
    }
    if (request.method !== 'PUT') { reply(response, 405, { detail: '不支援此操作。' }); return; }
    let sameOrigin = false;
    try {
      const origin = new URL(request.headers.origin ?? '');
      sameOrigin = ['http:', 'https:'].includes(origin.protocol)
        && origin.host === request.headers.host;
    } catch { /* Missing or malformed Origin is not a browser same-origin request. */ }
    if (!sameOrigin) {
      reply(response, 403, { detail: '網站設定只能從本機頁面修改。' }); return;
    }
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      reply(response, 415, { detail: '僅接受 JSON 設定。' }); return;
    }
    const bearer = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
    if (!bearer) { reply(response, 401, { detail: '請先登入管理員帳號。' }); return; }
    try {
      const identity = await fetchImpl(`${identityOrigin}/api/identity/v1/me`, {
        headers: { Authorization: `Bearer ${bearer[1]}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (identity.status === 401) { reply(response, 401, { detail: '登入已失效。' }); return; }
      if (!identity.ok) { reply(response, 503, { detail: 'Identity API 暫時無法驗證管理員。' }); return; }
      const member = await identity.json() as { role?: unknown; status?: unknown };
      if (member.role !== 'admin' || member.status !== 'active') {
        reply(response, 403, { detail: '需要有效的管理員權限。' }); return;
      }
      let raw = '';
      for await (const chunk of request) {
        raw += chunk.toString();
        if (raw.length > MAX_BODY_BYTES) { reply(response, 413, { detail: '網站設定或標誌檔案過大。' }); return; }
      }
      const data: unknown = JSON.parse(raw);
      if (!isSiteSettings(data) || !validLogo(data.logoDataUrl)) {
        reply(response, 400, { detail: '網站設定或標誌格式不正確。' }); return;
      }
      const nextSettings: SiteSettings = {
        title: data.title.trim(),
        subtitle: data.subtitle.trim(),
        logoDataUrl: data.logoDataUrl,
        defaultTheme: data.defaultTheme,
        cornerStyle: data.cornerStyle,
      };
      await mkdir(folder, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(nextSettings, null, 2), { encoding: 'utf8', flag: 'w' });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }).catch(() => {}); }
      reply(response, 200, nextSettings);
    } catch {
      reply(response, 500, { detail: '無法儲存本機網站設定，請檢查 Identity API 與檔案權限。' });
    }
  };
}

export function siteSettingsDevPlugin(root: string, identityOrigin: string): Plugin {
  return {
    name: 'stratexec-dev-site-settings',
    configureServer(server) {
      server.middlewares.use(createSiteSettingsDevHandler(root, identityOrigin));
    },
  };
}
