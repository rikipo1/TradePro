import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EMA_DEFS } from '../indicators/index.js';
import { CLR, COUNT0, clampEnd, fmtFull, fmtPct, fmtPrice, fmtTime, fmtVol, niceStep } from '../utils/format.js';

export function ChartCanvas({ candles, emaData, emaVis, tfId, resetKey, hasVol, overlays, panels, markers, geoLines, patMap, focus, levels }){
  const wrapRef = useRef(null);
  const cvsRef  = useRef(null);
  const layoutRef = useRef(null);
  const pinnedRef = useRef(true);
  const gRef = useRef({ pts:new Map(), mode:null, sx:0, sEnd:0, sCount:0, sDist:0, sCenter:0, moved:false, t0:0 });
  const rafRef = useRef({ id:0, next:null });
  const scheduleView = useCallback((updater) => {
    rafRef.current.next = updater;
    if(rafRef.current.id) return;
    rafRef.current.id = requestAnimationFrame(() => {
      rafRef.current.id = 0;
      const fn = rafRef.current.next;
      rafRef.current.next = null;
      if(fn) setView(fn);
    });
  }, []);
  useEffect(() => () => { if(rafRef.current.id) cancelAnimationFrame(rafRef.current.id); }, []);
  const [size, setSize] = useState({ w:0, h:0 });
  /* view: count/end = okno CZASU; yLo/yHi = ręczne okno CENY (null = auto-fit).
     Ręczne okno pozwala przesuwać wykres w GÓRĘ/DÓŁ (pan pionowy). */
  const [view, setView] = useState({ count:COUNT0, end:COUNT0-1, yLo:null, yHi:null });
  const [cross, setCross] = useState(null);
  const len = candles.length;
  const ovl = overlays || {};
  const pnl = panels || [];

  /* --- reset przy zmianie symbolu / TF --- */
  useEffect(() => {
    pinnedRef.current = true;
    setCross(null);
    setView({ count:COUNT0, end:COUNT0-1, yLo:null, yHi:null });
  }, [resetKey]);

  /* --- fokus z listy formacji: ustaw krzyżyk i dosuń widok --- */
  useEffect(() => {
    if(!focus || !len) return;
    const idx = Math.min(len-1, Math.max(0, focus.idx));
    setCross(idx);
    pinnedRef.current = false;
    setView(v => {
      const ne = clampEnd(idx + Math.floor(v.count*0.3), v.count, len);
      return { ...v, end: ne };
    });
  }, [focus]);

  /* --- po dojściu nowych świec trzymaj prawą krawędź --- */
  useEffect(() => {
    if(pinnedRef.current && len){
      setView(v => ({ ...v, end: len - 1 + v.count * 0.08 }));
    }
    setCross(c => (c != null && c >= len) ? null : c);
  }, [candles]);

  /* --- rozmiar kontenera --- */
  useEffect(() => {
    const el = wrapRef.current;
    if(!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(es => {
      const r = es[0].contentRect;
      setSize({ w:Math.round(r.width), h:Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const idxFromX = useCallback((clientX) => {
    const L = layoutRef.current, cvs = cvsRef.current;
    if(!L || !cvs || !len) return null;
    const rect = cvs.getBoundingClientRect();
    const x = clientX - rect.left;
    let i = Math.round(L.start + (x - L.plotL) / L.cw - 0.5);
    if(i < 0) i = 0;
    if(i > len-1) i = len-1;
    return i;
  }, [len]);

  /* ------------------------- GESTY ------------------------- */
  const onPointerDown = (e) => {
    const g = gRef.current;
    try{ cvsRef.current.setPointerCapture(e.pointerId); }catch(err){}
    g.pts.set(e.pointerId, { x:e.clientX, y:e.clientY });
    if(g.pts.size === 1){
      g.mode = 'pan'; g.sx = e.clientX; g.sEnd = view.end;
      g.sy = e.clientY; g.moved = false; g.t0 = Date.now();
      /* start okna CENY do pan pionowego (z ostatniego rysowania) */
      const L = layoutRef.current;
      g.yEngaged = (view.yLo != null && view.yHi != null);
      if(L){
        g.syLo = view.yLo != null ? view.yLo : L.lo;
        g.syHi = view.yHi != null ? view.yHi : L.hi;
        g.syRange = (g.syHi - g.syLo) || L.range || 1;
        g.syPriceH = L.priceH || 1;
      }
    } else if(g.pts.size === 2){
      const p = Array.from(g.pts.values());
      g.mode = 'pinch';
      g.sDist = Math.max(8, Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y));
      g.sCount = view.count;
      g.sCenter = view.end - view.count/2;
    }
  };
  const onPointerMove = (e) => {
    const g = gRef.current;
    if(!g.pts.has(e.pointerId)){
      if(e.pointerType === 'mouse' && len) setCross(idxFromX(e.clientX));
      return;
    }
    g.pts.set(e.pointerId, { x:e.clientX, y:e.clientY });
    const L = layoutRef.current;
    if(!L || !len) return;
    if(g.mode === 'pan' && g.pts.size === 1){
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if(Math.abs(dx) > 5 || Math.abs(dy) > 5) g.moved = true;
      const newEnd = clampEnd(g.sEnd - dx / L.cw, view.count, len);
      pinnedRef.current = newEnd >= len - 1.5;
      /* pan PIONOWY (cena): włącza się po przekroczeniu progu, żeby czysty
         ruch poziomy nie zamrażał auto-dopasowania osi */
      let yPatch = null;
      if(!g.yEngaged && Math.abs(dy) > 8){
        g.yEngaged = true; g.sy = e.clientY;
        g.syLo = view.yLo != null ? view.yLo : L.lo;
        g.syHi = view.yHi != null ? view.yHi : L.hi;
        g.syRange = (g.syHi - g.syLo) || L.range || 1;
        g.syPriceH = L.priceH || 1;
      }
      if(g.yEngaged){
        const dp = (e.clientY - g.sy) / g.syPriceH * g.syRange; // przesuń okno ceny
        yPatch = { yLo: g.syLo + dp, yHi: g.syHi + dp };
      }
      scheduleView(v => ({ ...v, end:newEnd, ...(yPatch || {}) }));
    } else if(g.mode === 'pinch' && g.pts.size >= 2){
      const p = Array.from(g.pts.values());
      const d = Math.max(8, Math.hypot(p[0].x-p[1].x, p[0].y-p[1].y));
      let nc = Math.round(g.sCount * (g.sDist / d));
      nc = Math.max(15, Math.min(400, nc));
      const ne = clampEnd(g.sCenter + nc/2, nc, len);
      pinnedRef.current = ne >= len - 1.5;
      scheduleView(v => ({ ...v, count:nc, end:ne }));
    }
  };
  const onPointerUp = (e) => {
    const g = gRef.current;
    const was = g.pts.has(e.pointerId);
    g.pts.delete(e.pointerId);
    if(was && g.mode === 'pan' && !g.moved && (Date.now()-g.t0) < 350 && e.pointerType !== 'mouse' && len){
      const i = idxFromX(e.clientX);
      setCross(c => (c === i ? null : i));
    }
    if(g.pts.size === 1 && g.mode === 'pinch'){
      const rest = Array.from(g.pts.values())[0];
      g.mode = 'pan'; g.sx = rest.x; g.sEnd = view.end; g.moved = true; g.t0 = 0;
      /* wznów bazę pan pionowego od bieżącego palca (bez skoku) */
      g.sy = rest.y;
      const L = layoutRef.current;
      if(L){
        g.syLo = view.yLo != null ? view.yLo : L.lo;
        g.syHi = view.yHi != null ? view.yHi : L.hi;
        g.syRange = (g.syHi - g.syLo) || L.range || 1;
        g.syPriceH = L.priceH || 1;
      }
    } else if(g.pts.size === 0){
      g.mode = null;
    }
  };
  const onPointerLeave = (e) => {
    if(e.pointerType === 'mouse' && !gRef.current.pts.size) setCross(null);
  };

  /* --- kółko myszy (podgląd desktop) + dwuklik --- */
  useEffect(() => {
    const cvs = cvsRef.current;
    if(!cvs) return;
    const onWheel = (e) => {
      e.preventDefault();
      const L = layoutRef.current;
      if(!L || !len) return;
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const idxAt = L.start + (x - L.plotL) / L.cw - 0.5;
      setView(v => {
        let nc = Math.round(v.count * (e.deltaY > 0 ? 1.18 : 0.85));
        nc = Math.max(15, Math.min(400, nc));
        const cw2 = L.plotW / nc;
        const ne = clampEnd(idxAt + 0.5 - (x - L.plotL)/cw2 + nc - 1, nc, len);
        pinnedRef.current = ne >= len - 1.5;
        return { ...v, count:nc, end:ne };
      });
    };
    const onDbl = () => {
      pinnedRef.current = true;
      setView({ count:COUNT0, end: len ? len-1+COUNT0*0.08 : COUNT0-1, yLo:null, yHi:null });
    };
    cvs.addEventListener('wheel', onWheel, { passive:false });
    cvs.addEventListener('dblclick', onDbl);
    return () => { cvs.removeEventListener('wheel', onWheel); cvs.removeEventListener('dblclick', onDbl); };
  }, [len]);

  /* ------------------------- RYSOWANIE ------------------------- */
  useEffect(() => {
    const cvs = cvsRef.current;
    if(!cvs || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = size.w * dpr; cvs.height = size.h * dpr;
    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CLR.bg;
    ctx.fillRect(0, 0, size.w, size.h);
    if(!len) return;

    const count = view.count;
    const end = clampEnd(view.end, count, len);
    const start = end - count + 1;
    const iFrom = Math.max(0, Math.floor(start));
    const iTo   = Math.min(len-1, Math.ceil(end));
    if(iTo < iFrom) return;

    /* zakres cen z widocznych świec + widocznych nakładek */
    let lo = Infinity, hi = -Infinity;
    const scan = arr => {
      if(!arr) return;
      for(let i=iFrom;i<=iTo;i++){
        const v = arr[i];
        if(v == null) continue;
        if(v < lo) lo = v;
        if(v > hi) hi = v;
      }
    };
    for(let i=iFrom;i<=iTo;i++){
      const c = candles[i];
      if(c.l < lo) lo = c.l;
      if(c.h > hi) hi = c.h;
    }
    for(let d=0;d<EMA_DEFS.length;d++){
      if(emaVis[EMA_DEFS[d].n]) scan(emaData[EMA_DEFS[d].n]);
    }
    if(ovl.boll){ scan(ovl.boll.up); scan(ovl.boll.dn); }
    if(ovl.vwap) scan(ovl.vwap);
    if(levels){
      for(let q=0;q<levels.length;q++){
        const p = levels[q].p;
        if(p < lo) lo = p;
        if(p > hi) hi = p;
      }
    }
    if(!isFinite(lo) || !isFinite(hi)) return;
    let pad = (hi - lo) * 0.07;
    if(pad <= 0) pad = Math.max(Math.abs(hi) * 0.002, 0.5);
    lo -= pad; hi += pad;
    /* ręczne okno CENY (pan pionowy) nadpisuje auto-dopasowanie */
    if(view.yLo != null && view.yHi != null && view.yHi > view.yLo){
      lo = view.yLo; hi = view.yHi;
    }
    const range = hi - lo;

    /* osie / layout */
    const step = niceStep(range, 5);
    const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
    ctx.font = '10px JetBrains Mono, monospace';
    let axisW = 50;
    for(let v = Math.ceil(lo/step)*step; v <= hi; v += step){
      const w = ctx.measureText(v.toFixed(dec)).width;
      if(w + 16 > axisW) axisW = w + 16;
    }
    const lastC = candles[len-1];
    axisW = Math.max(axisW, ctx.measureText(fmtPrice(lastC.c, dec)).width + 16);

    const plotL = 6;
    const plotR = size.w - axisW;
    const plotW = Math.max(10, plotR - plotL);
    const timeH = 20;
    const priceTop = 4;
    const nP = pnl.length;
    const panelH = nP ? Math.max(46, Math.min(76, Math.floor((size.h - timeH) * (nP === 1 ? 0.18 : 0.155)))) : 0;
    const panelsBlock = nP * (panelH + 4);
    const availA = size.h - timeH - priceTop - panelsBlock;
    const gapV = hasVol ? 6 : 0;
    const volH = hasVol ? Math.max(22, Math.floor(availA * 0.16)) : 0;
    const priceH = Math.max(60, availA - volH - gapV);
    const priceBottom = priceTop + priceH;
    const volBottom = priceBottom + gapV + volH;
    const bottomAll = volBottom + panelsBlock;
    const cw = plotW / count;
    const bw = Math.min(23, Math.max(1, cw * 0.62));
    const X = (i) => plotL + (i - start) * cw + cw/2;
    const Y = (p) => priceTop + (hi - p) / range * priceH;

    layoutRef.current = { start, cw, plotL, plotW, lo, hi, range, priceH, priceTop };

    /* siatka pozioma + etykiety cen */
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for(let v = Math.ceil(lo/step)*step; v <= hi; v += step){
      const y = Y(v);
      ctx.strokeStyle = CLR.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.fillStyle = CLR.axis;
      ctx.fillText(v.toFixed(dec), plotR + 7, y);
    }

    /* siatka pionowa + etykiety czasu */
    const tStep = Math.max(1, Math.round(count / 5));
    ctx.textAlign = 'center';
    for(let i = iTo; i >= iFrom; i -= tStep){
      const x = X(i);
      if(x < plotL || x > plotR) continue;
      ctx.strokeStyle = CLR.grid;
      ctx.beginPath(); ctx.moveTo(x, priceTop); ctx.lineTo(x, bottomAll); ctx.stroke();
      ctx.fillStyle = CLR.axis;
      ctx.font = '9.5px JetBrains Mono, monospace';
      ctx.fillText(fmtTime(candles[i].t, tfId), x, size.h - 9);
    }

    /* strefy S/R (pod świecami) */
    if(ovl.sr && ovl.sr.length){
      for(let z=0;z<ovl.sr.length;z++){
        const s = ovl.sr[z];
        if(s.hi < lo || s.lo > hi) continue;
        const y1 = Y(Math.min(hi, s.hi));
        const y2 = Y(Math.max(lo, s.lo));
        const alpha = Math.min(0.16, 0.05 + s.touches * 0.018);
        ctx.fillStyle = 'rgba(79,216,255,' + alpha.toFixed(3) + ')';
        ctx.fillRect(plotL, y1, plotW, Math.max(2, y2 - y1));
        ctx.strokeStyle = 'rgba(79,216,255,.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotL, y1); ctx.lineTo(plotR, y1);
        ctx.moveTo(plotL, y2); ctx.lineTo(plotR, y2);
        ctx.stroke();
      }
    }

    /* wolumen */
    if(hasVol && volH > 4){
      let vmax = 0;
      for(let i=iFrom;i<=iTo;i++) if(candles[i].v > vmax) vmax = candles[i].v;
      if(vmax > 0){
        for(let i=iFrom;i<=iTo;i++){
          const c = candles[i];
          if(!c.v) continue;
          const h = Math.max(1, (c.v / vmax) * (volH - 3));
          ctx.fillStyle = c.c >= c.o ? 'rgba(47,214,174,.40)' : 'rgba(255,107,94,.40)';
          ctx.fillRect(X(i) - bw/2, volBottom - h, bw, h);
        }
      }
      ctx.strokeStyle = CLR.grid;
      ctx.beginPath(); ctx.moveTo(plotL, volBottom + .5); ctx.lineTo(plotR, volBottom + .5); ctx.stroke();
    }

    /* świece */
    for(let i=iFrom;i<=iTo;i++){
      const c = candles[i];
      const up = c.c >= c.o;
      const col = up ? CLR.up : CLR.down;
      const x = X(i);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const yO = Y(c.o), yC = Y(c.c);
      const top = Math.min(yO, yC);
      const hgt = Math.max(1, Math.abs(yO - yC));
      ctx.fillStyle = col;
      ctx.fillRect(x - bw/2, top, bw, hgt);
    }

    /* pomocnik: linia z serii (nulle przerywają ścieżkę) */
    const strokeSeries = (arr, color, lw, yFn, dash) => {
      if(!arr) return;
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
      if(dash) ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for(let i=iFrom;i<=iTo;i++){
        const v = arr[i];
        if(v == null){ started = false; continue; }
        const x = X(i), y = yFn(v);
        if(started) ctx.lineTo(x, y);
        else { ctx.moveTo(x, y); started = true; }
      }
      ctx.stroke();
      if(dash) ctx.setLineDash([]);
    };

    /* Bollinger */
    if(ovl.boll){
      strokeSeries(ovl.boll.up, 'rgba(159,226,214,.55)', 1, Y);
      strokeSeries(ovl.boll.dn, 'rgba(159,226,214,.55)', 1, Y);
      strokeSeries(ovl.boll.mid, 'rgba(159,226,214,.55)', 1, Y, [3,3]);
    }
    /* VWAP */
    if(ovl.vwap) strokeSeries(ovl.vwap, '#ff5fa2', 1.6, Y);

    /* linie EMA */
    for(let d=0;d<EMA_DEFS.length;d++){
      const def = EMA_DEFS[d];
      if(!emaVis[def.n]) continue;
      strokeSeries(emaData[def.n], def.color, 1.6, Y);
    }

    /* ostatnia cena — przerywana linia + etykieta na osi */
    const lc = lastC;
    if(lc.c >= lo && lc.c <= hi){
      const y = Y(lc.c);
      const upNow = len > 1 ? lc.c >= candles[len-2].c : lc.c >= lc.o;
      const col = upNow ? CLR.up : CLR.down;
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.setLineDash([]);
      const txt = fmtPrice(lc.c, dec);
      ctx.font = '10px JetBrains Mono, monospace';
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = col;
      const bx = plotR + 2, by = y - 9;
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(bx, by, tw + 12, 18, 4); else ctx.rect(bx, by, tw + 12, 18);
      ctx.fill();
      ctx.fillStyle = '#04181d';
      ctx.textAlign = 'left';
      ctx.fillText(txt, bx + 6, y);
    }

    /* poziomy sygnału: ENTRY / SL / TP */
    if(levels){
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textBaseline = 'middle';
      for(let q=0;q<levels.length;q++){
        const Lv = levels[q];
        if(Lv.p < lo || Lv.p > hi) continue;
        const y = Y(Lv.p);
        ctx.strokeStyle = Lv.color; ctx.lineWidth = 1;
        ctx.setLineDash([2,4]);
        ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
        ctx.setLineDash([]);
        const tw2 = ctx.measureText(Lv.label).width;
        ctx.fillStyle = Lv.color;
        ctx.fillRect(plotL + 4, y - 7, tw2 + 8, 14);
        ctx.fillStyle = '#04181d';
        ctx.textAlign = 'left';
        ctx.fillText(Lv.label, plotL + 8, y);
      }
      ctx.font = '10px JetBrains Mono, monospace';
    }

    /* ------------------- PANELE WSKAŹNIKÓW ------------------- */
    const vIdx = (cross != null && cross >= iFrom && cross <= iTo) ? cross : iTo;
    const fmtPV = v => {
      if(v == null) return '—';
      const a = Math.abs(v);
      if(a >= 1e6) return fmtVol(v);
      if(a >= 100) return v.toFixed(1);
      return v.toFixed(2);
    };
    for(let pi=0;pi<nP;pi++){
      const P = pnl[pi];
      const top = volBottom + 4 + pi*(panelH + 4);
      const bot = top + panelH;
      ctx.fillStyle = 'rgba(159,226,214,.03)';
      ctx.fillRect(plotL, top, plotW, panelH);
      ctx.strokeStyle = CLR.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plotL, top + .5); ctx.lineTo(plotR, top + .5); ctx.stroke();

      let plo = 0, phi = 100, fixed = true;
      if(P.kind === 'macd' || P.kind === 'line'){
        fixed = false; plo = Infinity; phi = -Infinity;
        const scanP = arr => {
          if(!arr) return;
          for(let i=iFrom;i<=iTo;i++){
            const v = arr[i];
            if(v == null) continue;
            if(v < plo) plo = v;
            if(v > phi) phi = v;
          }
        };
        if(P.kind === 'macd'){ scanP(P.m); scanP(P.s); scanP(P.h); if(plo > 0) plo = 0; if(phi < 0) phi = 0; }
        else scanP(P.a);
        if(!isFinite(plo) || !isFinite(phi)){ plo = 0; phi = 1; }
        let pp = (phi - plo) * 0.1;
        if(pp <= 0) pp = Math.max(Math.abs(phi)*0.05, 0.001);
        plo -= pp; phi += pp;
      }
      const yP = v => bot - 4 - (v - plo)/(phi - plo) * (panelH - 12);
      const level = (v, dash) => {
        if(v < plo || v > phi) return;
        ctx.strokeStyle = 'rgba(143,176,172,.30)'; ctx.lineWidth = 1;
        ctx.setLineDash(dash || [3,3]);
        ctx.beginPath(); ctx.moveTo(plotL, yP(v)); ctx.lineTo(plotR, yP(v)); ctx.stroke();
        ctx.setLineDash([]);
      };
      let valTxt = '';
      if(P.kind === 'rsi'){
        level(30); level(70);
        strokeSeries(P.a, '#4fd8ff', 1.5, yP);
        valTxt = fmtPV(P.a[vIdx]);
      } else if(P.kind === 'stoch'){
        level(20); level(80);
        strokeSeries(P.k, '#4fd8ff', 1.4, yP);
        strokeSeries(P.d, '#ffc94d', 1.4, yP);
        valTxt = '%K ' + fmtPV(P.k[vIdx]) + '  %D ' + fmtPV(P.d[vIdx]);
      } else if(P.kind === 'adx'){
        level(25);
        strokeSeries(P.pdi, CLR.up, 1.2, yP);
        strokeSeries(P.mdi, CLR.down, 1.2, yP);
        strokeSeries(P.adx, '#eef7f4', 1.6, yP);
        valTxt = fmtPV(P.adx[vIdx]) + '  +DI ' + fmtPV(P.pdi[vIdx]) + '  −DI ' + fmtPV(P.mdi[vIdx]);
      } else if(P.kind === 'macd'){
        const y0 = yP(0);
        for(let i=iFrom;i<=iTo;i++){
          const v = P.h[i];
          if(v == null) continue;
          ctx.fillStyle = v >= 0 ? 'rgba(47,214,174,.5)' : 'rgba(255,107,94,.5)';
          const yv = yP(v);
          ctx.fillRect(X(i) - bw*0.4, Math.min(y0, yv), bw*0.8, Math.max(1, Math.abs(yv - y0)));
        }
        level(0, [2,3]);
        strokeSeries(P.m, '#4fd8ff', 1.4, yP);
        strokeSeries(P.s, '#ffc94d', 1.4, yP);
        valTxt = fmtPV(P.m[vIdx]) + '  S ' + fmtPV(P.s[vIdx]) + '  H ' + fmtPV(P.h[vIdx]);
      } else if(P.kind === 'line'){
        strokeSeries(P.a, P.color || '#c792ff', 1.5, yP);
        valTxt = P.fmt ? (P.a[vIdx] == null ? '—' : P.fmt(P.a[vIdx])) : fmtPV(P.a[vIdx]);
      }
      ctx.font = '9.5px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = CLR.axis;
      ctx.fillText(P.id, plotL + 6, top + 10);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#cfe4e0';
      ctx.fillText(valTxt, plotR - 6, top + 10);
      ctx.textAlign = 'left';
    }

    /* znaczniki formacji + linie formacji geometrycznych */
    if(markers || (geoLines && geoLines.length)){
      ctx.save();
      ctx.beginPath(); ctx.rect(plotL, 0, plotW, bottomAll); ctx.clip();
      if(markers){
        for(let i=iFrom;i<=iTo;i++){
          const mk = markers[i];
          if(!mk) continue;
          const c = candles[i], x = X(i);
          if(mk.dir > 0){
            const y = Y(c.l) + 7;
            ctx.fillStyle = CLR.up;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x-4.5, y+7); ctx.lineTo(x+4.5, y+7); ctx.closePath(); ctx.fill();
          } else if(mk.dir < 0){
            const y = Y(c.h) - 7;
            ctx.fillStyle = CLR.down;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x-4.5, y-7); ctx.lineTo(x+4.5, y-7); ctx.closePath(); ctx.fill();
          } else {
            const y = Y(c.h) - 10;
            ctx.fillStyle = 'rgba(143,176,172,.85)';
            ctx.beginPath(); ctx.moveTo(x, y-4); ctx.lineTo(x+4, y); ctx.lineTo(x, y+4); ctx.lineTo(x-4, y); ctx.closePath(); ctx.fill();
          }
        }
      }
      if(geoLines){
        for(let g=0;g<geoLines.length;g++){
          const gp = geoLines[g];
          const col = gp.dir > 0 ? 'rgba(47,214,174,.75)' : gp.dir < 0 ? 'rgba(255,107,94,.75)' : 'rgba(79,216,255,.75)';
          ctx.strokeStyle = col; ctx.lineWidth = 1.3;
          ctx.setLineDash([6,4]);
          for(let q=0;q<gp.lines.length;q++){
            const L2 = gp.lines[q];
            ctx.beginPath();
            ctx.moveTo(X(L2.i0), Y(L2.p0));
            ctx.lineTo(X(L2.i1), Y(L2.p1));
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }

    /* krzyżyk (crosshair) */
    if(cross != null && cross >= iFrom && cross <= iTo){
      const c = candles[cross];
      const x = X(cross), y = Y(Math.min(hi, Math.max(lo, c.c)));
      ctx.strokeStyle = CLR.cross; ctx.lineWidth = 1;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(x, priceTop); ctx.lineTo(x, bottomAll); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.setLineDash([]);
      const txt = fmtPrice(c.c, dec);
      ctx.font = '10px JetBrains Mono, monospace';
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = '#2a4a53';
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(plotR + 2, y - 9, tw + 12, 18, 4); else ctx.rect(plotR + 2, y - 9, tw + 12, 18);
      ctx.fill();
      ctx.fillStyle = CLR.txt; ctx.textAlign = 'left';
      ctx.fillText(txt, plotR + 8, y);
    }
  }, [candles, view, cross, emaVis, size, tfId, hasVol, len, overlays, panels, markers, geoLines, levels]);

  /* --- panel OHLC dla krzyżyka --- */
  const cc = (cross != null && cross < len) ? candles[cross] : null;
  const prevC = (cross != null && cross > 0) ? candles[cross-1].c : (cc ? cc.o : null);
  const showReset = len > 0 && view.end < len - 2;

  const extras = [];
  if(cc){
    const i = cross;
    if(patMap && patMap[i]){
      patMap[i].forEach(p => extras.push((p.dir > 0 ? '▲ ' : p.dir < 0 ? '▼ ' : '◆ ') + p.name + ' ' + p.conf + '%'));
    }
    const f2 = v => v == null ? '—' : (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
    if(ovl.boll && ovl.boll.mid[i] != null){
      extras.push('BB ' + fmtPrice(ovl.boll.dn[i]) + ' / ' + fmtPrice(ovl.boll.mid[i]) + ' / ' + fmtPrice(ovl.boll.up[i]));
    }
    if(ovl.vwap && ovl.vwap[i] != null) extras.push('VWAP ' + fmtPrice(ovl.vwap[i]));
    for(let p=0;p<pnl.length;p++){
      const P = pnl[p];
      if(P.kind === 'rsi' && P.a[i] != null) extras.push('RSI ' + P.a[i].toFixed(1));
      else if(P.kind === 'macd' && P.m[i] != null) extras.push('MACD ' + f2(P.m[i]) + ' · S ' + f2(P.s[i]) + ' · H ' + f2(P.h[i]));
      else if(P.kind === 'stoch' && P.k[i] != null) extras.push('ST %K ' + P.k[i].toFixed(0) + ' %D ' + (P.d[i] != null ? P.d[i].toFixed(0) : '—'));
      else if(P.kind === 'adx' && P.adx[i] != null) extras.push('ADX ' + P.adx[i].toFixed(0) + ' (+DI ' + f2(P.pdi[i]) + ' −DI ' + f2(P.mdi[i]) + ')');
      else if(P.kind === 'line' && P.a[i] != null) extras.push(P.id + ' ' + (P.fmt ? P.fmt(P.a[i]) : f2(P.a[i])));
    }
  }

  return (
    <div className="chartwrap" ref={wrapRef}>
      <canvas
        ref={cvsRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      {cc && (
        <div className="ohlcbox mono">
          <div style={{color:'var(--dim)', fontWeight:700}}>{fmtFull(cc.t, tfId)}</div>
          <div>
            O <b style={{color:'var(--text)'}}>{fmtPrice(cc.o)}</b>{'  '}
            H <b style={{color:'var(--up)'}}>{fmtPrice(cc.h)}</b>{'  '}
            L <b style={{color:'var(--down)'}}>{fmtPrice(cc.l)}</b>{'  '}
            C <b style={{color: cc.c >= cc.o ? 'var(--up)' : 'var(--down)'}}>{fmtPrice(cc.c)}</b>
          </div>
          <div style={{color:'var(--dim)'}}>
            Δ {prevC ? fmtPct((cc.c - prevC)/prevC*100) : '—'}
            {cc.v ? '   Vol ' + fmtVol(cc.v) : ''}
          </div>
          <div>
            {EMA_DEFS.filter(d => emaVis[d.n] && emaData[d.n] && emaData[d.n][cross] != null).map(d => (
              <span key={d.n} style={{marginRight:8}}>
                <span style={{color:d.color}}>●</span>
                <span style={{color:'var(--dim)'}}> {d.n}:</span> {fmtPrice(emaData[d.n][cross])}
              </span>
            ))}
          </div>
          {extras.length > 0 && (
            <div style={{color:'var(--dim)', fontSize:10.5, marginTop:2}}>{extras.join('  ·  ')}</div>
          )}
        </div>
      )}
      {showReset && (
        <button className="resetview mono" onClick={() => {
          pinnedRef.current = true;
          setView(v => ({ ...v, end: len - 1 + v.count * 0.08 }));
        }}>⇥ Teraz</button>
      )}
      {view.yLo != null && (
        <button className="resetview mono" style={{bottom: showReset ? 72 : 34}}
          onClick={() => setView(v => ({ ...v, yLo:null, yHi:null }))}>⇕ auto</button>
      )}
    </div>
  );
}

/* ============================ IKONY / UI ============================= */
