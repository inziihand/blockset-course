type ReferenceLineProps = {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  className: string;
};

export default function ReferenceLine({ x1, x2, y1, y2, className }: ReferenceLineProps) {
  return <line x1={x1} x2={x2} y1={y1} y2={y2} className={className} />;
}
