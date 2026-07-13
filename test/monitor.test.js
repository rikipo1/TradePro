import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollingStats, degradation } from '../src/signals/monitor.js';

const mk = (r, prob, i) => ({
  sym: 'DE40', tf: 'M5', paper: true, result: r > 0 ? 'tp1' : 'sl', r, prob,
  exitTs: 1000000 + i * 1000, ts: 1000000 + i * 1000,
});

test('[E3-1] rollingStats: okno, avgR, brierLive', () => {
  const j = [];
  for (let i = 0; i < 40; i++) j.push(mk(i % 2 ? 1.5 : -1, 0.55, i));
  const r = rollingStats(j, 'DE40', 'M5', 30);
  assert.equal(r.n, 30);
  assert.ok(r.avgR > 0);
  assert.ok(r.brierLive != null);
});

test('[E3-1] degradacja wykrywana: avgR poniżej p25 walidacji', () => {
  const j = [];
  for (let i = 0; i < 25; i++) j.push(mk(-1, 0.6, i)); // seria strat
  const roll = rollingStats(j, 'DE40', 'M5', 30);
  const meta = { agg: { avgR: { med: 0.1, p25: -0.02 }, brier: { p75: 0.24 } } };
  const d = degradation(roll, meta);
  assert.equal(d.degraded, true);
  assert.ok(d.reasons.length >= 1);
});

test('[E3-1] brak degradacji przy < 20 transakcjach', () => {
  const j = [];
  for (let i = 0; i < 15; i++) j.push(mk(-1, 0.6, i));
  const roll = rollingStats(j, 'DE40', 'M5', 30);
  const meta = { agg: { avgR: { med: 0.1, p25: -0.02 }, brier: { p75: 0.24 } } };
  assert.equal(degradation(roll, meta).degraded, false);
});

test('[E3-1] zdrowy dziennik nie degraduje', () => {
  const j = [];
  for (let i = 0; i < 30; i++) j.push(mk(i % 3 ? 1.5 : -1, i % 3 ? 0.62 : 0.45, i));
  const roll = rollingStats(j, 'DE40', 'M5', 30);
  const meta = { agg: { avgR: { med: 0.1, p25: -0.5 }, brier: { p75: 0.3 } } };
  assert.equal(degradation(roll, meta).degraded, false);
});
