type LineSeriesProps = {
  path: string;
  className?: string;
};

export default function LineSeries({ path, className = 'chart-line' }: LineSeriesProps) {
  return <path d={path} className={className} fill="none" />;
}
