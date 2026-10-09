export type ChartPoint = {
  x: number;
  y: number;
};

export type ChartSeriesDefinition<Key extends string = string> = {
  key: Key;
  label: string;
  color: string;
};

export type ChartSeries<Key extends string = string, Definition extends ChartSeriesDefinition<Key> = ChartSeriesDefinition<Key>> = {
  definition: Definition;
  raw: ChartPoint[];
  display: ChartPoint[];
};

export type ScaledChartSeries<Key extends string = string, Definition extends ChartSeriesDefinition<Key> = ChartSeriesDefinition<Key>> =
  ChartSeries<Key, Definition> & {
    points: ChartPoint[];
    path: string;
  };

export type ChartPadding = {
  l: number;
  r: number;
  t: number;
  b: number;
};
