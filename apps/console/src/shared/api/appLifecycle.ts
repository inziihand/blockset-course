export const APP_LIFECYCLE_CHANGED_EVENT = 'stratexec:app-lifecycle-changed';

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchInstalledAppKeys(request: Request = fetch): Promise<Set<string>> {
  const response = await request('/api/identity/v1/apps', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`App catalog returned ${response.status}.`);
  const payload = await response.json() as { appKeys?: unknown };
  if (!Array.isArray(payload.appKeys) || payload.appKeys.some((key) => typeof key !== 'string')) {
    throw new Error('App catalog returned an invalid payload.');
  }
  return new Set(payload.appKeys);
}

export function notifyAppLifecycleChanged() {
  window.dispatchEvent(new Event(APP_LIFECYCLE_CHANGED_EVENT));
}
