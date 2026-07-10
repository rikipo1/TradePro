import { spreadPx } from '../constants/instruments.js';
import { getChart, htfTrend } from '../data/feed.js';
import { EMA_DEFS, adxSeries, atrSeries, bollSeries, emaSeries, findSRZones, macdSeries, obvSeries, rsiSeries, stochSeries, vwapSeries } from '../indicators/index.js';
import { detectPatterns, zigzag } from '../patterns/index.js';
import { displacement, relativeVolume, smcAnalyze } from '../smc/index.js';
import { sessionInfo } from '../utils/sessions.js';
import { buildPullbackPlan } from './pullback.js';
import { buildOpportunities } from './opportunities.js';

/* ---------------- Faza 4: silnik sygnałów (confluence) ---------------- */
export function computeSignal(candles, ind, emaData, patterns, hasVol, atIdx, srOverride){
  const n = candles.length;
  const isLive = (atIdx == null);
  /* ANTY-REPAINT: na żywo bieżąca świeca (n-1) dopiero się tworzy — sygnał
     liczymy na OSTATNIEJ ZAMKNIĘTEJ (n-2), więc live i backtest są spójne
     i score nie skacze z każdym tickiem. Do poziomów bierzemy realną cenę. */
  const livePrice = candles[n-1] ? candles[n-1].c : null;
  const i = isLive ? n - 2 : atIdx;
  if(!ind || i < 30) return null;
  const c = candles[i];
  const price = isLive ? (livePrice != null ? livePrice : c.c) : c.c;
  const v = a => (a && a[i] != null) ? a[i] : null;
  let atr = v(ind.atr);
  if(atr == null){
    for(let q=ind.atr.length-1;q>=0;q--){ if(ind.atr[q] != null){ atr = ind.atr[q]; break; } }
  }
  if(!atr) return null;

  /* ---- konfiguracja SMC (z ustawień, z fallbackiem na domyślne) ---- */
  const cfg = (srOverride && srOverride.__smc) || {
    premium:62, discount:38, dispImpulse:1.2, dispBody:0.6, fvgDist:0.5, strong:55, rangeBonus:15, minRR:1.5,
  };
  /* ---- SMC / struktura rynku (zero lookahead: piwoty tylko do i) ---- */
  const _piv = zigzag(candles.slice(0, i+1), ind.atr.slice(0, i+1));
  const smc = smcAnalyze(candles, _piv, i, atr, cfg);
  const relVol = hasVol ? relativeVolume(candles, i) : null;

  const reasons = [];
  const warns = [];
  let score = 0;
  const add = (pts, txt) => {
    pts = Math.round(pts);
    if(pts === 0) return;
    score += pts;
    reasons.push({ pts, txt });
  };

  const e20 = emaData[20], e50 = emaData[50], e200 = emaData[200];
  const v20 = v(e20), v50 = v(e50), v200 = v(e200);

  /* 1) struktura EMA */
  if(v20 != null && v50 != null){
    if(price > v20 && v20 > v50) add(14, 'Cena > EMA20 > EMA50 — układ wzrostowy');
    else if(price < v20 && v20 < v50) add(-14, 'Cena < EMA20 < EMA50 — układ spadkowy');
  }
  if(v200 != null){
    if(price > v200) add(6, 'Cena nad EMA200 — przewaga popytu długoterminowo');
    else add(-6, 'Cena pod EMA200 — przewaga podaży długoterminowo');
  }
  if(e20 && e20[i] != null && e20[i-4] != null){
    const sl = (e20[i] - e20[i-4]) / atr;
    if(sl > 0.3) add(8, 'EMA20 wyraźnie rośnie');
    else if(sl < -0.3) add(-8, 'EMA20 wyraźnie spada');
  }

  /* 2) RSI */
  const rsi = v(ind.rsi);
  if(rsi != null){
    if(rsi >= 55 && rsi <= 70) add(8, 'RSI ' + rsi.toFixed(0) + ' — momentum pro-wzrostowe');
    else if(rsi <= 45 && rsi >= 30) add(-8, 'RSI ' + rsi.toFixed(0) + ' — momentum pro-spadkowe');
    else if(rsi > 70) add(-4, 'RSI ' + rsi.toFixed(0) + ' — wykupienie, ryzyko korekty');
    else if(rsi < 30) add(4, 'RSI ' + rsi.toFixed(0) + ' — wyprzedanie, możliwe odbicie');
  }

  /* 3) MACD */
  const m = v(ind.macd.macd), s = v(ind.macd.signal);
  const h = v(ind.macd.hist), hp = (ind.macd.hist[i-1] != null) ? ind.macd.hist[i-1] : null;
  if(m != null && s != null){
    if(m > s) add(7, 'MACD nad linią sygnału');
    else add(-7, 'MACD pod linią sygnału');
    if(h != null && hp != null){
      if(h > hp && h > 0) add(4, 'Histogram MACD rośnie');
      else if(h < hp && h < 0) add(-4, 'Histogram MACD pogłębia spadek');
    }
  }

  /* 4) ADX — siła trendu / tryb konsolidacji */
  const adx = v(ind.adx.adx), pdi = v(ind.adx.pdi), mdi = v(ind.adx.mdi);
  let rangeMode = false;
  if(adx != null){
    if(adx < 18){
      rangeMode = true;
      warns.push('ADX ' + adx.toFixed(0) + ' — rynek w konsolidacji, sygnały trendowe są słabsze');
    } else if(pdi != null && mdi != null){
      if(pdi > mdi) add(6, 'ADX ' + adx.toFixed(0) + ', +DI > −DI — aktywny trend wzrostowy');
      else add(-6, 'ADX ' + adx.toFixed(0) + ', −DI > +DI — aktywny trend spadkowy');
    }
  }

  /* 5) Stochastic — przecięcia w strefach skrajnych */
  const k = v(ind.stoch.k), d = v(ind.stoch.d);
  const kp = ind.stoch.k[i-1], dp = ind.stoch.d[i-1];
  if(k != null && d != null && kp != null && dp != null){
    if(kp <= dp && k > d && k < 30) add(7, 'Stochastic — przecięcie w górę w wyprzedaniu');
    if(kp >= dp && k < d && k > 70) add(-7, 'Stochastic — przecięcie w dół w wykupieniu');
  }

  /* 6) VWAP */
  const vw = ind.vwap ? v(ind.vwap) : null;
  if(vw != null){
    if(price > vw) add(5, 'Cena nad VWAP — kontrola popytu w sesji');
    else add(-5, 'Cena pod VWAP — kontrola podaży w sesji');
  }

  /* 7) Bollinger w konsolidacji (powrót do średniej) */
  const bU = v(ind.boll.up), bD = v(ind.boll.dn);
  if(rangeMode && bU != null && bD != null){
    if(price >= bU) add(-6, 'Cena przy górnej wstędze Bollingera w konsolidacji');
    else if(price <= bD) add(6, 'Cena przy dolnej wstędze Bollingera w konsolidacji');
  }

  /* 8) formacje z ostatnich 3 świec */
  let patScore = 0; const patNames = [];
  for(let q=0;q<patterns.list.length;q++){
    const p = patterns.list[q];
    if(p.i >= i - 3 && p.i <= i && p.dir !== 0){
      const w = (p.conf - 50)/50 * (p.kind === 'geo' ? 14 : 10) * p.dir;
      patScore += w;
      if(Math.abs(w) >= 2) patNames.push((p.dir > 0 ? '▲ ' : '▼ ') + p.name + ' ' + p.conf + '%');
    }
  }
  patScore = Math.max(-18, Math.min(18, patScore));
  if(Math.abs(patScore) >= 2) add(patScore, 'Formacje: ' + patNames.slice(0, 3).join(', '));

  /* 9) kontekst S/R + wybicia */
  const zones = srOverride || (ind.sr || []);
  let nearSup = null, nearRes = null;
  for(let z=0;z<zones.length;z++){
    const zn = zones[z], mid = (zn.lo + zn.hi)/2;
    if(mid < price && (!nearSup || mid > (nearSup.lo + nearSup.hi)/2)) nearSup = zn;
    if(mid > price && (!nearRes || mid < (nearRes.lo + nearRes.hi)/2)) nearRes = zn;
  }
  if(nearSup && price - nearSup.hi >= 0 && price - nearSup.hi < atr*0.6){
    add(8, 'Cena tuż nad wsparciem (' + nearSup.touches + ' odbić)');
  }
  if(nearRes && nearRes.lo - price >= 0 && nearRes.lo - price < atr*0.6){
    add(-8, 'Cena tuż pod oporem (' + nearRes.touches + ' odbić)');
  }
  const prevClose = candles[i-1].c;
  if(nearSup && prevClose <= nearSup.hi && price > nearSup.hi + atr*0.1){
    add(10, 'Świeże wybicie nad strefę oporu');
  }
  if(nearRes && prevClose >= nearRes.lo && price < nearRes.lo - atr*0.1){
    add(-10, 'Świeże wybicie pod strefę wsparcia');
  }

  /* 10) wolumen — relative volume vs 20 świec (z-score) */
  if(relVol){
    if(relVol.strongSpike){
      add(c.c >= c.o ? 6 : -6, 'RelVol ' + relVol.rv + '× (z' + relVol.z + ') — silny wolumen potwierdza ' + (c.c >= c.o ? 'popyt' : 'podaż'));
    } else if(relVol.spike){
      add(c.c >= c.o ? 4 : -4, 'RelVol ' + relVol.rv + '× — podwyższony wolumen ' + (c.c >= c.o ? 'po stronie popytu' : 'po stronie podaży'));
    } else if(relVol.rv < 0.6){
      warns.push('Niski wolumen (RelVol ' + relVol.rv + '×) — ruch bez zaangażowania, ostrożnie z wybiciem');
    }
  }

  /* ===================== SMC / STRUKTURA (rdzeń hybrydowy) ===================== */
  let smcBias = 0;               // kierunkowy bias ze struktury (do filaru struktury)
  let smcLocation = 0;           // premium/discount + OB/FVG (do filaru lokalizacji)
  let smcConfirm = 0;            // BOS/displacement/sweep (do filaru potwierdzenia)
  if(smc.ms){
    /* 1. Trend ze STRUKTURY (HH/HL vs LH/LL) — nie z EMA */
    if(smc.ms.trend === 1){ add(14, 'Struktura: ' + smc.ms.label); smcBias = 1; }
    else if(smc.ms.trend === -1){ add(-14, 'Struktura: ' + smc.ms.label); smcBias = -1; }
    else { warns.push('Struktura: ' + smc.ms.label + ' — brak czystego trendu, wymagaj mocniejszego setupu'); }

    /* 2. BOS / CHOCH */
    if(smc.bc.bos !== 0){ add(smc.bc.bos * 12, smc.bc.txt); smcConfirm += smc.bc.bos; }
    if(smc.bc.choch !== 0){
      add(smc.bc.choch * 10, smc.bc.txt);
      smcBias = smc.bc.choch; smcConfirm += smc.bc.choch;
      warns.push('CHOCH — potencjalne odwrócenie; poprzedni trend może się kończyć');
    }

    /* 3. PREMIUM / DISCOUNT — long tylko w tanim, short w drogim */
    if(smc.pd.zone === 'discount'){ add(8, 'Cena w DISCOUNT (' + smc.pd.pct + '% zakresu) — dobra strefa do LONG'); smcLocation += 1; }
    else if(smc.pd.zone === 'premium'){ add(-8, 'Cena w PREMIUM (' + smc.pd.pct + '% zakresu) — dobra strefa do SHORT'); smcLocation -= 1; }

    /* 4. LIQUIDITY SWEEP — najsilniejszy filtr false-break, gra kontrę */
    if(smc.sweep){ add(smc.sweep.dir * 13, smc.sweep.txt); smcConfirm += smc.sweep.dir; smcLocation += smc.sweep.dir; }
  }

  /* 5. ORDER BLOCK — cena reagująca na OB */
  if(smc.ob){
    if(smc.ob.inside || smc.ob.distAtr < 0.4){
      add(smc.ob.dir * 9, 'Cena przy Order Block ' + (smc.ob.dir > 0 ? 'popytowym' : 'podażowym') + ' (świeży, reakcja instytucji)');
      smcLocation += smc.ob.dir;
    }
  }

  /* 6. FAIR VALUE GAP — niewypełniona luka blisko ceny */
  if(smc.fvg.nearest && smc.fvg.nearDistAtr != null && smc.fvg.nearDistAtr < cfg.fvgDist){
    const g = smc.fvg.nearest;
    add(g.dir * 7, 'Świeży FVG ' + (g.dir > 0 ? 'popytowy' : 'podażowy') + ' tuż przy cenie (imbalance do wypełnienia)');
    smcLocation += g.dir;
  }

  /* 7. DISPLACEMENT — siłowa świeca = potwierdzenie kierunku wejścia */
  if(smc.disp !== 0){ add(smc.disp * 6, 'Displacement — silna świeca ' + (smc.disp > 0 ? 'wzrostowa' : 'spadkowa') + ' (impet instytucjonalny)'); smcConfirm += smc.disp; }

  /* --- filtr trendu z wyższego interwału (jeśli podany htf) --- */
  let htfDir = 0;
  if(srOverride && srOverride.__htf){
    htfDir = srOverride.__htf.dir || 0;
    if(htfDir !== 0){
      const txt = htfDir > 0 ? 'Wyższy interwał (' + srOverride.__htf.label + ') wzrostowy' : 'Wyższy interwał (' + srOverride.__htf.label + ') spadkowy';
      add(htfDir * 10, txt);
    }
  }

  score = Math.max(-100, Math.min(100, Math.round(score)));

  /* --- JAKOŚĆ WEJŚCIA liczona PRZED decyzją o kierunku ---
     dystans ceny do najbliższej kotwicy (EMA20 / VWAP / świeżo złamana strefa).
     Blisko kotwicy = świeże wejście przy strefie (dobre, ciasny SL);
     daleko = „gonienie ruchu" (złe RR, wejście w biegu).
     Kierunek prawdopodobny bierzemy ze znaku score, by dobrać właściwą strefę. */
  const probDir = score > 0 ? 1 : score < 0 ? -1 : 0;
  const anchors = [];
  if(v20 != null) anchors.push({ name:'EMA20', px:v20 });
  if(vw != null)  anchors.push({ name:'VWAP',  px:vw });
  if(probDir === 1 && nearSup) anchors.push({ name:'wsparcie', px:nearSup.hi });
  if(probDir === -1 && nearRes) anchors.push({ name:'opór', px:nearRes.lo });
  let bestDist = null, bestName = null;
  for(let q=0;q<anchors.length;q++){
    const d = Math.abs(price - anchors[q].px) / atr;
    if(bestDist == null || d < bestDist){ bestDist = d; bestName = anchors[q].name; }
  }
  let eqGrade = null, eqGood = false, eqChase = false, eqPts = 0;
  if(bestDist != null){
    if(bestDist <= 0.6){ eqGrade = 'przy strefie'; eqGood = true; eqPts = 6; }
    else if(bestDist <= 1.3){ eqGrade = 'akceptowalne'; eqPts = 0; }
    else { eqGrade = 'gonienie ruchu'; eqChase = true; eqPts = -8; }
    /* korekta score PRZED progiem — dobre wejście lekko premiowane,
       gonienie karane, więc kara realnie wpływa na to czy sygnał w ogóle powstanie */
    if(probDir !== 0 && eqPts !== 0){
      score = Math.max(-100, Math.min(100, score + probDir*eqPts));
    }
  }

  /* --- konfluencja z 3 ORTOGONALNYCH filarów ---
     Poprzednio wszystkie 3 czytały „cena vs EMA/VWAP" → jeden dowód liczony 3×.
     Teraz każdy filar patrzy na COŚ INNEGO:
       STRUKTURA  = market structure (HH/HL/LH/LL, CHOCH) — NIE z EMA
       LOKALIZACJA = premium/discount + OB + FVG + S/R + VWAP (gdzie w rynku jesteśmy)
       POTWIERDZENIE = BOS + displacement + sweep + momentum (czy jest impet TERAZ) */
  const pillarStruct = smcBias !== 0 ? smcBias
    : ((v20 != null && v50 != null && price > v20 && v20 > v50) ? 1
      : (v20 != null && v50 != null && price < v20 && v20 < v50) ? -1 : 0);

  const locScore = smcLocation
    + ((nearSup && price - nearSup.hi >= 0 && price - nearSup.hi < atr*0.6) ? 1 : 0)
    - ((nearRes && nearRes.lo - price >= 0 && nearRes.lo - price < atr*0.6) ? 1 : 0)
    + (vw != null ? (price > vw ? 0.5 : -0.5) : 0);
  const pillarLoc = locScore > 0.4 ? 1 : locScore < -0.4 ? -1 : 0;

  const confScore = smcConfirm
    + (m != null && s != null ? (m > s ? 0.5 : -0.5) : 0)
    + (rsi != null ? (rsi >= 55 ? 0.5 : rsi <= 45 ? -0.5 : 0) : 0)
    + (relVol && relVol.spike ? (c.c >= c.o ? 0.5 : -0.5) : 0);
  const pillarMom = confScore > 0.4 ? 1 : confScore < -0.4 ? -1 : 0;
  const pillarCtx = pillarLoc; // zachowana nazwa dla zgodności z resztą kodu/UI

  const bullPillars = (pillarStruct > 0 ? 1 : 0) + (pillarMom > 0 ? 1 : 0) + (pillarLoc > 0 ? 1 : 0);
  const bearPillars = (pillarStruct < 0 ? 1 : 0) + (pillarMom < 0 ? 1 : 0) + (pillarLoc < 0 ? 1 : 0);

  /* --- dynamiczny próg: bazowy z ustawień, wyżej w konsolidacji --- */
  const baseTH = (srOverride && srOverride.__minScore != null) ? srOverride.__minScore : 30;
  const TH = rangeMode ? baseTH + cfg.rangeBonus : baseTH, STRONG = cfg.strong;
  let dir = 0;
  if(score >= TH) dir = 1; else if(score <= -TH) dir = -1;

  /* wymóg zgody min. 2 z 3 filarów — inaczej konfluencja jest pozorna */
  if(dir === 1 && bullPillars < 2){ dir = 0; warns.push('Za mało zgodnych filarów (struktura/momentum/kontekst) — sygnał LONG odrzucony'); }
  if(dir === -1 && bearPillars < 2){ dir = 0; warns.push('Za mało zgodnych filarów (struktura/momentum/kontekst) — sygnał SHORT odrzucony'); }

  /* blokada sygnałów wprost przeciw wyższemu interwałowi */
  if(dir !== 0 && htfDir !== 0 && dir !== htfDir && Math.abs(score) < STRONG){
    warns.push('Sygnał przeciw trendowi wyższego interwału — odrzucony (za słaby by grać kontrę)');
    dir = 0;
  }

  if(dir !== 0 && rangeMode && Math.abs(score) < STRONG){
    warns.push('Sygnał w konsolidacji (ADX < 18) — traktuj ostrożnie');
  }

  /* --- pullback-gate: gdy „czekaj na cofnięcie" jest włączone,
     wejście w biegu (gonienie) przy słabym score jest odrzucane w SAMYM sygnale,
     a nie tylko wyciszane w alertach — karta i alert są teraz spójne --- */
  const waitPB = !!(srOverride && srOverride.__waitPullback);
  if(dir !== 0 && eqChase && Math.abs(score) < STRONG){
    if(waitPB){
      warns.push('Cena ' + (bestDist != null ? bestDist.toFixed(1) : '?') + '×ATR od ' + bestName + ' — gonienie ruchu, sygnał wstrzymany do cofnięcia (Twoja zasada „czekaj na cofnięcie")');
      dir = 0;
    } else {
      warns.push('Cena ' + (bestDist != null ? bestDist.toFixed(1) : '?') + '×ATR od ' + bestName + ' — wejście „w biegu", rozważ poczekać na cofnięcie');
    }
  }

  const out = {
    i, t: c.t, price, score, dir, atr, rangeMode, htfDir,
    pillars: { bull: bullPillars, bear: bearPillars, struct: pillarStruct, mom: pillarMom, ctx: pillarCtx },
    strong: Math.abs(score) >= STRONG,
    reasons: reasons.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)),
    warns,
  };

  /* poziomy: SL za realnym SWINGIEM (SMC), TP na STRUKTURZE, twardy gate RR≥1.5 */
  if(dir !== 0){
    const entry = price;
    const symForCost = (srOverride && srOverride.__sym) || null;
    const spr = symForCost ? spreadPx(symForCost, price) : atr*0.05;
    const wick = atr*0.15; // bufor na stop-hunt (knot)

    /* --- STOP LOSS: za ostatnim swingiem struktury + bufor + spread --- */
    let slDist;
    if(smc.ms){
      if(dir === 1){
        const swing = Math.min(smc.ms.lastSwingLow.p, nearSup ? nearSup.lo : Infinity);
        slDist = (entry - swing) + wick + spr;
      } else {
        const swing = Math.max(smc.ms.lastSwingHigh.p, nearRes ? nearRes.hi : -Infinity);
        slDist = (swing - entry) + wick + spr;
      }
    } else {
      slDist = (dir === 1 && nearSup) ? (price - nearSup.lo + wick + spr)
             : (dir === -1 && nearRes) ? (nearRes.hi - price + wick + spr)
             : atr*1.1;
    }
    slDist = Math.max(atr*0.6, Math.min(slDist, atr*2.5)); // klamra bezpieczeństwa
    const sl = dir === 1 ? entry - slDist : entry + slDist;

    /* --- TAKE PROFIT: najbliższy magnes płynności / strefa / swing przeciwny --- */
    const targets = [];
    if(dir === 1){
      if(smc.eq.eqHigh && smc.eq.eqHigh > entry) targets.push({ px:smc.eq.eqHigh, why:'equal highs (płynność)' });
      if(nearRes && nearRes.lo > entry) targets.push({ px:nearRes.lo, why:'strefa oporu' });
      if(smc.ms && smc.ms.lastSwingHigh.p > entry) targets.push({ px:smc.ms.lastSwingHigh.p, why:'poprzedni swing high' });
    } else {
      if(smc.eq.eqLow && smc.eq.eqLow < entry) targets.push({ px:smc.eq.eqLow, why:'equal lows (płynność)' });
      if(nearSup && nearSup.hi < entry) targets.push({ px:nearSup.hi, why:'strefa wsparcia' });
      if(smc.ms && smc.ms.lastSwingLow.p < entry) targets.push({ px:smc.ms.lastSwingLow.p, why:'poprzedni swing low' });
    }
    targets.sort((a,b) => Math.abs(a.px-entry) - Math.abs(b.px-entry));
    const structTP = targets[0] || null;

    const rrTo = px => (Math.abs(px - entry) - spr) / slDist;
    const minRR = cfg.minRR != null ? cfg.minRR : 1.5;
    let tp1, tp1why, rr1;
    if(structTP && rrTo(structTP.px) >= minRR){
      tp1 = structTP.px; tp1why = structTP.why; rr1 = +rrTo(structTP.px).toFixed(2);
    } else {
      tp1 = dir === 1 ? entry + slDist*minRR + spr : entry - slDist*minRR - spr; tp1why = 'RR ' + minRR + 'R'; rr1 = minRR;
    }
    const tp2 = targets[1] ? targets[1].px : (dir === 1 ? entry + slDist*2.5 + spr : entry - slDist*2.5 - spr);
    const rr2 = +rrTo(tp2).toFixed(2);

    /* --- TWARDY GATE: struktura blisko blokuje RR<min → sygnał odrzucony --- */
    if(structTP && rrTo(structTP.px) < minRR){
      const blocks = dir === 1 ? (structTP.px < entry + slDist*minRR) : (structTP.px > entry - slDist*minRR);
      if(blocks){
        warns.push('Najbliższa struktura (' + structTP.why + ') daje RR ' + rrTo(structTP.px).toFixed(2) + ' < ' + minRR + ' — setup odrzucony (brak miejsca do celu)');
        out.dir = 0; dir = 0; out.rrBlock = true;
      }
    }

    if(dir !== 0){
      out.levels = { entry, sl, tp1, tp2, slDist, rr1, rr2, tp1why, spreadPx:+spr.toFixed(6) };
      if(bestDist != null){
        out.entryQuality = {
          dist: +bestDist.toFixed(2), anchor: bestName, grade: eqGrade,
          good: eqGood, chase: eqChase,
        };
        if(eqGood){
          reasons.push({ pts: dir*6, txt:'Świeże wejście tuż przy ' + bestName + ' (dobry timing, ciasny SL)' });
        }
      }
    }
  }

  /* okna makro / otwarcia sesji (czas lokalny) — INFORMACYJNIE (bez blokady wejść) */
  const dt = new Date();
  const hm = dt.getHours()*60 + dt.getMinutes();
  const wins = [
    [9*60,        9*60+15,  'otwarcie DAX 09:00'],
    [14*60+22,    14*60+42, 'publikacje USA 14:30'],
    [15*60+25,    15*60+45, 'otwarcie Wall Street 15:30'],
    [15*60+52,    16*60+12, 'dane USA 16:00'],
    [19*60+52,    20*60+15, 'FOMC / minutes 20:00'],
  ];
  for(let q=0;q<wins.length;q++){
    if(hm >= wins[q][0] && hm <= wins[q][1]){
      out.macroWindow = wins[q][2];
      if(atIdx == null){
        warns.push('Okno makro: ' + wins[q][2] + ' — podwyższona zmienność (wejścia NIE są blokowane, uważaj na szarpnięcia)');
      }
      break;
    }
  }

  /* --- FILTR SESJI (tylko live) — cienki rynek = więcej fałszywych ruchów --- */
  const sess = sessionInfo(dt);
  out.session = { label: sess.label, quality: sess.quality };
  if(isLive && out.dir !== 0){
    if(sess.weekend){
      warns.push('Rynek zamknięty (' + sess.label + ') — wejście zablokowane');
      out.dir = 0; out.sessionBlock = true; delete out.levels;
    } else if(sess.quality < 0 && Math.abs(score) < STRONG){
      warns.push('Słabe okno płynności: ' + sess.label + ' — sygnał wstrzymany (graj w London/NY albo czekaj na mocny setup)');
      out.dir = 0; out.sessionBlock = true; delete out.levels;
    } else if(sess.quality < 0){
      warns.push('Słabe okno płynności: ' + sess.label + ' — traktuj ostrożnie, cieńszy rynek');
    } else if(sess.overlap){
      out.reasons.push({ pts: (out.dir>0?1:-1)*4, txt:'Overlap London×NY — najlepsza płynność dnia' });
    }
  }

  /* SMC — wystaw skróconą diagnostykę do UI/AI */
  out.smc = {
    struktura: smc.ms ? smc.ms.label : null,
    trend: smc.ms ? smc.ms.trend : 0,
    strefa: smc.pd ? (smc.pd.zone + ' ' + smc.pd.pct + '%') : null,
    bos: smc.bc.bos, choch: smc.bc.choch,
    orderBlock: smc.ob ? (smc.ob.dir>0?'popytowy':'podażowy') + (smc.ob.inside?' (w środku)':'') : null,
    fvg: (smc.fvg.nearest && smc.fvg.nearDistAtr!=null && smc.fvg.nearDistAtr<0.8) ? (smc.fvg.nearest.dir>0?'popytowy':'podażowy') : null,
    sweep: smc.sweep ? smc.sweep.txt : null,
    displacement: smc.disp,
  };
  out.pillarsDetail = { struktura: pillarStruct, lokalizacja: pillarLoc, potwierdzenie: pillarMom };

  /* --- PLAN WEJŚCIA PO KOREKCIE (pullback) — działa niezależnie od tego,
     czy jest teraz aktywny sygnał: podpowiada gdzie będzie następne dobre
     wejście, gdy trend trwa, ale cena jest już przewyciągnięta --- */
  try {
    out.pullback = buildPullbackPlan({
      candles, i, price, atr, smc, v20, v50, vw, nearSup, nearRes,
      htfDir, rangeMode, rsi, adx, isLive,
    });
  } catch (e) { out.pullback = null; }

  /* --- OKAZJE (ogólne) — pullback + odwrócenia/retesty/fade/OB, także w CZEKAJ --- */
  try {
    out.opportunities = buildOpportunities({
      price, atr, smc, nearSup, nearRes, rangeMode, rsi, adx, htfDir,
      signalDir: out.dir, levels: out.levels, score: out.score, pullback: out.pullback,
    });
  } catch (e) { out.opportunities = []; }

  return out;
}

