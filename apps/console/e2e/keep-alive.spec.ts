import { expect, test, type Page } from '@playwright/test';

async function selectApp(page: Page, key: 'alpha' | 'beta') {
  const title = `Keep-alive ${key}`;
  const rail = page.getByRole('navigation', { name: '平台快速導覽', exact: true });
  if (await rail.isVisible()) {
    await rail.getByRole('button', { name: title, exact: true }).click();
  } else {
    await page.getByRole('button', { name: '開啟平台選單', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'StratExec 選單', exact: true });
    await drawer.getByRole('button', { name: new RegExp(`^${title}`) }).click();
    await expect(drawer).not.toBeVisible();
  }
  await expect(page.getByRole('textbox', { name: `${key} draft`, exact: true })).toBeVisible();
}

test('retains draft DOM through navigation/history and suspends background timers/portals', async ({ page }) => {
  // Install before the App creates timers; replacing timer APIs afterwards can
  // leave an interval created by the real WebKit clock impossible to cancel.
  await page.clock.install({ time: new Date('2026-10-04T00:00:00Z') });
  await page.goto('/apps/keep-alive-alpha?keepAliveFixture=1');
  const alpha = page.getByRole('textbox', { name: 'alpha draft', exact: true });
  await expect(alpha).toBeVisible();
  await alpha.fill('unfinished editor draft');
  await alpha.evaluate(element => element.setAttribute('data-dom-probe', 'original'));
  await expect(page.locator('[data-app-key="keep-alive-beta"]')).toHaveCount(0);
  // Warm both lazy Apps before pausing React's Suspense reveal timer. This
  // check targets effect suspension, not loading a new module under a frozen clock.
  await selectApp(page, 'beta');
  await selectApp(page, 'alpha');
  await page.clock.pauseAt(new Date('2026-10-04T00:01:00Z'));
  await selectApp(page, 'beta');
  const retained = page.locator('[data-app-key="keep-alive-alpha"]');
  await expect(retained).toBeHidden();
  await expect(retained).toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'alpha action', exact: true })).toHaveCount(0);
  await expect(page.getByText('alpha information', { exact: true })).toHaveCount(0);
  const ticks = retained.locator('output');
  const frozen = await ticks.textContent();
  await page.clock.runFor(500);
  await expect(ticks).toHaveText(frozen!);
  await page.goBack();
  await expect(alpha).toHaveValue('unfinished editor draft');
  await expect(alpha).toHaveAttribute('data-dom-probe', 'original');
  await expect(page.getByRole('button', { name: 'alpha action', exact: true })).toBeVisible();
  await page.clock.runFor(100);
  await expect(ticks).not.toHaveText(frozen!);
  await page.goForward();
  await expect(page.getByRole('textbox', { name: 'beta draft', exact: true })).toBeVisible();
});

test('confirms explicit close before disposing the workspace and resets on reopen', async ({ page }) => {
  await page.goto('/apps/keep-alive-alpha?keepAliveFixture=1');
  const alpha = page.getByRole('textbox', { name: 'alpha draft', exact: true });
  await alpha.fill('draft that must not disappear without confirmation');
  const close = page.getByRole('button', { name: '關閉目前 App', exact: true });
  const dialog = page.getByRole('dialog', { name: '關閉 App 工作區', exact: true });
  await close.click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(alpha).toHaveValue('draft that must not disappear without confirmation');
  await close.click();
  await dialog.getByRole('button', { name: '關閉 App', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-app-key="keep-alive-alpha"]')).toHaveCount(0);
  await page.locator('.launcher-app').filter({ hasText: 'Keep-alive alpha' }).click();
  await expect(alpha).toHaveValue('');
});
