import type { Greeks } from '../types';

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function blackScholes(type: 'call' | 'put', s: number, k: number, tYears: number, r: number, sigma: number, q: number): Greeks {
  const t = Math.max(tYears, 1 / 3650);
  const vol = Math.max(sigma, 0.0001);
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * vol * vol) * t) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const dfR = Math.exp(-r * t);
  const dfQ = Math.exp(-q * t);

  const callPrice = s * dfQ * normCdf(d1) - k * dfR * normCdf(d2);
  const putPrice = k * dfR * normCdf(-d2) - s * dfQ * normCdf(-d1);
  const price = type === 'call' ? callPrice : putPrice;

  const delta = type === 'call' ? dfQ * normCdf(d1) : dfQ * (normCdf(d1) - 1);
  const gamma = (dfQ * normPdf(d1)) / (s * vol * sqrtT);
  const thetaCall = (-(s * dfQ * normPdf(d1) * vol) / (2 * sqrtT) - r * k * dfR * normCdf(d2) + q * s * dfQ * normCdf(d1)) / 365;
  const thetaPut = (-(s * dfQ * normPdf(d1) * vol) / (2 * sqrtT) + r * k * dfR * normCdf(-d2) - q * s * dfQ * normCdf(-d1)) / 365;
  const vega = s * dfQ * normPdf(d1) * sqrtT * 0.01;
  const rhoCall = k * t * dfR * normCdf(d2) * 0.01;
  const rhoPut = -k * t * dfR * normCdf(-d2) * 0.01;
  const intrinsic = type === 'call' ? Math.max(s - k, 0) : Math.max(k - s, 0);

  return {
    price,
    delta,
    gamma,
    theta: type === 'call' ? thetaCall : thetaPut,
    vega,
    rho: type === 'call' ? rhoCall : rhoPut,
    intrinsic,
    timeValue: price - intrinsic,
  };
}

export function impliedVolatility({
  type,
  spot,
  strike,
  days,
  riskFreeRate,
  marketPrice,
}: {
  type: 'call' | 'put';
  spot: number;
  strike: number;
  days: number;
  riskFreeRate: number;
  marketPrice: number;
}): number | null {
  if (spot <= 0 || strike <= 0 || days <= 0 || marketPrice <= 0) return null;

  const tYears = days / 365;
  const theoretical = (iv: number) => blackScholes(type, spot, strike, tYears, riskFreeRate, iv, 0).price;
  let low = 0.0001;
  let high = 5;
  const lowPrice = theoretical(low);
  const highPrice = theoretical(high);

  if (marketPrice < lowPrice || marketPrice > highPrice) return null;

  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const price = theoretical(mid);
    if (price > marketPrice) high = mid;
    else low = mid;
  }

  return (low + high) / 2;
}
