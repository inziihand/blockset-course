import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Box } from 'lucide-react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../src/shell/AppShell';
import { appRegistry, canAccessDefinition, validateAppRegistry } from '../src/shell/appRegistry';
import type { ShellAppDefinition, ShellAppProps } from '../src/shell/types';
import type { IdentityMember } from '../src/shared/auth/identityClient';
import { ThemeProvider } from '../src/shared/theme/ThemeProvider';
import { AppHeaderActions } from '../src/shared/ui/AppHeaderActions';

// Fixtures are injected into the test host only, never registered in production.
const makeApp = (key: string, title: string, overrides: Partial<ShellAppDefinition> = {}): ShellAppDefinition => ({
  key,
  path: `/apps/${key}`,
  title,
  subtitle: '測試宿主限定',
  description: '平台承載驗收用元件，不是業務 App。',
  icon: Box,
  status: 'enabled',
  access: 'public',
  displayMode: 'responsive',
  load: async () => ({ default: () => <p>{title}內容</p> }),
  ...overrides,
});

const fixtureApps = () => [makeApp('alpha', '測試甲'), makeApp('beta', '測試乙')];
const renderHost = (apps = fixtureApps()) => render(<ThemeProvider><AppShell apps={apps} /></ThemeProvider>);
const goTo = (path: string) => {
  act(() => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
};
const rail = () => within(screen.getByRole('navigation', { name: '平台快速導覽' }));
const goHomeWithDrawer = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '展開 StratExec 選單' }));
  const drawer = screen.getByRole('dialog', { name: 'StratExec 選單' });
  await user.click(within(drawer).getByRole('button', { name: '返回 StratExec 首頁' }));
  return drawer;
};

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => window.history.replaceState({}, '', '/'));

describe('App Registry contract', () => {
  it('accepts complete definitions and planned placeholders without registering test Apps in production', () => {
    expect(appRegistry.some((app) => ['alpha', 'beta', 'planned'].includes(app.key))).toBe(false);
    const planned = makeApp('planned', '規劃中', { status: 'planned', load: undefined });
    expect(() => validateAppRegistry([...fixtureApps(), planned])).not.toThrow();
  });

  it.each(['compact', 'responsive'] as const)('accepts the declared %s display mode', (displayMode) => {
    expect(() => validateAppRegistry([makeApp('alpha', '測試甲', { displayMode })])).not.toThrow();
  });

  it.each([undefined, 'standard', 'merged'] as const)('accepts optional header layout: %s', headerLayout => {
    expect(() => validateAppRegistry([makeApp('alpha', '測試甲', { headerLayout })])).not.toThrow();
  });

  it.each([null, '', 'compact'])('rejects invalid header layout: %s', headerLayout => {
    const app = { ...makeApp('alpha', '測試甲'), headerLayout } as unknown as ShellAppDefinition;
    expect(() => validateAppRegistry([app])).toThrow('Invalid App headerLayout');
  });

  it.each([undefined, null, '', 'mobile', 'desktop', 'COMPACT'])('rejects missing or unsupported display mode: %s', (displayMode) => {
    // Exercise untyped configuration input; TypeScript also requires the field.
    const app = { ...makeApp('alpha', '測試甲'), displayMode } as unknown as ShellAppDefinition;
    expect(() => validateAppRegistry([app])).toThrow();
  });

  it('rejects duplicate identifiers and duplicate paths independently', () => {
    const alpha = makeApp('alpha', '測試甲');
    expect(() => validateAppRegistry([alpha, makeApp('alpha', '重複 ID', { path: '/apps/other' })])).toThrow();
    expect(() => validateAppRegistry([alpha, makeApp('beta', '重複路徑', { path: '/apps/alpha' })])).toThrow();
  });

  it.each(['/', '/unknown', '/apps/', '/apps/../alpha', '/apps/alpha/child', '/apps/alpha?x=1', 'https://example.test/apps/alpha'])(
    'rejects invalid or external App paths: %s',
    (path) => expect(() => validateAppRegistry([makeApp('alpha', '測試甲', { path: path as ShellAppDefinition['path'] })])).toThrow(),
  );

  it.each(['enabled', 'preview'] as const)('rejects a %s App without a loader', (status) => {
    expect(() => validateAppRegistry([makeApp('alpha', '測試甲', { status, load: undefined })])).toThrow();
  });

  it.each(['', 'UpperCase', 'has space', 'with/slash', '123'])('rejects an invalid App key: %s', (key) => {
    expect(() => validateAppRegistry([makeApp(key, '測試甲', { path: '/apps/valid' })])).toThrow();
  });

  it('uses the live platform policy instead of the manifest default for whole-App access', () => {
    const app = makeApp('alpha', '測試甲', { access: 'public' });
    const member: IdentityMember = {
      uid: 'member-1', email: 'member@example.test', provider: 'google.com', emailVerified: true,
      role: 'member', status: 'active', plan: 'free', appGrants: [],
      appAccess: [{ appKey: 'alpha', allowed: true, reason: 'active_grant', entitlements: [] }],
    };

    expect(canAccessDefinition(app, null, 'public')).toBe(true);
    expect(canAccessDefinition(app, null, 'all_members')).toBe(false);
    expect(canAccessDefinition(app, member, 'all_members')).toBe(true);
    expect(canAccessDefinition(app, null, 'grant_required')).toBe(false);
    expect(canAccessDefinition(app, member, 'grant_required')).toBe(true);
    expect(canAccessDefinition(app, member, 'disabled')).toBe(false);
  });
});

