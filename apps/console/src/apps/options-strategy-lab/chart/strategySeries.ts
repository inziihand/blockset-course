import type { ChartSeries, ChartSeriesDefinition } from '../shared/charts';
import { withDisplayScale } from '../shared/charts';
import { DEFAULT_INITIAL_SPOT, DEFAULT_STRIKE_STEP } from '../constants';
import { chartValue } from '../logic/chartData';
import { STRATEGY_PRICE_RANGE } from '../persistence/strategySchema.js';
import type { ChartMode, ModelParams, PositionRow } from '../types';

export type StrategySeriesDefinition = ChartSeriesDefinition<ChartMode> & {
  title: string;
  yLabel: string;
};

export const strategyChartModes: StrategySeriesDefinition[] = [
  { key: 'pnl', label: '損益', title: '策略損益曲線', yLabel: '損益', color: 'var(--chart-series-pnl)' },
  { key: 'payoff', label: '到期價值', title: '策略到期價值曲線', yLabel: '到期價值', color: 'var(--chart-series-payoff)' },
  { key: 'delta', label: 'Delta', title: 'Delta 曲線', yLabel: 'Delta', color: 'var(--chart-series-delta)' },
  { key: 'gamma', label: 'Gamma', title: 'Gamma 曲線', yLabel: 'Gamma', color: 'var(--chart-series-gamma)' },
  { key: 'theta', label: 'Theta', title: 'Theta 曲線', yLabel: 'Theta / 日', color: 'var(--chart-series-theta)' },
  { key: 'vega', label: 'Vega', title: 'Vega 曲線', yLabel: 'Vega', color: 'var(--chart-series-vega)' },
  { key: 'rho', label: 'Rho', title: 'Rho 曲線', yLabel: 'Rho', color: 'var(--chart-series-rho)' },
];

export function getStrategyXDomain(rows: PositionRow[]) {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  const diffs = sorted.slice(1).map((row, index) => row.strike - sorted[index].strike).filter((diff) => diff > 0);
  const strikeStep = diffs.length ? Math.min(...diffs) : DEFAULT_STRIKE_STEP;
  return {
    min: Math.max(STRATEGY_PRICE_RANGE.min, (sorted[0]?.strike ?? DEFAULT_INITIAL_SPOT) - strikeStep * 3),
    max: Math.min(STRATEGY_PRICE_RANGE.max, (sorted.at(-1)?.strike ?? DEFAULT_INITIAL_SPOT) + strikeStep * 3),
  };
}

export function buildStrategySeries({
  modes,
  rows,
  params,
  xMin,
  xMax,
  entryCost,
  underlyingQty,
  normalized,
  normalizationReference,
}: {
  modes: ChartMode[];
  rows: PositionRow[];
  params: ModelParams;
  xMin: number;
  xMax: number;
  entryCost: number;
  underlyingQty: number;
  normalized: boolean;
  normalizationReference?: Array<ChartSeries<ChartMode, StrategySeriesDefinition>>;
}) {
  const selectedDefinitions = strategyChartModes.filter((candidate) => modes.includes(candidate.key));
  const sampleCount = 120;
  const xs = Array.from({ length: sampleCount + 1 }, (_, index) => xMin + ((xMax - xMin) / sampleCount) * index);
  const rawSeries = selectedDefinitions.map((definition) => ({
    definition,
    raw: xs.map((x) => ({ x, y: chartValue(definition.key, rows, params, x, entryCost, underlyingQty) })),
  }));
  return withDisplayScale(rawSeries, normalized, normalizationReference);
}
