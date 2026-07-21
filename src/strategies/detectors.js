/* ---------------- Detektory strategii (silnik instytucjonalny) ----------------
   Każdy detektor to czysta funkcja ctx → wynik | null:
     { id, name, group, dir, base (0..100), why[], invalidates[], conditions[] }
   base = surowa jakość setupu ZANIM silnik nałoży zgodność MTF, reżim, sesję
   i korektę z uczenia (learning.js).

   UCZCIWOŚĆ DANYCH: wszystkie detektory liczą z OHLCV + wolumen świecowy.
   Order Flow / Footprint / DOM / delta wymagają danych tick/L2, których feed
   (Yahoo/Capital świece) nie dostarcza — takich strategii NIE symulujemy.

   ctx: { candles, i, price, atr, ind, emaData, smc, liq, vp, regime, sess,
          relVol, hasVol, piv (zigzag), prevDay {h,l,c} } */

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function lastSwing(ctx, dir) {
  // dir=1: ostatni swing low pod ceną; dir=-1: swing high nad ceną
  if (ctx.smc && ctx.smc.ms) {
    return dir === 1 ? ctx.smc.ms.lastSwingLow.p : ctx.smc.ms.lastSwingHigh.p;
  }
  return null;
}

function hiLo(candles, i, n) {
  let hi = -Infinity, lo = Infinity;
  for (let q = Math.max(0, i - n + 1); q <= i; q++) {
    if (candles[q].h > hi) hi = candles[q].h;
    if (candles[q].l < lo) lo = candles[q].l;
  }
  return { hi, lo };
}

/* 1) TREND FOLLOWING — EMA stack + ADX + struktura zgodne, wejście przy EMA20 */
export function detTrendFollowing(ctx) {
  const { price, i, ind, emaData, atr, regime, smc } = ctx;
  const e20 = emaData[20][i], e50 = emaData[50][i];
  const adx = ind.adx.adx[i];
  if (e20 == null || e50 == null || adx == null) return null;
  const emaDir = price > e20 && e20 > e50 ? 1 : price < e20 && e20 < e50 ? -1 : 0;
  if (emaDir === 0) return null;
  const structOk = smc.ms && smc.ms.trend === emaDir;
  const trending = regime.type === 'trend_strong' || regime.type === 'trend_weak';
  if (!trending && !structOk) return null;
  const distEma = Math.abs(price - e20) / atr;
  let base = 40 + (adx >= 25 ? 15 : adx >= 18 ? 8 : 0) + (structOk ? 15 : 0)
    + (distEma <= 0.8 ? 12 : distEma <= 1.5 ? 4 : -8);
  return {
    id: 'trend', name: 'Trend Following (EMA+ADX+struktura)', group: 'trend',
    dir: emaDir, base: clamp(base, 0, 90),
    why: ['EMA stack ' + (emaDir > 0 ? 'wzrostowy' : 'spadkowy') + ', ADX ' + adx.toFixed(0)
      + (structOk ? ', struktura HH/HL zgodna' : ''),
      'cena ' + distEma.toFixed(1) + '×ATR od EMA20 (im bliżej, tym lepsze wejście)'],
    invalidates: ['zamknięcie za EMA50', 'CHOCH przeciw kierunkowi'],
    conditions: ['ADX ≥ 18 utrzymany', 'brak wybicia struktury przeciw'],
  };
}

/* 2) MOMENTUM — displacement + RSI/MACD w jedną stronę */
export function detMomentum(ctx) {
  const { i, ind, smc, regime } = ctx;
  const rsi = ind.rsi[i], m = ind.macd.macd[i], s = ind.macd.signal[i];
  if (rsi == null || m == null || s == null) return null;
  const disp = smc.disp || 0;
  const macdDir = m > s ? 1 : -1;
  const rsiDir = rsi >= 57 ? 1 : rsi <= 43 ? -1 : 0;
  if (disp === 0 || rsiDir === 0 || macdDir !== rsiDir || disp !== rsiDir) return null;
  let base = 45 + (Math.abs(rsi - 50) > 15 ? 12 : 6) + (regime.type === 'expansion' ? 10 : 0);
  return {
    id: 'momentum', name: 'Momentum / Volatility Expansion', group: 'momentum',
    dir: rsiDir, base: clamp(base, 0, 85),
    why: ['displacement ' + (disp > 0 ? 'popytowy' : 'podażowy') + ' + RSI ' + rsi.toFixed(0) + ' + MACD zgodne'],
    invalidates: ['wygaśnięcie impetu (RSI wraca do 50)', 'brak kontynuacji w 5 świec'],
    conditions: ['kolejna świeca kontynuuje', 'wolumen nie gaśnie'],
  };
}

