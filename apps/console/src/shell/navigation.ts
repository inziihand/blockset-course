import { useSyncExternalStore } from 'react';

const navigationEvent = 'stratexec:navigation';
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener(navigationEvent, notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener(navigationEvent, notify);
  };
};

export function navigate(path: string) {
  // Platform links only: never turn this helper into an external redirect.
  if (!/^\/(?:[a-z0-9-]+\/?)*$/.test(path)) throw new Error('Invalid platform path');
  if (window.location.pathname === path && !window.location.search && !window.location.hash) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(navigationEvent));
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname.replace(/\/+$/, '') || '/', () => '/');
}
