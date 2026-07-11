import { describe, it, expect } from 'vitest';
import { initPosition, stepPosition } from '../src/signals/tradeManager.js';

/* helper: świeca */
const bar = (o, h, l, c, atr, trailLow, trailHigh, timeout) =>
  ({ o, h, l, c, atr, trailLow, trailHigh, timeout: !!timeout });

/* pozycja LONG: entry 100, risk 2 (SL 98), tp1 103 (1.5R), tp2 106 */
const longPos = () => initPosition({ dir: 1, entry: 100, sl: 98, tp1: 103, tp2: 106, risk: 2, rr1: 1.5, costPx: 0 });

describe('[W1] stepPosition — SL-first w obrębie świecy', () => {
  it('świeca dotyka i SL i TP1 → wynik SL (nie TP1)', () => {
    const p = longPos();
    // low=97 (<98 SL) ORAZ high=104 (>103 TP1) w tej samej świecy
    const { closed } = stepPosition(p, bar(100, 104, 97, 100, 2, 97, 104));
    expect(closed).not.toBeNull();
    expect(closed.out).toBe('SL');
    expect(closed.r).toBe(-1);
  });

  it('SHORT: świeca dotyka i SL i TP1 → SL', () => {
    const p = initPosition({ dir: -1, entry: 100, sl: 102, tp1: 97, tp2: 94, risk: 2, rr1: 1.5, costPx: 0 });
    const { closed } = stepPosition(p, bar(100, 103, 96, 100, 2, 96, 103));
    expect(closed.out).toBe('SL');
    expect(closed.r).toBe(-1);
  });
});

describe('[W1] BE po +1R, partial na TP1, runner do TP2', () => {
  it('po +1R stop skacze na wejście (BE); powrót do entry → BE r≈0', () => {
    let p = longPos();
    // świeca 1: high 102.5 (=+1.25R) → BE, low 100 (nie rusza SL 98)
    let r = stepPosition(p, bar(100, 102.5, 100, 101, 2, 100, 102.5));
    expect(r.closed).toBeNull();
    expect(r.state.stage).toBe('be');
    expect(r.state.slCur).toBe(100); // entry
    // świeca 2: low 100 dotyka BE stop → zamknięcie BE, r=0
    r = stepPosition(r.state, bar(101, 101, 100, 100.5, 2, 100, 101));
    expect(r.closed.out).toBe('BE');
    expect(r.closed.r).toBe(0);
  });

  it('TP1 → partial 50% + runner, potem TP2 → r = banked + 0.5·rr2', () => {
    let p = longPos();
    // świeca: high 103 dotyka TP1 (rr1=1.5) → runner, banked=0.75
    let r = stepPosition(p, bar(100, 103, 100, 102, 2, 100, 103));
    expect(r.state.stage).toBe('runner');
    expect(r.state.banked).toBeCloseTo(0.75, 6);
    // świeca: high 106 dotyka TP2 (rOf(106)=3R) → r = 0.75 + 0.5·3 = 2.25
    r = stepPosition(r.state, bar(103, 106, 102, 105, 2, 102, 106));
    expect(r.closed.out).toBe('TP1');
    expect(r.closed.tp2).toBe(true);
    expect(r.closed.r).toBeCloseTo(2.25, 6);
  });
});

describe('[W1] time-stop base = banked + 0.5·floating', () => {
  it('runner + timeout → base = banked + 0.5·rOf(close)', () => {
    let p = longPos();
    let r = stepPosition(p, bar(100, 103, 100, 102, 2, 100, 103)); // → runner banked 0.75
    // timeout przy close=104 → rOf(104)=2R → base = 0.75 + 0.5·2 = 1.75
    r = stepPosition(r.state, bar(102, 104, 101.9, 104, 2, 101.9, 104, true));
    expect(r.closed.out).toBe('TIMEOUT');
    expect(r.closed.r).toBeCloseTo(1.75, 6);
  });
});

describe('[W1] koszt (spread) w R odejmowany od wyniku', () => {
  it('costPx>0 zmniejsza R przy SL', () => {
    const p = initPosition({ dir: 1, entry: 100, sl: 98, tp1: 103, tp2: 106, risk: 2, rr1: 1.5, costPx: 0.1 });
    expect(p.costR).toBeCloseTo(0.05, 6);
    const { closed } = stepPosition(p, bar(100, 100, 97, 98, 2, 97, 100));
    expect(closed.r).toBeCloseTo(-1.05, 6);
  });
});

