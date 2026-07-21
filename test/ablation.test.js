import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignal } from '../src/signals/engine.js';
import { detectCandlePatterns } from '../src/patterns/index.js';
import { findSRZones } from '../src/indicators/index.js';
import { extractFactors } from '../src/signals/features.js';
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

const candles = trendCandles(900);
const pack = packFor(candles);
let activeIdx = -1;
for (let i = 60; i < candles.length - 1; i++) {
  const s = signalAt(candles, pack, i, 'BTC-USD');
  if (s && s.dir !== 0 && s.levels) { activeIdx = i; break; }
}

test('[E2-1] extractFactors: flagi zerują liquidity/location u źródła', () => {
  const x = {
    price: 100, atr: 1, v20: 99, v50: 98, vw: 99.5,
    smc: { ms: { trend: 1 }, pd: { zone: 'discount' }, sweep: { dir: 1 }, bc: { bos: 1, choch: 0 } },
    nearSup: { lo: 98.8, hi: 99.6, touches: 3 }, htfDir: 1,
    liquidity: { magnets: [{ px: 101, weight: 1 }] },
  };
  const full = extractFactors(x);
  assert.ok(full.liquidity !== 0 && full.location !== 0, 'sanity: czynniki niezerowe');
  const noLiq = extractFactors(x, { liquidity: true });
  assert.equal(noLiq.liquidity, 0);
  assert.equal(noLiq.location, full.location);
  const noLoc = extractFactors(x, { location: true });
  assert.equal(noLoc.location, 0);
  assert.equal(noLoc.liquidity, full.liquidity);
});

test('[E2-1] __ablate.session: bramka sesji pomijana', () => {
  // sobota 12:00 UTC — indeks sesyjny normalnie zablokowany (weekend)
  const wkCandles = trendCandles(200, 7, Math.floor(Date.parse('2026-07-04T02:00:00Z') / 1000));
  const wkPack = packFor(wkCandles);
  for (let i = 60; i < wkCandles.length - 1; i++) {
    const s = signalAt(wkCandles, wkPack, i, '^GDAXI');
    if (s && s.sessionBlock) {
      const s2 = signalAt(wkCandles, wkPack, i, '^GDAXI', { __ablate: { session: true } });
      assert.ok(!s2.sessionBlock, 'z ablacją sesji brak sessionBlock');
      return;
    }
  }
  assert.fail('nie znaleziono świecy z sessionBlock w serii weekendowej');
});

test('[E2-1] __ablate.htfGate: kontra HTF nie blokuje', () => {
  assert.ok(activeIdx > 0, 'sanity: jest aktywny sygnał');
  const base = signalAt(candles, pack, activeIdx, 'BTC-USD');
  const contra = { dir: -base.dir, label: 'M15' };
  const gateMsg = /przeciw wyższemu interwałowi/;
  const blocked = signalAt(candles, pack, activeIdx, 'BTC-USD', { __htf: contra });
  const freed = signalAt(candles, pack, activeIdx, 'BTC-USD', { __htf: contra, __ablate: { htfGate: true } });
  assert.ok(!freed.warns.some(w => gateMsg.test(w)), 'z ablacją brak ostrzeżenia bramki HTF');
  if (blocked.prob < 0.66 && blocked.warns.some(w => gateMsg.test(w))) {
    // bramka zadziałała w wariancie pełnym — ablacja musiała ją zdjąć
    assert.ok(true);
  } else {
    // kontra HTF odrzucona wcześniej (konsensus/EV) — bramka i tak nieaktywna
    assert.ok(blocked.dir === 0 || blocked.prob >= 0.66);
  }
});

test('[E2-1] __ablate.smc: struktura SMC wyzerowana w diagnostyce', () => {
  assert.ok(activeIdx > 0);
  const s = signalAt(candles, pack, activeIdx, 'BTC-USD', { __ablate: { smc: true } });
  assert.equal(s.smc.struktura, null);
  assert.equal(s.smc.bos, 0);
});
