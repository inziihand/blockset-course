import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Box } from 'lucide-react';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlatformShell from '../src/shell/AppShell';
import { ThemeProvider } from '../src/shared/theme/ThemeProvider';
import { AppWorkspaceHost } from '../src/shell/AppHost';
import type { ShellAppDefinition, ShellAppProps } from '../src/shell/types';
import { AppActivityContext, useAppEffect } from '../src/shared/lifecycle/AppActivity';
import { AppHeaderActions } from '../src/shared/ui/AppHeaderActions';
import { AppInfoBar } from '../src/shared/ui/AppInfoBar';
import { ConfirmDialog } from '../src/shared/ui/controls';
import { AuthContext, fallbackAuthContext, type AuthContextValue } from '../src/shared/auth/authContext';
import type { IdentityMember } from '../src/shared/auth/identityClient';

beforeEach(() => window.history.replaceState({}, '', '/'));
function AppShell({ apps }: { apps: readonly ShellAppDefinition[] }) {
  return <ThemeProvider><PlatformShell apps={apps} /></ThemeProvider>;
}
function goTo(path: string) {
  act(() => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); });
}
function fixtures() {
  const scopes: Record<string, AbortSignal[]> = { alpha: [], beta: [] };
  const subscriptions = new Set<string>();
  const definitions = ['alpha', 'beta'].map(key => {
    function Draft({ signal }: ShellAppProps) {
      const [draft, setDraft] = useState('');
      const [dialog, setDialog] = useState(false);
      scopes[key].push(signal);
      useAppEffect(() => {
        subscriptions.add(key);
        return () => { subscriptions.delete(key); };
      }, [signal]);
      return <>
        <AppHeaderActions><button type="button" onClick={() => setDialog(true)}>{key} action</button></AppHeaderActions>
        <AppInfoBar><span>{key} information</span></AppInfoBar>
        <input aria-label={`${key} draft`} value={draft} onChange={event => setDraft(event.target.value)} />
        <ConfirmDialog open={dialog} title={`${key} dialog`} onConfirm={() => setDialog(false)} onClose={() => setDialog(false)}>test</ConfirmDialog>
      </>;
    }
    return { key, title: key, subtitle: 'offline', description: 'offline', icon: Box,
      path: `/apps/${key}`, status: 'enabled', access: 'public', displayMode: 'responsive', keepAlive: true,
      load: vi.fn(async () => ({ default: Draft })) } satisfies ShellAppDefinition;
  });
  return { definitions, scopes, subscriptions };
}
const last = (signals: AbortSignal[]) => signals[signals.length - 1];

