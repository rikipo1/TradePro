import { describe, it, expect } from 'vitest';
import { sessionInfo, macroWindow } from '../src/utils/sessions.js';

/* Data w UTC — niezależna od strefy urządzenia (kluczowe dla M1). */
const utc = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo, d, h, mi));

describe('[M1] sessionInfo liczone z UTC (spójne live/backtest)', () => {
  it('weekend wykryty z UTC', () => {
    // 2026-07-11 to sobota
    const s = sessionInfo(utc(2026, 6, 11, 12, 0));
    expect(s.weekend).toBe(true);
    expect(s.quality).toBe(-2);
  });

  it('overlap London×NY (13:30–15:30 UTC) = najlepsza jakość', () => {
    // wtorek 2026-07-14 14:00 UTC
    const s = sessionInfo(utc(2026, 6, 14, 14, 0));
    expect(s.overlap).toBe(true);
    expect(s.quality).toBe(2);
  });

  it('sesja azjatycka = niska jakość', () => {
    const s = sessionInfo(utc(2026, 6, 14, 3, 0));
    expect(s.asia).toBe(true);
    expect(s.quality).toBeLessThan(0);
  });

  it('ta sama chwila UTC daje ten sam wynik (determinizm strefowy)', () => {
    const a = sessionInfo(utc(2026, 6, 14, 14, 0));
    const b = sessionInfo(new Date(Date.UTC(2026, 6, 14, 14, 0)));
    expect(a.label).toBe(b.label);
  });
});

describe('[M1] macroWindow z UTC', () => {
  it('otwarcie DAX (08:00 UTC) rozpoznane', () => {
    expect(macroWindow(utc(2026, 6, 14, 8, 5))).toBe('otwarcie DAX 09:00');
  });
  it('poza oknem → null', () => {
    expect(macroWindow(utc(2026, 6, 14, 3, 0))).toBeNull();
  });
});
