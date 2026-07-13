import { spreadPx, instrProfile } from '../constants/instruments.js';
import { findSRZones } from '../indicators/index.js';
import { detectCandlePatterns } from '../patterns/index.js';
import { computeSignal } from '../signals/engine.js';
import { orientedVector } from '../signals/features.js';
import { trainLogistic, fitIsotonic, brierScore } from '../signals/model.js';
import { classifyRegime } from '../signals/regime.js';
import { htfTrend } from '../data/feed.js';

/* ---------------- Faza 6: backtest / alerty ----------------
   opts: { weights, calib, tfId } — wagi/kalibracja modelu + interwał (dla HTF).
   res.samples zbiera etykiety do treningu adaptacyjnych wag.           */
export function backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, opts){
  const n = candles.length;
  const weights = (opts && opts.weights) || null;
  const calib = (opts && opts.calib) || null;
  const tfId = (opts && opts.tfId) || null;
  const res = { trades:[], equity:[0], stats:null, samples:[] };
  if(n < 90 || !ind) return res;
  const patsWrap = { list: detectCandlePatterns(candles, emaData[20], ind.atr, hasVol) };
  const slipAtr = instrProfile(sym).slipAtr || 0; // [E3-3] poślizg SL per klasa
  const warmup = 60, maxBars = 60;
  let open = null, cooldownUntil = -1, sum = 0;
  const close = t => {
    res.trades.push(t); sum += t.r; res.equity.push(+sum.toFixed(2));
    /* K5: etykieta tylko z JEDNOZNACZNYCH wyników (TP1-first lub SL-first).
       Timeouty wyrzucamy z treningu — mieszały "częściowo dodatnie" z wygraną
       i psuły definicję P(win). i1 zapisujemy do embargo w walk-forward. */
    if(open && open.factors && (t.out === 'TP1' || t.out === 'SL')){
      res.samples.push({ x: orientedVector(open.factors, open.dir), y: t.out === 'TP1' ? 1 : 0, i0: open.i0, i1: t.i1 });
    }
  };
  for(let i = warmup; i < n - 1; i++){
    if(open){
      /* ===== DYNAMICZNE ZARZĄDZANIE POZYCJĄ (ten sam schemat co paper live):
         open → (po +1R) BE → (na TP1) partial 50% + runner → trailing za
         strukturą (8-świecowy dołek/szczyt ± 0.25·ATR) do TP2 / stopa.
         Kolejność w świecy pesymistyczna: najpierw stop, potem cele.       */
      const c = candles[i], dir = open.dir;
      const costR = open.risk > 0 ? (open.costPx / open.risk) : 0;
      const rOf = px => ((px - open.entry) / open.risk) * dir;
      const stopHit = dir === 1 ? c.l <= open.slCur : c.h >= open.slCur;

      if(stopHit){
        /* [E3-3] fill SL z poślizgiem: slCur − dir·slip, slip = slipAtr·ATR —
           wyłącznie w backteście (model pesymistyczny; live rozlicza broker) */
        const slip = (ind.atr[i] != null ? ind.atr[i] : 0) * slipAtr;
        const fill = open.slCur - dir * slip;
        let r, out2, tp2f = false;
        if(open.stage === 'open'){ r = rOf(fill) - costR; out2 = 'SL'; }
        else if(open.stage === 'be'){ r = rOf(fill) - costR; out2 = 'BE'; }
        else { r = open.banked + 0.5*rOf(fill) - costR; out2 = 'TP1'; tp2f = false; }
        close({ i0:open.i0, i1:i, dir, r:+r.toFixed(3), out:out2, tp2:tp2f, prob:open.prob });
        open = null; cooldownUntil = i + 5;
        continue;
      }
      const fav = dir === 1 ? c.h : c.l;                       // korzystne ekstremum świecy
      const favR = ((fav - open.entry) / open.risk) * dir;
      if(open.stage === 'open' && favR >= 1){                  // +1R → stop na wejście (BE)
        open.stage = 'be';
        open.slCur = open.entry;
      }
      if((open.stage === 'open' || open.stage === 'be')
         && (dir === 1 ? c.h >= open.tp1 : c.l <= open.tp1)){  // TP1 → partial 50%, reszta biegnie
        open.banked = 0.5 * open.rr1;
        open.stage = 'runner';
        open.slCur = dir === 1 ? Math.max(open.slCur, open.entry) : Math.min(open.slCur, open.entry);
      }
      if(open.stage === 'runner'){
        if(dir === 1 ? c.h >= open.tp2 : c.l <= open.tp2){     // TP2 → domknij runnera
          const r = open.banked + 0.5*rOf(open.tp2) - costR;
          close({ i0:open.i0, i1:i, dir, r:+r.toFixed(3), out:'TP1', tp2:true, prob:open.prob });
          open = null; cooldownUntil = i + 5;
          continue;
        }
        /* trailing za strukturą: 8-świecowy dołek/szczyt ± bufor 0.25·ATR */
        let ext = dir === 1 ? Infinity : -Infinity;
        for(let q=Math.max(0,i-7);q<=i;q++){
          if(dir === 1 && candles[q].l < ext) ext = candles[q].l;
          if(dir === -1 && candles[q].h > ext) ext = candles[q].h;
        }
        const aI = ind.atr[i] != null ? ind.atr[i] : open.risk*0.5;
        open.slCur = dir === 1 ? Math.max(open.slCur, ext - aI*0.25)
                               : Math.min(open.slCur, ext + aI*0.25);
        /* [A10] usunięty martwy warunek sawTp2 — dotknięcie TP2 zamyka runnera
           powyżej (tp2:true), a SL-first w tej samej świecy ma zostać SL */
      }
      if(i - open.i0 >= maxBars){                              // time-stop
        const base = open.stage === 'runner' ? open.banked + 0.5*rOf(c.c) : rOf(c.c);
        close({ i0:open.i0, i1:i, dir, r:+(base - costR).toFixed(3), out:'TIMEOUT', tp2:false, prob:open.prob });
        open = null; cooldownUntil = i + 5;
      }
      continue;
    }
    if(i < cooldownUntil) continue;
    /* strefy S/R liczone WYŁĄCZNIE z danych do świecy i — zero lookahead */
    const zonesI = findSRZones(candles.slice(0, i + 1), (ind.atr[i] != null ? ind.atr[i] : null));
    if(sym) zonesI.__sym = sym;
    if(minScore != null) zonesI.__minScore = minScore;
    if(smcCfg) zonesI.__smc = smcCfg;
    /* [A3] backtest z jawnie podanym modelem = przebieg walidacyjny tego modelu;
       __reliable włącza go w computeSignal dokładnie jak w torze live */
    if(weights){ zonesI.__weights = weights; zonesI.__reliable = true; }
    if(calib) zonesI.__calib = calib;
    if(opts && opts.knn) zonesI.__knn = opts.knn;
    if(opts && opts.ablate) zonesI.__ablate = opts.ablate; // [E2-1] harness ablacyjny
    /* K2: HTF liczony PRZYCZYNOWO per świeca — dokładnie jak live. Bez tego
       trening widział htf=0 zawsze, a live htf≠0 (rozjazd cech train/serve). */
    if(tfId) zonesI.__htf = htfTrend(candles.slice(0, i + 1), tfId);
    const sig = computeSignal(candles, ind, emaData, patsWrap, hasVol, i, zonesI);
    if(sig && sig.dir !== 0 && sig.levels){
      open = {
        i0:i, dir:sig.dir,
        entry:sig.levels.entry, sl:sig.levels.sl,
        tp1:sig.levels.tp1, tp2:sig.levels.tp2,
        risk:sig.levels.slDist,
        rr1:sig.levels.rr1 || 1.5,
        costPx: sig.levels.spreadPx || (ind.atr[i] ? ind.atr[i]*0.05 : 0),
        factors: sig.factors, prob: sig.prob,
        stage:'open', slCur: sig.levels.sl, banked: 0,
      };
    }
  }
  const T = res.trades;
  const wins = T.filter(t => t.out === 'TP1').length;
  const losses = T.filter(t => t.out === 'SL').length;
  const timeouts = T.filter(t => t.out === 'TIMEOUT').length;
  const grossW = T.reduce((a, t) => a + (t.r > 0 ? t.r : 0), 0);
  const grossL = T.reduce((a, t) => a + (t.r < 0 ? -t.r : 0), 0);
  let peak = 0, dd = 0;
  for(let q=0;q<res.equity.length;q++){
    const v2 = res.equity[q];
    if(v2 > peak) peak = v2;
    if(peak - v2 > dd) dd = peak - v2;
  }
  let mc = 0, cur = 0;
  T.forEach(t => { if(t.r < 0){ cur++; if(cur > mc) mc = cur; } else { cur = 0; } });
  const tp1n = T.filter(t => t.out === 'TP1');
  res.stats = {
    n: T.length, wins, losses, timeouts,
    winRate: (wins + losses) ? wins/(wins + losses)*100 : 0,
    timeoutPct: T.length ? Math.round(timeouts/T.length*100) : 0,
    sumR: +sum.toFixed(2),
    avgR: T.length ? +(sum/T.length).toFixed(2) : 0,
    pf: grossL > 0 ? +(grossW/grossL).toFixed(2) : (grossW > 0 ? 99 : 0),
    maxDD: +dd.toFixed(2),
    maxConsecLoss: mc,
    tp2Pct: tp1n.length ? Math.round(tp1n.filter(t => t.tp2).length / tp1n.length * 100) : 0,
    longs: T.filter(t => t.dir === 1).length,
    shorts: T.filter(t => t.dir === -1).length,
  };
  return res;
}

