import type { ChartPoint, ChartSeries, ChartSeriesDefinition, ScaledChartSeries } from './types';

export function normalizePoints(points: ChartPoint[]): ChartPoint[] {
  const scale = Math.max(...points.map((point) => Math.abs(point.y)), 0) || 1;
  return points.map((point) => ({ ...point, y: point.y / scale }));
}

export function withDisplayScale<Key extends string, Definition extends ChartSeriesDefinition<Key>>(
  series: Array<Omit<ChartSeries<Key, Definition>, 'display'>>,
  normalized: boolean,
): Array<ChartSeries<Key, Definition>> {
  return series.map((item) => ({
    ...item,
    display: normalized ? normalizePoints(item.raw) : item.raw,
  }));
}

export function getSeriesExtent<Key extends string, Definition extends ChartSeriesDefinition<Key>>(
  series: Array<ChartSeries<Key, Definition>>,
  fallback: { min: number; max: number } = { min: -1, max: 1 },
) {
  const values = series.flatMap((item) => item.display.map((point) => point.y));
  return {
    min: Math.min(...values, fallback.min),
    max: Math.max(...values, fallback.max),
  };
}

export function createLinearScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  const span = domainMax - domainMin || 1;
  return (value: number) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

export function pointsToPath(points: ChartPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function scaleSeries<Key extends string, Definition extends ChartSeriesDefinition<Key>>(
  series: Array<ChartSeries<Key, Definition>>,
  xScale: (value: number) => number,
  yScale: (value: number) => number,
): Array<ScaledChartSeries<Key, Definition>> {
  return series.map((item) => {
    const points = item.display.map((point) => ({ x: xScale(point.x), y: yScale(point.y) }));
    return { ...item, points, path: pointsToPath(points) };
  });
}
