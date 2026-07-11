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

/* WALK-FORWARD: trenuj wagi na pierwszych 60% danych, testuj OUT-OF-SAMPLE na
   ostatnich 40% z wyuczonymi wagami.
   K1 (EMBARGO): transakcja otwarta tuż przed splitem rozstrzyga się PO splicie
   — jej etykieta niesie informację z okresu testowego. Do treningu bierzemy
   więc wyłącznie próbki ZAMKNIĘTE przed splitem (i1 < split). Zero przecieku.
   K4: na predykcjach treningowych fitujemy kalibrację isotonic (gdy ≥150
   próbek), a na OOS liczymy Brier — jedyną uczciwą miarę jakości P.        */
export function walkForward(candles, ind, emaData, hasVol, sym, minScore, smcCfg, tfId){
  const n = candles.length;
  if(n < 250) return { ok:false, reason:'za mało danych (min 250 świec)' };
  const split = Math.floor(n * 0.6);
  const base = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { tfId });
  const trainSamples = base.samples.filter(s => (s.i1 != null ? s.i1 : s.i0) < split); // embargo
  const tr = trainLogistic(trainSamples, { epochs: 500 });
  if(!tr.trained) return { ok:false, reason: tr.reason, weights: tr.weights };

  /* kalibracja: przelicz backtest z wyuczonymi wagami, weź predykcje z części
     treningowej (zamknięte przed splitem) i dopasuj isotonic */
  const withW = backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { weights: tr.weights, tfId });
  const calPairs = withW.trades
    .filter(t => t.i1 < split && (t.out === 'TP1' || t.out === 'SL') && t.prob != null)
    .map(t => ({ p: t.prob, y: t.out === 'TP1' ? 1 : 0 }));
  const calib = fitIsotonic(calPairs, 150); // null gdy < 150 — nie kalibrujemy szumem

  /* finalny przebieg: wagi + kalibracja (jeśli jest) — OOS liczony z tego */
  const finalRun = calib
    ? backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg, { weights: tr.weights, calib, tfId })
    : withW;
  const oosTrades = finalRun.trades.filter(t => t.i0 >= split);
  const isTrades  = finalRun.trades.filter(t => t.i1 < split);
  const oosPairs = oosTrades
    .filter(t => (t.out === 'TP1' || t.out === 'SL') && t.prob != null)
    .map(t => ({ p: t.prob, y: t.out === 'TP1' ? 1 : 0 }));

  return {
    ok:true, split, weights: tr.weights, calib, training: tr,
    inSample: statsOf(isTrades), outSample: statsOf(oosTrades), baseline: base.stats,
    oosBrier: brierScore(oosPairs),      // < 0.25 = lepiej niż moneta
    reliable: tr.reliable && oosTrades.length >= 30,
    samples: trainSamples.map(s => ({ x: s.x, y: s.y })), // historia dla kNN (część treningowa, z embargo)
  };
}
