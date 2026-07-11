/* ---------------- Plan wejścia po korekcie (pullback sniper) ----------------
   Gdy trend jest zdrowy, ale cena jest już PRZEWYCIĄGNIĘTA (gonienie ruchu,
   wykupienie/wyprzedanie, premium/discount), prawdopodobna jest korekta.
   Ten moduł wyznacza DOKĄD może sięgnąć korekta — jako strefę KONFLUENCJI
   (zbiegu wielu poziomów: Fibonacci nogi impulsu, EMA20/50, Order Block, FVG,
   wsparcie/opór, równowaga 50%, VWAP) — i pilnuje, jak blisko jest cena.
   Zwraca gotowy plan „nowego entry" wraz z pewnością, unieważnieniem, celem,
   RR i stanem zbliżania (watch → approaching → in_zone).                     */

const W = {
  ob: 3.0, fvg: 2.5, fib618: 2.2, fib50: 2.0, ema20: 2.0, sr: 2.0,
  fib705: 1.6, eq: 1.6, ema50: 1.6, fib382: 1.1, vwap: 1.0,
};

/* skupia poziomy leżące blisko siebie (w tolerancji × ATR) w strefy konfluencji */
function clusterLevels(cands, tol) {
  const sorted = cands.slice().sort((a, b) => a.px - b.px);
  const clusters = [];
  for (const c of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(c.px - last.center) <= tol) {
      last.members.push(c);
      last.lo = Math.min(last.lo, c.zoneLo != null ? c.zoneLo : c.px);
      last.hi = Math.max(last.hi, c.zoneHi != null ? c.zoneHi : c.px);
      last.weight += c.w;
      last.center = last.members.reduce((s, m) => s + m.px * m.w, 0) / last.members.reduce((s, m) => s + m.w, 0);
    } else {
      clusters.push({
        members: [c], weight: c.w, center: c.px,
        lo: c.zoneLo != null ? c.zoneLo : c.px,
        hi: c.zoneHi != null ? c.zoneHi : c.px,
      });
    }
  }
  return clusters;
}

