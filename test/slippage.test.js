import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backtestEngine } from '../src/backtest/engine.js';
import { computeSignal } from '../src/signals/engine.js';
import { detectCandlePatterns } from '../src/patterns/index.js';
import { findSRZones } from '../src/indicators/index.js';
import { mulberry32, packFor } from './_synth.js';

function trendCandles(n, seed = 11, t0 = 1700000000) {
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

function signalAt(candles, pack, i, sym, srExtra = {}) {
  const patsWrap = { list: detectCandlePatterns(candles, pack.emaData[20], pack.ind.atr, pack.hasVol) };
  const zones = findSRZones(candles.slice(0, i + 1), pack.ind.atr[i]);
  zones.__sym = sym;
  zones.__minScore = 30;
  Object.assign(zones, srExtra);
  return computeSignal(candles, pack.ind, pack.emaData, patsWrap, pack.hasVol, i, zones);
}

test('[E3-3] SL w backteście gorszy o poślizg (r < −1 dla każdego SL)', () => {
  let checked = 0;
  for (const seed of [1, 11, 42, 77]) {
    const candles = trendCandles(900, seed);
    const pack = packFor(candles);
    const bt = backtestEngine(candles, pack.ind, pack.emaData, pack.hasVol, 'BTC-USD', 30, null, { tfId: 'M5' });
    for (const t of bt.trades) {
      if (t.out === 'SL') {
        assert.ok(t.r < -1, 'SL musi być gorszy niż −1R (slip+koszt), było ' + t.r);
        checked++;
      }
    }
  }
  assert.ok(checked > 0, 'przynajmniej jeden SL w serii testowej');
});

/* jedna świeca aktywnego sygnału, dwa warianty czasu: w oknie makro i poza */
test('[E3-3] EV w oknie makro niższe (koszt ×4) i autoTradeBlock dla klasy makro', () => {
  const base = trendCandles(900, 11);
  const pack0 = packFor(base);
  let idx = -1;
  for (let i = 60; i < base.length - 1; i++) {
    const s = signalAt(base, pack0, i, '^GDAXI');
    if (s && s.ev != null) { idx = i; break; }
  }
  assert.ok(idx > 0, 'brak świecy z policzonym EV');

  const mk = (targetUtc) => {
    const t0 = Math.floor(Date.parse(targetUtc) / 1000) - idx * 300;
    const shifted = base.map((c, k) => ({ ...c, t: t0 + k * 300 }));
    return signalAt(shifted, packFor(shifted), idx, '^GDAXI');
  };
  const inWin = mk('2026-07-06T07:05:00Z');   // Berlin 09:05 — okno DAX
  const outWin = mk('2026-07-06T11:00:00Z');  // poza oknami
  assert.equal(inWin.macroWindow, 'otwarcie DAX 09:00');
  assert.equal(outWin.macroWindow, undefined);
  assert.equal(inWin.autoTradeBlock, true, 'automat zablokowany w oknie');
  assert.ok(outWin.autoTradeBlock == null);
  if (inWin.ev != null && outWin.ev != null) {
    assert.ok(inWin.ev < outWin.ev, 'EV w oknie makro musi być niższe (in=' + inWin.ev + ', out=' + outWin.ev + ')');
  }

  // instrument bez wrażliwości makro (crypto) — bez blokady
  const t0c = Math.floor(Date.parse('2026-07-06T07:05:00Z') / 1000) - idx * 300;
  const shiftedC = base.map((c, k) => ({ ...c, t: t0c + k * 300 }));
  const cSig = signalAt(shiftedC, packFor(shiftedC), idx, 'BTC-USD');
  assert.ok(cSig.autoTradeBlock == null, 'crypto: brak blokady automatu');
});
