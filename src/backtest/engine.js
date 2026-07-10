import { spreadPx } from '../constants/instruments.js';
import { findSRZones } from '../indicators/index.js';
import { detectCandlePatterns } from '../patterns/index.js';
import { computeSignal } from '../signals/engine.js';

/* ---------------- Faza 6: backtest / alerty ---------------- */
export function backtestEngine(candles, ind, emaData, hasVol, sym, minScore, smcCfg){
  const n = candles.length;
  const res = { trades:[], equity:[0], stats:null };
  if(n < 90 || !ind) return res;
  const patsWrap = { list: detectCandlePatterns(candles, emaData[20], ind.atr, hasVol) };
  const warmup = 60, maxBars = 60;
  let open = null, cooldownUntil = -1, sum = 0;
  const close = t => { res.trades.push(t); sum += t.r; res.equity.push(+sum.toFixed(2)); };
  for(let i = warmup; i < n - 1; i++){
    if(open){
      const c = candles[i], dir = open.dir;
      const hitSL  = dir === 1 ? c.l <= open.sl  : c.h >= open.sl;
      const hitTP  = dir === 1 ? c.h >= open.tp1 : c.l <= open.tp1;
      const hitTP2 = dir === 1 ? c.h >= open.tp2 : c.l <= open.tp2;
      /* koszt round-turn w jednostkach R (spread/risk) — realizm CFD */
      const costR = open.risk > 0 ? (open.costPx / open.risk) : 0;
      if(hitSL){
        close({ i0:open.i0, i1:i, dir, r:+(-1 - costR).toFixed(3), out:'SL', tp2:false });
        open = null; cooldownUntil = i + 5;
      } else if(hitTP){
        close({ i0:open.i0, i1:i, dir, r:+(open.rr1 - costR).toFixed(3), out:'TP1', tp2:hitTP2 });
        open = null; cooldownUntil = i + 5;
      } else if(i - open.i0 >= maxBars){
        const raw = ((c.c - open.entry) / open.risk) * dir;
        close({ i0:open.i0, i1:i, dir, r:+(raw - costR).toFixed(3), out:'TIMEOUT', tp2:false });
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
    const sig = computeSignal(candles, ind, emaData, patsWrap, hasVol, i, zonesI);
    if(sig && sig.dir !== 0 && sig.levels){
      open = {
        i0:i, dir:sig.dir,
        entry:sig.levels.entry, sl:sig.levels.sl,
        tp1:sig.levels.tp1, tp2:sig.levels.tp2,
        risk:sig.levels.slDist,
        rr1:sig.levels.rr1 || 1.5,
        costPx: sig.levels.spreadPx || (ind.atr[i] ? ind.atr[i]*0.05 : 0),
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
