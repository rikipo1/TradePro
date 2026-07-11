import { describe, it, expect } from 'vitest';
import { factorCorrelation, printFactorCorrelation } from '../scripts/factorCorr.js';
import { FACTOR_KEYS } from '../src/signals/features.js';

describe('[W2] factorCorr — macierz 6×6', () => {
  it('zwraca macierz 6×6 z jedynkami na przekątnej', () => {
    const samples = [];
    let seed = 5;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 100; i++) {
      const t = rnd() * 2 - 1;
      samples.push({ x: { trend: t, momentum: t * 0.9 + (rnd() - 0.5) * 0.1, location: rnd() * 2 - 1,
        liquidity: rnd() * 2 - 1, confirmation: rnd() * 2 - 1, htf: rnd() * 2 - 1 } });
    }
    const { keys, matrix } = factorCorrelation(samples);
    expect(keys).toEqual(FACTOR_KEYS);
    expect(matrix.length).toBe(6);
    matrix.forEach(row => expect(row.length).toBe(6));
    for (let i = 0; i < 6; i++) expect(matrix[i][i]).toBeCloseTo(1, 6);
    // trend i momentum silnie skorelowane (skonstruowane) → >0.6
    const ti = keys.indexOf('trend'), mi = keys.indexOf('momentum');
    expect(Math.abs(matrix[ti][mi])).toBeGreaterThan(0.6);
  });

  it('printFactorCorrelation drukuje i wykrywa duplikaty', () => {
    const lines = [];
    const samples = Array.from({ length: 20 }, (_, i) => ({ x: { trend: i, momentum: i, location: -i, liquidity: 0, confirmation: 0, htf: 0 } }));
    const r = printFactorCorrelation(samples, (s) => lines.push(s));
    expect(lines.length).toBeGreaterThan(0);
    // trend==momentum → corr 1 > 0.6 → w duplikatach
    expect(r.dup.some(d => d.includes('trend×momentum'))).toBe(true);
  });
});
