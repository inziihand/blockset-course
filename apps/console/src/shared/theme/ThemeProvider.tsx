// Adapted from the source platform's ThemeProvider; storage is isolated to StratExec.
import {
  createContext, useContext, useEffect, useLayoutEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import { THEME_STORAGE_KEY } from '../preferences';
import { useSiteSettings } from '../site/SiteSettingsProvider';
export { THEME_STORAGE_KEY } from '../preferences';

export type ThemePreference = 'site' | 'system' | 'light' | 'dark' | 'paper';
export type ResolvedTheme = 'light' | 'dark' | 'paper';
const EXPLICIT_THEME_KEY = 'stratexec:theme-explicit';

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function parsePreference(value: string | null): ThemePreference {
  return value === 'site' || value === 'system' || value === 'light' || value === 'dark' || value === 'paper' ? value : 'system';
}

function getStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === null || (stored === 'system' && window.localStorage.getItem(EXPLICIT_THEME_KEY) !== '1')) return 'site';
    return parsePreference(stored);
  } catch {
    return 'site';
  }
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme) {
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = preference;
}

export function initializeTheme() {
  const preference = getStoredPreference();
  applyTheme(preference, preference === 'system' || preference === 'site' ? getSystemTheme() : preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSiteSettings();
  const [preference, setPreference] = useState<ThemePreference>(getStoredPreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const activePreference = preference === 'site' ? settings.defaultTheme : preference;
  const resolvedTheme = activePreference === 'system' ? systemTheme : activePreference;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', handleChange);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === EXPLICIT_THEME_KEY || event.key === null) setPreference(getStoredPreference());
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      media.removeEventListener('change', handleChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useLayoutEffect(() => applyTheme(preference, resolvedTheme), [preference, resolvedTheme]);

  const choosePreference = (next: ThemePreference) => {
    setPreference(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      window.localStorage.setItem(EXPLICIT_THEME_KEY, '1');
    } catch { /* Theme switching remains available when browser storage is restricted. */ }
  };

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference: choosePreference }), [preference, resolvedTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
