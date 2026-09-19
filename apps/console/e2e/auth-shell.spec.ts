import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:5177';

async function openDrawer(page: Page) {
  const mobile = page.getByRole('button', { name: '開啟平台選單', exact: true });
  const trigger = await mobile.isVisible()
    ? mobile
    : page.getByRole('button', { name: '展開 StratExec 選單', exact: true });
  await trigger.click();
  return page.getByRole('dialog', { name: 'StratExec 選單', exact: true });
}

test('an unconfigured Firebase Auth installation remains offline and clearly disabled', async ({ page }) => {
  const firebaseRequests: string[] = [];
  page.on('request', (request) => {
    if (/googleapis|firebase|gstatic/.test(request.url())) firebaseRequests.push(request.url());
  });
  await page.goto(origin);
  const drawer = await openDrawer(page);
  await expect(drawer.getByText('Firebase Auth 尚未設定', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: '以 Google 帳號登入', exact: true })).toBeDisabled();
  expect(firebaseRequests).toEqual([]);
});
