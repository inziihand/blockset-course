import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppShell from '../../src/shell/AppShell';
import { appRegistry, validateAppRegistry } from '../../src/shell/appRegistry';
import { ThemeProvider } from '../../src/shared/theme/ThemeProvider';
import { getTestApps, testApps } from './registry';

const renderFixtures = (apps = testApps) => render(<ThemeProvider><AppShell apps={apps} /></ThemeProvider>);

describe('Offline browser fixtures', () => {
  it('registers exactly two test-only Apps without changing the production registry', () => {
    expect(testApps).toHaveLength(2);
    expect(() => validateAppRegistry(testApps)).not.toThrow();
    expect(appRegistry.some((app) => testApps.some((fixture) => app.key === fixture.key || app.path === fixture.path))).toBe(false);
    expect(testApps.map((app) => app.path)).toEqual(['/apps/fixture-alpha', '/apps/fixture-beta']);
  });

  it('uses the actual read hook and client without invoking global network fetch', async () => {
    const network = vi.fn(() => { throw new Error('Unexpected network access from fixture'); });
    vi.stubGlobal('fetch', network);
    window.history.replaceState({}, '', '/apps/fixture-alpha');
    renderFixtures();
    expect(await screen.findByText('資料範圍：alpha')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '讀取延遲資料' }));
    expect(screen.getByText('正在讀取離線資料…')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '範圍 Beta' }));
    expect(await screen.findByText('資料範圍：beta')).toBeTruthy();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 850)); });
    expect(screen.getByText('資料範圍：beta')).toBeTruthy();
    expect(screen.queryByText('資料範圍：alpha')).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it('exposes shared error and empty states and supports a successful read afterward', async () => {
    window.history.replaceState({}, '', '/apps/fixture-alpha');
    renderFixtures();
    await screen.findByText('資料範圍：alpha');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '讀取失敗資料' }));
    expect(await screen.findByRole('heading', { name: '離線讀取失敗' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '讀取空資料' }));
    expect(await screen.findByRole('heading', { name: '離線結果沒有資料' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '讀取正常資料' }));
    expect(await screen.findByText('資料範圍：alpha')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens the shared confirmation and sends only a local notification after acceptance', async () => {
    window.history.replaceState({}, '', '/apps/fixture-alpha');
    renderFixtures();
    await screen.findByText('資料範圍：alpha');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '開啟測試確認' }));
    const dialog = screen.getByRole('dialog', { name: '離線操作確認' });
    await user.click(within(dialog).getByRole('button', { name: '確認離線操作' }));
    expect((within(dialog).getByRole('button', { name: '處理中…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText('離線確認完成')).toBeTruthy();
    await waitFor(() => expect((dialog as HTMLDialogElement).open).toBe(false));
  });

  it('injects lazy-load rejection only in the requested test-host instance', async () => {
    const failing = getTestApps({ failBetaLoad: true });
    await expect(failing[1].load!()).rejects.toThrow('intentional module failure');
    await expect(testApps[1].load!()).resolves.toHaveProperty('default');
  });
});
