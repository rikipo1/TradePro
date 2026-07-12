import { describe, it, expect } from 'vitest';
import { computeSignal, indicatorsFor } from '../src/signals/engine.js';
import { detectPatterns } from '../src/patterns/index.js';
import { mergeSamples } from '../src/core/store.js';

function synthCandles(n) {
  const out = [];
  let px = 100, t = 1_700_000_000;
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    const drift = (rnd() - 0.45) * 1.2 + Math.sin(i / 20) * 0.4;
    const o = px, c = px + drift;
    const h = Math.max(o, c) + rnd() * 0.8;
    const l = Math.min(o, c) - rnd() * 0.8;
    out.push({ t: t + i * 300, o, h, l, c, v: 1000 + Math.floor(rnd() * 400) });
    px = c;
  }
  return out;
}

function sigWith(candles, srExtra) {
  const pack = indicatorsFor(candles, 'M5');
  const patRaw = detectPatterns(candles, pack.ind.atr, pack.emaData[20], pack.hasVol);
  const patterns = { list: patRaw.list };
  const sr = (pack.ind.sr || []).slice();
  Object.assign(sr, srExtra);
  return computeSignal(candles, pack.ind, pack.emaData, patterns, pack.hasVol, null, sr);
}

describe('[C3] reliable=false → tor decyzyjny używa DEFAULT_WEIGHTS', () => {
  const candles = synthCandles(220);
  // wagi „eksperymentalne" wyraźnie różne od DEFAULT
  const weird = { bias: 2, trend: 5, momentum: -5, location: 5, liquidity: 5, confirmation: 5, htf: 5 };

  it('z weird weights + reliable=false prob == prob dla braku wag (DEFAULT)', () => {
    const def = sigWith(candles, {});                                 // brak wag → DEFAULT
    const exp = sigWith(candles, { __weights: weird, __reliable: false }); // wagi ignorowane
    expect(exp.prob).toBe(def.prob);
    expect(exp.probCalibrated).toBe(false);
  });

  it('reliable=true → wagi/kalibracja mogą zmienić prob (nie ignorowane)', () => {
    const def = sigWith(candles, {});
    const rel = sigWith(candles, { __weights: weird, __reliable: true });
    // przy dir!=0 wagi wpływają na prob; jeśli dir==0 w obu, prob=0.5 — akceptujemy oba,
    // ale probCalibrated musi zależeć od obecności calib (tu brak calib → false)
    expect(rel.probCalibrated).toBe(false); // brak __calib
    if (def.dir !== 0 && rel.dir !== 0) expect(rel.prob).not.toBe(def.prob);
  });
});

describe('[C3] bufor próbek rośnie i deduplikuje (mergeSamples)', () => {
  it('dedup po ts+i0, cap FIFO', () => {
    const prior = [{ ts: 1, i0: 0, y: 1 }, { ts: 2, i0: 1, y: 0 }];
    const fresh = [
      { ts: 2, i0: 1, y: 0 }, // duplikat → pominięty
      { ts: 3, i0: 2, y: 1 }, // nowy
    ];
    const merged = mergeSamples(prior, fresh, 2000);
    expect(merged.length).toBe(3);
    expect(merged.map(s => s.ts)).toEqual([1, 2, 3]);
  });
  it('cap FIFO wyrzuca najstarsze', () => {
    const prior = Array.from({ length: 2000 }, (_, i) => ({ ts: i, i0: i }));
    const fresh = [{ ts: 9999, i0: 9999 }];
    const merged = mergeSamples(prior, fresh, 2000);
    expect(merged.length).toBe(2000);
    expect(merged[merged.length - 1].ts).toBe(9999);
    expect(merged[0].ts).toBe(1); // najstarszy (ts=0) wypadł
  });
});
