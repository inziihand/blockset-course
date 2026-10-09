import type { ChartPadding } from './types';

type ChartAxisLabelsProps = {
  xTicks: number[];
  yTicks: number[];
  xScale: (value: number) => number;
  yScale: (value: number) => number;
  padding: ChartPadding;
  chartWidth: number;
  chartHeight: number;
  xLabel: string;
  yLabel: string;
  formatXTick: (value: number) => string;
  formatYTick: (value: number) => string;
};

export default function ChartAxisLabels({
  xTicks,
  yTicks,
  xScale,
  yScale,
  padding,
  chartWidth,
  chartHeight,
  xLabel,
  yLabel,
  formatXTick,
  formatYTick,
}: ChartAxisLabelsProps) {
  return (
    <>
      {xTicks.map((tick) => (
        <text key={`x-label-${tick}`} x={xScale(tick)} y={padding.t + chartHeight + 22} textAnchor="middle" className="axis-tick-label">
          {formatXTick(tick)}
        </text>
      ))}
      {yTicks.map((tick) => (
        <text key={`y-label-${tick}`} x={padding.l - 12} y={yScale(tick) + 4} textAnchor="end" className="axis-tick-label">
          {formatYTick(tick)}
        </text>
      ))}
      <text x={padding.l + chartWidth / 2} y={padding.t + chartHeight + 42} className="axis-label">{xLabel}</text>
      <text x={22} y={padding.t + chartHeight / 2} className="axis-label vertical">{yLabel}</text>
    </>
  );
}
