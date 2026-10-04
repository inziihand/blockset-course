import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAppActive } from '../lifecycle/AppActivity';

export const APP_INFO_BAR_HOST_ID = 'platform-app-info-bar';

export type AppInfoBarVariant = 'default' | 'brand';

export function AppInfoBar({
  children,
  className = '',
  variant = 'default',
}: {
  children: ReactNode;
  className?: string;
  variant?: AppInfoBarVariant;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const active = useAppActive();

  useLayoutEffect(() => {
    if (!active) return;
    const nextHost = document.getElementById(APP_INFO_BAR_HOST_ID);
    if (!nextHost) return;

    nextHost.dataset.variant = variant;
    setHost(nextHost);
    return () => {
      delete nextHost.dataset.variant;
    };
  }, [active, variant]);

  if (!active || !host) return null;

  return createPortal(
    <div className={`platform-app-info-content ${className}`.trim()}>{children}</div>,
    host,
  );
}
