export type TimeDirection = 'elapsed' | 'remaining';
export type DiffusionFlowStage = '正面' | '正面 → 傾斜' | '切片增加' | '曲面' | '標準差' | '傾斜 → 俯視' | '俯視';

export type DensityPoint = {
  returnValue: number;
  density: number;
  displayDensity: number;
};

export type DiffusionSlice = {
  fraction: number;
  elapsedYears: number;
  remainingYears: number;
  standardDeviation: number;
  points: DensityPoint[];
};

export type DiffusionDataset = {
  domainHalfWidth: number;
  maximumDensity: number;
  slices: DiffusionSlice[];
};

export type DiffusionStandardDeviationPoint = {
  fraction: number;
  returnValue: number;
  displayDensity: number;
};

export type DiffusionStandardDeviationRail = {
  sign: -1 | 1;
  points: DiffusionStandardDeviationPoint[];
};

export type DiffusionLabState = {
  flowProgress: number;
  timeDirection: TimeDirection;
  showSurface: boolean;
  showStandardDeviation: boolean;
  annualVolatility: number;
};

export const DEFAULT_DIFFUSION_LAB_STATE: DiffusionLabState = {
  flowProgress: 0,
  timeDirection: 'elapsed',
  showSurface: true,
  showStandardDeviation: true,
  annualVolatility: 0.5,
};

const DAYS_PER_YEAR = 365;
const DISPLAY_RETURN_HALF_RANGE = 1.2;
export const DIFFUSION_SURFACE_START_DAYS = 30;
export const DIFFUSION_SURFACE_END_DAYS = 180;
export const DIFFUSION_VISIBLE_SLICE_COUNT = 7;
export const MINIMUM_SURFACE_TIME_FRACTION = DIFFUSION_SURFACE_START_DAYS / DIFFUSION_SURFACE_END_DAYS;

const clampInteger = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.round(value)));

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

