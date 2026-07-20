import { sessionInfo } from '../utils/sessions.js';

/* --- MARKET STRUCTURE z pivotów zigzag do indeksu i (bez lookahead) ---
   Zwraca sekwencję HH/HL/LH/LL, ostatnie swingi, oraz zakres do premium/discount. */
export function marketStructure(piv, i){
  // tylko POTWIERDZONE piwoty przed/na i — live pivot (bieżące, niedomknięte
  // ekstremum nogi) repaintuje i fałszował swingi: SL/TP liczone od bieżącego
  // maksimum/minimum zamiast od realnej struktury, a BOS nie mógł się wykryć
  // (close nigdy nie przebije własnego running-high).
  const P = piv.filter(p => p.i <= i && !p.live);
  if(P.length < 4) return null;
  const highs = P.filter(p => p.t === 'H');
  const lows  = P.filter(p => p.t === 'L');
  if(highs.length < 2 || lows.length < 2) return null;
  const h1 = highs[highs.length-1], h0 = highs[highs.length-2];
  const l1 = lows[lows.length-1],  l0 = lows[lows.length-2];
  const hh = h1.p > h0.p, lh = h1.p < h0.p;
  const hl = l1.p > l0.p, ll = l1.p < l0.p;
  // klasyfikacja trendu ze struktury (nie z EMA)
  let trend = 0, label = 'zakres';
  if(hh && hl){ trend = 1; label = 'trend wzrostowy (HH+HL)'; }
  else if(lh && ll){ trend = -1; label = 'trend spadkowy (LH+LL)'; }
  else if(hh && ll){ label = 'ekspansja (rozszerzanie)'; }
  else if(lh && hl){ label = 'kontrakcja (zwężenie)'; }
  // ostatni swing high / low (do BOS/CHOCH i SL)
  const lastSwingHigh = h1, lastSwingLow = l1;
  const prevSwingHigh = h0, prevSwingLow = l0;
  // zakres bieżącej nogi do premium/discount: między ostatnim znaczącym L i H
  const rngHi = Math.max(h1.p, h0.p);
  const rngLo = Math.min(l1.p, l0.p);
  const mid = (rngHi + rngLo) / 2;
  return {
    trend, label, hh, hl, lh, ll,
    lastSwingHigh, lastSwingLow, prevSwingHigh, prevSwingLow,
    rngHi, rngLo, mid,
    seq: P.slice(-6).map(p => ({ t:p.t, p:+p.p, i:p.i })),
  };
}

/* premium/discount: gdzie w zakresie jest cena. Long tylko w discount, short w premium. */
export function premiumDiscount(ms, price, cfg){
  if(!ms || ms.rngHi <= ms.rngLo) return { zone:'?', pct:50 };
  const pTh = (cfg && cfg.premium != null) ? cfg.premium : 62;
  const dTh = (cfg && cfg.discount != null) ? cfg.discount : 38;
  /* clamp 0–100: po wyłączeniu live pivotu cena może być poza zakresem
     potwierdzonych swingów (świeże wybicie) — to nadal premium/discount 100/0 */
  const pct = Math.max(0, Math.min(100, (price - ms.rngLo) / (ms.rngHi - ms.rngLo) * 100));
  let zone = 'equilibrium';
  if(pct >= pTh) zone = 'premium';
  else if(pct <= dTh) zone = 'discount';
  return { zone, pct: +pct.toFixed(0) };
}

/* --- BOS / CHOCH ---
   BOS = kontynuacja: cena zamyka za ostatnim swingiem ZGODNIE z trendem.
   CHOCH = zmiana charakteru: cena zamyka za swingiem PRZECIW dotychczasowemu trendowi.
   Liczymy na zamknięciu świecy i (candles[i].c). */
