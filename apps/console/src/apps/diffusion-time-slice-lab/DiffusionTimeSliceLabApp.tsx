import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Activity, ArrowLeftRight, ArrowUpDown, Captions, CaptionsOff, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { ShellAppProps } from '../../shell/types';
import { AppHeaderActions } from '../../shared/ui/AppHeaderActions';
import { AppInfoBar } from '../../shared/ui/AppInfoBar';
import { Button } from '../../shared/ui/controls';
import DiffusionViewport, { TimeDirectionLabel } from './DiffusionViewport';
import {
  DEFAULT_DIFFUSION_LAB_STATE,
  type DiffusionLabState,
} from './diffusionModel';
import './diffusion-time-slice-lab.css';

const FLOW_STAGE_STOPS = [0, 21, 54, 68, 83, 100] as const;
const FLOW_STAGE_PLAYBACK_MS = 1100;
const FLOW_STAGE_HOLD_MS = 1600;
type FlowPlaybackMode = 'idle' | 'step' | 'continuous';

function RangeControl({
  id,
  label,
  value,
  displayValue,
  minimumLabel,
  maximumLabel,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  minimumLabel: string;
  maximumLabel: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="diffusion-range-control">
      <div className="diffusion-range-heading">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{displayValue}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="diffusion-range-scale" aria-hidden="true">
        <span>{minimumLabel}</span>
        <span>{maximumLabel}</span>
      </div>
    </div>
  );
}

function LayerSwitch({
  id,
  label,
  checked,
  disabled = false,
  describedBy,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`diffusion-switch${disabled ? ' is-disabled' : ''}`} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
      <strong>{label}</strong>
    </label>
  );
}

