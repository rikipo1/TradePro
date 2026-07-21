#!/usr/bin/env node
/* [E3-6] Generator golden testów: pełne `out` computeSignal dla 3 syntetycznych
   serii, zapisane do test/golden/*.json PRZED refaktorem. Po refaktorze
   test/golden.test.js wymaga identyczności 1:1 (reasons porównywane bez
   kolejności). Uruchamiaj TYLKO świadomie: node scripts/genGolden.js */

import fs from 'node:fs';
import path from 'node:path';
import { computeSignal } from '../src/signals/engine.js';
import { detectCandlePatterns } from '../src/patterns/index.js';
import { findSRZones } from '../src/indicators/index.js';
import { mulberry32, packFor } from '../test/_synth.js';

function trendCandles(n, seed, t0 = 1700000000) {
  const rnd = mulberry32(seed);
  const out = []; let px = 100; let dir = 1; let left = 0;
  for (let i = 0; i < n; i++) {
    if (left <= 0) { dir = rnd() < 0.5 ? 1 : -1; left = 40 + Math.floor(rnd() * 60); }
    left--;
    const drift = dir * 0.25 * (0.5 + rnd());
    const noise = (rnd() - 0.5) * 0.8;
    const o = px, c = px + drift + noise;
    const h = Math.max(o, c) + rnd() * 0.5, l = Math.min(o, c) - rnd() * 0.5;
    out.push({ t: t0 + i * 300, o, h, l, c, v: 1000 + Math.round(rnd() * 500) });
    px = c;
  }
  return out;
}

export const GOLDEN_SERIES = [
  { name: 'crypto-trend', seed: 11, sym: 'BTC-USD', srExtra: {} },
  { name: 'index-htf', seed: 42, sym: '^GDAXI', srExtra: { __htf: { dir: 1, label: 'M15' } } },
  { name: 'index-weights', seed: 77, sym: '^GSPC', srExtra: { __reliable: true, __weights: { bias: 0.2, trend: 0.9, momentum: 0.3, location: 0.5, liquidity: 0.4, confirmation: 0.6, htf: 0.3 }, __payout: { eWin: 1.6, pBE: 0.25, eBE: 0.03, pTO: 0.1, eTO: -0.2 } } },
];

export function goldenOutputs(series) {
  const candles = trendCandles(900, series.seed);
  const pack = packFor(candles);
  const patsWrap = { list: detectCandlePatterns(candles, pack.emaData[20], pack.ind.atr, pack.hasVol) };
  const outs = {};
  for (let i = 80; i < candles.length - 1; i += 37) {
    const zones = findSRZones(candles.slice(0, i + 1), pack.ind.atr[i]);
    zones.__sym = series.sym;
    zones.__minScore = 30;
    Object.assign(zones, series.srExtra);
    const s = computeSignal(candles, pack.ind, pack.emaData, patsWrap, pack.hasVol, i, zones);
    outs[i] = s ? JSON.parse(JSON.stringify(s)) : null;
  }
  return outs;
}

const dir = path.join(process.cwd(), 'test', 'golden');
if (import.meta.url === 'file://' + process.argv[1]) {
  fs.mkdirSync(dir, { recursive: true });
  for (const s of GOLDEN_SERIES) {
    const outs = goldenOutputs(s);
    fs.writeFileSync(path.join(dir, 'golden-' + s.name + '.json'), JSON.stringify(outs, null, 1));
    console.log('golden-' + s.name + '.json:', Object.keys(outs).length, 'indeksów,',
      Object.values(outs).filter(o => o && o.dir !== 0).length, 'aktywnych sygnałów');
  }
}
