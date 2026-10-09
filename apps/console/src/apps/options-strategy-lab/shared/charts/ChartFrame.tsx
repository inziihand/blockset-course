import { forwardRef, type ReactNode } from 'react';

type ChartFrameProps = {
  width: number;
  height: number;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
};

const ChartFrame = forwardRef<SVGSVGElement, ChartFrameProps>(function ChartFrame(
  { width, height, ariaLabel, className = 'chart-svg', children },
  ref,
) {
  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={ariaLabel}>
      {children}
    </svg>
  );
});

export default ChartFrame;
