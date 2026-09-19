import { expect, test, type Page } from '@playwright/test';
import { appWindowGeometry, expectAppWindow } from './appWindow';

const demoOrigin = 'http://127.0.0.1:5177';

async function visitDemo(page: Page, mode: 'compact' | 'responsive' = 'responsive') {
  await page.goto(`${demoOrigin}/apps/${mode === 'compact' ? 'demo-compact' : 'demo'}`);
  await expect(page.getByRole('heading', { name: mode === 'compact' ? 'Demo App · 窄版' : 'Demo App · 通用', exact: true })).toBeVisible();
  await expect(page.getByText('離線示範', { exact: true })).toBeVisible();
  await expect(page.getByText('介面元件整理', { exact: true })).toBeVisible();
}

async function frameGeometry(page: Page) {
  return page.locator('.platform-app-frame').evaluate((element) => {
    const parent = element.closest('.app-content')!;
    const parentStyle = getComputedStyle(parent);
    const rect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const available = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
    const contentLeft = parentRect.left + parseFloat(parentStyle.borderLeftWidth) + parseFloat(parentStyle.paddingLeft);
    const countColumns = (selector: string) => getComputedStyle(element.querySelector(selector)!).gridTemplateColumns.split(/\s+/).length;
    const folderTabsFit = [...element.querySelectorAll<HTMLElement>('.platform-folder-tabs')].every((tabs) => {
      const boundary = tabs.closest<HTMLElement>('.demo-folder-panel')
        ?? tabs.closest<HTMLElement>('.demo-data-workspace');
      if (!boundary) return false;
      const tabsRect = tabs.getBoundingClientRect();
      const boundaryRect = boundary.getBoundingClientRect();
      const buttonsFit = [...tabs.querySelectorAll('button')].every((button) => {
        const buttonRect = button.getBoundingClientRect();
        return buttonRect.left >= tabsRect.left - 1 && buttonRect.right <= tabsRect.right + 1;
      });
      return tabsRect.left >= boundaryRect.left && tabsRect.right <= boundaryRect.right && buttonsFit;
    });
    return {
      width: rect.width,
      available,
      offset: rect.left - contentLeft,
      summaryColumns: countColumns('.demo-summary-grid'),
      workspaceColumns: countColumns('.demo-workspace-grid'),
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      contentOverflows: element.scrollWidth > element.clientWidth + 1,
      folderTabsFit,
    };
  });
}

test('the responsive Demo adapts its content without losing the local draft on resize', async ({ page }) => {
  await visitDemo(page);
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).scrollbarGutter)).toContain('stable');
  const name = page.getByRole('textbox', { name: '展示名稱', exact: true });
  await name.fill('調整畫面後仍保留的草稿');
  const observedColumns = new Set<number>();

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.platform-app-frame')).toHaveAttribute('data-display-mode', 'responsive');
    await expect(page.locator('main.app-shell')).toHaveAttribute('data-display-mode', 'responsive');
    expectAppWindow(await appWindowGeometry(page), 'responsive', width);
    await expect(name).toHaveValue('調整畫面後仍保留的草稿');
    const geometry = await frameGeometry(page);
    const expectedColumns = geometry.width >= 1024 ? 3 : geometry.width >= 600 ? 2 : 1;
    expect(Math.abs(geometry.width - geometry.available), `responsive width at ${width}px`).toBeLessThanOrEqual(1);
    expect(geometry.summaryColumns, `summary columns at ${width}px`).toBe(expectedColumns);
    expect(geometry.workspaceColumns, `workspace columns at ${width}px`).toBe(Math.min(2, expectedColumns));
    expect(geometry.pageOverflows, `page overflow at ${width}px`).toBe(false);
    expect(geometry.contentOverflows, `content overflow at ${width}px`).toBe(false);
    expect(geometry.folderTabsFit, `folder tabs at ${width}px`).toBe(true);
    observedColumns.add(geometry.summaryColumns);
  }
  expect([...observedColumns].sort()).toEqual([1, 2, 3]);
  await expect(page.getByLabel('已套用展示名稱', { exact: true })).toHaveText('我的工作台');
});

test('the App window stays fixed when the page scrollbar appears and disappears', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(demoOrigin);
  await expect(page.getByRole('heading', { name: '你的策略工作空間', exact: true })).toBeVisible();
  const shellGeometry = () => page.locator('main.app-shell').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, scrollY: window.scrollY };
  });
  const pageOverflows = () => page.evaluate(() =>
    document.documentElement.scrollHeight > document.documentElement.clientHeight,
  );
  const before = await shellGeometry();
  expect(await pageOverflows()).toBe(false);
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'scrollbar-regression-spacer';
    spacer.style.height = '300px';
    document.body.append(spacer);
  });
  expect(await pageOverflows()).toBe(true);
  expect(await shellGeometry()).toEqual(before);
  await page.evaluate(() => document.querySelector('#scrollbar-regression-spacer')?.remove());
  expect(await pageOverflows()).toBe(false);
  expect(await shellGeometry()).toEqual(before);
});

