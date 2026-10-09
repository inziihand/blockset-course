import type { ReactNode } from 'react';

export type ChartLegendItem = {
  key: string;
  label: string;
  color?: string;
  lineClassName?: string;
};

type ChartLegendProps = {
  items: ChartLegendItem[];
  children?: ReactNode;
};

export default function ChartLegend({ items, children }: ChartLegendProps) {
  return (
    <div className="chart-legend" aria-label="圖例">
      {items.map((item) => (
        <span className="legend-item" key={item.key}>
          <i className={`legend-line${item.lineClassName ? ` ${item.lineClassName}` : ''}`} style={item.color ? { color: item.color } : undefined} />
          {item.label}
        </span>
      ))}
      {children}
    </div>
  );
}
