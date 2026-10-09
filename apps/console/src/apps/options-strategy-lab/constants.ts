import type { ModelParams, StrikeSettings } from './types';
import { generateRows } from './logic/strikeRows';

export const DEFAULT_INITIAL_SPOT = 100;
export const DEFAULT_STRIKE_STEP = 5;
export const STRIKE_ROWS_ABOVE_MARKER = 6;
export const STRIKE_ROWS_BELOW_MARKER = 6;

export const initialStrikeSettings: StrikeSettings = {
  initialSpot: DEFAULT_INITIAL_SPOT,
  strikeStep: DEFAULT_STRIKE_STEP,
};

export const initialRows = generateRows();

export const initialParams: ModelParams = {
  spot: 100,
  iv: 0.2,
  days: 30,
  carryRate: 0,
};

export const CARRY_RATE_RANGE = {
  min: 0,
  max: 0.1,
  step: 0.001,
  suffix: '%',
} as const;
