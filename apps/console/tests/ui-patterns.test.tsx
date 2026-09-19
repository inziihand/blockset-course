import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceGroup, DatePicker, FolderTabs, MenuPopover, SegmentedControl, StatusBanner } from '../src/shared/ui/patterns';

const tabItems = [
  { value: 'overview', label: '總覽' },
  { value: 'details', label: '明細' },
] as const;

describe('Shared UI patterns', () => {
  it('connects folder tabs to their panel and supports arrow-key selection', async () => {
    function Example() {
      const [value, setValue] = useState<'overview' | 'details'>('overview');
      return <>
        <FolderTabs id="example-folder" ariaLabel="範例資料夾" items={tabItems}
          value={value} panelId="example-panel" onChange={setValue} />
        <div id="example-panel" role="tabpanel" aria-labelledby={`example-folder-${value}`}>{value}</div>
      </>;
    }
    const user = userEvent.setup();
    render(<Example />);
    const overview = screen.getByRole('tab', { name: '總覽' });
    overview.focus();
    await user.keyboard('{ArrowRight}');
    const details = screen.getByRole('tab', { name: '明細' });
    expect(details.getAttribute('aria-selected')).toBe('true');
    expect(details.getAttribute('aria-controls')).toBe('example-panel');
    expect(document.activeElement).toBe(details);
    expect(screen.getByRole('tabpanel').textContent).toBe('details');
  });

  it('uses the same controlled tab semantics for segmented controls', async () => {
    function Example() {
      const [value, setValue] = useState<'overview' | 'details'>('overview');
      return <SegmentedControl id="example-segment" ariaLabel="範例檢視" items={tabItems}
        value={value} onChange={setValue} />;
    }
    render(<Example />);
    await userEvent.click(screen.getByRole('tab', { name: '明細' }));
    expect(screen.getByRole('tab', { name: '明細' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps filter choices controlled with pressed-button semantics', async () => {
    function Example() {
      const [value, setValue] = useState<'all' | 'favorites'>('all');
      return <ChoiceGroup ariaLabel="商品篩選" value={value} onChange={setValue}
        items={[{ value: 'all', label: '所有' }, { value: 'favorites', label: '收藏' }]} />;
    }
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: '收藏' }));
    expect(screen.getByRole('button', { name: '收藏' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('exposes banner tone semantics and keeps its action with the caller', async () => {
    const action = vi.fn();
    render(<StatusBanner title="需要處理" tone="error"
      action={<button type="button" onClick={action}>重新嘗試</button>}>連線失敗</StatusBanner>);
    expect(screen.getByRole('alert').textContent).toContain('連線失敗');
    await userEvent.click(screen.getByRole('button', { name: '重新嘗試' }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('selects a menu option and restores focus to the trigger', async () => {
    function Example() {
      const [value, setValue] = useState<'a' | 'b'>('a');
      return <MenuPopover label="模板" value={value} onChange={setValue}
        options={[{ value: 'a', label: '模板 A' }, { value: 'b', label: '模板 B' }]} />;
    }
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole('button', { name: '模板 A' });
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: '模板' });
    await user.click(within(menu).getByRole('menuitemradio', { name: '模板 B' }));
    expect(screen.getByRole('button', { name: '模板 B' })).toBeTruthy();
    await new Promise(requestAnimationFrame);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '模板 B' }));
  });

  it('focuses the first available menu item when the current value is only a placeholder', async () => {
    render(<MenuPopover label="執行帳戶" value="" onChange={() => undefined}
      placeholder="請選擇帳戶"
      options={[{ value: 'paper', label: '模擬帳戶' }, { value: 'live', label: '正式帳戶' }]} />);
    await userEvent.click(screen.getByRole('button', { name: '請選擇帳戶' }));
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '模擬帳戶' }));
  });

  it('changes month, enforces bounds and returns the selected ISO date', async () => {
    function Example() {
      const [value, setValue] = useState('2026-09-10');
      return <DatePicker label="開始日期" value={value} min="2026-08-01" max="2026-09-17" onChange={setValue} />;
    }
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: /開始日期：2026\/09\/10/ }));
    await user.click(screen.getByRole('button', { name: '上一個月' }));
    expect(screen.getByRole('button', { name: '2026/07/31' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: '2026/08/17' }));
    expect(screen.getByRole('button', { name: /開始日期：2026\/08\/17/ })).toBeTruthy();
  });
});
