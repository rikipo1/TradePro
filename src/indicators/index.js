/* ========================== [3] WSKAŹNIKI ============================ */

/* [M3] Czy instrument ma WIARYGODNY wolumen? Wcześniej wystarczyła JEDNA świeca
   z v>0 (candles.some(c=>c.v>0)) — pojedynczy artefakt włączał całą logikę
   wolumenową (VWAP, OBV, RelVol) na instrumentach bez realnego wolumenu.
   Teraz wymagamy wolumenu na ≥60% świec ORAZ dodatniej wariancji (nie stała). */
export function hasVolume(candles){
  if(!candles || candles.length < 5) return false;
  let nz = 0, sum = 0, cnt = 0;
  for(const c of candles){ const v = c.v || 0; if(v > 0){ nz++; sum += v; cnt++; } }
  if(nz / candles.length < 0.6) return false;
  if(cnt < 2) return false;
  const mean = sum / cnt;
  let varSum = 0;
  for(const c of candles){ const v = c.v || 0; if(v > 0){ const d = v - mean; varSum += d * d; } }
  return (varSum / cnt) > 0; // dodatnia wariancja (wolumen nie jest stały)
}

export function emaSeries(closes, n){
  const out = new Array(closes.length).fill(null);
  if(closes.length < n) return out;
  let sum = 0;
  for(let i=0;i<n;i++) sum += closes[i];
  let prev = sum / n;
  out[n-1] = prev;
  const k = 2/(n+1);
  for(let i=n;i<closes.length;i++){
    prev = closes[i]*k + prev*(1-k);
    out[i] = prev;
  }
  return out;
}
export const EMA_DEFS = [
  { n:9,   color:'#ffc94d' },
  { n:20,  color:'#4fd8ff' },
  { n:50,  color:'#c792ff' },
  { n:200, color:'#ff8a75' },
];

