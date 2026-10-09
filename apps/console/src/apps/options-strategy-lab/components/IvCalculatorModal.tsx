import { useMemo, useState } from 'react';
import { useAppEffect as useEffect, useAppActive } from '../../../shared/lifecycle/AppActivity';
import { createPortal } from 'react-dom';
import { portalHost } from '../portalHost';
import { X } from 'lucide-react';
import type { ModelParams, PositionRow } from '../types';
import { blackScholes, impliedVolatility } from '../logic/blackScholes';
import DatePickerButton from './DatePickerButton';
import NumberInputStepper from './NumberInputStepper';

function IvCalculatorModal({
  rows,
  params,
  onApplyIv,
  onClose,
}: {
  rows: PositionRow[];
  params: ModelParams;
  onApplyIv: (iv: number, days: number) => void;
  onClose: () => void;
}) {
  const nearestStrike = useMemo(() => {
    if (rows.length === 0) return Math.round(params.spot);
    return rows.reduce((best, row) => Math.abs(row.strike - params.spot) < Math.abs(best - params.spot) ? row.strike : best, rows[0].strike);
  }, [rows, params.spot]);
  const active = useAppActive();
  const [type, setType] = useState<'call' | 'put'>('call');
  const [spot, setSpot] = useState(params.spot);
  const [strike, setStrike] = useState(nearestStrike);
  const [riskFreeRatePercent, setRiskFreeRatePercent] = useState(() => Number((params.carryRate * 100).toFixed(2)));
  const [marketPrice, setMarketPrice] = useState(() => Number(blackScholes('call', params.spot, nearestStrike, Math.max(1, params.days) / 365, params.carryRate, params.iv, 0).price.toFixed(2)));
  const [ivDays, setIvDays] = useState(() => Math.max(1, params.days));
  const riskFreeRate = riskFreeRatePercent / 100;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const resultIv = useMemo(() => impliedVolatility({
    type,
    spot,
    strike,
    days: ivDays,
    riskFreeRate,
    marketPrice,
  }), [type, spot, strike, ivDays, riskFreeRate, marketPrice]);

  if (!active) return null;
  return createPortal(
    <div className="modal-backdrop" onPointerDown={onClose}>
      <section className="modal-card iv-modal" onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="IV 反推計算器">
        <div className="modal-header">
          <div>
            <h2>IV 反推計算器</h2>
            <p>用市場價格反推出隱含波動率</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="關閉 IV 反推計算器">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="iv-form-grid">
          <label>
            <span>類型</span>
            <select value={type} onChange={(event) => setType(event.target.value as 'call' | 'put')}>
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </label>
          <label>
            <span>標的價格 S</span>
            <input type="number" value={spot} step="0.01" onChange={(event) => setSpot(Number(event.target.value))} />
          </label>
          <label>
            <span>履約價 K</span>
            <input type="number" value={strike} step="0.01" onChange={(event) => setStrike(Number(event.target.value))} />
          </label>
          <label>
            <span>市場價格</span>
            <input type="number" value={marketPrice} step="0.01" min="0" onChange={(event) => setMarketPrice(Number(event.target.value))} />
          </label>
          <label className="iv-rate-field">
            <span>無風險利率 r（%）</span>
            <NumberInputStepper
              value={riskFreeRatePercent}
              min={-100}
              max={100}
              step={0.1}
              precision={2}
              ariaLabel="無風險利率 r（%）"
              onChange={setRiskFreeRatePercent}
            />
          </label>
          <label className="iv-days-control iv-days-field">
            <span>剩餘天數</span>
            <div className="iv-days-input-row">
              <input
                type="number"
                min="1"
                max="365"
                step="1"
                value={ivDays}
                onChange={(event) => setIvDays(Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1))))}
                aria-label="IV 反推剩餘天數"
              />
              <DatePickerButton days={ivDays} minDays={1} onChangeDays={setIvDays} ariaLabel="選擇 IV 反推到期日" size={14} />
            </div>
          </label>
        </div>

        <div className="iv-result-box">
          <span>反推 IV</span>
          {resultIv === null ? <b className="negative">無法反推</b> : <b>{(resultIv * 100).toFixed(2)}%</b>}
          <small>若市場價格低於內在價或超出模型可解範圍，結果會顯示無法反推。</small>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>關閉</button>
          <button
            type="button"
            className="primary-button"
            disabled={resultIv === null}
            onClick={() => {
              if (resultIv !== null) {
                onApplyIv(resultIv, ivDays);
                onClose();
              }
            }}
          >
            套用到模型參數
          </button>
        </div>
      </section>
    </div>,
    portalHost(),
  );
}

export default IvCalculatorModal;
