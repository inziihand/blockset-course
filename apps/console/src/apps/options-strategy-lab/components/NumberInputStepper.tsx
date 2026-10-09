import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cx } from '../shared/utils/format';

type NumberInputStepperProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  ariaLabel: string;
  className?: string;
  revealControlsOnInteraction?: boolean;
  trimTrailingZeros?: boolean;
  onChange: (value: number) => void;
};

function NumberInputStepper({
  value,
  min,
  max,
  step,
  precision = 2,
  ariaLabel,
  className,
  revealControlsOnInteraction = false,
  trimTrailingZeros = false,
  onChange,
}: NumberInputStepperProps) {
  const clamp = (nextValue: number) => Math.min(max, Math.max(min, nextValue));
  const normalize = (nextValue: number) => Number(clamp(nextValue).toFixed(precision));
  const format = (nextValue: number) => trimTrailingZeros
    ? String(Number(nextValue.toFixed(precision)))
    : nextValue.toFixed(precision);
  const [draft, setDraft] = useState(() => format(value));

  useEffect(() => {
    if (Number(draft) !== value) setDraft(format(value));
  }, [value, precision, trimTrailingZeros]);

  const commit = (nextValue: number) => {
    const normalized = normalize(nextValue);
    setDraft(format(normalized));
    onChange(normalized);
  };

  const updateByStep = (direction: -1 | 1) => commit(value + direction * step);

  return (
    <div className={cx(
      'number-input-stepper',
      revealControlsOnInteraction && 'number-input-stepper--hover',
      className,
    )}>
      <button
        type="button"
        aria-label={`降低${ariaLabel}`}
        disabled={value <= min}
        onClick={() => updateByStep(-1)}
      >
        <Minus size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={ariaLabel}
        onChange={(event) => {
          const nextDraft = event.target.value;
          const nextValue = Number(nextDraft);
          setDraft(nextDraft);
          if (nextDraft !== '' && Number.isFinite(nextValue)) onChange(normalize(nextValue));
        }}
        onBlur={() => {
          const nextValue = Number(draft);
          if (draft === '' || !Number.isFinite(nextValue)) setDraft(format(value));
          else commit(nextValue);
        }}
      />
      <button
        type="button"
        aria-label={`提高${ariaLabel}`}
        disabled={value >= max}
        onClick={() => updateByStep(1)}
      >
        <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}

export default NumberInputStepper;
