import { describe, it, expect } from 'vitest';
import { percentile, medIqr, purgeSamples, walkForwardKFold } from '../src/backtest/engine.js';
import { indicatorsFor } from '../src/signals/engine.js';

describe('[C2] percentile / medIqr — mediana i IQR', () => {
  it('percentyle na znanej tablicy', () => {
    const a = [1, 2, 3, 4, 5];
    expect(percentile(a, 0.5)).toBe(3);
    expect(percentile(a, 0.25)).toBe(2);
    expect(percentile(a, 0.75)).toBe(4);
  });
  it('medIqr zwraca med/p25/p75', () => {
    const r = medIqr([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(r.med).toBe(0.3);
    expect(r.p25).toBe(0.2);
    expect(r.p75).toBe(0.4);
    expect(r.n).toBe(5);
  });
  it('medIqr ignoruje null/NaN', () => {
    expect(medIqr([null, NaN, 1, 3]).med).toBe(2);
  });
});

describe('[C2] purgeSamples — embargo + purging', () => {
  const S = [
    { i0: 0, i1: 10 },   // przed testem, nie nachodzi → OK
    { i0: 40, i1: 55 },  // MOSTKUJE split (i1 w oknie testu) → wykluczona
    { i0: 60, i1: 80 },  // wewnątrz okna testu → wykluczona
    { i0: 20, i1: 49 },  // kończy się tuż przed testStart=50, nie nachodzi → OK
    { i0: 48, i1: 70 },  // nachodzi na test → wykluczona
  ];
  it('próbka nachodząca na blok testowy NIE trafia do treningu', () => {
    const testStart = 50, testEnd = 90;
    const kept = purgeSamples(S, testStart, testEnd);
    expect(kept).toEqual([{ i0: 0, i1: 10 }, { i0: 20, i1: 49 }]);
    // żadna zachowana próbka nie nachodzi na [50,90]
    for (const s of kept) expect(s.i1 < testStart).toBe(true);
  });
});

/* buduje syntetyczne świece: trend + szum, z timestampem i wolumenem */
function synthCandles(n) {
  const out = [];
  let px = 100, t = 1_700_000_000;
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    const trend = Math.sin(i / 25) * 3;          // fale
    const drift = (rnd() - 0.5) * 1.2 + trend * 0.02;
    const o = px, c = px + drift;
    const h = Math.max(o, c) + rnd() * 0.8;
    const l = Math.min(o, c) - rnd() * 0.8;
    const v = 1000 + Math.floor(rnd() * 500);
    out.push({ t: t + i * 300, o, h, l, c, v });
    px = c;
  }
  return out;
}

describe('[C2] walkForwardKFold zwraca K folds i agregację', () => {
  it('K=5 → folds.length===5, agg i totalNoos zdefiniowane (deterministyczne)', () => {
    const candles = synthCandles(400);
    const pack = indicatorsFor(candles, 'M5');
    const kf = walkForwardKFold(candles, pack.ind, pack.emaData, pack.hasVol, 'TEST', 30, null, 'M5', { K: 5 });
    expect(kf.ok).toBe(true);
    expect(kf.K).toBe(5);
    expect(kf.folds.length).toBe(5);
    expect(typeof kf.totalNoos).toBe('number');
    expect(kf.agg).toHaveProperty('avgR');
    expect(kf.agg).toHaveProperty('brier');
    expect(typeof kf.reliable).toBe('boolean');
  });

  it('za mało danych → ok:false', () => {
    const candles = synthCandles(100);
    const pack = indicatorsFor(candles, 'M5');
    const kf = walkForwardKFold(candles, pack.ind, pack.emaData, pack.hasVol, 'TEST', 30, null, 'M5', { K: 5 });
    expect(kf.ok).toBe(false);
  });
});