/* 3) BREAKOUT — wybicie kanału Donchian 20 z wolumenem */
export function detBreakout(ctx) {
  const { candles, i, price, atr, relVol } = ctx;
  if (i < 22) return null;
  const prev = hiLo(candles, i - 1, 20);
  const c = candles[i];
  let dir = 0;
  if (c.c > prev.hi + atr * 0.05) dir = 1;
  else if (c.c < prev.lo - atr * 0.05) dir = -1;
  if (dir === 0) return null;
  const volOk = relVol && relVol.spike;
  const body = Math.abs(c.c - c.o) / Math.max(1e-9, c.h - c.l);
  let base = 42 + (volOk ? 14 : -6) + (body > 0.6 ? 10 : 0);
  return {
    id: 'breakout', name: 'Breakout (Donchian 20)', group: 'breakout',
    dir, base: clamp(base, 0, 85),
    why: ['zamknięcie ' + (dir > 0 ? 'nad 20-świecowym szczytem' : 'pod 20-świecowym dołkiem')
      + (volOk ? ' z wolumenem ' + relVol.rv + '×' : ' BEZ potwierdzenia wolumenem')],
    invalidates: ['powrót do kanału (fake breakout)', 'brak retestu z utrzymaniem'],
    conditions: ['retest poziomu wybicia utrzymany', 'wolumen potwierdza'],
  };
}

/* 4) BREAK & RETEST — po wybiciu cena wraca do poziomu i go broni */
export function detBreakRetest(ctx) {
  const { candles, i, price, atr } = ctx;
  if (i < 30) return null;
  for (let back = 3; back <= 10; back++) {
    const j = i - back;
    if (j < 21) break;
    const prev = hiLo(candles, j - 1, 20);
    const cj = candles[j];
    let dir = 0, level = null;
    if (cj.c > prev.hi + atr * 0.05) { dir = 1; level = prev.hi; }
    else if (cj.c < prev.lo - atr * 0.05) { dir = -1; level = prev.lo; }
    if (dir === 0) continue;
    const dist = (price - level) * dir; // ile nad/pod poziomem po stronie wybicia
    if (dist < -atr * 0.35) return null; // poziom oddany — wybicie nieudane
    if (dist >= 0 && dist <= atr * 0.6) {
      return {
        id: 'breakRetest', name: 'Break & Retest', group: 'breakout',
        dir, base: 62,
        why: ['wybicie ' + back + ' świec temu, cena testuje poziom ' + level.toFixed(4) + ' od właściwej strony'],
        invalidates: ['zamknięcie ' + (dir > 0 ? 'pod' : 'nad') + ' poziomem wybicia o >0.35×ATR'],
        conditions: ['odrzucenie poziomu (knot) na retestach', 'wolumen malejący na cofnięciu'],
      };
    }
  }
  return null;
}

/* 5) LIQUIDITY SWEEP / STOP HUNT / FAKE BREAKOUT — kontra po zebraniu płynności */
export function detLiquiditySweep(ctx) {
  const { smc, regime } = ctx;
  if (!smc.sweep) return null;
  const dir = smc.sweep.dir; // kierunek GRY po sweepie (kontra do wybicia)
  let base = 58 + (regime.type === 'range' ? 8 : 0) + (smc.bc && smc.bc.choch === dir ? 10 : 0);
  return {
    id: 'sweep', name: 'Liquidity Sweep / Stop Hunt (ICT)', group: 'liquidity',
    dir, base: clamp(base, 0, 90),
    why: [smc.sweep.txt, smc.bc && smc.bc.choch === dir ? 'CHOCH potwierdza odwrócenie' : 'czekaj na potwierdzenie struktury'],
    invalidates: ['nowe ekstremum ZA sweepem (to nie był sweep, tylko kontynuacja)'],
    conditions: ['szybki powrót do zakresu', 'displacement w kierunku gry'],
  };
}

