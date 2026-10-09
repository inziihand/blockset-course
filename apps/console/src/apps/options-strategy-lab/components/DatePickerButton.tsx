import { useCallback, useRef, useState } from 'react';
import { useAppEffect as useEffect, useAppActive } from '../../../shared/lifecycle/AppActivity';
import { createPortal } from 'react-dom';
import { portalHost } from '../portalHost';
import { CalendarDays } from 'lucide-react';
import { dateFromDays, daysUntilDate, formatDateInput, sameLocalDate, startOfLocalDay } from '../logic/dateUtils';
import { cx } from '../shared/utils/format';

function DatePickerButton({
  days,
  minDays,
  onChangeDays,
  ariaLabel,
  size = 15,
}: {
  days: number;
  minDays: number;
  onChangeDays: (days: number) => void;
  ariaLabel: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const active = useAppActive();
  const [monthDate, setMonthDate] = useState(() => dateFromDays(days));
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const today = startOfLocalDay(new Date());
  const selectedDate = dateFromDays(days);
  const minDate = dateFromDays(minDays);

  const updatePanelPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const panelWidth = 268;
    const panelHeight = 304;
    const gap = 8;
    const left = Math.min(Math.max(10, rect.right - panelWidth), window.innerWidth - panelWidth - 10);
    const belowTop = rect.bottom + gap;
    const aboveTop = rect.top - panelHeight - gap;
    const top = belowTop + panelHeight <= window.innerHeight - 10 ? belowTop : Math.max(10, aboveTop);
    setPanelPosition({ top, left });
  }, []);

  useEffect(() => {
    setMonthDate(dateFromDays(days));
  }, [days]);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (buttonRef.current?.contains(target) || panelRef.current?.contains(target))) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, updatePanelPosition]);

  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstDayOffset = firstOfMonth.getDay();
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstDayOffset);
  const daysInGrid = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  const selectDate = (date: Date) => {
    if (startOfLocalDay(date).getTime() < minDate.getTime()) return;
    onChangeDays(Math.max(minDays, daysUntilDate(formatDateInput(date))));
    setOpen(false);
  };

  const panel = active && open ? createPortal(
    <div
      ref={panelRef}
      className="custom-date-popover"
      style={{ top: panelPosition.top, left: panelPosition.left }}
      role="dialog"
      aria-label={ariaLabel}
    >
      <div className="custom-date-header">
        <button type="button" onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}>‹</button>
        <b>{monthDate.getFullYear()}年{monthDate.getMonth() + 1}月</b>
        <button type="button" onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="custom-date-weekdays">
        {['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="custom-date-grid">
        {daysInGrid.map((date) => {
          const disabled = startOfLocalDay(date).getTime() < minDate.getTime();
          const outside = date.getMonth() !== monthDate.getMonth();
          const selected = sameLocalDate(date, selectedDate);
          const isToday = sameLocalDate(date, today);
          return (
            <button
              type="button"
              key={formatDateInput(date)}
              className={cx(outside && 'outside', selected && 'selected', isToday && 'today')}
              disabled={disabled}
              onClick={() => selectDate(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="custom-date-footer">
        <button type="button" onClick={() => selectDate(dateFromDays(minDays))}>{minDays === 0 ? '今天' : `+${minDays}天`}</button>
        <span>剩餘 {Math.max(minDays, days)} 天</span>
      </div>
    </div>,
    portalHost(),
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="info-popover-trigger"
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
          updatePanelPosition();
          setOpen((value) => !value);
        }}
      >
        <CalendarDays size={size} strokeWidth={2} />
      </button>
      {panel}
    </>
  );
}

export default DatePickerButton;
