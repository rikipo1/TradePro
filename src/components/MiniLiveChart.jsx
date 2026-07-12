import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CAP_MAP, capEnabled, capitalTick } from '../data/capital.js';
import { fetchChartWindow, TF_SEC } from '../data/feed.js';
import { paperFloating } from '../data/paper.js';
import { TFS } from '../data/yahoo.js';
import { fmtPrice, fmtTime, fmtFull, niceStep } from '../utils/format.js';

export function MiniLiveChart({ entry }){
  const wrapRef = useRef(null);
  const cvsRef = useRef(null);
  const [candles, setCandles] = useState([]);
  const [approx, setApprox] = useState(false);
  const [live, setLive] = useState(null);
  const [size, setSize] = useState({ w:0, h:180 });
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

  const tfObj = useMemo(() => TFS.find(t => t.id === entry.tf) || { id:'M5', interval:'5m', range:'1d' }, [entry.tf]);
  const tfSec = TF_SEC[entry.tf] || 300;

  /* [dziennik] OKNO ZAKOTWICZONE NA WEJŚCIU — LEWY brzeg (t0) stały: ~24 świece
     przed wejściem, więc świeca wejścia jest zawsze w kadrze i NIE skacze przy
     odświeżaniu. Prawy brzeg: dla zamkniętej = exit +8 świec (stały); dla otwartej
     = „teraz" (rośnie w prawo, ale nie przesuwa lewego brzegu). */
  const BEFORE = 24, AFTER = 8;
  const t0 = useMemo(() => Math.floor(entry.ts/1000) - BEFORE*tfSec, [entry.ts, tfSec]);
  const tEnd = useMemo(
    () => isOpen ? null : Math.floor((entry.exitTs || entry.ts)/1000) + AFTER*tfSec,
    [isOpen, entry.exitTs, entry.ts, tfSec]
  );

  const load = useCallback(async () => {
    try{
      const hi = tEnd != null ? tEnd : Math.floor(Date.now()/1000) + AFTER*tfSec;
      const r = await fetchChartWindow(entry.sym, tfObj, t0, hi);
      if(!aliveRef.current) return;
      setCandles(r.candles);
      setApprox(!!r.approx);
      if(isOpen) setLive(r.price);
    }catch(e){}
  }, [entry.sym, tfObj, t0, tEnd, isOpen, tfSec]);

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

  /* świeca wejścia (bucket zawierający entry.ts) — do oznaczenia i etykiety */
  const entryCandle = useMemo(() => {
    if(!candles.length) return null;
    let found = null;
    for(let q=0;q<candles.length;q++){ if(candles[q].t*1000 <= entry.ts) found = candles[q]; else break; }
    return found || candles[0];
  }, [candles, entry.ts]);
  const entryBull = entryCandle ? entryCandle.c >= entryCandle.o : null;

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

    /* widok = świece w zakotwiczonym oknie; przy fallbacku (stara transakcja
       poza retencją intraday) pokazujemy ostatni fragment poglądowo. */
    let view = candles.filter(c => c.t >= t0 && (tEnd == null || c.t <= tEnd));
    if(view.length < 3) view = candles.slice(-40);
    if(!view.length) return;

    const axW = 56, padT = 10, padB = 20;   // padB większy → miejsce na oś czasu
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
    const bw = Math.min(14, Math.max(1.5, cw * 0.62));
    const X = q => plotL + q*cw + cw/2;
    const Y = p => padT + (hi - p)/rng * ph;
    const dec = (hi >= 100 ? 1 : hi >= 10 ? 2 : 4);

    /* --- SIATKA cen + oś prawa (profesjonalny wygląd) --- */
    const step = niceStep(rng, 4);
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textBaseline = 'middle';
    for(let v = Math.ceil(lo/step)*step; v < hi; v += step){
      const y = Y(v);
      if(y < padT || y > H - padB) continue;
      ctx.strokeStyle = 'rgba(159,226,214,.06)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.fillStyle = '#5f8480'; ctx.textAlign = 'left';
      ctx.fillText(v.toFixed(dec), plotR + 4, y);
    }
    /* separator osi */
    ctx.strokeStyle = 'rgba(159,226,214,.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plotR + 0.5, padT); ctx.lineTo(plotR + 0.5, H - padB); ctx.stroke();

    /* indeks świecy wejścia w widoku */
    let entryQ = -1;
    for(let q=0;q<view.length;q++){ if(view[q].t*1000 <= entry.ts) entryQ = q; else break; }

    /* --- OŚ CZASU (godz:min) na dole --- */
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textBaseline = 'top'; ctx.fillStyle = '#5f8480';
    const nLab = Math.max(2, Math.min(5, Math.floor(plotW / 62)));
    for(let li=0; li<=nLab; li++){
      const q = Math.round(li/nLab * (view.length - 1));
      const c = view[q]; if(!c) continue;
      const x = X(q);
      ctx.strokeStyle = 'rgba(159,226,214,.05)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      ctx.textAlign = li === 0 ? 'left' : li === nLab ? 'right' : 'center';
      ctx.fillText(fmtTime(c.t, entry.tf), Math.max(plotL, Math.min(plotR, x)), H - padB + 4);
    }

    /* podświetlenie kolumny świecy wejścia (żeby było WIDAĆ kiedy było wejście) */
    if(entryQ >= 0){
      const x = X(entryQ);
      ctx.fillStyle = 'rgba(79,216,255,.12)';
      ctx.fillRect(x - cw/2, padT, cw, ph);
    }

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

    /* WYRAŹNY znacznik świecy wejścia: obrys ramki + strzałka kierunku + etykieta */
    if(entryQ >= 0){
      const c = view[entryQ], x = X(entryQ);
      const dirCol = entry.dir > 0 ? '#2fd6ae' : '#ff6b5e';
      /* ramka wokół świecy wejścia */
      ctx.strokeStyle = '#4fd8ff'; ctx.lineWidth = 1.4;
      const bx = x - Math.max(bw, 6)/2 - 2, by = Y(c.h) - 2, bw2 = Math.max(bw, 6) + 4, bh2 = (Y(c.l) - Y(c.h)) + 4;
      ctx.strokeRect(bx, by, bw2, bh2);
      /* strzałka kierunku transakcji przy świecy */
      ctx.fillStyle = dirCol;
      const ay = Y(entry.entry);
      ctx.beginPath();
      if(entry.dir > 0){ ctx.moveTo(x, ay+7); ctx.lineTo(x-5, ay+15); ctx.lineTo(x+5, ay+15); }
      else { ctx.moveTo(x, ay-7); ctx.lineTo(x-5, ay-15); ctx.lineTo(x+5, ay-15); }
      ctx.closePath(); ctx.fill();
      /* etykieta LONG/SHORT nad wykresem, wyrównana do świecy */
      ctx.font = '700 9px JetBrains Mono, monospace';
      ctx.fillStyle = dirCol; ctx.textBaseline = 'top';
      ctx.textAlign = x > W*0.6 ? 'right' : 'left';
      ctx.fillText((entry.dir > 0 ? '▲ LONG' : '▼ SHORT') + ' · ' + fmtTime(c.t, entry.tf), x > W*0.6 ? x - 6 : x + 6, padT + 1);
    }

    /* znacznik zamknięcia */
    if(!isOpen && entry.exit != null){
      let exitQ = view.length - 1;
      if(entry.exitTs){
        for(let q=0;q<view.length;q++){ if(view[q].t*1000 >= entry.exitTs){ exitQ = q; break; } }
      }
      const x = X(exitQ), y = Y(entry.exit);
      const winTrade = (entry.r || 0) > 0;
      ctx.fillStyle = winTrade ? '#2fd6ae' : '#ff6b5e';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#04181d'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = winTrade ? '#2fd6ae' : '#ff6b5e';
      ctx.textAlign = x > W/2 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      const lbl = (entry.result === 'tp2' ? 'TP2' : entry.result === 'tp1' ? 'TP1' : entry.result === 'sl' ? 'SL' : entry.result === 'be' ? 'BE' : 'EXIT')
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
  }, [candles, live, size, entry, isOpen, t0, tEnd]);

  const floating = isOpen ? paperFloating(entry, live) : null;

  return (
    <div style={{padding:'2px 4px 8px'}}>
      <div ref={wrapRef} style={{width:'100%'}}>
        <canvas ref={cvsRef} style={{display:'block', borderRadius:8}} />
      </div>
      <div className="mono" style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11, color:'var(--dim2)', marginTop:5, gap:8, flexWrap:'wrap'}}>
        <span style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
          <b style={{color: entry.dir > 0 ? 'var(--up)' : 'var(--down)'}}>{entry.dir > 0 ? '▲ LONG' : '▼ SHORT'}</b>
          <span>{entry.tf}</span>
          <span style={{color:'var(--dim)'}}>· {fmtFull(Math.floor(entry.ts/1000), entry.tf)}</span>
          {entryBull != null && (
            <span style={{color: entryBull ? 'var(--up)' : 'var(--down)'}}>
              · świeca {entryBull ? 'wzrostowa' : 'spadkowa'}
            </span>
          )}
          {approx && <span style={{color:'var(--ema9)'}}> · poglądowo</span>}
        </span>
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