/* 6) WYCKOFF SPRING / UPTHRUST — w konsolidacji: nurek pod range i powrót */
export function detWyckoffSpring(ctx) {
  const { candles, i, atr, regime } = ctx;
  if (regime.type !== 'range' || i < 40) return null;
  const rng = hiLo(candles, i - 3, 30);
  const c = candles[i], c1 = candles[i - 1];
  // spring: knot pod dołkiem range, zamknięcie z powrotem w środku
  if (Math.min(c.l, c1.l) < rng.lo - atr * 0.1 && c.c > rng.lo + atr * 0.15) {
    return {
      id: 'wyckoffSpring', name: 'Wyckoff Spring (akumulacja)', group: 'reversal',
      dir: 1, base: 60,
      why: ['nurek pod dołek konsolidacji (' + rng.lo.toFixed(4) + ') i powrót — test podaży nieudany'],
      invalidates: ['zamknięcie pod dołkiem range', 'brak rajdu w 5–8 świec'],
      conditions: ['wzrost wolumenu na powrocie', 'wyjście nad środek range'],
    };
  }
  if (Math.max(c.h, c1.h) > rng.hi + atr * 0.1 && c.c < rng.hi - atr * 0.15) {
    return {
      id: 'wyckoffUT', name: 'Wyckoff Upthrust (dystrybucja)', group: 'reversal',
      dir: -1, base: 60,
      why: ['wybicie nad szczyt konsolidacji (' + rng.hi.toFixed(4) + ') odrzucone — popyt nie utrzymał'],
      invalidates: ['zamknięcie nad szczytem range'],
      conditions: ['słabnący wolumen na szczycie', 'zejście pod środek range'],
    };
  }
  return null;
}

/* 7) MEAN REVERSION — range + Bollinger + RSI skrajne → powrót do średniej */
export function detMeanReversion(ctx) {
  const { i, ind, price, regime } = ctx;
  if (regime.type !== 'range') return null;
  const bU = ind.boll.up[i], bD = ind.boll.dn[i], rsi = ind.rsi[i];
  if (bU == null || bD == null || rsi == null) return null;
  let dir = 0;
  if (price >= bU && rsi > 65) dir = -1;
  else if (price <= bD && rsi < 35) dir = 1;
  if (dir === 0) return null;
  return {
    id: 'meanRev', name: 'Mean Reversion (Bollinger+RSI w range)', group: 'reversion',
    dir, base: 55 + (rsi > 72 || rsi < 28 ? 8 : 0),
    why: ['cena na wstędze Bollingera w konsolidacji, RSI ' + rsi.toFixed(0) + ' — statystyczny powrót do średniej'],
    invalidates: ['przejście reżimu w trend (ADX rośnie)', 'zamknięcie za wstęgą 2 świece z rzędu'],
    conditions: ['reżim pozostaje range', 'brak displacementu przeciw'],
  };
}

/* 8) ORDER BLOCK (SMC) — reakcja na świeży, niezmitygowany OB */
export function detOrderBlock(ctx) {
  const { smc } = ctx;
  const ob = smc.ob;
  if (!ob || ob.mitigated || !(ob.inside || ob.distAtr < 0.4)) return null;
  const trendOk = smc.ms && smc.ms.trend === ob.dir;
  return {
    id: 'orderBlock', name: 'Order Block (SMC)', group: 'smc',
    dir: ob.dir, base: 52 + (trendOk ? 12 : -4),
    why: ['cena przy świeżym OB ' + (ob.dir > 0 ? 'popytowym' : 'podażowym')
      + (trendOk ? ' zgodnym z trendem struktury' : ' PRZECIW trendowi (słabsze)')],
    invalidates: ['zamknięcie przez cały OB (mitygacja bez reakcji)'],
    conditions: ['reakcja knotem/odbiciem w 1–3 świece'],
  };
}

/* 9) FVG / IMBALANCE — niewypełniona luka tuż przy cenie */
export function detFvg(ctx) {
  const { smc } = ctx;
  const g = smc.fvg && smc.fvg.nearest;
  if (!g || smc.fvg.nearDistAtr == null || smc.fvg.nearDistAtr > 0.5) return null;
  const trendOk = smc.ms && smc.ms.trend === g.dir;
  return {
    id: 'fvg', name: 'Fair Value Gap / Imbalance', group: 'smc',
    dir: g.dir, base: 48 + (trendOk ? 10 : -4),
    why: ['świeży FVG ' + (g.dir > 0 ? 'popytowy' : 'podażowy') + ' ' + smc.fvg.nearDistAtr.toFixed(2) + '×ATR od ceny'],
    invalidates: ['pełne wypełnienie luki bez reakcji'],
    conditions: ['reakcja w strefie luki', 'zgodność z HTF'],
  };
}

