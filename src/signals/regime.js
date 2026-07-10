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

export function classifyRegime(candles, i, adxSer, atr) {
  const adx = (adxSer && adxSer[i] != null) ? adxSer[i] : null;
  const eff = efficiencyRatio(candles, i, 14);
  const volPct = atrPercentile(atr, i, 100);
  const volState = volPct >= 0.8 ? 'high' : volPct <= 0.2 ? 'low' : 'normal';

  let type;
  if (adx == null) type = 'unknown';
  else if (adx >= 25 && eff >= 0.35) type = 'trend_strong';
  else if (adx >= 18 && eff >= 0.22) type = 'trend_weak';
  else if (volState === 'high' && eff >= 0.3) type = 'expansion';
  else type = 'range';

  // jakość trendu 0..1 (do skalowania pewności setupów trendowych)
  const trendQuality = Math.max(0, Math.min(1,
    (adx != null ? Math.min(1, adx / 40) : 0) * 0.6 + eff * 0.4));

  return { type, adx: adx != null ? +adx.toFixed(1) : null, effRatio: +eff.toFixed(2), volPct: +volPct.toFixed(2), volState, trendQuality: +trendQuality.toFixed(2) };
}

/* czy w danym reżimie preferujemy setupy trendowe czy kontr-trendowe/range */
export function regimeAllows(regime, kind) {
  // kind: 'trend' | 'reversion'
  if (!regime) return true;
  if (kind === 'trend') return regime.type === 'trend_strong' || regime.type === 'trend_weak' || regime.type === 'expansion';
  if (kind === 'reversion') return regime.type === 'range' || regime.type === 'trend_weak';
  return true;
}
