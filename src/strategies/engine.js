/* ============ INSTYTUCJONALNY SILNIK RANKINGU STRATEGII ============
   Ocena WSZYSTKICH strategii naraz na bieżącej sytuacji: każda dostaje
   0–100%, silnik wybiera najlepszy scenariusz albo mówi „BRAK TRANSAKCJI"
   (brak pozycji to poprawna decyzja). Do tego Explain AI i uczenie z
   dziennika (learning.js, z shrinkage przeciw przeuczeniu).

   WAŻNE ROZGRANICZENIE (parytet validate↔serve z audytu):
   ten moduł jest DORADCZY. Auto-trade nadal decyduje zwalidowany
   computeSignal — ranking podpowiada scenariusze i pozwala otworzyć
   paper RĘCZNIE (wpis dostaje pole strategy → zasila uczenie).

   Score = base (jakość setupu z detektora)
         × dopasowanie do reżimu × zgodność MTF × jakość sesji
         + korekta z uczenia (max ±15 pkt przy dużej próbie).
   Probability = odwzorowanie score na przybliżone P — NIEKALIBROWANE,
   chyba że strategia ma ≥30 własnych transakcji (wtedy empiryczne). */

import { classifyRegime } from '../signals/regime.js';
import { liquidityModel } from '../signals/liquidity.js';
import { volumeProfile } from '../signals/volumeProfile.js';
import { smcAnalyze, relativeVolume } from '../smc/index.js';
import { zigzag, detectGeoPatterns } from '../patterns/index.js';
import { sessionInfo, macroWindow } from '../utils/sessions.js';
import { instrProfile, spreadPx } from '../constants/instruments.js';
import { mtfConsensus } from './mtf.js';
import { ALL_DETECTORS } from './detectors.js';
import { strategyStatsFromJournal, learnAdjust, learnNote, MIN_N } from './learning.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* dopasowanie grupy strategii do reżimu rynku (mnożnik 0.7–1.15) */
const REGIME_FIT = {
  trend_strong: { trend: 1.15, momentum: 1.1, breakout: 1.05, reversion: 0.7, reversal: 0.8, smc: 1.0, vwap: 1.05, volatility: 0.95, session: 1.0, levels: 0.9, liquidity: 0.9 },
  trend_weak:   { trend: 1.05, momentum: 1.0, breakout: 1.0, reversion: 0.85, reversal: 0.9, smc: 1.0, vwap: 1.0, volatility: 1.0, session: 1.0, levels: 0.95, liquidity: 0.95 },
  range:        { trend: 0.7, momentum: 0.8, breakout: 0.85, reversion: 1.15, reversal: 1.1, smc: 1.0, vwap: 0.9, volatility: 1.05, session: 0.95, levels: 1.05, liquidity: 1.1 },
  expansion:    { trend: 1.05, momentum: 1.15, breakout: 1.1, reversion: 0.7, reversal: 0.85, smc: 0.95, vwap: 1.0, volatility: 1.1, session: 1.05, levels: 0.85, liquidity: 0.95 },
  unknown:      {},
};

export function buildStrategyCtx(candles, ind, emaData, hasVol, sym, tfSec, atIdx) {
  const n = candles.length;
  const i = atIdx != null ? atIdx : n - 2;
  if (!ind || i < 40 || !candles[i]) return null;
  const c = candles[i];
  const price = atIdx == null && candles[n - 1] ? candles[n - 1].c : c.c;
  let atr = ind.atr[i];
  if (atr == null) { for (let q = i; q >= 0; q--) { if (ind.atr[q] != null) { atr = ind.atr[q]; break; } } }
  if (!atr) return null;
  const piv = zigzag(candles.slice(0, i + 1), ind.atr.slice(0, i + 1));
  const smc = smcAnalyze(candles, piv, i, atr, {
    premium: 62, discount: 38, dispImpulse: 1.2, dispBody: 0.6, fvgDist: 0.5, strong: 55, rangeBonus: 15, minRR: 1.5,
  });
  const regime = classifyRegime(candles, i, ind.adx.adx, ind.atr);
  const liq = liquidityModel(candles, i, atr);
  const vp = hasVol ? volumeProfile(candles, i) : null;
  const relVol = hasVol ? relativeVolume(candles, i) : null;
  const dt = atIdx == null ? new Date() : new Date(c.t * 1000);
  const sess = sessionInfo(dt);
  const macro = macroWindow(dt);
  /* poprzedni dzień (do pivotów): świece z doby UTC poprzedzającej bieżącą */
  let prevDay = null;
  {
    const day = Math.floor(c.t / 86400);
    let h = -Infinity, l = Infinity, close = null;
    for (let q = i; q >= 0; q--) {
      const d = Math.floor(candles[q].t / 86400);
      if (d === day) continue;
      if (d < day - 1) break;
      if (candles[q].h > h) h = candles[q].h;
      if (candles[q].l < l) l = candles[q].l;
      if (close == null) close = candles[q].c;
    }
    if (close != null && isFinite(h)) prevDay = { h, l, c: close };
  }
  /* figury geometryczne (RGR, podwójne dno/szczyt, trójkąty, kliny, flagi…)
     — wykrywane z pivotów; zero lookahead (świece do i) */
  let geo = [];
  try { geo = detectGeoPatterns(candles.slice(0, i + 1), piv, atr) || []; } catch (e) { geo = []; }
  return { candles, i, price, atr, ind, emaData, smc, liq, vp, regime, sess, macro, relVol, hasVol, piv, prevDay, geo, sym, tfSec };
}