/* 10) PREMIUM/DISCOUNT — kupuj tanio w trendzie wzrostowym, sprzedawaj drogo w spadkowym */
export function detPremiumDiscount(ctx) {
  const { smc } = ctx;
  if (!smc.ms || !smc.pd || !smc.pd.zone) return null;
  const t = smc.ms.trend;
  if (t === 1 && smc.pd.zone === 'discount') {
    return { id: 'pd', name: 'Discount w trendzie wzrostowym (SMC)', group: 'smc', dir: 1, base: 54,
      why: ['trend wzrostowy + cena w DISCOUNT (' + smc.pd.pct + '% zakresu) — tanie wejście z trendem'],
      invalidates: ['CHOCH w dół'], conditions: ['potwierdzenie reakcją (BOS w górę)'] };
  }
  if (t === -1 && smc.pd.zone === 'premium') {
    return { id: 'pd', name: 'Premium w trendzie spadkowym (SMC)', group: 'smc', dir: -1, base: 54,
      why: ['trend spadkowy + cena w PREMIUM (' + smc.pd.pct + '% zakresu) — drogie miejsce na short'],
      invalidates: ['CHOCH w górę'], conditions: ['potwierdzenie reakcją (BOS w dół)'] };
  }
  return null;
}

/* 11) VWAP — trend day: płytkie cofnięcie do VWAP po właściwej stronie */
export function detVwap(ctx) {
  const { i, ind, price, atr, emaData } = ctx;
  const vw = ind.vwap ? ind.vwap[i] : null;
  if (vw == null) return null;
  const dist = (price - vw) / atr;
  const e50 = emaData[50][i];
  const dir = dist > 0 ? 1 : -1;
  if (Math.abs(dist) > 0.6) return null;               // za daleko od VWAP
  if (e50 == null || (dir === 1 ? price < e50 : price > e50)) return null; // brak zgody z tłem
  return {
    id: 'vwap', name: 'VWAP pullback (trend day)', group: 'vwap',
    dir, base: 50,
    why: ['cofnięcie do VWAP od strony ' + (dir > 0 ? 'popytu' : 'podaży') + ' (' + Math.abs(dist).toFixed(2) + '×ATR)'],
    invalidates: ['zamknięcie po drugiej stronie VWAP'],
    conditions: ['obrona VWAP knotem', 'sesja o dobrej płynności'],
  };
}

/* 12) VOLATILITY SQUEEZE — kompresja BB w Keltnerze → gra na ekspansję */
export function detSqueeze(ctx) {
  const { candles, i, ind, atr, price } = ctx;
  if (i < 60) return null;
  const bU = ind.boll.up[i], bD = ind.boll.dn[i];
  if (bU == null || bD == null) return null;
  const width = (bU - bD) / Math.max(1e-9, price);
  // percentyl szerokości wstęg na ostatnich 100 świecach
  let below = 0, cnt = 0;
  for (let q = Math.max(20, i - 100); q <= i; q++) {
    const u = ind.boll.up[q], d = ind.boll.dn[q];
    if (u == null || d == null || !candles[q]) continue;
    cnt++;
    if ((u - d) / candles[q].c <= width) below++;
  }
  if (!cnt || below / cnt > 0.2) return null; // nie jesteśmy w dolnych 20% szerokości
  const c = candles[i];
  const dir = c.c > c.o ? 1 : -1;              // kierunek próby wybicia
  return {
    id: 'squeeze', name: 'Volatility Compression → Expansion', group: 'volatility',
    dir, base: 46,
    why: ['wstęgi Bollingera w dolnych ' + Math.round(below / cnt * 100) + '% szerokości ze 100 świec — rynek naciągnięty jak sprężyna'],
    invalidates: ['wybicie w przeciwną stronę'],
    conditions: ['pierwsza świeca ekspansji wyznacza kierunek', 'wolumen rośnie na wybiciu'],
  };
}

