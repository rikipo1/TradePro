/* [E3-6] Bramki toru decyzyjnego wydzielone z computeSignal BEZ zmiany
   zachowania (golden testy 1:1). Każda bramka to czysta funkcja: dostaje
   stan, zwraca decyzję + ewentualny komunikat — engine składa całość.
   Kolejność stosowania (ustala engine): pillars → HTF → reżim → chase
   → RR (levels.js) → EV → sesja. */

import { expectedValueR, expectedValueEmpirical } from './model.js';

/* zgoda min. 2 z 3 filarów (deconfounding kierunku) */
export function pillarGate(dir, bullPillars, bearPillars) {
  if (dir === 1 && bullPillars < 2) return { dir: 0, warn: 'Za mało zgodnych filarów (struktura/momentum/lokalizacja) — LONG odrzucony' };
  if (dir === -1 && bearPillars < 2) return { dir: 0, warn: 'Za mało zgodnych filarów (struktura/momentum/lokalizacja) — SHORT odrzucony' };
  return { dir, warn: null };
}

/* kontra wyższego interwału tylko przy wysokim P(win) */
export function htfContraGate(dir, htfDir, prob) {
  if (dir !== 0 && htfDir !== 0 && dir !== htfDir && prob < 0.66) {
    return { dir: 0, warn: 'Sygnał przeciw wyższemu interwałowi przy niskim P(win) — odrzucony' };
  }
  return { dir, warn: null };
}

/* reżim konsolidacji wymaga wyższego P(win) dla setupu trendowego */
export function regimeGate(dir, regimeType, prob) {
  if (dir !== 0 && regimeType === 'range' && prob < 0.60) {
    return { dir: 0, warn: 'Reżim konsolidacji (ADX/efektywność niskie) — setup trendowy za słaby, odrzucony' };
  }
  return { dir, warn: null };
}

/* gonienie ruchu: blokada przy waitPullback, inaczej tylko ostrzeżenie */
export function chaseGate(dir, eqChase, prob, waitPB, bestDist, bestName) {
  if (dir !== 0 && eqChase && prob < 0.66) {
    const distTxt = bestDist != null ? bestDist.toFixed(1) : '?';
    if (waitPB) {
      return { dir: 0, warn: 'Cena ' + distTxt + '×ATR od ' + bestName + ' — gonienie ruchu, wstrzymane do cofnięcia' };
    }
    return { dir, warn: 'Cena ' + distTxt + '×ATR od ' + bestName + ' — wejście „w biegu", rozważ cofnięcie' };
  }
  return { dir, warn: null };
}

/* bramka EV: empiryczna dystrybucja wypłat (payout z pooled OOS) albo
   liniowy fallback; koszt spreadu ×costMult (okno makro [E3-3]) */
export function evGate(prob, levels, payout, costMult, minProb) {
  let costR = levels.slDist > 0 ? (levels.spreadPx / levels.slDist) : 0;
  costR *= (costMult != null ? costMult : 1);
  const evEmp = payout ? expectedValueEmpirical(prob, payout, costR) : null;
  const ev = evEmp != null ? evEmp : expectedValueR(prob, levels.rr1 || 1.5, costR);
  const evModel = evEmp != null ? 'empirical' : 'linear';
  if (prob < minProb || ev <= 0) {
    return {
      pass: false, ev, evModel,
      warn: 'Odrzucony przez EV/prob: P(win) ' + Math.round(prob * 100) + '% · EV ' + ev.toFixed(2) + 'R (próg P ' + Math.round(minProb * 100) + '%, wymagane EV>0)',
    };
  }
  return { pass: true, ev, evModel, warn: null };
}

/* filtr sesji: weekend/cienki rynek blokuje, overlap premiuje */
export function sessionGate(sess, prob) {
  if (sess.weekend) return { action: 'block', warn: 'Rynek zamknięty (' + sess.label + ') — wejście zablokowane' };
  if (sess.quality < 0 && prob < 0.66) return { action: 'block', warn: 'Słabe okno płynności: ' + sess.label + ' — sygnał wstrzymany (graj w London/NY albo czekaj na mocny setup)' };
  if (sess.quality < 0) return { action: 'warn', warn: 'Słabe okno płynności: ' + sess.label + ' — traktuj ostrożnie, cieńszy rynek' };
  if (sess.overlap) return { action: 'bonus', warn: null };
  return { action: null, warn: null };
}
