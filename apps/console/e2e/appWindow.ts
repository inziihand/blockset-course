import { expect, type Page } from '@playwright/test';

export async function appWindowGeometry(page: Page) {
  return page.locator('main.app-shell').evaluate((shell) => {
    const root = shell.parentElement!;
    const rootStyle = getComputedStyle(root);
    const rootRect = root.getBoundingClientRect();
    const shellStyle = getComputedStyle(shell);
    const shellRect = shell.getBoundingClientRect();
    const content = shell.querySelector('.app-content')!;
    const contentStyle = getComputedStyle(content);
    const frame = shell.querySelector('.platform-app-frame:not([hidden])')!;
    const frameStyle = getComputedStyle(frame);
    const frameRect = frame.getBoundingClientRect();
    const available = root.clientWidth - parseFloat(rootStyle.paddingLeft) - parseFloat(rootStyle.paddingRight);
    const rootContentLeft = rootRect.left + parseFloat(rootStyle.borderLeftWidth) + parseFloat(rootStyle.paddingLeft);
    const contentWidth = content.clientWidth - parseFloat(contentStyle.paddingLeft) - parseFloat(contentStyle.paddingRight);
    const shellContentWidth = shell.clientWidth - parseFloat(shellStyle.paddingLeft) - parseFloat(shellStyle.paddingRight);
    const contained = ['.topbar', '.app-content'].every((selector) => {
      const rect = shell.querySelector(selector)!.getBoundingClientRect();
      return rect.left >= shellRect.left - 1 && rect.right <= shellRect.right + 1;
    });
    const rail = document.querySelector('.app-rail')!;
    return {
      available,
      shellWidth: shellRect.width,
      shellOffset: shellRect.left - rootContentLeft,
      shellContentWidth,
      topbarWidth: shell.querySelector('.topbar')!.getBoundingClientRect().width,
      frameWidth: frameRect.width,
      contentWidth,
      chromeContained: contained,
      railIsOutsideWindow: !shell.contains(rail),
      containerType: frameStyle.containerType,
      containerName: frameStyle.containerName,
      contentOverflows: frame.scrollWidth > frame.clientWidth + 1,
      windowOverflows: shell.scrollWidth > shell.clientWidth + 1,
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

export function expectAppWindow(geometry: Awaited<ReturnType<typeof appWindowGeometry>>, mode: 'compact' | 'responsive', viewportWidth: number) {
  const expectedWidth = Math.min(mode === 'compact' ? 420 : 1480, geometry.available);
  const context = `${mode} at ${viewportWidth}px`;
  expect(Math.abs(geometry.shellWidth - expectedWidth), `${context} whole-window width`).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.shellOffset - (geometry.available - expectedWidth) / 2), `${context} centered window`).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.topbarWidth - geometry.shellContentWidth), `${context} topbar width`).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.frameWidth - geometry.contentWidth), `${context} full inner frame`).toBeLessThanOrEqual(1);
  expect(geometry.chromeContained, `${context} complete window chrome`).toBe(true);
  expect(geometry.railIsOutsideWindow, `${context} external platform rail`).toBe(true);
  expect(geometry.containerType).toBe('inline-size');
  expect(geometry.containerName.split(' ')).toContain('app-content');
  expect(geometry.contentOverflows, `${context} content overflow`).toBe(false);
  expect(geometry.windowOverflows, `${context} window overflow`).toBe(false);
  expect(geometry.pageOverflows, `${context} page overflow`).toBe(false);
}
