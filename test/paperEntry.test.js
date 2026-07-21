import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperEntry } from '../src/data/paperEntry.js';

test('[E4-4] wpis dziennika zawiera komplet pól decyzyjnych', () => {
  const sig = {
    prob: 0.61, ev: 0.22, evModel: 'empirical',
    regime: { type: 'trend_weak' },
    session: { label: 'sesja londyńska', quality: 1 },
    sizing: { riskPct: 0.45 },
    levels: { spreadPx: 0.04 },
    factors: { trend: 0.7, momentum: 0.2, location: 0.4, liquidity: 0.1, confirmation: 0.5, htf: 0.8 },
  };
  const e = buildPaperEntry({
    sym: 'DE40', name: 'DAX', tfId: 'M5', dir: 1,
    entry: 100, sl: 99, tp1: 101.6, tp2: 102.5,
    srcTag: 'signal', score: 61, eq: { good: true }, sig, modelV: 2,
  });
  for (const k of ['sym', 'tf', 'dir', 'entry', 'sl', 'tp1', 'tp2', 'risk', 'rr1',
    'prob', 'ev', 'evModel', 'regime', 'riskPct', 'modelV', 'session', 'factors',
    'entryQuality', 'spreadPx']) {
    assert.ok(e[k] !== undefined, 'brak pola ' + k);
  }
  assert.equal(e.session, 'sesja londyńska');
  assert.equal(e.regime, 'trend_weak');
  assert.equal(e.modelV, 2);
  assert.equal(Object.keys(e.factors).length, 6, 'snapshot 6 czynników');
  assert.equal(e.rr1, 1.6);
});

test('[E4-4] wpis ręczny (bez sygnału) — pola null, bez wyjątków', () => {
  const e = buildPaperEntry({ sym: 'X', name: 'X', tfId: 'M5', dir: -1, entry: 100, sl: 101, tp1: 98.4, tp2: 97.5, srcTag: 'manual', score: null, eq: null, sig: null, modelV: null });
  assert.equal(e.prob, null);
  assert.equal(e.factors, null);
  assert.equal(e.result, 'open');
});
