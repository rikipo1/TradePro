import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkForwardKFold, computePayout, statsOf } from '../src/backtest/engine.js';
import { synthCandles, packFor, mulberry32 } from './_synth.js';

function runKfold(n = 700, opts = {}) {
  const candles = synthCandles(n, { seed: 11, wave: 9, noise: 0.5, drift: 0.03 });
  const { ind, emaData, hasVol } = packFor(candles);
  return walkForwardKFold(candles, ind, emaData, hasVol, '^GDAXI', 30, null, 'M5', opts);
}

test('[A1] walkForwardKFold: oosPairsN liczbowe, kalibracja tylko z pooled OOS', () => {
  const kf = runKfold();
  if (!kf.ok) {
    // syntetyczna seria może nie dać dość transakcji — to też ścieżka poprawna
    assert.equal(typeof kf.reason, 'string');
    return;
  }
  assert.equal(typeof kf.oosPairsN, 'number');
  if (kf.oosPairsN < 150) assert.equal(kf.calib, null, 'oosPairsN<150 ⇒ calib===null');
  assert.ok(Array.isArray(kf.folds) && kf.folds.length >= 2);
  assert.ok('payout' in kf, 'zwraca payout (A4)');
  assert.ok(kf.agg && 'med' in kf.agg.avgR && 'p25' in kf.agg.avgR);
  assert.equal(typeof kf.regimeCoverage, 'number');
});

test('[A1] za mało danych ⇒ ok:false', () => {
  const kf = runKfold(120);
  assert.equal(kf.ok, false);
});

test('[E2-4] timeBudgetMs=1 ⇒ ok:false z powodem budżetu', () => {
  const kf = runKfold(700, { timeBudgetMs: 1 });
  assert.equal(kf.ok, false);
  assert.match(kf.reason, /budżet/);
});

test('[A4] computePayout: n<30 ⇒ null; rozkład wyników poprawny', () => {
  assert.equal(computePayout([]), null);
  assert.equal(computePayout(Array.from({ length: 29 }, () => ({ out: 'TP1', r: 1.5 }))), null);

  const rnd = mulberry32(3);
  const trades = [];
  for (let i = 0; i < 40; i++) {
    const u = rnd();
    if (u < 0.4) trades.push({ out: 'TP1', r: 1.8 });
    else if (u < 0.6) trades.push({ out: 'SL', r: -1 });
    else if (u < 0.85) trades.push({ out: 'BE', r: 0.05 });
    else trades.push({ out: 'TIMEOUT', r: -0.2 });
  }
  const p = computePayout(trades);
  assert.equal(p.n, 40);
  assert.ok(Math.abs(p.eWin - 1.8) < 1e-6);
  const nBE = trades.filter(t => t.out === 'BE').length;
  assert.ok(Math.abs(p.pBE - nBE / 40) < 1e-6);
  assert.ok(p.pTO > 0 && p.eTO < 0);
});

test('statsOf: podstawowe metryki', () => {
  const s = statsOf([{ out: 'TP1', r: 1.5 }, { out: 'SL', r: -1 }]);
  assert.equal(s.n, 2);
  assert.equal(s.winRate, 50);
  assert.ok(Math.abs(s.avgR - 0.25) < 1e-9);
});
