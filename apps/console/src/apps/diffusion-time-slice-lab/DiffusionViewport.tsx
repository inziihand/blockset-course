import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  buildDiffusionDataset,
  buildDiffusionFlow,
  buildStandardDeviationRails,
  DIFFUSION_SURFACE_END_DAYS,
  DIFFUSION_SURFACE_START_DAYS,
  DIFFUSION_VISIBLE_SLICE_COUNT,
  MINIMUM_SURFACE_TIME_FRACTION,
  partitionSurfaceSlices,
  timeAxisFraction,
  type DiffusionDataset,
  type DiffusionFlow,
  type DiffusionLabState,
  type DiffusionSlice,
  type DiffusionStandardDeviationRail,
} from './diffusionModel';

type Point = { x: number; y: number };
type Projection = {
  origin: Point;
  xAxis: Point;
  timeAxis: Point;
  densityAxis: Point;
  perspective: number;
};

export function TimeDirectionLabel({ direction }: { direction: DiffusionLabState['timeDirection'] }) {
  return <>
    <span className="diffusion-time-symbol">{direction === 'elapsed' ? 'T' : 'τ→0'}</span>
    {' '}
    <span>{direction === 'elapsed' ? '擴散時間' : '剩餘時間'}</span>
  </>;
}

function stageSubtitle(progress: number, timeDirection: DiffusionLabState['timeDirection']) {
  if (progress <= 0.02) return { stage: '正面', text: '隨機變動累積後，形成近似高斯分布。' };
  if (progress < 0.22) return { stage: '傾斜', text: '沿著時間軸展開，每個時間切片都呈高斯形狀。' };
  if (progress < 0.55) return timeDirection === 'elapsed'
    ? { stage: '切片增加', text: '擴散時間越長，分布就越寬。' }
    : { stage: '切片增加', text: 'τ 越接近 0，分布就越集中。' };
  if (progress < 0.70) return { stage: '曲面', text: '把這些時間切片連起來，就形成機率分布曲面。' };
  if (progress < 0.84) return { stage: '標準差', text: '橘色範圍標示平均值兩側各一個標準差。' };
  return {
    stage: '俯視',
    text: '而擴散的快慢，除了時間，也取決於波動率。',
    secondary: '試著改變控制元件，看看變化。',
  };
}

const VIEWBOX_WIDTH = 960;
const VIEWBOX_HEIGHT = 450;
const SURFACE_TIME_SAMPLES = 33;
const SURFACE_POINT_SAMPLES = 181;
const SURFACE_CELL_STEP = 3;
export const PERSPECTIVE_DEPTH_REDUCTION = 0.1;
export const DIRECTION_TRANSITION_DURATION_MS = 460;

const VIRIDIS_STOPS = [
  { value: 0, color: [68, 1, 84] },
  { value: 0.25, color: [59, 82, 139] },
  { value: 0.5, color: [33, 145, 140] },
  { value: 0.75, color: [94, 201, 98] },
  { value: 1, color: [253, 231, 37] },
] as const;

export function viridisColor(value: number) {
  const normalizedValue = clampUnit(value);
  const upperIndex = VIRIDIS_STOPS.findIndex((stop) => stop.value >= normalizedValue);
  if (upperIndex <= 0) return 'rgb(68 1 84)';

  const lower = VIRIDIS_STOPS[upperIndex - 1];
  const upper = VIRIDIS_STOPS[upperIndex];
  const progress = (normalizedValue - lower.value) / (upper.value - lower.value);
  const channels = lower.color.map((channel, index) => (
    Math.round(mix(channel, upper.color[index], progress))
  ));

  return `rgb(${channels.join(' ')})`;
}

const FRONT_PROJECTION: Projection = {
  origin: { x: 110, y: 390 },
  xAxis: { x: 760, y: 0 },
  timeAxis: { x: 0, y: 0 },
  densityAxis: { x: 0, y: -315 },
  perspective: 0,
};

const OBLIQUE_PROJECTION: Projection = {
  origin: { x: 92, y: 397 },
  xAxis: { x: 500, y: 20 },
  timeAxis: { x: 286, y: -188 },
  densityAxis: { x: 0, y: -240 },
  perspective: 1,
};

