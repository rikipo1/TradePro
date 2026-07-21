/* Pomocnicze generatory danych syntetycznych do testów (deterministyczne). */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Seria świec OHLCV: trend sinusoidalny + szum, deterministyczna po seedzie.
   opts: { start=100, drift=0.02, wave=6, noise=0.6, vol=true, t0, stepSec=300 } */
export function synthCandles(n, opts = {}) {
  const rnd = mulberry32(opts.seed != null ? opts.seed : 42);
  const start = opts.start != null ? opts.start : 100;
  const drift = opts.drift != null ? opts.drift : 0.02;
  const wave = opts.wave != null ? opts.wave : 6;
  const noise = opts.noise != null ? opts.noise : 0.6;
  const stepSec = opts.stepSec != null ? opts.stepSec : 300;
  const t0 = opts.t0 != null ? opts.t0 : 1700000000;
  const out = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const base = px + drift + Math.sin(i / 9) * (wave / 10) + (rnd() - 0.5) * noise;
    const o = px;
    const c = base;
    const h = Math.max(o, c) + rnd() * noise * 0.7;
    const l = Math.min(o, c) - rnd() * noise * 0.7;
    out.push({ t: t0 + i * stepSec, o, h, l, c, v: opts.vol === false ? 0 : Math.round(1000 + rnd() * 500) });
    px = c;
  }
  return out;
}

/* Pełny pakiet wskaźników jak w aplikacji (używa realnych modułów). */
import { EMA_DEFS, adxSeries, atrSeries, bollSeries, emaSeries, findSRZones, macdSeries, obvSeries, rsiSeries, stochSeries, vwapSeries } from '../src/indicators/index.js';

export function packFor(candles, tfId = 'M5') {
  const closes = candles.map(c => c.c);
  const hasVol = candles.some(c => c.v > 0);
  const atr = atrSeries(candles, 14);
  let atrLast = null;
  for (let i = atr.length - 1; i >= 0; i--) { if (atr[i] != null) { atrLast = atr[i]; break; } }
  const ind = {
    rsi: rsiSeries(closes, 14),
    macd: macdSeries(closes, 12, 26, 9),
    boll: bollSeries(closes, 20, 2),
    stoch: stochSeries(candles, 14, 3, 3),
    adx: adxSeries(candles, 14),
    atr,
    obv: hasVol ? obvSeries(candles) : null,
    vwap: (hasVol && tfId !== 'D1') ? vwapSeries(candles) : null,
    sr: findSRZones(candles, atrLast),
  };
  const emaData = {};
  for (let i = 0; i < EMA_DEFS.length; i++) emaData[EMA_DEFS[i].n] = emaSeries(closes, EMA_DEFS[i].n);
  return { ind, emaData, hasVol };
}
