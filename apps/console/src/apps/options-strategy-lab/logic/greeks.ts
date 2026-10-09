import type { Greeks, ModelParams, PositionRow } from '../types';
import { blackScholes } from './blackScholes';
import { expiryPayoff } from './payoff';

function addWeighted(base: Greeks, g: Greeks, qty: number) {
  base.price += g.price * qty;
  base.delta += g.delta * qty;
  base.gamma += g.gamma * qty;
  base.theta += g.theta * qty;
  base.vega += g.vega * qty;
  base.rho += g.rho * qty;
  base.intrinsic += g.intrinsic * qty;
  base.timeValue += g.timeValue * qty;
}

export function aggregate(rows: PositionRow[], params: ModelParams, underlyingQty = 0, spotOverride?: number): Greeks {
  const s = spotOverride ?? params.spot;
  const t = params.days / 365;
  const underlyingValue = underlyingQty * s;
  const base: Greeks = {
    price: underlyingValue,
    delta: underlyingQty,
    gamma: 0,
    theta: 0,
    vega: 0,
    rho: 0,
    intrinsic: underlyingValue,
    timeValue: 0,
  };

  if (params.days <= 0) {
    const payoff = expiryPayoff(rows, s, underlyingQty);
    return { ...base, price: payoff, intrinsic: payoff, timeValue: 0 };
  }

  for (const row of rows) {
    if (row.callQty !== 0) {
      const g = blackScholes('call', s, row.strike, t, params.carryRate, params.iv, 0);
      addWeighted(base, g, row.callQty);
    }
    if (row.putQty !== 0) {
      const g = blackScholes('put', s, row.strike, t, params.carryRate, params.iv, 0);
      addWeighted(base, g, row.putQty);
    }
  }
  base.timeValue = base.price - base.intrinsic;
  return base;
}
