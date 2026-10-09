import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  CartesianGrid,
  ChartAxisLabels,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  LineSeries,
  PositiveNegativeArea,
  ReferenceLine,
  createLinearScale,
  createNiceTicks,
  getSeriesExtent,
  scaleSeries,
  type ChartPadding,
} from '../shared/charts';
import { cx, formatPrice } from '../shared/utils/format';
import { aggregate } from '../logic/greeks';
import { findBreakEvenPoints, formatAxisTick, isGreekMode } from '../logic/chartData';
import type { ChartMode, ChartScaleMode, ModelParams, PositionRow } from '../types';
import StrategyChartControls from './StrategyChartControls';
import StrategyTooltip from './StrategyTooltip';
import { buildStrategySeries, getStrategyXDomain, strategyChartModes } from './strategySeries';
import useSpotDrag from './useSpotDrag';

type StrategyChartProps = {
  rows: PositionRow[];
  params: ModelParams;
  setParams: Dispatch<SetStateAction<ModelParams>>;
  modes: ChartMode[];
  setModes: Dispatch<SetStateAction<ChartMode[]>>;
  scaleMode: ChartScaleMode;
  setScaleMode: (mode: ChartScaleMode) => void;
  entryCost: number;
  underlyingQty: number;
  hasCourseAccess: boolean;
  onRequireCourseAccess: (feature: string) => void;
};

const VIEWBOX_WIDTH = 900;
const VIEWBOX_HEIGHT = 430;
const CHART_PADDING: ChartPadding = { l: 72, r: 24, t: 16, b: 58 };

