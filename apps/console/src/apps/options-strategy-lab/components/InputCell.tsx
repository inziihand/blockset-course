import { cx } from '../shared/utils/format';
import { Minus, Plus } from 'lucide-react';

function InputCell({
  value,
  onChange,
  readonly = false,
  className,
  ariaLabel = '數值',
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const toneClass = value > 0 ? 'positive' : value < 0 ? 'negative' : undefined;

  if (!readonly) {
    return (
      <div className={cx('input-cell', 'quantity-input-cell', className, toneClass)}>
        <input
          className="quantity-input-value"
          type="number"
          step="1"
          value={value}
          aria-label={ariaLabel}
          onChange={(event) => onChange?.(Number(event.target.value))}
        />
        <button
          type="button"
          className="quantity-step-button quantity-step-minus"
          aria-label={`降低${ariaLabel}`}
          onClick={() => onChange?.(value - 1)}
        >
          <Minus size={13} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="quantity-step-button quantity-step-plus"
          aria-label={`提高${ariaLabel}`}
          onClick={() => onChange?.(value + 1)}
        >
          <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <input
      className={cx('input-cell', className, toneClass, 'readonly')}
      type="number"
      value={value}
      aria-label={ariaLabel}
      readOnly
    />
  );
}

export default InputCell;
