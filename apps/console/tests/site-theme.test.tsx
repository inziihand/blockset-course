import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SiteManagementPanel } from '../src/apps/access-control/SiteManagementPanel';
import { SiteSettingsProvider } from '../src/shared/site/SiteSettingsProvider';
import { defaultSiteSettings } from '../src/shared/site/siteSettings';
import { ThemeProvider } from '../src/shared/theme/ThemeProvider';
import ThemePicker from '../src/shell/ThemePicker';

afterEach(() => {
  vi.unstubAllEnvs();
  delete document.documentElement.dataset.cornerStyle;
});

it('uses the DEV site theme for visitors without a personal selection', async () => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('DEV', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ...defaultSiteSettings, defaultTheme: 'dark', cornerStyle: 'square',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  render(<SiteSettingsProvider><ThemeProvider><ThemePicker /></ThemeProvider></SiteSettingsProvider>);
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  expect(document.documentElement.dataset.cornerStyle).toBe('square');
  expect((screen.getByRole('radio', { name: '網站預設' }) as HTMLInputElement).checked).toBe(true);
});

it('saves website identity and corner style through the authenticated local route', async () => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('DEV', true);
  const request = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => new Response(
    init?.body ? String(init.body) : JSON.stringify(defaultSiteSettings),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', request);
  render(<SiteSettingsProvider><SiteManagementPanel getIdToken={async () => 'admin-token'} /></SiteSettingsProvider>);
  fireEvent.change(screen.getByRole('textbox', { name: '網站標題' }), { target: { value: '測試網站' } });
  fireEvent.click(screen.getByRole('radio', { name: '直角' }));
  fireEvent.click(screen.getByRole('button', { name: '儲存網站設定' }));
  await waitFor(() => expect(screen.getByText('已儲存並套用至 DEV 本機網站。')).toBeTruthy());
  expect(document.documentElement.dataset.cornerStyle).toBe('square');
  const [, init] = request.mock.calls.find(([, options]) => options?.method === 'PUT')!;
  expect(init?.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
  expect(JSON.parse(String(init?.body))).toMatchObject({ title: '測試網站', cornerStyle: 'square' });
});
