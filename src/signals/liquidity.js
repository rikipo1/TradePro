/* ---------------- Model płynności (ETAP 2) ----------------
   Realne pule płynności, które rynek "goni": PDH/PDL (poprzedni dzień),
   dzisiejsze high/low sesji oraz equal highs/lows. Zwraca listę magnesów
   (poziomów) z wagą — używane jako cele TP (draw-on-liquidity) i jako
   składnik czynnika "liquidity". Zero lookahead (dane ≤ i).                 */

function dayKey(t) {
  const d = new Date(t * 1000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function liquidityModel(candles, i, atr) {
  const out = { pdh: null, pdl: null, todayHigh: null, todayLow: null, magnets: [] };
  if (i < 5) return out;
  const today = dayKey(candles[i].t);
  let prevDay = null;
  // znajdź poprzedni dzień
  for (let k = i; k >= 0; k--) {
    const dk = dayKey(candles[k].t);
    if (dk !== today) { prevDay = dk; break; }
  }
  let th = -Infinity, tl = Infinity, ph = -Infinity, pl = Infinity, hasP = false;
  for (let k = 0; k <= i; k++) {
    const dk = dayKey(candles[k].t);
    if (dk === today) { if (candles[k].h > th) th = candles[k].h; if (candles[k].l < tl) tl = candles[k].l; }
    else if (dk === prevDay) { hasP = true; if (candles[k].h > ph) ph = candles[k].h; if (candles[k].l < pl) pl = candles[k].l; }
  }
  const price = candles[i].c;
  if (th > -Infinity) out.todayHigh = th;
  if (tl < Infinity) out.todayLow = tl;
  if (hasP) { out.pdh = ph; out.pdl = pl; }

  const push = (px, label, weight) => { if (px != null && isFinite(px) && Math.abs(px - price) > (atr || price * 0.004) * 0.1) out.magnets.push({ px, label, weight }); };
  push(out.pdh, 'PDH', 1.2);
  push(out.pdl, 'PDL', 1.2);
  push(out.todayHigh, 'dzienne high', 0.9);
  push(out.todayLow, 'dzienne low', 0.9);
  return out;
}

/* najbliższy magnes płynności powyżej / poniżej ceny (cel TP zgodny z kierunkiem) */
export function drawOnLiquidity(liq, price, dir) {
  if (!liq || !liq.magnets.length) return null;
  const cands = liq.magnets.filter(m => dir === 1 ? m.px > price : m.px < price);
  if (!cands.length) return null;
  cands.sort((a, b) => Math.abs(a.px - price) - Math.abs(b.px - price));
  return cands[0];
}
