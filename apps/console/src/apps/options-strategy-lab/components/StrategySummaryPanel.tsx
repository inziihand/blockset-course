import { ArrowRight } from 'lucide-react';
import type { Greeks, PositionRow } from '../types';
import { fmt } from '../shared/utils/format';

function StrategySummaryPanel({
  greeks,
  rows,
  underlyingQty,
  entryCost,
  onUseStrategyPrice,
}: {
  greeks: Greeks;
  rows: PositionRow[];
  underlyingQty: number;
  entryCost: number;
  onUseStrategyPrice: () => void;
}) {
  const activeLegs = rows.flatMap((row) => [
    row.callQty !== 0 ? { type: 'Call', strike: row.strike, qty: row.callQty } : null,
    row.putQty !== 0 ? { type: 'Put', strike: row.strike, qty: row.putQty } : null,
  ]).filter(Boolean) as Array<{ type: string; strike: number; qty: number }>;
  const activeLegCount = activeLegs.length + (underlyingQty === 0 ? 0 : 1);

  const unrealizedPnl = greeks.price - entryCost;
  const metrics = [
    { label: '策略價格', value: fmt(greeks.price) },
    { label: '建倉成本', value: fmt(entryCost) },
    { label: '目前損益', value: fmt(unrealizedPnl) },
    { label: 'Delta', value: fmt(greeks.delta, 3) },
    { label: 'Gamma', value: fmt(greeks.gamma, 4) },
    { label: 'Theta / 日', value: fmt(greeks.theta) },
    { label: 'Vega', value: fmt(greeks.vega) },
    { label: 'Rho', value: fmt(greeks.rho) },
  ];

  return (
    <section className="card summary-panel compact-summary-panel">
      <div className="summary-header compact-summary-header">
        <h2>策略總資訊</h2>
      </div>

      <div className="summary-metrics" aria-label="Strategy summary metrics">
        {metrics.map((item) => {
          const n = Number(item.value.replace(/[+,]/g, ''));
          const isStrategyPrice = item.label === '策略價格';
          return (
            <div className={`summary-metric${isStrategyPrice ? ' strategy-price-metric' : ''}`} key={item.label}>
              <span>{item.label}</span>
              <b className={n >= 0 ? 'positive' : 'negative'}>{item.value}</b>
              {isStrategyPrice ? (
                <button
                  type="button"
                  className="summary-use-price-button"
                  onClick={onUseStrategyPrice}
                  disabled={activeLegCount === 0}
                  aria-label={`將策略價格 ${item.value} 設為建倉成本`}
                  title="將策略價格設為建倉成本"
                >
                  <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="legs-strip compact-legs-strip" aria-label="Active option legs">
        <span className="position-count">部位 {activeLegCount} 腿</span>
        {activeLegCount === 0 ? (
          <span className="empty-leg">尚未建立部位</span>
        ) : (
          <>
            {underlyingQty !== 0 ? (
              <span className={`option-chip underlying-chip ${underlyingQty > 0 ? 'long-leg' : 'short-leg'}`}>
                <b>{underlyingQty > 0 ? '+' : ''}{underlyingQty}</b> S
              </span>
            ) : null}
            {activeLegs.map((leg) => {
              const isCall = leg.type === 'Call';
              const sideClass = leg.qty > 0 ? 'long-leg' : 'short-leg';
              return (
                <span
                  key={`${leg.type}-${leg.strike}-${leg.qty}`}
                  className={`option-chip ${isCall ? 'call-chip' : 'put-chip'} ${sideClass}`}
                >
                  <b>{leg.qty > 0 ? '+' : ''}{leg.qty}</b> {isCall ? 'C' : 'P'}{leg.strike}
                </span>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

export default StrategySummaryPanel;
