import { describe, it, expect } from 'vitest';
import { fitIsotonic, applyIsotonic, brierScore, predictProb, trainLogistic, DEFAULT_WEIGHTS } from '../src/signals/model.js';

describe('model: fitIsotonic monotoniczność', () => {
  it('wyjście niemalejące względem p', () => {
    // p rosnące od 0.1..0.9, y stochastyczne ale z trendem
    const pairs = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 300; i++) {
      const p = 0.1 + 0.8 * (i / 300);
      const y = rnd() < p ? 1 : 0;
      pairs.push({ p, y });
    }
    const calib = fitIsotonic(pairs, 150);
    expect(calib).not.toBeNull();
    // v bloków musi być NIEMALEJĄCE
    for (let i = 1; i < calib.length; i++) {
      expect(calib[i].v).toBeGreaterThanOrEqual(calib[i - 1].v - 1e-9);
    }
    // applyIsotonic też monotoniczne po p
    let prev = -1;
    for (let p = 0.05; p <= 0.95; p += 0.05) {
      const q = applyIsotonic(p, calib);
      expect(q).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = q;
    }
  });

  it('fitIsotonic zwraca null przy zbyt małej próbie', () => {
    expect(fitIsotonic([{ p: 0.5, y: 1 }], 150)).toBeNull();
  });
});

describe('[M6] applyIsotonic — bloki stykające się (bez dzielenia przez ~0)', () => {
  it('gdy next.lo <= calib[i].hi nie interpoluje / nie ekstrapoluje', () => {
    // dwa bloki dzielące granicę (hi==lo)
    const calib = [
      { lo: 0.1, hi: 0.4, v: 0.3 },
      { lo: 0.4, hi: 0.7, v: 0.6 },
    ];
    // p pomiędzy — bez NaN/Infinity, wynik w [0.02,0.98]
    const q = applyIsotonic(0.4000001, calib);
    expect(Number.isFinite(q)).toBe(true);
    expect(q).toBeGreaterThanOrEqual(0.02);
    expect(q).toBeLessThanOrEqual(0.98);
    // dokładnie na granicy → wartość pierwszego bloku
    expect(applyIsotonic(0.4, calib)).toBeCloseTo(0.3, 6);
  });

  it('nachodzące bloki (next.lo < calib[i].hi) nie dają wartości spoza sąsiadów', () => {
    const calib = [
      { lo: 0.1, hi: 0.5, v: 0.3 },
      { lo: 0.45, hi: 0.8, v: 0.6 },
    ];
    const q = applyIsotonic(0.48, calib);
    expect(Number.isFinite(q)).toBe(true);
    expect(q).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(q).toBeLessThanOrEqual(0.6 + 1e-9);
  });
});

describe('model: brierScore', () => {
  it('liczy średni (p-y)^2', () => {
    const b = brierScore([{ p: 1, y: 1 }, { p: 0, y: 0 }, { p: 0.5, y: 1 }]);
    expect(b).toBeCloseTo((0 + 0 + 0.25) / 3, 4);
  });
  it('pusta lista → null', () => { expect(brierScore([])).toBeNull(); });
});

describe('model: trainLogistic próg', () => {
  it('<30 próbek → wagi domyślne, trained=false', () => {
    const r = trainLogistic([{ x: {}, y: 1 }]);
    expect(r.trained).toBe(false);
    expect(r.weights).toEqual(DEFAULT_WEIGHTS);
  });
  it('reliable dopiero od 150 próbek', () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ x: { trend: (i % 2) ? 1 : -1 }, y: i % 2 }));
    expect(trainLogistic(mk(120)).reliable).toBe(false);
    expect(trainLogistic(mk(160)).reliable).toBe(true);
  });
});
