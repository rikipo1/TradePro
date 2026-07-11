/* ---------------- Sizing pozycji (ETAP 3 · [W3]) ----------------
   Zwraca sugerowane ryzyko na transakcję jako % kapitału. NIE porada — matematyka
   zarządzania ryzykiem.

   [W3] Domyślny tryb to FIXED-FRACTIONAL (stałe ryzyko, niezależne od prob).
   Kelly na NIESKALIBROWANYM/globalnym p prowadzi do ryzyka ruiny przy
   przeszacowaniu p, więc Kelly jest DOZWOLONY WYŁĄCZNIE, gdy model jest
   wiarygodny i skalibrowany (opts.calibrated===true). W przeciwnym razie —
   nawet przy mode:'kelly' — degradujemy do 'fixed'.

   opts:
     mode         'fixed' | 'kelly'   (domyślnie 'fixed')
     calibrated   bool — Kelly wolno tylko gdy true (z engine: probCalibrated && reliable)
     fixedRiskPct stałe ryzyko dla trybu fixed (domyślnie 0.5%)
     kellyFraction ułamek Kelly'ego (domyślnie 0.25 — ćwierć-Kelly)
     maxRiskPct   twardy cap % (domyślnie 1.0)
     volState     'high'|'normal'|'low' — vol-targeting                        */

export function positionSizing(prob, rr, opts = {}) {
  const reqMode = opts.mode || 'fixed';
  const calibrated = opts.calibrated === true;
  // Kelly tylko przy skalibrowanym modelu — inaczej wymuszamy fixed
  const mode = (reqMode === 'kelly' && calibrated) ? 'kelly' : 'fixed';

  const fixedRiskPct = opts.fixedRiskPct != null ? opts.fixedRiskPct : 0.5;
  const kellyFraction = opts.kellyFraction != null ? opts.kellyFraction : 0.25;
  const maxRiskPct = opts.maxRiskPct != null ? opts.maxRiskPct : 1.0;
  const volState = opts.volState || 'normal';
  const b = Math.max(0.1, rr || 1.5);

  // vol-targeting: przy wysokiej zmienności tniemy ryzyko, przy niskiej lekko podnosimy
  const volMult = volState === 'high' ? 0.6 : volState === 'low' ? 1.15 : 1.0;

  let riskPct;
  if (mode === 'kelly') {
    // Kelly dla wypłaty asymetrycznej: f* = (p*b - (1-p)) / b
    const fullKelly = (prob * b - (1 - prob)) / b;
    riskPct = Math.max(0, fullKelly) * kellyFraction * 100 * volMult;
  } else {
    // FIXED: stałe ryzyko, NIEZALEŻNE od prob (tylko vol-targeting je moduluje)
    riskPct = fixedRiskPct * volMult;
  }
  riskPct = Math.min(maxRiskPct, +riskPct.toFixed(2));

  const fullKelly = (prob * b - (1 - prob)) / b; // informacyjnie w obu trybach
  return {
    mode,                          // faktycznie użyty tryb ('fixed' gdy Kelly niedozwolony)
    riskPct,                       // % kapitału do zaryzykowania na tej transakcji
    fixedRiskPct,
    fullKellyPct: +(Math.max(0, fullKelly) * 100).toFixed(1),
    edge: prob * b - (1 - prob),   // dodatnie = przewaga
    volMult,
    calibrated,
  };
}