/* ---- GOLDEN: stepPosition (trailMode structure) == referencyjna STARA logika backtestu ---- */
function referenceOldBacktest(open0, candles, atrArr, maxBars) {
  const open = { ...open0 };
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], dir = open.dir;
    const costR = open.costR || 0;
    const rOf = px => ((px - open.entry) / open.risk) * dir;
    const stopHit = dir === 1 ? c.l <= open.slCur : c.h >= open.slCur;
    if (stopHit) {
      let r, out2, tp2f = false;
      if (open.stage === 'open') { r = -1 - costR; out2 = 'SL'; }
      else if (open.stage === 'be') { r = rOf(open.slCur) - costR; out2 = 'BE'; }
      else { r = open.banked + 0.5 * rOf(open.slCur) - costR; out2 = 'TP1'; tp2f = open.sawTp2 === true; }
      return { out: out2, r, tp2: tp2f, i };
    }
    const fav = dir === 1 ? c.h : c.l;
    const favR = ((fav - open.entry) / open.risk) * dir;
    if (open.stage === 'open' && favR >= 1) { open.stage = 'be'; open.slCur = open.entry; }
    if ((open.stage === 'open' || open.stage === 'be') && (dir === 1 ? c.h >= open.tp1 : c.l <= open.tp1)) {
      open.banked = 0.5 * open.rr1; open.stage = 'runner';
      open.slCur = dir === 1 ? Math.max(open.slCur, open.entry) : Math.min(open.slCur, open.entry);
    }
    if (open.stage === 'runner') {
      if (dir === 1 ? c.h >= open.tp2 : c.l <= open.tp2) {
        return { out: 'TP1', r: open.banked + 0.5 * rOf(open.tp2) - costR, tp2: true, i };
      }
      let ext = dir === 1 ? Infinity : -Infinity;
      for (let q = Math.max(0, i - 7); q <= i; q++) {
        if (dir === 1 && candles[q].l < ext) ext = candles[q].l;
        if (dir === -1 && candles[q].h > ext) ext = candles[q].h;
      }
      const aI = atrArr[i] != null ? atrArr[i] : open.risk * 0.5;
      open.slCur = dir === 1 ? Math.max(open.slCur, ext - aI * 0.25) : Math.min(open.slCur, ext + aI * 0.25);
      if (dir === 1 ? c.h >= open.tp2 : c.l <= open.tp2) open.sawTp2 = true;
    }
    if (i - 0 >= maxBars) {
      const base = open.stage === 'runner' ? open.banked + 0.5 * rOf(c.c) : rOf(c.c);
      return { out: 'TIMEOUT', r: base - costR, tp2: false, i };
    }
  }
  return null;
}

function newEngine(open0, candles, atrArr, maxBars) {
  let st = { ...open0 };
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    let trailLow = Infinity, trailHigh = -Infinity;
    for (let q = Math.max(0, i - 7); q <= i; q++) {
      if (candles[q].l < trailLow) trailLow = candles[q].l;
      if (candles[q].h > trailHigh) trailHigh = candles[q].h;
    }
    const b = { o: c.o, h: c.h, l: c.l, c: c.c, atr: atrArr[i], trailLow, trailHigh, timeout: i >= maxBars };
    const { state, closed } = stepPosition(st, b, { trailMode: 'structure' });
    st = state;
    if (closed) return { out: closed.out, r: closed.r, tp2: closed.tp2, i };
  }
  return null;
}

describe('[W1] GOLDEN: nowy stepPosition == stara logika backtestu (100 losowych ścieżek)', () => {
  it('identyczny wynik R na wielu losowych sekwencjach świec', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let t = 0; t < 100; t++) {
      const dir = rnd() > 0.5 ? 1 : -1;
      const entry = 100, risk = 2 + rnd();
      const sl = dir === 1 ? entry - risk : entry + risk;
      const tp1 = dir === 1 ? entry + risk * 1.5 : entry - risk * 1.5;
      const tp2 = dir === 1 ? entry + risk * 3 : entry - risk * 3;
      const open0 = { dir, entry, sl, tp1, tp2, risk, rr1: 1.5, costR: 0.03, stage: 'open', slCur: sl, banked: 0, sawTp2: false };
      const candles = []; const atrArr = [];
      let px = entry;
      for (let i = 0; i < 40; i++) {
        const drift = (rnd() - 0.48) * risk * 0.8;
        const o = px; const c = px + drift;
        const h = Math.max(o, c) + rnd() * risk * 0.9;
        const l = Math.min(o, c) - rnd() * risk * 0.9;
        candles.push({ o, h, l, c }); atrArr.push(risk); px = c;
      }
      const ref = referenceOldBacktest(open0, candles, atrArr, 30);
      const neo = newEngine(open0, candles, atrArr, 30);
      expect(neo).toEqual(ref);
    }
  });
});
