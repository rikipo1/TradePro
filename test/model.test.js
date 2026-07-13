import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitIsotonic, applyIsotonic, brierScore, expectedValueR, trainLogistic } from '../src/signals/model.js';
import { mulberry32 } from './_synth.js';

test('fitIsotonic zwraca null poniżej minN', () => {
  const pairs = Array.from({ length: 100 }, (_, i) => ({ p: i / 100, y: i % 2 }));
  assert.equal(fitIsotonic(pairs, 150), null);
});

test('fitIsotonic + applyIsotonic: mapa monotoniczna', () => {
  const rnd = mulberry32(7);
  const pairs = [];
  for (let i = 0; i < 400; i++) {
    const p = rnd();
    pairs.push({ p, y: rnd() < p ? 1 : 0 }); // dobrze skalibrowane źródło
  }
  const cal = fitIsotonic(pairs, 150);
  assert.ok(Array.isArray(cal) && cal.length > 0);
  let prev = -1;
  for (let p = 0.05; p <= 0.95; p += 0.05) {
    const v = applyIsotonic(p, cal);
    assert.ok(v >= prev - 1e-9, 'monotoniczność');
    prev = v;
  }
});

test('brierScore: idealny=0, moneta=0.25', () => {
  assert.equal(brierScore([{ p: 1, y: 1 }, { p: 0, y: 0 }]), 0);
  assert.equal(brierScore([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }]), 0.25);
});

test('expectedValueR: formuła liniowa', () => {
  assert.ok(Math.abs(expectedValueR(0.5, 1.5, 0.05) - (0.5 * 1.5 - 0.5 - 0.05)) < 1e-9);
});

test('trainLogistic: za mało próbek → nietrenowany', () => {
  const r = trainLogistic([{ x: { trend: 1 }, y: 1 }]);
  assert.equal(r.trained, false);
});
