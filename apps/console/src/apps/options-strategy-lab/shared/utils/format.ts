export function formatPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export function fmt(n: number, digits = 2): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

export function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}
