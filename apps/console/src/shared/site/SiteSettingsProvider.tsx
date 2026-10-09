import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultSiteSettings, isSiteSettings, SITE_SETTINGS_PATH, type SiteSettings } from './siteSettings';

type SiteSettingsContextValue = {
  settings: SiteSettings;
  available: boolean;
  save: (settings: SiteSettings, token: string) => Promise<void>;
};

const fallback: SiteSettingsContextValue = {
  settings: defaultSiteSettings,
  available: false,
  save: async () => { throw new Error('網站設定服務尚未就緒。'); },
};
const SiteSettingsContext = createContext<SiteSettingsContextValue>(fallback);

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultSiteSettings);
  const localMode = import.meta.env.DEV && import.meta.env.MODE === 'development';
  const [available, setAvailable] = useState(localMode);
  const refresh = useCallback(async () => {
    try {
      let data: unknown;
      if (localMode) {
        const response = await fetch(SITE_SETTINGS_PATH, { cache: 'no-store' });
        if (!response.ok) throw new Error('本機網站設定無法讀取。');
        data = await response.json();
      } else {
        data = await (await import('./siteSettingsStore')).loadPublishedSiteSettings();
      }
      if (!isSiteSettings(data)) throw new Error('網站設定格式不正確。');
      setSettings(data);
      setAvailable(true);
    } catch { setAvailable(false); }
  }, [localMode]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  useLayoutEffect(() => {
    document.documentElement.dataset.cornerStyle = settings.cornerStyle;
  }, [settings.cornerStyle]);
  useLayoutEffect(() => {
    if (!available) return;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      icon.href = settings.logoDataUrl ?? '/brand/stratexec-mark.svg';
      icon.type = settings.logoDataUrl?.startsWith('data:image/webp') ? 'image/webp'
        : settings.logoDataUrl ? 'image/png' : 'image/svg+xml';
    }
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = `${settings.title} course｜${settings.subtitle}`;
  }, [available, settings.logoDataUrl, settings.title, settings.subtitle]);

  const save = useCallback(async (next: SiteSettings, token: string) => {
    if (!available) throw new Error('網站設定服務尚未就緒。');
    if (!isSiteSettings(next)) throw new Error('網站設定內容不符合格式。');
    let data: unknown;
    if (localMode) {
      const response = await fetch(SITE_SETTINGS_PATH, {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(next),
      });
      data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(
        data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
          ? data.detail : `網站設定儲存失敗（${response.status}）。`,
      );
    } else {
      data = await (await import('./siteSettingsStore')).publishSiteSettings(next);
    }
    if (!isSiteSettings(data)) throw new Error('網站設定回應格式錯誤。');
    setSettings(data);
  }, [available, localMode]);

  const value = useMemo(() => ({ settings, available, save }), [settings, available, save]);
  return <SiteSettingsContext.Provider value={value}>{children}</SiteSettingsContext.Provider>;
}

export function useSiteSettings() { return useContext(SiteSettingsContext); }
