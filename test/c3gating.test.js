import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignal } from '../src/signals/engine.js';
import { detectCandlePatterns } from '../src/patterns/index.js';
import { findSRZones } from '../src/indicators/index.js';
import { DEFAULT_WEIGHTS } from '../src/signals/model.js';
import { mulberry32, packFor } from './_synth.js';

/* Seria z wyraźnymi trendami — daje sygnały dir≠0 na części świec. */
function trendCandles(n, seed = 11) {
  const rnd = mulberry32(seed);
  const out = []; let px = 100; let dir = 1; let left = 0;
  for (let i = 0; i < n; i++) {
    if (left <= 0) { dir = rnd() < 0.5 ? 1 : -1; left = 40 + Math.floor(rnd() * 60); }
    left--;
    const drift = dir * 0.25 * (0.5 + rnd());
    const noise = (rnd() - 0.5) * 0.8;
    const o = px, c = px + drift + noise;
    const h = Math.max(o, c) + rnd() * 0.5, l = Math.min(o, c) - rnd() * 0.5;
    out.push({ t: 1700000000 + i * 300, o, h, l, c, v: 1000 + Math.round(rnd() * 500) });
    px = c;
  }
  return out;
}

function signalAt(candles, pack, i, srExtra = {}) {
  const patsWrap = { list: detectCandlePatterns(candles, pack.emaData[20], pack.ind.atr, pack.hasVol) };
  const zones = findSRZones(candles.slice(0, i + 1), pack.ind.atr[i]);
  zones.__sym = 'BTC-USD'; // crypto: bez bramki sesji — deterministycznie
  zones.__minScore = 30;
  Object.assign(zones, srExtra);
  return computeSignal(candles, pack.ind, pack.emaData, patsWrap, pack.hasVol, i, zones);
}

/* znajdź świecę z aktywnym sygnałem (dir≠0) */
function findActiveIdx(candles, pack) {
  for (let i = 60; i < candles.length - 1; i++) {
    const s = signalAt(candles, pack, i);
    if (s && s.dir !== 0 && s.levels) return i;
  }
  return -1;
}

const candles = trendCandles(900);
const pack = packFor(candles);
const activeIdx = findActiveIdx(candles, pack);

test('sanity: syntetyczna seria daje co najmniej jeden aktywny sygnał', () => {
  assert.ok(activeIdx > 0, 'brak sygnału dir≠0 w serii testowej');
});

test('[A2] kNN poza torem decyzyjnym: __knn nie zmienia out.prob', () => {
  assert.ok(activeIdx > 0);
  const rnd = mulberry32(5);
  const knn = Array.from({ length: 60 }, () => ({
    x: { trend: rnd() * 2 - 1, momentum: rnd() * 2 - 1, location: rnd() * 2 - 1, liquidity: rnd() * 2 - 1, confirmation: rnd() * 2 - 1, htf: 0 },
    y: rnd() < 0.9 ? 1 : 0, // mocno skrzywiona historia — blendProb by to przesunęło
  }));
  const noKnn = signalAt(candles, pack, activeIdx);
  const withKnn = signalAt(candles, pack, activeIdx, { __knn: knn, __reliable: true, __weights: DEFAULT_WEIGHTS });
  const noKnnW = signalAt(candles, pack, activeIdx, { __reliable: true, __weights: DEFAULT_WEIGHTS });
  assert.equal(withKnn.prob, noKnnW.prob, '__knn nie może zmieniać prob');
  assert.equal(noKnn.prob, noKnnW.prob, 'DEFAULT_WEIGHTS ≡ brak wag');
  assert.ok(withKnn.similar && withKnn.similar.n > 0, 'out.similar wypełnione (diagnostyka)');
  assert.ok(!noKnn.similar, 'bez __knn brak out.similar');
});
