import type { ReactNode } from 'react';

type ChartTooltipProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  children: ReactNode;
};

export default function ChartTooltip({ x, y, width, height, children }: ChartTooltipProps) {
  return (
    <foreignObject x={x} y={y} width={width} height={height}>
      {children}
    </foreignObject>
  );
}