export function buildPullbackPlan(ctx) {
  const { candles, i, price, atr, smc, v20, v50, vw, nearSup, nearRes,
    htfDir, rangeMode, rsi, adx, isLive } = ctx;
  if (!smc || !smc.ms || !atr || price == null) return null;

  const ms = smc.ms;

  /* --- kierunek trendu: najpierw struktura (HH/HL / LH/LL), w razie braku EMA --- */
  let dir = ms.trend;
  if (dir === 0) {
    if (v20 != null && v50 != null && price > v20 && v20 > v50) dir = 1;
    else if (v20 != null && v50 != null && price < v20 && v20 < v50) dir = -1;
  }
  if (dir === 0) return null;

  /* --- czy cena jest przewyciągnięta (dlaczego korekta jest prawdopodobna) --- */
  const reasons = [];
  const distEma = (v20 != null) ? (price - v20) / atr * dir : 0; // dodatnie = wybiegła w kierunku trendu
  if (distEma > 1.3) reasons.push('cena ' + distEma.toFixed(1) + '×ATR od EMA20 (rozciągnięcie)');
  if (dir === 1 && rsi != null && rsi >= 68) reasons.push('RSI ' + rsi.toFixed(0) + ' — wykupienie');
  if (dir === -1 && rsi != null && rsi <= 32) reasons.push('RSI ' + rsi.toFixed(0) + ' — wyprzedanie');
  if (smc.pd) {
    if (dir === 1 && smc.pd.zone === 'premium') reasons.push('cena w PREMIUM (' + smc.pd.pct + '%)');
    if (dir === -1 && smc.pd.zone === 'discount') reasons.push('cena w DISCOUNT (' + smc.pd.pct + '%)');
  }
  const overextended = reasons.length > 0;

  /* --- noga impulsu (do Fibonacciego) --- */
  const anchorHi = dir === 1 ? Math.max(ms.lastSwingHigh.p, price) : ms.lastSwingHigh.p;
  const anchorLo = dir === 1 ? ms.lastSwingLow.p : Math.min(ms.lastSwingLow.p, price);
  const leg = anchorHi - anchorLo;

  /* --- kandydaci na poziom wejścia (dla LONG poniżej ceny, dla SHORT powyżej) --- */
  const cands = [];
  const below = (px) => dir === 1 && px < price - atr * 0.12 && px > price - leg * 1.1;
  const above = (px) => dir === -1 && px > price + atr * 0.12 && px < price + leg * 1.1;
  const fits = (px) => (dir === 1 ? below(px) : above(px));
  const add = (px, label, w, zoneLo, zoneHi) => { if (px != null && fits(px)) cands.push({ px, label, w, zoneLo, zoneHi }); };

  if (leg > atr * 1.0) {
    const fib = (r) => dir === 1 ? anchorHi - leg * r : anchorLo + leg * r;
    add(fib(0.382), 'Fib 38,2%', W.fib382);
    add(fib(0.5), 'Fib 50%', W.fib50);
    add(fib(0.618), 'Fib 61,8%', W.fib618);
    add(fib(0.705), 'Fib 70,5%', W.fib705);
  }
  add(v20, 'EMA20', W.ema20);
  add(v50, 'EMA50', W.ema50);
  add(vw, 'VWAP', W.vwap);
  add(ms.mid, 'równowaga 50%', W.eq);
  if (smc.ob && smc.ob.dir === dir && !smc.ob.mitigated) {
    add(dir === 1 ? smc.ob.hi : smc.ob.lo, 'Order Block', W.ob, smc.ob.lo, smc.ob.hi);
  }
  if (smc.fvg && smc.fvg.nearest && smc.fvg.nearest.dir === dir) {
    const g = smc.fvg.nearest;
    add(dir === 1 ? g.hi : g.lo, 'FVG', W.fvg, g.lo, g.hi);
  }
  if (dir === 1 && nearSup) add(nearSup.hi, 'wsparcie', W.sr, nearSup.lo, nearSup.hi);
  if (dir === -1 && nearRes) add(nearRes.lo, 'opór', W.sr, nearRes.lo, nearRes.hi);

  if (cands.length === 0) return null;

  /* --- konfluencja: skupiamy poziomy w strefy, wybieramy najsilniejszą --- */
  const clusters = clusterLevels(cands, atr * 0.4);
  clusters.sort((a, b) => b.weight - a.weight || (dir === 1 ? b.center - a.center : a.center - b.center));
  const best = clusters[0];
  const entry = best.center;
  const zoneLo = best.lo - atr * 0.06;
  const zoneHi = best.hi + atr * 0.06;
  const factors = best.members
    .sort((a, b) => b.w - a.w)
    .map((m) => ({ label: m.label, px: m.px }));

  /* --- unieważnienie (za swingiem struktury) + cel (retest szczytu / płynność) --- */
  const invalidation = dir === 1
    ? Math.min(ms.lastSwingLow.p, zoneLo) - atr * 0.25
    : Math.max(ms.lastSwingHigh.p, zoneHi) + atr * 0.25;

  let target;
  if (dir === 1) {
    target = (smc.eq && smc.eq.eqHigh && smc.eq.eqHigh > price) ? smc.eq.eqHigh
      : (nearRes && nearRes.lo > price) ? nearRes.lo : anchorHi;
  } else {
    target = (smc.eq && smc.eq.eqLow && smc.eq.eqLow < price) ? smc.eq.eqLow
      : (nearSup && nearSup.hi < price) ? nearSup.hi : anchorLo;
  }
  const risk = Math.abs(entry - invalidation) || atr * 0.5;
  const rr = +(Math.abs(target - entry) / risk).toFixed(2);

  /* --- pewność planu (0-100) --- */
  let conf = Math.min(best.weight, 8) / 8 * 55;
  if (adx != null) conf += adx >= 25 ? 15 : adx >= 20 ? 8 : 0;
  if (htfDir === dir) conf += 12; else if (htfDir === -dir) conf -= 15;
  const inCheapZone = dir === 1 ? entry <= ms.mid : entry >= ms.mid; // wejście po „dobrej" stronie zakresu
  if (inCheapZone) conf += 10;
  if (rr >= 2) conf += 8; else if (rr < 1) conf -= 10;
  if (rangeMode) conf -= 12;
  if (factors.length >= 3) conf += 6;
  conf = Math.max(0, Math.min(100, Math.round(conf)));
  const grade = conf >= 70 ? 'A' : conf >= 55 ? 'B' : conf >= 40 ? 'C' : 'D';

  /* --- stan zbliżania: jak daleko cena od strefy wejścia --- */
  const gapAtr = dir === 1 ? (price - zoneHi) / atr : (zoneLo - price) / atr;
  const distancePct = +((entry - price) / price * 100).toFixed(2);
  let state;
  if (gapAtr > 1.2) state = 'watch';
  else if (gapAtr > 0.25) state = 'approaching';
  else if (gapAtr >= -0.2) state = 'in_zone';
  else {
    const brokeInval = dir === 1 ? price < invalidation : price > invalidation;
    state = brokeInval ? 'invalidated' : 'below';
  }

  const confirm = dir === 1
    ? ['knot/świeca popytowa w strefie', 'RSI zawraca w górę', 'impuls (displacement) w górę', 'reakcja na OB/FVG']
    : ['knot/świeca podażowa w strefie', 'RSI zawraca w dół', 'impuls (displacement) w dół', 'reakcja na OB/FVG'];

  return {
    active: true,
    dir, overextended, reasons,
    trendLabel: ms.label,
    zone: { lo: +zoneLo, hi: +zoneHi },
    entry: +entry,
    factors,
    confluence: +best.weight.toFixed(1),
    confidence: conf, grade,
    invalidation: +invalidation, target: +target, rr,
    gapAtr: +gapAtr.toFixed(2), distancePct, state,
    confirm,
    live: !!isLive,
  };
}
