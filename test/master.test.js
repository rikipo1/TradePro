import test from 'node:test';
import assert from 'node:assert/strict';
import { masterVerdict, tfLadder, gradeOf } from '../src/signals/master.js';

/* syntetyczny trend M5: wyraźny dryf + lekki szum (EMA stack jednoznaczny) */
function trendCandles(n, dirn, step = 300){
  const out = []; let px = 1000;
  for(let i = 0; i < n; i++){
    const drift = dirn * (0.8 + (i % 5) * 0.05);
    const noise = Math.sin(i * 0.7) * 0.3;
    const o = px;
    px = px + drift + noise;
    const c = px;
    const h = Math.max(o, c) + 0.5;
    const l = Math.min(o, c) - 0.5;
    out.push({ t: 1700000000 + i * step, o, h, l, c, v: 100 });
  }
  return out;
}

const mockLevels = { entry: 1000, sl: 995, tp1: 1007.5, tp2: 1012.5 };
const sigLong = { dir: 1, setupScore: 58, ev: 0.4, warns: [], levels: mockLevels, stale: false, score: 40 };
const sigWait = { dir: 0, score: 0, warns: [], stale: false };
const rankLong = { dir: 1, confidence: 72, best: { id: 'breakout', name: 'Breakout' }, levels: mockLevels, scores: { risk: 20 } };
const rankNone = { dir: 0, confidence: 0, best: null, scores: { risk: 20 } };

test('[MASTER] drabina: uptrend M5 → wyższe ramki ▲, align > 0.5', () => {
  const { ladder, align } = tfLadder(trendCandles(800, 1), 'M5', 300);
  assert.ok(ladder.length >= 3, 'co najmniej bieżąca + 2 wyższe ramki');
  const higher = ladder.filter(f => !f.cur);
  assert.ok(higher.every(f => f.dir === 1), 'wszystkie wyższe ramki w górę');
  assert.ok(align > 0.5, 'align dodatni, jest ' + align);
});

test('[MASTER] silnik LONG + drabina zgodna + ranking zgodny ⇒ WEJŚCIE, conf ≥ baza', () => {
  const m = masterVerdict({ candles: trendCandles(800, 1), tfId: 'M5', tfSec: 300, signal: sigLong, rank: rankLong });
  assert.ok(m, 'werdykt istnieje');
  assert.equal(m.verdict, 'LONG');
  assert.equal(m.state, 'entry');
  assert.equal(m.veto, null);
  assert.ok(m.confidence >= 58, 'zgodność podnosi zaufanie ponad bazę P(win), jest ' + m.confidence);
  assert.equal(m.readiness, 100);
  assert.deepEqual(m.levels, mockLevels);
});

test('[MASTER] silnik LONG pod prąd całej drabiny ⇒ VETO (nie walcz z wyższym rzędem)', () => {
  const m = masterVerdict({ candles: trendCandles(800, -1), tfId: 'M5', tfSec: 300, signal: sigLong, rank: rankNone });
  assert.ok(m.veto, 'veto ustawione');
  assert.equal(m.dir, 0);
  assert.equal(m.verdict, 'CZEKAJ');
  assert.equal(m.levels, null);
});

test('[MASTER] silnik czeka, ranking gotowy i zgodny z drabiną ⇒ stan setup (warunkowy)', () => {
  const m = masterVerdict({ candles: trendCandles(800, 1), tfId: 'M5', tfSec: 300, signal: sigWait, rank: rankLong });
  assert.equal(m.state, 'setup');
  assert.equal(m.dir, 1);
  assert.equal(m.srcStrategy, 'breakout');
  assert.ok(m.confidence < 72, 'setup bez potwierdzenia silnika ma dyskonto, jest ' + m.confidence);
  assert.ok(m.readiness >= 60 && m.readiness < 100);
});

test('[MASTER] ranking pod prąd drabiny ⇒ setup odrzucony (veto)', () => {
  const m = masterVerdict({ candles: trendCandles(800, -1), tfId: 'M5', tfSec: 300, signal: sigWait, rank: rankLong });
  assert.ok(m.veto);
  assert.equal(m.dir, 0);
});

test('[MASTER] brak sygnału i setupu ⇒ CZEKAJ z przechyłem od drabiny', () => {
  const m = masterVerdict({ candles: trendCandles(800, 1), tfId: 'M5', tfSec: 300, signal: sigWait, rank: rankNone });
  assert.equal(m.verdict, 'CZEKAJ');
  assert.equal(m.dir, 0);
  assert.equal(m.lean, 1, 'przechył z dodatniej drabiny');
});

test('[MASTER] ranking PRZECIWNY do silnika ścina zaufanie', () => {
  const rankShort = { ...rankLong, dir: -1 };
  const agree = masterVerdict({ candles: trendCandles(800, 1), tfId: 'M5', tfSec: 300, signal: sigLong, rank: rankLong });
  const conflict = masterVerdict({ candles: trendCandles(800, 1), tfId: 'M5', tfSec: 300, signal: sigLong, rank: rankShort });
  assert.ok(conflict.confidence < agree.confidence, 'sprzeczność metod obniża zaufanie ('
    + conflict.confidence + ' < ' + agree.confidence + ')');
});

test('[MASTER] zaufanie zawsze w klamrach 5–95, grade spójny', () => {
  const m = masterVerdict({ candles: trendCandles(800, 1), tfId: 'M5', tfSec: 300, signal: sigLong, rank: rankLong });
  assert.ok(m.confidence >= 5 && m.confidence <= 95);
  assert.equal(m.grade, gradeOf(m.confidence));
});

test('[MASTER] dane stale ⇒ werdykt wstrzymany, bez wejścia', () => {
  const m = masterVerdict({ candles: trendCandles(800, 1), tfId: 'M5', tfSec: 300, signal: { ...sigLong, stale: true }, rank: rankLong });
  assert.equal(m.dir, 0);
  assert.ok(/nieaktualne/.test(m.label));
});