export function detectBosChoch(candles, ms, i, atr){
  if(!ms) return { bos:0, choch:0, txt:null, brokeLevel:null };
  const cd = candles[i];
  const c = cd.c;
  const sh = ms.lastSwingHigh.p, sl = ms.lastSwingLow.p;
  const a = atr || (cd.h - cd.l) || 1;
  /* WYMÓG DISPLACEMENTU: samo 1-tickowe przebicie to często sweep (pułapka),
     nie realne złamanie struktury. Żądamy: zamknięcie WYRAŹNIE za poziomem
     (≥0.05·ATR) ORAZ świecy z ciałem (≥0.6·ATR). Inaczej — brak BOS/CHOCH. */
  const body = Math.abs(cd.c - cd.o);
  const decisive = body >= a * 0.6;
  const beyondUp = c > sh + a * 0.05;
  const beyondDn = c < sl - a * 0.05;
  let bos = 0, choch = 0, txt = null, brokeLevel = null;
  if(ms.trend >= 0 && beyondUp && decisive){ bos = 1; txt = 'BOS↑ (wybicie z impulsem, kontynuacja)'; brokeLevel = sh; }
  else if(ms.trend <= 0 && beyondDn && decisive){ bos = -1; txt = 'BOS↓ (wybicie z impulsem, kontynuacja)'; brokeLevel = sl; }
  else if(ms.trend > 0 && beyondDn && decisive){ choch = -1; txt = 'CHOCH↓ (impulsowe złamanie swing low — możliwa zmiana trendu)'; brokeLevel = sl; }
  else if(ms.trend < 0 && beyondUp && decisive){ choch = 1; txt = 'CHOCH↑ (impulsowe złamanie swing high — możliwa zmiana trendu)'; brokeLevel = sh; }
  return { bos, choch, txt, brokeLevel };
}

/* --- FAIR VALUE GAP (imbalance 3-świecowy) ---
   Bull FVG: low[i] > high[i-2]  (luka w górę, niewypełniona).
   Bear FVG: high[i] < low[i-2]. Szukamy najświeższego niewypełnionego blisko ceny. */
export function detectFVG(candles, i, atr){
  const out = [];
  const from = Math.max(2, i-30);
  /* filtr wielkości: mikro-luka < 0.3×ATR to szum, nie imbalance instytucjonalny */
  const minGap = (atr || 0) * 0.3;
  for(let k=from;k<=i;k++){
    const a = candles[k-2], c = candles[k];
    if(a.h < c.l && (c.l - a.h) >= minGap){ out.push({ i:k, dir:1, lo:a.h, hi:c.l, mid:(a.h+c.l)/2 }); }
    else if(a.l > c.h && (a.l - c.h) >= minGap){ out.push({ i:k, dir:-1, lo:c.h, hi:a.l, mid:(c.h+a.l)/2 }); }
  }
  // niewypełnione: cena po utworzeniu nie przekroczyła luki na wskroś
  const price = candles[i].c;
  const fresh = out.filter(g => {
    let filled = false;
    for(let k=g.i+1;k<=i;k++){
      if(g.dir === 1 && candles[k].l <= g.lo) { filled = true; break; }
      if(g.dir === -1 && candles[k].h >= g.hi) { filled = true; break; }
    }
    return !filled;
  });
  // najbliższy cenie
  let best = null, bd = Infinity;
  for(const g of fresh){ const d = Math.abs(price - g.mid); if(d < bd){ bd = d; best = g; } }
  return { list: fresh.slice(-6), nearest: best, nearDistAtr: (best && atr) ? bd/atr : null };
}

/* --- ORDER BLOCK ---
   Ostatnia przeciwna świeca przed impulsem (displacement), który złamał strukturę.
   Bull OB = ostatnia świeca spadkowa przed silnym ruchem w górę łamiącym swing high. */