const smoothRange = (value: number, start: number, end: number) => {
  const progress = clampUnit((value - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
};

export type DiffusionFlow = {
  progress: number;
  stage: DiffusionFlowStage;
  tiltProgress: number;
  sliceRevealCount: number;
  visibleSliceCount: number;
  surfaceOpacity: number;
  standardDeviationOpacity: number;
  topProgress: number;
};

export function buildDiffusionFlow(progress: number, maximumSliceCount: number): DiffusionFlow {
  const normalizedProgress = clampUnit(progress / 100);
  const safeMaximumSliceCount = clampInteger(maximumSliceCount, 1, 60);
  const sliceProgress = smoothRange(normalizedProgress, 0.22, 0.55);
  const sliceRevealCount = 1 + (safeMaximumSliceCount - 1) * sliceProgress;
  const visibleSliceCount = Math.min(safeMaximumSliceCount, Math.ceil(sliceRevealCount));
  const stage: DiffusionFlowStage = normalizedProgress <= 0.02
    ? '正面'
    : normalizedProgress < 0.22
      ? '正面 → 傾斜'
      : normalizedProgress < 0.55
        ? '切片增加'
        : normalizedProgress < 0.70
          ? '曲面'
          : normalizedProgress < 0.84
            ? '標準差'
            : normalizedProgress < 0.98
              ? '傾斜 → 俯視'
              : '俯視';

  return {
    progress: normalizedProgress,
    stage,
    tiltProgress: smoothRange(normalizedProgress, 0, 0.22),
    sliceRevealCount,
    visibleSliceCount,
    surfaceOpacity: smoothRange(normalizedProgress, 0.55, 0.68),
    standardDeviationOpacity: smoothRange(normalizedProgress, 0.70, 0.82),
    topProgress: smoothRange(normalizedProgress, 0.84, 1),
  };
}

export const periodStandardDeviation = (annualVolatility: number, years: number) =>
  Math.max(0, annualVolatility) * Math.sqrt(Math.max(0, years));

export const normalDensity = (returnValue: number, standardDeviation: number) => {
  if (standardDeviation <= 0) return 0;
  const z = returnValue / standardDeviation;

  return Math.exp(-0.5 * z * z) / (standardDeviation * Math.sqrt(2 * Math.PI));
};

export const timeAxisFraction = (
  fraction: number,
  direction: TimeDirection,
  minimumFraction = 0,
) => {
  const safeMinimumFraction = clampUnit(minimumFraction);
  const normalizedFraction = safeMinimumFraction >= 1
    ? 0
    : clampUnit((fraction - safeMinimumFraction) / (1 - safeMinimumFraction));

  return direction === 'elapsed' ? normalizedFraction : 1 - normalizedFraction;
};

export function buildDiffusionDataset({
  annualVolatility,
  horizonDays,
  sliceCount,
  pointCount = 121,
  minimumTimeFraction = MINIMUM_SURFACE_TIME_FRACTION,
}: {
  annualVolatility: number;
  horizonDays: number;
  sliceCount: number;
  pointCount?: number;
  minimumTimeFraction?: number;
}): DiffusionDataset {
  const safeSliceCount = clampInteger(sliceCount, 1, 60);
  const safePointCount = clampInteger(pointCount, 3, 401);
  const safeMinimumTimeFraction = Math.max(0.01, Math.min(0.95, minimumTimeFraction));
  const horizonYears = Math.max(0, horizonDays) / DAYS_PER_YEAR;
  // Keep the return axis stable across parameter changes. If the domain scaled
  // with the current sigma, time and volatility changes would cancel visually.
  const domainHalfWidth = DISPLAY_RETURN_HALF_RANGE;

  const rawSlices = Array.from({ length: safeSliceCount }, (_item, index) => {
    // Avoid the limiting spike near t = 0. The teaching surface covers the
    // selected horizon from its minimum display fraction through the endpoint.
    const fraction = safeSliceCount === 1
      ? 1
      : safeMinimumTimeFraction
        + (index / (safeSliceCount - 1)) * (1 - safeMinimumTimeFraction);
    const elapsedYears = horizonYears * fraction;
    const standardDeviation = periodStandardDeviation(annualVolatility, elapsedYears);
    const points = Array.from({ length: safePointCount }, (_point, pointIndex) => {
      const domainProgress = pointIndex / (safePointCount - 1);
      const returnValue = -domainHalfWidth + domainProgress * domainHalfWidth * 2;

      return {
        returnValue,
        density: normalDensity(returnValue, standardDeviation),
      };
    });

    return {
      fraction,
      elapsedYears,
      remainingYears: Math.max(0, horizonYears - elapsedYears),
      standardDeviation,
      points,
    };
  });
  const maximumDensity = rawSlices.reduce(
    (maximum, slice) => Math.max(maximum, ...slice.points.map((point) => point.density)),
    0,
  );

  return {
    domainHalfWidth,
    maximumDensity,
    slices: rawSlices.map((slice) => ({
      ...slice,
      points: slice.points.map((point) => ({
        ...point,
        displayDensity: maximumDensity > 0 ? point.density / maximumDensity : 0,
      })),
    })),
  };
}

export function partitionSurfaceSlices(
  dataset: DiffusionDataset,
  requestedCount: number,
  direction: TimeDirection = 'elapsed',
): DiffusionSlice[] {
  const sliceCount = clampInteger(requestedCount, 1, dataset.slices.length);
  if (sliceCount === 1) {
    return [direction === 'elapsed' ? dataset.slices[0] : dataset.slices.at(-1)!];
  }

  // Select evenly spaced rows including both ends of the canonical time grid.
  // Returned objects are the actual rows of the surface dataset, not
  // independently recalculated Gaussians.
  return Array.from({ length: sliceCount }, (_item, index) => {
    const sourceIndex = Math.round((index * (dataset.slices.length - 1)) / (sliceCount - 1));
    return dataset.slices[sourceIndex];
  });
}

function sampleSurfaceDensity(slice: DiffusionSlice, returnValue: number) {
  const upperIndex = slice.points.findIndex((point) => point.returnValue >= returnValue);
  if (upperIndex <= 0) return slice.points[0].displayDensity;
  if (upperIndex === -1) return slice.points.at(-1)!.displayDensity;

  const lower = slice.points[upperIndex - 1];
  const upper = slice.points[upperIndex];
  const progress = (returnValue - lower.returnValue) / (upper.returnValue - lower.returnValue);

  return lower.displayDensity + (upper.displayDensity - lower.displayDensity) * progress;
}

export function buildStandardDeviationRails(
  dataset: DiffusionDataset,
): DiffusionStandardDeviationRail[] {
  return ([-1, 1] as const).map((sign) => ({
    sign,
    points: dataset.slices.map((slice) => {
      const returnValue = sign * slice.standardDeviation;
      return {
        fraction: slice.fraction,
        returnValue,
        displayDensity: sampleSurfaceDensity(slice, returnValue),
      };
    }),
  }));
}
