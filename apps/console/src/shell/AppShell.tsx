import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Settings, UserRound, X } from 'lucide-react';
import AppLauncherPanel from './AppLauncherPanel';
import { BrandMark, Wordmark } from './Brand';
import OffCanvasDrawer from './OffCanvasDrawer';
import ThemePicker from './ThemePicker';
import { appRegistry, canAccessDefinition, getAppDefinition, getLaunchableApps, isLaunchableDefinition, validateAppRegistry } from './appRegistry';
import type { ShellAppDefinition, ShellAppKey } from './types';
import { navigate, usePathname } from './navigation';
import { AppWorkspaceHost } from './AppHost';
import { ConfirmDialog } from '../shared/ui/controls';
import { NotificationProvider } from '../shared/ui/Notifications';
import { useAuth } from '../shared/auth';
import { firebaseAuthConfiguration } from '../shared/auth/config';
import {
  APP_LIFECYCLE_CHANGED_EVENT,
  APP_ORDER_CHANGED_EVENT,
  fetchInstalledAppCatalog,
  type AppAccessMode,
  type InstalledAppCatalog,
} from '../shared/api/appLifecycle';
import { APP_HEADER_ACTIONS_HOST_ID } from '../shared/ui/AppHeaderActions';
import { APP_INFO_BAR_HOST_ID } from '../shared/ui/AppInfoBar';
import { useSiteSettings } from '../shared/site/SiteSettingsProvider';

export default function AppShell(props: { apps?: readonly ShellAppDefinition[] }) {
  return <NotificationProvider><PlatformShell {...props} /></NotificationProvider>;
}

