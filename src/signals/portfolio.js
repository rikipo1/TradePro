/* [E4-1] Portfolio Risk Engine — portfel, nie pojedyncza pozycja.
   portfolioCheck woła się PRZED riskStatus przy KAŻDYM otwarciu paper
   (ręcznym, z sygnału i z automatu). Zastępuje klasowe proxy z [A5].

   Pozycja: { sym, dir, riskPct, volR? } gdzie volR = ATR/slDist (ile dziennej
   zmienności mieści się w stopie; brak ⇒ 0.8, tj. slDist ≈ 1.25×ATR).
   corr: macierz z correlationMatrix (zwroty z zamknięć skanera). */

const RHO = (corr, a, b) => {
  if (a === b) return 1;
  if (!corr || !corr[a] || corr[a][b] == null) return null;
  return corr[a][b];
};

/* VaR-lite: parametryczny 1-dniowy VaR portfela (95%, z=1.65).
   Założenia (świadome uproszczenia — patrz komentarz):
   • zwroty dzienne ~ normalne (ogony niedoszacowane — dlatego limit 3%
     traktujemy twardo, nie orientacyjnie);
   • σ dziennego P&L pozycji i ≈ riskPct_i · volR_i — pozycja traci pełny
     riskPct przy ruchu o slDist, a slDist ≈ ATR/volR, więc ruch o 1×ATR
     (typowy dzień) przesuwa P&L o riskPct·volR punktu procentowego;
   • kowariancja przez ρ_ij·dir_i·dir_j (long DAX + short US500 przy ρ>0
     redukuje ryzyko, ten sam kierunek je dubluje). */
export function varLite(positions, corr, z = 1.65) {
  const ps = (positions || []).filter(p => (p.riskPct || 0) > 0);
  if (!ps.length) return 0;
  let variance = 0;
  for (const a of ps) {
    for (const b of ps) {
      const rho = a.sym === b.sym ? 1 : (RHO(corr, a.sym, b.sym) != null ? RHO(corr, a.sym, b.sym) : 0);
      const sa = (a.riskPct || 0) * (a.volR != null ? a.volR : 0.8);
      const sb = (b.riskPct || 0) * (b.volR != null ? b.volR : 0.8);
      variance += sa * sb * rho * (a.dir || 1) * (b.dir || 1);
    }
  }
  return +(z * Math.sqrt(Math.max(0, variance))).toFixed(3);
}

export function portfolioCheck(newPos, openPositions, corr, opts = {}) {
  const maxTotalRiskPct = opts.maxTotalRiskPct != null ? opts.maxTotalRiskPct : 2.0;
  const maxVaRPct = opts.maxVaRPct != null ? opts.maxVaRPct : 3.0;
  const corrLimit = opts.corrLimit != null ? opts.corrLimit : 0.7;
  const open = openPositions || [];

  /* 1) twardy cap sumarycznego ryzyka otwartych + nowej */
  const total = +(open.reduce((a, p) => a + (p.riskPct || 0), 0) + (newPos.riskPct || 0)).toFixed(3);
  if (total > maxTotalRiskPct) {
    return { allowed: false, scale: 0, reason: 'suma ryzyka pozycji ' + total + '% > limit ' + maxTotalRiskPct + '%' };
  }

  /* 2) korelacje: 1 skorelowana pozycja ⇒ ×0.5, ≥2 ⇒ blokada */
  let corrHits = 0; let hitWith = null;
  for (const p of open) {
    if (p.sym === newPos.sym) continue;
    const rho = RHO(corr, newPos.sym, p.sym);
    if (rho == null) continue;
    const sameRisk = (rho > corrLimit && p.dir === newPos.dir) || (rho < -corrLimit && p.dir === -newPos.dir);
    if (sameRisk) { corrHits++; hitWith = hitWith || (p.sym + ' (ρ ' + rho + ')'); }
  }
  if (corrHits >= 2) {
    return { allowed: false, scale: 0, reason: 'dwie otwarte pozycje skorelowane |ρ|>' + corrLimit + ' z nową — jedna ekspozycja ×3' };
  }
  const scale = corrHits === 1 ? 0.5 : 1;

  /* 3) VaR-lite portfela z nową pozycją */
  const scaled = { ...newPos, riskPct: (newPos.riskPct || 0) * scale };
  const var1d = varLite([...open, scaled], corr);
  if (var1d > maxVaRPct) {
    return { allowed: false, scale: 0, reason: 'VaR 1d portfela ' + var1d + '% > limit ' + maxVaRPct + '%', var1d };
  }

  return {
    allowed: true, scale, var1d,
    reason: scale < 1 ? ('korelacja z ' + hitWith + ' — ryzyko ×0.5') : null,
  };
}