test('compact keeps the whole window narrow while route switches restore responsive and home layouts', async ({ page }) => {
  await visitDemo(page, 'compact');
  await expect(page.locator('.platform-app-frame')).toHaveAttribute('data-display-mode', 'compact');
  await expect(page.locator('main.app-shell')).toHaveAttribute('data-display-mode', 'compact');
  const name = page.getByRole('textbox', { name: '展示名稱', exact: true });
  await name.fill('窄版視窗草稿');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expectAppWindow(await appWindowGeometry(page), 'compact', width);
    const geometry = await frameGeometry(page);
    expect(geometry.summaryColumns).toBe(1);
    expect(geometry.workspaceColumns).toBe(1);
    expect(geometry.folderTabsFit, `compact folder tabs at ${width}px`).toBe(true);
    await expect(name).toHaveValue('窄版視窗草稿');
    if (width === 320) {
      await page.getByRole('button', { name: '預覽確認', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '確認展示內容', exact: true });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= document.documentElement.clientWidth && element.scrollWidth <= element.clientWidth + 1;
      })).toBe(true);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
  }
  await expect(page.getByRole('navigation', { name: '平台快速導覽', exact: true })).toBeVisible();
  const railBefore = await page.locator('.app-rail').boundingBox();

  await page.getByRole('button', { name: '通用模式', exact: true }).click();
  await expect(page).toHaveURL(`${demoOrigin}/apps/demo`);
  await expect(page.locator('.platform-app-frame')).toHaveAttribute('data-display-mode', 'responsive');
  await expect(page.getByText('介面元件整理', { exact: true })).toBeVisible();
  const wideGeometry = await appWindowGeometry(page);
  expectAppWindow(wideGeometry, 'responsive', 1440);
  expect(wideGeometry.shellWidth).toBeGreaterThan(420);
  expect(await page.locator('.app-rail').boundingBox()).toEqual(railBefore);
  await page.getByRole('button', { name: '窄版模式', exact: true }).click();
  await expect(page).toHaveURL(`${demoOrigin}/apps/demo-compact`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Demo App · 窄版', exact: true })).toBeVisible();
  await expect(page.locator('.platform-app-frame')).toHaveAttribute('data-display-mode', 'compact');
  await expect(page.getByText('介面元件整理', { exact: true })).toBeVisible();
  expectAppWindow(await appWindowGeometry(page), 'compact', 1440);
  await page.getByRole('button', { name: '返回平台首頁', exact: true }).click();
  await expect(page.getByRole('heading', { name: '你的策略工作空間', exact: true })).toBeVisible();
  await expect(page.locator('main.app-shell')).not.toHaveAttribute('data-display-mode');
  const homeWidth = await page.locator('main.app-shell').evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(homeWidth - wideGeometry.shellWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator('.app-rail').boundingBox()).toEqual(railBefore);
});

test('Demo confirmation, saved preference and read recovery stay local with no real API request', async ({ page }) => {
  const unexpectedRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || (['fetch', 'xhr'].includes(request.resourceType()) && url.origin !== demoOrigin)) {
      unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await visitDemo(page, 'compact');
  const name = page.getByRole('textbox', { name: '展示名稱', exact: true });
  await name.fill('只存在本機的示範名稱');
  await page.getByRole('button', { name: '預覽確認', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確認展示內容', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('已套用展示名稱', { exact: true })).toHaveText('我的工作台');
  await page.getByRole('button', { name: '預覽確認', exact: true }).click();
  await dialog.getByRole('button', { name: '套用展示', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('展示名稱已更新', { exact: true })).toBeVisible();
  await expect(page.getByLabel('已套用展示名稱', { exact: true })).toHaveText('只存在本機的示範名稱');
  await page.reload();
  await expect(name).toHaveValue('只存在本機的示範名稱');
  await expect(page.getByLabel('已套用展示名稱', { exact: true })).toHaveText('只存在本機的示範名稱');
  await expect(page.getByText('介面元件整理', { exact: true })).toBeVisible();
  await page.clock.install({ time: new Date('2026-09-16T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-16T00:00:01Z'));

  await page.getByRole('button', { name: '空資料', exact: true }).click();
  await expect(page.getByText('正在載入範例資料…', { exact: true })).toBeVisible();
  await page.clock.runFor(500);
  await expect(page.getByRole('heading', { name: '目前沒有範例資料', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '模擬失敗', exact: true }).click();
  await page.clock.runFor(500);
  await expect(page.getByRole('heading', { name: '範例資料暫時無法顯示', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '正常資料', exact: true }).click();
  await page.clock.runFor(500);
  await expect(page.getByText('介面元件整理', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '範例資料暫時無法顯示', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await expect(page.getByText('正在載入範例資料…', { exact: true })).toBeVisible();
  await page.clock.runFor(500);
  await expect(page.getByText('介面元件整理', { exact: true })).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
});
