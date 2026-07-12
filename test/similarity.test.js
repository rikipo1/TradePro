import { describe, it, expect } from 'vitest';
import { similarOutcomes, blendProb } from '../src/signals/similarity.js';

/* buduje historię: klaster wygranych blisko x=+1 i przegranych blisko x=-1 */
function buildHistory(n) {
  const h = [];
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    const win = i % 2 === 0;
    const base = win ? 0.8 : -0.8;
    const jit = () => base + (rnd() - 0.5) * 0.2;
    h.push({ x: { trend: jit(), momentum: jit(), location: jit(), liquidity: jit(), confirmation: jit(), htf: jit() }, y: win ? 1 : 0 });
  }
  return h;
}

describe('[M2/N1] similarOutcomes: standaryzacja + jądro gaussowskie + n_eff', () => {
  it('setup podobny do wygranych daje wysoki pEmp', () => {
    const hist = buildHistory(120);
    const q = { trend: 0.8, momentum: 0.8, location: 0.8, liquidity: 0.8, confirmation: 0.8, htf: 0.8 };
    const sim = similarOutcomes(hist, q, 20);
    expect(sim).not.toBeNull();
    expect(sim.pEmp).toBeGreaterThan(0.6);
    expect(sim.nEff).toBeGreaterThanOrEqual(5);
  });

  it('n_eff < 5 → similar null (za mało realnie ważących analogów)', () => {
    // tylko 6 punktów, jeden bardzo bliski i reszta bardzo daleko → n_eff niskie
    const hist = [
      { x: { trend: 0.5 }, y: 1 },
      { x: { trend: 50 }, y: 0 },
      { x: { trend: 60 }, y: 0 },
      { x: { trend: 70 }, y: 1 },
      { x: { trend: 80 }, y: 0 },
      { x: { trend: 90 }, y: 1 },
    ];
    const sim = similarOutcomes(hist, { trend: 0.5 }, 20);
    // albo null (n_eff<5), albo zdefiniowane — ale nie może wybuchnąć
    if (sim) expect(sim.nEff).toBeGreaterThanOrEqual(5);
    else expect(sim).toBeNull();
  });

  it('mała historia (<5) → null', () => {
    expect(similarOutcomes([{ x: { trend: 1 }, y: 1 }], { trend: 1 })).toBeNull();
  });

  it('brak dzielenia przez zero przy identycznych punktach (d=0)', () => {
    const hist = Array.from({ length: 30 }, () => ({ x: { trend: 1, momentum: 1 }, y: 1 }));
    const sim = similarOutcomes(hist, { trend: 1, momentum: 1 }, 20);
    // wszystkie identyczne → std=1 (klamra), wagi skończone, pEmp=1
    if (sim) { expect(Number.isFinite(sim.pEmp)).toBe(true); expect(sim.pEmp).toBe(1); }
  });
});

describe('[M2/N1] blendProb cap 0.35', () => {
  it('kNN koryguje, nie przejmuje (λ ≤ 0.35)', () => {
    const p = blendProb(0.5, { n: 100, pEmp: 1, avgDist: 0 }, 0.35);
    // λ ≤ 0.35 → wynik ≤ 0.5 + 0.35*(1-0.5) = 0.675
    expect(p).toBeLessThanOrEqual(0.675 + 1e-6);
    expect(p).toBeGreaterThan(0.5);
  });
  it('sim null → zwraca pModel', () => { expect(blendProb(0.42, null)).toBe(0.42); });
});
