/* ---------------- Faza 3: detektor formacji ---------------- */
export function candleStats(c){
  const body = Math.abs(c.c - c.o);
  const range = Math.max(c.h - c.l, 1e-9);
  return {
    body, range,
    bull: c.c >= c.o,
    up: c.h - Math.max(c.c, c.o),
    dn: Math.min(c.c, c.o) - c.l,
    bp: body / range,
  };
}
export function detectCandlePatterns(candles, ema20, atr, hasVol){
  const out = [];
  const n = candles.length;
  if(n < 12) return out;
  const avgBody = []; const avgVol = [];
  {
    let sb = 0, sv = 0; const qb = [], qv = [];
    for(let i=0;i<n;i++){
      const b = Math.abs(candles[i].c - candles[i].o);
      qb.push(b); sb += b; if(qb.length > 14) sb -= qb.shift();
      avgBody.push(sb / qb.length);
      qv.push(candles[i].v); sv += candles[i].v; if(qv.length > 20) sv -= qv.shift();
      avgVol.push(sv / qv.length);
    }
  }
  const trendAt = i => {
    if(i < 6) return 0;
    const a = (atr[i] != null ? atr[i] : null);
    if(ema20 && ema20[i] != null && ema20[i-4] != null && a){
      const d = ema20[i] - ema20[i-4];
      return d > a*0.25 ? 1 : d < -a*0.25 ? -1 : 0;
    }
    const aa = a || (candles[i].h - candles[i].l) * 3 || 1;
    const d = candles[i].c - candles[i-6].c;
    return d > aa*0.6 ? 1 : d < -aa*0.6 ? -1 : 0;
  };
  const push = (i, name, dir, conf, span) => {
    if(conf >= 55) out.push({ i, name, dir, conf: Math.min(95, Math.round(conf)), span: span || 1, kind:'candle' });
  };
  for(let i=2;i<n;i++){
    const c0 = candles[i], c1 = candles[i-1], c2 = candles[i-2];
    const s0 = candleStats(c0), s1 = candleStats(c1), s2 = candleStats(c2);
    const ab = avgBody[i] || 1e-9;
    const tr = trendAt(i-1);
    const tr1 = trendAt(i-2);
    const tr2 = trendAt(i-3 >= 0 ? i-3 : 0);
    const volBoost = (hasVol && avgVol[i] > 0 && c0.v > avgVol[i]*1.5) ? 8 : 0;
    const big0 = s0.body > ab*1.1, small0 = s0.body < ab*0.6;

    /* --- jednoświecowe --- */
    if(s0.bp < 0.1 && s0.range > ab*0.5){
      if(s0.dn > s0.range*0.6 && s0.up < s0.range*0.15) push(i, 'Doji ważki', 1, 60 + (tr < 0 ? 12 : 0) + volBoost);
      else if(s0.up > s0.range*0.6 && s0.dn < s0.range*0.15) push(i, 'Doji nagrobek', -1, 60 + (tr > 0 ? 12 : 0) + volBoost);
      else push(i, 'Doji', 0, 55 + volBoost*0.5);
    }
    if(s0.bp >= 0.1 && s0.bp <= 0.4){
      if(s0.dn >= s0.body*2 && s0.up <= s0.body*0.6){
        if(tr < 0) push(i, 'Młot', 1, 72 + (s0.dn > s0.body*3 ? 6 : 0) + volBoost);
        else if(tr > 0) push(i, 'Wisielec', -1, 66 + volBoost);
      }
      if(s0.up >= s0.body*2 && s0.dn <= s0.body*0.6){
        if(tr > 0) push(i, 'Spadająca gwiazda', -1, 72 + (s0.up > s0.body*3 ? 6 : 0) + volBoost);
        else if(tr < 0) push(i, 'Odwrócony młot', 1, 66 + volBoost);
      }
    }
    if(s0.bp > 0.9 && big0){
      push(i, s0.bull ? 'Marubozu byka' : 'Marubozu niedźwiedzia', s0.bull ? 1 : -1, 60 + 8 + volBoost);
    }
    if(s0.bp >= 0.1 && s0.bp < 0.3 && s0.up > s0.body && s0.dn > s0.body && small0){
      push(i, 'Szpulka', 0, 55);
    }

    /* --- dwuświecowe --- */
    if(s1.body > ab*0.3 && s0.body > s1.body*1.05 &&
       Math.max(c0.c, c0.o) >= Math.max(c1.c, c1.o) && Math.min(c0.c, c0.o) <= Math.min(c1.c, c1.o)){
      if(s0.bull && !s1.bull) push(i, 'Objęcie hossy', 1, 64 + (tr1 < 0 ? 14 : 0) + (s0.body > ab*1.4 ? 6 : 0) + volBoost, 2);
      if(!s0.bull && s1.bull) push(i, 'Objęcie bessy', -1, 64 + (tr1 > 0 ? 14 : 0) + (s0.body > ab*1.4 ? 6 : 0) + volBoost, 2);
    }
    if(s1.body > ab*1.0 && s0.body < s1.body*0.6 &&
       Math.max(c0.c, c0.o) <= Math.max(c1.c, c1.o) && Math.min(c0.c, c0.o) >= Math.min(c1.c, c1.o)){
      const crossD = s0.bp < 0.12;
      if(!s1.bull) push(i, crossD ? 'Krzyż harami byka' : 'Harami byka', 1, (crossD ? 66 : 60) + (tr1 < 0 ? 12 : 0) + volBoost, 2);
      else push(i, crossD ? 'Krzyż harami bessy' : 'Harami bessy', -1, (crossD ? 66 : 60) + (tr1 > 0 ? 12 : 0) + volBoost, 2);
    }
    if(!s1.bull && s0.bull && s1.body > ab*0.8 && c0.o <= c1.c && c0.c > (c1.o + c1.c)/2 && c0.c < c1.o){
      push(i, 'Przenikanie', 1, 62 + (tr1 < 0 ? 12 : 0) + volBoost, 2);
    }
    if(s1.bull && !s0.bull && s1.body > ab*0.8 && c0.o >= c1.c && c0.c < (c1.o + c1.c)/2 && c0.c > c1.o){
      push(i, 'Zasłona ciemnej chmury', -1, 62 + (tr1 > 0 ? 12 : 0) + volBoost, 2);
    }
    const tolT = Math.max((atr[i] || 0)*0.12, c0.c*0.0004);
    if(Math.abs(c0.l - c1.l) < tolT && tr1 < 0 && (s0.bull || s0.bp < 0.15) && !s1.bull){
      push(i, 'Szczypce dołne', 1, 58 + volBoost, 2);
    }
    if(Math.abs(c0.h - c1.h) < tolT && tr1 > 0 && (!s0.bull || s0.bp < 0.15) && s1.bull){
      push(i, 'Szczypce górne', -1, 58 + volBoost, 2);
    }

    /* --- trzyświecowe --- */
    if(s2.body > ab*1.0 && s1.body < ab*0.5){
      if(!s2.bull && s0.bull && c0.c > (c2.o + c2.c)/2){
        push(i, 'Gwiazda poranna', 1, 66 + (tr2 < 0 ? 12 : 0) + (s1.bp < 0.12 ? 6 : 0) + volBoost, 3);
        if(s1.bp < 0.08 && c1.h < c2.c && c1.h < c0.o) push(i, 'Porzucone dziecko hossy', 1, 78 + volBoost, 3);
      }
      if(s2.bull && !s0.bull && c0.c < (c2.o + c2.c)/2){
        push(i, 'Gwiazda wieczorna', -1, 66 + (tr2 > 0 ? 12 : 0) + (s1.bp < 0.12 ? 6 : 0) + volBoost, 3);
        if(s1.bp < 0.08 && c1.l > c2.c && c1.l > c0.o) push(i, 'Porzucone dziecko bessy', -1, 78 + volBoost, 3);
      }
    }
    if(s0.bull && s1.bull && s2.bull && c0.c > c1.c && c1.c > c2.c &&
       s0.body > ab*0.7 && s1.body > ab*0.7 && s2.body > ab*0.7 &&
       s0.up < s0.body*0.5 && s1.up < s1.body*0.5){
      push(i, 'Trzej biali żołnierze', 1, 70 + volBoost, 3);
    }
    if(!s0.bull && !s1.bull && !s2.bull && c0.c < c1.c && c1.c < c2.c &&
       s0.body > ab*0.7 && s1.body > ab*0.7 && s2.body > ab*0.7 &&
       s0.dn < s0.body*0.5 && s1.dn < s1.body*0.5){
      push(i, 'Trzy czarne kruki', -1, 70 + volBoost, 3);
    }
    const inside1 = Math.max(c1.c, c1.o) <= Math.max(c2.c, c2.o) && Math.min(c1.c, c1.o) >= Math.min(c2.c, c2.o);
    const outside1 = Math.max(c1.c, c1.o) >= Math.max(c2.c, c2.o) && Math.min(c1.c, c1.o) <= Math.min(c2.c, c2.o);
    if(!s2.bull && s1.bull && inside1 && s0.bull && c0.c > c2.o){
      push(i, 'Trzy wewnętrzne wzrostowe', 1, 66 + (tr2 < 0 ? 10 : 0) + volBoost, 3);
    }
    if(s2.bull && !s1.bull && inside1 && !s0.bull && c0.c < c2.o){
      push(i, 'Trzy wewnętrzne spadkowe', -1, 66 + (tr2 > 0 ? 10 : 0) + volBoost, 3);
    }
    if(!s2.bull && s1.bull && outside1 && s0.bull && c0.c > c1.c){
      push(i, 'Trzy zewnętrzne wzrostowe', 1, 67 + (tr2 < 0 ? 10 : 0) + volBoost, 3);
    }
    if(s2.bull && !s1.bull && outside1 && !s0.bull && c0.c < c1.c){
      push(i, 'Trzy zewnętrzne spadkowe', -1, 67 + (tr2 > 0 ? 10 : 0) + volBoost, 3);
    }
  }
  return out;
}