/* ---------------- Faza 2: biblioteka wskaźników ---------------- */
export function smaOver(arr, n){
  const out = new Array(arr.length).fill(null);
  let sum = 0; const q = [];
  for(let i=0;i<arr.length;i++){
    const v = arr[i];
    if(v == null) continue;
    q.push(v); sum += v;
    if(q.length > n) sum -= q.shift();
    if(q.length === n) out[i] = sum / n;
  }
  return out;
}
export function emaOver(arr, n){
  const out = new Array(arr.length).fill(null);
  const k = 2/(n+1);
  let prev = null; const seed = [];
  for(let i=0;i<arr.length;i++){
    const v = arr[i];
    if(v == null) continue;
    if(prev == null){
      seed.push(v);
      if(seed.length === n){
        let s = 0;
        for(let j=0;j<n;j++) s += seed[j];
        prev = s / n;
        out[i] = prev;
      }
      continue;
    }
    prev = v*k + prev*(1-k);
    out[i] = prev;
  }
  return out;
}
export function rsiSeries(closes, n){
  const out = new Array(closes.length).fill(null);
  if(closes.length <= n) return out;
  let ag = 0, al = 0;
  for(let i=1;i<=n;i++){
    const d = closes[i] - closes[i-1];
    if(d >= 0) ag += d; else al -= d;
  }
  ag /= n; al /= n;
  out[n] = al === 0 ? 100 : 100 - 100/(1 + ag/al);
  for(let i=n+1;i<closes.length;i++){
    const d = closes[i] - closes[i-1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag*(n-1) + g)/n;
    al = (al*(n-1) + l)/n;
    out[i] = al === 0 ? 100 : 100 - 100/(1 + ag/al);
  }
  return out;
}
export function trAt(candles, i){
  const c = candles[i], p = candles[i-1];
  return Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
}
export function atrSeries(candles, n){
  const out = new Array(candles.length).fill(null);
  if(candles.length <= n) return out;
  let a = 0;
  for(let i=1;i<=n;i++) a += trAt(candles, i);
  a /= n; out[n] = a;
  for(let i=n+1;i<candles.length;i++){
    a = (a*(n-1) + trAt(candles, i))/n;
    out[i] = a;
  }
  return out;
}
export function macdSeries(closes, f, s, sg){
  const ef = emaSeries(closes, f), es = emaSeries(closes, s);
  const macd = closes.map((x, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
  const signal = emaOver(macd, sg);
  const hist = macd.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null);
  return { macd, signal, hist };
}
export function bollSeries(closes, n, k){
  const mid = smaOver(closes, n);
  const up = new Array(closes.length).fill(null);
  const dn = new Array(closes.length).fill(null);
  for(let i=n-1;i<closes.length;i++){
    if(mid[i] == null) continue;
    let s2 = 0;
    for(let j=i-n+1;j<=i;j++){ const d = closes[j] - mid[i]; s2 += d*d; }
    const sd = Math.sqrt(s2/n);
    up[i] = mid[i] + k*sd;
    dn[i] = mid[i] - k*sd;
  }
  return { mid, up, dn };
}
export function stochSeries(candles, n, ks, ds){
  const raw = new Array(candles.length).fill(null);
  for(let i=n-1;i<candles.length;i++){
    let hh = -Infinity, ll = Infinity;
    for(let j=i-n+1;j<=i;j++){
      if(candles[j].h > hh) hh = candles[j].h;
      if(candles[j].l < ll) ll = candles[j].l;
    }
    raw[i] = hh === ll ? 50 : (candles[i].c - ll)/(hh - ll)*100;
  }
  const k = smaOver(raw, ks);
  const d = smaOver(k, ds);
  return { k, d };
}
export function adxSeries(candles, n){
  const len = candles.length;
  const adx = new Array(len).fill(null), pdi = new Array(len).fill(null), mdi = new Array(len).fill(null);
  if(len <= n*2 + 1) return { adx, pdi, mdi };
  let trS = 0, pS = 0, mS = 0;
  for(let i=1;i<=n;i++){
    const up = candles[i].h - candles[i-1].h;
    const dn = candles[i-1].l - candles[i].l;
    pS += (up > dn && up > 0) ? up : 0;
    mS += (dn > up && dn > 0) ? dn : 0;
    trS += trAt(candles, i);
  }
  const dx = new Array(len).fill(null);
  const put = i => {
    const p = trS > 0 ? 100*pS/trS : 0;
    const m = trS > 0 ? 100*mS/trS : 0;
    pdi[i] = p; mdi[i] = m;
    const s = p + m;
    dx[i] = s > 0 ? 100*Math.abs(p - m)/s : 0;
  };
  put(n);
  for(let i=n+1;i<len;i++){
    const up = candles[i].h - candles[i-1].h;
    const dn = candles[i-1].l - candles[i].l;
    trS = trS - trS/n + trAt(candles, i);
    pS = pS - pS/n + ((up > dn && up > 0) ? up : 0);
    mS = mS - mS/n + ((dn > up && dn > 0) ? dn : 0);
    put(i);
  }
  let a = 0, c = 0, st = -1;
  for(let i=n;i<len;i++){
    if(dx[i] == null) continue;
    a += dx[i]; c++;
    if(c === n){ st = i; adx[i] = a/n; break; }
  }
  if(st !== -1){
    let prev = adx[st];
    for(let i=st+1;i<len;i++){
      prev = (prev*(n-1) + dx[i])/n;
      adx[i] = prev;
    }
  }
  return { adx, pdi, mdi };
}
export function obvSeries(candles){
  const out = new Array(candles.length).fill(null);
  if(!candles.length) return out;
  let o = 0; out[0] = 0;
  for(let i=1;i<candles.length;i++){
    if(candles[i].c > candles[i-1].c) o += candles[i].v;
    else if(candles[i].c < candles[i-1].c) o -= candles[i].v;
    out[i] = o;
  }
  return out;
}
export function dayKeyUTC(t){
  const d = new Date(t*1000);
  return d.getUTCFullYear()*10000 + (d.getUTCMonth()+1)*100 + d.getUTCDate();
}
export function vwapSeries(candles){
  const out = new Array(candles.length).fill(null);
  let pv = 0, vv = 0, day = null;
  for(let i=0;i<candles.length;i++){
    const c = candles[i];
    const dk = dayKeyUTC(c.t);
    if(dk !== day){ day = dk; pv = 0; vv = 0; }
    const tp = (c.h + c.l + c.c)/3;
    pv += tp * c.v; vv += c.v;
    out[i] = vv > 0 ? pv/vv : null;
  }
  return out;
}
/* automatyczne strefy S/R: pivoty fraktalne + klastrowanie wg ATR */
export function findSRZones(candles, atrLast){
  const len = candles.length;
  if(len < 30) return [];
  const w = 4;
  const piv = [];
  for(let i=w;i<len-w;i++){
    let ph = true, pl = true;
    for(let j=1;j<=w;j++){
      if(!(candles[i].h > candles[i-j].h && candles[i].h > candles[i+j].h)) ph = false;
      if(!(candles[i].l < candles[i-j].l && candles[i].l < candles[i+j].l)) pl = false;
      if(!ph && !pl) break;
    }
    if(ph) piv.push({ p: candles[i].h, i });
    if(pl) piv.push({ p: candles[i].l, i });
  }
  if(!piv.length) return [];
  const last = candles[len-1].c;
  const tol = Math.max((atrLast || last*0.004) * 0.35, last*0.0006);
  piv.sort((a, b) => a.p - b.p);
  const zones = [];
  let cur = [piv[0]];
  const flush = () => {
    if(!cur.length) return;
    let lo = Infinity, hi = -Infinity, rec = 0;
    for(let j=0;j<cur.length;j++){
      if(cur[j].p < lo) lo = cur[j].p;
      if(cur[j].p > hi) hi = cur[j].p;
      if(cur[j].i > rec) rec = cur[j].i;
    }
    if(hi - lo < tol*0.5){ const mid = (hi+lo)/2; lo = mid - tol*0.25; hi = mid + tol*0.25; }
    zones.push({ lo, hi, touches: cur.length, score: cur.length + rec/len });
  };
  for(let i=1;i<piv.length;i++){
    if(piv[i].p - cur[cur.length-1].p <= tol) cur.push(piv[i]);
    else { flush(); cur = [piv[i]]; }
  }
  flush();
  zones.sort((a, b) => b.score - a.score);
  return zones.slice(0, 6);
}
