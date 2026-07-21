import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedValueEmpirical, expectedValueR } from '../src/signals/model.js';
import { computePayout } from '../src/backtest/engine.js';
import { mulberry32 } from './_synth.js';

test('[A4] payout {eWin:rr, pBE:0, pTO:0} ⇒ zbieżne ze starą formułą', () => {
  const rr = 1.7, p = 0.55, cost = 0.04;
  const emp = expectedValueEmpirical(p, { eWin: rr, pBE: 0, pTO: 0 }, cost);
  const lin = expectedValueR(p, rr, cost);
  assert.ok(Math.abs(emp - lin) < 1e-9);
});

test('[A4] wysoki pBE OBNIŻA EV', () => {
  const base = expectedValueEmpirical(0.6, { eWin: 1.8, pBE: 0, eBE: 0.02, pTO: 0, eTO: 0 }, 0.03);
  const withBE = expectedValueEmpirical(0.6, { eWin: 1.8, pBE: 0.4, eBE: 0.02, pTO: 0, eTO: 0 }, 0.03);
  assert.ok(withBE < base, 'duży udział BE musi obniżać EV dodatniego setupu');
});

test('[A4] brak payout ⇒ null (fallback na formułę liniową)', () => {
  assert.equal(expectedValueEmpirical(0.6, null, 0.03), null);
  assert.equal(expectedValueEmpirical(0.6, { eWin: null }, 0.03), null);
});

test('[A4] computePayout na 40 syntetycznych transakcjach', () => {
  const rnd = mulberry32(9);
  const trades = [];
  for (let i = 0; i < 40; i++) {
    const u = rnd();
    if (u < 0.35) trades.push({ out: 'TP1', r: 1.4 + rnd() });
    else if (u < 0.55) trades.push({ out: 'SL', r: -1.03 });
    else if (u < 0.85) trades.push({ out: 'BE', r: 0.01 });
    else trades.push({ out: 'TIMEOUT', r: -0.3 });
  }
  const p = computePayout(trades);
  assert.equal(p.n, 40);
  assert.ok(p.eWin > 1.3 && p.eWin < 2.5);
  assert.ok(p.pBE + p.pTO < 1);
  const ev = expectedValueEmpirical(0.5, p, 0.02);
  assert.equal(typeof ev, 'number');
});
