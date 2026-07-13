import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePaperList, paperFloating } from '../src/data/paper.js';

const baseEntry = (extra = {}) => ({
  id: 1, ts: Date.now(), sym: 'X', dir: 1, paper: true,
  entry: 100, sl: 99, risk: 1, tp1: 101.5, tp2: 102.5, rr1: 1.5,
  result: 'open', r: 0, ...extra,
});

test('[A7] SL z spreadPx>0 ⇒ r ≈ −1.05', () => {
  const out = resolvePaperList([baseEntry({ spreadPx: 0.05 })], 'X', 98.9, null);
  assert.ok(out, 'lista zmieniona');
  assert.equal(out[0].result, 'sl');
  assert.ok(Math.abs(out[0].r - (-1.05)) < 1e-9, 'r=' + out[0].r);
});

test('[A7] SL bez spreadPx ⇒ −1 (kompatybilność wstecz)', () => {
  const out = resolvePaperList([baseEntry()], 'X', 98.9, null);
  assert.equal(out[0].result, 'sl');
  assert.equal(out[0].r, -1);
});

test('[A7] TP2 z kosztem: r = banked + 0.5·rr2 − costR', () => {
  const e = baseEntry({ stage: 'runner', banked: 0.75, slDyn: 100, spreadPx: 0.05 });
  const out = resolvePaperList([e], 'X', 102.6, null);
  assert.equal(out[0].result, 'tp2');
  // banked 0.75 + 0.5*2.5 - 0.05 = 1.95
  assert.ok(Math.abs(out[0].r - 1.95) < 1e-9, 'r=' + out[0].r);
});

test('paperFloating: runner liczy banked + połowę biegu', () => {
  const e = baseEntry({ stage: 'runner', banked: 0.75 });
  assert.ok(Math.abs(paperFloating(e, 102) - (0.75 + 0.5 * 2)) < 1e-9);
});
