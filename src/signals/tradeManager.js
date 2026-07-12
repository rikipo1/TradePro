/* ---------------- [W1] JEDNA implementacja zarządzania pozycją ----------------
   Wcześniej backtest (trailing ZA STRUKTURĄ, 8-świecowy ekstrem ±0.25·ATR)
   i paper live (sztywny trailing 1R za ceną) miały DWIE różne strategie, więc
   backtest nie przewidywał zachowania live. Ten moduł jest JEDYNYM źródłem
   prawdy dla obu torów.

   Schemat pozycji (identyczny wszędzie):
     open → (po +1R) BE → (na TP1) partial 50% + runner
          → trailing ZA STRUKTURĄ → TP2 / stopa / timeout
   Kolejność wewnątrz świecy jest PESYMISTYCZNA: najpierw stop (SL-first),
   dopiero potem cele. Dzięki temu świeca dotykająca i SL, i TP1 daje SL/BE,
   nie TP1.

   state:  { dir, entry, sl, tp1, tp2, risk, rr1, costR, stage, slCur, banked, sawTp2 }
   bar:    { o, h, l, c, atr, trailLow, trailHigh, timeout }
   cfg:    { trailMode: 'structure' | 'fixedR' }  (domyślnie 'structure')

   Zwraca: { state, closed }  gdzie closed===null → pozycja nadal otwarta,
   inaczej closed = { out:'SL'|'BE'|'TP1'|'TIMEOUT', r, tp2, exit }.       */

/* Buduje stan początkowy pozycji z poziomów sygnału. costR = koszt (spread) w R,
   liczony RAZ przy otwarciu (spreadPx/slDist) i stały przez życie pozycji. */
export function initPosition(p) {
  const risk = p.risk;
  const costR = risk > 0 && p.costPx != null ? p.costPx / risk : (p.costR || 0);
  return {
    dir: p.dir, entry: p.entry, sl: p.sl, tp1: p.tp1, tp2: p.tp2,
    risk, rr1: p.rr1 || 1.5, costR,
    stage: 'open', slCur: p.sl, banked: 0, sawTp2: false,
  };
}

/* Jeden krok zarządzania pozycją na JEDNEJ świecy (lub tiku). Czysta funkcja. */
export function stepPosition(state, bar, cfg = {}) {
  const s = { ...state };
  const dir = s.dir;
  const rOf = (px) => ((px - s.entry) / s.risk) * dir;

  /* --- 1) STOP FIRST (pesymistycznie): sprawdzamy stop na slCur SPRZED
         tegorocznych promocji BE/TP1/trailing z tej świecy --- */
  const stopHit = dir === 1 ? bar.l <= s.slCur : bar.h >= s.slCur;
  if (stopHit) {
    let r, out;
    if (s.stage === 'open') { r = -1 - s.costR; out = 'SL'; }
    else if (s.stage === 'be') { r = rOf(s.slCur) - s.costR; out = 'BE'; }
    else { r = s.banked + 0.5 * rOf(s.slCur) - s.costR; out = 'TP1'; }
    return { state: s, closed: { out, r, tp2: s.stage === 'runner' && s.sawTp2 === true, exit: s.slCur } };
  }

  /* --- 2) +1R → stop na wejście (BE) --- */
  const fav = dir === 1 ? bar.h : bar.l;
  const favR = ((fav - s.entry) / s.risk) * dir;
  if (s.stage === 'open' && favR >= 1) { s.stage = 'be'; s.slCur = s.entry; }

  /* --- 3) TP1 → realizacja 50% + runner --- */
  if ((s.stage === 'open' || s.stage === 'be') && (dir === 1 ? bar.h >= s.tp1 : bar.l <= s.tp1)) {
    s.banked = 0.5 * s.rr1;
    s.stage = 'runner';
    s.slCur = dir === 1 ? Math.max(s.slCur, s.entry) : Math.min(s.slCur, s.entry);
  }

  /* --- 4) runner: TP2 → domknięcie, inaczej trailing za strukturą --- */
  if (s.stage === 'runner') {
    if (dir === 1 ? bar.h >= s.tp2 : bar.l <= s.tp2) {
      const r = s.banked + 0.5 * rOf(s.tp2) - s.costR;
      return { state: s, closed: { out: 'TP1', r, tp2: true, exit: s.tp2 } };
    }
    const aI = bar.atr != null ? bar.atr : s.risk * 0.5;
    if ((cfg.trailMode || 'structure') === 'fixedR') {
      /* [W1] fallback dla paper na tiku bez świec: trailing 1R za ceną
         (dawne zachowanie paper) — pesymistyczny, ale zachowany 1:1. */
      const trail = dir === 1 ? bar.c - s.risk : bar.c + s.risk;
      if (dir === 1 ? trail > s.slCur : trail < s.slCur) s.slCur = trail;
    } else {
      /* trailing STRUKTURALNY (8-świecowy ekstrem ±0.25·ATR) — jak backtest.
         Caller podaje trailLow/trailHigh z okna świec. */
      if (dir === 1 && Number.isFinite(bar.trailLow)) s.slCur = Math.max(s.slCur, bar.trailLow - aI * 0.25);
      if (dir === -1 && Number.isFinite(bar.trailHigh)) s.slCur = Math.min(s.slCur, bar.trailHigh + aI * 0.25);
    }
    if (dir === 1 ? bar.h >= s.tp2 : bar.l <= s.tp2) s.sawTp2 = true;
  }

  /* --- 5) time-stop: base = zaksięgowane + 0.5·pływające (dla runnera) --- */
  if (bar.timeout) {
    const base = s.stage === 'runner' ? s.banked + 0.5 * rOf(bar.c) : rOf(bar.c);
    return { state: s, closed: { out: 'TIMEOUT', r: base - s.costR, tp2: false, exit: bar.c } };
  }

  return { state: s, closed: null };
}

/* [W1] Wariant TIKOWY dla paper live (px co 15 s). Intrabar high/low NIE jest
   znany, więc degradujemy do modelu „tik jako close" (o=h=l=c=px). Oznaczamy to
   flagą tickApprox — backtest jest pesymistyczny (SL-first z realnym low/high),
   paper może przeoczyć stop-hunt intrabar.
   opts: { atr, trailLow, trailHigh } — jeśli podane świece, trailing jest
   STRUKTURALNY (spójny z backtestem); bez nich fallback 1R (flagowany). */
export function stepPositionTick(state, px, opts = {}) {
  const hasStruct = Number.isFinite(opts.trailLow) || Number.isFinite(opts.trailHigh);
  const bar = { o: px, h: px, l: px, c: px, atr: opts.atr, trailLow: opts.trailLow, trailHigh: opts.trailHigh };
  const res = stepPosition(state, bar, { trailMode: hasStruct ? 'structure' : 'fixedR' });
  res.tickApprox = true;              // intrabar high/low nieznany na tiku 15 s
  res.trailApprox = !hasStruct;       // trailing 1R (przybliżenie) zamiast struktury
  return res;
}
