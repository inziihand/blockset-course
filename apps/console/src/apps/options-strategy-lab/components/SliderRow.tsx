import { Calculator } from 'lucide-react';
import InfoPopover from './InfoPopover';

function SliderRow({ label, value, min, max, step, suffix, onChange, helpText, onHelpClick, helpLabel, actions, showScale = true }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (v: number) => void; helpText?: string; onHelpClick?: () => void; helpLabel?: string; actions?: React.ReactNode; showScale?: boolean }) {
  return (
    <div className="slider-row">
      <div className="slider-label">
        <span>{label}</span>
        <span className="slider-label-actions">
          {onHelpClick ? (
            <button
              type="button"
              className="info-popover-trigger"
              aria-label={helpLabel ?? label}
              onClick={(event) => {
                event.stopPropagation();
                onHelpClick();
              }}
            >
              <Calculator size={15} strokeWidth={2} />
            </button>
          ) : (
            <InfoPopover text={helpText ?? label} />
          )}
          {actions}
        </span>
      </div>
      <div className="slider-line">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <div className="slider-value">{suffix === '%' ? (value * 100).toFixed(2) : value.toFixed(0)} {suffix}</div>
      </div>
      {showScale ? (
        <div className="slider-scale">
          <span>{suffix === '%' ? (min * 100).toFixed(0) : min}{suffix}</span>
          <span>{suffix === '%' ? (max * 100).toFixed(0) : max}{suffix}</span>
        </div>
      ) : null}
    </div>
  );
}

export default SliderRow;
