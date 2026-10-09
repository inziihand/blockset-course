import { useId, useRef, useState } from 'react';
import { useAppEffect as useEffect } from '../../../../shared/lifecycle/AppActivity';
import { ChevronDown, LockKeyhole } from 'lucide-react';
import { cx } from '../utils/format';

export type CurveSelectorOption<Key extends string> = {
  key: Key;
  label: string;
  disabled?: boolean;
  locked?: boolean;
  ariaLabel?: string;
  title?: string;
};

type CurveSelectorProps<Key extends string> = {
  options: readonly CurveSelectorOption<Key>[];
  selectedKeys: readonly Key[];
  onToggle: (key: Key) => void;
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function CurveSelector<Key extends string>({
  options,
  selectedKeys,
  onToggle,
  label = '顯示曲線',
  open,
  onOpenChange,
}: CurveSelectorProps<Key>) {
  const [internalOpen, setInternalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const isOpen = open ?? internalOpen;

  const setOpen = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !menuRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange, open]);

  return (
    <div className="chart-curve-menu" ref={menuRef}>
      <button
        type="button"
        className={cx('chart-curve-menu-trigger', isOpen && 'active')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setOpen(!isOpen)}
      >
        <span>{label}</span>
        <b>{selectedKeys.length} / {options.length}</b>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div id={menuId} className="chart-curve-menu-panel" role="menu" aria-label={label}>
          <div className="segmented chart-mode-tabs">
            {options.map((option) => {
              const selected = selectedKeys.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  role="menuitemcheckbox"
                  className={cx(selected && 'active', option.disabled && 'disabled', option.locked && 'course-feature-locked')}
                  onClick={() => {
                    if (!option.disabled) onToggle(option.key);
                  }}
                  disabled={option.disabled}
                  aria-checked={selected}
                  aria-label={option.ariaLabel ?? option.label}
                  title={option.title}
                >
                  {option.locked ? <LockKeyhole size={12} strokeWidth={2} aria-hidden="true" /> : null}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