function FlowControl({
  value,
  onChange,
  onReset,
  onTogglePlayback,
  onStep,
  showSubtitles,
  onToggleSubtitles,
  playbackMode,
}: {
  value: number;
  onChange: (value: number) => void;
  onReset: () => void;
  onTogglePlayback: () => void;
  onStep: () => void;
  showSubtitles: boolean;
  onToggleSubtitles: () => void;
  playbackMode: FlowPlaybackMode;
}) {
  const isAtEnd = value >= FLOW_STAGE_STOPS.at(-1)!;
  const isPlayingContinuously = playbackMode === 'continuous';

  return (
    <div className="diffusion-flow-control">
      <div className="diffusion-flow-runner">
        <div className="diffusion-flow-track">
          <input
            id="diffusion-flow-progress"
            aria-label="視角流程"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>
        <div className="diffusion-flow-actions">
          <button
            type="button"
            className="diffusion-flow-action-button"
            aria-label="返回重頭開始"
            title="返回重頭開始"
            disabled={value <= 0 && playbackMode === 'idle'}
            onClick={onReset}
          >
            <RotateCcw size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="diffusion-flow-action-button"
            aria-label={isPlayingContinuously ? '暫停' : '播放'}
            title={isPlayingContinuously ? '暫停' : '播放'}
            disabled={playbackMode === 'step' || (playbackMode === 'idle' && isAtEnd)}
            onClick={onTogglePlayback}
          >
            {isPlayingContinuously
              ? <Pause size={16} strokeWidth={1.8} aria-hidden="true" />
              : <Play size={16} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="diffusion-flow-action-button"
            aria-label="播放下一階段"
            title="播放下一階段"
            disabled={playbackMode !== 'idle' || isAtEnd}
            onClick={onStep}
          >
            <SkipForward size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="diffusion-flow-action-button"
            aria-label={showSubtitles ? '隱藏字幕' : '顯示字幕'}
            aria-pressed={showSubtitles}
            title={showSubtitles ? '隱藏字幕' : '顯示字幕'}
            onClick={onToggleSubtitles}
          >
            {showSubtitles
              ? <Captions size={17} strokeWidth={1.8} aria-hidden="true" />
              : <CaptionsOff size={17} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiffusionTimeSliceLabApp(_props: ShellAppProps) {
  const [state, setState] = useState<DiffusionLabState>(DEFAULT_DIFFUSION_LAB_STATE);
  const [panelsSwapped, setPanelsSwapped] = useState(false);
  const [useVerticalSwapIcon, setUseVerticalSwapIcon] = useState(false);
  const [flowPlaybackMode, setFlowPlaybackMode] = useState<FlowPlaybackMode>('idle');
  const [showSubtitles, setShowSubtitles] = useState(true);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const controlPanelRef = useRef<HTMLElement>(null);
  const viewportPanelRef = useRef<HTMLElement>(null);
  const flowPlaybackFrameRef = useRef<number | null>(null);
  const flowPlaybackPauseRef = useRef<number | null>(null);
  const patchState = (patch: Partial<DiffusionLabState>) => setState((current) => ({ ...current, ...patch }));
  const swapControlLabel = panelsSwapped
    ? useVerticalSwapIcon ? '還原上下區塊排列' : '還原左右欄排列'
    : useVerticalSwapIcon ? '上下區塊對調' : '左右欄對調';

  useEffect(() => {
    const updateSwapIconDirection = () => {
      const controlPanel = controlPanelRef.current?.getBoundingClientRect();
      const viewportPanel = viewportPanelRef.current?.getBoundingClientRect();
      if (!controlPanel?.width || !viewportPanel?.width) return;

      setUseVerticalSwapIcon(Math.abs(controlPanel.left - viewportPanel.left) < 1);
    };

    updateSwapIconDirection();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateSwapIconDirection);
    if (workspaceRef.current) resizeObserver?.observe(workspaceRef.current);
    if (viewportPanelRef.current) resizeObserver?.observe(viewportPanelRef.current);
    window.addEventListener('resize', updateSwapIconDirection);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateSwapIconDirection);
    };
  }, []);

  useEffect(() => () => {
    if (flowPlaybackFrameRef.current !== null) {
      window.cancelAnimationFrame(flowPlaybackFrameRef.current);
    }
    if (flowPlaybackPauseRef.current !== null) {
      window.clearTimeout(flowPlaybackPauseRef.current);
    }
  }, []);

  const swapPanels = () => {
    const panels = [controlPanelRef.current, viewportPanelRef.current].filter(
      (panel): panel is HTMLElement => panel !== null,
    );
    const previousBounds = panels.map((panel) => panel.getBoundingClientRect());

    flushSync(() => setPanelsSwapped((value) => !value));
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    window.requestAnimationFrame(() => {
      panels.forEach((panel, index) => {
        const previous = previousBounds[index];
        const current = panel.getBoundingClientRect();
        const deltaX = previous.left - current.left;
        const deltaY = previous.top - current.top;
        if ((Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1)
          || typeof panel.animate !== 'function') return;

        panel.animate([
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)`, opacity: 0.72 },
          { transform: 'translate3d(0, 0, 0)', opacity: 1 },
        ], {
          duration: 320,
          easing: 'cubic-bezier(.22, 1, .36, 1)',
        });
      });
    });
  };

  const cancelFlowPlayback = () => {
    if (flowPlaybackFrameRef.current !== null) {
      window.cancelAnimationFrame(flowPlaybackFrameRef.current);
      flowPlaybackFrameRef.current = null;
    }
    if (flowPlaybackPauseRef.current !== null) {
      window.clearTimeout(flowPlaybackPauseRef.current);
      flowPlaybackPauseRef.current = null;
    }
    setFlowPlaybackMode('idle');
  };

  const changeFlowProgress = (flowProgress: number) => {
    cancelFlowPlayback();
    patchState({ flowProgress });
  };

  const playFlowSequence = (mode: Exclude<FlowPlaybackMode, 'idle'>) => {
    if (flowPlaybackMode !== 'idle') return;
    const remainingStops = FLOW_STAGE_STOPS.filter((stop) => stop > state.flowProgress);
    const targets = mode === 'continuous' ? remainingStops : remainingStops.slice(0, 1);
    if (targets.length === 0) return;
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      patchState({ flowProgress: targets.at(-1)! });
      return;
    }

    setFlowPlaybackMode(mode);

    const holdThen = (next: () => void) => {
      flowPlaybackPauseRef.current = window.setTimeout(() => {
        flowPlaybackPauseRef.current = null;
        next();
      }, FLOW_STAGE_HOLD_MS);
    };

    const playTarget = (targetIndex: number, startProgress: number) => {
      const nextStop = targets[targetIndex];
      const startTime = performance.now();
      const playFrame = (now: number) => {
        const elapsed = Math.min(1, (now - startTime) / FLOW_STAGE_PLAYBACK_MS);
        const eased = elapsed < 0.5
          ? 4 * elapsed ** 3
          : 1 - ((-2 * elapsed + 2) ** 3) / 2;
        const flowProgress = Math.round(startProgress + (nextStop - startProgress) * eased);
        patchState({ flowProgress });

        if (elapsed < 1) {
          flowPlaybackFrameRef.current = window.requestAnimationFrame(playFrame);
          return;
        }
        if (targetIndex < targets.length - 1) {
          holdThen(() => playTarget(targetIndex + 1, nextStop));
          return;
        }
        flowPlaybackFrameRef.current = null;
        setFlowPlaybackMode('idle');
      };

      flowPlaybackFrameRef.current = window.requestAnimationFrame(playFrame);
    };

    if (mode === 'continuous' && FLOW_STAGE_STOPS.some((stop) => stop === state.flowProgress)) {
      holdThen(() => playTarget(0, state.flowProgress));
      return;
    }
    playTarget(0, state.flowProgress);
  };

  const resetFlow = () => {
    cancelFlowPlayback();
    patchState({ flowProgress: 0 });
  };

  const toggleContinuousPlayback = () => {
    if (flowPlaybackMode === 'continuous') {
      cancelFlowPlayback();
      return;
    }
    playFlowSequence('continuous');
  };

  return (
    <>
      <AppHeaderActions className="diffusion-header-actions">
        <button
          type="button"
          className={`diffusion-panel-swap-button${useVerticalSwapIcon ? ' is-vertical' : ''}`}
          aria-label={swapControlLabel}
          aria-pressed={panelsSwapped}
          title={swapControlLabel}
          onClick={swapPanels}
        >
          <ArrowLeftRight className="diffusion-panel-swap-icon diffusion-panel-swap-icon-horizontal" size={15} strokeWidth={2} aria-hidden="true" />
          <ArrowUpDown className="diffusion-panel-swap-icon diffusion-panel-swap-icon-vertical" size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </AppHeaderActions>
      <AppInfoBar className="diffusion-lab-info" variant="brand">
        <Activity size={16} aria-hidden="true" />
        <h2>時間切片</h2>
        <p title="以不同時間切片觀察機率分布，並手動調整波動率比較分布變化。">
          以不同時間切片觀察機率分布，並手動調整波動率比較分布變化。
        </p>
      </AppInfoBar>
      <main className="diffusion-time-slice-lab">
        <div ref={workspaceRef} className={`diffusion-workspace${panelsSwapped ? ' panels-swapped' : ''}`}>
          <aside ref={controlPanelRef} className="diffusion-control-panel" aria-label="時間切片控制項">
          <section aria-labelledby="diffusion-direction-heading">
            <div className="diffusion-control-heading">
              <span>01</span>
              <h3 id="diffusion-direction-heading">時間方向</h3>
            </div>
            <div className="diffusion-direction-control">
              <Button
                className="diffusion-reverse-button"
                aria-label="切片前後對調"
                aria-pressed={state.timeDirection === 'remaining'}
                title="切片前後對調"
                onClick={() => patchState({
                  timeDirection: state.timeDirection === 'elapsed' ? 'remaining' : 'elapsed',
                })}
              >
                <span
                  key={state.timeDirection}
                  className="diffusion-reverse-symbol diffusion-time-symbol"
                  aria-hidden="true"
                >
                  {state.timeDirection === 'elapsed' ? 'T' : 'τ'}
                </span>
              </Button>
              <span className="diffusion-direction-mode" aria-live="polite"><TimeDirectionLabel direction={state.timeDirection} /></span>
            </div>
          </section>

          <section aria-labelledby="diffusion-layers-heading">
            <div className="diffusion-control-heading">
              <span>02</span>
              <h3 id="diffusion-layers-heading">圖層</h3>
            </div>
            <div className="diffusion-switches">
              <LayerSwitch
                id="diffusion-show-surface"
                label="覆蓋彩色曲面"
                checked={state.showSurface}
                describedBy="diffusion-surface-help"
                onChange={(showSurface) => patchState({ showSurface })}
              />
              <LayerSwitch
                id="diffusion-show-standard-deviation"
                label="顯示一個標準差"
                checked={state.showStandardDeviation}
                onChange={(showStandardDeviation) => patchState({ showStandardDeviation })}
              />
            </div>
            <p id="diffusion-surface-help" className="diffusion-control-help">
              曲面取樣所選期間的 20%–100%，避開接近到期的尖峰。
            </p>
          </section>

          <section aria-labelledby="diffusion-parameters-heading">
            <div className="diffusion-control-heading">
              <span>03</span>
              <h3 id="diffusion-parameters-heading">模型參數</h3>
            </div>
            <RangeControl
              id="diffusion-volatility"
              label="年化波動率 σ"
              value={state.annualVolatility}
              displayValue={`${(state.annualVolatility * 100).toFixed(0)}%`}
              minimumLabel="10%"
              maximumLabel="80%"
              min={0.1}
              max={0.8}
              step={0.01}
              onChange={(annualVolatility) => patchState({ annualVolatility })}
            />
          </section>
          </aside>

        <DiffusionViewport
          state={state}
          showSubtitles={showSubtitles}
          sectionRef={viewportPanelRef}
          flowControl={(
            <FlowControl
              value={state.flowProgress}
              onChange={changeFlowProgress}
              onReset={resetFlow}
              onTogglePlayback={toggleContinuousPlayback}
              onStep={() => playFlowSequence('step')}
              showSubtitles={showSubtitles}
              onToggleSubtitles={() => setShowSubtitles((visible) => !visible)}
              playbackMode={flowPlaybackMode}
            />
          )}
        />
        </div>
      </main>
    </>
  );
}
