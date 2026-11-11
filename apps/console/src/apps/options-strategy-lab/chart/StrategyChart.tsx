import { useEffect, useId, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { LocateFixed, ZoomIn, ZoomOut } from 'lucide-react';
import { useAppLayoutEffect } from '../../../shared/lifecycle/AppActivity';
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
import useStrategyChartInteraction from './useStrategyChartInteraction';

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
const PLOT = {
  x: CHART_PADDING.l,
  y: CHART_PADDING.t,
  width: VIEWBOX_WIDTH - CHART_PADDING.l - CHART_PADDING.r,
  height: VIEWBOX_HEIGHT - CHART_PADDING.t - CHART_PADDING.b,
};

function getTickPrecision(ticks: number[]) {
  const step = ticks[1] - ticks[0];
  return step > 0 ? Math.max(0, -Math.floor(Math.log10(step) + 1e-8)) : 0;
}

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

  const defaultX = useMemo(() => getStrategyXDomain(rows), [rows]);
  const seriesOptions = useMemo(
    () => ({ modes, rows, params, entryCost, underlyingQty, normalized: isNormalized }),
    [modes, rows, params, entryCost, underlyingQty, isNormalized],
  );
  const defaultSeries = useMemo(
    () => buildStrategySeries({ ...seriesOptions, xMin: defaultX.min, xMax: defaultX.max }),
    [seriesOptions, defaultX],
  );
  const extent = getSeriesExtent(defaultSeries);
  const yPadding = (extent.max - extent.min) * 0.14;
  const defaultYMin = isNormalized ? -1.1 : extent.min - yPadding;
  const defaultYMax = isNormalized ? 1.1 : extent.max + yPadding;
  const defaultViewport = useMemo(
    () => ({ x: defaultX, y: { min: defaultYMin, max: defaultYMax } }),
    [defaultX, defaultYMin, defaultYMax],
  );

  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportControlsRef = useRef<HTMLDivElement | null>(null);

  useAppLayoutEffect(() => {
    const svg = svgRef.current;
    const controls = viewportControlsRef.current;
    if (!svg || !controls || typeof ResizeObserver === 'undefined') return;

    const positionControls = () => {
      const { clientWidth: width, clientHeight: height } = svg;
      const scale = Math.min(width / VIEWBOX_WIDTH, height / VIEWBOX_HEIGHT);
      const rightInset = (width - VIEWBOX_WIDTH * scale) / 2 + CHART_PADDING.r * scale;
      const bottomInset = (height - VIEWBOX_HEIGHT * scale) / 2 + CHART_PADDING.b * scale;
      controls.style.setProperty('--chart-plot-right-inset', `${rightInset}px`);
      controls.style.setProperty('--chart-plot-bottom-inset', `${bottomInset}px`);
    };

    positionControls();
    const observer = new ResizeObserver(positionControls);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const setSpot = (spot: number) => setParams((previous) => previous.spot === spot ? previous : { ...previous, spot });
  const interaction = useStrategyChartInteraction({ svgRef, plot: PLOT, defaultViewport, spot: params.spot, onSpotChange: setSpot });
  const { viewport, hasCustomViewport, resetViewport } = interaction;
  useEffect(resetViewport, [resetViewport, modes, scaleMode, defaultX.min, defaultX.max]);

  const { min: xMin, max: xMax } = viewport.x;
  const { min: yMin, max: yMax } = viewport.y;
  const series = useMemo(() => {
    if (xMin === defaultX.min && xMax === defaultX.max) return defaultSeries;
    return buildStrategySeries({ ...seriesOptions, xMin, xMax, normalizationReference: defaultSeries });
  }, [seriesOptions, defaultX, defaultSeries, xMin, xMax]);

  const chartWidth = PLOT.width;
  const chartHeight = PLOT.height;
  const xScale = createLinearScale(xMin, xMax, PLOT.x, PLOT.x + chartWidth);
  const yScale = createLinearScale(yMin, yMax, PLOT.y + chartHeight, PLOT.y);
  const scaledSeries = scaleSeries(series, xScale, yScale);
  const pnlSeries = scaledSeries.find((item) => item.definition.key === 'pnl');
  const zeroY = yScale(0);
  const xTicks = createNiceTicks(xMin, xMax, 9).filter((tick) => tick >= xMin && tick <= xMax);
  const yTicks = isNormalized && !hasCustomViewport
    ? [-1, -0.5, 0, 0.5, 1]
    : createNiceTicks(yMin, yMax, 6).filter((tick) => tick >= yMin && tick <= yMax);
  const xTickPrecision = Math.max(2, getTickPrecision(xTicks));
  const yTickPrecision = getTickPrecision(yTicks);
  const spotX = xScale(params.spot);
  const spotText = formatPrice(params.spot, interaction.spotPrecision);
  const spotVisible = params.spot >= xMin && params.spot <= xMax;
  const labelToLeft = spotX > PLOT.x + chartWidth - 180;
  const tooltipX = spotX > PLOT.x + chartWidth / 2 ? PLOT.x + 22 : PLOT.x + chartWidth - 210;
  const chartId = useId();
  const profitFillId = `${chartId}-profit`;
  const lossFillId = `${chartId}-loss`;
  const plotClipId = `${chartId}-plot`;
  const greeks = aggregate(rows, params, underlyingQty);
  const currentPnl = greeks.price - entryCost;
  const breakEvenXs = useMemo(
    () => findBreakEvenPoints(rows, params, entryCost, xMin, xMax, underlyingQty),
    [rows, params, entryCost, xMin, xMax, underlyingQty],
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
        <span className="legend-item"><i className="legend-line legend-line-spot" />標的價格 = {spotText}</span>
      </ChartLegend>

      <ChartFrame ref={svgRef} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} ariaLabel="Options strategy chart">
        <defs>
          <clipPath id={plotClipId}><rect {...PLOT} /></clipPath>
          <linearGradient id={profitFillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--chart-profit-gradient-strong)" />
            <stop offset="1" stopColor="var(--chart-profit-gradient-soft)" />
          </linearGradient>
          <linearGradient id={lossFillId} x1="0" y1="0" x2="0" y2="1">
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
        <g clipPath={`url(#${plotClipId})`}>
          {pnlSeries ? (
            <PositiveNegativeArea points={pnlSeries.points} zeroY={zeroY} positiveFillId={profitFillId} negativeFillId={lossFillId} />
          ) : null}
          <ReferenceLine x1={PLOT.x} x2={PLOT.x + chartWidth} y1={zeroY} y2={zeroY} className="axis-zero" />
          {breakEvenXs.map((breakEvenX) => {
            const x = xScale(breakEvenX);
            return (
              <ReferenceLine
                key={`break-even-${breakEvenX}`}
                x1={x}
                x2={x}
                y1={PLOT.y}
                y2={PLOT.y + chartHeight}
                className="break-even-line"
              />
            );
          })}
          {spotVisible && (
            <ReferenceLine
              x1={spotX}
              x2={spotX}
              y1={PLOT.y}
              y2={PLOT.y + chartHeight}
              className={cx('spot-line', interaction.dragKind === 'spot' && 'dragging')}
            />
          )}
          {scaledSeries.map(({ definition, path }) => (
            <LineSeries key={definition.key} path={path} className={`strategy-line strategy-line-${definition.key}`} />
          ))}
          <g
            onPointerMove={interaction.moveDrag}
            onPointerUp={interaction.endDrag}
            onPointerCancel={interaction.endDrag}
            onLostPointerCapture={interaction.endDrag}
          >
            <rect
              {...PLOT}
              className={cx('chart-drag-layer', interaction.dragKind === 'pan' && 'is-panning')}
              onPointerDown={(event) => interaction.startDrag(event, false)}
            />
            {spotVisible && (
              <g
                onPointerEnter={() => interaction.setSpotHovered(true)}
                onPointerLeave={() => interaction.setSpotHovered(false)}
                onPointerDown={(event) => interaction.startDrag(event, true)}
              >
                <line x1={spotX} x2={spotX} y1={PLOT.y} y2={PLOT.y + chartHeight} className="spot-line-hitbox" />
                <text
                  x={spotX + (labelToLeft ? -8 : 8)}
                  y={PLOT.y + 18}
                  textAnchor={labelToLeft ? 'end' : 'start'}
                  className="chart-label spot-price-label"
                >
                  標的價格 S = {spotText}
                </text>
              </g>
            )}
          </g>
        </g>
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
          formatXTick={(tick) => formatPrice(tick, xTickPrecision)}
          formatYTick={(tick) => isNormalized ? `${tick}` : formatAxisTick(tick, currentMode.key, yTickPrecision)}
        />
        {spotVisible && interaction.showSpotInfo ? (
          <g pointerEvents="none">
            <ChartTooltip x={tooltipX} y={PLOT.y + 18} width={188} height={210}>
              <StrategyTooltip spotText={spotText} greeks={greeks} currentPnl={currentPnl} />
            </ChartTooltip>
          </g>
        ) : null}
      </ChartFrame>

      <div ref={viewportControlsRef} className="chart-viewport-controls" role="group" aria-label="圖表視野控制">
        <button type="button" onClick={resetViewport} aria-label="重設圖表視野" title="重設視角">
          <LocateFixed size={17} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => interaction.zoomAtCenter('in')} aria-label="放大圖表" title="放大">
          <ZoomIn size={17} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => interaction.zoomAtCenter('out')} aria-label="縮小圖表" title="縮小">
          <ZoomOut size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export { StrategyChart };
export default StrategyChart;
