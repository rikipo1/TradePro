import React, { useState, useEffect, useRef } from 'react';
import { IC, Ic } from './icons.jsx';
import { Bus } from '../core/bus.js';
import { searchSymbols } from '../data/feed.js';

export function SearchModal({ onAdd, onClose, existing }){
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if(inputRef.current) inputRef.current.focus(); }, []);
  useEffect(() => {
    const s = q.trim();
    if(s.length < 2){ setRes([]); return; }
    setBusy(true);
    const h = setTimeout(async () => {
      try{
        const r = await searchSymbols(s);
        setRes(r);
      }catch(e){
        setRes([]);
        Bus.show('Wyszukiwarka niedostępna — możesz dodać symbol ręcznie');
      }
      setBusy(false);
    }, 450);
    return () => clearTimeout(h);
  }, [q]);

  const has = sym => existing.some(w => w.sym === sym);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="searchbox">
          <span style={{color:'var(--dim2)'}}>
            <Ic d={IC.search} size={18} extra={<circle cx="11" cy="11" r="7" />} />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if(e.key === 'Enter'){
                const s = q.trim();
                if(!s) return;
                if(res.length && !has(res[0].sym)){ onAdd({ sym:res[0].sym, name:res[0].name }); onClose(); }
                else { const sym = s.toUpperCase(); if(!has(sym)) onAdd({ sym, name:sym }); onClose(); }
              } else if(e.key === 'Escape'){ onClose(); }
            }}
            placeholder="Szukaj: ticker lub nazwa (np. TSLA, DAX)…"
          />
          {busy && <div className="loader" style={{width:16,height:16,borderWidth:2}} />}
        </div>
        <div style={{overflowY:'auto', marginTop:6, flex:1}}>
          {res.map(r => (
            <div key={r.sym} className="sr-row" onClick={() => { if(!has(r.sym)){ onAdd({ sym:r.sym, name:r.name }); onClose(); } }}>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontWeight:700, fontSize:14, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{r.name}</div>
                <div className="wl-sym mono">{r.sym}</div>
              </div>
              {r.exch ? <span className="tag">{r.exch}</span> : null}
              {has(r.sym)
                ? <span style={{color:'var(--up)'}}><Ic d={IC.check} size={17} /></span>
                : <span style={{color:'var(--accent)'}}><Ic d={IC.plus} size={17} /></span>}
            </div>
          ))}
          {q.trim().length >= 1 && (
            <div className="sr-row" onClick={() => {
              const sym = q.trim().toUpperCase();
              if(!has(sym)){ onAdd({ sym, name:sym }); }
              onClose();
            }}>
              <div style={{flex:1}}>
                <div style={{fontWeight:700, fontSize:14, color:'var(--cyan)'}}>Dodaj symbol „{q.trim().toUpperCase()}"</div>
                <div className="wl-sym">wpisany ręcznie (format Yahoo Finance)</div>
              </div>
              <span style={{color:'var(--accent)'}}><Ic d={IC.plus} size={17} /></span>
            </div>
          )}
          {q.trim().length < 2 && !res.length && (
            <div style={{padding:'22px 6px', color:'var(--dim2)', fontSize:13, lineHeight:1.7}}>
              Wpisz min. 2 znaki. Przykłady formatów Yahoo:<br/>
              <span className="mono" style={{color:'var(--dim)'}}>^GDAXI</span> — indeks DAX,{' '}
              <span className="mono" style={{color:'var(--dim)'}}>AAPL</span> — akcje,{' '}
              <span className="mono" style={{color:'var(--dim)'}}>GC=F</span> — złoto,{' '}
              <span className="mono" style={{color:'var(--dim)'}}>EURUSD=X</span> — forex
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
