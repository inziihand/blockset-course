import type { PositionRow, StrategyTemplateDefinition, StrategyTemplateKey } from '../types';

export const strategyTemplates: StrategyTemplateDefinition[] = [
  { key: 'longCall', label: '買進買權 Long Call', kind: 'template', access: 'course' },
  { key: 'longPut', label: '買進賣權 Long Put', kind: 'template', access: 'course' },
  { key: 'longStraddle', label: '買進跨式 Long Straddle', kind: 'template', access: 'course' },
  { key: 'longStrangle', label: '買進勒式 Long Strangle', kind: 'template', access: 'course' },
  { key: 'shortStrangle', label: '空頭勒式 Short Strangle', kind: 'template', access: 'course' },
  { key: 'bullCallSpread', label: '牛市買權價差 Bull Call Spread', kind: 'template', access: 'course' },
  { key: 'bearPutSpread', label: '熊市賣權價差 Bear Put Spread', kind: 'template', access: 'course' },
  { key: 'longButterfly', label: '買進蝶式 Long Call Butterfly', kind: 'template', access: 'course' },
  { key: 'ironCondor', label: '鐵兀鷹 Iron Condor', kind: 'template', access: 'course' },
];

export function templateRows(rows: PositionRow[], spot: number, template: StrategyTemplateKey): PositionRow[] {
  if (rows.length === 0) return rows;
  const sortedRows = [...rows].sort((a, b) => a.strike - b.strike);
  const atmIndex = sortedRows.reduce((bestIndex, row, index) => {
    const best = sortedRows[bestIndex];
    return Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? index : bestIndex;
  }, 0);

  const emptyRows = sortedRows.map((row) => ({ ...row, callQty: 0, putQty: 0 }));
  const applyLeg = (offset: number, type: 'call' | 'put', qty: number) => {
    const index = Math.max(0, Math.min(emptyRows.length - 1, atmIndex + offset));
    if (type === 'call') emptyRows[index].callQty += qty;
    else emptyRows[index].putQty += qty;
  };

  switch (template) {
    case 'longCall':
      applyLeg(0, 'call', 1);
      break;
    case 'longPut':
      applyLeg(0, 'put', 1);
      break;
    case 'longStraddle':
      applyLeg(0, 'call', 1);
      applyLeg(0, 'put', 1);
      break;
    case 'longStrangle':
      applyLeg(-2, 'put', 1);
      applyLeg(2, 'call', 1);
      break;
    case 'shortStrangle':
      applyLeg(-2, 'put', -1);
      applyLeg(2, 'call', -1);
      break;
    case 'bullCallSpread':
      applyLeg(0, 'call', 1);
      applyLeg(2, 'call', -1);
      break;
    case 'bearPutSpread':
      applyLeg(0, 'put', 1);
      applyLeg(-2, 'put', -1);
      break;
    case 'longButterfly':
      applyLeg(-1, 'call', 1);
      applyLeg(0, 'call', -2);
      applyLeg(1, 'call', 1);
      break;
    case 'ironCondor':
      applyLeg(-4, 'put', 1);
      applyLeg(-2, 'put', -1);
      applyLeg(2, 'call', -1);
      applyLeg(4, 'call', 1);
      break;
    default:
      break;
  }

  const byStrike = new Map(emptyRows.map((row) => [row.strike, row]));
  return rows.map((row) => byStrike.get(row.strike) ?? row);
}
