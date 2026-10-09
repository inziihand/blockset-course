import type { PositionRow } from '../types';

export function expiryPayoff(rows: PositionRow[], s: number, underlyingQty = 0): number {
  return rows.reduce((sum, row) => {
    const call = Math.max(s - row.strike, 0) * row.callQty;
    const put = Math.max(row.strike - s, 0) * row.putQty;
    return sum + call + put;
  }, underlyingQty * s);
}
