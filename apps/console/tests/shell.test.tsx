import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Box } from 'lucide-react';
import AppShell from '../src/shell/AppShell';
import { getAppDefinition, getLaunchableApps, isLaunchableDefinition } from '../src/shell/appRegistry';
import { AuthContext, fallbackAuthContext } from '../src/shared/auth/authContext';
import { initializeTheme, ThemeProvider, THEME_STORAGE_KEY } from '../src/shared/theme/ThemeProvider';
import { media } from './setup';

const renderShell = () => render(<ThemeProvider><AppShell apps={[]} /></ThemeProvider>);
const openDrawer = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '展開 StratExec 選單' }));
  return { user, drawer: screen.getByRole('dialog', { name: 'StratExec 選單' }) };
};

describe('App-free platform', () => {
  it('starts on the launcher with zero Apps, no business actions and an account entry', () => {
    renderShell();
    expect(getLaunchableApps([])).toHaveLength(0);
    expect(getAppDefinition('optionsLab', [])).toBeUndefined();
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
    expect(screen.getByText('0 個應用程式')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /下單|股票行情|DeriStrat/ })).toBeNull();
    expect(screen.getByRole('button', { name: '開啟登入與帳戶選單' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '以 Google 帳號登入' })).toBeNull();
  });

  it('uses a single drawer and returns to the empty home', async () => {
    renderShell();
    const { user, drawer } = await openDrawer();
    expect((drawer as HTMLDialogElement).open).toBe(true);
    expect(within(drawer).getByText('尚未加入應用程式')).toBeTruthy();
    expect(within(drawer).getByText('策略執行平台 · v0.1.0')).toBeTruthy();
    expect(within(drawer).getByText('Firebase Auth 尚未設定')).toBeTruthy();
    await user.click(within(drawer).getByRole('button', { name: '返回 StratExec 首頁' }));
    expect((drawer as HTMLDialogElement).open).toBe(false);
    expect(screen.getByRole('heading', { name: '你的策略工作空間' })).toBeTruthy();
  });

  it('handles native cancellation and backdrop clicks without leaving the drawer open', async () => {
    renderShell();
    const { user, drawer } = await openDrawer();
    fireEvent(drawer, new Event('cancel', { cancelable: true }));
    expect((drawer as HTMLDialogElement).open).toBe(false);
    await user.click(screen.getByRole('button', { name: '展開 StratExec 選單' }));
    fireEvent.click(drawer);
    expect((drawer as HTMLDialogElement).open).toBe(false);
  });

  it('does not launch planned or loader-less definitions', () => {
    const base = { key: 'test-only', path: '/apps/test-only' as const, title: 'Fixture', subtitle: '', description: '', icon: Box, access: 'public' as const, displayMode: 'responsive' as const };
    expect(isLaunchableDefinition({ ...base, status: 'planned', load: async () => ({ default: () => null }) })).toBe(false);
    expect(isLaunchableDefinition({ ...base, status: 'enabled' })).toBe(false);
    expect(isLaunchableDefinition({ ...base, status: 'preview', load: async () => ({ default: () => null }) })).toBe(true);
  });

  it('distinguishes a recoverable Identity sync failure from denied App access', async () => {
    const retryIdentitySync = vi.fn();
    window.history.replaceState(null, '', '/apps/member-only');
    const protectedApp = {
      key: 'member-only', path: '/apps/member-only' as const, title: '會員 App', subtitle: '', description: '', icon: Box,
      status: 'enabled' as const, access: 'identity' as const, displayMode: 'responsive' as const,
      load: async () => ({ default: () => null }),
    };
    render(<AuthContext.Provider value={{
      ...fallbackAuthContext,
      user: { uid: 'member-1', email: 'member@example.test' } as never,
      status: 'ready', identityStatus: 'error', identityError: '平台權限服務暫時無法使用。', retryIdentitySync,
    }}><ThemeProvider><AppShell apps={[protectedApp]} /></ThemeProvider></AuthContext.Provider>);
    expect(screen.getByRole('heading', { name: '平台權限尚未同步' })).toBeTruthy();
    expect(screen.queryByText('目前帳號沒有此 App 使用權')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '重新同步權限' }));
    expect(retryIdentitySync).toHaveBeenCalledOnce();
  });
});

describe('Theme migration', () => {
  it('keeps four semantic Drawer theme options and a safe unconfigured Auth placeholder', async () => {
    renderShell();
    const { user, drawer } = await openDrawer();
    expect(within(drawer).getAllByRole('radio')).toHaveLength(4);
    await user.click(within(drawer).getByRole('radio', { name: '淺色' }));
    expect((within(drawer).getByRole('radio', { name: '淺色' }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    const account = within(drawer).getByRole('region', { name: '會員帳號' });
    expect(within(account).getByText('填寫根目錄 .env.local 後可啟用 Google 登入')).toBeTruthy();
    expect((within(account).getByRole('button', { name: '以 Google 帳號登入' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(account).queryByText('管理員')).toBeNull();
  });

  it('persists warm-paper preference under a separate platform key and restores it', async () => {
    window.localStorage.setItem('kernel-market-theme', 'dark');
    const view = renderShell();
    const { user, drawer } = await openDrawer();
    await user.click(within(drawer).getByRole('radio', { name: '暖紙' }));
    expect(document.documentElement.dataset.theme).toBe('paper');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('paper');
    expect(window.localStorage.getItem('kernel-market-theme')).toBe('dark');
    view.unmount();
    initializeTheme();
    renderShell();
    expect(document.documentElement.dataset.theme).toBe('paper');
  });

  it('tracks the system theme only when system preference is selected', async () => {
    renderShell();
    const { user, drawer } = await openDrawer();
    act(() => { media.matches = true; media.dispatchEvent(Object.assign(new Event('change'), { matches: true })); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(within(drawer).getByRole('radio', { name: '淺色' }));
    act(() => media.dispatchEvent(Object.assign(new Event('change'), { matches: true })));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('synchronizes preference from another tab and rejects invalid stored values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'invalid');
    initializeTheme();
    expect(document.documentElement.dataset.themePreference).toBe('system');
    renderShell();
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('still switches themes when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    initializeTheme();
    renderShell();
    const { user, drawer } = await openDrawer();
    await user.click(within(drawer).getByRole('radio', { name: '深色' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
