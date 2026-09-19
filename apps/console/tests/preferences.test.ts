import { describe, expect, it, vi } from 'vitest';
import { readPreference, THEME_STORAGE_KEY, writePreference } from '../src/shared/preferences';

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

describe('Scoped UI preferences', () => {
  it('isolates platform and App preferences, including Apps with the same key', () => {
    expect(writePreference('platform', 'display', 'compact')).toBe(true);
    expect(writePreference({ app: 'alpha' }, 'display', 'comfortable')).toBe(true);
    expect(writePreference({ app: 'beta' }, 'display', 'dense')).toBe(true);
    expect(window.localStorage.getItem('stratexec:platform:display')).toBe('"compact"');
    expect(window.localStorage.getItem('stratexec:app:alpha:display')).toBe('"comfortable"');
    expect(window.localStorage.getItem('stratexec:app:beta:display')).toBe('"dense"');
    expect(readPreference('platform', 'display', isString, 'fallback')).toBe('compact');
    expect(readPreference({ app: 'alpha' }, 'display', isString, 'fallback')).toBe('comfortable');
    expect(readPreference({ app: 'beta' }, 'display', isString, 'fallback')).toBe('dense');
  });

  it('returns the supplied fallback for a missing value without creating settings', () => {
    expect(readPreference('platform', 'enabled', isBoolean, false)).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it('preserves false and zero rather than confusing them with missing values', () => {
    const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    writePreference('platform', 'enabled', false);
    writePreference('platform', 'offset', 0);
    expect(readPreference('platform', 'enabled', isBoolean, true)).toBe(false);
    expect(readPreference('platform', 'offset', isNumber, 100)).toBe(0);
  });

  it('accepts structured values only when the caller-provided guard validates them', () => {
    type View = { columns: string[] };
    const isView = (value: unknown): value is View => {
      if (typeof value !== 'object' || value === null || !('columns' in value)) return false;
      return Array.isArray(value.columns) && value.columns.every((column: unknown) => typeof column === 'string');
    };
    const fallback = { columns: [] };
    writePreference({ app: 'alpha' }, 'view', { columns: ['name', 'status'] });
    expect(readPreference({ app: 'alpha' }, 'view', isView, fallback)).toEqual({ columns: ['name', 'status'] });
    writePreference({ app: 'alpha' }, 'view', { columns: [123] });
    expect(readPreference({ app: 'alpha' }, 'view', isView, fallback)).toBe(fallback);
  });

  it.each(['not json', '{"unfinished":', 'null', '123', '{"unexpected":true}'])(
    'falls back on malformed JSON or a value rejected by its type guard: %s',
    (stored) => {
      window.localStorage.setItem('stratexec:platform:display', stored);
      expect(readPreference('platform', 'display', isString, 'default')).toBe('default');
    },
  );

  it('falls back if a caller parser throws', () => {
    writePreference('platform', 'display', 'compact');
    const unsafeGuard = (_value: unknown): _value is string => { throw new Error('invalid data'); };
    expect(readPreference('platform', 'display', unsafeGuard, 'default')).toBe('default');
  });

  it('survives browser storage read errors and denied or full storage writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(readPreference('platform', 'display', isString, 'default')).toBe('default');
    expect(writePreference('platform', 'display', 'compact')).toBe(false);
  });

  it('handles a denied localStorage getter before accessing any storage method', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(readPreference('platform', 'display', isString, 'default')).toBe('default');
    expect(writePreference('platform', 'display', 'compact')).toBe(false);
  });

  it('can be imported and invoked without a browser window', () => {
    vi.stubGlobal('window', undefined);
    expect(readPreference('platform', 'display', isString, 'default')).toBe('default');
    expect(writePreference('platform', 'display', 'compact')).toBe(false);
  });

  it('does not overwrite a saved preference when serialization fails', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    writePreference('platform', 'display', 'compact');
    expect(writePreference('platform', 'display', circular)).toBe(false);
    expect(writePreference('platform', 'display', undefined)).toBe(false);
    expect(writePreference('platform', 'display', 1n)).toBe(false);
    expect(readPreference('platform', 'display', isString, 'default')).toBe('compact');
  });

  it.each(['', 'has:separator', '../theme', 'has space', 'UpperCase'])(
    'rejects an unsafe preference key before accessing storage: %s',
    (key) => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      expect(() => readPreference('platform', key, isString, 'default')).toThrow();
      expect(() => writePreference('platform', key, 'value')).toThrow();
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'alpha:display', '../alpha', 'Alpha'])(
    'rejects an unsafe App namespace: %s',
    (app) => {
      expect(() => readPreference({ app }, 'display', isString, 'default')).toThrow();
      expect(() => writePreference({ app }, 'display', 'value')).toThrow();
    },
  );

  it('preserves the existing raw-string theme key and the source-project namespace', () => {
    expect(THEME_STORAGE_KEY).toBe('stratexec:theme');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'paper');
    window.localStorage.setItem('kernel-market-theme', 'dark');
    writePreference('platform', 'theme', 'light');
    writePreference({ app: 'alpha' }, 'theme', 'system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('paper');
    expect(window.localStorage.getItem('kernel-market-theme')).toBe('dark');
    expect(readPreference('platform', 'theme', isString, 'default')).toBe('light');
  });
});