export function detectOrderBlock(candles, ms, i, atr){
  if(!ms || !atr) return null;
  const price = candles[i].c;
  const look = Math.min(20, i-2);
  // szukamy displacementu: świeca z body >= 1.2*ATR w ostatnich `look`
  for(let k=i;k>i-look;k--){
    const c = candles[k];
    const body = Math.abs(c.c - c.o);
    if(body < atr*1.2) continue;
    const dir = c.c > c.o ? 1 : -1;

    /* WYMÓG ZŁAMANIA STRUKTURY: instytucjonalny OB to świeca przed impulsem,
       który ŁAMIE lokalną strukturę — nie każda duża świeca. Proxy: zamknięcie
       impulsu poza ekstremum 10 poprzednich świec. */
    let ext = dir === 1 ? -Infinity : Infinity;
    for(let q=Math.max(0,k-10);q<k;q++){
      if(dir === 1 && candles[q].h > ext) ext = candles[q].h;
      if(dir === -1 && candles[q].l < ext) ext = candles[q].l;
    }
    const brokeStructure = dir === 1 ? c.c > ext : c.c < ext;
    if(!brokeStructure) continue;

    // przeciwna świeca tuż przed impulsem
    let ob = null;
    for(let j=k-1;j>=k-3 && j>=0;j--){
      const p = candles[j];
      if(dir === 1 && p.c < p.o){ ob = { i:j, lo:p.l, hi:p.h, dir:1 }; break; }
      if(dir === -1 && p.c > p.o){ ob = { i:j, lo:p.l, hi:p.h, dir:-1 }; break; }
    }
    if(!ob) continue;

    /* MITYGACJA: OB "zużywa się" przy każdym powrocie ceny w strefę; przebicie
       na wskroś unieważnia go całkiem. Śledzimy od impulsu do teraz. */
    let touches = 0, inZone = false, invalid = false;
    for(let j=k+1;j<=i;j++){
      const cd = candles[j];
      const through = dir === 1 ? cd.c < ob.lo - atr*0.1 : cd.c > ob.hi + atr*0.1;
      if(through){ invalid = true; break; }
      const entered = dir === 1 ? cd.l <= ob.hi : cd.h >= ob.lo;
      if(entered && !inZone){ touches++; inZone = true; }
      else if(!entered) inZone = false;
    }
    if(invalid) continue; // szukaj starszego/świeższego ważnego OB

    const inside = price >= ob.lo && price <= ob.hi;
    const distAtr = inside ? 0 : Math.min(Math.abs(price-ob.lo), Math.abs(price-ob.hi))/atr;
    /* pierwsza reakcja w strefie (touches===1 gdy właśnie jesteśmy w środku)
       jest OK; OB uznajemy za zmitygowany po wcześniejszym pełnym teście */
    const mitigated = inside ? touches > 1 : touches > 0;
    return { ...ob, kImpulse:k, inside, distAtr:+distAtr.toFixed(2), mitigated, touches };
  }
  return null;
}

/* --- LIQUIDITY SWEEP ---
   Wybicie za ostatni swing (equal highs/lows = płynność) + szybki powrót (knot).
   To najsilniejszy filtr false-breaków. Zwraca kierunek KONTRY po zdjęciu płynności. */
export function detectLiquiditySweep(candles, ms, i, atr){
  if(!ms || !atr) return null;
  const c = candles[i];
  const sh = ms.lastSwingHigh.p, sl = ms.lastSwingLow.p;
  const bufr = atr*0.08;
  /* sweep może być 1- lub 2-świecowy: którakolwiek z ostatnich 2 świec wybiła
     knotem poza swing, a bieżące zamknięcie wróciło z powrotem za poziom. */
  for(let k=i;k>=Math.max(1,i-1);k--){
    const ck = candles[k];
    if(ck.h > sh + bufr && c.c < sh){
      const wick = ck.h - Math.max(ck.o, ck.c);
      if(wick > (ck.h - ck.l)*0.35) return { dir:-1, level:sh, bars:i-k+1, txt:'Liquidity sweep nad swing high (pułapka) → bias SHORT' };
    }
    if(ck.l < sl - bufr && c.c > sl){
      const wick = Math.min(ck.o, ck.c) - ck.l;
      if(wick > (ck.h - ck.l)*0.35) return { dir:1, level:sl, bars:i-k+1, txt:'Liquidity sweep pod swing low (pułapka) → bias LONG' };
    }
  }
  return null;
}

