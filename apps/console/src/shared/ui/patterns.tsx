import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import './patterns.css';

export type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % buttons.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = buttons.length - 1;
  if (next < 0) return;
  event.preventDefault();
  buttons[next]?.focus();
  buttons[next]?.click();
}

export function FolderTabs<T extends string>({
  id,
  ariaLabel,
  items,
  value,
  columns = items.length,
  panelId,
  className = '',
  onChange,
}: {
  id: string;
  ariaLabel: string;
  items: readonly ChoiceOption<T>[];
  value: T;
  columns?: number;
  panelId?: string;
  className?: string;
  onChange: (value: T) => void;
}) {
  const style = { '--platform-folder-tab-columns': columns } as CSSProperties;
  return <div className={`platform-folder-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}
    style={style} onKeyDown={navigateTabs}>
    {items.map((item) => <button type="button" role="tab" key={item.value} id={`${id}-${item.value}`}
      disabled={item.disabled} aria-selected={value === item.value} aria-controls={panelId}
      tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>;
}

export function SegmentedControl<T extends string>({
  id,
  ariaLabel,
  items,
  value,
  columns = items.length,
  panelId,
  className = '',
  onChange,
}: {
  id: string;
  ariaLabel: string;
  items: readonly ChoiceOption<T>[];
  value: T;
  columns?: number;
  panelId?: string;
  className?: string;
  onChange: (value: T) => void;
}) {
  const style = { '--platform-segment-columns': columns } as CSSProperties;
  return <div className={`platform-segmented ${className}`.trim()} role="tablist" aria-label={ariaLabel}
    style={style} onKeyDown={navigateTabs}>
    {items.map((item) => <button type="button" role="tab" key={item.value} id={`${id}-${item.value}`}
      disabled={item.disabled} aria-selected={value === item.value} aria-controls={panelId}
      tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div>;
}

export function ChoiceGroup<T extends string>({
  ariaLabel,
  items,
  value,
  columns = items.length,
  className = '',
  onChange,
}: {
  ariaLabel: string;
  items: readonly ChoiceOption<T>[];
  value: T;
  columns?: number;
  className?: string;
  onChange: (value: T) => void;
}) {
  const style = { '--platform-choice-columns': columns } as CSSProperties;
  return <div className={`platform-choice-group ${className}`.trim()} role="group" aria-label={ariaLabel} style={style}>
    {items.map((item) => <button type="button" key={item.value} disabled={item.disabled}
      aria-pressed={value === item.value} onClick={() => onChange(item.value)}>
      {item.icon && <span aria-hidden="true">{item.icon}</span>}{item.label}
    </button>)}
  </div>;
}

export function StatusBanner({
  title,
  children,
  icon,
  action,
  tone = 'info',
  className = '',
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'error' | 'neutral';
  className?: string;
}) {
  return <section className={`platform-status-banner tone-${tone} ${className}`.trim()}
    role={tone === 'error' ? 'alert' : 'status'}>
    {icon && <span className="platform-status-banner-icon" aria-hidden="true">{icon}</span>}
    <p><strong>{title}</strong>{children && <span>{children}</span>}</p>
    {action && <div className="platform-status-banner-action">{action}</div>}
  </section>;
}

export type MenuOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export function MenuPopover<T extends string>({
  label,
  menuLabel = label,
  value,
  options,
  triggerIcon,
  align = 'start',
  disabled = false,
  hideLabel = false,
  placeholder = '請選擇',
  className = '',
  onChange,
}: {
  label: string;
  menuLabel?: string;
  value: T;
  options: readonly MenuOption<T>[];
  triggerIcon?: ReactNode;
  align?: 'start' | 'end';
  disabled?: boolean;
  hideLabel?: boolean;
  placeholder?: string;
  className?: string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = options.find((option) => option.value === value);
  const unavailable = disabled || !options.some((option) => !option.disabled);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const selectedItem = panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const firstItem = panel.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    (selectedItem ?? firstItem)?.focus({ preventScroll: true });
    const dismiss = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !root.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (event.key === 'Tab') { close(); return; }
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')];
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') next = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
  };

  return <div className={`platform-menu align-${align} ${className}`.trim()} ref={root}>
    <span className={`platform-menu-label${hideLabel ? ' is-visually-hidden' : ''}`}>{label}</span>
    <button ref={trigger} type="button" className="platform-menu-trigger" aria-haspopup="menu"
      aria-label={hideLabel ? `${label}：${current?.label ?? placeholder}` : undefined} aria-expanded={open && !unavailable}
      aria-controls={open && !unavailable ? menuId : undefined} disabled={unavailable}
      onClick={() => setOpen((currentOpen) => !currentOpen)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}>
      <span>{triggerIcon}{current?.label ?? placeholder}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && !unavailable && <div ref={panel} id={menuId} className="platform-menu-panel" role="menu"
      aria-label={menuLabel} onKeyDown={navigateMenu}>
      {options.map((option) => <button type="button" role="menuitemradio" tabIndex={-1}
        disabled={option.disabled} aria-checked={option.value === value} key={option.value}
        onClick={() => { onChange(option.value); close(true); }}>
        <span className="platform-menu-option-icon" aria-hidden="true">{option.icon}</span>
        <strong>{option.label}</strong>
        <span className="platform-menu-check" aria-hidden="true">{option.value === value ? <Check size={14} /> : null}</span>
      </button>)}
    </div>}
  </div>;
}

function formatDate(value: string) {
  return value.replaceAll('-', '/');
}

export function DatePicker({
  label,
  value,
  min,
  max,
  align = 'start',
  footerStart,
  footerEnd,
  className = '',
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  align?: 'start' | 'end';
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  className?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(value.slice(0, 7));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;
    setCursor(value.slice(0, 7));
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !root.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        requestAnimationFrame(() => trigger.current?.focus());
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, value]);

  const [year, month] = cursor.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return date;
  });
  const moveMonth = (offset: number) => {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    setCursor(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const selectDate = (next: string) => {
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };

  return <div className={`platform-date-picker align-${align} ${className}`.trim()} ref={root}>
    <span className="platform-date-label">{label}</span>
    <button ref={trigger} type="button" className="platform-date-trigger" aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? dialogId : undefined}
      aria-label={`${label}：${formatDate(value)}，開啟月曆`} onClick={() => setOpen((currentOpen) => !currentOpen)}>
      <span>{formatDate(value)}</span><CalendarDays size={15} aria-hidden="true" />
    </button>
    {open && <div id={dialogId} className="platform-calendar-popover" role="dialog" aria-label={`${label}月曆`}>
      <div className="platform-calendar-header">
        <button type="button" aria-label="上一個月" onClick={() => moveMonth(-1)}><ChevronLeft size={15} /></button>
        <strong>{year}年{month}月</strong>
        <button type="button" aria-label="下一個月" onClick={() => moveMonth(1)}><ChevronRight size={15} /></button>
      </div>
      <div className="platform-calendar-weekdays" aria-hidden="true">
        {['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="platform-calendar-grid">
        {calendarDays.map((date) => {
          const dateValue = date.toISOString().slice(0, 10);
          const disabled = Boolean((min && dateValue < min) || (max && dateValue > max));
          const outside = date.getUTCMonth() !== month - 1;
          return <button type="button" key={dateValue} disabled={disabled}
            className={`${outside ? 'outside ' : ''}${dateValue === value ? 'selected' : ''}`.trim()}
            aria-label={formatDate(dateValue)} onClick={() => selectDate(dateValue)}>{date.getUTCDate()}</button>;
        })}
      </div>
      {(footerStart || footerEnd) && <div className="platform-calendar-footer">
        <span>{footerStart}</span><strong>{footerEnd}</strong>
      </div>}
    </div>}
  </div>;
}
