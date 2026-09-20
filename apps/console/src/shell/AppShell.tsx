import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Settings, UserRound } from 'lucide-react';
import AppLauncherPanel from './AppLauncherPanel';
import { BrandMark, Wordmark } from './Brand';
import OffCanvasDrawer from './OffCanvasDrawer';
import ThemePicker from './ThemePicker';
import { appRegistry, canAccessDefinition, getAppDefinition, getLaunchableApps, isLaunchableDefinition, validateAppRegistry } from './appRegistry';
import type { ShellAppDefinition, ShellAppKey } from './types';
import { navigate, usePathname } from './navigation';
import AppHost from './AppHost';
import { NotificationProvider } from '../shared/ui/Notifications';
import { buildInfo } from '../shared/buildInfo';
import { useAuth } from '../shared/auth';
import { firebaseAuthConfiguration } from '../shared/auth/config';
import { APP_LIFECYCLE_CHANGED_EVENT, fetchInstalledAppKeys } from '../shared/api/appLifecycle';
import { APP_HEADER_ACTIONS_HOST_ID } from '../shared/ui/AppHeaderActions';

export default function AppShell(props: { apps?: readonly ShellAppDefinition[] }) {
  return <NotificationProvider><PlatformShell {...props} /></NotificationProvider>;
}