/* --- EQUAL HIGHS / LOWS (magnesy płynności → cele TP) --- */
export function detectEqualLevels(piv, i, atr){
  if(!atr) return { eqHigh:null, eqLow:null };
  const P = piv.filter(p => p.i <= i && !p.live); // tylko potwierdzone swingi
  const highs = P.filter(p => p.t === 'H').slice(-4);
  const lows  = P.filter(p => p.t === 'L').slice(-4);
  const tol = atr*0.25;
  let eqHigh = null, eqLow = null;
  for(let a=0;a<highs.length;a++) for(let b=a+1;b<highs.length;b++){
    if(Math.abs(highs[a].p - highs[b].p) < tol){ eqHigh = Math.max(highs[a].p, highs[b].p); }
  }
  for(let a=0;a<lows.length;a++) for(let b=a+1;b<lows.length;b++){
    if(Math.abs(lows[a].p - lows[b].p) < tol){ eqLow = Math.min(lows[a].p, lows[b].p); }
  }
  return { eqHigh, eqLow };
}

/* --- DISPLACEMENT (siła ostatniej świecy — potwierdzenie wejścia) --- */
export function displacement(candles, i, atr, cfg){
  if(!atr) return 0;
  const impTh = (cfg && cfg.dispImpulse != null) ? cfg.dispImpulse : 1.2;
  const bodyTh = (cfg && cfg.dispBody != null) ? cfg.dispBody : 0.6;
  const c = candles[i];
  const body = Math.abs(c.c - c.o);
  const rng = c.h - c.l || 1e-9;
  const bodyRatio = body / rng;
  const impulse = body / atr;
  if(impulse >= impTh && bodyRatio >= bodyTh) return c.c > c.o ? 1 : -1;
  return 0;
}

/* --- RELATIVE VOLUME vs ta sama pora sesji (przybliżenie: średnia z 20 + z-score) --- */
export function relativeVolume(candles, i){
  let av = 0, cnt = 0, sq = 0;
  for(let q=Math.max(0,i-20);q<i;q++){ av += candles[q].v; cnt++; }
  if(!cnt) return { rv:1, spike:false };
  av /= cnt;
  for(let q=Math.max(0,i-20);q<i;q++){ sq += (candles[q].v-av)**2; }
  const sd = Math.sqrt(sq/cnt) || 1;
  const rv = av > 0 ? candles[i].v/av : 1;
  const z = (candles[i].v - av)/sd;
  return { rv:+rv.toFixed(2), z:+z.toFixed(1), spike: rv > 1.6, strongSpike: z > 2 };
}

/* ============================================================
   PEŁNA ANALIZA SMC dla świecy i — jedno wywołanie, zero lookahead.
   Zwraca obiekt wpinany do score w computeSignal.
   ============================================================ */
export function smcAnalyze(candles, piv, i, atr, cfg){
  const ms = marketStructure(piv, i);
  const price = candles[i].c;
  const pd = premiumDiscount(ms, price, cfg);
  const bc = detectBosChoch(candles, ms, i, atr);
  const fvg = detectFVG(candles, i, atr);
  const ob = detectOrderBlock(candles, ms, i, atr);
  const sweep = detectLiquiditySweep(candles, ms, i, atr);
  const eq = detectEqualLevels(piv, i, atr);
  const disp = displacement(candles, i, atr, cfg);
  return { ms, pd, bc, fvg, ob, sweep, eq, disp, price };
}

