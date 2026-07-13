import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareShadow } from '../src/backtest/shadow.js';

const paperT = (r, extra = {}) => ({ r, result: r > 0.2 ? 'tp1' : r < -0.2 ? 'sl' : 'be', ...extra });
const btT = (r) => ({ r, out: r > 0.2 ? 'TP1' : r < -0.2 ? 'SL' : 'BE' });

test('[E3-2] za mało danych ⇒ werdykt ZA MAŁO DANYCH', () => {
  const res = compareShadow([paperT(1)], [btT(1)]);
  assert.equal(res.verdict, 'ZA MAŁO DANYCH');
});

test('[E3-2] zbieżne wyniki ⇒ OK', () => {
  const paper = Array.from({ length: 20 }, (_, i) => paperT(i % 2 ? 1.5 : -1));
  const bt = Array.from({ length: 20 }, (_, i) => btT(i % 2 ? 1.4 : -1));
  const res = compareShadow(paper, bt);
  assert.equal(res.verdict, 'OK');
  assert.ok(Math.abs(res.diffAvgR) <= 0.1);
});

test('[E3-2] paper lepszy bez wyjaśnienia ⇒ NIEWYJAŚNIONA', () => {
  const paper = Array.from({ length: 20 }, () => paperT(1.5));
  const bt = Array.from({ length: 20 }, (_, i) => btT(i % 2 ? 1.5 : -1));
  const res = compareShadow(paper, bt);
  assert.equal(res.verdict, 'NIEWYJAŚNIONA');
  assert.match(res.why, /nie zwiększaj zaufania/);
});

test('[E3-2] różnica wyjaśniona flagami trailApprox ⇒ OK', () => {
  const paper = Array.from({ length: 20 }, () => paperT(1.5, { trailApprox: true }));
  const bt = Array.from({ length: 20 }, (_, i) => btT(i % 2 ? 1.5 : -1));
  const res = compareShadow(paper, bt);
  assert.equal(res.verdict, 'OK');
  assert.match(res.why, /trailApprox/);
});