function PlatformShell({ apps = appRegistry }: { apps?: readonly ShellAppDefinition[] }) {
  const { settings: siteSettings } = useSiteSettings();
  useMemo(() => validateAppRegistry(apps), [apps]);
  const { user, member, identityStatus, identityError, retryIdentitySync } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [closingApp, setClosingApp] = useState<ShellAppDefinition | null>(null);
  const [closeRequest, setCloseRequest] = useState<{ key: string; revision: number } | null>(null);
  const usesServerCatalog = apps === appRegistry && firebaseAuthConfiguration.state === 'configured';
  const [installedAppCatalog, setInstalledAppCatalog] = useState<InstalledAppCatalog | null>(null);
  const [appCatalogStatus, setAppCatalogStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    usesServerCatalog ? 'loading' : 'idle',
  );
  const [appCatalogError, setAppCatalogError] = useState('');
  const [appCatalogRevision, setAppCatalogRevision] = useState(0);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const definition = apps.find((app) => app.path === pathname);
  // Auth can change one render before Identity clears the previous member.
  const trustedMember = identityStatus === 'ready' && member && user?.uid === member.uid ? member : null;
  const fallbackAccessMode = (app: ShellAppDefinition): AppAccessMode => (
    app.access === 'public' ? 'public' : 'grant_required'
  );
  const accessModeFor = useCallback((app: ShellAppDefinition) => (
    usesServerCatalog ? installedAppCatalog?.get(app.key) : fallbackAccessMode(app)
  ), [installedAppCatalog, usesServerCatalog]);
  const appCatalogReady = !usesServerCatalog || appCatalogStatus === 'ready';
  const installedApps = useMemo(
    () => usesServerCatalog
      ? (appCatalogReady && installedAppCatalog
          ? [...apps]
              .filter((app) => installedAppCatalog.has(app.key))
              .sort((left, right) => {
                const orderedKeys = [...installedAppCatalog.keys()];
                return orderedKeys.indexOf(left.key) - orderedKeys.indexOf(right.key);
              })
          : [])
      : apps,
    [appCatalogReady, apps, installedAppCatalog, usesServerCatalog],
  );
  const accessibleApps = useMemo(
    () => installedApps.filter((app) => canAccessDefinition(app, trustedMember, accessModeFor(app))),
    [accessModeFor, installedApps, trustedMember],
  );
  const definitionAccessMode = definition ? accessModeFor(definition) : undefined;
  const definitionInstalled = definition ? (
    usesServerCatalog
      ? appCatalogReady && installedAppCatalog?.has(definition.key) === true
      : true
  ) : false;
  const definitionAccessible = definition && definitionInstalled
    ? canAccessDefinition(definition, trustedMember, definitionAccessMode)
    : false;
  const definitionRequiresIdentity = definitionAccessMode !== undefined
    && !['public', 'disabled'].includes(definitionAccessMode);
  const identitySyncPending = definitionRequiresIdentity && identityStatus === 'syncing';
  const identitySyncFailed = definitionRequiresIdentity && identityStatus === 'error';
  const appCatalogPending = Boolean(definition && usesServerCatalog && appCatalogStatus === 'loading');
  const appCatalogFailed = Boolean(definition && usesServerCatalog && appCatalogStatus === 'error');
  const permissionRefreshPending = (usesServerCatalog && appCatalogStatus === 'loading') || identityStatus === 'syncing';
  const activeDefinition = definition && definitionAccessible && isLaunchableDefinition(definition)
    && !permissionRefreshPending ? definition : null;
  const retainedAccess = permissionRefreshPending ? null
    : usesServerCatalog && appCatalogStatus !== 'ready' ? [] : getLaunchableApps(accessibleApps);
  const mergedHeader = definition?.headerLayout === 'merged';
  const ActiveAppIcon = definition?.icon;
  const activeApp = definition?.key ?? null;
  const accountName = user?.displayName || user?.email || 'StratExec 會員';
  const accountInitial = accountName.trim().slice(0, 1).toUpperCase();
  const mainRef = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openHome = useCallback(() => navigate('/'), []);
  useEffect(() => {
    document.title = pathname === '/'
      ? `${siteSettings.title} course｜${siteSettings.subtitle}`
      : `${definition?.title ?? '找不到頁面'}｜${siteSettings.title} course`;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, definition?.title, siteSettings.title, siteSettings.subtitle]);
  useEffect(() => {
    if (!usesServerCatalog) {
      setInstalledAppCatalog(null);
      setAppCatalogStatus('idle');
      setAppCatalogError('');
      return;
    }
    let active = true;
    setInstalledAppCatalog(null);
    setAppCatalogStatus('loading');
    setAppCatalogError('');
    void fetchInstalledAppCatalog()
      .then((catalog) => {
        if (!active) return;
        setInstalledAppCatalog(catalog);
        setAppCatalogStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setInstalledAppCatalog(null);
        setAppCatalogStatus('error');
        setAppCatalogError('平台無法取得目前的 App 開放政策；為避免誤開放，已暫停載入 App。');
      });
    return () => { active = false; };
  }, [appCatalogRevision, usesServerCatalog]);
  useEffect(() => {
    if (!usesServerCatalog) return;
    const refresh = () => {
      retryIdentitySync();
      setAppCatalogRevision((revision) => revision + 1);
    };
    window.addEventListener(APP_LIFECYCLE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(APP_LIFECYCLE_CHANGED_EVENT, refresh);
  }, [retryIdentitySync, usesServerCatalog]);
  useEffect(() => {
    if (!usesServerCatalog) return;
    const reorder = (event: Event) => {
      const appKeys = (event as CustomEvent<{ appKeys?: unknown }>).detail?.appKeys;
      if (!Array.isArray(appKeys) || appKeys.some((appKey) => typeof appKey !== 'string')) return;
      setInstalledAppCatalog((current) => {
        if (!current) return current;
        const ordered: InstalledAppCatalog = new Map();
        for (const appKey of appKeys) {
          const accessMode = current.get(appKey);
          if (accessMode) ordered.set(appKey, accessMode);
        }
        for (const [appKey, accessMode] of current) {
          if (!ordered.has(appKey)) ordered.set(appKey, accessMode);
        }
        return ordered;
      });
    };
    window.addEventListener(APP_ORDER_CHANGED_EVENT, reorder);
    return () => window.removeEventListener(APP_ORDER_CHANGED_EVENT, reorder);
  }, [usesServerCatalog]);

  const hideThemeMenu = () => themeMenuRef.current?.hidePopover();
  const openDrawer = () => { hideThemeMenu(); setDrawerOpen(true); };
  const selectApp = (key: ShellAppKey) => {
    const app = getAppDefinition(key, apps);
    if (app && (!usesServerCatalog || installedAppCatalog?.has(app.key) === true)
      && isLaunchableDefinition(app) && canAccessDefinition(app, trustedMember, accessModeFor(app))) {
      hideThemeMenu();
      navigate(app.path);
    }
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
        <button
          type="button"
          className="app-rail-button app-rail-account"
          onClick={openDrawer}
          aria-label={user ? `開啟帳號選單：${accountName}` : '開啟登入與帳戶選單'}
          title={user ? accountName : '登入與帳戶'}
        >
          {user?.photoURL ? (
            <img className="app-rail-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className={`app-rail-avatar${user ? ' has-initial' : ''}`} aria-hidden="true">
              {user ? accountInitial : <UserRound size={18} aria-hidden="true" />}
            </span>
          )}
        </button>
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
                <>
                  {ActiveAppIcon ? <ActiveAppIcon className="app-title-icon" size={23} strokeWidth={1.8} aria-hidden="true" /> : null}
                  {mergedHeader
                    ? <div className="merged-brand-copy"><Wordmark /><h1>{definition.title}</h1></div>
                    : <div className="app-title-copy"><h1>{definition.title}</h1>{definition.subtitle && <p>{definition.subtitle}</p>}</div>}
                </>
              ) : <div><h1>{pathname === '/' ? <Wordmark /> : '找不到頁面'}</h1><p>{pathname === '/' ? siteSettings.subtitle : '請返回平台首頁'}</p></div>}
            </div>
            {definition ? <div className="app-header-controls">
              <div id={APP_HEADER_ACTIONS_HOST_ID} className="platform-app-header-actions" role="group" aria-label="App 操作" />
              {activeDefinition?.keepAlive && <button type="button" className="icon-button" aria-label="關閉目前 App"
                title="關閉目前 App 並釋放工作區" onClick={() => setClosingApp(activeDefinition)}><X size={18} aria-hidden="true" /></button>}
            </div> : <span className="platform-badge">{pathname === '/' ? '平台首頁' : '找不到頁面'}</span>}
          </header>
          {definition ? <aside id={APP_INFO_BAR_HOST_ID} className="platform-app-info card" aria-label="App 資訊" /> : null}
          {pathname === '/' && <AppLauncherPanel apps={accessibleApps} onSelectApp={selectApp} />}
            <section className="app-content card" hidden={pathname === '/'} aria-label={definition?.title ?? '找不到頁面'}>
              <AppWorkspaceHost key={user?.uid ?? 'anonymous'} app={activeDefinition} allowedApps={retainedAccess}
                closeRequest={closeRequest} onOpenHome={openHome} onOpenAppMenu={openDrawer} />
              {pathname !== '/' && !activeDefinition && (
                <div className="platform-state" role="alert">
                  <h3>{definition ? (appCatalogPending ? '正在同步 App 開放政策'
                    : appCatalogFailed ? 'App 開放政策無法使用'
                      : !definitionInstalled ? '此 App 尚未安裝'
                        : definitionAccessMode === 'disabled' ? '此 App 已暫停開放'
                          : identitySyncPending ? '正在同步平台權限'
                      : identitySyncFailed ? '平台權限尚未同步'
                        : definitionRequiresIdentity && !member ? '請先登入使用此 App'
                          : definitionAccessible ? '應用程式尚未開放'
                            : '目前帳號沒有此 App 使用權') : '此網址沒有對應的應用程式'}</h3>
                  <p>{appCatalogPending ? '請稍候，平台正在讀取管理員設定的 App 開放方式。'
                    : appCatalogFailed ? appCatalogError
                      : identitySyncPending ? '請稍候，平台正在驗證目前的 Google 登入身分。'
                        : identitySyncFailed ? identityError || 'Identity API 暫時無法完成權限驗證。'
                          : '請返回首頁選擇可用的功能。'}</p>
                  {appCatalogFailed && <button type="button" className="platform-button"
                    onClick={() => setAppCatalogRevision((revision) => revision + 1)}>重新讀取 App 政策</button>}
                  {identitySyncFailed && <button type="button" className="platform-button" onClick={retryIdentitySync}>重新同步權限</button>}
                  {!definition && <button type="button" className="platform-button" onClick={openHome}>返回平台首頁</button>}
                </div>
              )}
            </section>
          <ConfirmDialog open={Boolean(closingApp)} title="關閉 App 工作區" confirmLabel="關閉 App"
            onClose={() => setClosingApp(null)} onConfirm={() => {
              if (closingApp) {
                setCloseRequest(previous => ({ key: closingApp.key, revision: (previous?.revision ?? 0) + 1 }));
                if (definition?.key === closingApp.key) openHome();
              }
              setClosingApp(null);
            }}>
            關閉「{closingApp?.title}」會釋放工作區，未儲存的草稿將遺失。切換 App 不需要關閉；此動作不停止後端策略，也不發送交易命令。
          </ConfirmDialog>
        </main>
    </>
  );
}