const TOP_PROJECTION: Projection = {
  origin: { x: 290, y: 390 },
  xAxis: { x: 0, y: -315 },
  timeAxis: { x: 380, y: 0 },
  densityAxis: { x: 0, y: 0 },
  perspective: 0,
};

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
const mix = (start: number, end: number, progress: number) => start + (end - start) * progress;
const easeInOutCubic = (progress: number) => (
  progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2
);
const mixPoint = (start: Point, end: Point, progress: number): Point => ({
  x: mix(start.x, end.x, progress),
  y: mix(start.y, end.y, progress),
});
const mixProjection = (start: Projection, end: Projection, progress: number): Projection => ({
  origin: mixPoint(start.origin, end.origin, progress),
  xAxis: mixPoint(start.xAxis, end.xAxis, progress),
  timeAxis: mixPoint(start.timeAxis, end.timeAxis, progress),
  densityAxis: mixPoint(start.densityAxis, end.densityAxis, progress),
  perspective: mix(start.perspective, end.perspective, progress),
});

const projectionForFlow = (flow: DiffusionFlow) => mixProjection(
  mixProjection(FRONT_PROJECTION, OBLIQUE_PROJECTION, flow.tiltProgress),
  TOP_PROJECTION,
  flow.topProgress,
);

const pathFromPoints = (points: Point[], close = false) =>
  `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')}${close ? ' Z' : ''}`;

export const perspectiveScale = (time: number, amount = 1) =>
  1 - PERSPECTIVE_DEPTH_REDUCTION * clampUnit(time) * clampUnit(amount);

const projectPoint = (x: number, time: number, density: number, projection: Projection): Point => {
  const depthScale = perspectiveScale(time, projection.perspective);
  const perspectiveX = 0.5 + (x - 0.5) * depthScale;
  const perspectiveDensity = density * depthScale;

  return {
    x: projection.origin.x
      + projection.xAxis.x * perspectiveX
      + projection.timeAxis.x * time
      + projection.densityAxis.x * perspectiveDensity,
    y: projection.origin.y
      + projection.xAxis.y * perspectiveX
      + projection.timeAxis.y * time
      + projection.densityAxis.y * perspectiveDensity,
  };
};

const xProgress = (returnValue: number, domainHalfWidth: number) =>
  (returnValue + domainHalfWidth) / (domainHalfWidth * 2);

export const directionTimeAxisFraction = (
  fraction: number,
  directionProgress: number,
  minimumFraction = 0,
) => mix(
  timeAxisFraction(fraction, 'elapsed', minimumFraction),
  timeAxisFraction(fraction, 'remaining', minimumFraction),
  clampUnit(directionProgress),
);

