export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatDateInput(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateFromDays(days: number) {
  const base = startOfLocalDay(new Date());
  base.setDate(base.getDate() + Math.max(0, Math.round(days)));
  return base;
}

export function daysUntilDate(value: string) {
  const selected = startOfLocalDay(new Date(`${value}T00:00:00`));
  const today = startOfLocalDay(new Date());
  const diff = selected.getTime() - today.getTime();
  return Math.max(0, Math.round(diff / 86400000));
}

export function sameLocalDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
