/* ---------------- Sizing pozycji (ETAP 3) ----------------
   Frakcyjny Kelly z vol-targetingiem. Zwraca sugerowane ryzyko na transakcję
   jako % kapitału. NIE jest to porada — to matematyka zarządzania ryzykiem.
   Wejście: prob (P win), rr (nagroda/ryzyko), volState, opcje.               */

export function positionSizing(prob, rr, opts = {}) {
  const kellyFraction = opts.kellyFraction != null ? opts.kellyFraction : 0.25; // ćwierć-Kelly (ostrożnie)
  const maxRiskPct = opts.maxRiskPct != null ? opts.maxRiskPct : 1.0;           // twardy limit % na trade
  const volState = opts.volState || 'normal';

  // Kelly dla wypłaty asymetrycznej: f* = (p*b - (1-p)) / b, b = rr
  const b = Math.max(0.1, rr || 1.5);
  const fullKelly = (prob * b - (1 - prob)) / b;
  let riskPct = Math.max(0, fullKelly) * kellyFraction * 100;

  // vol-targeting: przy wysokiej zmienności tniemy ryzyko, przy niskiej lekko podnosimy
  const volMult = volState === 'high' ? 0.6 : volState === 'low' ? 1.15 : 1.0;
  riskPct *= volMult;

  riskPct = Math.min(maxRiskPct, +riskPct.toFixed(2));
  return {
    riskPct,                       // % kapitału do zaryzykowania na tej transakcji
    fullKellyPct: +(Math.max(0, fullKelly) * 100).toFixed(1),
    edge: prob * b - (1 - prob),   // dodatnie = przewaga
    volMult,
  };
}