/* statystyki z dowolnej listy transakcji (do out-of-sample) */
export function statsOf(T){
  if(!T.length) return { n:0 };
  const wins = T.filter(t => t.out === 'TP1').length, losses = T.filter(t => t.out === 'SL').length;
  const gW = T.reduce((a,t)=>a+(t.r>0?t.r:0),0), gL = T.reduce((a,t)=>a+(t.r<0?-t.r:0),0);
  const sum = T.reduce((a,t)=>a+t.r,0);
  return {
    n: T.length, wins, losses,
    winRate: (wins+losses) ? +(wins/(wins+losses)*100).toFixed(1) : 0,
    sumR: +sum.toFixed(2), avgR: +(sum/T.length).toFixed(3),
    pf: gL>0 ? +(gW/gL).toFixed(2) : (gW>0?99:0),
  };
}

/* kwantyl z listy liczb (interpolowany); null dla pustej listy */
function quantile(arr, q){
  if(!arr || !arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const idx = (s.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return +(s[lo] + (s[hi] - s[lo]) * (idx - lo)).toFixed(4);
}

/* [A4] Empiryczna dystrybucja wypłat z transakcji OOS. Model liniowy EV
   zakłada wypłatę pełnego rr1 i zero BE/TIMEOUT — realny schemat (partial
   na TP1 + runner + spory udział BE) wygląda inaczej. Zwraca null gdy n<30. */
export function computePayout(trades){
  if(!trades || trades.length < 30) return null;
  const n = trades.length;
  const wins = trades.filter(t => t.out === 'TP1');
  const be   = trades.filter(t => t.out === 'BE');
  const to   = trades.filter(t => t.out === 'TIMEOUT');
  const avg = a => a.length ? a.reduce((s, t) => s + t.r, 0) / a.length : 0;
  return {
    n,
    eWin: wins.length ? +avg(wins).toFixed(3) : null, // śr. R zwycięzcy (partial+runner)
    pBE: +(be.length / n).toFixed(3), eBE: +avg(be).toFixed(3),
    pTO: +(to.length / n).toFixed(3), eTO: +avg(to).toFixed(3),
  };
}

/* [E2-2] pokrycie reżimów: ile typów reżimu występuje w ≥15% świec danych.
   Model walidowany tylko w jednym reżimie nie jest dowodem na inne warunki. */
export function regimeCoverageOf(candles, ind, stride = 5){
  const counts = {};
  let total = 0;
  for(let i = 60; i < candles.length; i += stride){
    const r = classifyRegime(candles, i, ind.adx.adx, ind.atr);
    counts[r.type] = (counts[r.type] || 0) + 1;
    total++;
  }
  if(!total) return 0;
  let cov = 0;
  for(const k in counts){ if(counts[k] / total >= 0.15) cov++; }
  return cov;
}

/* ================= WALK-FORWARD K-FOLD =================
   Test na ostatnich 50% danych podzielonych na K foldów; dla foldu j wagi
   trenowane WYŁĄCZNIE na próbkach zamkniętych przed jego startem (embargo K1).
   [A1] KALIBRACJA PRODUKCYJNA WYŁĄCZNIE Z POOLED OOS: isotonic fitowana na
   parach (p, y) zebranych z przebiegów foldowych OUT-OF-SAMPLE — nigdy z
   przebiegu in-sample (tam isotonic dopasowuje się do szumu i zawyża P(win),
   fałszując bramkę EV i Kelly'ego).
   opts: { k=4, timeBudgetMs=20000 } (E2-4: twardy budżet czasu).           */
export function walkForwardKFold(candles, ind, emaData, hasVol, sym, minScore, smcCfg, tfId, opts = {}){
  const t0 = Date.now();
  const K = opts.k || 4;
  const timeBudgetMs = opts.timeBudgetMs != null ? opts.timeBudgetMs : 20000;
  const overBudget = () => (Date.now() - t0) > timeBudgetMs;
  const n = candles.length;
  if(n < 250) return { ok:false, reason:'za mało danych (min 250 świec)' };

  const ablate = opts.ablate || null; // [E2-1] konfiguracja ablacyjna dla całego przebiegu
  const base = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { tfId, ablate });
  if(overBudget()) return { ok:false, reason:'przekroczono budżet czasu' };

  const testStart = Math.floor(n * 0.5);
  const foldLen = Math.floor((n - testStart) / K);
  const pooledOosPairs = [];
  const pooledOosTrades = [];
  const folds = [];
  for(let j = 0; j < K; j++){
    if(overBudget()) return { ok:false, reason:'przekroczono budżet czasu' };
    const split = testStart + j * foldLen;
    const end = (j === K - 1) ? n : split + foldLen;
    /* embargo: tylko próbki ZAMKNIĘTE przed splitem (i1 < split) */
    const trainSamples = base.samples.filter(s => (s.i1 != null ? s.i1 : s.i0) < split);
    const tr = trainLogistic(trainSamples, { epochs: 400 });
    if(!tr.trained){ folds.push({ split, end, skipped:true, reason: tr.reason }); continue; }
    const run = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { weights: tr.weights, tfId, ablate });
    const oosTrades = run.trades.filter(t => t.i0 >= split && t.i0 < end);
    const oosPairs = oosTrades
      .filter(t => (t.out === 'TP1' || t.out === 'SL') && t.prob != null)
      .map(t => ({ p: t.prob, y: t.out === 'TP1' ? 1 : 0 }));
    pooledOosPairs.push(...oosPairs);
    pooledOosTrades.push(...oosTrades);
    folds.push({ split, end, nTrain: trainSamples.length, stats: statsOf(oosTrades), brier: brierScore(oosPairs) });
  }

  const used = folds.filter(f => !f.skipped && f.stats && f.stats.n > 0);
  const agg = {
    avgR:    { med: quantile(used.map(f => f.stats.avgR), 0.5), p25: quantile(used.map(f => f.stats.avgR), 0.25) },
    pf:      { med: quantile(used.map(f => f.stats.pf), 0.5) },
    winRate: { med: quantile(used.map(f => f.stats.winRate), 0.5) },
    brier:   { med: quantile(folds.filter(f => f.brier != null).map(f => f.brier), 0.5),
               p75: quantile(folds.filter(f => f.brier != null).map(f => f.brier), 0.75) },
  };

  /* wagi produkcyjne: trening na wszystkich zamkniętych próbkach */
  const trProd = trainLogistic(base.samples, { epochs: 500 });
  if(!trProd.trained) return { ok:false, reason: trProd.reason, weights: trProd.weights };
  if(overBudget()) return { ok:false, reason:'przekroczono budżet czasu' };
  const prodRun = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { weights: trProd.weights, tfId, ablate });
  const prodInSample = statsOf(prodRun.trades); // WYŁĄCZNIE diagnostyka — nie do decyzji

  /* [A1] kalibracja produkcyjna TYLKO z pooled OOS (null gdy < 150 par) */
  const prodCalib = fitIsotonic(pooledOosPairs, 150);
  const payout = computePayout(pooledOosTrades);
  const totalNoos = pooledOosTrades.length;
  const regimeCoverage = regimeCoverageOf(candles, ind);

  const verdict = reliableVerdict({ totalNoos, agg, regimeCoverage });

  return {
    ok:true, weights: trProd.weights, calib: prodCalib, training: trProd,
    folds, agg, totalNoos, oosPairsN: pooledOosPairs.length,
    payout, prodInSample, regimeCoverage,
    reliable: verdict.reliable, reliableWhy: verdict.failed,
    samples: base.samples.map(s => ({ x: s.x, y: s.y })), // historia dla kNN (diagnostyka)
  };
}

/* [E2-2/A8] Zaostrzony próg wiarygodności modelu. Wszystkie warunki naraz:
   ≥200 transakcji OOS, mediana avgR > 0, p25 avgR > −0.05 (żaden fold nie
   może tonąć), Brier p75 < 0.25 (lepiej niż moneta w ≥3/4 foldów),
   pokrycie ≥2 reżimów (model widziany w więcej niż jednych warunkach). */
export function reliableVerdict({ totalNoos, agg, regimeCoverage }){
  const checks = [
    ['n_oos ≥ 200', totalNoos >= 200],
    ['med(avgR) > 0', (agg && agg.avgR && agg.avgR.med != null) && agg.avgR.med > 0],
    ['p25(avgR) > −0.05', (agg && agg.avgR && agg.avgR.p25 != null) && agg.avgR.p25 > -0.05],
    ['Brier p75 < 0.25', (agg && agg.brier && agg.brier.p75 != null) && agg.brier.p75 < 0.25],
    ['pokrycie reżimów ≥ 2', regimeCoverage >= 2],
  ];
  const failed = checks.filter(c => !c[1]).map(c => c[0]);
  return { reliable: failed.length === 0, failed };
}
