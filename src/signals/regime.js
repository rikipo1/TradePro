/* ---------------- Reżim rynku (ETAP 2) ----------------
   Klasyfikuje stan rynku, żeby NIE mieszać logiki trendowej z mean-reversion.
   Wejście: candles, indeks i, seria ADX, ATR. Zero lookahead (tylko ≤ i).
   Zwraca: { type, adx, effRatio, volPct, volState, trendQuality }.       */

/* efektywność Kaufmana: |net move| / suma |zmian| na oknie n (0..1) */
function efficiencyRatio(candles, i, n) {
  if (i < n) return 0;
  const net = Math.abs(candles[i].c - candles[i - n].c);
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += Math.abs(candles[k].c - candles[k - 1].c);
  return sum > 0 ? net / sum : 0;
}

/* percentyl bieżącego ATR względem ostatnich `look` wartości (proxy reżimu zmienności) */
function atrPercentile(atr, i, look) {
  const cur = atr[i];
  if (cur == null) return 0.5;
  let below = 0, cnt = 0;
  for (let k = Math.max(0, i - look); k <= i; k++) {
    if (atr[k] == null) continue;
    cnt++;
    if (atr[k] <= cur) below++;
  }
  return cnt > 0 ? below / cnt : 0.5;
}

function rawType(candles, j, adxSer, atr) {
  const adx = (adxSer && adxSer[j] != null) ? adxSer[j] : null;
  const eff = efficiencyRatio(candles, j, 14);
  const volPct = atrPercentile(atr, j, 100);
  const volState = volPct >= 0.8 ? 'high' : volPct <= 0.2 ? 'low' : 'normal';
  let type;
  if (adx == null) type = 'unknown';
  else if (adx >= 25 && eff >= 0.35) type = 'trend_strong';
  else if (adx >= 18 && eff >= 0.22) type = 'trend_weak';
  else if (volState === 'high' && eff >= 0.3) type = 'expansion';
  else type = 'range';
  return { type, adx, eff, volPct, volState };
}

export function classifyRegime(candles, i, adxSer, atr) {
  const cur = rawType(candles, i, adxSer, atr);
  /* HISTEREZA: na granicy progu (ADX ~25) surowa klasyfikacja flapowała świeca
     po świecy, a z nią bramki decyzji. Reżim uznajemy za ZMIENIONY dopiero po
     3 kolejnych zgodnych świecach — szukamy wstecz najświeższego 3-biegu tego
     samego typu (do 30 świec) i to on jest stanem. Pojedyncze bliki znikają. */
  let type = cur.type;
  if (i >= 2) {
    const memo = {};
    const raw = (j) => (memo[j] != null ? memo[j] : (memo[j] = rawType(candles, j, adxSer, atr).type));
    for (let j = i; j >= Math.max(2, i - 30); j--) {
      const t = raw(j);
      if (t === raw(j - 1) && t === raw(j - 2)) { type = t; break; }
    }
  }

  const trendQuality = Math.max(0, Math.min(1,
    (cur.adx != null ? Math.min(1, cur.adx / 40) : 0) * 0.6 + cur.eff * 0.4));

  return {
    type,
    adx: cur.adx != null ? +cur.adx.toFixed(1) : null,
    effRatio: +cur.eff.toFixed(2), volPct: +cur.volPct.toFixed(2),
    volState: cur.volState, trendQuality: +trendQuality.toFixed(2),
  };
}

/* czy w danym reżimie preferujemy setupy trendowe czy kontr-trendowe/range */
export function regimeAllows(regime, kind) {
  // kind: 'trend' | 'reversion'
  if (!regime) return true;
  if (kind === 'trend') return regime.type === 'trend_strong' || regime.type === 'trend_weak' || regime.type === 'expansion';
  if (kind === 'reversion') return regime.type === 'range' || regime.type === 'trend_weak';
  return true;
}
