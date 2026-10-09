export type SiteTheme = 'system' | 'light' | 'dark' | 'paper';
export type CornerStyle = 'round' | 'square';

export type SiteSettings = {
  title: string;
  subtitle: string;
  logoDataUrl: string | null;
  defaultTheme: SiteTheme;
  cornerStyle: CornerStyle;
};

const environmentValue = (value: string | undefined, fallback: string) => value?.trim() || fallback;

export const defaultSiteSettings: SiteSettings = {
  title: environmentValue(import.meta.env?.VITE_PLATFORM_DISPLAY_NAME, 'BlockSet'),
  subtitle: environmentValue(import.meta.env?.VITE_PLATFORM_TAGLINE, '探索・學習・實作'),
  logoDataUrl: null,
  defaultTheme: 'system',
  cornerStyle: 'round',
};

export const SITE_SETTINGS_PATH = '/api/dev/site-settings';

export function isSiteSettings(value: unknown): value is SiteSettings {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 60
    && typeof item.subtitle === 'string' && item.subtitle.length <= 120
    && (item.logoDataUrl === null || (typeof item.logoDataUrl === 'string'
      && item.logoDataUrl.length <= 350_000
      && /^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.logoDataUrl)))
    && ['system', 'light', 'dark', 'paper'].includes(String(item.defaultTheme))
    && (item.cornerStyle === 'round' || item.cornerStyle === 'square');
}