function PlatformShell({ apps = appRegistry }: { apps?: readonly ShellAppDefinition[] }) {
  useMemo(() => validateAppRegistry(apps), [apps]);
  const { member, identityStatus, identityError, retryIdentitySync } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [installedAppKeys, setInstalledAppKeys] = useState<Set<string> | null>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const definition = apps.find((app) => app.path === pathname);
  const installedApps = useMemo(
    () => installedAppKeys ? apps.filter((app) => installedAppKeys.has(app.key)) : apps,
    [apps, installedAppKeys],
  );
  const accessibleApps = useMemo(
    () => installedApps.filter((app) => canAccessDefinition(app, member)),
    [installedApps, member],
  );
  const definitionInstalled = definition ? (!installedAppKeys || installedAppKeys.has(definition.key)) : false;
  const definitionAccessible = definition && definitionInstalled ? canAccessDefinition(definition, member) : false;
  const identitySyncPending = definition?.access === 'identity' && identityStatus === 'syncing';
  const identitySyncFailed = definition?.access === 'identity' && identityStatus === 'error';
  const mergedHeader = definition?.headerLayout === 'merged';
  const activeApp = definition?.key ?? null;
  const mainRef = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openHome = useCallback(() => navigate('/'), []);
  useEffect(() => {
    document.title = `${definition?.title ?? (pathname === '/' ? '策略執行平台' : '找不到頁面')} — StratExec`;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, definition?.title]);
  useEffect(() => {
    if (apps !== appRegistry || firebaseAuthConfiguration.state !== 'configured') return;
    let active = true;
    const refresh = () => { void fetchInstalledAppKeys()
      .then((keys) => { if (active) setInstalledAppKeys(keys); })
      .catch(() => { /* Offline mother-template previews keep the compiled App catalog. */ }); };
    refresh();
    window.addEventListener(APP_LIFECYCLE_CHANGED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(APP_LIFECYCLE_CHANGED_EVENT, refresh); };
  }, [apps]);

  const hideThemeMenu = () => themeMenuRef.current?.hidePopover();
  const openDrawer = () => { hideThemeMenu(); setDrawerOpen(true); };
  const selectApp = (key: ShellAppKey) => {
    const app = getAppDefinition(key, apps);
    if (app && (!installedAppKeys || installedAppKeys.has(app.key))
      && isLaunchableDefinition(app) && canAccessDefinition(app, member)) { hideThemeMenu(); navigate(app.path); }
  };

  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要內容</a>
      <nav className="app-rail" aria-label="平台快速導覽">
        <button type="button" className="app-rail-logo" onClick={openDrawer} aria-label="展開 StratExec 選單" aria-expanded={drawerOpen} aria-controls="platform-drawer" title="展開選單"><BrandMark size={20} /></button>
        <div className="app-rail-divider" />
        {getLaunchableApps(accessibleApps).map((app) => {
          const Icon = app.icon;
          return <button key={app.key} type="button" className={`app-rail-button${activeApp === app.key ? ' active' : ''}`} onClick={() => selectApp(app.key)} aria-current={activeApp === app.key ? 'page' : undefined} aria-label={app.title} title={app.title}><Icon size={19} aria-hidden="true" /></button>;
        })}
        <button type="button" className={`app-rail-button app-rail-settings${themeMenuOpen ? ' active' : ''}`} popoverTarget="appearance-popover" aria-label="個人化" aria-expanded={themeMenuOpen} aria-haspopup="dialog" title="個人化"><Settings size={19} aria-hidden="true" /></button>
        <button type="button" className="app-rail-button" onClick={openDrawer} aria-label="開啟登入與帳戶選單" title="登入與帳戶"><UserRound size={19} aria-hidden="true" /></button>
      </nav>
      <div
        ref={themeMenuRef} id="appearance-popover" popover="auto" role="dialog" aria-label="個人化外觀"
        className="theme-menu" onToggle={(event) => setThemeMenuOpen(event.currentTarget.matches(':popover-open'))}
      >
        <ThemePicker variant="list" onSelect={hideThemeMenu} />
      </div>
      <OffCanvasDrawer apps={accessibleApps} open={drawerOpen} activeApp={activeApp} onClose={closeDrawer} onOpenHome={openHome} onSelectApp={selectApp} />
        <main ref={mainRef} id="main-content" tabIndex={-1} className="app-shell launcher-shell" data-display-mode={definition?.displayMode} data-header-layout={definition?.headerLayout}>
          <header className="topbar">
            <div className="brand">
              <button type="button" className="icon-button mobile-menu" onClick={openDrawer} aria-label="開啟平台選單" aria-expanded={drawerOpen} aria-controls="platform-drawer"><Menu size={20} aria-hidden="true" /></button>
              {definition ? (
                mergedHeader
                  ? <div className="merged-brand-copy"><Wordmark /><h1>{definition.title}</h1></div>
                  : <div className="app-title-copy"><h1>{definition.title}</h1><p>{definition.subtitle}</p></div>
              ) : <div><h1>{pathname === '/' ? <Wordmark /> : '找不到頁面'}</h1><p>{pathname === '/' ? '策略執行平台' : '請返回平台首頁'}</p></div>}
            </div>
            {definition ? <div className="app-header-controls">
              <div id={APP_HEADER_ACTIONS_HOST_ID} className="platform-app-header-actions" role="group" aria-label="App 操作" />
            </div> : <span className="platform-badge">{pathname === '/' ? '平台首頁' : '找不到頁面'}</span>}
          </header>
          {pathname === '/' ? <AppLauncherPanel apps={accessibleApps} onSelectApp={selectApp} /> : (
            <section className="app-content card" aria-label={definition?.title ?? '找不到頁面'}>
              {definition && definitionAccessible && isLaunchableDefinition(definition) ? <AppHost app={definition} onOpenHome={openHome} onOpenAppMenu={openDrawer} /> : (
                <div className="platform-state" role="alert">
                  <h3>{definition ? (!definitionInstalled ? '此 App 尚未安裝'
                    : identitySyncPending ? '正在同步平台權限'
                      : identitySyncFailed ? '平台權限尚未同步'
                        : definitionAccessible ? '應用程式尚未開放'
                          : '目前帳號沒有此 App 使用權') : '此網址沒有對應的應用程式'}</h3>
                  <p>{identitySyncPending ? '請稍候，平台正在驗證目前的 Google 登入身分。'
                    : identitySyncFailed ? identityError || 'Identity API 暫時無法完成權限驗證。'
                      : '請返回首頁選擇可用的功能。'}</p>
                  {identitySyncFailed && <button type="button" className="platform-button" onClick={retryIdentitySync}>重新同步權限</button>}
                  {!definition && <button type="button" className="platform-button" onClick={openHome}>返回平台首頁</button>}
                </div>
              )}
            </section>
          )}
          <footer className="shell-footer"><span>StratExec Platform</span><span title="前端版本，不代表後端執行狀態">v{buildInfo.version} · {buildInfo.revision}</span></footer>
        </main>
    </>
  );
}