/* ---- reużywalna analiza jednego symbolu (dla skanera w tle) ----
   powiela dokładnie budowę wskaźników z ChartScreen, żeby sygnał był identyczny */
export function indicatorsFor(candles, tfId){
  if(!candles || candles.length < 5) return null;
  const closes = candles.map(c => c.c);
  const hasVol = candles.some(c => c.v > 0);
  const atr = atrSeries(candles, 14);
  let atrLast = null;
  for(let i=atr.length-1;i>=0;i--){ if(atr[i] != null){ atrLast = atr[i]; break; } }
  const ind = {
    rsi: rsiSeries(closes, 14),
    macd: macdSeries(closes, 12, 26, 9),
    boll: bollSeries(closes, 20, 2),
    stoch: stochSeries(candles, 14, 3, 3),
    adx: adxSeries(candles, 14),
    atr,
    obv: hasVol ? obvSeries(candles) : null,
    vwap: (hasVol && tfId !== 'D1') ? vwapSeries(candles) : null,
    sr: findSRZones(candles, atrLast),
  };
  const emaData = {};
  for(let i=0;i<EMA_DEFS.length;i++){ emaData[EMA_DEFS[i].n] = emaSeries(closes, EMA_DEFS[i].n); }
  return { ind, emaData, hasVol };
}
export async function analyzeSymbol(symbol, tf, source, minScore, waitPullback, smcCfg){
  const data = await getChart(symbol, tf, source);
  if(!data || !data.candles || data.candles.length < 30) return { data, signal:null };
  const pack = indicatorsFor(data.candles, tf.id);
  if(!pack) return { data, signal:null };
  const patRaw = detectPatterns(data.candles, pack.ind.atr, pack.emaData[20], pack.hasVol);
  const patMap = {};
  patRaw.list.forEach(p => { (patMap[p.i] = patMap[p.i] || []).push(p); });
  const patterns = { list:patRaw.list, markers:patRaw.markers, geoDraw:patRaw.geoDraw, patMap };
  const ht = htfTrend(data.candles, tf.id);
  const srWithHtf = (pack.ind.sr || []).slice();
  srWithHtf.__htf = ht;
  srWithHtf.__minScore = (minScore != null ? minScore : 30);
  srWithHtf.__waitPullback = !!waitPullback;
  srWithHtf.__sym = symbol;
  srWithHtf.__smc = smcCfg || null;
  const signal = computeSignal(data.candles, pack.ind, pack.emaData, patterns, pack.hasVol, null, srWithHtf);
  return { data, signal, demo: !!data.demo };
}
