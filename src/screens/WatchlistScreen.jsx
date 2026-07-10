import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IC, Ic } from '../components/icons.jsx';
import { SearchModal } from '../components/SearchModal.jsx';
import { Sparkline } from '../components/Sparkline.jsx';
import { Bus } from '../core/bus.js';
import { Net } from '../core/net.js';
import { fetchQuotes, getChart } from '../data/feed.js';
import { fmtClock, fmtPct, fmtPrice } from '../utils/format.js';
import { notifyUser } from '../utils/notify.js';

export function WatchlistScreen({ wl, setWl, openChart, prefs, setPrefs }){
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [updated, setUpdated] = useState(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const load = useCallback(async () => {
    if(!wl.length) return;
    setLoading(true);
    const out = {};
    const wlTf = { id:'M5', interval:'5m', range:'1d' };
    {
      /* 1 zbiorcze zapytanie zamiast N pojedynczych */
      let batch = null;
      try{ batch = await fetchQuotes(wl.map(w => w.sym)); }catch(e){ batch = null; }
      await Promise.all(wl.map(async it => {
        const b = batch ? batch[it.sym] : null;
        if(b && b.price != null){
          const chg = (b.prev != null) ? b.price - b.prev : null;
          out[it.sym] = {
            price: b.price,
            pct: (chg != null && b.prev) ? chg / b.prev * 100 : null,
            spark: (b.closes || []).slice(-80),
            demo: false,
          };
          return;
        }
        /* uzupełnienie pojedynczo tylko dla braków */
        try{
          const r = await getChart(it.sym, wlTf, prefs.source);
          const closes = r.candles.map(c => c.c);
          const chg = (r.price != null && r.prev != null) ? r.price - r.prev : null;
          out[it.sym] = {
            price: r.price,
            pct: (chg != null && r.prev) ? chg / r.prev * 100 : null,
            spark: closes.slice(-80),
            demo: !!r.demo,
          };
        }catch(e){
          out[it.sym] = { err: e.message || 'błąd' };
        }
      }));
    }
    if(!aliveRef.current) return;
    setQuotes(q => ({ ...q, ...out }));
    setUpdated(new Date());
    setLoading(false);
  }, [wl, prefs.source]);

  useEffect(() => { load(); }, [load]);

  const remove = sym => setWl(list => list.filter(w => w.sym !== sym));

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand">RIKIPO<em>TRADER</em><small>v1.3.3 · auto-epic</small></div>
        <div className="spacer" />
        <button className={'chip mono' + ((prefs.bgScan && prefs.alert) ? ' sel' : '')}
          style={(prefs.bgScan && prefs.alert) ? { color:'var(--up)', borderColor:'rgba(47,214,174,.4)' } : null}
          onClick={() => setPrefs(p => {
            const nv = !p.bgScan;
            const np = { ...p, bgScan:nv };
            if(nv && !p.alert){ np.alert = true; }
            if(nv){
              notifyUser('Rikipo Trader', 'Skaner tła WŁĄCZONY — cała lista na ' + (p.tf || 'M5') + ' co 45 s');
              Bus.show('🛰️ Skaner tła WŁĄCZONY — alarmuje o sygnałach z całej listy (TF ' + (p.tf || 'M5') + ')');
            } else {
              Bus.show('Skaner tła wyłączony');
            }
            return np;
          })}>
          {(prefs.bgScan && prefs.alert) ? '🛰️ SKAN' : '○ SKAN'}
        </button>
        <button className={'iconbtn' + (loading ? ' accent' : '')} onClick={() => { Net.blockedUntil = 0; load(); }}>
          <span className={loading ? 'spin' : ''} style={{display:'flex'}}><Ic d={IC.refresh} size={18} /></span>
        </button>
        <button className={'iconbtn' + (edit ? ' on' : '')} onClick={() => setEdit(e => !e)}>
          <Ic d={edit ? IC.check : IC.edit} size={18} />
        </button>
        <button className="iconbtn accent" onClick={() => setShowAdd(true)}>
          <Ic d={IC.plus} size={19} />
        </button>
      </div>

      <div className="section-label">
        Obserwowane · {wl.length}
        {updated ? <span style={{float:'right', letterSpacing:0}} className="mono">akt. {fmtClock(updated)}</span> : null}
      </div>

      <div>
        {wl.map((it, i) => {
          const q = quotes[it.sym] || {};
          const up = q.pct != null && q.pct >= 0;
          return (
            <div key={it.sym} className="wl-row" style={{animationDelay:(i*30)+'ms'}}
                 onClick={() => { if(!edit) openChart(it); }}>
              {edit && <button className="del-btn" onClick={e => { e.stopPropagation(); remove(it.sym); }}>−</button>}
              <div style={{flex:1, minWidth:0}}>
                <div className="wl-name" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
                <div className="wl-sym mono">
                  {it.sym}
                </div>
              </div>
              {!edit && q.spark && q.spark.length > 1 && <Sparkline data={q.spark} up={up} />}
              <div style={{minWidth:86}}>
                {q.err
                  ? <div style={{fontSize:11, color:'var(--down)', textAlign:'right'}}>brak danych</div>
                  : <React.Fragment>
                      <div className="wl-price mono">{fmtPrice(q.price)}</div>
                      <div style={{textAlign:'right'}}>
                        <span className={'wl-chip mono ' + (q.pct == null ? 'chip-flat' : up ? 'chip-up' : 'chip-down')}>
                          {fmtPct(q.pct)}
                        </span>
                      </div>
                    </React.Fragment>}
              </div>
            </div>
          );
        })}
        {!wl.length && (
          <div style={{padding:'40px 24px', textAlign:'center', color:'var(--dim2)'}}>
            Lista jest pusta. Dodaj pierwszy instrument przyciskiem +.
          </div>
        )}
      </div>

      <div style={{padding:'14px 16px 20px', fontSize:11, color:'var(--dim2)', lineHeight:1.6}}>
        Dane: Yahoo Finance (indeksy kasowe). DAX ≈ DE40, Dow Jones ≈ US30 —
        notowania CFD w XTB mogą się minimalnie różnić.
      </div>

      {showAdd && (
        <SearchModal
          existing={wl}
          onClose={() => setShowAdd(false)}
          onAdd={item => setWl(list => list.some(w => w.sym === item.sym) ? list : [...list, item])}
        />
      )}
    </div>
  );
}

/* ======================= [5b] EKRAN: WYKRES ========================= */
