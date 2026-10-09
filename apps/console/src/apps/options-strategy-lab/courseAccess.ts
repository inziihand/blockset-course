import type { ChartMode } from './types';

const courseChartModes = new Set<ChartMode>([
  'delta',
  'gamma',
  'theta',
  'vega',
  'rho',
]);

export const isCourseChartMode = (mode: ChartMode) =>
  courseChartModes.has(mode);
