import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../src/shell/AppShell';
import { ThemeProvider } from '../src/shared/theme/ThemeProvider';

vi.mock('../src/shell/generatedAppRegistry', () => {
  const icon = () => null;
  const load = async () => ({ default: () => null });
  return { generatedAppRegistry: [
    { key: 'policy-fixture', path: '/apps/policy-fixture', title: 'Policy Fixture', subtitle: '',
      description: '', icon, status: 'preview', displayMode: 'responsive', load, access: 'public' },
    { key: 'compact-fixture', path: '/apps/compact-fixture', title: 'Compact Fixture', subtitle: '',
      description: '', icon, status: 'preview', displayMode: 'compact', load, access: 'public' },
    { key: 'access-control', path: '/apps/access-control', title: '會員與權限', subtitle: '',
      description: '', icon, status: 'preview', displayMode: 'responsive', load, access: 'identity' },
  ] };
});

const runtime = vi.hoisted(() => ({
  accessMode: 'grant_required' as 'public' | 'all_members' | 'grant_required',
  retryIdentitySync: vi.fn(),
}));

vi.mock('../src/shared/auth/config', () => ({
  firebaseAuthConfiguration: { state: 'configured' },
}));

vi.mock('../src/shared/auth', () => ({
  useAuth: () => ({
    member: null,
    identityStatus: 'idle',
    identityError: '',
    retryIdentitySync: runtime.retryIdentitySync,
  }),
}));

vi.mock('../src/shared/api/appLifecycle', () => ({
  APP_LIFECYCLE_CHANGED_EVENT: 'stratexec:app-lifecycle-changed',
  APP_ORDER_CHANGED_EVENT: 'stratexec:app-order-changed',
  fetchInstalledAppCatalog: vi.fn(async () => new Map([
    ['compact-fixture', 'public'],
    ['policy-fixture', runtime.accessMode],
    ['access-control', 'admins_only'],
  ])),
}));

describe('runtime App access policy', () => {
  beforeEach(() => {
    runtime.accessMode = 'grant_required';
    runtime.retryIdentitySync.mockClear();
    window.history.replaceState({}, '', '/apps/policy-fixture');
  });

  afterEach(() => window.history.replaceState({}, '', '/'));

  it('overrides a public manifest default and refreshes after an administrator policy change', async () => {
    render(<ThemeProvider><AppShell /></ThemeProvider>);

    expect(await screen.findByRole('heading', { name: '請先登入使用此 App' })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: '平台快速導覽' }))
      .queryByRole('button', { name: 'Policy Fixture' })).toBeNull();

    runtime.accessMode = 'public';
    act(() => window.dispatchEvent(new Event('stratexec:app-lifecycle-changed')));

    await waitFor(() => expect(within(screen.getByRole('navigation', { name: '平台快速導覽' }))
      .getByRole('button', { name: 'Policy Fixture' })).toBeTruthy());
    expect(runtime.retryIdentitySync).toHaveBeenCalledOnce();

    const appButtons = within(screen.getByRole('navigation', { name: '平台快速導覽' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label?.endsWith('Fixture'));
    expect(appButtons).toEqual(['Compact Fixture', 'Policy Fixture']);

    act(() => window.dispatchEvent(new CustomEvent('stratexec:app-order-changed', {
      detail: { appKeys: ['policy-fixture', 'compact-fixture', 'access-control'] },
    })));
    const reorderedButtons = within(screen.getByRole('navigation', { name: '平台快速導覽' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label?.endsWith('Fixture'));
    expect(reorderedButtons).toEqual(['Policy Fixture', 'Compact Fixture']);
    expect(runtime.retryIdentitySync).toHaveBeenCalledOnce();
  });
});
