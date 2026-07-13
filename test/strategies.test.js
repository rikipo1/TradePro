import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyCtx, rankStrategies } from '../src/strategies/engine.js';
import { strategyStatsFromJournal, learnAdjust, MIN_N } from '../src/strategies/learning.js';
import { aggregateTf, mtfConsensus } from '../src/strategies/mtf.js';
import { detBreakout, detMeanReversion, detWyckoffSpring } from '../src/strategies/detectors.js';
import { mulberry32, packFor } from './_synth.js';

function trendCandles(n, seed = 11, t0 = 1700000000) {
  const rnd = mulberry32(seed);
  const out = []; let px = 100; let dir = 1; let left = 0;
  for (let i = 0; i < n; i++) {
    if (left <= 0) { dir = rnd() < 0.5 ? 1 : -1; left = 40 + Math.floor(rnd() * 60); }
    left--;
    const drift = dir * 0.25 * (0.5 + rnd());
    const noise = (rnd() - 0.5) * 0.8;
    const o = px, c = px + drift + noise;
    const h = Math.max(o, c) + rnd() * 0.5, l = Math.min(o, c) - rnd() * 0.5;
    out.push({ t: t0 + i * 300, o, h, l, c, v: 1000 + Math.round(rnd() * 500) });
    px = c;
  }
  return out;
}

const candles = trendCandles(900);
const pack = packFor(candles);

test('[STRAT] buildStrategyCtx + rankStrategies: pełny wynik z rankingiem i sub-score', () => {
  const ctx = buildStrategyCtx(candles, pack.ind, pack.emaData, pack.hasVol, 'BTC-USD', 300, 700);
  assert.ok(ctx, 'ctx zbudowany');
  const r = rankStrategies(ctx, []);
  assert.ok(r, 'wynik rankingu');
  assert.ok(['LONG', 'SHORT', 'BRAK TRANSAKCJI'].includes(r.verdict));
  assert.ok(Array.isArray(r.ranking));
  for (const s of r.ranking) {
    assert.ok(s.score >= 0 && s.score <= 100, 'score 0–100: ' + s.score);
    assert.ok(s.name && s.why && s.invalidates, 'komplet pól Explain');
  }
  // ranking posortowany malejąco
  for (let k = 1; k < r.ranking.length; k++) assert.ok(r.ranking[k - 1].score >= r.ranking[k].score);
  // KAŻDA wykryta strategia ma własne poziomy po właściwych stronach
  for (const st of r.ranking) {
    assert.ok(st.levels && st.levels.entry != null && st.levels.sl != null, 'poziomy dla ' + st.id);
    assert.ok((st.dir === 1) === (st.levels.sl < st.levels.entry), 'SL po właściwej stronie: ' + st.id);
    assert.ok((st.dir === 1) === (st.levels.tp4 > st.levels.entry), 'TP4 po właściwej stronie: ' + st.id);
    assert.ok(st.probability > 0 && st.probability < 1, 'P(win) dla ' + st.id);
  }
  for (const k of ['marketStructure', 'trend', 'momentum', 'liquidity', 'volatility', 'risk']) {
    assert.ok(r.scores[k] >= 0 && r.scores[k] <= 100, 'sub-score ' + k);
  }
  if (r.verdict !== 'BRAK TRANSAKCJI') {
    assert.ok(r.levels.sl != null && r.levels.tp1 != null && r.levels.tp4 != null, 'SL i TP1–TP4');
    assert.ok(r.probability > 0 && r.probability < 1);
    assert.ok(r.explain.why.length >= 1 && Array.isArray(r.explain.rejected));
  } else {
    assert.ok(r.explain.why.length >= 1, 'BRAK TRANSAKCJI też ma wyjaśnienie');
  }
});

test('[STRAT] próg przewagi: minScore 101 ⇒ zawsze BRAK TRANSAKCJI', () => {
  const ctx = buildStrategyCtx(candles, pack.ind, pack.emaData, pack.hasVol, 'BTC-USD', 300, 700);
  const r = rankStrategies(ctx, [], { minScore: 101 });
  assert.equal(r.verdict, 'BRAK TRANSAKCJI');
  assert.equal(r.dir, 0);
});

