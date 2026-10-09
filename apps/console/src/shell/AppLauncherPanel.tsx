import { isLaunchableDefinition } from './appRegistry';
import { BrandMark } from './Brand';
import { useSiteSettings } from '../shared/site/SiteSettingsProvider';
import type { ShellAppDefinition, ShellAppKey } from './types';

export default function AppLauncherPanel({ apps, onSelectApp }: { apps: readonly ShellAppDefinition[]; onSelectApp: (key: ShellAppKey) => void }) {
  const { settings } = useSiteSettings();
  return (
    <section className="launcher-panel card" aria-labelledby="launcher-title">
      <div className="launcher-mark"><BrandMark size={30} /></div>
      <p className="eyebrow">{settings.title.toUpperCase()} PLATFORM</p>
      <h2 id="launcher-title">你的策略工作空間</h2>
      {apps.length === 0 ? (
        <>
          <p className="launcher-description">目前尚未加入應用程式。</p>
          <p className="launcher-hint">加入後，即可從首頁或左側選單開啟。</p>
          <span className="empty-label">0 個應用程式</span>
        </>
      ) : (
        <div className="launcher-app-list">
          {apps.map((app) => {
            const Icon = app.icon;
            const launchable = isLaunchableDefinition(app);
            return (
              <button key={app.key} type="button" className="launcher-app" disabled={!launchable} onClick={() => onSelectApp(app.key)}>
                <Icon size={22} aria-hidden="true" />
                <b>{app.title}</b>
                <span>{app.description}</span>
                {!launchable && <small>尚未開放</small>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
