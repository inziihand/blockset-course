import type { PositionRow } from '../types';

const DEFAULT_INITIAL_SPOT = 100;
const DEFAULT_STRIKE_STEP = 5;
const STRIKE_ROWS_ABOVE_MARKER = 6;
const STRIKE_ROWS_BELOW_MARKER = 6;

function ceilToStep(value: number, step: number): number {
  const safeStep = Math.max(step, 0.01);
  return Number((Math.ceil(value / safeStep) * safeStep).toFixed(4));
}

export function generateRows(initialSpot = DEFAULT_INITIAL_SPOT, strikeStep = DEFAULT_STRIKE_STEP): PositionRow[] {
  const step = Math.max(strikeStep, 0.01);
  const firstStrikeBelowMarker = ceilToStep(initialSpot, step);
  const rowCount = STRIKE_ROWS_ABOVE_MARKER + STRIKE_ROWS_BELOW_MARKER;

  return Array.from({ length: rowCount }, (_, index) => {
    const offset = index - STRIKE_ROWS_ABOVE_MARKER;
    const strike = Number((firstStrikeBelowMarker + offset * step).toFixed(4));
    const callQty = offset === 0 ? 1 : offset === 3 ? -1 : 0;
    const putQty = offset === 0 ? 1 : offset === -3 ? -1 : 0;
    return { strike, callQty, putQty };
  });
}

export function generateEmptyRows(initialSpot = DEFAULT_INITIAL_SPOT, strikeStep = DEFAULT_STRIKE_STEP): PositionRow[] {
  return generateRows(initialSpot, strikeStep).map((row) => ({
    ...row,
    callQty: 0,
    putQty: 0,
  }));
}