/* 13) SESSION OPEN DRIVE — killzone (London/NY open) + zdecydowany ruch */
export function detSessionDrive(ctx) {
  const { sess, smc, macro } = ctx;
  if (!macro) return null;
  const isOpen = macro.indexOf('otwarcie') !== -1 || macro.indexOf('Wall Street') !== -1;
  if (!isOpen || !smc.disp) return null;
  return {
    id: 'sessionDrive', name: 'Session Open Drive (killzone)', group: 'session',
    dir: smc.disp, base: 48,
    why: ['okno otwarcia sesji (' + macro + ') + displacement ' + (smc.disp > 0 ? 'popytowy' : 'podażowy')],
    invalidates: ['powrót do zakresu sprzed otwarcia'],
    conditions: ['kontynuacja w pierwszych 15–30 min', 'UWAGA: spread w oknie szerszy — wejście ręczne'],
  };
}

/* 14) PIVOT POINTS — reakcja na klasyczne pivoty z poprzedniego dnia */
export function detPivots(ctx) {
  const { prevDay, price, atr, smc } = ctx;
  if (!prevDay) return null;
  const P = (prevDay.h + prevDay.l + prevDay.c) / 3;
  const R1 = 2 * P - prevDay.l, S1 = 2 * P - prevDay.h;
  const lvls = [
    { p: P, n: 'Pivot' }, { p: R1, n: 'R1' }, { p: S1, n: 'S1' },
  ];
  for (const L of lvls) {
    const d = (price - L.p) / atr;
    if (Math.abs(d) < 0.3) {
      const dir = smc.ms ? smc.ms.trend : (d < 0 ? 1 : -1);
      if (dir === 0) return null;
      return {
        id: 'pivot', name: 'Pivot Points (' + L.n + ' z D1)', group: 'levels',
        dir, base: 44,
        why: ['cena przy ' + L.n + ' (' + L.p.toFixed(4) + ') z poprzedniego dnia — poziom obserwowany przez rynek'],
        invalidates: ['przebicie poziomu o >0.5×ATR bez reakcji'],
        conditions: ['reakcja knotem na poziomie', 'zgodność z trendem struktury'],
      };
    }
  }
  return null;
}

/* 15) FIGURY GEOMETRYCZNE — RGR, podwójne/potrójne dno·szczyt, trójkąty,
   kliny, flagi, kanały (z modułu patterns). Bierze najświeższą figurę
   blisko bieżącej świecy o sensownej pewności. */
export function detChartPattern(ctx) {
  const geo = ctx.geo;
  if (!geo || !geo.length) return null;
  let best = null;
  for (const g of geo) {
    if (!g || g.dir === 0 || g.conf < 58) continue;
    if (g.i < ctx.i - 10) continue;                     // tylko świeża figura (≤10 świec)
    if (!best || g.conf > best.conf || (g.conf === best.conf && g.i > best.i)) best = g;
  }
  if (!best) return null;
  const base = clamp(44 + Math.round((best.conf - 58) * 0.55), 0, 82); // conf 58→44, 100→67
  return {
    id: 'chartPattern', name: 'Figura: ' + best.name, group: 'pattern',
    dir: best.dir, base,
    why: ['formacja geometryczna „' + best.name + '" (pewność ' + best.conf + '%'
      + (best.span ? ', ' + best.span + ' świec' : '') + ') — kierunek wybicia ' + (best.dir > 0 ? 'w górę' : 'w dół')],
    invalidates: ['wybicie linii formacji w przeciwną stronę', 'zamknięcie poza kształtem figury'],
    conditions: ['potwierdzenie wybicia (zamknięcie za linią)', 'wolumen rosnący na wybiciu'],
  };
}

/* ---- helpery dla nowych strategii ---- */
function rollHi(candles, i, n) { let m = -Infinity; for (let q = Math.max(0, i - n + 1); q <= i; q++) if (candles[q].h > m) m = candles[q].h; return m; }
function rollLo(candles, i, n) { let m = Infinity; for (let q = Math.max(0, i - n + 1); q <= i; q++) if (candles[q].l < m) m = candles[q].l; return m; }

