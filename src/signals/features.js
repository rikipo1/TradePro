/* ---------------- Ortogonalne czynniki decyzyjne (ETAP 1/3) ----------------
   Zamiast sumować ~20 skorelowanych punktów (trend liczony 6-8×), grupujemy
   dowody w KILKA prawie-niezależnych czynników, każdy ograniczony do [-1, 1]
   i liczony RAZ. To eliminuje "iluzję konfluencji" i pozwala modelowi
   prawdopodobieństwa nadać czynnikom realne, wyuczone wagi.

   Grupy:
     trend         — kierunek+siła trendu (struktura SMC + EMA-stack, JEDEN głos)
     momentum      — RSI/MACD/Stoch (impet, JEDEN głos)
     location      — premium/discount + OB + FVG + S/R + VWAP (gdzie w rynku)
     liquidity     — sweep + equal levels + PDH/PDL (płynność)
     confirmation  — BOS/CHOCH(displacement) + displacement + rel-vol
     htf           — zgodność z wyższym interwałem
   Zwraca też dirConsensus (do wyboru kierunku).                              */

const clamp1 = (x) => Math.max(-1, Math.min(1, x));

export function extractFactors(x) {
  const { price, atr, v20, v50, v200, rsi, macdM, macdS, macdH, macdHp,
    stochK, stochD, stochKp, stochDp, vw, smc, nearSup, nearRes, relVol,
    htfDir, liquidity } = x;
  const a = atr || (price ? price * 0.004 : 1);

  /* --- TREND (jeden głos): struktura SMC ma priorytet, EMA jako wsparcie --- */
  let trend = 0;
  if (smc && smc.ms && smc.ms.trend !== 0) {
    trend = smc.ms.trend * 0.7;
    // zgodność EMA dokłada max 0.3 (nie liczy trendu drugi raz — tylko potwierdza)
    if (v20 != null && v50 != null) {
      const emaDir = price > v20 && v20 > v50 ? 1 : price < v20 && v20 < v50 ? -1 : 0;
      if (emaDir === smc.ms.trend) trend += emaDir * 0.3;
    }
  } else if (v20 != null && v50 != null) {
    trend = (price > v20 && v20 > v50 ? 0.6 : price < v20 && v20 < v50 ? -0.6 : 0);
  }
  trend = clamp1(trend);

  /* --- MOMENTUM (jeden głos): RSI centr. + potwierdzenie MACD + Stoch --- */
  let mom = 0, momN = 0;
  if (rsi != null) { mom += clamp1((rsi - 50) / 20); momN++; }
  if (macdM != null && macdS != null) {
    let mv = macdM > macdS ? 0.5 : -0.5;
    /* histogram liczy się tylko gdy kierunek zmiany ZGADZA się ze znakiem
       (rosnący nad zerem = byczo, spadający pod zerem = niedźwiedzio);
       poprzedni zapis odwracał znak: rosnący histogram pod zerem (gasnąca
       podaż) był karany jako niedźwiedzi. */
    if (macdH != null && macdHp != null) {
      if (macdH > macdHp && macdH > 0) mv += 0.2;
      else if (macdH < macdHp && macdH < 0) mv -= 0.2;
    }
    mom += clamp1(mv); momN++;
  }
  if (stochK != null && stochD != null && stochKp != null && stochDp != null) {
    if (stochKp <= stochDp && stochK > stochD && stochK < 35) { mom += 0.5; momN++; }
    else if (stochKp >= stochDp && stochK < stochD && stochK > 65) { mom -= 0.5; momN++; }
  }
  const momentum = momN ? clamp1(mom / momN) : 0;

  /* --- LOCATION (prawie niezależne dowody, sumowane i ograniczone) --- */
  let loc = 0;
  if (smc && smc.pd) {
    if (smc.pd.zone === 'discount') loc += 0.4;
    else if (smc.pd.zone === 'premium') loc -= 0.4;
  }
  if (smc && smc.ob && (smc.ob.inside || smc.ob.distAtr < 0.4)) loc += smc.ob.dir * 0.35;
  if (smc && smc.fvg && smc.fvg.nearest && smc.fvg.nearDistAtr != null && smc.fvg.nearDistAtr < 0.6) loc += smc.fvg.nearest.dir * 0.25;
  if (nearSup && price - nearSup.hi >= 0 && price - nearSup.hi < a * 0.6) loc += 0.3;
  if (nearRes && nearRes.lo - price >= 0 && nearRes.lo - price < a * 0.6) loc -= 0.3;
  if (vw != null) loc += (price > vw ? 0.15 : -0.15);
  const location = clamp1(loc);

  /* --- LIQUIDITY: sweep (kontra) + magnesy equal/PDH-PDL blisko --- */
  let liq = 0;
  if (smc && smc.sweep) liq += smc.sweep.dir * 0.6;
  if (liquidity && liquidity.magnets) {
    // najbliższy magnes płynności ciągnie cenę w swoją stronę (kierunkowo)
    for (const m of liquidity.magnets) {
      const d = Math.abs(m.px - price) / a;
      if (d < 1.5) liq += (m.px > price ? 0.2 : -0.2) * (1 - d / 1.5) * (m.weight || 1);
    }
  }
  const liquidityF = clamp1(liq);

  /* --- CONFIRMATION: BOS/CHOCH(displacement) + displacement + rel-vol --- */
  let conf = 0;
  if (smc && smc.bc) {
    if (smc.bc.bos !== 0) conf += smc.bc.bos * 0.5;
    if (smc.bc.choch !== 0) conf += smc.bc.choch * 0.4;
  }
  if (smc && smc.disp) conf += smc.disp * 0.3;
  if (relVol && relVol.spike) conf += (relVol.dir || 0) * 0.2;
  const confirmation = clamp1(conf);

  /* --- HTF --- */
  const htf = htfDir ? clamp1(htfDir * 0.8) : 0;

  /* konsensus kierunku: ważona zgoda czynników kierunkowych */
  const dirScore = trend * 1.0 + momentum * 0.6 + location * 0.7 + liquidityF * 0.6 + confirmation * 0.8 + htf * 0.7;
  const dirConsensus = clamp1(dirScore / 4.4);

  return { trend, momentum, location, liquidity: liquidityF, confirmation, htf, dirConsensus };
}

/* wektor cech "zorientowany na wygraną": mnożymy kierunkowe czynniki przez dir,
   żeby model uczył się P(wygrana | bierzemy kierunek dir) — meta-labeling. */
export function orientedVector(factors, dir) {
  return {
    trend: factors.trend * dir,
    momentum: factors.momentum * dir,
    location: factors.location * dir,
    liquidity: factors.liquidity * dir,
    confirmation: factors.confirmation * dir,
    htf: factors.htf * dir,
  };
}

export const FACTOR_KEYS = ['trend', 'momentum', 'location', 'liquidity', 'confirmation', 'htf'];
