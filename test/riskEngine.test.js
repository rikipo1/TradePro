import { describe, it, expect } from 'vitest';
import { riskStatus } from '../src/signals/riskEngine.js';

const now = Date.now();
const closed = (r, ts) => ({ result: r <= 0 ? 'sl' : 'tp1', r, exitTs: ts != null ? ts : now });

describe('[M5] riskStatus — dzienny limit strat', () => {
  it('blokuje po przekroczeniu dziennego limitu (−3R domyślnie)', () => {
    const journal = [closed(-1), closed(-1), closed(-1.5)]; // −3.5R dziś
    const rs = riskStatus(journal, { maxDailyLossR: 3, maxConsecLoss: 99 });
    expect(rs.blocked).toBe(true);
    expect(rs.dailyR).toBeCloseTo(-3.5, 2);
    expect(rs.reason).toMatch(/dzienny limit/);
  });

  it('nie blokuje gdy dzienna strata < limit', () => {
    const journal = [closed(-1), closed(0.5)];
    const rs = riskStatus(journal, { maxDailyLossR: 3, maxConsecLoss: 99 });
    expect(rs.blocked).toBe(false);
  });

  it('straty z poprzednich dni nie liczą się do dziennego limitu', () => {
    const yesterday = now - 26 * 3600 * 1000;
    const journal = [closed(-2, yesterday), closed(-2, yesterday), closed(-0.5)];
    const rs = riskStatus(journal, { maxDailyLossR: 3, maxConsecLoss: 99 });
    expect(rs.dailyR).toBeCloseTo(-0.5, 2);
    expect(rs.blocked).toBe(false);
  });
});

describe('[M5] riskStatus — seria strat (kill-switch)', () => {
  it('blokuje po 4 stratach z rzędu (domyślnie)', () => {
    const journal = [closed(1, now - 5000), closed(-1, now - 4000), closed(-1, now - 3000), closed(-1, now - 2000), closed(-1, now - 1000)];
    const rs = riskStatus(journal, { maxDailyLossR: 99, maxConsecLoss: 4 });
    expect(rs.consecLosses).toBe(4);
    expect(rs.blocked).toBe(true);
    expect(rs.reason).toMatch(/seria/);
  });

  it('wygrana przerywa serię', () => {
    const journal = [closed(-1, now - 4000), closed(-1, now - 3000), closed(1, now - 2000), closed(-1, now - 1000)];
    const rs = riskStatus(journal, { maxDailyLossR: 99, maxConsecLoss: 4 });
    expect(rs.consecLosses).toBe(1); // tylko ostatnia strata po wygranej
    expect(rs.blocked).toBe(false);
  });

  it('otwarte/pending pozycje ignorowane', () => {
    const journal = [{ result: 'open', r: 0 }, { result: 'pending' }, closed(-1), closed(-1), closed(-1), closed(-1)];
    const rs = riskStatus(journal, { maxDailyLossR: 99, maxConsecLoss: 4 });
    expect(rs.blocked).toBe(true);
  });
});
