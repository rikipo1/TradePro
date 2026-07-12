import { describe, it, expect } from 'vitest';
import { marketStructure } from '../src/smc/index.js';

/* potwierdzone piwoty: HH+HL (trend wzrostowy) */
const confirmed = [
  { i: 2, p: 100, t: 'L' },
  { i: 5, p: 110, t: 'H' },
  { i: 8, p: 104, t: 'L' },
  { i: 12, p: 118, t: 'H' },
  { i: 15, p: 108, t: 'L' },
];

describe('[W6] marketStructure używa tylko POTWIERDZONYCH piwotów', () => {
  it('dodanie live-pivotu NIE zmienia lastSwingHigh/Low (baza SL)', () => {
    const base = marketStructure(confirmed, 20);
    // dopisz niepotwierdzony live-pivot (świeży szczyt) — jak zigzag na końcu
    const withLive = confirmed.concat([{ i: 18, p: 130, t: 'H', live: true }]);
    const ms = marketStructure(withLive, 20); // domyślnie useLive=false
    expect(ms.lastSwingHigh.p).toBe(base.lastSwingHigh.p);
    expect(ms.lastSwingLow.p).toBe(base.lastSwingLow.p);
    expect(ms.trend).toBe(base.trend);
  });

  it('useLive=true DOPUSZCZA live-pivot (zmienia strukturę) — tylko do UI', () => {
    const withLive = confirmed.concat([{ i: 18, p: 130, t: 'H', live: true }]);
    const ms = marketStructure(withLive, 20, { useLive: true });
    expect(ms.lastSwingHigh.p).toBe(130); // teraz live szczyt wchodzi
  });

  it('live-pivot potwierdzony (bez flagi live) JUŻ zmienia strukturę', () => {
    const nowConfirmed = confirmed.concat([{ i: 18, p: 130, t: 'H' }]);
    const ms = marketStructure(nowConfirmed, 20);
    expect(ms.lastSwingHigh.p).toBe(130);
  });
});