function StrategyChart({ rows, params, setParams, modes, setModes, scaleMode, setScaleMode, entryCost, underlyingQty, hasCourseAccess, onRequireCourseAccess }: StrategyChartProps) {
  const isExpired = params.days <= 0;
  const selectedModeDefinitions = useMemo(
    () => strategyChartModes.filter((candidate) => modes.includes(candidate.key)),
    [modes],
  );
  const currentMode = selectedModeDefinitions[0] ?? strategyChartModes[0];
  const usesComparablePriceScale = selectedModeDefinitions.every(
    ({ key }) => key === 'pnl' || key === 'payoff',
  );
  const isNormalized = scaleMode === 'normalized'
    || (scaleMode === 'auto' && selectedModeDefinitions.length > 1 && !usesComparablePriceScale);

  useEffect(() => {
    if (!isExpired) return;
    setModes((previous) => {
      if (!previous.some(isGreekMode)) return previous;
      const nonGreekModes = previous.filter((mode) => !isGreekMode(mode));
      return nonGreekModes.length > 0 ? nonGreekModes : ['pnl'];
    });
  }, [isExpired, setModes]);

  const xDomain = useMemo(() => getStrategyXDomain(rows), [rows]);
  const series = useMemo(
    () => buildStrategySeries({
      modes,
      rows,
      params,
      xMin: xDomain.min,
      xMax: xDomain.max,
      entryCost,
      underlyingQty,
      normalized: isNormalized,
    }),
    [modes, rows, params, xDomain, entryCost, underlyingQty, isNormalized],
  );
  const extent = getSeriesExtent(series);
  const chartWidth = VIEWBOX_WIDTH - CHART_PADDING.l - CHART_PADDING.r;
  const chartHeight = VIEWBOX_HEIGHT - CHART_PADDING.t - CHART_PADDING.b;
  const yPadding = (extent.max - extent.min) * 0.14 || 1;
  const yMin = isNormalized ? -1.1 : extent.min - yPadding;
  const yMax = isNormalized ? 1.1 : extent.max + yPadding;
  const xScale = createLinearScale(xDomain.min, xDomain.max, CHART_PADDING.l, CHART_PADDING.l + chartWidth);
  const yScale = createLinearScale(yMin, yMax, CHART_PADDING.t + chartHeight, CHART_PADDING.t);
  const scaledSeries = scaleSeries(series, xScale, yScale);
  const pnlSeries = scaledSeries.find((item) => item.definition.key === 'pnl');
  const zeroY = yScale(0);
  const xTicks = useMemo(() => createNiceTicks(xDomain.min, xDomain.max, 9), [xDomain]);
  const yTicks = useMemo(
    () => isNormalized ? [-1, -0.5, 0, 0.5, 1] : createNiceTicks(yMin, yMax, 6),
    [isNormalized, yMin, yMax],
  );
  const spotX = xScale(params.spot);
  const tooltipX = spotX > CHART_PADDING.l + chartWidth / 2 ? CHART_PADDING.l + 22 : CHART_PADDING.l + chartWidth - 210;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const setSpot = (spot: number) => setParams((previous) => ({ ...previous, spot }));
  const spotDrag = useSpotDrag({
    svgRef,
    viewBoxWidth: VIEWBOX_WIDTH,
    padding: CHART_PADDING,
    chartWidth,
    xMin: xDomain.min,
    xMax: xDomain.max,
    spot: params.spot,
    onSpotChange: setSpot,
  });
  const greeks = aggregate(rows, params, underlyingQty);
  const currentPnl = greeks.price - entryCost;
  const breakEvenXs = useMemo(
    () => findBreakEvenPoints(rows, params, entryCost, xDomain.min, xDomain.max, underlyingQty),
    [rows, params, entryCost, xDomain, underlyingQty],
  );
  const chartTitle = selectedModeDefinitions.length > 1
    ? '策略指標比較曲線'
    : currentMode.key === 'pnl'
      ? (isExpired ? '策略到期損益圖' : '策略目前損益曲線')
      : currentMode.title;
  const yAxisLabel = isNormalized ? '標準化刻度' : selectedModeDefinitions.length > 1 ? '多指標共用原始刻度' : currentMode.yLabel;
  const legendItems = scaledSeries.map(({ definition }) => ({
    key: definition.key,
    color: definition.color,
    label: definition.key === 'pnl' ? (isExpired ? '到期損益' : '目前損益') : definition.label,
  }));

  return (
    <section className="card chart-card">
      <div className="chart-header">
        <div>
          <h2>{chartTitle}</h2>
          <p>{isExpired ? '到期日已到，Greeks 不再以 Black-Scholes 模型顯示' : '根據左側部位與模型參數即時更新'}</p>
        </div>
        <StrategyChartControls
          modes={modes}
          setModes={setModes}
          scaleMode={scaleMode}
          setScaleMode={setScaleMode}
          isExpired={isExpired}
          hasCourseAccess={hasCourseAccess}
          onRequireCourseAccess={onRequireCourseAccess}
        />
      </div>

      <ChartLegend items={legendItems}>
        <span className="legend-item"><i className="legend-line legend-line-break-even" />損益兩平點</span>
        <span className="legend-item"><i className="legend-line legend-line-spot" />標的價格 = {formatPrice(params.spot)}</span>
      </ChartLegend>

      <ChartFrame ref={svgRef} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} ariaLabel="Options strategy chart">
        <defs>
          <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--chart-profit-gradient-strong)" />
            <stop offset="1" stopColor="var(--chart-profit-gradient-soft)" />
          </linearGradient>
          <linearGradient id="lossFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--chart-loss-gradient-soft)" />
            <stop offset="1" stopColor="var(--chart-loss-gradient-strong)" />
          </linearGradient>
        </defs>

        <CartesianGrid
          xTicks={xTicks}
          yTicks={yTicks}
          xScale={xScale}
          yScale={yScale}
          padding={CHART_PADDING}
          chartWidth={chartWidth}
          chartHeight={chartHeight}
        />
        {pnlSeries ? (
          <PositiveNegativeArea
            points={pnlSeries.points}
            zeroY={zeroY}
            positiveFillId="profitFill"
            negativeFillId="lossFill"
          />
        ) : null}
        <ReferenceLine
          x1={CHART_PADDING.l}
          x2={CHART_PADDING.l + chartWidth}
          y1={zeroY}
          y2={zeroY}
          className="axis-zero"
        />
        {breakEvenXs.map((breakEvenX) => {
          const x = xScale(breakEvenX);
          return (
            <ReferenceLine
              key={`break-even-${breakEvenX}`}
              x1={x}
              x2={x}
              y1={CHART_PADDING.t}
              y2={CHART_PADDING.t + chartHeight}
              className="break-even-line"
            />
          );
        })}
        <ReferenceLine
          x1={spotX}
          x2={spotX}
          y1={CHART_PADDING.t}
          y2={CHART_PADDING.t + chartHeight}
          className={cx('spot-line', spotDrag.isDraggingSpot && 'dragging')}
        />
        {scaledSeries.map(({ definition, path }) => (
          <LineSeries key={definition.key} path={path} className={`strategy-line strategy-line-${definition.key}`} />
        ))}
        <rect
          x={CHART_PADDING.l}
          y={CHART_PADDING.t}
          width={chartWidth}
          height={chartHeight}
          className="chart-drag-layer"
          onPointerDown={spotDrag.startSpotDrag}
          onPointerMove={spotDrag.moveSpotDrag}
          onPointerUp={spotDrag.stopSpotDrag}
          onPointerCancel={spotDrag.stopSpotDrag}
        />
        <line
          x1={spotX}
          x2={spotX}
          y1={CHART_PADDING.t}
          y2={CHART_PADDING.t + chartHeight}
          className="spot-line-hitbox"
          onPointerEnter={spotDrag.showSpotTooltip}
          onPointerLeave={spotDrag.hideSpotTooltip}
          onPointerDown={spotDrag.startSpotDrag}
          onPointerMove={spotDrag.moveSpotDrag}
          onPointerUp={spotDrag.stopSpotDrag}
          onPointerCancel={spotDrag.stopSpotDrag}
        />
        <text x={spotX + 8} y={CHART_PADDING.t + 18} className="chart-label">標的價格 S = {formatPrice(params.spot)}</text>
        <ChartAxisLabels
          xTicks={xTicks}
          yTicks={yTicks}
          xScale={xScale}
          yScale={yScale}
          padding={CHART_PADDING}
          chartWidth={chartWidth}
          chartHeight={chartHeight}
          xLabel="標的價格 S"
          yLabel={yAxisLabel}
          formatXTick={formatPrice}
          formatYTick={(tick) => isNormalized ? `${tick}` : formatAxisTick(tick, currentMode.key)}
        />
        {spotDrag.showSpotInfo ? (
          <ChartTooltip x={tooltipX} y={CHART_PADDING.t + 18} width={188} height={210}>
            <StrategyTooltip params={params} greeks={greeks} currentPnl={currentPnl} />
          </ChartTooltip>
        ) : null}
      </ChartFrame>
    </section>
  );
}

export { StrategyChart };
export default StrategyChart;