/* 16) ICHIMOKU — cena vs chmura Kumo + przecięcie Tenkan/Kijun */
export function detIchimoku(ctx) {
  const { candles, i, price } = ctx;
  if (i < 52) return null;
  const tenkan = (rollHi(candles, i, 9) + rollLo(candles, i, 9)) / 2;
  const kijun = (rollHi(candles, i, 26) + rollLo(candles, i, 26)) / 2;
  const j = i - 26; // chmura rzutowana z przeszłości (senkou przesunięte o 26)
  const spanA = (((rollHi(candles, j, 9) + rollLo(candles, j, 9)) / 2) + ((rollHi(candles, j, 26) + rollLo(candles, j, 26)) / 2)) / 2;
  const spanB = (rollHi(candles, j, 52) + rollLo(candles, j, 52)) / 2;
  const cloudTop = Math.max(spanA, spanB), cloudBot = Math.min(spanA, spanB);
  let dir = 0;
  if (price > cloudTop && tenkan > kijun) dir = 1;
  else if (price < cloudBot && tenkan < kijun) dir = -1;
  if (dir === 0) return null;
  const thick = (cloudTop - cloudBot) / (ctx.atr || 1);
  return {
    id: 'ichimoku', name: 'Ichimoku (chmura + TK cross)', group: 'trend',
    dir, base: clamp(48 + (thick > 1 ? 8 : 0), 0, 80),
    why: ['cena ' + (dir > 0 ? 'nad' : 'pod') + ' chmurą Kumo + Tenkan ' + (dir > 0 ? '>' : '<') + ' Kijun — trend ' + (dir > 0 ? 'wzrostowy' : 'spadkowy') + ' (grubość chmury ' + thick.toFixed(1) + '×ATR)'],
    invalidates: ['powrót ceny do wnętrza chmury', 'przecięcie Tenkan/Kijun w przeciwną stronę'],
    conditions: ['chmura po właściwej stronie', 'Chikou span potwierdza'],
  };
}

/* 17) SUPERTREND — kierunek trendu z ATR-owych pasm + świeżość flipu */
function supertrend(candles, atrArr, i, mult, look) {
  mult = mult || 3; look = look || 150;
  const start = Math.max(1, i - look);
  let fU = null, fL = null, trend = 1, prevC = null;
  for (let q = start; q <= i; q++) {
    const a = atrArr[q]; if (a == null) continue;
    const mid = (candles[q].h + candles[q].l) / 2;
    const bU = mid + mult * a, bL = mid - mult * a;
    const nU = (fU == null || bU < fU || prevC > fU) ? bU : fU;
    const nL = (fL == null || bL > fL || prevC < fL) ? bL : fL;
    if (fU != null) trend = trend === 1 ? (candles[q].c < nL ? -1 : 1) : (candles[q].c > nU ? 1 : -1);
    fU = nU; fL = nL; prevC = candles[q].c;
  }
  return { dir: trend, line: trend === 1 ? fL : fU };
}
export function detSupertrend(ctx) {
  const st = supertrend(ctx.candles, ctx.ind.atr, ctx.i, 3, 150);
  if (!st || st.dir === 0) return null;
  const st5 = supertrend(ctx.candles, ctx.ind.atr, ctx.i - 5, 3, 150);
  const freshFlip = st5 && st5.dir !== st.dir; // zmiana trendu w ostatnich 5 świecach
  return {
    id: 'supertrend', name: 'Supertrend (ATR)', group: 'trend',
    dir: st.dir, base: clamp(freshFlip ? 56 : 46, 0, 78),
    why: ['Supertrend ' + (st.dir > 0 ? 'wzrostowy' : 'spadkowy') + (freshFlip ? ' — ŚWIEŻY flip (sygnał wejścia)' : ' — trend utrzymany') + ', linia ' + st.line.toFixed(4)],
    invalidates: ['przebicie linii Supertrend zamknięciem'],
    conditions: ['świeży flip najsilniejszy', 'zgodność z wyższą ramką'],
  };
}

/* 18) DYWERGENCJA RSI — cena robi nowe ekstremum, RSI nie potwierdza */
export function detDivergence(ctx) {
  const { piv, ind, i } = ctx;
  if (!piv || piv.length < 4) return null;
  const rsi = ind.rsi;
  const lows = piv.filter(p => p.t === 'L').slice(-2);
  const highs = piv.filter(p => p.t === 'H').slice(-2);
  const fresh = arr => arr.length === 2 && (i - arr[1].i) <= 8 && rsi[arr[0].i] != null && rsi[arr[1].i] != null;
  if (fresh(lows) && lows[1].p < lows[0].p && rsi[lows[1].i] > rsi[lows[0].i] + 2) {
    return {
      id: 'divergence', name: 'Dywergencja bycza (RSI)', group: 'reversal', dir: 1, base: 56,
      why: ['cena niżej (LL), RSI wyżej (HL) — słabnie podaż, możliwe odwrócenie w górę'],
      invalidates: ['nowy dołek z RSI również niżej'], conditions: ['potwierdzenie świecą odwrócenia', 'reakcja na wsparciu'],
    };
  }
  if (fresh(highs) && highs[1].p > highs[0].p && rsi[highs[1].i] < rsi[highs[0].i] - 2) {
    return {
      id: 'divergence', name: 'Dywergencja niedźwiedzia (RSI)', group: 'reversal', dir: -1, base: 56,
      why: ['cena wyżej (HH), RSI niżej (LH) — słabnie popyt, możliwe odwrócenie w dół'],
      invalidates: ['nowy szczyt z RSI również wyżej'], conditions: ['potwierdzenie świecą odwrócenia', 'reakcja na oporze'],
    };
  }
  return null;
}

