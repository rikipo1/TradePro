/* ---------------- Etap lejka decyzyjnego przy CZEKAJ ----------------
   Gdy silnik mówi CZEKAJ, użytkownik chce wiedzieć: (a) w którą stronę
   przechyla się rynek (lean ▲/▼), (b) jak daleko sygnał doszedł w lejku
   bramek, zanim został wstrzymany. Czysta funkcja na wyniku computeSignal.

   Lejek (kolejność bramek w silniku):
     1. konsensus kierunku (czynniki)
     2. filary 2/3 (struktura/momentum/lokalizacja)
     3. bramki jakości (kontra HTF / reżim / gonienie ruchu)
     4. poziomy + RR do struktury
     5. EV / P(win)
     6. sesja (ostatnia bramka — setup był gotowy)                 */

export const WAIT_STAGES = 6;

export function waitStage(sig) {
  if (!sig || sig.dir !== 0 || sig.stale) return null;
  const warns = sig.warns || [];
  const has = re => warns.some(w => re.test(w));

  /* przechył kierunkowy: score → filary → HTF */
  let lean = sig.score > 5 ? 1 : sig.score < -5 ? -1 : 0;
  if (lean === 0 && sig.pillars) {
    lean = sig.pillars.bull > sig.pillars.bear ? 1 : sig.pillars.bull < sig.pillars.bear ? -1 : 0;
  }
  if (lean === 0) lean = sig.htfDir || 0;

  let stage, label;
  if (sig.sessionBlock) { stage = 6; label = 'setup GOTOWY — blokuje tylko sesja'; }
  else if (sig.evBlock) { stage = 5; label = 'poziomy są — EV/P(win) poniżej progu'; }
  else if (sig.rrBlock) { stage = 4; label = 'kierunek jest — struktura blokuje RR'; }
  else if (has(/wyższemu interwałowi|konsolidacji|gonienie ruchu|wstrzymane do cofnięcia/)) {
    stage = 3; label = 'kierunek jest — bramka jakości wstrzymała';
  }
  else if (has(/zgodnych filarów/)) { stage = 2; label = 'przechył jest — filary niezgodne (min 2/3)'; }
  else { stage = 1; label = 'brak konsensusu kierunku'; }

  return { lean, stage, stages: WAIT_STAGES, label };
}
