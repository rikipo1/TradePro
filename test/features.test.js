import { describe, it, expect } from 'vitest';
import { extractFactors, orientedVector, FACTOR_KEYS } from '../src/signals/features.js';

describe('[C5] orientedVector — dir=-1 odwraca znaki', () => {
  const factors = { trend: 0.5, momentum: -0.3, location: 0.2, liquidity: 0.4, confirmation: -0.1, htf: 0.6 };
  it('dir=1 → wartości bez zmian', () => {
    const v = orientedVector(factors, 1);
    for (const k of FACTOR_KEYS) expect(v[k]).toBeCloseTo(factors[k], 9);
  });
  it('dir=-1 → wszystkie znaki odwrócone', () => {
    const v = orientedVector(factors, -1);
    for (const k of FACTOR_KEYS) expect(v[k]).toBeCloseTo(-factors[k], 9);
  });
});

describe('[C5] extractFactors — clamp do [-1,1]', () => {
  it('ekstremalne wejścia nie wychodzą poza [-1,1]', () => {
    const f = extractFactors({
      price: 100, atr: 1, v20: 1, v50: 2, v200: 3,
      rsi: 500, macdM: 10, macdS: -10, macdH: 9, macdHp: -9,
      stochK: 5, stochD: 90, stochKp: 4, stochDp: 95,
      vw: 1, smc: { ms: { trend: 1 }, pd: { zone: 'discount' }, sweep: { dir: 1 }, bc: { bos: 1, choch: 1 }, disp: 1 },
      nearSup: { hi: 99.7, lo: 99 }, nearRes: null, relVol: { spike: true, dir: 1 },
      htfDir: 1, liquidity: { magnets: [{ px: 100.2, weight: 5 }] },
    });
    for (const k of FACTOR_KEYS) {
      expect(f[k]).toBeGreaterThanOrEqual(-1);
      expect(f[k]).toBeLessThanOrEqual(1);
    }
    expect(f.dirConsensus).toBeGreaterThanOrEqual(-1);
    expect(f.dirConsensus).toBeLessThanOrEqual(1);
  });

  it('brak danych → czynniki zerowe/neutralne', () => {
    const f = extractFactors({ price: 100, atr: 1 });
    for (const k of FACTOR_KEYS) expect(Number.isFinite(f[k])).toBe(true);
  });
});