/* 19) ANCHORED VWAP — VWAP od ostatniego swingu; reakcja jako wsparcie/opór */
export function detAnchoredVwap(ctx) {
  if (!ctx.hasVol) return null;
  const piv = ctx.piv;
  if (!piv || !piv.length) return null;
  const anchor = piv[piv.length - 1].i;
  if (ctx.i - anchor < 5) return null;
  let pv = 0, vv = 0;
  for (let q = anchor; q <= ctx.i; q++) { const c = ctx.candles[q]; const tp = (c.h + c.l + c.c) / 3; pv += tp * (c.v || 0); vv += (c.v || 0); }
  if (vv <= 0) return null;
  const avwap = pv / vv;
  const dist = (ctx.price - avwap) / ctx.atr;
  if (Math.abs(dist) > 0.5) return null;                 // tylko blisko AVWAP
  const dir = dist >= 0 ? 1 : -1;
  return {
    id: 'anchoredVwap', name: 'Anchored VWAP (od swingu)', group: 'vwap',
    dir, base: 48,
    why: ['cena przy Anchored VWAP od ostatniego swingu (' + Math.abs(dist).toFixed(2) + '×ATR) — instytucjonalna średnia cena broni poziomu'],
    invalidates: ['zamknięcie po drugiej stronie AVWAP'],
    conditions: ['odrzucenie AVWAP knotem', 'zgodność z trendem struktury'],
  };
}

/* 20) OPENING RANGE BREAKOUT — wybicie zakresu otwarcia dnia (intraday) */
export function detORB(ctx) {
  if (ctx.tfSec >= 3600) return null;                    // tylko interwały śróddzienne
  const day = Math.floor(ctx.candles[ctx.i].t / 86400);
  const dayIdx = [];
  for (let q = Math.max(0, ctx.i - 250); q <= ctx.i; q++) { if (Math.floor(ctx.candles[q].t / 86400) === day) dayIdx.push(q); }
  if (dayIdx.length < 8) return null;
  const orBars = dayIdx.slice(0, 6);                     // zakres otwarcia = pierwsze ~6 świec
  if (ctx.i - orBars[orBars.length - 1] < 1) return null; // po zamknięciu zakresu
  let orH = -Infinity, orL = Infinity;
  for (const q of orBars) { if (ctx.candles[q].h > orH) orH = ctx.candles[q].h; if (ctx.candles[q].l < orL) orL = ctx.candles[q].l; }
  const p = ctx.price;
  let dir = 0;
  if (p > orH + ctx.atr * 0.05) dir = 1;
  else if (p < orL - ctx.atr * 0.05) dir = -1;
  if (dir === 0) return null;
  return {
    id: 'orb', name: 'Opening Range Breakout', group: 'breakout',
    dir, base: 47,
    why: ['wybicie ' + (dir > 0 ? 'nad' : 'pod') + ' zakres otwarcia dnia (' + orL.toFixed(2) + '–' + orH.toFixed(2) + ')'],
    invalidates: ['powrót do zakresu otwarcia (fałszywe wybicie)'],
    conditions: ['retest krawędzi zakresu utrzymany', 'wolumen na wybiciu'],
  };
}

export const ALL_DETECTORS = [
  detTrendFollowing, detMomentum, detBreakout, detBreakRetest,
  detLiquiditySweep, detWyckoffSpring, detMeanReversion, detOrderBlock,
  detFvg, detPremiumDiscount, detVwap, detSqueeze, detSessionDrive, detPivots,
  detChartPattern, detIchimoku, detSupertrend, detDivergence, detAnchoredVwap, detORB,
];
