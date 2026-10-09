import type { ChartPadding } from './types';

type CartesianGridProps = {
  xTicks: number[];
  yTicks: number[];
  xScale: (value: number) => number;
  yScale: (value: number) => number;
  padding: ChartPadding;
  chartWidth: number;
  chartHeight: number;
};

export default function CartesianGrid({ xTicks, yTicks, xScale, yScale, padding, chartWidth, chartHeight }: CartesianGridProps) {
  return (
    <>
      {xTicks.map((tick) => {
        const x = xScale(tick);
        return <line key={`x-${tick}`} x1={x} x2={x} y1={padding.t} y2={padding.t + chartHeight} className="grid-line" />;
      })}
      {yTicks.map((tick) => {
        const y = yScale(tick);
        return <line key={`y-${tick}`} x1={padding.l} x2={padding.l + chartWidth} y1={y} y2={y} className="grid-line" />;
      })}
      <line x1={padding.l} x2={padding.l} y1={padding.t} y2={padding.t + chartHeight} className="axis-edge" />
    </>
  );
}
