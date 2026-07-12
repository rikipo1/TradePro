import { describe, it, expect } from 'vitest';
import { positionSizing } from '../src/signals/sizing.js';

describe('[W3] sizing fixed-fractional (domyślny)', () => {
  it('fixed: ryzyko stałe niezależnie od prob', () => {
    const lo = positionSizing(0.55, 1.5, { mode: 'fixed', fixedRiskPct: 0.5 });
    const hi = positionSizing(0.95, 1.5, { mode: 'fixed', fixedRiskPct: 0.5 });
    expect(lo.mode).toBe('fixed');
    expect(lo.riskPct).toBe(hi.riskPct);
    expect(lo.riskPct).toBe(0.5);
  });

  it('domyślny tryb to fixed 0.5%', () => {
    const s = positionSizing(0.8, 2);
    expect(s.mode).toBe('fixed');
    expect(s.riskPct).toBe(0.5);
  });

  it('vol-targeting: high tnie, low podnosi ryzyko', () => {
    expect(positionSizing(0.6, 1.5, { volState: 'high' }).riskPct).toBeCloseTo(0.3, 6);
    expect(positionSizing(0.6, 1.5, { volState: 'low' }).riskPct).toBe(0.57); // 0.5*1.15=0.575→0.57 (fp)
  });
});

describe('[W3] Kelly wyłączony do czasu kalibracji', () => {
  it('mode kelly bez calibrated → degraduje do fixed', () => {
    const s = positionSizing(0.9, 2, { mode: 'kelly', fixedRiskPct: 0.5 });
    expect(s.mode).toBe('fixed');
    expect(s.riskPct).toBe(0.5);
  });

  it('mode kelly z calibrated=true → używa Kelly (zależny od prob)', () => {
    const s = positionSizing(0.9, 2, { mode: 'kelly', calibrated: true, maxRiskPct: 50 });
    expect(s.mode).toBe('kelly');
    // f* = (0.9*2 - 0.1)/2 = 0.85 → ćwierć-Kelly = 21.25%
    expect(s.riskPct).toBeCloseTo(21.25, 4);
    const low = positionSizing(0.55, 2, { mode: 'kelly', calibrated: true, maxRiskPct: 50 });
    expect(low.riskPct).toBeLessThan(s.riskPct);
  });

  it('przy calibrated=false wynik niezależny od prob', () => {
    const a = positionSizing(0.55, 2, { mode: 'kelly', calibrated: false });
    const b = positionSizing(0.99, 2, { mode: 'kelly', calibrated: false });
    expect(a.riskPct).toBe(b.riskPct);
  });
});
