import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareValidation } from '../src/core/adaptive.js';

const res = (med, p75) => ({ ok: true, totalNoos: 100, agg: { avgR: { med }, brier: { p75 } } });

test('[E4-3] nowe gorsze (avgR spadło) ⇒ rollback', () => {
  const c = compareValidation(res(0.15, 0.24), res(0.05, 0.24));
  assert.equal(c.accept, false);
  assert.ok(c.reasons.some(r => /avgR/.test(r)));
});

test('[E4-3] nowe gorsze (Brier wzrósł) ⇒ rollback', () => {
  const c = compareValidation(res(0.15, 0.22), res(0.15, 0.26));
  assert.equal(c.accept, false);
});

test('[E4-3] nowe nie-gorsze ⇒ akceptacja', () => {
  const c = compareValidation(res(0.15, 0.24), res(0.16, 0.23));
  assert.equal(c.accept, true);
});

test('[E4-3] nowy przebieg nieudany ⇒ rollback', () => {
  const c = compareValidation(res(0.15, 0.24), { ok: false, reason: 'za mało próbek' });
  assert.equal(c.accept, false);
});

test('[E4-3] brak bazy ⇒ akceptacja warunkowa z adnotacją', () => {
  const c = compareValidation({ ok: false, reason: 'za mało próbek' }, res(0.1, 0.24));
  assert.equal(c.accept, true);
  assert.ok(c.reasons.length === 1);
});
