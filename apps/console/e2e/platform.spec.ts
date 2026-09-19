import { expect, test, type Page } from '@playwright/test';
import { appWindowGeometry, expectAppWindow } from './appWindow';

async function openDrawer(page: Page) {
  const mobile = page.getByRole('button', { name: '開啟平台選單', exact: true });
  const trigger = await mobile.isVisible()
    ? mobile
    : page.getByRole('button', { name: '展開 StratExec 選單', exact: true });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'StratExec 選單', exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function selectApp(page: Page, title: '測試 Alpha' | '測試 Beta') {
  const rail = page.getByRole('navigation', { name: '平台快速導覽', exact: true });
  if (await rail.isVisible()) {
    await rail.getByRole('button', { name: title, exact: true }).click();
  } else {
    const drawer = await openDrawer(page);
    await drawer.getByRole('button', { name: new RegExp(`^${title}`) }).click();
    await expect(drawer).not.toBeVisible();
  }
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function pauseFixtureTime(page: Page) {
  // Fixture latency is deliberate; advancing a controlled clock proves behavior
  // on both sides of the old response deadline without arbitrary wall-clock sleeps.
  // Call after the initial lazy App has committed; React's Suspense reveal delay
  // itself must not be frozen while the test is waiting for its first controls.
  await page.clock.install({ time: new Date('2026-09-16T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-16T00:00:01Z'));
}

test('deep links, reload and browser history share the same platform navigation', async ({ page }) => {
  await page.goto('/apps/fixture-alpha');
  await expect(page.getByRole('heading', { name: '測試 Alpha', exact: true })).toBeVisible();
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '測試顯示名稱', exact: true }).fill('只在元件內的名稱');
  await page.reload();
  await expect(page).toHaveURL(/\/apps\/fixture-alpha$/);
  await expect(page.getByRole('textbox', { name: '測試顯示名稱', exact: true })).toHaveValue('Alpha');

  await selectApp(page, '測試 Beta');
  await expect(page.getByText('Beta 正常內容', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/apps\/fixture-alpha$/);
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/apps\/fixture-beta$/);
  await expect(page.getByText('Beta 正常內容', { exact: true })).toBeVisible();
});

test('an unknown URL retains a usable route home and test App launcher', async ({ page }) => {
  await page.goto('/apps/not-registered');
  await expect(page.getByRole('heading', { name: '此網址沒有對應的應用程式', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回平台首頁', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '你的策略工作空間', exact: true })).toBeVisible();
  await page.locator('.launcher-app').filter({ hasText: '測試 Alpha' }).click();
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
});

test('a rendering failure stays inside its App while platform navigation still opens Alpha', async ({ page }) => {
  await page.goto('/apps/fixture-beta');
  await page.getByRole('button', { name: '觸發渲染錯誤', exact: true }).click();
  await expect(page.getByRole('heading', { name: '應用程式暫時無法使用', exact: true })).toBeVisible();
  await expect(page.getByText('載入或顯示時發生問題。平台導覽仍可使用；這不代表後端策略已停止。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新載入頁面', exact: true })).toBeVisible();
  await selectApp(page, '測試 Alpha');
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '應用程式暫時無法使用', exact: true })).toHaveCount(0);
});