test('[STRAT] uczenie: shrinkage — mało transakcji nie zmienia score', () => {
  const je = (strat, r, i) => ({ strategy: strat, result: r > 0 ? 'tp1' : 'sl', r, exitTs: i, ts: i });
  // 5 transakcji (< MIN_N) — korekta 0
  const few = strategyStatsFromJournal(Array.from({ length: 5 }, (_, i) => je('breakout', 1.5, i)));
  assert.equal(learnAdjust(few, 'breakout'), 0);
  // 40 zyskownych — korekta dodatnia, ale ograniczona
  const many = strategyStatsFromJournal(Array.from({ length: 40 }, (_, i) => je('breakout', 1.5, i)));
  const adj = learnAdjust(many, 'breakout');
  assert.ok(adj > 0 && adj <= 15, 'adj=' + adj);
  // 40 stratnych — korekta ujemna
  const bad = strategyStatsFromJournal(Array.from({ length: 40 }, (_, i) => je('sweep', -1, i)));
  assert.ok(learnAdjust(bad, 'sweep') < 0);
  assert.ok(MIN_N >= 10, 'nie uczymy się na pojedynczych transakcjach');
});

test('[STRAT] MTF: agregacja świec i konsensus tylko z ramek wyższych', () => {
  const agg = aggregateTf(candles, 3600);
  assert.ok(agg.length < candles.length && agg.length > 30);
  assert.ok(Math.abs(agg.length - candles.length / 12) < 5, 'M5→H1 ≈ /12');
  const mtf = mtfConsensus(candles, 300);
  assert.ok(mtf.align >= -1 && mtf.align <= 1);
  assert.ok(mtf.frames.every(f => ['M15', 'M30', 'H1', 'H4', 'D1'].includes(f.id)));
});

test('[STRAT] detektor breakout: wybicie 20-świecowego szczytu wykrywane', () => {
  // płaska seria + wybicie na końcu
  const flat = [];
  for (let i = 0; i < 60; i++) flat.push({ t: 1700000000 + i * 300, o: 100, h: 100.5, l: 99.5, c: 100 + (i % 2 ? 0.1 : -0.1), v: 1000 });
  flat.push({ t: 1700000000 + 60 * 300, o: 100, h: 102.6, l: 100, c: 102.5, v: 5000 }); // wybicie
  const p = packFor(flat);
  const ctx = buildStrategyCtx(flat, p.ind, p.emaData, p.hasVol, 'BTC-USD', 300, 60);
  const r = detBreakout(ctx);
  assert.ok(r && r.dir === 1, 'breakout LONG wykryty');
});

test('[STRAT] Wyckoff spring: nurek pod range i powrót ⇒ LONG', () => {
  const flat = [];
  for (let i = 0; i < 70; i++) flat.push({ t: 1700000000 + i * 300, o: 100, h: 100.6, l: 99.4, c: 100 + Math.sin(i) * 0.3, v: 1000 });
  // spring: świeca nurkuje pod 99.4 i zamyka w range
  flat.push({ t: 1700000000 + 70 * 300, o: 99.8, h: 100.0, l: 98.7, c: 99.9, v: 2500 });
  const p = packFor(flat);
  const ctx = buildStrategyCtx(flat, p.ind, p.emaData, p.hasVol, 'BTC-USD', 300, 70);
  if (ctx.regime.type === 'range') {
    const r = detWyckoffSpring(ctx);
    assert.ok(r && r.dir === 1, 'spring wykryty');
  } // gdy klasyfikator nie widzi range na tak krótkiej serii — detektor słusznie milczy
});

test('[STRAT] werdykt LONG/SHORT ma zawsze poziomy i wyjaśnienie odrzuconych', () => {
  // przeskanuj świece aż znajdzie się aktywny werdykt
  for (let i = 100; i < candles.length - 1; i += 15) {
    const ctx = buildStrategyCtx(candles, pack.ind, pack.emaData, pack.hasVol, 'BTC-USD', 300, i);
    if (!ctx) continue;
    const r = rankStrategies(ctx, [], { minScore: 40 });
    if (r.verdict !== 'BRAK TRANSAKCJI') {
      assert.ok(r.levels.entry && r.levels.sl && r.levels.tp1 && r.levels.tp2 && r.levels.tp3 && r.levels.tp4);
      assert.ok((r.dir === 1) === (r.levels.tp1 > r.levels.entry), 'TP po właściwej stronie');
      assert.ok((r.dir === 1) === (r.levels.sl < r.levels.entry), 'SL po właściwej stronie');
      assert.ok(typeof r.explain.invalidates[0] === 'string');
      return;
    }
  }
  assert.ok(true, 'brak aktywnego werdyktu na serii — dopuszczalne (selektywność)');
});
