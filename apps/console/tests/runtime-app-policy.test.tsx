import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../src/shell/AppShell';
import { ThemeProvider } from '../src/shared/theme/ThemeProvider';

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
  fetchInstalledAppCatalog: vi.fn(async () => new Map([
    ['demo', runtime.accessMode],
    ['access-control', 'admins_only'],
  ])),
}));

describe('runtime App access policy', () => {
  beforeEach(() => {
    runtime.accessMode = 'grant_required';
    runtime.retryIdentitySync.mockClear();
    window.history.replaceState({}, '', '/apps/demo');
  });

  afterEach(() => window.history.replaceState({}, '', '/'));

  it('overrides a public manifest default and refreshes after an administrator policy change', async () => {
    render(<ThemeProvider><AppShell /></ThemeProvider>);

    expect(await screen.findByRole('heading', { name: '請先登入使用此 App' })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: '平台快速導覽' }))
      .queryByRole('button', { name: 'Demo App · 通用' })).toBeNull();

    runtime.accessMode = 'public';
    act(() => window.dispatchEvent(new Event('stratexec:app-lifecycle-changed')));

    await waitFor(() => expect(within(screen.getByRole('navigation', { name: '平台快速導覽' }))
      .getByRole('button', { name: 'Demo App · 通用' })).toBeTruthy());
    expect(runtime.retryIdentitySync).toHaveBeenCalledOnce();
  });
});
