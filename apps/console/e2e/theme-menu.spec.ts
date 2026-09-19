import { expect, test } from '@playwright/test';

test('desktop quick appearance matches the source list and preserves native dismissal and theme state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The quick appearance popover belongs to the desktop rail; mobile uses the Drawer cards.');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/apps/fixture-beta');
  await expect(page.getByText('Beta 正常內容', { exact: true })).toBeVisible();
  const gear = page.getByRole('button', { name: '個人化', exact: true });
  const popup = page.getByRole('dialog', { name: '個人化外觀', exact: true });
  const rail = page.getByRole('navigation', { name: '平台快速導覽', exact: true });
  const shell = page.locator('main.app-shell');
  const topbar = shell.locator('.topbar');

  const lightTokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      control: styles.getPropertyValue('--color-surface-control').trim(),
      shellShadow: styles.getPropertyValue('--shadow-shell').trim(),
    };
  });
  expect(lightTokens).toEqual({
    control: '#f8fbff',
    shellShadow: '0 22px 70px rgba(31, 54, 86, .18)',
  });
  expect(await shell.evaluate((element) => getComputedStyle(element).boxShadow)).toContain('inset');
  await expect(topbar).toHaveCSS('backdrop-filter', 'blur(16px)');
  expect(await topbar.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');

  await gear.focus();
  await gear.press('Enter');
  await expect(popup).toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  await expect(gear).toHaveClass(/\bactive\b/);
  await expect(popup.getByText('個人化', { exact: true })).toBeVisible();
  await expect(popup.getByText('目前為 淺色 外觀', { exact: true })).toBeVisible();
  await expect(popup.getByRole('radio')).toHaveCount(4);
  const box = (await popup.boundingBox())!;
  const railBox = (await rail.boundingBox())!;
  expect(box.width).toBeCloseTo(190, 0);
  expect(box.x - railBox.x - railBox.width).toBeCloseTo(8, 0);
  expect(page.viewportSize()!.height - box.y - box.height).toBeCloseTo(58, 0);
  expect(await popup.evaluate((element) => getComputedStyle(element).padding)).toBe('7px');
  const rows = await popup.locator('.theme-options label').all();
  let previousBottom = 0;
  for (const row of rows) {
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.height).toBeCloseTo(36, 0);
    expect(rowBox.y).toBeGreaterThanOrEqual(previousBottom);
    expect(rowBox.x).toBeCloseTo(box.x + 8, 0); // 1px border + 7px padding
    previousBottom = rowBox.y + rowBox.height;
  }
  await expect(popup.locator('.theme-menu-header')).toHaveCSS('border-bottom-style', 'solid');
  const selected = popup.getByRole('radio', { name: '跟隨系統', exact: true });
  if (!(await selected.evaluate((element) => element === document.activeElement))) {
    await page.keyboard.press('Tab');
  }
  await expect(selected).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popup).not.toBeVisible();
  await expect(gear).toBeFocused();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await expect(gear).not.toHaveClass(/\bactive\b/);

  await gear.click();
  await popup.getByText('暖紙', { exact: true }).click();
  await expect(popup).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  expect(await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      control: styles.getPropertyValue('--color-surface-control').trim(),
      secondary: styles.getPropertyValue('--color-text-secondary').trim(),
    };
  })).toEqual({ control: '#f8f4ea', secondary: '#70787c' });
  expect(await page.evaluate(() => localStorage.getItem('stratexec:theme'))).toBe('paper');
  await gear.click();
  await expect(popup.getByText('目前為 暖紙 外觀', { exact: true })).toBeVisible();
  await expect(popup.getByRole('radio', { name: '暖紙', exact: true })).toBeChecked();
  await expect(popup.locator('.lucide-check')).toHaveCount(1);
  await expect(popup.locator('label.selected .lucide-check')).toHaveAttribute('aria-hidden', 'true');
  // Clicking the already-selected row should close the same as selecting a new row.
  await popup.getByText('暖紙', { exact: true }).click();
  await expect(popup).not.toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await gear.click();
  await expect(popup.getByText('目前為 暖紙 外觀', { exact: true })).toBeVisible();
  await page.locator('.topbar h1').click();
  await expect(popup).not.toBeVisible();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');

  // The larger Drawer retains its existing card presentation and the shared preference.
  await page.getByRole('button', { name: '展開 StratExec 選單', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'StratExec 選單', exact: true });
  await expect(drawer.getByRole('radio', { name: '暖紙', exact: true })).toBeChecked();
  await expect(drawer.locator('.theme-picker--list')).toHaveCount(0);
  const cardBoxes = await Promise.all((await drawer.locator('.theme-options label').all()).map((item) => item.boundingBox()));
  expect(cardBoxes[0]!.height).toBeCloseTo(48, 0);
  expect(cardBoxes[0]!.y).toBeCloseTo(cardBoxes[1]!.y, 0);
  expect(cardBoxes[1]!.x).toBeGreaterThan(cardBoxes[0]!.x);
  await drawer.getByText('深色', { exact: true }).click();
  await drawer.getByRole('button', { name: '關閉側邊選單', exact: true }).click();
  await gear.click();
  await expect(popup.getByText('目前為 深色 外觀', { exact: true })).toBeVisible();
  await expect(popup.getByRole('radio', { name: '深色', exact: true })).toBeChecked();
});