describe('URL-owned App navigation', () => {
  it('renders App-owned actions in the platform title bar and removes them when leaving the App', async () => {
    window.history.replaceState({}, '', '/apps/alpha');
    const HeaderActionFixture = () => <>
      <AppHeaderActions><button type="button">測試操作</button></AppHeaderActions>
      <p>標題列操作測試內容</p>
    </>;
    renderHost([
      makeApp('alpha', '測試甲', { load: async () => ({ default: HeaderActionFixture }) }),
      makeApp('beta', '測試乙'),
    ]);

    const action = await screen.findByRole('button', { name: '測試操作' });
    expect(action.closest('.topbar')).toBeTruthy();
    expect(action.closest('.app-content')).toBeNull();
    expect(screen.getByRole('group', { name: 'App 操作' }).contains(action)).toBe(true);

    await userEvent.click(rail().getByRole('button', { name: '測試乙' }));
    await screen.findByText('測試乙內容');
    expect(screen.queryByRole('button', { name: '測試操作' })).toBeNull();
  });

  it('uses the App identity in the topbar and preserves the opted-in merged treatment', async () => {
    window.history.replaceState({}, '', '/apps/alpha');
    renderHost([makeApp('alpha', '測試甲', { headerLayout: 'merged', displayMode: 'compact' }), makeApp('beta', '測試乙')]);
    await screen.findByText('測試甲內容');
    const main = screen.getByRole('main');
    expect(main.getAttribute('data-header-layout')).toBe('merged');
    expect(main.getAttribute('data-display-mode')).toBe('compact');
    expect(within(main).getByRole('heading', { name: '測試甲', level: 1 }).closest('.topbar')).toBeTruthy();
    expect(main.querySelector('.app-content-heading')).toBeNull();
    expect(screen.queryByRole('button', { name: '返回平台首頁' })).toBeNull();
    await userEvent.click(rail().getByRole('button', { name: '測試乙' }));
    await screen.findByText('測試乙內容');
    expect(main.hasAttribute('data-header-layout')).toBe(false);
    expect(within(main).getByRole('heading', { name: '測試乙', level: 1 }).closest('.topbar')).toBeTruthy();
    expect(main.querySelector('.app-content-heading')).toBeNull();
    goTo('/apps/alpha');
    await screen.findByText('測試甲內容');
    await goHomeWithDrawer();
    expect(main.hasAttribute('data-header-layout')).toBe(false);
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
  });

  it('applies the registered display mode to the entire window and clears it on home or an unknown route', async () => {
    window.history.replaceState({}, '', '/apps/alpha');
    renderHost([
      makeApp('alpha', '測試甲', { displayMode: 'compact' }),
      makeApp('beta', '測試乙', { displayMode: 'responsive' }),
    ]);
    await screen.findByText('測試甲內容');
    const windowElement = screen.getByRole('main');
    expect(windowElement.getAttribute('data-display-mode')).toBe('compact');
    expect(windowElement.querySelector('.topbar')).toBeTruthy();
    expect(within(windowElement).getByRole('heading', { name: '測試甲', level: 1 }).closest('.topbar')).toBeTruthy();
    expect(windowElement.querySelector('.app-content-heading')).toBeNull();
    expect(windowElement.querySelector('.shell-footer')).toBeTruthy();
    expect(windowElement.contains(screen.getByRole('navigation', { name: '平台快速導覽' }))).toBe(false);

    await userEvent.click(rail().getByRole('button', { name: '測試乙' }));
    await screen.findByText('測試乙內容');
    expect(screen.getByRole('main')).toBe(windowElement);
    expect(windowElement.getAttribute('data-display-mode')).toBe('responsive');
    goTo('/apps/alpha');
    await screen.findByText('測試甲內容');
    expect(windowElement.getAttribute('data-display-mode')).toBe('compact');
    await goHomeWithDrawer();
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
    expect(windowElement.hasAttribute('data-display-mode')).toBe(false);
    goTo('/apps/alpha');
    await screen.findByText('測試甲內容');
    goTo('/apps/not-registered');
    expect(windowElement.hasAttribute('data-display-mode')).toBe(false);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('opens a deep link inside the persistent platform container, also after remount', async () => {
    window.history.replaceState({}, '', '/apps/alpha');
    const view = renderHost();
    expect(await screen.findByText('測試甲內容')).toBeTruthy();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '開啟平台選單' })).toBeTruthy();
    expect(rail().getByRole('button', { name: '測試乙' })).toBeTruthy();
    view.unmount();
    renderHost();
    expect(await screen.findByText('測試甲內容')).toBeTruthy();
    expect(window.location.pathname).toBe('/apps/alpha');
  });

  it('uses the rail and browser Back/Forward without a second active-App state', async () => {
    window.history.replaceState({}, '', '/apps/alpha');
    renderHost();
    await screen.findByText('測試甲內容');
    await userEvent.click(rail().getByRole('button', { name: '測試乙' }));
    expect(await screen.findByText('測試乙內容')).toBeTruthy();
    expect(window.location.pathname).toBe('/apps/beta');
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/apps/alpha'));
    expect(await screen.findByText('測試甲內容')).toBeTruthy();
    act(() => window.history.forward());
    await waitFor(() => expect(window.location.pathname).toBe('/apps/beta'));
    expect(await screen.findByText('測試乙內容')).toBeTruthy();
  });

  it('selects an App in the drawer and can always return to the platform home', async () => {
    renderHost();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '展開 StratExec 選單' }));
    const drawer = screen.getByRole('dialog', { name: 'StratExec 選單' });
    await user.click(within(drawer).getByRole('button', { name: /測試甲/ }));
    expect(await screen.findByText('測試甲內容')).toBeTruthy();
    expect((drawer as HTMLDialogElement).open).toBe(false);
    expect(window.location.pathname).toBe('/apps/alpha');
    await goHomeWithDrawer();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
    expect(screen.queryByText('測試甲內容')).toBeNull();
  });

  it('does not silently render home for an unknown URL and still offers working navigation', async () => {
    window.history.replaceState({}, '', '/apps/not-registered');
    renderHost();
    expect(screen.queryByRole('heading', { name: '你的策略工作空間' })).toBeNull();
    expect(screen.queryByText('測試甲內容')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    await userEvent.click(rail().getByRole('button', { name: '測試甲' }));
    expect(await screen.findByText('測試甲內容')).toBeTruthy();
  });

  it('does not load a planned App through a manually entered URL', async () => {
    const load = vi.fn(async () => ({ default: () => <p>不應出現的規劃內容</p> }));
    window.history.replaceState({}, '', '/apps/planned');
    renderHost([makeApp('planned', '規劃中', { status: 'planned', load })]);
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByText('不應出現的規劃內容')).toBeNull();
    expect(screen.queryByRole('heading', { name: '你的策略工作空間' })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    await goHomeWithDrawer();
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
  });

  it('responds to external history notifications rather than preserving stale App content', async () => {
    renderHost();
    goTo('/apps/alpha');
    expect(await screen.findByText('測試甲內容')).toBeTruthy();
    goTo('/apps/beta');
    expect(await screen.findByText('測試乙內容')).toBeTruthy();
    expect(screen.queryByText('測試甲內容')).toBeNull();
  });
});

