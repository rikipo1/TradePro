import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CAP_MAP, capEnabled, capitalTick } from '../data/capital.js';
import { fetchChart } from '../data/feed.js';
import { paperFloating } from '../data/paper.js';
import { TFS } from '../data/yahoo.js';
import { fmtPrice } from '../utils/format.js';

export function MiniLiveChart({ entry }){
  const wrapRef = useRef(null);
  const cvsRef = useRef(null);
  const [candles, setCandles] = useState([]);
  const [live, setLive] = useState(null);
  const [size, setSize] = useState({ w:0, h:170 });
  const aliveRef = useRef(true);
  const isOpen = entry.result === 'open';

  useEffect(() => () => { aliveRef.current = false; }, []);

  /* rozmiar */
  useEffect(() => {
    const el = wrapRef.current;
    if(!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(es => setSize(s => ({ ...s, w:Math.round(es[0].contentRect.width) })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* wczytaj świece wokół wejścia + odświeżaj gdy otwarta */
  const tfObj = useMemo(() => TFS.find(t => t.id === entry.tf) || { id:'M5', interval:'5m', range:'1d' }, [entry.tf]);
  const load = useCallback(async () => {
    try{
      const r = await fetchChart(entry.sym, tfObj);
      if(!aliveRef.current) return;
      setCandles(r.candles);
      if(isOpen) setLive(r.price);
    }catch(e){}
  }, [entry.sym, tfObj, isOpen]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if(!isOpen) return;
    const epic = CAP_MAP[entry.sym];
    let h;
    if(epic && capEnabled()){
      h = setInterval(async () => {
        if(document.visibilityState !== 'visible') return;
        try{ const t = await capitalTick(entry.sym); if(t && aliveRef.current) setLive(t.px); }catch(e){}
      }, 3000);
    } else {
      h = setInterval(load, 15000);
    }
    return () => clearInterval(h);
  }, [isOpen, entry.sym, load]);

  /* rysowanie */
  useEffect(() => {
    const cvs = cvsRef.current;
    if(!cvs || !size.w) return;
    const H = size.h, W = size.w, dpr = window.devicePixelRatio || 1;
    cvs.width = W*dpr; cvs.height = H*dpr;
    cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04181d';
    ctx.fillRect(0, 0, W, H);
    if(!candles.length) return;

    /* okno: od ~8 świec przed wejściem do teraz (lub do zamknięcia) */
    let i0 = 0;
    for(let q=0;q<candles.length;q++){ if(candles[q].t*1000 >= entry.ts){ i0 = q; break; } if(q === candles.length-1) i0 = q; }
    i0 = Math.max(0, i0 - 8);
    let i1 = candles.length - 1;
    if(!isOpen && entry.exitTs){
      for(let q=candles.length-1;q>=0;q--){ if(candles[q].t*1000 <= entry.exitTs){ i1 = Math.min(candles.length-1, q + 3); break; } }
    }
    const view = candles.slice(i0, i1 + 1);
    if(!view.length) return;

    const axW = 52, padT = 8, padB = 8;
    const plotR = W - axW, plotL = 4, plotW = plotR - plotL;
    const ph = H - padT - padB;

    let lo = Infinity, hi = -Infinity;
    for(let q=0;q<view.length;q++){ if(view[q].l < lo) lo = view[q].l; if(view[q].h > hi) hi = view[q].h; }
    [entry.entry, entry.sl, entry.tp1, entry.tp2, live].forEach(p => {
      if(p == null) return; if(p < lo) lo = p; if(p > hi) hi = p;
    });
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    const rng = hi - lo;
    const cw = plotW / view.length;
    const bw = Math.min(14, Math.max(1.5, cw * 0.6));
    const X = q => plotL + q*cw + cw/2;
    const Y = p => padT + (hi - p)/rng * ph;

    /* linie poziomów */
    const lvl = (p, col, label) => {
      if(p == null || p < lo || p > hi) return;
      const y = Y(p);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = col;
      ctx.fillText(label + ' ' + fmtPrice(p), plotR + 3, y);
    };
    lvl(entry.sl, '#ff6b5e', 'SL');
    lvl(entry.tp1, '#2fd6ae', 'TP1');
    if(entry.tp2 != null) lvl(entry.tp2, 'rgba(47,214,174,.6)', 'TP2');
    lvl(entry.entry, '#cfe4e0', 'E');

    /* świece */
    for(let q=0;q<view.length;q++){
      const c = view[q], up = c.c >= c.o, col = up ? '#2fd6ae' : '#ff6b5e';
      const x = X(q);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const yO = Y(c.o), yC = Y(c.c);
      ctx.fillStyle = col;
      ctx.fillRect(x - bw/2, Math.min(yO, yC), bw, Math.max(1, Math.abs(yO - yC)));
    }

    /* znacznik wejścia (pionowa kreska na świecy wejścia) */
    let entryQ = -1;
    for(let q=0;q<view.length;q++){ if(view[q].t*1000 >= entry.ts){ entryQ = q; break; } }
    if(entryQ >= 0){
      const x = X(entryQ);
      ctx.strokeStyle = 'rgba(207,228,224,.35)'; ctx.lineWidth = 1;
      ctx.setLineDash([2,2]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = entry.dir > 0 ? '#2fd6ae' : '#ff6b5e';
      const ay = Y(entry.entry);
      ctx.beginPath();
      if(entry.dir > 0){ ctx.moveTo(x, ay+8); ctx.lineTo(x-4, ay+14); ctx.lineTo(x+4, ay+14); }
      else { ctx.moveTo(x, ay-8); ctx.lineTo(x-4, ay-14); ctx.lineTo(x+4, ay-14); }
      ctx.closePath(); ctx.fill();
    }

    /* znacznik zamknięcia */
    if(!isOpen && entry.exit != null){
      let exitQ = view.length - 1;
      if(entry.exitTs){
        for(let q=0;q<view.length;q++){ if(view[q].t*1000 >= entry.exitTs){ exitQ = q; break; } }
      }
      const x = X(exitQ), y = Y(entry.exit);
      const win = (entry.r || 0) > 0;
      ctx.fillStyle = win ? '#2fd6ae' : '#ff6b5e';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#04181d'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = win ? '#2fd6ae' : '#ff6b5e';
      ctx.textAlign = x > W/2 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      const lbl = (entry.result === 'tp2' ? 'TP2' : entry.result === 'tp1' ? 'TP1' : entry.result === 'sl' ? 'SL' : 'EXIT')
        + ' ' + ((entry.r||0) > 0 ? '+' : '') + (entry.r||0) + 'R';
      ctx.fillText(lbl, x > W/2 ? x - 7 : x + 7, y - 5);
    }

    /* linia + etykieta LIVE */
    if(isOpen && live != null && live >= lo && live <= hi){
      const y = Y(live);
      ctx.strokeStyle = '#4fd8ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.fillStyle = '#4fd8ff';
      ctx.fillRect(plotR, y - 7, axW, 14);
      ctx.fillStyle = '#04181d';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtPrice(live), plotR + 3, y);
    }
  }, [candles, live, size, entry, isOpen]);

  const floating = isOpen ? paperFloating(entry, live) : null;

  return (
    <div style={{padding:'2px 4px 8px'}}>
      <div ref={wrapRef} style={{width:'100%'}}>
        <canvas ref={cvsRef} style={{display:'block', borderRadius:8}} />
      </div>
      <div className="mono" style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--dim2)', marginTop:5}}>
        <span>{entry.tf} · {candles.length ? 'wykres wokół wejścia' : 'ładuję…'}</span>
        {isOpen
          ? <span style={{color: floating == null ? 'var(--dim)' : floating >= 0 ? 'var(--up)' : 'var(--down)', fontWeight:700}}>
              {live != null ? 'LIVE ' + fmtPrice(live) + (floating != null ? '  ·  ' + (floating > 0 ? '+' : '') + floating + 'R' : '') : '…'}
            </span>
          : <span style={{color: (entry.r||0) > 0 ? 'var(--up)' : 'var(--down)', fontWeight:700}}>
              zamknięto: {(entry.r||0) > 0 ? '+' : ''}{entry.r||0}R
            </span>}
      </div>
    </div>
  );
}
