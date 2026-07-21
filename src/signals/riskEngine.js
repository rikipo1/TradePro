/* ---------------- Risk Engine v2 (K3 + A5) ----------------
   Ryzyko na poziomie KONTA, nie pojedynczej transakcji:
   • dzienny limit strat (w R) liczony z ZAMKNIĘTYCH + FLOATING otwartych
     pozycji (floating liczy się WYŁĄCZNIE na minus — zysk papierowy nie
     „odrabia" limitu, bo może wyparować)
   • limit jednoczesnych pozycji (maxOpen, domyślnie 2) — DAX+US500+NAS100
     to często jedna ekspozycja ×3
   • kill-switch po serii strat z rzędu
   • doba liczona w UTC (sesje/dane makro są w UTC — strefa telefonu nie
     może przesuwać resetu limitu)
   Blokuje wyłącznie AUTOMAT — decyzja ręczna zostaje po stronie użytkownika.
   live: { floatingR, openCount } — brak = zachowanie wsteczne (bez floating
   i bez limitu otwartych). */

export function riskStatus(journal, opts = {}, live = null) {
  const maxDailyLossR = opts.maxDailyLossR != null ? opts.maxDailyLossR : 3;
  const maxConsecLoss = opts.maxConsecLoss != null ? opts.maxConsecLoss : 4;
  const maxOpen = opts.maxOpen != null ? opts.maxOpen : 2;

  const closed = (journal || []).filter(e => e.result && e.result !== 'open' && e.result !== 'pending');
  const now = new Date();
  /* [A5] północ UTC, nie lokalna */
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const today = closed.filter(e => (e.exitTs || e.ts || 0) >= dayStart);
  const dailyR = +today.reduce((a, e) => a + (e.r || 0), 0).toFixed(2);

  const floatingR = (live && live.floatingR != null) ? +live.floatingR : 0;
  /* floating TYLKO na minus */
  const effDailyR = +(dailyR + Math.min(0, floatingR)).toFixed(2);

  const openCount = (live && live.openCount != null) ? live.openCount : null;
  const openLimitHit = openCount != null && openCount >= maxOpen;

  let consec = 0;
  const sorted = closed.slice().sort((a, b) => (b.exitTs || b.ts || 0) - (a.exitTs || a.ts || 0));
  for (const e of sorted) { if ((e.r || 0) < 0) consec++; else break; }

  const lossLimitHit = effDailyR <= -maxDailyLossR;
  const streakHit = consec >= maxConsecLoss;
  const blocked = lossLimitHit || streakHit || openLimitHit;
  let reason = null;
  if (lossLimitHit) {
    reason = 'dzienny limit strat ' + effDailyR + 'R (próg −' + maxDailyLossR + 'R'
      + (floatingR < 0 ? ', w tym floating ' + floatingR + 'R' : '') + ')';
  } else if (streakHit) {
    reason = 'seria ' + consec + ' strat z rzędu';
  } else if (openLimitHit) {
    reason = 'limit ' + maxOpen + ' jednocześnie otwartych pozycji (otwarte: ' + openCount + ')';
  }
  return { dailyR, effDailyR, floatingR, openCount, consecLosses: consec, blocked, reason };
}