/* ============================================================
   COACH — analiza po-transakcyjna. Wywoływana gdy pozycja się zamknie.
   Dostaje wpis dziennika + kontekst i zwraca ustrukturyzowaną ocenę.
   ============================================================ */
export function coachReview(entry, journalAll){
  const notes = [];
  const flags = [];
  const e = entry;
  const isWin = e.r > 0;
  const rr = e.rr1 || (e.risk ? Math.abs((e.tp1 - e.entry)/e.risk) : null);

  // 1) RR jakość
  if(rr != null){
    if(rr < 1.5) flags.push({ type:'rr', sev:2, txt:'RR '+rr.toFixed(2)+' poniżej 1:1.5 — setup nie spełniał minimum' });
    else if(rr >= 2) notes.push('Dobre RR ('+rr.toFixed(2)+') — nagradzasz się za czekanie na jakość');
  }

  // 2) wynik vs score silnika
  if(e.score != null){
    if(!isWin && Math.abs(e.score) < 40) notes.push('Strata przy słabym score ('+e.score+') — sygnał był graniczny, wejście opcjonalne');
    if(isWin && Math.abs(e.score) >= 55) notes.push('Wygrana z mocnym score ('+e.score+') — to jest Twój setup A+, powtarzaj takie');
  }

  // 3) FOMO / gonienie ruchu — z jakości wejścia jeśli zapisana
  if(e.entryQuality && e.entryQuality.chase){
    flags.push({ type:'fomo', sev:1, txt:'Wejście „w biegu" ('+e.entryQuality.dist+'×ATR od '+e.entryQuality.anchor+') — sygnał FOMO, gorszy timing' });
  }

  // 4) overtrading — ile transakcji na tym instrumencie w krótkim oknie
  if(Array.isArray(journalAll)){
    const win2h = journalAll.filter(x => x.sym === e.sym && Math.abs((x.ts||0)-(e.ts||0)) < 2*3600*1000);
    if(win2h.length >= 4) flags.push({ type:'overtrading', sev:2, txt:win2h.length+' transakcji na '+e.name+' w 2h — objaw overtradingu, zwolnij' });
  }

  // 5) revenge trading — wejście tuż po stracie, większe/szybsze
  if(Array.isArray(journalAll)){
    const prior = journalAll
      .filter(x => x.id !== e.id && (x.exitTs || x.ts) < (e.ts||0) && x.result && x.result !== 'open')
      .sort((a,b) => (b.exitTs||b.ts) - (a.exitTs||a.ts))[0];
    if(prior && prior.r < 0){
      const gap = (e.ts - (prior.exitTs||prior.ts)) / 60000;
      if(gap < 10) flags.push({ type:'revenge', sev:2, txt:'Wejście '+Math.round(gap)+' min po stracie — ryzyko zemsty na rynku. Po SL zrób pauzę 15+ min' });
    }
  }

  // 6) sesja
  if(e.ts){
    const s = sessionInfo(new Date(e.ts));
    if(s.quality < 0) flags.push({ type:'session', sev:1, txt:'Wejście w słabym oknie: '+s.label+' — cienki rynek, więcej fałszywych ruchów' });
  }

  // podsumowanie + jedna rzecz do poprawy
  let focus = null;
  const sev2 = flags.filter(f => f.sev >= 2);
  if(sev2.length) focus = sev2[0].txt;
  else if(flags.length) focus = flags[0].txt;
  else if(isWin) focus = 'Czysto zagrane — trzymaj proces, nie zwiększaj ryzyka po serii wygranych';
  else focus = 'Strata w ramach planu — to koszt biznesu. Nic do zmiany, jeśli setup był w zasadach';

  return {
    result: isWin ? 'WIN' : (e.r < 0 ? 'LOSS' : 'BE'),
    r: e.r, rr,
    notes, flags,
    focus,
    grade: sev2.length ? 'C' : (flags.length ? 'B' : (isWin ? 'A' : 'B')),
  };
}
