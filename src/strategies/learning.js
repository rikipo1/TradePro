/* ---------------- System uczenia rankingu strategii ----------------
   Po każdej ZAMKNIĘTEJ transakcji z polem strategy (wpisy otwierane z
   rankingu) statystyki per strategia liczone są Z CAŁEGO dziennika —
   czysta funkcja, zero mutowalnego stanu, więc nie ma dryfu.

   ANTY-OVERFITTING: korekta wyniku strategii używa ŚCIĄGANIA (shrinkage)
   do neutralności — empiryczna trafność liczy się proporcjonalnie do
   n/(n+K), K=20. Jedna transakcja przesuwa scoring o ułamek punktu;
   dopiero dziesiątki transakcji realnie zmieniają ranking. Poniżej
   MIN_N=10 korekta wynosi 0 (czysty prior). */

export const SHRINK_K = 20;
export const MIN_N = 10;
export const MAX_ADJ = 15; // maks. wpływ uczenia na score (punkty %)

const CLOSED = e => e.result && e.result !== 'open' && e.result !== 'pending' && e.result !== 'cancelled';

export function strategyStatsFromJournal(journal) {
  const by = {};
  for (const e of (journal || [])) {
    if (!e.strategy || !CLOSED(e)) continue;
    const s = by[e.strategy] || (by[e.strategy] = { n: 0, wins: 0, sumR: 0 });
    s.n++;
    if ((e.r || 0) > 0.2) s.wins++;
    s.sumR += (e.r || 0);
  }
  for (const k in by) {
    by[k].winRate = +(by[k].wins / by[k].n).toFixed(3);
    by[k].avgR = +(by[k].sumR / by[k].n).toFixed(3);
  }
  return by;
}

/* korekta score (punkty −MAX_ADJ..+MAX_ADJ): kierunek z avgR, siła z n */
export function learnAdjust(stats, stratId) {
  const s = stats && stats[stratId];
  if (!s || s.n < MIN_N) return 0;
  const weight = s.n / (s.n + SHRINK_K);               // 10 tr → 0.33, 40 tr → 0.67
  const quality = Math.max(-1, Math.min(1, s.avgR / 0.5)); // ±0.5R avg = pełna skala
  return Math.round(MAX_ADJ * weight * quality);
}

/* opis do Explain AI */
export function learnNote(stats, stratId) {
  const s = stats && stats[stratId];
  if (!s) return 'brak historii transakcji tej strategii — czysty prior';
  if (s.n < MIN_N) return 'historia: ' + s.n + ' tr (za mało na korektę — min ' + MIN_N + ')';
  return 'historia: ' + s.n + ' tr · traf. ' + Math.round(s.winRate * 100) + '% · avg '
    + s.avgR + 'R → korekta ' + (learnAdjust(stats, stratId) >= 0 ? '+' : '') + learnAdjust(stats, stratId) + ' pkt';
}
