import React, { useState, useEffect, useCallback } from 'react';
import { IC, Ic } from '../components/icons.jsx';
import { MiniLiveChart } from '../components/MiniLiveChart.jsx';
import { Bus } from '../core/bus.js';
import { CAP_MAP, capEnabled, capitalTick } from '../data/capital.js';
import { fetchQuotes } from '../data/feed.js';
import { paperFloating } from '../data/paper.js';
import { riskStatus } from '../signals/riskEngine.js';
import { rollingStats, degradation } from '../signals/monitor.js';
import { Store } from '../core/store.js';
import { compareShadow } from '../backtest/shadow.js';
import { backtestEngine } from '../backtest/engine.js';
import { indicatorsFor } from '../signals/engine.js';
import { getChart } from '../data/feed.js';
import { TFS } from '../data/yahoo.js';
import { fmtPrice, pad2 } from '../utils/format.js';

export function fmtDT(ts){
  const d = new Date(ts);
  return pad2(d.getDate()) + '.' + pad2(d.getMonth()+1) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
export const RESULT_DEF = [
  ['tp2', 'TP2',  2.5, 'var(--up)'],
  ['tp1', 'TP1',  1.5, 'var(--up)'],
  ['be',  'BE',   0,   'var(--dim)'],
  ['sl',  'SL',  -1,   'var(--down)'],
];
export function JournalScreen({ journal, setJournal }){
  const [edit, setEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [pick, setPick] = useState(null);
  const [mDir, setMDir] = useState(1);
  const [mSym, setMSym] = useState('DE40');
  const [mRes, setMRes] = useState('tp1');
  const [mNote, setMNote] = useState('');
  const [q, setQ] = useState({});
  const [busyPx, setBusyPx] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [shadow, setShadow] = useState({ busy:false, res:null, combo:null }); // [E3-2]

  /* statystyki tylko z ROZSTRZYGNIĘTYCH transakcji — pending/cancelled
     (zlecenia limit) nie są transakcjami i nie mogą zaniżać średnich */
  const closed = journal.filter(e => e.result !== 'open' && e.result !== 'pending' && e.result !== 'cancelled');
  const wins = closed.filter(e => (e.r || 0) > 0.2).length;
  const losses = closed.filter(e => (e.r || 0) < -0.2).length;
  const sumR = closed.reduce((a, e) => a + (e.r || 0), 0);
  const grossW = closed.reduce((a, e) => a + ((e.r || 0) > 0 ? e.r : 0), 0);
  const grossL = closed.reduce((a, e) => a + ((e.r || 0) < 0 ? -e.r : 0), 0);
  const openN = journal.filter(e => e.result === 'open' || e.result === 'pending').length;

  const loadPx = useCallback(async () => {
    const openP = journal.filter(e => e.paper && e.result === 'open');
    if(!openP.length){ setQ({}); return; }
    setBusyPx(true);
    const syms = Array.from(new Set(openP.map(e => e.sym)));
    const out = {};
    for(let s=0;s<syms.length;s++){
      const sym = syms[s];
      try{
        if(capEnabled() && CAP_MAP[sym]){
          const t = await capitalTick(sym);
          if(t){ out[sym] = t.px; continue; }
        }
      }catch(e){}
      try{
        const r = await fetchQuotes([sym]);
        if(r && r[sym] && r[sym].price != null) out[sym] = r[sym].price;
      }catch(e){}
    }
    setQ(out);
    setBusyPx(false);
  }, [journal]);
  useEffect(() => { loadPx(); }, [loadPx]);

  const resultOf = key => {
    for(let q=0;q<RESULT_DEF.length;q++){ if(RESULT_DEF[q][0] === key) return RESULT_DEF[q]; }
    return null;
  };
  const closeEntry = (id, key) => {
    const rd = resultOf(key);
    setJournal(list => list.map(e => e.id === id
      ? { ...e, result:key, r: (key === 'tp1' && e.rr1) ? e.rr1 : rd[2] }
      : e));
    setPick(null);
  };
  const addManual = () => {
    const rd = resultOf(mRes);
    setJournal(list => [{
      id: Date.now(), ts: Date.now(), sym: (mSym || '—').toUpperCase(), tf: '—',
      dir: mDir, result: mRes, r: rd[2], note: mNote.trim(), src: 'manual',
    }, ...list]);
    setShowAdd(false);
    setMNote('');
  };

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand">RIKIPO<em>TRADER</em><small>dziennik transakcji</small></div>
        <div className="spacer" />
        <button className="iconbtn" onClick={() => {
          if(!journal.length){ Bus.show('Dziennik jest pusty'); return; }
          const esc = s => { const v = String(s == null ? '' : s); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
          const head = ['data','symbol','tf','kierunek','wejscie','SL','TP1','TP2','wynik','R','zrodlo','notatka'];
          const rows = journal.map(e => [
            fmtDT(e.ts), e.sym, e.tf || '', e.dir > 0 ? 'LONG' : 'SHORT',
            e.entry != null ? e.entry : '', e.sl != null ? e.sl : '',
            e.tp1 != null ? e.tp1 : '', e.tp2 != null ? e.tp2 : '',
            e.result, e.r != null ? e.r : '', e.src || '', e.note || '',
          ].map(esc).join(';'));
          const csv = '\uFEFF' + head.join(';') + '\n' + rows.join('\n');
          try{
            const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'rikipo-dziennik.csv';
            document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
            Bus.show('Wyeksportowano ' + journal.length + ' wpisów do CSV');
          }catch(err){ Bus.show('Eksport nieobsługiwany w tym środowisku'); }
        }}>
          <Ic d={IC.download} size={18} />
        </button>
        <button className="iconbtn" title="Eksport JSON (tylko dziennik)" onClick={() => {
          /* [E4-4] eksport JSON samego dziennika (komplet pól decyzyjnych) */
          if(!journal.length){ Bus.show('Dziennik jest pusty'); return; }
          try{
            const json = JSON.stringify({ __app:'RikipoTrader', __type:'journal', __ver:1, __ts:new Date().toISOString(), journal }, null, 1);
            const blob = new Blob([json], { type:'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'rikipo-dziennik.json';
            document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
            Bus.show('Wyeksportowano dziennik do JSON (' + journal.length + ' wpisów)');
          }catch(err){ Bus.show('Eksport nieobsługiwany w tym środowisku'); }
        }}>
          <span className="mono" style={{fontSize:10, fontWeight:900}}>{'{}'}</span>
        </button>
        <button className="iconbtn" onClick={loadPx}>
          <span className={busyPx ? 'spin' : ''} style={{display:'flex'}}><Ic d={IC.refresh} size={18} /></span>
        </button>
        <button className={'iconbtn' + (edit ? ' on' : '')} onClick={() => setEdit(x => !x)}>
          <Ic d={edit ? IC.check : IC.edit} size={18} />
        </button>
        <button className="iconbtn accent" onClick={() => setShowAdd(true)}><Ic d={IC.plus} size={19} /></button>
      </div>

      {(() => {
        /* [A5] status Risk Engine v2: floating z żywych cen + limit otwartych */
        const openPaper = journal.filter(e => e.paper && e.result === 'open');
        const floatingR = +openPaper.reduce((a, e) => { const f = paperFloating(e, q[e.sym]); return a + (f != null ? f : 0); }, 0).toFixed(2);
        const rs = riskStatus(journal, {}, { openCount: openPaper.length, floatingR });
        if(!rs.blocked && rs.effDailyR >= 0 && !openPaper.length) return null;
        return (
          <div className="card" style={{marginTop:2, borderColor: rs.blocked ? 'rgba(255,107,94,.45)' : 'var(--border)'}}>
            <div className="kv"><b>{rs.blocked ? '\u{1F6D1} Kill-switch aktywny' : 'Ryzyko dnia (UTC)'}</b>
              <span className="mono" style={{color: rs.effDailyR < 0 ? 'var(--down)' : 'var(--dim)'}}>
                {rs.effDailyR}R{rs.floatingR ? ' (floating ' + (rs.floatingR > 0 ? '+' : '') + rs.floatingR + 'R)' : ''} · otwarte {openPaper.length}
              </span>
            </div>
            {rs.reason && <div style={{fontSize:11.5, color:'var(--down)', paddingTop:2}}>{rs.reason} — auto-trade wstrzymany</div>}
          </div>
        );
      })()}

      <div className="card" style={{marginTop:2}}>
        <div className="kv"><b>Zamknięte transakcje</b><span className="mono">{closed.length}{openN ? ' · ' + openN + ' w trakcie' : ''}</span></div>
        <div className="kv"><b>Trafność</b><span className="mono" style={{color: wins >= losses ? 'var(--up)' : 'var(--down)'}}>{(wins + losses) ? (wins/(wins+losses)*100).toFixed(0) + '%' : '—'}</span></div>
        <div className="kv"><b>Suma R</b><span className="mono" style={{color: sumR >= 0 ? 'var(--up)' : 'var(--down)'}}>{(sumR >= 0 ? '+' : '') + sumR.toFixed(2) + ' R'}</span></div>
        <div className="kv"><b>Średnia R / trade</b><span className="mono">{closed.length ? (sumR/closed.length).toFixed(2) : '—'}</span></div>
        <div className="kv"><b>Profit factor</b><span className="mono">{grossL > 0 ? (grossW/grossL).toFixed(2) : (grossW > 0 ? '∞' : '—')}</span></div>
      </div>

      {(() => {
        /* [E3-1] Monitoring Engine: rolling stats vs walidacja k-fold */
        const meta = Store.get('rt_model_meta', null);
        if(!meta || !meta.sym) return null;
        const roll = rollingStats(journal, meta.sym, meta.tf, 30);
        const deg = degradation(roll, meta);
        return (
          <div className="card" style={{marginTop:2, borderColor: deg.degraded || meta.degradedAt ? 'rgba(255,201,77,.45)' : 'var(--border)'}}>
            <div className="kv"><b>Monitoring modelu · {meta.sym}·{meta.tf}</b>
              <span className="mono" style={{color: meta.reliable ? 'var(--up)' : 'var(--ema9)'}}>
                {meta.reliable ? 'AKTYWNY' : (meta.degradedAt ? 'ZDEGRADOWANY → wagi domyślne' : 'nieaktywny')}
              </span>
            </div>
            <div className="kv"><b>Rolling (ost. {roll.n})</b>
              <span className="mono">{roll.n ? (roll.avgR + 'R · traf. ' + (roll.winRate != null ? roll.winRate + '%' : '—') + ' · PF ' + roll.pf + (roll.brierLive != null ? ' · Brier ' + roll.brierLive : '')) : 'brak zamkniętych transakcji'}</span>
            </div>
            {meta.agg && meta.agg.avgR && <div className="kv"><b>Walidacja k-fold</b><span className="mono" style={{color:'var(--dim2)'}}>med {meta.agg.avgR.med != null ? meta.agg.avgR.med : '—'}R · p25 {meta.agg.avgR.p25 != null ? meta.agg.avgR.p25 : '—'}R</span></div>}
            {(deg.degraded || meta.degradedWhy) && (
              <div style={{fontSize:11.5, color:'var(--ema9)', paddingTop:2, lineHeight:1.5}}>
                ⚠ {((deg.degraded ? deg.reasons : meta.degradedWhy) || []).join(' · ')} — model przełączony na wagi domyślne do czasu ponownego treningu.
              </div>
            )}
          </div>
        );
      })()}

      {(() => {
        /* [E3-2] Backtest vs Paper — ten sam sym×TF, wspólny okres */
        const combos = Array.from(new Set(journal
          .filter(e => e.paper && e.tf && e.tf !== '—' && e.result !== 'open' && e.result !== 'pending' && e.result !== 'cancelled')
          .map(e => e.sym + '|' + e.tf)));
        if(!combos.length) return null;
        const runCompare = async (combo) => {
          const [sym, tfId] = combo.split('|');
          const tfObj = TFS.find(t => t.id === tfId);
          if(!tfObj){ Bus.show('Nieznany interwał ' + tfId); return; }
          setShadow({ busy:true, res:null, combo });
          try{
            const paper = journal.filter(e => e.paper && e.sym === sym && e.tf === tfId
              && e.result !== 'open' && e.result !== 'pending' && e.result !== 'cancelled');
            const minTs = Math.min(...paper.map(e => e.ts || Date.now())) / 1000;
            const ch = await getChart(sym, tfObj, 'auto');
            const pack = indicatorsFor(ch.candles, tfId);
            const bt = backtestEngine(ch.candles, pack.ind, pack.emaData, pack.hasVol, sym, 30, null, { tfId });
            const btCommon = bt.trades.filter(t => ch.candles[t.i0] && ch.candles[t.i0].t >= minTs);
            const btUse = btCommon.length >= 10 ? btCommon : bt.trades; // wspólny okres, fallback: całość
            setShadow({ busy:false, combo, res: { cmp: compareShadow(paper, btUse), common: btCommon.length >= 10 } });
          }catch(err){
            setShadow({ busy:false, combo, res:null });
            Bus.show('Porównanie nieudane: ' + (err.message || 'błąd danych'));
          }
        };
        const r = shadow.res && shadow.res.cmp;
        return (
          <div className="card" style={{marginTop:2}}>
            <div style={{fontWeight:800, fontSize:13, marginBottom:6}}>Backtest vs Paper (shadow)</div>
            <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:6}}>
              {combos.slice(0, 6).map(cb => (
                <button key={cb} className={'chip mono' + (shadow.combo === cb ? ' sel' : '')}
                  style={{fontSize:11, padding:'6px 10px', opacity: shadow.busy ? 0.6 : 1}}
                  onClick={() => { if(!shadow.busy) runCompare(cb); }}>
                  {cb.replace('|', ' · ')}
                </button>
              ))}
            </div>
            {shadow.busy && <div style={{fontSize:12, color:'var(--dim2)'}}>Liczę backtest na bieżących świecach…</div>}
            {r && !shadow.busy && (
              <>
                <div className="kv"><b>PAPER</b><span className="mono">{r.paper.n} tr · {r.paper.avgR != null ? r.paper.avgR + 'R' : '—'} · traf. {r.paper.winRate != null ? r.paper.winRate + '%' : '—'} · BE {Math.round((r.paper.beShare || 0) * 100)}% · approx {Math.round((r.paper.approxShare || 0) * 100)}%</span></div>
                <div className="kv"><b>BACKTEST</b><span className="mono">{r.backtest.n} tr · {r.backtest.avgR != null ? r.backtest.avgR + 'R' : '—'} · traf. {r.backtest.winRate != null ? r.backtest.winRate + '%' : '—'} · BE {Math.round((r.backtest.beShare || 0) * 100)}%</span></div>
                <div style={{fontSize:12, lineHeight:1.55, paddingTop:4,
                  color: r.verdict === 'OK' ? 'var(--up)' : r.verdict === 'NIEWYJAŚNIONA' ? 'var(--down)' : 'var(--dim)'}}>
                  Werdykt: <b>{r.verdict}</b> — {r.why}{shadow.res.common ? '' : ' · (za mało transakcji we wspólnym okresie — porównano z całą historią świec)'}
                </div>
              </>
            )}
          </div>
        );
      })()}

      <div className="section-label">Wpisy · {journal.length}</div>
      <div>
        {journal.map(e => {
          const rd = resultOf(e.result);
          const isExp = expanded === e.id;
          return (
            <React.Fragment key={e.id}>
            <div className="wl-row" style={isExp ? {borderBottomColor:'transparent'} : null}
              onClick={() => {
                if(edit) return;
                if(e.paper) setExpanded(x => x === e.id ? null : e.id);
                else if(e.result === 'open') setPick(e);
              }}>
              {edit && <button className="del-btn" onClick={ev => { ev.stopPropagation(); setJournal(list => list.filter(x => x.id !== e.id)); if(expanded === e.id) setExpanded(null); }}>−</button>}
              <span style={{color: e.dir > 0 ? 'var(--up)' : 'var(--down)', fontWeight:900, width:18, flexShrink:0}}>{e.dir > 0 ? '▲' : '▼'}</span>
              <div style={{flex:1, minWidth:0}}>
                <div className="wl-name" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {e.sym}{e.tf && e.tf !== '—' ? ' · ' + e.tf : ''}
                  {e.paper ? <span className="tag" style={{marginLeft:6, color:'var(--cyan)'}}>{isExp ? '▾ wykres' : '▸ wykres'}</span> : null}
                  {e.src === 'signal' ? <span className="tag" style={{marginLeft:6}}>sygnał{e.score != null ? ' ' + (e.score > 0 ? '+' : '') + e.score : ''}</span> : null}
                  {e.src === 'auto' ? <span className="tag" style={{marginLeft:6, color:'var(--ema9)'}}>🤖 bot</span> : null}
                </div>
                <div className="wl-sym mono" style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {fmtDT(e.ts)}
                  {e.entry != null ? ' · E ' + fmtPrice(e.entry) + ' SL ' + fmtPrice(e.sl) : ''}
                  {e.note ? ' · ' + e.note : ''}
                </div>
              </div>
              <span className="wl-chip mono" style={{
                background: e.result === 'open' ? 'rgba(79,216,255,.13)' : e.result === 'pending' ? 'rgba(255,201,77,.13)' : ((e.r || 0) > 0 ? 'rgba(47,214,174,.14)' : (e.r || 0) < 0 ? 'rgba(255,107,94,.14)' : 'rgba(143,176,172,.12)'),
                color: e.result === 'open' ? 'var(--cyan)' : e.result === 'pending' ? 'var(--ema9)' : ((e.r || 0) > 0 ? 'var(--up)' : (e.r || 0) < 0 ? 'var(--down)' : 'var(--dim)'),
              }}>
                {e.result === 'open'
                  ? (() => {
                      const fl = paperFloating(e, q[e.sym]);
                      const tag = e.stage === 'runner' ? 'RUN ' : e.stage === 'be' ? 'BE→ ' : 'LIVE ';
                      return fl == null ? (e.stage === 'runner' ? 'RUNNER' : 'OTWARTA') : tag + (fl > 0 ? '+' : '') + fl + 'R';
                    })()
                  : e.result === 'pending' ? '⏳ LIMIT'
                  : e.result === 'cancelled' ? 'ANULOWANE'
                  : (rd ? rd[1] : (e.result === 'manual' ? 'RYNEK' : String(e.result).toUpperCase())) + ' ' + ((e.r || 0) > 0 ? '+' : '') + (e.r || 0) + 'R'}
              </span>
            </div>
            {isExp && (
              <div style={{borderBottom:'1px solid var(--border)', background:'rgba(4,24,29,.4)'}}>
                <MiniLiveChart entry={e} />
                {e.result === 'open' && (
                  <div style={{padding:'0 12px 12px', display:'flex', gap:8}}>
                    <button className="chip mono sel" style={{flex:1, justifyContent:'center', color:'var(--down)'}}
                      onClick={ev => { ev.stopPropagation(); setPick(e); }}>Zamknij ręcznie</button>
                  </div>
                )}
                {e.result !== 'open' && e.coach && (
                  <div style={{padding:'2px 14px 14px'}}>
                    <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                      <span style={{fontWeight:900, fontSize:12, letterSpacing:.5, color:'var(--dim)'}}>TRENER</span>
                      <span className="mono" style={{
                        padding:'2px 8px', borderRadius:7, fontWeight:800, fontSize:12,
                        background: e.coach.grade === 'A' ? 'rgba(47,214,174,.16)' : e.coach.grade === 'C' ? 'rgba(255,107,94,.16)' : 'rgba(255,201,77,.14)',
                        color: e.coach.grade === 'A' ? 'var(--up)' : e.coach.grade === 'C' ? 'var(--down)' : 'var(--ema9)',
                      }}>{e.coach.grade} · {e.coach.result}</span>
                    </div>
                    <div style={{fontSize:13, lineHeight:1.5, color:'var(--text)', marginBottom: e.coach.flags.length ? 8 : 0}}>
                      <span style={{color:'var(--accent)', fontWeight:700}}>Do poprawy: </span>{e.coach.focus}
                    </div>
                    {e.coach.flags.map((f, fi) => (
                      <div key={fi} style={{fontSize:12.5, lineHeight:1.5, color:'var(--down)', marginTop:4}}>⚠ {f.txt}</div>
                    ))}
                    {e.coach.notes.map((nt, ni) => (
                      <div key={ni} style={{fontSize:12.5, lineHeight:1.5, color:'var(--dim)', marginTop:4}}>• {nt}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </React.Fragment>
          );
        })}
        {!journal.length && (
          <div style={{padding:'36px 24px', textAlign:'center', color:'var(--dim2)', lineHeight:1.7, fontSize:13}}>
            Dziennik jest pusty. Otwórz pozycję paper z ekranu wykresu
            (▶ z sygnału, KUP/SPRZEDAJ albo bot 🤖), a tutaj tapniesz ją,
            by zobaczyć wykres LIVE z liniami SL/TP — pozycja zamknie się
            sama po dotknięciu poziomu i zostanie podgląd, co się wydarzyło.
          </div>
        )}
      </div>

      {pick && (
        <div className="modal-bg" onClick={() => setPick(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{fontWeight:900, fontSize:16, marginBottom:4}}>
              Zamknij: {pick.sym} {pick.dir > 0 ? 'LONG' : 'SHORT'}
            </div>
            <div style={{fontSize:12, color:'var(--dim2)', marginBottom:12}} className="mono">
              plan z {fmtDT(pick.ts)}{pick.entry != null ? ' · E ' + fmtPrice(pick.entry) : ''}
            </div>
            {(() => {
              const px = q[pick.sym];
              const fl = paperFloating(pick, px);
              if(px == null || fl == null){
                return <div style={{fontSize:12, color:'var(--dim2)', marginBottom:10}}>Pobieram żywą cenę… (odśwież strzałką u góry)</div>;
              }
              return (
                <button className="chip sel mono"
                  style={{width:'100%', justifyContent:'center', padding:'12px', marginBottom:10, fontSize:14,
                    color: fl >= 0 ? 'var(--up)' : 'var(--down)'}}
                  onClick={() => {
                    setJournal(list => list.map(x => x.id === pick.id
                      ? { ...x, result:'manual', r: fl, exit:px, exitTs:Date.now() }
                      : x));
                    setPick(null);
                  }}>
                  Zamknij po rynku {fmtPrice(px)} · {(fl > 0 ? '+' : '') + fl}R
                </button>
              );
            })()}
            <div style={{fontSize:11, color:'var(--dim2)', marginBottom:8}}>albo oznacz ręcznie:</div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              {RESULT_DEF.map(rd => (
                <button key={rd[0]} className="chip mono sel"
                  style={{color:rd[3], flex:1, justifyContent:'center', padding:'11px 0'}}
                  onClick={() => closeEntry(pick.id, rd[0])}>
                  {rd[1]} {rd[2] > 0 ? '+' : ''}{(rd[0] === 'tp1' && pick.rr1) ? pick.rr1 : rd[2]}R
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="modal-bg" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{fontWeight:900, fontSize:16, marginBottom:10}}>Ręczny wpis</div>
            <div style={{display:'flex', gap:8, marginBottom:10}}>
              <button className={'chip mono' + (mDir === 1 ? ' sel' : ' off')} style={{color:'var(--up)'}} onClick={() => setMDir(1)}>LONG</button>
              <button className={'chip mono' + (mDir === -1 ? ' sel' : ' off')} style={{color:'var(--down)'}} onClick={() => setMDir(-1)}>SHORT</button>
            </div>
            <div className="searchbox" style={{marginBottom:10}}>
              <input value={mSym} onChange={e => setMSym(e.target.value)} placeholder="Symbol (np. DE40)" />
            </div>
            <div style={{display:'flex', gap:8, marginBottom:10}}>
              {RESULT_DEF.map(rd => (
                <button key={rd[0]} className={'chip mono' + (mRes === rd[0] ? ' sel' : ' off')}
                  style={{color:rd[3], flex:1, justifyContent:'center'}}
                  onClick={() => setMRes(rd[0])}>{rd[1]}</button>
              ))}
            </div>
            <div className="searchbox" style={{marginBottom:12}}>
              <input value={mNote} onChange={e => setMNote(e.target.value)} placeholder="Notatka (opcjonalnie)" />
            </div>
            <button className="chip sel mono" style={{width:'100%', justifyContent:'center', padding:'12px', fontSize:14}}
              onClick={addManual}>Zapisz wpis</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================== [5d] EKRAN: INFO ========================== */
