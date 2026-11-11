import type { Greeks } from '../types';
import { fmt } from '../shared/utils/format';

type StrategyTooltipProps = {
  spotText: string;
  greeks: Greeks;
  currentPnl: number;
};

export default function StrategyTooltip({ spotText, greeks, currentPnl }: StrategyTooltipProps) {
  return (
    <div className="tooltip-card">
      <b>目前 S = {spotText}</b>
      <span>策略價格 <em className={greeks.price >= 0 ? 'positive' : 'negative'}>{fmt(greeks.price)}</em></span>
      <span>目前損益 <em className={currentPnl >= 0 ? 'positive' : 'negative'}>{fmt(currentPnl)}</em></span>
      <span>Delta <em className={greeks.delta >= 0 ? 'positive' : 'negative'}>{fmt(greeks.delta, 3)}</em></span>
      <span>Gamma <em className={greeks.gamma >= 0 ? 'positive' : 'negative'}>{fmt(greeks.gamma, 4)}</em></span>
      <span>Theta <em className={greeks.theta >= 0 ? 'positive' : 'negative'}>{fmt(greeks.theta)}</em></span>
      <span>Vega <em className={greeks.vega >= 0 ? 'positive' : 'negative'}>{fmt(greeks.vega)}</em></span>
      <span>Rho <em className={greeks.rho >= 0 ? 'positive' : 'negative'}>{fmt(greeks.rho)}</em></span>
    </div>
  );
}
