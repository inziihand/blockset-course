import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const APP_HEADER_ACTIONS_HOST_ID = 'platform-app-header-actions';

export function AppHeaderActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setHost(document.getElementById(APP_HEADER_ACTIONS_HOST_ID));
  }, []);

  if (!host) return null;

  return createPortal(
    <div className={`platform-app-header-actions-content ${className}`.trim()}>{children}</div>,
    host,
  );
}