/* poziomy dla wybranej strategii: SL za strukturą/ekstremum, TP1–TP4 */
function strategyLevels(ctx, dir) {
  const { price, atr, smc, sym } = ctx;
  const prof = instrProfile(sym || null);
  const spr = sym ? spreadPx(sym, price) : atr * 0.05;
  const wick = atr * prof.slWick;
  let slDist;
  if (smc.ms) {
    const swing = dir === 1 ? smc.ms.lastSwingLow.p : smc.ms.lastSwingHigh.p;
    slDist = Math.abs(price - swing) + wick + spr;
  } else {
    slDist = atr * 1.1;
  }
  slDist = Math.max(atr * 0.5, Math.min(slDist, atr * 3)); // klamry zdrowego rozsądku
  const sl = dir === 1 ? price - slDist : price + slDist;
  const tp = (mult) => dir === 1 ? price + slDist * mult + spr : price - slDist * mult - spr;
  return {
    entry: price, sl, slDist,
    tp1: tp(1.5), tp2: tp(2.5), tp3: tp(3.5), tp4: tp(5),
    rr1: 1.5,
    trailing: 'strukturalny: 8-świecowy ' + (dir === 1 ? 'dołek' : 'szczyt') + ' ± 0.25×ATR (jak backtest)',
    spreadPx: +spr.toFixed(6),
  };
}

/* score → przybliżone P(win) (squash); z historią ≥30 tr — empiryczne */
function probEstimate(score, stats, stratId) {
  const s = stats && stats[stratId];
  if (s && s.n >= 30) return { p: s.winRate, src: 'empiryczne (' + s.n + ' tr)' };
  return { p: +(0.35 + 0.30 * (clamp(score, 0, 100) / 100)).toFixed(2), src: 'heurystyka (niekalibrowane)' };
}