function useDirectionTransition(direction: DiffusionLabState['timeDirection']) {
  const target = direction === 'remaining' ? 1 : 0;
  const [progress, setProgress] = useState(target);
  const progressRef = useRef(target);

  useEffect(() => {
    const startProgress = progressRef.current;
    const distance = Math.abs(target - startProgress);
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (distance < 0.001 || reduceMotion || typeof window.requestAnimationFrame !== 'function') {
      progressRef.current = target;
      setProgress(target);
      return undefined;
    }

    const duration = DIRECTION_TRANSITION_DURATION_MS * distance;
    const startedAt = performance.now();
    let animationFrame = 0;
    let lastRenderedAt = startedAt - 40;

    const animate = (now: number) => {
      const rawProgress = clampUnit((now - startedAt) / duration);
      if (rawProgress >= 1 || now - lastRenderedAt >= 30) {
        const nextProgress = mix(startProgress, target, easeInOutCubic(rawProgress));
        progressRef.current = nextProgress;
        setProgress(nextProgress);
        lastRenderedAt = now;
      }

      if (rawProgress < 1) animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [target]);

  return {
    progress,
    isTransitioning: Math.abs(progress - target) >= 0.001,
  };
}

const curvePoints = (
  slice: DiffusionSlice,
  dataset: DiffusionDataset,
  directionProgress: number,
  projection: Projection,
) => slice.points.map((point) => projectPoint(
  xProgress(point.returnValue, dataset.domainHalfWidth),
  directionTimeAxisFraction(slice.fraction, directionProgress, MINIMUM_SURFACE_TIME_FRACTION),
  point.displayDensity,
  projection,
));

const slicePath = (
  slice: DiffusionSlice,
  dataset: DiffusionDataset,
  directionProgress: number,
  projection: Projection,
) => {
  if (slice.standardDeviation > 0) return pathFromPoints(curvePoints(slice, dataset, directionProgress, projection));
  const time = directionTimeAxisFraction(slice.fraction, directionProgress, MINIMUM_SURFACE_TIME_FRACTION);
  return pathFromPoints([
    projectPoint(0.5, time, 0, projection),
    projectPoint(0.5, time, 1, projection),
  ]);
};

function buildSliceRevealOrder(
  sliceCount: number,
  direction: DiffusionLabState['timeDirection'],
) {
  const chronologicalOrder = Array.from({ length: sliceCount }, (_item, index) => index);
  return direction === 'elapsed' ? chronologicalOrder : chronologicalOrder.reverse();
}

function SurfaceCells({
  dataset,
  directionProgress,
  projection,
  opacity,
}: {
  dataset: DiffusionDataset;
  directionProgress: number;
  projection: Projection;
  opacity: number;
}) {
  const curves = dataset.slices.map((slice) => curvePoints(slice, dataset, directionProgress, projection));

  return curves.slice(0, -1).flatMap((curve, sliceIndex) => {
    const nextCurve = curves[sliceIndex + 1];

    return Array.from({ length: Math.ceil((curve.length - 1) / SURFACE_CELL_STEP) }, (_item, cellIndex) => {
      const start = cellIndex * SURFACE_CELL_STEP;
      const end = Math.min(start + SURFACE_CELL_STEP, curve.length - 1);
      const density = (
        dataset.slices[sliceIndex].points[start].displayDensity
        + dataset.slices[sliceIndex].points[end].displayDensity
        + dataset.slices[sliceIndex + 1].points[start].displayDensity
        + dataset.slices[sliceIndex + 1].points[end].displayDensity
      ) / 4;

      return (
        <path
          key={`${sliceIndex}-${cellIndex}`}
          data-layer="surface"
          className="diffusion-surface-cell"
          d={pathFromPoints([curve[start], curve[end], nextCurve[end], nextCurve[start]], true)}
          fill={viridisColor(density)}
          opacity={opacity * 0.86}
        />
      );
    });
  });
}

function StandardDeviationRails({
  dataset,
  rails,
  directionProgress,
  projection,
  opacity,
}: {
  dataset: DiffusionDataset;
  rails: DiffusionStandardDeviationRail[];
  directionProgress: number;
  projection: Projection;
  opacity: number;
}) {
  return rails.map((rail) => {
    const points = rail.points.map((point) => projectPoint(
      xProgress(point.returnValue, dataset.domainHalfWidth),
      directionTimeAxisFraction(point.fraction, directionProgress, MINIMUM_SURFACE_TIME_FRACTION),
      point.displayDensity,
      projection,
    ));

    return (
      <g key={rail.sign} data-standard-deviation-sign={rail.sign}>
        <path
          data-layer="standard-deviation"
          className="diffusion-sigma-line"
          d={pathFromPoints(points)}
          opacity={opacity}
        />
      </g>
    );
  });
}

function TopViewStandardDeviationGuide({
  dataset,
  directionProgress,
  projection,
  opacity,
}: {
  dataset: DiffusionDataset;
  directionProgress: number;
  projection: Projection;
  opacity: number;
}) {
  if (opacity <= 0) return null;

  const referenceSlice = dataset.slices.at(-1)!;
  const time = directionTimeAxisFraction(
    referenceSlice.fraction,
    directionProgress,
    MINIMUM_SURFACE_TIME_FRACTION,
  );
  const upper = projectPoint(
    xProgress(referenceSlice.standardDeviation, dataset.domainHalfWidth),
    time,
    0,
    projection,
  );
  const center = projectPoint(0.5, time, 0, projection);
  const lower = projectPoint(
    xProgress(-referenceSlice.standardDeviation, dataset.domainHalfWidth),
    time,
    0,
    projection,
  );
  const guideX = Math.min(upper.x, center.x, lower.x) - 24;
  const labelX = guideX - 12;
  const upperMidpointY = (upper.y + center.y) / 2;
  const lowerMidpointY = (center.y + lower.y) / 2;

  return (
    <g
      data-layer="top-standard-deviation-guide"
      data-reference-fraction={referenceSlice.fraction}
      className="diffusion-top-sigma-guide"
      opacity={opacity}
      aria-hidden="true"
    >
      <line x1={guideX} y1={upper.y} x2={guideX} y2={lower.y} />
      <line x1={guideX + 5} y1={upper.y} x2={upper.x} y2={upper.y} />
      <line x1={guideX + 5} y1={lower.y} x2={lower.x} y2={lower.y} />
      <path d={`M ${guideX - 4} ${upper.y + 6} L ${guideX} ${upper.y} L ${guideX + 4} ${upper.y + 6}`} />
      <path d={`M ${guideX - 4} ${lower.y - 6} L ${guideX} ${lower.y} L ${guideX + 4} ${lower.y - 6}`} />
      <path
        className="diffusion-top-sigma-center"
        d={`M ${guideX - 4} ${center.y - 4} L ${guideX + 4} ${center.y + 4} M ${guideX + 4} ${center.y - 4} L ${guideX - 4} ${center.y + 4}`}
      />
      <circle cx={upper.x} cy={upper.y} r="4" />
      <circle cx={lower.x} cy={lower.y} r="4" />
      <text className="diffusion-top-sigma-label" x={labelX} y={upperMidpointY + 5} textAnchor="middle">σ</text>
      <text className="diffusion-top-sigma-label" x={labelX} y={lowerMidpointY + 5} textAnchor="middle">σ</text>
    </g>
  );
}

function displayDensityAtReturn(slice: DiffusionSlice, returnValue: number) {
  const upperIndex = slice.points.findIndex((point) => point.returnValue >= returnValue);
  if (upperIndex === -1) return slice.points.at(-1)!.displayDensity;
  if (upperIndex === 0) return slice.points[0].displayDensity;

  const lower = slice.points[upperIndex - 1];
  const upper = slice.points[upperIndex];
  const progress = (returnValue - lower.returnValue) / (upper.returnValue - lower.returnValue);
  return mix(lower.displayDensity, upper.displayDensity, progress);
}

function standardDeviationAreaPath(
  slice: DiffusionSlice,
  dataset: DiffusionDataset,
  directionProgress: number,
  projection: Projection,
) {
  const lowerReturn = -slice.standardDeviation;
  const upperReturn = slice.standardDeviation;
  const time = directionTimeAxisFraction(
    slice.fraction,
    directionProgress,
    MINIMUM_SURFACE_TIME_FRACTION,
  );
  const curveSamples = [
    { returnValue: lowerReturn, displayDensity: displayDensityAtReturn(slice, lowerReturn) },
    ...slice.points.filter((point) => (
      point.returnValue > lowerReturn && point.returnValue < upperReturn
    )),
    { returnValue: upperReturn, displayDensity: displayDensityAtReturn(slice, upperReturn) },
  ];
  const curve = curveSamples.map((point) => projectPoint(
    xProgress(point.returnValue, dataset.domainHalfWidth),
    time,
    point.displayDensity,
    projection,
  ));
  const upperBaseline = projectPoint(
    xProgress(upperReturn, dataset.domainHalfWidth),
    time,
    0,
    projection,
  );
  const lowerBaseline = projectPoint(
    xProgress(lowerReturn, dataset.domainHalfWidth),
    time,
    0,
    projection,
  );

  return pathFromPoints([...curve, upperBaseline, lowerBaseline], true);
}

function ContinuousDiffusionView({
  slices,
  surface,
  standardDeviationRails,
  state,
  flow,
  directionProgress,
  isDirectionTransitioning,
}: {
  slices: DiffusionSlice[];
  surface: DiffusionDataset;
  standardDeviationRails: DiffusionStandardDeviationRail[];
  state: DiffusionLabState;
  flow: DiffusionFlow;
  directionProgress: number;
  isDirectionTransitioning: boolean;
}) {
  const projection = projectionForFlow(flow);
  const origin = projectPoint(0, 0, 0, projection);
  const returnEnd = projectPoint(1, 0, 0, projection);
  const timeEnd = projectPoint(0, 1, 0, projection);
  const densityEnd = projectPoint(0, 0, 1, projection);
  const plane = [
    projectPoint(0, 0, 0, projection),
    projectPoint(1, 0, 0, projection),
    projectPoint(1, 1, 0, projection),
    projectPoint(0, 1, 0, projection),
  ];
  const revealOrder = buildSliceRevealOrder(slices.length, state.timeDirection);
  const visibleSlices = revealOrder
    .map((sliceIndex, revealIndex) => ({
      slice: slices[sliceIndex],
      opacity: clampUnit(flow.sliceRevealCount - revealIndex),
    }))
    .filter(({ opacity }) => opacity > 0)
    .sort((left, right) => (
      directionTimeAxisFraction(right.slice.fraction, directionProgress, MINIMUM_SURFACE_TIME_FRACTION)
      - directionTimeAxisFraction(left.slice.fraction, directionProgress, MINIMUM_SURFACE_TIME_FRACTION)
    ));
  const surfaceOpacity = state.showSurface ? flow.surfaceOpacity : 0;
  const standardDeviationOpacity = state.showStandardDeviation ? flow.standardDeviationOpacity : 0;
  const topGuideOpacity = standardDeviationOpacity * clampUnit((flow.topProgress - 0.5) * 2);
  return (
    <g
      className={`diffusion-view-layer${isDirectionTransitioning ? ' is-reversing' : ''}`}
      data-direction-progress={directionProgress.toFixed(3)}
    >
      <path
        className="diffusion-plot-frame"
        d={pathFromPoints(plane, true)}
        opacity={flow.topProgress * 0.72}
      />
      <line className="diffusion-axis" x1={origin.x} y1={origin.y} x2={returnEnd.x} y2={returnEnd.y} />
      <line
        className="diffusion-axis"
        x1={origin.x}
        y1={origin.y}
        x2={timeEnd.x}
        y2={timeEnd.y}
        opacity={Math.max(flow.tiltProgress, flow.topProgress)}
      />
      <line
        className="diffusion-axis"
        x1={origin.x}
        y1={origin.y}
        x2={densityEnd.x}
        y2={densityEnd.y}
        opacity={1 - flow.topProgress}
      />

      <SurfaceCells
        dataset={surface}
        directionProgress={directionProgress}
        projection={projection}
        opacity={surfaceOpacity}
      />

      {visibleSlices.map(({ slice, opacity }) => (
        <path
          key={`sigma-area-${slice.fraction}`}
          data-layer="standard-deviation-area"
          data-surface-fraction={slice.fraction}
          className="diffusion-sigma-area"
          d={standardDeviationAreaPath(slice, surface, directionProgress, projection)}
          opacity={standardDeviationOpacity * (0.08 + opacity * 0.12)}
        />
      ))}

      {visibleSlices.map(({ slice, opacity }) => (
        <path
          key={slice.fraction}
          data-layer="time-slice"
          data-surface-fraction={slice.fraction}
          className="diffusion-slice-line"
          d={slicePath(slice, surface, directionProgress, projection)}
          opacity={0.28 + opacity * 0.72}
        />
      ))}

      <StandardDeviationRails
        dataset={surface}
        rails={standardDeviationRails}
        directionProgress={directionProgress}
        projection={projection}
        opacity={standardDeviationOpacity}
      />

      <TopViewStandardDeviationGuide
        dataset={surface}
        directionProgress={directionProgress}
        projection={projection}
        opacity={topGuideOpacity}
      />

      <text
        className="diffusion-axis-label"
        x={returnEnd.x + (flow.topProgress > 0.5 ? -10 : 0)}
        y={returnEnd.y + (flow.topProgress > 0.5 ? -10 : 32)}
        textAnchor="end"
      >
        R
      </text>
      <text
        className="diffusion-axis-label"
        x={timeEnd.x + 8}
        y={timeEnd.y + (flow.topProgress > 0.5 ? 30 : -9)}
        opacity={Math.max(flow.tiltProgress, flow.topProgress)}
        textAnchor={flow.topProgress > 0.5 ? 'end' : 'start'}
      >
        {state.timeDirection === 'elapsed' ? 't' : 'τ'}
      </text>
      <text
        className="diffusion-axis-label"
        x={densityEnd.x - 10}
        y={densityEnd.y}
        textAnchor="end"
        opacity={1 - flow.topProgress}
      >
        {state.timeDirection === 'elapsed' ? 'p(R | t, σ)' : 'p(R | T−τ, σ)'}
      </text>
    </g>
  );
}

export default function DiffusionViewport({
  state,
  showSubtitles,
  sectionRef,
  flowControl,
}: {
  state: DiffusionLabState;
  showSubtitles: boolean;
  sectionRef?: Ref<HTMLElement>;
  flowControl?: ReactNode;
}) {
  const geometry = useMemo(() => {
    const surface = buildDiffusionDataset({
      annualVolatility: state.annualVolatility,
      horizonDays: DIFFUSION_SURFACE_END_DAYS,
      sliceCount: SURFACE_TIME_SAMPLES,
      pointCount: SURFACE_POINT_SAMPLES,
    });
    return {
      surface,
      standardDeviationRails: buildStandardDeviationRails(surface),
    };
  }, [state.annualVolatility]);
  const slices = useMemo(
    () => partitionSurfaceSlices(geometry.surface, DIFFUSION_VISIBLE_SLICE_COUNT),
    [geometry.surface],
  );
  const directionTransition = useDirectionTransition(state.timeDirection);
  const flow = buildDiffusionFlow(state.flowProgress, DIFFUSION_VISIBLE_SLICE_COUNT);
  const directionLabel = state.timeDirection === 'elapsed' ? '擴散時間' : '剩餘時間';
  const currentStage = stageSubtitle(flow.progress, state.timeDirection);
  const subtitleLineLength = Math.max(currentStage.text.length, currentStage.secondary?.length ?? 0);
  const stageBadgeWidth = Math.min(VIEWBOX_WIDTH - 48, Math.max(360, subtitleLineLength * 22 + 96));
  const stageBadgeHeight = currentStage.secondary ? 80 : 48;
  const currentNarration = [currentStage.text, currentStage.secondary].filter(Boolean).join(' ');
  const timeRangeLabel = state.timeDirection === 'elapsed'
    ? `${DIFFUSION_SURFACE_START_DAYS}–${DIFFUSION_SURFACE_END_DAYS} 天`
    : `${DIFFUSION_SURFACE_END_DAYS - DIFFUSION_SURFACE_START_DAYS}–0 天`;

  return (
    <section ref={sectionRef} className="diffusion-viewport-card" aria-labelledby="diffusion-viewport-heading">
      <div className="diffusion-viewport-heading">
        <div>
          <h3 id="diffusion-viewport-heading">機率分布曲面</h3>
          <p>固定 30–180 天，7 張時間切片依流程揭示</p>
        </div>
        <strong><TimeDirectionLabel direction={state.timeDirection} /></strong>
      </div>
      <svg
        className="diffusion-viewport"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        role="img"
        aria-labelledby="diffusion-svg-title diffusion-svg-description"
      >
        <title id="diffusion-svg-title">{flow.stage}階段的時間切片機率分布</title>
        <desc id="diffusion-svg-description">
          {currentNarration} 流程進度 {state.flowProgress}%，顯示 {flow.visibleSliceCount} 個切片；年化波動率 {(state.annualVolatility * 100).toFixed(0)}%，{directionLabel}範圍 {timeRangeLabel}。
        </desc>
        <ContinuousDiffusionView
          slices={slices}
          surface={geometry.surface}
          standardDeviationRails={geometry.standardDeviationRails}
          state={state}
          flow={flow}
          directionProgress={directionTransition.progress}
          isDirectionTransitioning={directionTransition.isTransitioning}
        />
        {showSubtitles ? <g
          className="diffusion-stage-badge"
          data-stage={currentStage.stage}
          transform={`translate(${(VIEWBOX_WIDTH - stageBadgeWidth) / 2} ${VIEWBOX_HEIGHT - stageBadgeHeight - 24})`}
          aria-hidden="true"
        >
          <rect width={stageBadgeWidth} height={stageBadgeHeight} rx="12" />
          <text x={stageBadgeWidth / 2} textAnchor="middle">
            <tspan x={stageBadgeWidth / 2} y={currentStage.secondary ? 30 : 31}>{currentStage.text}</tspan>
            {currentStage.secondary
              ? <tspan x={stageBadgeWidth / 2} y="59">{currentStage.secondary}</tspan>
              : null}
          </text>
        </g> : null}
      </svg>
      {flowControl ? <div className="diffusion-viewport-flow">{flowControl}</div> : null}
      <p className="diffusion-status" role="status" aria-live="polite">
        {flow.visibleSliceCount}/{DIFFUSION_VISIBLE_SLICE_COUNT} 個切片｜σ {(state.annualVolatility * 100).toFixed(0)}%
      </p>
    </section>
  );
}
