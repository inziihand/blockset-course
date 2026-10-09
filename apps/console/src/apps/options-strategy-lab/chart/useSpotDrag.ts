import { useState, type PointerEvent, type RefObject } from 'react';
import type { ChartPadding } from '../shared/charts';

type UseSpotDragArgs = {
  svgRef: RefObject<SVGSVGElement | null>;
  viewBoxWidth: number;
  padding: ChartPadding;
  chartWidth: number;
  xMin: number;
  xMax: number;
  spot: number;
  onSpotChange: (spot: number) => void;
};

export default function useSpotDrag({ svgRef, viewBoxWidth, padding, chartWidth, xMin, xMax, spot, onSpotChange }: UseSpotDragArgs) {
  const [isDraggingSpot, setIsDraggingSpot] = useState(false);
  const [showSpotInfo, setShowSpotInfo] = useState(false);

  const spotFromClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return spot;
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * viewBoxWidth;
    const ratio = Math.min(1, Math.max(0, (svgX - padding.l) / chartWidth));
    return Number((xMin + ratio * (xMax - xMin)).toFixed(2));
  };

  const updateSpotFromPointer = (event: PointerEvent<SVGElement>) => onSpotChange(spotFromClientX(event.clientX));
  const startSpotDrag = (event: PointerEvent<SVGElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDraggingSpot(true);
    setShowSpotInfo(true);
    updateSpotFromPointer(event);
  };
  const moveSpotDrag = (event: PointerEvent<SVGElement>) => {
    if (isDraggingSpot) updateSpotFromPointer(event);
  };
  const stopSpotDrag = (event: PointerEvent<SVGElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setIsDraggingSpot(false);
    setShowSpotInfo(false);
  };

  return {
    isDraggingSpot,
    showSpotInfo,
    startSpotDrag,
    moveSpotDrag,
    stopSpotDrag,
    showSpotTooltip: () => setShowSpotInfo(true),
    hideSpotTooltip: () => {
      if (!isDraggingSpot) setShowSpotInfo(false);
    },
  };
}
