import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionSizing } from '../src/signals/sizing.js';

test('[E4-2] edge liczone z costR (koszt obniża sizing)', () => {
  const noCost = positionSizing(0.4, 1.6, {});
  const withCost = positionSizing(0.4, 1.6, { costR: 0.02 });
  assert.ok(Math.abs((noCost.edge - withCost.edge) - 0.02) < 1e-9);
  assert.ok(withCost.riskPct < noCost.riskPct);
});

test('[E4-2] scale z portfolioCheck mnoży ryzyko', () => {
  const full = positionSizing(0.4, 1.6, {});
  const half = positionSizing(0.4, 1.6, { scale: 0.5 });
  assert.ok(Math.abs(half.riskPct - full.riskPct / 2) <= 0.015, 'half=' + half.riskPct + ' vs ' + full.riskPct / 2);
  assert.equal(half.scale, 0.5);
});

test('[E4-2] tryb obronny: drawdown > 5R ⇒ ryzyko ×0.5 + flaga', () => {
  const norm = positionSizing(0.4, 1.6, { ddR: 4 });
  const def = positionSizing(0.4, 1.6, { ddR: 6 });
  assert.equal(norm.defensive, false);
  assert.equal(def.defensive, true);
  assert.ok(def.riskPct < norm.riskPct);
});

test('[E4-2] brak przewagi po koszcie ⇒ riskPct 0', () => {
  const r = positionSizing(0.5, 1.2, { costR: 0.2 });
  assert.equal(r.riskPct, 0);
  assert.ok(r.edge < 0);
});
