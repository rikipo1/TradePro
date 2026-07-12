import React, { useState, useEffect, useCallback } from 'react';
import { IC, Ic } from '../components/icons.jsx';
import { MiniLiveChart } from '../components/MiniLiveChart.jsx';
import { Bus } from '../core/bus.js';
import { CAP_MAP, capEnabled, capitalTick } from '../data/capital.js';
import { fetchQuotes } from '../data/feed.js';
import { paperFloating, resolvePaperList } from '../data/paper.js';
import { riskStatus } from '../signals/riskEngine.js';
import { fmtPips, signedPips, toPips } from '../constants/instruments.js';
import { fmtPrice, pad2 } from '../utils/format.js';
import { notifyUser } from '../utils/notify.js';

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
export function JournalScreen({ journal, setJournal, prefs }){
  /* [M5] badge stanu ryzyka konta: dzienne R, seria strat, kill-switch */
  const risk = riskStatus(journal, { maxDailyLossR: (prefs && prefs.maxDailyLossR) != null ? prefs.maxDailyLossR : 3,
    maxConsecLoss: (prefs && prefs.maxConsecLoss) != null ? prefs.maxConsecLoss : 4 });
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

  /* statystyki tylko z ROZSTRZYGNIĘTYCH transakcji — pending/cancelled
     (zlecenia limit) nie są transakcjami i nie mogą zaniżać średnich */
  const closed = journal.filter(e => e.result !== 'open' && e.result !== 'pending' && e.result !== 'cancelled');
  const wins = closed.filter(e => (e.r || 0) > 0.2).length;
  const losses = closed.filter(e => (e.r || 0) < -0.2).length;
  const sumR = closed.reduce((a, e) => a + (e.r || 0), 0);
  const grossW = closed.reduce((a, e) => a + ((e.r || 0) > 0 ? e.r : 0), 0);
  const grossL = closed.reduce((a, e) => a + ((e.r || 0) < 0 ? -e.r : 0), 0);
  const openN = journal.filter(e => e.result === 'open' || e.result === 'pending').length;

  /* powiadomienie o aktywacji LIMITU / zamknięciu pozycji z poziomu dziennika */
  const journalNote = useCallback((e) => {
    let msg;
    if(e.result === 'open') msg = e.sym + ' ' + (e.dir > 0 ? 'LONG' : 'SHORT') + ': LIMIT aktywowany @ ' + fmtPrice(e.entry);
    else if(e.result === 'cancelled') msg = e.sym + ': zlecenie LIMIT anulowane';
    else msg = e.sym + ' ' + (e.dir > 0 ? 'LONG' : 'SHORT') + ': ' + String(e.result).toUpperCase()
      + ' ' + ((e.r || 0) > 0 ? '+' : '') + (e.r || 0) + 'R';
    Bus.show('📒 ' + msg);
    try{ notifyUser('Rikipo Paper', msg); }catch(err){}
  }, []);

  /* [fix] AKTYWNE rozliczanie z poziomu dziennika: pobieramy cenę dla otwartych
     ORAZ oczekujących (pending) pozycji i wołamy resolvePaperList — dzięki temu
     zlecenia LIMIT aktywują się, a otwarte pozycje domykają się na SL/TP, także
     gdy patrzysz na dziennik (nie tylko z 15 s monitora globalnego). */
  const loadPx = useCallback(async () => {
    const active = journal.filter(e => e.paper && (e.result === 'open' || e.result === 'pending'));
    if(!active.length){ setQ({}); return; }
    setBusyPx(true);
    const syms = Array.from(new Set(active.map(e => e.sym)));
    const out = {};
    for(let s=0;s<syms.length;s++){
      const sym = syms[s];
      let px = null;
      try{
        if(capEnabled() && CAP_MAP[sym]){
          const t = await capitalTick(sym);
          if(t) px = t.px;
        }
      }catch(e){}
      if(px == null){
        try{
          const r = await fetchQuotes([sym]);
          if(r && r[sym] && r[sym].price != null) px = r[sym].price;
        }catch(e){}
      }
      if(px != null){
        out[sym] = px;
        setJournal(list => resolvePaperList(list, sym, px, journalNote) || list);
      }
    }
    setQ(out);
    setBusyPx(false);
  }, [journal, journalNote, setJournal]);
  useEffect(() => { loadPx(); }, [loadPx]);
  /* auto-odświeżanie co 10 s, dopóki są otwarte/oczekujące pozycje */
  useEffect(() => {
    if(!openN) return;
    const h = setInterval(() => { if(typeof document === 'undefined' || document.visibilityState === 'visible') loadPx(); }, 10000);
    return () => clearInterval(h);
  }, [openN, loadPx]);

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
        <button className="iconbtn" onClick={loadPx}>
          <span className={busyPx ? 'spin' : ''} style={{display:'flex'}}><Ic d={IC.refresh} size={18} /></span>
        </button>
        <button className={'iconbtn' + (edit ? ' on' : '')} onClick={() => setEdit(x => !x)}>
          <Ic d={edit ? IC.check : IC.edit} size={18} />
        </button>
        <button className="iconbtn accent" onClick={() => setShowAdd(true)}><Ic d={IC.plus} size={19} /></button>
      </div>

      {/* [M5] badge ryzyka konta */}
      <div className="card" style={{marginTop:2, borderColor: risk.blocked ? 'var(--down)' : undefined, background: risk.blocked ? 'rgba(255,107,94,.08)' : undefined}}>
        <div className="kv"><b>{risk.blocked ? '⛔ Stop dnia AKTYWNY' : '🛡 Ryzyko konta'}</b>
          <span className="mono" style={{color: risk.blocked ? 'var(--down)' : 'var(--dim)'}}>
            dziś {risk.dailyR >= 0 ? '+' : ''}{risk.dailyR}R · seria {risk.consecLosses}
          </span></div>
        {risk.blocked && <div className="mono" style={{fontSize:11, color:'var(--down)'}}>{risk.reason} — nowe wejścia zablokowane (wyjścia działają)</div>}
      </div>

      <div className="card" style={{marginTop:2}}>
        <div className="kv"><b>Zamknięte transakcje</b><span className="mono">{closed.length}{openN ? ' · ' + openN + ' w trakcie' : ''}</span></div>
        <div className="kv"><b>Trafność</b><span className="mono" style={{color: wins >= losses ? 'var(--up)' : 'var(--down)'}}>{(wins + losses) ? (wins/(wins+losses)*100).toFixed(0) + '%' : '—'}</span></div>
        <div className="kv"><b>Suma R</b><span className="mono" style={{color: sumR >= 0 ? 'var(--up)' : 'var(--down)'}}>{(sumR >= 0 ? '+' : '') + sumR.toFixed(2) + ' R'}</span></div>
        <div className="kv"><b>Średnia R / trade</b><span className="mono">{closed.length ? (sumR/closed.length).toFixed(2) : '—'}</span></div>
        <div className="kv"><b>Profit factor</b><span className="mono">{grossL > 0 ? (grossW/grossL).toFixed(2) : (grossW > 0 ? '∞' : '—')}</span></div>
      </div>

      <div className="section-label">Wpisy · {journal.length}</div>
      <div>
        {journal.map(e => {
          const rd = resultOf(e.result);
          const isExp = expanded === e.id;
          /* pipsy P/L: pływające (otwarta) lub zrealizowane (zamknięta) */
          const plRef = e.result === 'open' ? q[e.sym] : e.exit;
          const plDist = (plRef != null && e.entry != null) ? (plRef - e.entry) * (e.dir || 1) : null;
          const plPipsN = plDist != null ? toPips(e.sym, plDist) : null;
          const plPips = plPipsN != null ? ((plDist >= 0 ? '+' : '−') + plPipsN + 'p') : null;
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
                  {e.entry != null ? ' · wejście ' + fmtPrice(e.entry) : ''}
                  {e.note ? ' · ' + e.note : ''}
                </div>
                {/* PIPSY (widoczne, bez ucinania): wejście=0, SL/TP jako offset + P/L */}
                {e.entry != null && e.sl != null && (
                  <div className="mono" style={{fontSize:11, marginTop:2, display:'flex', gap:8, flexWrap:'wrap'}}>
                    <span style={{color:'var(--dim2)'}}>0</span>
                    <span style={{color:'var(--down)', fontWeight:700}}>SL {signedPips(e.sym, e.sl - e.entry)}</span>
                    {e.tp1 != null && <span style={{color:'var(--up)', fontWeight:700}}>TP1 {signedPips(e.sym, e.tp1 - e.entry)}</span>}
                    {e.tp2 != null && <span style={{color:'var(--up)', fontWeight:600}}>TP2 {signedPips(e.sym, e.tp2 - e.entry)}</span>}
                    {plPips && <span style={{color: plDist >= 0 ? 'var(--up)' : 'var(--down)', fontWeight:800}}>· P/L {plPips}</span>}
                  </div>
                )}
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
