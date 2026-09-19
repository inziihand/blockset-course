import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

export const media = Object.assign(new EventTarget(), {
  matches: false,
  media: '(prefers-color-scheme: dark)',
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  media.matches = false;
  vi.stubGlobal('matchMedia', () => media);
  // JSDOM does not implement native modal/popover interaction. Real-browser checks
  // cover focus trapping, Escape, backdrop dismissal and the responsive layout.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  HTMLElement.prototype.hidePopover = function () {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});
