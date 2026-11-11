import { useCallback, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useAppEffect } from '../../../shared/lifecycle/AppActivity';
import { STRATEGY_PRICE_RANGE } from '../persistence/strategySchema.js';
import type { ChartPoint } from '../shared/charts';

type AxisDomain = { min: number; max: number };
type ChartViewport = { x: AxisDomain; y: AxisDomain };
type PlotArea = ChartPoint & { width: number; height: number };
type Drag =
  | { kind: 'pan'; pointerId: number; origin: ChartPoint; viewport: ChartViewport }
  | { kind: 'spot'; pointerId: number; priceOffset: number };

const BUTTON_ZOOM_STEP = 1.1;

function getPlotFraction(svg: SVGSVGElement | null, plot: PlotArea, event: { clientX: number; clientY: number }) {
  const transform = svg?.getScreenCTM?.();
  if (!transform) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: (point.x - plot.x) / plot.width,
    y: 1 - (point.y - plot.y) / plot.height,
  };
}

function transformDomain(domain: AxisDomain, shift: number, scale: number, limits?: AxisDomain): AxisDomain {
  const span = domain.max - domain.min;
  const nextSpan = span * scale;
  const nextMin = domain.min + span * shift;
  const min = limits ? Math.max(limits.min, Math.min(limits.max - nextSpan, nextMin)) : nextMin;
  return { min, max: min + nextSpan };
}

export default function useStrategyChartInteraction({
  svgRef, plot, defaultViewport, spot, onSpotChange,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  plot: PlotArea;
  defaultViewport: ChartViewport;
  spot: number;
  onSpotChange: (price: number) => void;
}) {
  const [customViewport, setCustomViewport] = useState<ChartViewport | null>(null);
  const [dragKind, setDragKind] = useState<Drag['kind'] | null>(null);
  const [spotHovered, setSpotHovered] = useState(false);
  const drag = useRef<Drag | null>(null);
  const viewport = customViewport ?? defaultViewport;
  const resetViewport = useCallback(() => setCustomViewport(null), []);

  const zoomViewport = useCallback((zoomFactor: number, anchor: ChartPoint) => {
    if (drag.current) return;
    const defaultSpan = defaultViewport.x.max - defaultViewport.x.min;
    const minSpan = defaultSpan / 20;
    const maxSpan = Math.min(defaultSpan * 8, STRATEGY_PRICE_RANGE.max - STRATEGY_PRICE_RANGE.min);

    setCustomViewport((previous) => {
      const current = previous ?? defaultViewport;
      const span = current.x.max - current.x.min;
      const factor = Math.max(minSpan / span, Math.min(maxSpan / span, zoomFactor));
      if (factor === 1) return previous;
      return {
        x: transformDomain(current.x, anchor.x * (1 - factor), factor, STRATEGY_PRICE_RANGE),
        y: transformDomain(current.y, anchor.y * (1 - factor), factor),
      };
    });
  }, [defaultViewport]);

  useAppEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const zoom = (event: WheelEvent) => {
      const { deltaMode, deltaY } = event;
      if (!deltaY || event.ctrlKey || event.metaKey) return;
      const point = getPlotFraction(svg, plot, event);
      if (!point || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return;
      event.preventDefault();

      const pixelsPerUnit = deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : deltaMode === WheelEvent.DOM_DELTA_PAGE ? svg.clientHeight : 1;
      zoomViewport(Math.exp(deltaY * pixelsPerUnit * 0.002), point);
    };

    svg.addEventListener('wheel', zoom, { passive: false });
    return () => svg.removeEventListener('wheel', zoom);
  }, [svgRef, plot, zoomViewport]);

  const zoomAtCenter = (direction: 'in' | 'out') => {
    zoomViewport(direction === 'in' ? 1 / BUTTON_ZOOM_STEP : BUTTON_ZOOM_STEP, { x: 0.5, y: 0.5 });
  };

  const priceSpan = viewport.x.max - viewport.x.min;
  const spotPrecision = Math.min(10, Math.max(2, 2 - Math.floor(Math.log10(priceSpan))));
  const priceAt = (fraction: number) => viewport.x.min + fraction * priceSpan;
  const updateSpot = (price: number) => {
    const rounded = Number(price.toFixed(spotPrecision));
    onSpotChange(Math.max(viewport.x.min, Math.min(viewport.x.max, rounded)));
  };

  const startDrag = (event: PointerEvent<SVGElement>, onSpotMarker: boolean) => {
    if (event.button !== 0 || drag.current) return;
    const point = getPlotFraction(svgRef.current, plot, event);
    if (!point) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (onSpotMarker || event.pointerType === 'touch') {
      const price = priceAt(point.x);
      drag.current = {
        kind: 'spot',
        pointerId: event.pointerId,
        priceOffset: onSpotMarker ? spot - price : 0,
      };
      setDragKind('spot');
      if (!onSpotMarker) updateSpot(price);
      return;
    }

    drag.current = { kind: 'pan', pointerId: event.pointerId, origin: point, viewport };
    setDragKind('pan');
  };

  const moveDrag = (event: PointerEvent<SVGGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = getPlotFraction(svgRef.current, plot, event);
    if (!point) return;

    if (active.kind === 'spot') {
      updateSpot(priceAt(point.x) + active.priceOffset);
      return;
    }

    setCustomViewport({
      x: transformDomain(active.viewport.x, active.origin.x - point.x, 1, STRATEGY_PRICE_RANGE),
      y: transformDomain(active.viewport.y, active.origin.y - point.y, 1),
    });
  };

  const endDrag = (event: PointerEvent<SVGGElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragKind(null);
    setSpotHovered(false);
  };

  return {
    viewport,
    hasCustomViewport: customViewport !== null,
    resetViewport,
    zoomAtCenter,
    dragKind,
    spotPrecision,
    showSpotInfo: dragKind === 'spot' || (dragKind === null && spotHovered),
    setSpotHovered,
    startDrag,
    moveDrag,
    endDrag,
  };
}