export function rankStrategies(ctx, journal, opts = {}) {
  if (!ctx) return null;
  const minScore = opts.minScore != null ? opts.minScore : 60;
  const stats = strategyStatsFromJournal(journal);
  const mtf = mtfConsensus(ctx.candles, ctx.tfSec || 300);
  const fit = REGIME_FIT[ctx.regime.type] || {};

  const ranking = [];
  for (const det of ALL_DETECTORS) {
    let r = null;
    try { r = det(ctx); } catch (e) { r = null; }
    if (!r || r.dir === 0) continue;
    const regimeMult = fit[r.group] != null ? fit[r.group] : 1;
    /* zgodność MTF: pełna zgoda +12%, pełna kontra −18% */
    const mtfMult = 1 + (mtf.align * r.dir >= 0 ? 0.12 * Math.abs(mtf.align) : -0.18 * Math.abs(mtf.align));
    const sessMult = ctx.sess.weekend ? 0.5 : ctx.sess.quality === 2 ? 1.08 : ctx.sess.quality === 1 ? 1.03 : 0.9;
    const adj = learnAdjust(stats, r.id);
    const score = Math.round(clamp(r.base * regimeMult * mtfMult * sessMult + adj, 0, 97));
    /* każda wykryta strategia dostaje własne poziomy (Entry/SL/TP1–TP4) —
       widoczne w rankingu nawet, gdy werdykt to BRAK TRANSAKCJI
       (wtedy to scenariusz WARUNKOWY, nie sygnał) */
    const lv = strategyLevels(ctx, r.dir);
    const pe = probEstimate(score, stats, r.id);
    ranking.push({
      ...r, scoreRaw: score, score, adj,
      levels: lv, probability: pe.p, probabilitySrc: pe.src,
      mults: { regime: +regimeMult.toFixed(2), mtf: +mtfMult.toFixed(2), sess: +sessMult.toFixed(2) },
      learn: learnNote(stats, r.id),
    });
  }

  /* KONFLUENCJA / SPRZECZNOŚĆ: strategia zgodna z konsensusem wielu innych
     dostaje bonus, sprzeczna z silnym konsensusem — karę (±). To nagradza
     sytuacje, gdzie kilka niezależnych metod wskazuje ten sam kierunek. */
  const sumBull = ranking.filter(r => r.dir > 0).reduce((a, r) => a + r.scoreRaw, 0);
  const sumBear = ranking.filter(r => r.dir < 0).reduce((a, r) => a + r.scoreRaw, 0);
  for (const r of ranking) {
    const agree = (r.dir > 0 ? sumBull : sumBear) - r.scoreRaw; // inne zgodne
    const oppose = r.dir > 0 ? sumBear : sumBull;               // przeciwne
    const denom = agree + oppose;
    const net = denom > 0 ? (agree - oppose) / denom : 0;
    r.confluence = Math.round(clamp(net * 12, -10, 12));
    r.score = Math.round(clamp(r.scoreRaw + r.confluence, 0, 99));
  }
  ranking.sort((a, b) => b.score - a.score);

  /* sub-scores 0–100 dla panelu */
  const f = ctx;
  const scores = {
    marketStructure: Math.round(50 + (f.smc.ms ? f.smc.ms.trend * 30 : 0) + (f.smc.bc.bos !== 0 ? 10 : 0)),
    trend: Math.round(clamp(f.regime.trendQuality * 100, 0, 100)),
    momentum: Math.round(50 + (f.smc.disp || 0) * 25 + ((f.ind.rsi[f.i] || 50) - 50)),
    liquidity: Math.round(50 + (f.smc.sweep ? f.smc.sweep.dir * 20 : 0) + (f.liq && f.liq.magnets ? Math.min(20, f.liq.magnets.length * 5) : 0)),
    volatility: Math.round(f.regime.volPct * 100),
  };
  for (const k in scores) scores[k] = clamp(scores[k], 0, 100);
  /* risk: wyżej = groźniej (zmienność wysoka, sesja słaba, okno makro) */
  const risk = clamp(Math.round(
    (f.regime.volState === 'high' ? 35 : f.regime.volState === 'low' ? 10 : 20)
    + (f.sess.quality < 0 ? 25 : f.sess.quality === 2 ? 5 : 10)
    + (f.macro ? 25 : 0) + (f.sess.weekend ? 30 : 0)), 0, 100);

  const best = ranking[0] || null;
  const decision = best && best.score >= minScore ? best : null;

  let out;
  if (!decision) {
    out = {
      verdict: 'BRAK TRANSAKCJI', dir: 0, best: null,
      explain: {
        why: best
          ? ['najlepsza strategia (' + best.name + ') ma ' + best.score + '% < próg ' + minScore + '% — brak wyraźnej przewagi statystycznej'
            , 'brak pozycji jest poprawną decyzją; nie wymuszamy wejścia']
          : ['żaden detektor nie znalazł aktywnego setupu na tej świecy'],
        rejected: ranking.slice(0, 5).map(r => r.name + ' — ' + r.score + '%'),
        watch: best ? best.conditions : ['czekaj na wybicie struktury, sweep płynności albo dojście do strefy'],
      },
    };
  } else {
    const lv = decision.levels;
    const pe = { p: decision.probability, src: decision.probabilitySrc };
    const rivals = ranking.slice(1, 5);
    out = {
      verdict: decision.dir > 0 ? 'LONG' : 'SHORT', dir: decision.dir, best: decision,
      levels: lv,
      expectedRR: lv.rr1,
      probability: pe.p, probabilitySrc: pe.src,
      confidence: decision.score,
      explain: {
        why: [
          'wybrano: ' + decision.name + ' (' + decision.score + '%) — ' + decision.why.join('; '),
          'mnożniki: reżim ' + ctx.regime.type + ' ×' + decision.mults.regime
            + ' · MTF ' + (mtf.align >= 0 ? '+' : '') + mtf.align + ' ×' + decision.mults.mtf
            + ' · sesja ×' + decision.mults.sess
            + (decision.confluence ? ' · konfluencja ' + (decision.confluence > 0 ? '+' : '') + decision.confluence + ' pkt' : ''),
          'uczenie: ' + decision.learn,
        ],
        rejected: rivals.map(r => r.name + ' — ' + r.score + '%'
          + (r.dir !== decision.dir ? ' (przeciwny kierunek)' : '')),
        invalidates: decision.invalidates,
        conditions: decision.conditions,
        improves: ['zgodność kolejnej ramki MTF', 'wolumen potwierdzający', 'reakcja ceny na poziomie wejścia'],
      },
    };
  }
  out.ranking = ranking;
  out.mtf = mtf;
  out.scores = { ...scores, risk, confidence: best ? best.score : 0 };
  out.regime = ctx.regime.type;
  out.session = ctx.sess.label;
  out.macro = ctx.macro || null;
  out.disclaimer = 'Moduł doradczy: score to heurystyka (kalibrowane tylko przy ≥30 własnych transakcjach strategii). '
    + 'Auto-trade pozostaje na zwalidowanym silniku k-fold. Order Flow/DOM/Footprint wymagają danych tick/L2 — feed ich nie dostarcza.';
  return out;
}
