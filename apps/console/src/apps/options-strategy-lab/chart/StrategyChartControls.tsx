import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAppEffect as useEffect } from '../../../shared/lifecycle/AppActivity';
import { Check, ChevronDown } from 'lucide-react';
import CurveSelector, { type CurveSelectorOption } from '../shared/controls/CurveSelector';
import { cx } from '../shared/utils/format';
import { isGreekMode } from '../logic/chartData';
import type { ChartMode, ChartScaleMode } from '../types';
import { isCourseChartMode } from '../courseAccess';
import { strategyChartModes } from './strategySeries';

const chartScaleModes: Array<{ key: ChartScaleMode; label: string }> = [
  { key: 'auto', label: '自動' },
  { key: 'raw', label: '原始值' },
  { key: 'normalized', label: '標準化' },
];

type StrategyChartControlsProps = {
  modes: ChartMode[];
  setModes: Dispatch<SetStateAction<ChartMode[]>>;
  scaleMode: ChartScaleMode;
  setScaleMode: (mode: ChartScaleMode) => void;
  isExpired: boolean;
  hasCourseAccess: boolean;
  onRequireCourseAccess: (feature: string) => void;
};

export default function StrategyChartControls({ modes, setModes, scaleMode, setScaleMode, isExpired, hasCourseAccess, onRequireCourseAccess }: StrategyChartControlsProps) {
  const [curveMenuOpen, setCurveMenuOpen] = useState(false);
  const [scaleMenuOpen, setScaleMenuOpen] = useState(false);
  const scaleMenuRef = useRef<HTMLDivElement | null>(null);
  const currentScaleMode = chartScaleModes.find((option) => option.key === scaleMode) ?? chartScaleModes[0];

  useEffect(() => {
    if (!scaleMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !scaleMenuRef.current?.contains(target)) setScaleMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setScaleMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [scaleMenuOpen]);

  const toggleMode = (nextMode: ChartMode) => {
    if (!hasCourseAccess && isCourseChartMode(nextMode)) {
      const definition = strategyChartModes.find((mode) => mode.key === nextMode);
      onRequireCourseAccess(`${definition?.label ?? nextMode} 曲線`);
      return;
    }

    setModes((previous) => {
      if (!hasCourseAccess) return [nextMode];
      if (previous.includes(nextMode)) {
        return previous.length === 1 ? previous : previous.filter((item) => item !== nextMode);
      }
      return strategyChartModes.map((item) => item.key).filter((item) => previous.includes(item) || item === nextMode);
    });
  };

  const curveOptions: CurveSelectorOption<ChartMode>[] = strategyChartModes.map((mode) => {
    const disabled = isExpired && isGreekMode(mode.key);
    const locked = !hasCourseAccess && isCourseChartMode(mode.key);
    return {
      key: mode.key,
      label: mode.label,
      disabled,
      locked,
      ariaLabel: `${mode.label}${locked ? '，課程學員功能' : ''}`,
      title: disabled
        ? '到期日已到，Greeks 不再以 Black-Scholes 模型顯示'
        : modes.includes(mode.key) && modes.length === 1
          ? '至少保留一條曲線'
          : undefined,
    };
  });

  return (
    <div className="chart-header-controls">
      <CurveSelector
        options={curveOptions}
        selectedKeys={modes}
        onToggle={toggleMode}
        open={curveMenuOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setScaleMenuOpen(false);
          setCurveMenuOpen(nextOpen);
        }}
      />
      <div className="chart-scale-control">
        <span>刻度</span>
        <div className="chart-scale-menu" ref={scaleMenuRef}>
          <button
            type="button"
            className={cx('chart-scale-menu-trigger', scaleMenuOpen && 'active')}
            aria-label="刻度模式"
            aria-haspopup="menu"
            aria-expanded={scaleMenuOpen}
            onClick={() => {
              setCurveMenuOpen(false);
              setScaleMenuOpen((previous) => !previous);
            }}
          >
            <span>{currentScaleMode.label}</span>
            <ChevronDown size={14} strokeWidth={2} />
          </button>
          {scaleMenuOpen ? (
            <div className="tool-menu-panel chart-scale-menu-panel" role="menu" aria-label="刻度模式">
              {chartScaleModes.map((option) => {
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={scaleMode === option.key}
                    aria-label={option.label}
                    className={cx(scaleMode === option.key && 'selected')}
                    onClick={() => {
                      setScaleMenuOpen(false);
                      setScaleMode(option.key);
                    }}
                  >
                    <span className="chart-scale-menu-check">
                      {scaleMode === option.key ? <Check size={14} strokeWidth={2.4} /> : null}
                    </span>
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
