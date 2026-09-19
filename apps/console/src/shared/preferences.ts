/** Existing theme preference keeps its original key and plain-string format. */
export const THEME_STORAGE_KEY = 'stratexec:theme';

export type PreferenceScope = 'platform' | { app: string };
export type PreferenceGuard<T> = (value: unknown) => value is T;

function preferenceKey(scope: PreferenceScope, key: string) {
  const slug = /^[a-z][a-z0-9-]*$/;
  if (typeof key !== 'string' || !slug.test(key)) throw new Error('Preference key must use a lowercase slug');
  if (scope === 'platform') return `stratexec:platform:${key}`;
  if (!scope || typeof scope.app !== 'string' || !slug.test(scope.app)) throw new Error('App preference scope must use a lowercase slug');
  return `stratexec:app:${scope.app}:${key}`;
}

/** Preferences are untrusted, optional UI state; never use them as authorization. */
export function readPreference<T>(scope: PreferenceScope, key: string, parse: PreferenceGuard<T>, fallback: T): T {
  const storageKey = preferenceKey(scope, key);
  try {
    if (typeof window === 'undefined') return fallback;
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return fallback;
    const value: unknown = JSON.parse(stored);
    return parse(value) ? value : fallback;
  } catch {
    // Restricted storage, malformed JSON or an invalid value must not break an App.
    return fallback;
  }
}

/** Returns persistence success; the caller may keep its in-memory preference. */
export function writePreference(scope: PreferenceScope, key: string, value: unknown): boolean {
  const storageKey = preferenceKey(scope, key);
  try {
    if (typeof window === 'undefined') return false;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return false;
    window.localStorage.setItem(storageKey, serialized);
    return true;
  } catch {
    return false;
  }
}
