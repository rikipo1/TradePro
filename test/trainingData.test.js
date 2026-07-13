import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTrainingCandles } from '../src/data/feed.js';
import { TF_MAX_RANGE } from '../src/data/yahoo.js';

test('[FIX] TF_MAX_RANGE: śróddzienne szersze niż zakres wykresu', () => {
  assert.equal(TF_MAX_RANGE.M5, '60d');
  assert.equal(TF_MAX_RANGE.H1, '730d');
});

test('[FIX] fetchTrainingCandles: nieznany TF ⇒ fallback na świece wykresu (bez sieci)', async () => {
  const chart = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 0 }, { t: 2, o: 1, h: 1, l: 1, c: 1, v: 0 }];
  // tf bez wpisu w TF_MAX_RANGE i range === range ⇒ nie strzela do sieci
  const r = await fetchTrainingCandles('X', { id: 'ZZ', range: '5d' }, chart);
  assert.equal(r.extended, false);
  assert.equal(r.candles.length, 2);
});
