/* ---------------- Profil wolumenu (ETAP 4, tam gdzie jest wolumen) ----------------
   POC / VAH / VAL z ostatnich `look` świec. Na instrumentach bez realnego
   wolumenu (np. część indeksów/FX z Yahoo) zwraca null — świadomie, zamiast
   udawać dane. Zero lookahead (dane ≤ i).                                     */

export function volumeProfile(candles, i, look = 120, bins = 24) {
  const from = Math.max(0, i - look + 1);
  let lo = Infinity, hi = -Infinity, totVol = 0;
  for (let k = from; k <= i; k++) {
    if (candles[k].l < lo) lo = candles[k].l;
    if (candles[k].h > hi) hi = candles[k].h;
    totVol += candles[k].v || 0;
  }
  if (!(hi > lo) || totVol <= 0) return null; // brak wolumenu → nie zgadujemy
  const step = (hi - lo) / bins;
  const vol = new Array(bins).fill(0);
  for (let k = from; k <= i; k++) {
    const c = candles[k];
    const mid = (c.h + c.l + c.c) / 3;
    let b = Math.floor((mid - lo) / step);
    if (b < 0) b = 0; if (b >= bins) b = bins - 1;
    vol[b] += c.v || 0;
  }
  let pocBin = 0;
  for (let b = 1; b < bins; b++) if (vol[b] > vol[pocBin]) pocBin = b;
  const poc = lo + (pocBin + 0.5) * step;

  // Value Area = 70% wolumenu wokół POC
  const target = totVol * 0.7;
  let acc = vol[pocBin], loB = pocBin, hiB = pocBin;
  while (acc < target && (loB > 0 || hiB < bins - 1)) {
    const below = loB > 0 ? vol[loB - 1] : -1;
    const above = hiB < bins - 1 ? vol[hiB + 1] : -1;
    if (above >= below) { hiB++; acc += vol[hiB]; }
    else { loB--; acc += vol[loB]; }
  }
  return { poc: +poc, val: +(lo + loB * step), vah: +(lo + (hiB + 1) * step) };
}
