/* [E3-6] Poziomy transakcyjne: SL za realnym swingiem (SMC), TP na strukturze,
   twardy gate RR≥min. Wydzielone z computeSignal BEZ zmiany zachowania
   (golden testy 1:1). */

import { spreadPx, instrProfile } from '../constants/instruments.js';
import { drawOnLiquidity } from './liquidity.js';

/* Zwraca { levels, rrBlockWarn }: levels=null gdy RR-gate odrzucił setup. */
export function computeLevels({ dir, price, atr, smc, nearSup, nearRes, liq, vp, cfg, sym }) {
  const entry = price;
  const prof = instrProfile(sym || null);
  const spr = sym ? spreadPx(sym, price) : atr * 0.05;
  const wick = atr * prof.slWick; // bufor na stop-hunt (per instrument)

  /* --- STOP LOSS: za ostatnim swingiem struktury + bufor + spread --- */
  let slDist;
  if (smc.ms) {
    if (dir === 1) {
      const swing = Math.min(smc.ms.lastSwingLow.p, nearSup ? nearSup.lo : Infinity);
      slDist = (entry - swing) + wick + spr;
    } else {
      const swing = Math.max(smc.ms.lastSwingHigh.p, nearRes ? nearRes.hi : -Infinity);
      slDist = (swing - entry) + wick + spr;
    }
  } else {
    slDist = (dir === 1 && nearSup) ? (price - nearSup.lo + wick + spr)
           : (dir === -1 && nearRes) ? (nearRes.hi - price + wick + spr)
           : atr * 1.1;
  }
  /* tylko dolna klamra (nie ściskamy SL PRZED realny swing — invalidacja
     ma być za strukturą; zbyt daleki swing reguluje sizing, nie ucięty SL) */
  slDist = Math.max(atr * 0.5, slDist);
  const sl = dir === 1 ? entry - slDist : entry + slDist;

  /* --- TAKE PROFIT: najbliższy magnes płynności / strefa / swing przeciwny --- */
  const targets = [];
  const draw = drawOnLiquidity(liq, entry, dir); // PDH/PDL/dzienne high-low = magnes płynności
  if (dir === 1) {
    if (smc.eq.eqHigh && smc.eq.eqHigh > entry) targets.push({ px: smc.eq.eqHigh, why: 'equal highs (płynność)' });
    if (draw && draw.px > entry) targets.push({ px: draw.px, why: draw.label + ' (draw on liquidity)' });
    if (nearRes && nearRes.lo > entry) targets.push({ px: nearRes.lo, why: 'strefa oporu' });
    if (vp && vp.vah > entry) targets.push({ px: vp.vah, why: 'VAH (profil wolumenu)' });
    if (smc.ms && smc.ms.lastSwingHigh.p > entry) targets.push({ px: smc.ms.lastSwingHigh.p, why: 'poprzedni swing high' });
  } else {
    if (smc.eq.eqLow && smc.eq.eqLow < entry) targets.push({ px: smc.eq.eqLow, why: 'equal lows (płynność)' });
    if (draw && draw.px < entry) targets.push({ px: draw.px, why: draw.label + ' (draw on liquidity)' });
    if (nearSup && nearSup.hi < entry) targets.push({ px: nearSup.hi, why: 'strefa wsparcia' });
    if (vp && vp.val < entry) targets.push({ px: vp.val, why: 'VAL (profil wolumenu)' });
    if (smc.ms && smc.ms.lastSwingLow.p < entry) targets.push({ px: smc.ms.lastSwingLow.p, why: 'poprzedni swing low' });
  }
  targets.sort((a, b) => Math.abs(a.px - entry) - Math.abs(b.px - entry));
  const structTP = targets[0] || null;

  const rrTo = px => (Math.abs(px - entry) - spr) / slDist;
  const minRR = prof.minRR || (cfg.minRR != null ? cfg.minRR : 1.5);
  let tp1, tp1why, rr1;
  if (structTP && rrTo(structTP.px) >= minRR) {
    tp1 = structTP.px; tp1why = structTP.why; rr1 = +rrTo(structTP.px).toFixed(2);
  } else {
    tp1 = dir === 1 ? entry + slDist * minRR + spr : entry - slDist * minRR - spr; tp1why = 'RR ' + minRR + 'R'; rr1 = minRR;
  }
  const tp2 = targets[1] ? targets[1].px : (dir === 1 ? entry + slDist * 2.5 + spr : entry - slDist * 2.5 - spr);
  const rr2 = +rrTo(tp2).toFixed(2);

  /* --- TWARDY GATE: struktura blisko blokuje RR<min → sygnał odrzucony --- */
  if (structTP && rrTo(structTP.px) < minRR) {
    const blocks = dir === 1 ? (structTP.px < entry + slDist * minRR) : (structTP.px > entry - slDist * minRR);
    if (blocks) {
      return {
        levels: null,
        rrBlockWarn: 'Najbliższa struktura (' + structTP.why + ') daje RR ' + rrTo(structTP.px).toFixed(2) + ' < ' + minRR + ' — setup odrzucony (brak miejsca do celu)',
      };
    }
  }

  return {
    levels: { entry, sl, tp1, tp2, slDist, rr1, rr2, tp1why, spreadPx: +spr.toFixed(6) },
    rrBlockWarn: null,
  };
}
