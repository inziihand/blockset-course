export const APP_LIFECYCLE_CHANGED_EVENT = 'stratexec:app-lifecycle-changed';

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AppAccessMode = 'public' | 'all_members' | 'grant_required' | 'admins_only' | 'disabled';
export type InstalledAppCatalog = Map<string, AppAccessMode>;

const accessModes = new Set<AppAccessMode>([
  'public', 'all_members', 'grant_required', 'admins_only', 'disabled',
]);

export async function fetchInstalledAppCatalog(request: Request = fetch): Promise<InstalledAppCatalog> {
  const response = await request('/api/identity/v1/apps', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`App catalog returned ${response.status}.`);
  const payload = await response.json() as { appKeys?: unknown; apps?: unknown };
  if (!Array.isArray(payload.appKeys) || payload.appKeys.some((key) => typeof key !== 'string')) {
    throw new Error('App catalog returned an invalid payload.');
  }
  if (!Array.isArray(payload.apps)) throw new Error('App catalog returned an invalid payload.');
  const catalog: InstalledAppCatalog = new Map();
  for (const entry of payload.apps) {
    if (!entry || typeof entry !== 'object') throw new Error('App catalog returned an invalid payload.');
    const { appKey, accessMode } = entry as { appKey?: unknown; accessMode?: unknown };
    if (typeof appKey !== 'string' || typeof accessMode !== 'string'
      || !accessModes.has(accessMode as AppAccessMode) || catalog.has(appKey)) {
      throw new Error('App catalog returned an invalid payload.');
    }
    catalog.set(appKey, accessMode as AppAccessMode);
  }
  if (catalog.size !== payload.appKeys.length
    || payload.appKeys.some((key) => !catalog.has(key as string))) {
    throw new Error('App catalog returned an invalid payload.');
  }
  return catalog;
}

export async function fetchInstalledAppKeys(request: Request = fetch): Promise<Set<string>> {
  return new Set((await fetchInstalledAppCatalog(request)).keys());
}

export function notifyAppLifecycleChanged() {
  window.dispatchEvent(new Event(APP_LIFECYCLE_CHANGED_EVENT));
}

export function notifyAppPolicyChanged() {
  window.dispatchEvent(new Event(APP_LIFECYCLE_CHANGED_EVENT));
}
