import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Box, RotateCcw, Upload } from 'lucide-react';
import { Button, Field } from '../../shared/ui/controls';
import { useSiteSettings } from '../../shared/site/SiteSettingsProvider';
import { defaultSiteSettings, isSiteSettings, type SiteSettings, type SiteTheme } from '../../shared/site/siteSettings';

const themes: { value: SiteTheme; label: string }[] = [
  { value: 'system', label: '跟隨系統' },
  { value: 'light', label: '淺色' },
  { value: 'dark', label: '深色' },
  { value: 'paper', label: '暖紙' },
];

export function SiteManagementPanel({ getIdToken }: { getIdToken?: () => Promise<string> }) {
  const { settings, available, save } = useSiteSettings();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<SiteSettings>(settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(settings); }, [settings]);
  const update = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const chooseLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/webp'].includes(file.type) || file.size > 250_000) {
      setError('標誌請使用 250 KB 以下的 PNG 或 WebP 檔案。'); return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('無法讀取圖檔。'));
        reader.readAsDataURL(file);
      });
      update('logoDataUrl', dataUrl);
      setError('');
    } catch { setError('無法讀取圖檔。'); }
  };
  const submit = async () => {
    setError('');
    setSaved(false);
    const next = { ...draft, title: draft.title.trim(), subtitle: draft.subtitle.trim() };
    if (!isSiteSettings(next)) { setError('請填寫 1–60 字標題與最多 120 字副標題。'); return; }
    if (!getIdToken) { setError('目前無法取得管理員登入憑證。'); return; }
    setPending(true);
    try {
      await save(next, await getIdToken());
      setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '無法儲存網站設定。'); }
    finally { setPending(false); }
  };

  return <div className="access-site-management">
    <header>
      <h3>網站管理</h3>
      <p>調整 DEV 網站識別與預設外觀。設定儲存在本機，不會部署至 GCP。</p>
    </header>
    {!available && <p className="access-control-error" role="status">此功能僅在 DEV 本機開發伺服器提供。</p>}
    <div className="access-site-grid">
      <section className="access-site-card" aria-labelledby="access-site-brand-title">
        <h4 id="access-site-brand-title">網站識別</h4>
        <div className="access-site-logo-preview">
          {draft.logoDataUrl ? <img src={draft.logoDataUrl} alt="網站標誌預覽" /> : <Box size={28} strokeWidth={1.7} aria-hidden="true" />}
          <span><strong>{draft.title || '網站標題'} <em>course</em></strong><small>{draft.subtitle || '網站副標題'}</small></span>
        </div>
        <div className="access-site-logo-actions">
          <Button onClick={() => logoInputRef.current?.click()} disabled={!available || pending}><Upload size={15} aria-hidden="true" />上傳標誌</Button>
          <input ref={logoInputRef} type="file" accept="image/png,image/webp" onChange={event => void chooseLogo(event)} disabled={!available || pending} hidden />
          <Button disabled={!available || pending || !draft.logoDataUrl} onClick={() => update('logoDataUrl', null)}>使用預設圖示</Button>
        </div>
        <small>PNG 或 WebP，最大 250 KB。course 標記固定顯示。</small>
        <Field label="網站標題" required maxLength={60} value={draft.title} onChange={event => update('title', event.target.value)} disabled={!available || pending} />
        <Field label="網站副標題" maxLength={120} value={draft.subtitle} onChange={event => update('subtitle', event.target.value)} disabled={!available || pending} />
      </section>
      <section className="access-site-card" aria-labelledby="access-site-appearance-title">
        <h4 id="access-site-appearance-title">網站預設外觀</h4>
        <p>配色供尚未選擇個人外觀的使用者使用；個人選擇仍優先。邊角造型套用全站。</p>
        <fieldset>
          <legend>預設配色</legend>
          <div className="access-site-options">
            {themes.map(option => <label key={option.value}>
              <input type="radio" name="site-default-theme" checked={draft.defaultTheme === option.value}
                onChange={() => update('defaultTheme', option.value)} disabled={!available || pending} />{option.label}
            </label>)}
          </div>
        </fieldset>
        <fieldset>
          <legend>邊角造型</legend>
          <div className="access-site-options">
            <label><input type="radio" name="site-corner-style" checked={draft.cornerStyle === 'round'}
              onChange={() => update('cornerStyle', 'round')} disabled={!available || pending} />圓角</label>
            <label><input type="radio" name="site-corner-style" checked={draft.cornerStyle === 'square'}
              onChange={() => update('cornerStyle', 'square')} disabled={!available || pending} />直角</label>
          </div>
        </fieldset>
      </section>
    </div>
    <div className="access-site-actions">
      <Button onClick={() => { setDraft(defaultSiteSettings); setSaved(false); }} disabled={!available || pending}>
        <RotateCcw size={15} aria-hidden="true" />還原預設值
      </Button>
      <Button onClick={() => void submit()} disabled={!available || pending || !getIdToken}>
        {pending ? '儲存中…' : '儲存網站設定'}
      </Button>
    </div>
    {error && <p className="access-control-error" role="alert">{error}</p>}
    {saved && <p className="access-site-saved" role="status">已儲存並套用至 DEV 本機網站。</p>}
  </div>;
}
