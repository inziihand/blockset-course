import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ThemePicker from '../src/shell/ThemePicker';
import { ThemeProvider, THEME_STORAGE_KEY } from '../src/shared/theme/ThemeProvider';
import { media } from './setup';

describe('Theme picker presentation variants', () => {
  it('keeps the default five-card picker separate from the quick list', () => {
    const { container } = render(<ThemeProvider><ThemePicker /></ThemeProvider>);
    expect(screen.getAllByRole('radio').map((input) => input.getAttribute('value'))).toEqual([
      'site', 'system', 'light', 'dark', 'paper',
    ]);
    expect(screen.getByText('外觀', { exact: true })).toBeTruthy();
    expect(container.querySelector('.theme-picker--list')).toBeNull();
    expect(container.querySelector('.theme-menu-header')).toBeNull();
    expect(container.querySelector('.lucide-check')).toBeNull();
  });

  it('shares preference with the cards and shows only the selected list check', async () => {
    const user = userEvent.setup();
    const { container } = render(<ThemeProvider><ThemePicker /><ThemePicker variant="list" /></ThemeProvider>);
    const list = container.querySelector('.theme-picker--list') as HTMLElement;
    const cards = container.querySelector('.theme-picker:not(.theme-picker--list)') as HTMLElement;
    expect(list).toBeTruthy();
    expect(cards).toBeTruthy();
    expect(screen.getByText('個人化', { exact: true })).toBeTruthy();
    await user.click(within(list).getByRole('radio', { name: '暖紙' }));
    expect((within(cards).getByRole('radio', { name: '暖紙' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('目前為 暖紙 外觀', { exact: true })).toBeTruthy();
    expect(list.querySelectorAll('.lucide-check')).toHaveLength(1);
    expect(list.querySelector('.selected .lucide-check')?.getAttribute('aria-hidden')).toBe('true');
    expect(cards.querySelector('.lucide-check')).toBeNull();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('paper');

    await user.click(within(cards).getByRole('radio', { name: '深色' }));
    expect((within(list).getByRole('radio', { name: '深色' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('目前為 深色 外觀', { exact: true })).toBeTruthy();
    expect(list.querySelectorAll('.lucide-check')).toHaveLength(1);
  });

  it('describes the resolved appearance while the website default option stays selected', () => {
    const { container } = render(<ThemeProvider><ThemePicker variant="list" /></ThemeProvider>);
    expect(screen.getByText('目前為 淺色 外觀', { exact: true })).toBeTruthy();
    act(() => {
      media.matches = true;
      media.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    });
    expect(screen.getByText('目前為 深色 外觀', { exact: true })).toBeTruthy();
    expect((screen.getByRole('radio', { name: '網站預設' }) as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('.selected')?.textContent).toBe('網站預設');
    expect(document.documentElement.dataset.themePreference).toBe('site');
  });

  it('notifies selection once for a change and again when reselecting the current option', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThemeProvider><ThemePicker variant="list" onSelect={onSelect} /></ThemeProvider>);
    await user.click(screen.getByRole('radio', { name: '暖紙' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('radio', { name: '暖紙' }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.theme).toBe('paper');
  });
});
