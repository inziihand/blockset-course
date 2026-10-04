import { Component, lazy, Suspense, useLayoutEffect, useState, type LazyExoticComponent, type ComponentType, type ReactNode } from 'react';
import type { ShellAppDefinition, ShellAppProps } from './types';
import { Button, ErrorState, LoadingState } from '../shared/ui/controls';
import { AppActivityContext } from '../shared/lifecycle/AppActivity';

const loadedApps = new WeakMap<ShellAppDefinition, LazyExoticComponent<ComponentType<ShellAppProps>>>();
function getLazyApp(app: ShellAppDefinition) {
  let loaded = loadedApps.get(app);
  if (!loaded) {
    if (!app.load) throw new Error('Missing App loader');
    loaded = lazy(app.load);
    loadedApps.set(app, loaded);
  }
  return loaded;
}

class AppErrorBoundary extends Component<{ children: ReactNode; onHome: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <ErrorState title="應用程式暫時無法使用">
        <p>載入或顯示時發生問題。平台導覽仍可使用；這不代表後端策略已停止。</p>
        <Button onClick={this.props.onHome}>返回首頁</Button>
        <Button onClick={() => window.location.reload()}>重新載入頁面</Button>
        <p>重新載入只更新前端，不重送交易命令。</p>
      </ErrorState>
    );
    return this.props.children;
  }
}

type AppHostProps = { app: ShellAppDefinition } & Omit<ShellAppProps, 'signal' | 'displayMode'>;

function AppLifetime({ app, onOpenHome, onOpenAppMenu, active = true }: AppHostProps) {
  const [scope, setScope] = useState(() => ({ active, controller: new AbortController() }));
  // Adjust during render so reactivation never exposes the previous cancelled signal.
  // Do not replace the App subtree with a loading state: that would discard its draft.
  if (scope.active !== active) {
    setScope({ active, controller: active ? new AbortController() : scope.controller });
  }
  useLayoutEffect(() => {
    if (!active) scope.controller.abort();
    else if (scope.controller.signal.aborted) {
      // StrictMode replays cleanup/setup; a cancelled signal cannot be revived.
      setScope({ active, controller: new AbortController() });
    }
    return () => scope.controller.abort();
  }, [active, scope.controller]);
  const ActiveApp = getLazyApp(app);
  return <ActiveApp displayMode={app.displayMode} active={active} signal={scope.controller.signal} onOpenHome={onOpenHome} onOpenAppMenu={onOpenAppMenu} />;
}

function LoadingApp() { return <LoadingState message="正在載入應用程式…" />; }

export default function AppHost(props: AppHostProps) {
  const active = props.active ?? true;
  return (
    <AppActivityContext.Provider value={active}>
    <div className="platform-app-frame" data-display-mode={props.app.displayMode} data-app-key={props.app.key}
      hidden={!active} inert={!active}>
      <AppErrorBoundary key={props.app.key} onHome={props.onOpenHome}>
        <Suspense fallback={<LoadingApp />}><AppLifetime {...props} /></Suspense>
      </AppErrorBoundary>
    </div>
    </AppActivityContext.Provider>
  );
}

type WorkspaceHostProps = Omit<AppHostProps, 'app' | 'active'> & {
  app: ShellAppDefinition | null;
  /** null means permission refresh: suspend, but do not discard previously authorized drafts. */
  allowedApps: readonly ShellAppDefinition[] | null;
  closeRequest: { key: string; revision: number } | null;
};

/** Only visited, opted-in Apps are retained. No eager loading, eviction or persistence. */
export function AppWorkspaceHost({ app, allowedApps, closeRequest, ...props }: WorkspaceHostProps) {
  const [cache, setCache] = useState<{ apps: readonly ShellAppDefinition[]; closeRevision: number }>({ apps: [], closeRevision: 0 });
  const closeRevision = closeRequest?.revision ?? 0;
  const retained = cache.apps.filter(candidate => candidate.keepAlive
    && (allowedApps === null || allowedApps.includes(candidate))
    && !(closeRevision !== cache.closeRevision && candidate.key === closeRequest?.key));
  const next = app && !retained.includes(app) ? [...retained, app] : retained;
  if (closeRevision !== cache.closeRevision || next.length !== cache.apps.length || next.some((candidate, index) => candidate !== cache.apps[index])) {
    setCache({ apps: next, closeRevision });
  }
  return <>{next.map(candidate => <AppHost key={candidate.key} {...props} app={candidate} active={candidate === app} />)}</>;
}