describe('Lazy loading, isolation and App lifetime', () => {
  it('loads only the selected App and shows a pending state until its module arrives', async () => {
    let resolveModule!: (value: { default: () => React.JSX.Element }) => void;
    const load = vi.fn(() => new Promise<{ default: () => React.JSX.Element }>((resolve) => { resolveModule = resolve; }));
    const otherLoad = vi.fn(async () => ({ default: () => <p>測試乙內容</p> }));
    renderHost([makeApp('alpha', '測試甲', { load }), makeApp('beta', '測試乙', { load: otherLoad })]);
    expect(load).not.toHaveBeenCalled();
    expect(otherLoad).not.toHaveBeenCalled();
    await userEvent.click(rail().getByRole('button', { name: '測試甲' }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(otherLoad).not.toHaveBeenCalled();
    await act(async () => resolveModule({ default: () => <p>延遲完成內容</p> }));
    expect(await screen.findByText('延遲完成內容')).toBeTruthy();
  });

  it.each(['render', 'load'] as const)('isolates a %s failure and allows another App and home to work', async (failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = makeApp('broken', '故障 App', {
      load: failure === 'load'
        ? async () => { throw new Error('fixture module failure'); }
        : async () => ({ default: () => { throw new Error('fixture render failure'); } }),
    });
    window.history.replaceState({}, '', '/apps/broken');
    renderHost([broken, makeApp('beta', '測試乙')]);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: '開啟平台選單' })).toBeTruthy();
    await userEvent.click(rail().getByRole('button', { name: '測試乙' }));
    expect(await screen.findByText('測試乙內容')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await goHomeWithDrawer();
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
  });

  it('aborts the outgoing App scope on switch and the final scope on host unmount', async () => {
    const observed: Partial<Record<'alpha' | 'beta', AbortSignal>> = {};
    const observedModes: Partial<Record<'alpha' | 'beta', ShellAppProps['displayMode']>> = {};
    const scopeFixture = (key: 'alpha' | 'beta') => ({ signal, displayMode }: ShellAppProps) => {
      observed[key] = signal;
      observedModes[key] = displayMode;
      return <p>{key} scope</p>;
    };
    window.history.replaceState({}, '', '/apps/alpha');
    const view = renderHost([
      makeApp('alpha', '測試甲', { displayMode: 'compact', load: async () => ({ default: scopeFixture('alpha') }) }),
      makeApp('beta', '測試乙', { load: async () => ({ default: scopeFixture('beta') }) }),
    ]);
    await screen.findByText('alpha scope');
    expect(observed.alpha?.aborted).toBe(false);
    expect(observedModes.alpha).toBe('compact');
    expect(screen.getByText('alpha scope').closest('.platform-app-frame')?.getAttribute('data-display-mode')).toBe('compact');
    expect(screen.getByRole('heading', { name: '測試甲' }).closest('.platform-app-frame')).toBeNull();
    await userEvent.click(rail().getByRole('button', { name: '測試乙' }));
    await screen.findByText('beta scope');
    expect(observed.alpha?.aborted).toBe(true);
    expect(observed.beta?.aborted).toBe(false);
    expect(observedModes.beta).toBe('responsive');
    expect(screen.getByText('beta scope').closest('.platform-app-frame')?.getAttribute('data-display-mode')).toBe('responsive');
    expect(document.querySelectorAll('.platform-app-frame')).toHaveLength(1);
    view.unmount();
    expect(observed.beta?.aborted).toBe(true);
  });

  it('provides a live signal when React StrictMode replays its setup and cleanup', async () => {
    let activeSignal: AbortSignal | undefined;
    const apps = [makeApp('alpha', '測試甲', {
      load: async () => ({ default: ({ signal }: ShellAppProps) => {
        activeSignal = signal;
        return <p>StrictMode App 已載入</p>;
      } }),
    })];
    window.history.replaceState({}, '', '/apps/alpha');
    const view = render(<StrictMode><ThemeProvider><AppShell apps={apps} /></ThemeProvider></StrictMode>);
    await screen.findByText('StrictMode App 已載入');
    await waitFor(() => expect(activeSignal?.aborted).toBe(false));
    view.unmount();
    expect(activeSignal?.aborted).toBe(true);
  });

  it('aborts an already mounted App on render failure and lets its error action return home', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let activeSignal: AbortSignal | undefined;
    const ErrorAfterMount = ({ signal }: ShellAppProps) => {
      const [failed, setFailed] = useState(false);
      activeSignal = signal;
      if (failed) throw new Error('fixture subsequent render failure');
      return <button type="button" onClick={() => setFailed(true)}>注入渲染錯誤</button>;
    };
    window.history.replaceState({}, '', '/apps/alpha');
    renderHost([makeApp('alpha', '測試甲', { load: async () => ({ default: ErrorAfterMount }) })]);
    await userEvent.click(await screen.findByRole('button', { name: '注入渲染錯誤' }));
    const error = await screen.findByRole('alert');
    expect(activeSignal?.aborted).toBe(true);
    await userEvent.click(within(error).getByRole('button', { name: '返回首頁' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
  });

  it('does not remount a late module after the user has already left its route', async () => {
    let resolveModule!: (value: { default: () => React.JSX.Element }) => void;
    const load = () => new Promise<{ default: () => React.JSX.Element }>((resolve) => { resolveModule = resolve; });
    renderHost([makeApp('alpha', '測試甲', { load }), makeApp('beta', '測試乙')]);
    await userEvent.click(rail().getByRole('button', { name: '測試甲' }));
    await userEvent.click(rail().getByRole('button', { name: '測試乙' }));
    expect(await screen.findByText('測試乙內容')).toBeTruthy();
    await act(async () => resolveModule({ default: () => <p>已過期的延遲內容</p> }));
    expect(screen.queryByText('已過期的延遲內容')).toBeNull();
    expect(screen.getByText('測試乙內容')).toBeTruthy();
    expect(window.location.pathname).toBe('/apps/beta');
  });
});
