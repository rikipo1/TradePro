/* ---------------- Risk Engine (K3) ----------------
   Ryzyko na poziomie KONTA, nie pojedynczej transakcji:
   • dzienny limit strat (w R) — po przekroczeniu auto-trade stop do końca dnia
   • kill-switch po serii strat z rzędu
   Blokuje wyłącznie AUTOMAT — decyzja ręczna zostaje po stronie użytkownika. */

export function riskStatus(journal, opts = {}) {
  const maxDailyLossR = opts.maxDailyLossR != null ? opts.maxDailyLossR : 3;
  const maxConsecLoss = opts.maxConsecLoss != null ? opts.maxConsecLoss : 4;

  const closed = (journal || []).filter(e => e.result && e.result !== 'open');
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const today = closed.filter(e => (e.exitTs || e.ts || 0) >= dayStart);
  const dailyR = +today.reduce((a, e) => a + (e.r || 0), 0).toFixed(2);

  let consec = 0;
  const sorted = closed.slice().sort((a, b) => (b.exitTs || b.ts || 0) - (a.exitTs || a.ts || 0));
  for (const e of sorted) { if ((e.r || 0) < 0) consec++; else break; }

  const lossLimitHit = dailyR <= -maxDailyLossR;
  const streakHit = consec >= maxConsecLoss;
  const blocked = lossLimitHit || streakHit;
  return {
    dailyR, consecLosses: consec, blocked,
    reason: blocked
      ? (lossLimitHit ? ('dzienny limit strat ' + dailyR + 'R (próg −' + maxDailyLossR + 'R)') : ('seria ' + consec + ' strat z rzędu'))
      : null,
  };
}
