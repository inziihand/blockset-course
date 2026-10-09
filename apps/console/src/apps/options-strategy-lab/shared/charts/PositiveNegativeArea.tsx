import type { ChartPoint } from './types';

type PositiveNegativeAreaProps = {
  points: ChartPoint[];
  zeroY: number;
  positiveFillId: string;
  negativeFillId: string;
};

export default function PositiveNegativeArea({ points, zeroY, positiveFillId, negativeFillId }: PositiveNegativeAreaProps) {
  if (points.length < 2) return null;

  const makeAreaPath = (ys: number[]) => {
    const startX = points[0].x;
    const endX = points[points.length - 1].x;
    return [
      `M ${startX} ${zeroY}`,
      ...points.map((point, index) => `${index === 0 ? 'L' : 'L'} ${point.x} ${ys[index]}`),
      `L ${endX} ${zeroY}`,
      'Z',
    ].join(' ');
  };

  const positiveYs = points.map((point) => Math.min(point.y, zeroY));
  const negativeYs = points.map((point) => Math.max(point.y, zeroY));

  return (
    <g className="positive-negative-area" aria-label="正負值面積填色">
      <path className="positive-area-fill" d={makeAreaPath(positiveYs)} fill={`url(#${positiveFillId})`} />
      <path className="negative-area-fill" d={makeAreaPath(negativeYs)} fill={`url(#${negativeFillId})`} />
    </g>
  );
}
