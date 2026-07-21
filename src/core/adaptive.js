/* [E4-3] Adaptive Learning Control — zmiana parametrów toru decyzyjnego
   wymaga walidacji: k-fold z NOWYMI parametrami vs k-fold ze STARYMI na
   TYCH SAMYCH świecach. Nowe gorsze ⇒ automatyczny rollback wartości. */

export function compareValidation(oldRes, newRes) {
  if (!newRes || !newRes.ok) {
    return { accept: false, reasons: ['przebieg z nowymi parametrami nieudany: ' + (newRes && newRes.reason ? newRes.reason : 'brak wyniku')] };
  }
  if (!oldRes || !oldRes.ok) {
    /* bazowy się nie policzył (np. za mało próbek) — nie ma do czego porównać;
       akceptacja warunkowa z adnotacją w logu */
    return { accept: true, reasons: ['brak bazowego przebiegu (' + (oldRes && oldRes.reason ? oldRes.reason : '—') + ') — akceptacja warunkowa'] };
  }
  const reasons = [];
  const om = oldRes.agg && oldRes.agg.avgR ? oldRes.agg.avgR.med : null;
  const nm = newRes.agg && newRes.agg.avgR ? newRes.agg.avgR.med : null;
  if (om != null && (nm == null || nm < om - 0.02)) {
    reasons.push('med(avgR) OOS spadło: ' + om + 'R → ' + (nm == null ? '—' : nm + 'R'));
  }
  const ob = oldRes.agg && oldRes.agg.brier ? oldRes.agg.brier.p75 : null;
  const nb = newRes.agg && newRes.agg.brier ? newRes.agg.brier.p75 : null;
  if (ob != null && nb != null && nb > ob + 0.01) {
    reasons.push('Brier p75 OOS wzrosło: ' + ob + ' → ' + nb);
  }
  return { accept: reasons.length === 0, reasons };
}

export function summarizeRun(res) {
  if (!res || !res.ok) return 'nieudany: ' + (res && res.reason ? res.reason : '—');
  return 'n_oos=' + res.totalNoos + ' medAvgR=' + (res.agg.avgR.med != null ? res.agg.avgR.med : '—')
    + ' brierP75=' + (res.agg.brier.p75 != null ? res.agg.brier.p75 : '—');
}
