/* [E2-3] Potwierdzenie modelu dwoma treningami (anty multiple-testing).
   Jeden przebieg k-fold, który przeszedł progi, może być szczęśliwym trafem
   po wielu próbach. Pełny tryb (wagi+kalibracja live) aktywuje dopiero DRUGI
   kolejny trening z reliable=true, wykonany ≥24 h po pierwszym (na nowszych/
   dłuższych danych). Trening z reliable=false zeruje licznik.

   Stany: 'off' → 'candidate' (1/2, wagi zapisane ale NIEaktywne)
        → 'active' (2/2, pełny tryb). */

export const CONFIRM_GAP_MS = 24 * 3600 * 1000;

export function nextModelStage(prevMeta, kfReliable, now) {
  now = now != null ? now : Date.now();
  if (!kfReliable) {
    return { stage: 'off', streak: 0, candidateAt: null };
  }
  const prevStage = prevMeta && prevMeta.stage;
  const candidateAt = prevMeta && prevMeta.candidateAt;
  if (prevStage === 'active') {
    /* model już aktywny — kolejny reliable trening podtrzymuje aktywację */
    return { stage: 'active', streak: (prevMeta.reliableStreak || 2), candidateAt: candidateAt || now };
  }
  if (prevStage === 'candidate' && candidateAt != null) {
    if (now - candidateAt >= CONFIRM_GAP_MS) {
      return { stage: 'active', streak: 2, candidateAt };
    }
    /* drugi trening za wcześnie — kandydatura trwa, okno 24 h liczy się
       od PIERWSZEGO potwierdzenia */
    return { stage: 'candidate', streak: 1, candidateAt };
  }
  return { stage: 'candidate', streak: 1, candidateAt: now };
}

export function stageLabel(meta) {
  if (!meta) return 'brak modelu';
  if (meta.stage === 'active') return 'AKTYWNY (potwierdzony 2 treningami)';
  if (meta.stage === 'candidate') return 'kandydat 1/2 — wagi zapisane, live nadal na domyślnych';
  return 'niewiarygodny — live na wagach domyślnych';
}
