import { describe, it, expect } from 'vitest';
import { resolvePaperList } from '../src/data/paper.js';

const base = () => ({
  paper: true, sym: 'X', dir: 1, entry: 100, sl: 98, tp1: 103, tp2: 106,
  risk: 2, rr1: 1.5, result: 'open', stage: 'open', banked: 0,
});

/* resolvePaperList zwraca nową listę (albo null gdy brak zmian); bierzemy [0]. */
const step = (entry, px) => {
  const out = resolvePaperList([entry], 'X', px, null);
  return out ? out[0] : entry;
};

describe('[C5] resolvePaperList — zlecenia oczekujące (pending)', () => {
  it('pending → open na dotknięciu entry (LONG px<=entry)', () => {
    const e = { ...base(), result: 'pending', stage: undefined };
    const r = step(e, 100);
    expect(r.result).toBe('open');
    expect(r.stage).toBe('open');
  });
  it('pending → cancelled na unieważnieniu (px<=sl przed entry)', () => {
    const e = { ...base(), result: 'pending' };
    const r = step(e, 97);
    expect(r.result).toBe('cancelled');
  });
  it('pending → cancelled na wygaśnięciu (pendingUntil w przeszłości)', () => {
    const e = { ...base(), result: 'pending', pendingUntil: Date.now() - 1000 };
    const r = step(e, 101); // powyżej entry (nie dotyka), ale wygasło
    expect(r.result).toBe('cancelled');
  });
});

describe('[C5] resolvePaperList — cykl życia otwartej pozycji', () => {
  it('open → SL (stage open, px<=sl) → r=-1', () => {
    const r = step(base(), 98);
    expect(r.result).toBe('sl');
    expect(r.r).toBe(-1);
  });

  it('open → BE po +1R → runner (partial 50%) na TP1 → TP2', () => {
    let e = base();
    e = step(e, 102.5);                 // +1.25R → BE
    expect(e.stage).toBe('be');
    expect(e.slDyn).toBe(100);
    e = step(e, 103);                   // TP1 → partial 50%, runner
    expect(e.stage).toBe('runner');
    expect(e.banked).toBeCloseTo(0.75, 6);
    e = step(e, 106);                   // TP2 → koniec
    expect(e.result).toBe('tp2');
    expect(e.r).toBeCloseTo(2.25, 2);   // 0.75 + 0.5*3
  });

  it('trailing 1R za ceną w runnerze (fallback tickowy)', () => {
    let e = base();
    e = step(e, 103);                   // → runner (banked 0.75), slDyn = entry 100
    expect(e.stage).toBe('runner');
    e = step(e, 104);                   // trail = 104 - risk(2) = 102 > 100 → slDyn 102
    expect(e.slDyn).toBeCloseTo(102, 6);
    e = step(e, 101);                   // px <= slDyn(102) → stop w runnerze → tp1 (partial+trailing)
    expect(e.result).toBe('tp1');
  });
});
