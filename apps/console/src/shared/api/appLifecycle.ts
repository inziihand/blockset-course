export const APP_LIFECYCLE_CHANGED_EVENT = 'stratexec:app-lifecycle-changed';
export const APP_ORDER_CHANGED_EVENT = 'stratexec:app-order-changed';

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
  const entries: InstalledAppCatalog = new Map();
  for (const entry of payload.apps) {
    if (!entry || typeof entry !== 'object') throw new Error('App catalog returned an invalid payload.');
    const { appKey, accessMode } = entry as { appKey?: unknown; accessMode?: unknown };
    if (typeof appKey !== 'string' || typeof accessMode !== 'string'
      || !accessModes.has(accessMode as AppAccessMode) || entries.has(appKey)) {
      throw new Error('App catalog returned an invalid payload.');
    }
    entries.set(appKey, accessMode as AppAccessMode);
  }
  if (entries.size !== payload.appKeys.length
    || payload.appKeys.some((key) => !entries.has(key as string))) {
    throw new Error('App catalog returned an invalid payload.');
  }
  return new Map(payload.appKeys.map((appKey) => [appKey, entries.get(appKey)!]));
}

export async function fetchInstalledAppKeys(request: Request = fetch): Promise<Set<string>> {
  return new Set((await fetchInstalledAppCatalog(request)).keys());
}

/** DEV administrator previews can include uninstalled Apps, so they need the complete saved order. */
export async function fetchRegisteredAppOrder(
  getIdToken: () => Promise<string>, request: Request = fetch,
): Promise<string[]> {
  const token = await getIdToken();
  const response = await request('/api/identity/v1/admin/app-installations', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`App order returned ${response.status}.`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('installations' in payload)
    || !Array.isArray(payload.installations)) throw new Error('App order returned an invalid payload.');
  const keys = payload.installations.map((item: unknown) => (
    item && typeof item === 'object' && 'appKey' in item ? item.appKey : undefined
  ));
  if (keys.some((key: unknown) => typeof key !== 'string') || new Set(keys).size !== keys.length) {
    throw new Error('App order returned an invalid payload.');
  }
  return keys as string[];
}

export function notifyAppLifecycleChanged() {
  window.dispatchEvent(new Event(APP_LIFECYCLE_CHANGED_EVENT));
}

export function notifyAppPolicyChanged() {
  window.dispatchEvent(new Event(APP_LIFECYCLE_CHANGED_EVENT));
}

export function notifyAppOrderChanged(appKeys: string[]) {
  window.dispatchEvent(new CustomEvent(APP_ORDER_CHANGED_EVENT, { detail: { appKeys } }));
}
