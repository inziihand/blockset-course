import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import DemoComponentGallery from '../src/apps/demo/DemoComponentGallery';
import DemoDataWorkspace from '../src/apps/demo/DemoDataWorkspace';

describe('Demo component gallery', () => {
  it('keeps selection, menu, segmented view and range controls local', async () => {
    const user = userEvent.setup();
    render(<DemoComponentGallery />);

    await user.selectOptions(screen.getByRole('combobox', { name: '展示資料來源' }), 'workspace-b');
    expect(screen.getByText(/目前選擇：離線工作區 B/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '表單與預覽' }));
    const menu = screen.getByRole('menu', { name: '版面模板' });
    await user.click(within(menu).getByRole('menuitemradio', { name: /監控儀表板/ }));
    expect(screen.getByText(/離線工作區 B · 監控儀表板/)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: '趨勢' }));
    expect(screen.getByRole('tab', { name: '趨勢' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('近 30 天')).toBeTruthy();

    const density = screen.getByRole('slider', { name: '顯示密度' });
    fireEvent.change(density, { target: { value: '44' } });
    expect(screen.getByLabelText(/資料完整度/).textContent).toContain('97%');
  });

  it('supports date presets, custom dates and applying a range', async () => {
    const user = userEvent.setup();
    render(<DemoComponentGallery />);

    await user.click(screen.getByRole('button', { name: '1 週' }));
    expect(screen.getByRole('button', { name: /開始日期：2026\/09\/10/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(screen.getByText('已套用日期：2026/09/10 至 2026/09/17')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /開始日期：2026\/09\/10/ }));
    await user.click(screen.getByRole('button', { name: '上一個月' }));
    await user.click(screen.getByRole('button', { name: '2026/08/01' }));
    await user.click(screen.getByRole('button', { name: /結束日期：2026\/09\/17/ }));
    await user.click(screen.getByRole('button', { name: '上一個月' }));
    await user.click(screen.getByRole('button', { name: '2026/08/31' }));
    await user.click(screen.getByRole('button', { name: '套用' }));
    expect(screen.getByText('已套用日期：2026/08/01 至 2026/08/31')).toBeTruthy();
  });
});

describe('Demo data workspace', () => {
  it('supports local folder tabs, filters, favorites, search and row details', async () => {
    const user = userEvent.setup();
    render(<DemoDataWorkspace />);

    await user.click(screen.getByRole('tab', { name: '活動紀錄' }));
    expect(screen.getByText('活動紀錄範例')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: '資料項目' }));

    await user.click(screen.getByRole('button', { name: '收藏' }));
    expect(screen.getAllByRole('row').length).toBe(3);
    await user.click(screen.getByRole('button', { name: '所有' }));

    const search = screen.getByRole('searchbox', { name: '搜尋元件資料' });
    await user.type(search, '監控');
    expect(screen.getByRole('rowheader').textContent).toContain('監控儀表板');
    await user.clear(search);

    await user.click(screen.getByRole('button', { name: '展開 清單與明細' }));
    expect(screen.getByLabelText('清單與明細 範例明細').textContent).toContain('篩選、排序、收藏與展開列');
    await user.click(screen.getByRole('button', { name: '取消收藏 清單與明細' }));
    expect(screen.getByRole('button', { name: '收藏 清單與明細' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('updates local revision and sortable columns without external data', async () => {
    const user = userEvent.setup();
    render(<DemoDataWorkspace />);

    await user.click(screen.getByRole('button', { name: '更新範例' }));
    expect(screen.getByText(/目前顯示第 2 版範例/)).toBeTruthy();
    expect(screen.getAllByText(/第 2 版/)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '依完成度排序' }));
    const firstRow = screen.getAllByRole('row')[1];
    expect(firstRow.textContent).toContain('窄版表單');
  });
});
