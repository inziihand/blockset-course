import { Fragment } from 'react';
import { Trash2 } from 'lucide-react';
import type { PositionRow, StrikeSettings } from '../types';
import { formatPrice } from '../shared/utils/format';
import InputCell from './InputCell';
import InfoPopover from './InfoPopover';
import NumberInputStepper from './NumberInputStepper';

function PositionMatrix({
  rows,
  setRows,
  underlyingQty,
  onUnderlyingQtyChange,
  strikeSettings,
  onStrikeSettingsChange,
  onClearPositions,
}: {
  rows: PositionRow[];
  setRows: React.Dispatch<React.SetStateAction<PositionRow[]>>;
  underlyingQty: number;
  onUnderlyingQtyChange: (value: number) => void;
  strikeSettings: StrikeSettings;
  onStrikeSettingsChange: (patch: Partial<StrikeSettings>) => void;
  onClearPositions: () => void;
}) {
  const updateRow = (index: number, patch: Partial<PositionRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const markerIndex = rows.findIndex((row) => strikeSettings.initialSpot <= row.strike);
  const shouldRenderMarkerAfterRows = markerIndex === -1;

  const renderSpotMarker = () => (
    <div
      className={`spot-marker-row spot-position-row ${underlyingQty > 0 ? 'is-long' : underlyingQty < 0 ? 'is-short' : 'is-flat'}`}
      role="row"
      aria-label="標的部位"
    >
      <div className="spot-position-copy">
        <b>標的 S = {formatPrice(strikeSettings.initialSpot)}</b>
      </div>
      <NumberInputStepper
        value={underlyingQty}
        min={-10_000}
        max={10_000}
        step={1}
        precision={0}
        ariaLabel="標的部位數量"
        onChange={onUnderlyingQtyChange}
      />
      <span className="spot-position-delta">部位 Δ <b>{underlyingQty > 0 ? '+' : ''}{underlyingQty}</b></span>
    </div>
  );

  return (
    <section className="card matrix-card">
      <div className="card-header matrix-header">
        <div className="matrix-title-group">
          <h2>部位輸入 <InfoPopover text="正數＝買進，負數＝賣出" /></h2>
        </div>
        <button
          type="button"
          className="text-button matrix-clear-button"
          aria-label="清除所有部位"
          disabled={underlyingQty === 0 && rows.every((row) => row.callQty === 0 && row.putQty === 0)}
          onClick={onClearPositions}
        >
          <Trash2 size={15} aria-hidden="true" />清除
        </button>
      </div>

      <div className="strike-controls">
        <label>
          <span>初始標的價格</span>
          <NumberInputStepper
            value={strikeSettings.initialSpot}
            min={0.01}
            max={1_000_000}
            step={1}
            precision={2}
            ariaLabel="初始標的價格"
            revealControlsOnInteraction
            trimTrailingZeros
            onChange={(value) => onStrikeSettingsChange({ initialSpot: value })}
          />
        </label>
        <label>
          <span>履約價間距</span>
          <NumberInputStepper
            value={strikeSettings.strikeStep}
            min={0.01}
            max={1_000_000}
            step={0.5}
            precision={2}
            ariaLabel="履約價間距"
            revealControlsOnInteraction
            trimTrailingZeros
            onChange={(value) => onStrikeSettingsChange({ strikeStep: value })}
          />
        </label>
      </div>

      <div className="matrix-head">
        <span>#</span>
        <span>Call 數量</span>
        <span>履約價 K</span>
        <span>Put 數量</span>
      </div>

      <div className="matrix-body">
        {rows.flatMap((row, index) => {
          const rowCells = [
            <Fragment key={`${row.strike}-${index}`}>
              <div className="row-index">{index + 1}</div>
              <InputCell ariaLabel={`第 ${index + 1} 列 Call 數量`} value={row.callQty} onChange={(v) => updateRow(index, { callQty: v })} />
              <InputCell ariaLabel={`第 ${index + 1} 列履約價`} value={row.strike} readonly />
              <InputCell ariaLabel={`第 ${index + 1} 列 Put 數量`} className="matrix-row-end" value={row.putQty} onChange={(v) => updateRow(index, { putQty: v })} />
            </Fragment>,
          ];

          if (index === markerIndex) return [<Fragment key="spot-marker-before">{renderSpotMarker()}</Fragment>, ...rowCells];
          return rowCells;
        })}
        {shouldRenderMarkerAfterRows ? renderSpotMarker() : null}
      </div>
    </section>
  );
}

export { PositionMatrix };
export default PositionMatrix;