/* ZigZag na progu ATR — baza formacji geometrycznych */
export function zigzag(candles, atr){
  const n = candles.length, piv = [];
  if(n < 20) return piv;
  let lastAtr = null;
  for(let i=atr.length-1;i>=0;i--){ if(atr[i] != null){ lastAtr = atr[i]; break; } }
  const devAt = i => Math.max((atr[i] != null ? atr[i] : (lastAtr || (candles[i].h - candles[i].l) || 1)) * 2.2, candles[i].c * 0.0015);
  let dir = 0;
  let hiP = candles[0].h, hiI = 0, loP = candles[0].l, loI = 0;
  for(let i=1;i<n;i++){
    const c = candles[i];
    if(c.h > hiP){ hiP = c.h; hiI = i; }
    if(c.l < loP){ loP = c.l; loI = i; }
    if(dir === 0){
      if(hiP - c.l >= devAt(i)){ piv.push({ i:hiI, p:hiP, t:'H' }); dir = -1; loP = c.l; loI = i; }
      else if(c.h - loP >= devAt(i)){ piv.push({ i:loI, p:loP, t:'L' }); dir = 1; hiP = c.h; hiI = i; }
    } else if(dir === 1){
      if(hiP - c.l >= devAt(i)){ piv.push({ i:hiI, p:hiP, t:'H' }); dir = -1; loP = c.l; loI = i; }
    } else {
      if(c.h - loP >= devAt(i)){ piv.push({ i:loI, p:loP, t:'L' }); dir = 1; hiP = c.h; hiI = i; }
    }
  }
  piv.push(dir === -1 ? { i:loI, p:loP, t:'L', live:true } : { i:hiI, p:hiP, t:'H', live:true });
  return piv;
}
export function fitLine(pts){
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for(let k=0;k<n;k++){ sx += pts[k].x; sy += pts[k].y; sxx += pts[k].x*pts[k].x; sxy += pts[k].x*pts[k].y; }
  const d = n*sxx - sx*sx;
  const m = d ? (n*sxy - sx*sy)/d : 0;
  const b = (sy - m*sx)/n;
  let se = 0, st = 0; const my = sy/n;
  for(let k=0;k<n;k++){
    const e = pts[k].y - (m*pts[k].x + b); se += e*e;
    const t = pts[k].y - my; st += t*t;
  }
  return { m, b, r2: st ? Math.max(0, 1 - se/st) : 1 };
}
export function detectGeoPatterns(candles, piv, atrLast){
  const out = [];
  const n = candles.length;
  if(piv.length < 4 || !atrLast) return out;
  const last = candles[n-1].c;
  const tol = Math.max(atrLast*0.35, last*0.0008);
  const P = piv.slice(-8);
  const at = k => P[P.length + k];
  const add = (name, dir, conf, i0, i1, lines) => out.push({
    name, dir, conf: Math.min(95, Math.round(conf)), i: i1, i0,
    span: i1 - i0 + 1, kind:'geo', lines: lines || [],
  });

  if(P.length >= 4){
    const a = at(-1), b = at(-2), c = at(-3), d = at(-4);
    if(a.t === 'H' && b.t === 'L' && c.t === 'H'){
      if(Math.abs(a.p - c.p) < tol && Math.min(a.p, c.p) - b.p > atrLast*1.0){
        add('Podwójny szczyt', -1,
          62 + (1 - Math.abs(a.p - c.p)/tol)*15 + Math.min(10, (Math.min(a.p, c.p) - b.p)/atrLast*3),
          c.i, a.i, [
            { i0:c.i, p0:c.p, i1:a.i, p1:a.p },
            { i0:c.i, p0:b.p, i1:n-1, p1:b.p },
          ]);
      }
      if(P.length >= 6 && d.t === 'L'){
        const e = at(-5);
        if(e.t === 'H' && Math.abs(a.p - c.p) < tol && Math.abs(c.p - e.p) < tol){
          const lvl = (a.p + c.p + e.p)/3, neck = Math.min(b.p, d.p);
          add('Potrójny szczyt', -1, 72, e.i, a.i, [
            { i0:e.i, p0:lvl, i1:a.i, p1:lvl },
            { i0:e.i, p0:neck, i1:n-1, p1:neck },
          ]);
        }
        if(e.t === 'H' && c.p > e.p + tol*0.5 && c.p > a.p + tol*0.5 && Math.abs(a.p - e.p) < tol*1.6){
          const neckM = (b.p - d.p)/Math.max(1, b.i - d.i);
          add('Głowa i ramiona (RGR)', -1,
            68 + Math.min(12, (c.p - Math.max(a.p, e.p))/atrLast*4),
            e.i, a.i, [{ i0:d.i, p0:d.p, i1:n-1, p1:d.p + neckM*(n-1-d.i) }]);
        }
      }
    }
    if(a.t === 'L' && b.t === 'H' && c.t === 'L'){
      if(Math.abs(a.p - c.p) < tol && b.p - Math.max(a.p, c.p) > atrLast*1.0){
        add('Podwójne dno', 1,
          62 + (1 - Math.abs(a.p - c.p)/tol)*15 + Math.min(10, (b.p - Math.max(a.p, c.p))/atrLast*3),
          c.i, a.i, [
            { i0:c.i, p0:c.p, i1:a.i, p1:a.p },
            { i0:c.i, p0:b.p, i1:n-1, p1:b.p },
          ]);
      }
      if(P.length >= 6 && d.t === 'H'){
        const e = at(-5);
        if(e.t === 'L' && Math.abs(a.p - c.p) < tol && Math.abs(c.p - e.p) < tol){
          const lvl = (a.p + c.p + e.p)/3, neck = Math.max(b.p, d.p);
          add('Potrójne dno', 1, 72, e.i, a.i, [
            { i0:e.i, p0:lvl, i1:a.i, p1:lvl },
            { i0:e.i, p0:neck, i1:n-1, p1:neck },
          ]);
        }
        if(e.t === 'L' && c.p < e.p - tol*0.5 && c.p < a.p - tol*0.5 && Math.abs(a.p - e.p) < tol*1.6){
          const neckM = (b.p - d.p)/Math.max(1, b.i - d.i);
          add('Odwrócony RGR', 1,
            68 + Math.min(12, (Math.min(a.p, e.p) - c.p)/atrLast*4),
            e.i, a.i, [{ i0:d.i, p0:d.p, i1:n-1, p1:d.p + neckM*(n-1-d.i) }]);
        }
      }
    }
  }

  /* linie trendu z ostatnich pivotów → trójkąty / kliny / kanały / prostokąt */
  const Hs = P.filter(x => x.t === 'H').slice(-3);
  const Ls = P.filter(x => x.t === 'L').slice(-3);
  if(Hs.length >= 2 && Ls.length >= 2){
    const lh = fitLine(Hs.map(x => ({ x:x.i, y:x.p })));
    const ll = fitLine(Ls.map(x => ({ x:x.i, y:x.p })));
    const i0 = Math.min(Hs[0].i, Ls[0].i);
    const i1 = n - 1;
    const span = i1 - i0;
    const sH = lh.m / atrLast, sL = ll.m / atrLast;
    const wid0 = (lh.m*i0 + lh.b) - (ll.m*i0 + ll.b);
    const wid1 = (lh.m*i1 + lh.b) - (ll.m*i1 + ll.b);
    const lines = [
      { i0, p0: lh.m*i0 + lh.b, i1, p1: lh.m*i1 + lh.b },
      { i0, p0: ll.m*i0 + ll.b, i1, p1: ll.m*i1 + ll.b },
    ];
    const conv = wid1 < wid0*0.8;
    const F = 0.05;
    const base = 55 + ((lh.r2 + ll.r2)/2)*15 + (Hs.length + Ls.length - 4)*3;
    if(wid0 > atrLast*0.8 && wid1 > -atrLast*0.2 && span >= 10 && span <= 240){
      if(conv){
        if(Math.abs(sH) < F && sL > F) add('Trójkąt rosnący', 1, base + 6, i0, i1, lines);
        else if(Math.abs(sL) < F && sH < -F) add('Trójkąt malejący', -1, base + 6, i0, i1, lines);
        else if(sH < -F*0.6 && sL > F*0.6) add('Trójkąt symetryczny', 0, base + 4, i0, i1, lines);
        else if(sH > F && sL > F && sL > sH) add('Klin zwyżkujący', -1, base + 4, i0, i1, lines);
        else if(sH < -F && sL < -F && sH < sL) add('Klin zniżkujący', 1, base + 4, i0, i1, lines);
      } else {
        if(Math.abs(sH) < F && Math.abs(sL) < F && wid0 > atrLast*1.2) add('Prostokąt (konsolidacja)', 0, base, i0, i1, lines);
        else if(Math.abs(sH - sL) < F && sH > F) add('Kanał wzrostowy', 1, base, i0, i1, lines);
        else if(Math.abs(sH - sL) < F && sH < -F) add('Kanał spadkowy', -1, base, i0, i1, lines);
      }
    }
  }

  /* flaga / chorągiewka: impuls + ciasna konsolidacja */
  {
    const K = Math.min(14, Math.max(6, Math.round(n*0.05)));
    if(n > K + 10){
      const j1 = n - 1, j0 = n - K;
      let hh = -Infinity, ll2 = Infinity;
      for(let j=j0;j<=j1;j++){
        if(candles[j].h > hh) hh = candles[j].h;
        if(candles[j].l < ll2) ll2 = candles[j].l;
      }
      const width = hh - ll2;
      const back = Math.min(8, j0);
      const impulse = candles[j0].c - candles[j0 - back].c;
      if(width < atrLast*1.8 && Math.abs(impulse) > atrLast*3){
        const dirF = impulse > 0 ? 1 : -1;
        const drift = candles[j1].c - candles[j0].c;
        const counter = dirF === 1 ? drift <= atrLast*0.3 : drift >= -atrLast*0.3;
        if(counter){
          const name = width < atrLast*1.1
            ? (dirF === 1 ? 'Chorągiewka wzrostowa' : 'Chorągiewka spadkowa')
            : (dirF === 1 ? 'Flaga wzrostowa' : 'Flaga spadkowa');
          add(name, dirF, 64 + Math.min(12, Math.abs(impulse)/atrLast*2), j0, j1, [
            { i0:j0, p0:hh, i1:j1, p1:hh },
            { i0:j0, p0:ll2, i1:j1, p1:ll2 },
          ]);
        }
      }
    }
  }
  return out;
}
export function detectPatterns(candles, atr, ema20, hasVol){
  const cand = detectCandlePatterns(candles, ema20, atr, hasVol);
  let atrLast = null;
  for(let i=atr.length-1;i>=0;i--){ if(atr[i] != null){ atrLast = atr[i]; break; } }
  const piv = zigzag(candles, atr);
  const geo = detectGeoPatterns(candles, piv, atrLast);
  const list = cand.concat(geo).sort((a, b) => (b.i - a.i) || (b.conf - a.conf));
  const markers = {};
  for(let k=0;k<list.length;k++){
    const p = list[k];
    if(p.conf < 60 || p.kind !== 'candle') continue;
    const cur = markers[p.i];
    if(!cur || p.conf > cur.conf) markers[p.i] = { dir:p.dir, conf:p.conf, name:p.name };
  }
  const geoDraw = geo.filter(g => g.conf >= 58 && g.i >= candles.length - 12).slice(0, 2);
  return { list: list.slice(0, 80), markers, geoDraw };
}

/* ===== FAZA 4b: SMC / STRUKTURA / SESJE / COACH (wpięte) ===== */
/* ============================================================
   SMC / MARKET STRUCTURE / SESSIONS / COACH  — Rikipo Trader
   Wpinane w istniejący silnik. Bazuje na zigzag(candles,atr) → piv[{i,p,t:'H'|'L'}].
   Wszystko liczone WYŁĄCZNIE z danych do świecy `i` (zero lookahead),
   więc live i backtest są spójne.
   ============================================================ */
