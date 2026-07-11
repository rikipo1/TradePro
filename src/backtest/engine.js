import { spreadPx } from '../constants/instruments.js';
import { findSRZones } from '../indicators/index.js';
import { detectCandlePatterns } from '../patterns/index.js';
import { computeSignal } from '../signals/engine.js';
import { orientedVector } from '../signals/features.js';
import { trainLogistic, fitIsotonic, brierScore } from '../signals/model.js';
import { initPosition, stepPosition } from '../signals/tradeManager.js';
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
      /* [W1] DYNAMICZNE ZARZĄDZANIE POZYCJĄ przez WSPÓLNY moduł tradeManager
         (stepPosition) — dokładnie ta sama logika co paper live. Backtest dostarcza
         realne intrabar high/low oraz strukturalny trailing (8-świecowy ekstrem). */
      const c = candles[i], dir = open.dir;
      let trailLow = Infinity, trailHigh = -Infinity;         // 8-świecowe ekstrema do trailingu
      for(let q=Math.max(0,i-7);q<=i;q++){
        if(candles[q].l < trailLow) trailLow = candles[q].l;
        if(candles[q].h > trailHigh) trailHigh = candles[q].h;
      }
      const bar = {
        o:c.o, h:c.h, l:c.l, c:c.c,
        atr: ind.atr[i] != null ? ind.atr[i] : open.risk*0.5,
        trailLow, trailHigh,
        timeout: (i - open.i0 >= maxBars),
      };
      const { state, closed } = stepPosition(open, bar, { trailMode:'structure' });
      Object.assign(open, state);
      if(closed){
        close({ i0:open.i0, i1:i, dir, r:+closed.r.toFixed(3), out:closed.out, tp2:closed.tp2, prob:open.prob });
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
    if(weights) zonesI.__weights = weights;
    if(calib) zonesI.__calib = calib;
    if(opts && opts.knn) zonesI.__knn = opts.knn;
    /* K2: HTF liczony PRZYCZYNOWO per świeca — dokładnie jak live. Bez tego
       trening widział htf=0 zawsze, a live htf≠0 (rozjazd cech train/serve). */
    if(tfId) zonesI.__htf = htfTrend(candles.slice(0, i + 1), tfId);
    const sig = computeSignal(candles, ind, emaData, patsWrap, hasVol, i, zonesI);
    if(sig && sig.dir !== 0 && sig.levels){
      open = initPosition({
        dir:sig.dir,
        entry:sig.levels.entry, sl:sig.levels.sl,
        tp1:sig.levels.tp1, tp2:sig.levels.tp2,
        risk:sig.levels.slDist,
        rr1:sig.levels.rr1 || 1.5,
        costPx: sig.levels.spreadPx || (ind.atr[i] ? ind.atr[i]*0.05 : 0),
      });
      open.i0 = i; open.factors = sig.factors; open.prob = sig.prob;   // meta do etykiet/embargo
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

/* --- statystyki agregujące k-fold: mediana + IQR (25/75 percentyl) --- */
export function percentile(arr, p){
  if(!arr || !arr.length) return null;
  const s = arr.slice().sort((a,b)=>a-b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if(lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
/* [C2] EMBARGO + PURGE: z puli próbek zostaw te ZAMKNIĘTE przed startem testu
   (i1 < testStart) i NIE nachodzące oknem [i0,i1] na okno testowe [testStart,testEnd]. */
export function purgeSamples(samples, testStart, testEnd){
  return (samples || []).filter(s => {
    const i1 = s.i1 != null ? s.i1 : s.i0;
    const embargoOk = i1 < testStart;
    const overlaps = s.i0 <= testEnd && i1 >= testStart;
    return embargoOk && !overlaps;
  });
}

export function medIqr(arr){
  const a = (arr || []).filter(v => v != null && !Number.isNaN(v));
  if(!a.length) return { med:null, p25:null, p75:null, n:0 };
  return { med:+percentile(a,0.5).toFixed(3), p25:+percentile(a,0.25).toFixed(3), p75:+percentile(a,0.75).toFixed(3), n:a.length };
}

/* [C2] K-FOLD PURGED WALK-FORWARD.
   Pojedynczy split 60/40 dawał JEDNĄ próbkę OOS — brak wariancji, overfitting
   maskowany jako „OOS Brier". Tutaj K przesuwanych okien:
     dziel oś czasu na K+1 bloków; dla foldu k trenuj na blokach [0..k]
     (indeksy < startTestu), testuj na bloku k+1.
   EMBARGO (López de Prado): do treningu tylko próbki ZAMKNIĘTE przed startem
   testu (i1 < testStart). PURGE: dodatkowo wyrzucamy próbki, których okno
   [i0,i1] NACHODZI na okno testowe [testStart, testEnd].
   Agregacja: mediana + IQR (avgR, pf, winRate, brier) i łączny n_oos.
   reliable = (Σn_oos ≥ 100) AND (mediana avgR > 0) AND (75-pct brier < 0.25).
   Wagi PRODUKCYJNE trenujemy osobno na CAŁYCH danych (opcjonalnie + bufor
   priorSamples), ale RAPORTUJEMY wyłącznie metryki k-fold OOS.               */
export function walkForwardKFold(candles, ind, emaData, hasVol, sym, minScore, smcCfg, tfId, opts = {}){
  const K = opts.K || 5;
  const n = candles.length;
  if(n < 250) return { ok:false, reason:'za mało danych (min 250 świec)' };

  // jeden bazowy przebieg (wagi domyślne) → pula wszystkich próbek {x,y,i0,i1}
  const base = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { tfId });
  const allSamples = base.samples;
  const bs = Math.floor(n / (K + 1));
  if(bs < 20) return { ok:false, reason:'za mało danych na K+1 bloków' };

  const folds = [];
  for(let k = 0; k < K; k++){
    const testStart = (k + 1) * bs;
    const testEnd = (k === K - 1) ? n : (k + 2) * bs;
    const trainSamples = purgeSamples(allSamples, testStart, testEnd); // EMBARGO + PURGE
    if(trainSamples.length < 30){ folds.push({ k, skipped:true, reason:'trainN<30', n_oos:0 }); continue; }
    const tr = trainLogistic(trainSamples, { epochs: 400 });
    if(!tr.trained){ folds.push({ k, skipped:true, reason: tr.reason, n_oos:0 }); continue; }

    // kalibracja z predykcji treningowych (zamknięte przed testStart)
    const withW = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { weights: tr.weights, tfId });
    const calPairs = withW.trades
      .filter(t => t.i1 < testStart && (t.out === 'TP1' || t.out === 'SL') && t.prob != null)
      .map(t => ({ p: t.prob, y: t.out === 'TP1' ? 1 : 0 }));
    const calib = fitIsotonic(calPairs, 150);
    const finalRun = calib
      ? backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { weights: tr.weights, calib, tfId })
      : withW;
    const oosTrades = finalRun.trades.filter(t => t.i0 >= testStart && t.i0 < testEnd);
    const oosPairs = oosTrades
      .filter(t => (t.out === 'TP1' || t.out === 'SL') && t.prob != null)
      .map(t => ({ p: t.prob, y: t.out === 'TP1' ? 1 : 0 }));
    const st = statsOf(oosTrades);
    folds.push({ k, skipped:false, testStart, testEnd,
      n_oos: oosTrades.length, avgR: st.avgR || 0, pf: st.pf || 0, winRate: st.winRate || 0,
      brier: brierScore(oosPairs) });
  }

  const used = folds.filter(f => !f.skipped && f.n_oos > 0);
  const totalNoos = used.reduce((a, f) => a + f.n_oos, 0);
  const agg = {
    avgR: medIqr(used.map(f => f.avgR)),
    pf: medIqr(used.map(f => f.pf)),
    winRate: medIqr(used.map(f => f.winRate)),
    brier: medIqr(used.filter(f => f.brier != null).map(f => f.brier)),
  };
  const reliable = totalNoos >= 100
    && agg.avgR.med != null && agg.avgR.med > 0
    && agg.brier.p75 != null && agg.brier.p75 < 0.25;

  /* --- WAGI PRODUKCYJNE: trening na CAŁYCH próbkach (embargo względem „teraz"
     = ostatnia świeca; backtest domyka/timeoutuje wszystkie pozycje, więc próbki
     są już zamknięte) + opcjonalny bufor między-sesyjny (C3). NIE mieszać z
     metrykami walidacji — te pochodzą wyłącznie z k-fold OOS powyżej. --- */
  const prodPool = (opts.priorSamples && opts.priorSamples.length)
    ? allSamples.concat(opts.priorSamples)
    : allSamples;
  const prodTr = trainLogistic(prodPool, { epochs: 500 });
  let prodCalib = null, prodInSample = { n:0 };
  if(prodTr.trained){
    const prodRun = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { weights: prodTr.weights, tfId });
    const allPairs = prodRun.trades
      .filter(t => (t.out === 'TP1' || t.out === 'SL') && t.prob != null)
      .map(t => ({ p: t.prob, y: t.out === 'TP1' ? 1 : 0 }));
    prodCalib = fitIsotonic(allPairs, 150);
    prodInSample = statsOf(prodRun.trades);
  }

  return {
    ok:true, K, folds, used: used.length, agg, totalNoos, reliable,
    split: bs, baseline: base.stats, inSample: prodInSample,
    weights: prodTr.trained ? prodTr.weights : prodTr.weights, training: prodTr,
    calib: reliable ? prodCalib : null,   // [C3] kalibrację zapisujemy tylko dla wiarygodnego modelu
    samples: allSamples.map(s => ({ x: s.x, y: s.y, i0: s.i0, i1: s.i1 })), // historia dla kNN / bufora
  };
}

/* @deprecated — pojedynczy split 60/40 zastąpiony przez walkForwardKFold.
   Zachowany dla zgodności API: woła k-fold z K=1 i mapuje na starą strukturę.  */
export function walkForward(candles, ind, emaData, hasVol, sym, minScore, smcCfg, tfId){
  const kf = walkForwardKFold(candles, ind, emaData, hasVol, sym, minScore, smcCfg, tfId, { K: 1 });
  if(!kf.ok) return kf;
  const f = kf.folds.find(x => !x.skipped) || {};
  return {
    ok:true, split: kf.split, weights: kf.weights, calib: kf.calib, training: kf.training,
    inSample: kf.inSample, baseline: kf.baseline,
    outSample: { n: f.n_oos || 0, pf: f.pf || 0, avgR: f.avgR || 0, winRate: f.winRate || 0 },
    oosBrier: f.brier != null ? f.brier : null,
    reliable: kf.reliable,
    samples: kf.samples.map(s => ({ x: s.x, y: s.y })),
  };
}
