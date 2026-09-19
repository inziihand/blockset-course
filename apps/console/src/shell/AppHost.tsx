import { Component, lazy, Suspense, useEffect, useState, type LazyExoticComponent, type ComponentType, type ReactNode } from 'react';
import type { ShellAppDefinition, ShellAppProps } from './types';
import { Button, ErrorState, LoadingState } from '../shared/ui/controls';

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

function AppLifetime({ app, onOpenHome, onOpenAppMenu }: AppHostProps) {
  const [controller, setController] = useState<AbortController | null>(null);
  useEffect(() => {
    // Allocate in the effect so StrictMode's setup/cleanup replay gets a fresh signal.
    const next = new AbortController();
    setController(next);
    return () => next.abort();
  }, []);
  if (!controller || controller.signal.aborted) return <LoadingApp />;
  const ActiveApp = getLazyApp(app);
  return <ActiveApp displayMode={app.displayMode} signal={controller.signal} onOpenHome={onOpenHome} onOpenAppMenu={onOpenAppMenu} />;
}

function LoadingApp() { return <LoadingState message="正在載入應用程式…" />; }

export default function AppHost(props: AppHostProps) {
  return (
    <div className="platform-app-frame" data-display-mode={props.app.displayMode}>
      <AppErrorBoundary key={props.app.key} onHome={props.onOpenHome}>
        <Suspense fallback={<LoadingApp />}><AppLifetime {...props} /></Suspense>
      </AppErrorBoundary>
    </div>
  );
}
