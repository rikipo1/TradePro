/* ---------------- Sizing pozycji (ETAP 3 + E4-2) ----------------
   Frakcyjny Kelly z vol-targetingiem, spójne wejście alokacji kapitału:
   • edge i Kelly liczone Z KOSZTEM transakcyjnym (costR) — bez tego sizing
     przeszacowywał przewagę dokładnie o koszt,
   • opts.scale — skala z portfolioCheck (korelacje portfela),
   • opts.ddR — bieżący drawdown dziennika w R; > 5R ⇒ „tryb obronny"
     (ryzyko ×0.5, komunikat w UI).
   Zwraca sugerowane ryzyko na transakcję jako % kapitału. NIE jest to
   porada — to matematyka zarządzania ryzykiem. */

export function positionSizing(prob, rr, opts = {}) {
  const kellyFraction = opts.kellyFraction != null ? opts.kellyFraction : 0.25; // ćwierć-Kelly (ostrożnie)
  const maxRiskPct = opts.maxRiskPct != null ? opts.maxRiskPct : 1.0;           // twardy limit % na trade
  const volState = opts.volState || 'normal';
  const scale = opts.scale != null ? opts.scale : 1;
  const costR = opts.costR != null ? opts.costR : 0;
  const ddR = opts.ddR != null ? opts.ddR : 0;

  // Kelly dla wypłaty asymetrycznej Z KOSZTEM: f* = (p·b − (1−p) − costR) / b
  const b = Math.max(0.1, rr || 1.5);
  const edge = prob * b - (1 - prob) - costR;
  const fullKelly = edge / b;
  let riskPct = Math.max(0, fullKelly) * kellyFraction * 100;

  // vol-targeting: przy wysokiej zmienności tniemy ryzyko, przy niskiej lekko podnosimy
  const volMult = volState === 'high' ? 0.6 : volState === 'low' ? 1.15 : 1.0;
  riskPct *= volMult;

  // [E4-2] skala portfelowa (portfolioCheck) + tryb obronny przy drawdownie
  riskPct *= scale;
  const defensive = ddR > 5;
  if (defensive) riskPct *= 0.5;

  riskPct = Math.min(maxRiskPct, +riskPct.toFixed(2));
  return {
    riskPct,                       // % kapitału do zaryzykowania na tej transakcji
    fullKellyPct: +(Math.max(0, fullKelly) * 100).toFixed(1),
    edge,                          // dodatnie = przewaga PO koszcie
    volMult,
    scale,
    defensive,                     // true ⇒ komunikat „tryb obronny" w UI
  };
}