describe('controlled App keep-alive', () => {
  it('loads only visited Apps, keeps the same input DOM/state, and cancels outgoing scopes', async () => {
    const { definitions, scopes, subscriptions } = fixtures();
    const view = render(<AppShell apps={definitions} />);
    expect(definitions.every(app => app.load.mock.calls.length === 0)).toBe(true);
    goTo('/apps/alpha');
    const input = await screen.findByRole('textbox', { name: 'alpha draft' });
    fireEvent.change(input, { target: { value: 'unfinished draft' } });
    const first = last(scopes.alpha);
    expect(subscriptions).toEqual(new Set(['alpha']));
    expect(definitions[1].load).not.toHaveBeenCalled();
    goTo('/apps/beta');
    await screen.findByRole('textbox', { name: 'beta draft' });
    expect(first.aborted).toBe(true);
    expect(subscriptions).toEqual(new Set(['beta']));
    expect(input.closest('.platform-app-frame')?.hasAttribute('hidden')).toBe(true);
    expect(input.closest('.platform-app-frame')?.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('button', { name: 'alpha action' })).toBeNull();
    expect(screen.queryByText('alpha information')).toBeNull();
    goTo('/');
    expect(subscriptions.size).toBe(0);
    goTo('/apps/alpha');
    expect(await screen.findByRole('textbox', { name: 'alpha draft' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('unfinished draft');
    expect(last(scopes.alpha)).not.toBe(first);
    expect(last(scopes.alpha).aborted).toBe(false);
    expect(definitions[0].load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'alpha action' }).closest('.topbar')).toBeTruthy();
    const final = last(scopes.alpha);
    view.unmount();
    expect(final.aborted).toBe(true);
    expect(subscriptions.size).toBe(0);
  });

  it('preserves a cached draft through Back/Forward navigation', async () => {
    const { definitions } = fixtures();
    window.history.replaceState({}, '', '/apps/alpha');
    render(<AppShell apps={definitions} />);
    const input = await screen.findByRole('textbox', { name: 'alpha draft' });
    fireEvent.change(input, { target: { value: 'history draft' } });
    goTo('/apps/beta');
    await screen.findByRole('textbox', { name: 'beta draft' });
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/apps/alpha'));
    expect(await screen.findByRole('textbox', { name: 'alpha draft' })).toBe(input);
    act(() => window.history.forward());
    await waitFor(() => expect(window.location.pathname).toBe('/apps/beta'));
    await screen.findByRole('textbox', { name: 'beta draft' });
  });

  it('confirms close before releasing a draft and reopens with new local state', async () => {
    const { definitions, scopes } = fixtures();
    goTo('/apps/alpha');
    render(<AppShell apps={definitions} />);
    const input = await screen.findByRole('textbox', { name: 'alpha draft' });
    fireEvent.change(input, { target: { value: 'do not lose without confirmation' } });
    await userEvent.click(screen.getByRole('button', { name: '關閉目前 App' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '關閉 App 工作區' })).getByRole('button', { name: '取消' }));
    expect((input as HTMLInputElement).value).toBe('do not lose without confirmation');
    const signal = last(scopes.alpha);
    await userEvent.click(screen.getByRole('button', { name: '關閉目前 App' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: '關閉 App 工作區' })).getByRole('button', { name: '關閉 App' }));
    expect(window.location.pathname).toBe('/');
    expect(input.isConnected).toBe(false);
    expect(signal.aborted).toBe(true);
    goTo('/apps/alpha');
    const reopened = await screen.findByRole('textbox', { name: 'alpha draft' });
    expect(reopened).not.toBe(input);
    expect((reopened as HTMLInputElement).value).toBe('');
  });

  it('suspends during a permission refresh, then purges revoked/disabled/removed definitions', async () => {
    const { definitions, scopes } = fixtures();
    const props = { onOpenHome: () => {}, onOpenAppMenu: () => {}, closeRequest: null };
    const view = render(<AppWorkspaceHost {...props} app={definitions[0]} allowedApps={definitions} />);
    const input = await screen.findByRole('textbox', { name: 'alpha draft' });
    fireEvent.change(input, { target: { value: 'permission refresh draft' } });
    view.rerender(<AppWorkspaceHost {...props} app={null} allowedApps={null} />);
    expect(input.isConnected).toBe(true);
    expect(last(scopes.alpha).aborted).toBe(true);
    view.rerender(<AppWorkspaceHost {...props} app={definitions[0]} allowedApps={definitions} />);
    expect(await screen.findByRole('textbox', { name: 'alpha draft' })).toBe(input);
    view.rerender(<AppWorkspaceHost {...props} app={null} allowedApps={[definitions[1]]} />);
    expect(input.isConnected).toBe(false);
    view.rerender(<AppWorkspaceHost {...props} app={definitions[0]} allowedApps={definitions} />);
    expect((await screen.findByRole('textbox', { name: 'alpha draft' }) as HTMLInputElement).value).toBe('');
  });

  it('clears even public drafts on logout/account switch and refuses a stale member from another UID', async () => {
    const { definitions } = fixtures();
    const protectedApp: ShellAppDefinition = { ...definitions[1], access: 'identity' };
    const apps: readonly ShellAppDefinition[] = [definitions[0], protectedApp];
    const member: IdentityMember = { uid: 'a', provider: 'google.com', email: 'a@example.test', emailVerified: true,
      role: 'member', status: 'active', plan: 'basic', appGrants: [],
      appAccess: [{ appKey: 'beta', allowed: true, reason: 'fixture', entitlements: [] }] };
    const auth = (uid: string | null): AuthContextValue => ({ ...fallbackAuthContext, status: 'ready', identityStatus: 'ready',
      user: uid ? { uid } as never : null, member: uid ? member : null });
    const root = (uid: string | null) => <AuthContext.Provider value={auth(uid)}><AppShell apps={apps} /></AuthContext.Provider>;
    goTo('/apps/alpha');
    const view = render(root('a'));
    const input = await screen.findByRole('textbox', { name: 'alpha draft' });
    fireEvent.change(input, { target: { value: 'account a private draft' } });
    view.rerender(root(null));
    const anonymous = await screen.findByRole('textbox', { name: 'alpha draft' });
    expect(input.isConnected).toBe(false);
    expect((anonymous as HTMLInputElement).value).toBe('');
    view.rerender(root('a'));
    goTo('/apps/beta');
    const protectedInput = await screen.findByRole('textbox', { name: 'beta draft' });
    view.rerender(root('b')); // Identity still contains a in this render.
    expect(protectedInput.isConnected).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'beta draft' })).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('cleans suspended effects and restores a fresh active signal under StrictMode', async () => {
    const { definitions, scopes, subscriptions } = fixtures();
    goTo('/apps/alpha');
    const view = render(<StrictMode><AppShell apps={definitions} /></StrictMode>);
    const input = await screen.findByRole('textbox', { name: 'alpha draft' });
    await waitFor(() => expect(last(scopes.alpha).aborted).toBe(false));
    fireEvent.change(input, { target: { value: 'strict draft' } });
    goTo('/apps/beta');
    await screen.findByRole('textbox', { name: 'beta draft' });
    expect(subscriptions).toEqual(new Set(['beta']));
    goTo('/apps/alpha');
    expect(await screen.findByRole('textbox', { name: 'alpha draft' })).toBe(input);
    expect(last(scopes.alpha).aborted).toBe(false);
    view.unmount();
    expect(subscriptions.size).toBe(0);
  });

  it('closes native dialogs and removes portals while suspended, without destroying draft state', async () => {
    const { definitions } = fixtures();
    goTo('/apps/alpha');
    render(<AppShell apps={definitions} />);
    await userEvent.click(await screen.findByRole('button', { name: 'alpha action' }));
    const dialog = screen.getByRole('dialog', { name: 'alpha dialog' }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    goTo('/apps/beta');
    await screen.findByRole('textbox', { name: 'beta draft' });
    expect(dialog.open).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'alpha dialog' })).toBeNull();
  });

  it('keeps the original unmount behavior for non-opted-in Apps', async () => {
    const { definitions } = fixtures();
    const apps = definitions.map(app => ({ ...app, keepAlive: false }));
    goTo('/apps/alpha');
    render(<AppShell apps={apps} />);
    const input = await screen.findByRole('textbox', { name: 'alpha draft' });
    goTo('/apps/beta');
    await screen.findByRole('textbox', { name: 'beta draft' });
    expect(input.isConnected).toBe(false);
  });

  it('prevents suspended timers from running and does not issue work merely by resuming', async () => {
    const work = vi.fn();
    function Fixture() {
      useAppEffect(() => {
        const timer = window.setTimeout(work, 30);
        return () => window.clearTimeout(timer);
      }, []);
      return <p>timer fixture</p>;
    }
    const view = render(<AppActivityContext.Provider value><Fixture /></AppActivityContext.Provider>);
    view.rerender(<AppActivityContext.Provider value={false}><Fixture /></AppActivityContext.Provider>);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(work).not.toHaveBeenCalled();
  });
});
