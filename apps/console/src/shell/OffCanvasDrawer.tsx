import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Settings, X } from 'lucide-react';
import { isLaunchableDefinition } from './appRegistry';
import { BrandMark, Wordmark } from './Brand';
import ThemePicker from './ThemePicker';
import type { ShellAppDefinition, ShellAppKey } from './types';
import DrawerAuthPanel from './DrawerAuthPanel';

type Props = {
  apps: readonly ShellAppDefinition[];
  open: boolean;
  activeApp: ShellAppKey | null;
  onClose: () => void;
  onOpenHome: () => void;
  onSelectApp: (key: ShellAppKey) => void;
};

export default function OffCanvasDrawer({ apps, open, activeApp, onClose, onOpenHome, onSelectApp }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return createPortal(
    <dialog
      id="platform-drawer" ref={dialogRef} className="app-drawer" aria-label="StratExec 選單"
      onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="drawer-surface">
        <header className="drawer-header">
          <button type="button" className="drawer-home-button" aria-label="返回 StratExec 首頁" onClick={() => { onOpenHome(); onClose(); }}>
            <BrandMark />
            <span><b><Wordmark /></b><small>策略執行平台</small></span>
          </button>
          <button type="button" className="icon-button" aria-label="關閉側邊選單" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="drawer-scroll-region">
          <nav aria-label="應用程式清單">
            <h2 className="drawer-section-title">應用程式 <span>{apps.length}</span></h2>
            {apps.length === 0 && <p className="drawer-empty">尚未加入應用程式</p>}
            {apps.map((app) => {
              const Icon = app.icon;
              return (
                <button
                  key={app.key} type="button" disabled={!isLaunchableDefinition(app)}
                  className={`drawer-app-item${activeApp === app.key ? ' active' : ''}`}
                  aria-current={activeApp === app.key ? 'page' : undefined}
                  onClick={() => { onSelectApp(app.key); onClose(); }}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span><b>{app.title}</b><small>{app.subtitle}</small></span>
                  {!isLaunchableDefinition(app) && <small>尚未開放</small>}
                </button>
              );
            })}
          </nav>
          <section className="drawer-theme-section" aria-label="個人化">
            <h2 className="drawer-theme-title"><Settings size={16} aria-hidden="true" /><span>個人化</span></h2>
            <ThemePicker />
          </section>
        </div>
        <footer className="drawer-footer">
          <DrawerAuthPanel />
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
