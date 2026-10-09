import { useCallback, useRef, useState } from 'react';
import { useAppEffect as useEffect, useAppActive } from '../../../shared/lifecycle/AppActivity';
import { createPortal } from 'react-dom';
import { portalHost } from '../portalHost';
import { HelpCircle } from 'lucide-react';
import { cx } from '../shared/utils/format';

function InfoPopover({ text }: { text: string }) {
  const active = useAppActive();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, arrowLeft: 16, placement: 'bottom' as 'top' | 'bottom' });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(280, viewportWidth - 24);
    const estimatedPanelHeight = 58;
    const gap = 10;
    const margin = 12;
    const centerX = rect.left + rect.width / 2;

    const left = Math.min(
      Math.max(centerX - panelWidth / 2, margin),
      Math.max(margin, viewportWidth - panelWidth - margin),
    );

    const hasBottomSpace = rect.bottom + gap + estimatedPanelHeight < viewportHeight - margin;
    const placement: 'top' | 'bottom' = hasBottomSpace ? 'bottom' : 'top';
    const top = placement === 'bottom'
      ? rect.bottom + gap
      : Math.max(margin, rect.top - gap - estimatedPanelHeight);

    setPosition({
      top,
      left,
      arrowLeft: Math.min(Math.max(centerX - left, 16), panelWidth - 16),
      placement,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || panelRef.current?.contains(target))) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    const handleLayoutChange = () => updatePosition();

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleLayoutChange);
    window.addEventListener('scroll', handleLayoutChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleLayoutChange);
      window.removeEventListener('scroll', handleLayoutChange, true);
    };
  }, [open, updatePosition]);

  const panel = active && open
    ? createPortal(
        <span
          className={cx('info-popover-panel', position.placement === 'top' && 'above')}
          ref={panelRef}
          role="status"
          style={{
            top: position.top,
            left: position.left,
            '--arrow-left': `${position.arrowLeft}px`,
          } as React.CSSProperties}
        >
          {text}
        </span>,
        portalHost(),
      )
    : null;

  return (
    <span className="info-popover">
      <button
        ref={triggerRef}
        className={cx('info-popover-trigger', open && 'active')}
        type="button"
        aria-label="顯示說明"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <HelpCircle size={15} />
      </button>
      {panel}
    </span>
  );
}

export default InfoPopover;
