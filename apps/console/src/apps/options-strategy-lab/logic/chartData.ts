import type { ChartMode, ModelParams, PositionRow } from '../types';
import { aggregate } from './greeks';
import { expiryPayoff } from './payoff';

export function isGreekMode(mode: ChartMode): boolean {
  return ['delta', 'gamma', 'theta', 'vega', 'rho'].includes(mode);
}

export function chartValue(mode: ChartMode, rows: PositionRow[], params: ModelParams, spot: number, entryCost = 0, underlyingQty = 0): number {
  const expiredValue = expiryPayoff(rows, spot, underlyingQty) - entryCost;
  if (mode === 'payoff') return expiredValue;

  if (mode === 'pnl') {
    if (params.days <= 0) return expiredValue;
    return aggregate(rows, params, underlyingQty, spot).price - entryCost;
  }

  if (params.days <= 0 && isGreekMode(mode)) return mode === 'delta' ? underlyingQty : 0;
  const g = aggregate(rows, params, underlyingQty, spot);
  return g[mode];
}

export function findBreakEvenPoints(rows: PositionRow[], params: ModelParams, entryCost: number, xMin: number, xMax: number, underlyingQty = 0) {
  const sampleCount = 300;
  const dx = (xMax - xMin) / sampleCount;
  const payoffPoints = Array.from({ length: sampleCount + 1 }, (_, i) => {
    const x = xMin + dx * i;
    return { x, y: chartValue('pnl', rows, params, x, entryCost, underlyingQty) };
  });
  const points: number[] = [];
  const EPSILON = 1e-7;
  const minDistance = Math.max(dx * 2, 0.01);

  const addPoint = (x: number) => {
    const clamped = Math.min(Math.max(x, xMin), xMax);
    const last = points[points.length - 1];
    if (last === undefined || Math.abs(last - clamped) > minDistance) points.push(Number(clamped.toFixed(4)));
  };

  for (let i = 0; i < payoffPoints.length - 1; i += 1) {
    const a = payoffPoints[i];
    const b = payoffPoints[i + 1];
    const aIsZero = Math.abs(a.y) < EPSILON;
    const bIsZero = Math.abs(b.y) < EPSILON;

    if (aIsZero && bIsZero) {
      const startX = a.x;
      let j = i + 1;
      while (j < payoffPoints.length - 1 && Math.abs(payoffPoints[j + 1].y) < EPSILON) j += 1;
      const endX = payoffPoints[j].x;
      addPoint(startX);
      if (Math.abs(endX - startX) > minDistance) addPoint(endX);
      i = j;
      continue;
    }

    if (aIsZero) {
      addPoint(a.x);
      continue;
    }

    if ((a.y < 0 && b.y > 0) || (a.y > 0 && b.y < 0)) {
      const ratio = (0 - a.y) / (b.y - a.y);
      addPoint(a.x + ratio * (b.x - a.x));
    } else if (bIsZero) {
      addPoint(b.x);
    }
  }

  return points;
}

export function formatAxisTick(value: number, mode: ChartMode): string {
  if (mode === 'pnl' || mode === 'payoff') {
    const rounded = Math.round(value);
    const body = Math.abs(rounded).toLocaleString('en-US');
    if (rounded > 0) return `+${body}`;
    if (rounded < 0) return `-${body}`;
    return '0';
  }
  const digits = mode === 'gamma' ? 3 : mode === 'theta' ? 2 : 2;
  const rounded = Number(value.toFixed(digits));
  return `${rounded}`;
}