test('a rejected lazy module presents explicit recovery and does not break another App', async ({ page }) => {
  await page.goto('/apps/fixture-beta?fixtureLoadFailure=1');
  await expect(page.getByRole('heading', { name: '應用程式暫時無法使用', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新載入頁面', exact: true })).toBeVisible();
  await expect(page.getByText('重新載入只更新前端，不重送交易命令。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回首頁', exact: true }).click();
  await expect(page.getByRole('heading', { name: '你的策略工作空間', exact: true })).toBeVisible();
  await selectApp(page, '測試 Alpha');
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
});

test('changing scope discards late data and local read errors or empty results are recoverable', async ({ page }) => {
  await page.goto('/apps/fixture-alpha');
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
  await pauseFixtureTime(page);

  await page.getByRole('button', { name: '讀取延遲資料', exact: true }).click();
  await expect(page.getByText('正在讀取離線資料…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '範圍 Beta', exact: true }).click();
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toHaveCount(0);
  await page.clock.runFor(100);
  await expect(page.getByText('資料範圍：beta', { exact: true })).toBeVisible();
  await page.clock.runFor(850); // The cancelled alpha request ignores abort and resolves here.
  await expect(page.getByText('資料範圍：beta', { exact: true })).toBeVisible();
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '讀取失敗資料', exact: true }).click();
  await page.clock.runFor(50);
  await expect(page.getByRole('heading', { name: '離線讀取失敗', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '讀取空資料', exact: true }).click();
  await page.clock.runFor(50);
  await expect(page.getByRole('heading', { name: '離線結果沒有資料', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '讀取正常資料', exact: true }).click();
  await page.clock.runFor(50);
  await expect(page.getByText('資料範圍：beta', { exact: true })).toBeVisible();
});

test('leaving an App while its read is pending cannot overwrite the next App', async ({ page }) => {
  // Warm both lazy modules first; this case targets request lifetime, not the
  // separate lazy-loading behavior exercised by the preceding navigation tests.
  await page.goto('/apps/fixture-beta');
  await expect(page.getByText('Beta 正常內容', { exact: true })).toBeVisible();
  await selectApp(page, '測試 Alpha');
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
  await pauseFixtureTime(page);
  await page.getByRole('button', { name: '讀取延遲資料', exact: true }).click();
  await expect(page.getByText('正在讀取離線資料…', { exact: true })).toBeVisible();
  await selectApp(page, '測試 Beta');
  await expect(page.getByText('Beta 正常內容', { exact: true })).toBeVisible();
  await page.clock.runFor(900);
  await expect(page.getByText('Beta 正常內容', { exact: true })).toBeVisible();
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '測試 Beta', exact: true })).toBeVisible();
});

test('native confirmation isolates page focus, restores it on Escape, and blocks closing while pending', async ({ page }) => {
  await page.goto('/apps/fixture-alpha');
  await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();
  await pauseFixtureTime(page);
  const trigger = page.getByRole('button', { name: '開啟測試確認', exact: true });
  // Keyboard invocation makes the expected return-focus target explicit, also
  // on Safari where a pointer click does not necessarily focus a button.
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: '離線操作確認', exact: true });
  const cancel = dialog.getByRole('button', { name: '取消', exact: true });
  const confirm = dialog.getByRole('button', { name: '確認離線操作', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();

  // Native modal navigation may include browser chrome instead of wrapping
  // straight to the last control. The guarantee is that background page
  // controls remain inert (W3C H102), not that Tab cannot leave the document.
  const focusRemainsIsolated = () => dialog.evaluate((element) => {
    const active = document.activeElement;
    return active === document.body || (active !== null && element.contains(active));
  });
  await page.keyboard.press('Shift+Tab');
  await expect.poll(focusRemainsIsolated).toBe(true);
  const backgroundInput = page.locator('.platform-field input');
  await backgroundInput.focus();
  await expect(backgroundInput).not.toBeFocused();
  await expect.poll(focusRemainsIsolated).toBe(true);
  await confirm.focus();
  await page.keyboard.press('Tab');
  await expect.poll(focusRemainsIsolated).toBe(true);
  await backgroundInput.focus();
  await expect(backgroundInput).not.toBeFocused();
  await cancel.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await confirm.click();
  await expect(dialog.getByRole('button', { name: '處理中…', exact: true })).toBeDisabled();
  await expect(cancel).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.clock.runFor(500);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('離線確認完成', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '關閉通知：離線確認完成', exact: true }).click();
  await expect(page.getByText('離線確認完成', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '發送測試通知', exact: true }).click();
  await expect(page.getByText('Alpha 測試通知', { exact: true })).toBeVisible();
});

test('theme preferences survive reload and the Shell and Drawer fit 390px and 320px screens', async ({ page }) => {
  await page.goto('/apps/fixture-alpha');
  const themes = [['light', '淺色'], ['dark', '深色'], ['paper', '暖紙']] as const;
  for (const [theme, label] of themes) {
    const drawer = await openDrawer(page);
    await drawer.getByText(label, { exact: true }).click();
    await expect(drawer.getByRole('radio', { name: label, exact: true })).toBeChecked();
    await drawer.getByRole('button', { name: '關閉側邊選單', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', theme);
    await expect(page.getByRole('heading', { name: '測試 Alpha', exact: true })).toBeVisible();
  }

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: '開啟平台選單', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const drawer = await openDrawer(page);
    await expect.poll(() => drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(drawer.getByRole('button', { name: '關閉側邊選單', exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: '關閉側邊選單', exact: true }).click();
    await expect(drawer).not.toBeVisible();
  }
});

test('App display modes size the entire window at phone, tablet and desktop widths', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/apps/fixture-alpha');
    await expect(page.getByText('資料範圍：alpha', { exact: true })).toBeVisible();

    for (const mode of ['compact', 'responsive'] as const) {
      if (mode === 'responsive') {
        await selectApp(page, '測試 Beta');
        await expect(page.getByText('Beta 正常內容', { exact: true })).toBeVisible();
      }
      const frame = page.locator('.platform-app-frame');
      await expect(frame).toHaveCount(1);
      await expect(frame).toHaveAttribute('data-display-mode', mode);
      await expect(page.locator('main.app-shell')).toHaveAttribute('data-display-mode', mode);
      expectAppWindow(await appWindowGeometry(page), mode, width);
      if (mode === 'compact') {
        await expect(page.getByRole('textbox', { name: '測試顯示名稱', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '開啟測試確認', exact: true })).toBeVisible();
      }
    }
  }
});
