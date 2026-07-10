import React, { useState, useEffect, useRef } from 'react';
import { IC, Ic } from './components/icons.jsx';
import { DEFAULT_PREFS, DEFAULT_SMC, DEFAULT_WL } from './constants/defaults.js';
import { Bus } from './core/bus.js';
import { Store } from './core/store.js';
import { CAP_MAP, CapCfg, CapSess, capEnabled, capitalTick, setCapWarned } from './data/capital.js';
import { fetchQuotes } from './data/feed.js';
import { resolvePaperList } from './data/paper.js';
import { TFS } from './data/yahoo.js';
import { ChartScreen } from './screens/ChartScreen.jsx';
import { InfoScreen } from './screens/InfoScreen.jsx';
import { JournalScreen } from './screens/JournalScreen.jsx';
import { WatchlistScreen } from './screens/WatchlistScreen.jsx';
import { analyzeSymbol } from './signals/engine.js';
import { fmtPrice } from './utils/format.js';
import { notifyUser } from './utils/notify.js';

export class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state = { err:null }; }
  static getDerivedStateFromError(e){ return { err:e }; }
  render(){
    if(this.state.err){
      return (
        <div style={{padding:'60px 26px', textAlign:'center'}}>
          <div style={{fontWeight:900, fontSize:18, marginBottom:8}}>Ups — błąd aplikacji</div>
          <div style={{color:'var(--dim)', fontSize:13, marginBottom:18}}>{String(this.state.err && this.state.err.message || this.state.err)}</div>
          <button className="chip sel" onClick={() => location.reload()}>Uruchom ponownie</button>
        </div>
      );
    }
    return this.props.children;
  }
}


export function App(){
  const [wl, setWlState] = useState(() => Store.get('rt_wl_v1', DEFAULT_WL));
  const [prefs, setPrefsState] = useState(() => {
    const p = Store.get('rt_prefs_v1', DEFAULT_PREFS);
    return {
      ...DEFAULT_PREFS, ...p,
      emaVis:{ ...DEFAULT_PREFS.emaVis, ...(p.emaVis || {}) },
      ind:{
        ...DEFAULT_PREFS.ind,
        ...((p && p.ind) || {}),
        panels: (p && p.ind && p.ind.panels) ? p.ind.panels : DEFAULT_PREFS.ind.panels.slice(),
      },
      smc:{ ...DEFAULT_SMC, ...((p && p.smc) || {}) },
    };
  });
  const [ai, setAiRaw] = useState(() => Object.assign({ provider:'claude', keyClaude:'', keyGemini:'', news:true }, Store.get('rt_ai_v1', {})));
  const [active, setActive] = useState(() => Store.get('rt_last', null));
  const [screen, setScreen] = useState(() => Store.get('rt_last', null) ? 'chart' : 'list');
  const [toast, setToast] = useState(null);

  useEffect(() => { Store.set('rt_wl_v1', wl); }, [wl]);
  useEffect(() => { Store.set('rt_prefs_v1', prefs); }, [prefs]);
  useEffect(() => { Store.set('rt_ai_v1', ai); }, [ai]);
  const [journal, setJournal] = useState(() => Store.get('rt_journal_v1', []));
  useEffect(() => { Store.set('rt_journal_v1', journal); }, [journal]);
  const [cap, setCap] = useState(() => Object.assign({ on:false, demo:false, key:'', id:'', pass:'' }, Store.get('rt_cap_v1', {})));
  useEffect(() => {
    Store.set('rt_cap_v1', cap);
    Object.assign(CapCfg, cap);
    CapSess.cst = null; CapSess.at = 0; CapSess.acctSet = false;
    setCapWarned(false);
  }, [cap]);
  useEffect(() => {
    Bus.fn = (m) => {
      setToast(m);
      setTimeout(() => setToast(null), 2800);
    };
    return () => { Bus.fn = null; };
  }, []);

  const setWl = (fn) => setWlState(fn);
  const setPrefs = (fn) => setPrefsState(fn);
  const setAi = (fn) => setAiRaw(fn);
  const addJournal = (e) => setJournal(list => [e, ...list]);
  const paperNote = (e) => {
    const msg = 'PAPER ' + e.sym + ' ' + (e.dir > 0 ? 'LONG' : 'SHORT') + ': ' + String(e.result).toUpperCase()
      + ' ' + (e.r > 0 ? '+' : '') + e.r + 'R @ ' + fmtPrice(e.exit);
    Bus.show('📒 ' + msg);
    notifyUser('Rikipo Paper', msg);
  };
  const resolveTick = (sym, px) => setJournal(list => resolvePaperList(list, sym, px, paperNote) || list);

  /* monitor otwartych pozycji paper (co 15 s, także poza aktywnym wykresem) */
  useEffect(() => {
    const h = setInterval(async () => {
      const openP = journal.filter(e => e.paper && e.result === 'open');
      if(!openP.length) return;
      const syms = Array.from(new Set(openP.map(e => e.sym)));
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
        if(px != null) resolveTick(sym, px);
      }
    }, 15000);
    return () => clearInterval(h);
  }, [journal]);

  /* ---- GLOBALNY SKANER WATCHLISTY W TLE ----
     skanuje całą listę na wybranym TF co ~45 s, alarmuje o nowych sygnałach
     nawet gdy ekran instrumentu nie jest otwarty. Dedup + cooldown per symbol.
     Pomija symbol aktualnie otwarty na wykresie (tamten ekran ma własny alert). */
  const bgAlertRef = useRef({});
  const bgPbRef = useRef({});
  const bgMacroRef = useRef(null);
  const bgBusyRef = useRef(false);
  useEffect(() => {
    if(!prefs.bgScan || !prefs.alert) return;
    const tfObj = TFS.find(t => t.id === prefs.tf) || TFS[1];
    const runScan = async () => {
      if(bgBusyRef.current) return;
      bgBusyRef.current = true;
      try{
        const activeSym = (screen === 'chart' && active) ? active.sym : null;
        for(let s=0;s<wl.length;s++){
          const it = wl[s];
          if(!it || it.sym === activeSym) continue;
          let res = null;
          try{ res = await analyzeSymbol(it.sym, tfObj, prefs.source, prefs.minScore, prefs.waitPullback, prefs.smc); }catch(e){ continue; }
          const sig = res && res.signal;
          if(!sig) continue;

          /* powiadomienie o otwarciu okna makro (raz na okno, bez blokady wejść) */
          if(sig.macroWindow){
            if(bgMacroRef.current !== sig.macroWindow){
              bgMacroRef.current = sig.macroWindow;
              notifyUser('Rikipo Trader — okno makro', 'Otwiera się: ' + sig.macroWindow + ' — podwyższona zmienność. Wejścia niezablokowane, uważaj.');
              Bus.show('⏰ Okno makro: ' + sig.macroWindow);
            }
          } else if(bgMacroRef.current !== null){
            bgMacroRef.current = null;
          }

          /* alert okazji: dobra sytuacja się formuje / cena zbliża się do strefy
             (działa nawet gdy nie ma teraz aktywnego sygnału LONG/SHORT) */
          if(prefs.pbAlert !== false && sig.opportunities && sig.opportunities.length){
            const op = sig.opportunities.find(o => o.kind !== 'signal-now'
              && o.grade !== 'D' && (o.state === 'approaching' || o.state === 'in_zone'));
            if(op){
              const key = op.kind + '|' + op.dir + '|' + op.state + '|' + fmtPrice(op.entry);
              const pst = bgPbRef.current[it.sym];
              if(!(pst && pst.key === key && (Date.now() - pst.t) < 12*60*1000)){
                bgPbRef.current[it.sym] = { key, t: Date.now() };
                const pdir = op.dir > 0 ? 'LONG' : 'SHORT';
                const head = (op.state === 'in_zone' ? '🎯 ' : '👀 ') + it.sym + ' — ' + op.title + ' (' + pdir + ')';
                const extra = (op.target != null ? ' · cel ' + fmtPrice(op.target) : '') + (op.rr != null ? ' · RR ' + op.rr : '');
                notifyUser(head, 'Wejście ~' + fmtPrice(op.entry) + ' · pewność ' + op.confidence + '% [' + op.grade + ']' + extra);
                Bus.show('[skaner] ' + head);
                await new Promise(r => setTimeout(r, 300));
              }
            }
          }

          if(sig.dir === 0) continue;
          if(prefs.onlyStrong && !sig.strong) continue;
          if(prefs.waitPullback && sig.entryQuality && sig.entryQuality.chase && !sig.strong) continue;
          const st = bgAlertRef.current[it.sym] || { dir:0, t:0, bar:null };
          const nowMs = Date.now();
          const sameDir = st.dir === sig.dir;
          const sameBar = st.bar === sig.t;
          const tooSoon = (nowMs - st.t) < 5*60*1000;
          if(sameDir && (sameBar || tooSoon)) continue;
          bgAlertRef.current[it.sym] = { dir:sig.dir, t:nowMs, bar:sig.t };
          const dtxt = sig.dir > 0 ? 'LONG' : 'SHORT';
          const strong = !!sig.strong;
          const htfTag = sig.htfDir && sig.htfDir === sig.dir ? ' ✓HTF' : '';
          const eq = sig.entryQuality;
          const eqTag = eq ? (eq.good ? ' ✓przy strefie' : eq.chase ? ' ⚠gonienie' : '') : '';
          const msg = (strong ? '★ ' : '') + it.sym + ' ' + tfObj.label + ': ' + dtxt
            + ' (' + (sig.score > 0 ? '+' : '') + sig.score + htfTag + eqTag + ')'
            + (sig.levels ? ' · SL ' + fmtPrice(sig.levels.sl) + ' · TP1 ' + fmtPrice(sig.levels.tp1) : '');
          notifyUser('Rikipo Trader — ' + (strong ? 'MOCNY ' : '') + dtxt + ' ' + it.sym, msg);
          Bus.show((strong ? '🔥 ' : '⚡ ') + '[skaner] ' + msg);
          await new Promise(r => setTimeout(r, 400)); /* łagodzimy tempo zapytań */
        }
      } finally {
        bgBusyRef.current = false;
      }
    };
    const first = setTimeout(runScan, 4000);
    const h = setInterval(runScan, 45000);
    return () => { clearTimeout(first); clearInterval(h); };
  }, [prefs.bgScan, prefs.alert, prefs.pbAlert, prefs.tf, prefs.source, prefs.onlyStrong, prefs.waitPullback, prefs.minScore, wl, screen, active]);

  const openChart = (item) => {
    setActive(item);
    Store.set('rt_last', item);
    setScreen('chart');
  };
  const goChartTab = () => {
    const it = active || wl[0];
    if(!it){ Bus.show('Najpierw dodaj instrument do listy'); return; }
    openChart(it);
  };

  return (
    <div className="app">
      {screen === 'list' && <WatchlistScreen wl={wl} setWl={setWl} openChart={openChart} prefs={prefs} setPrefs={setPrefs} />}
      {screen === 'chart' && active && (
        <ChartScreen item={active} onBack={() => setScreen('list')} prefs={prefs} setPrefs={setPrefs} ai={ai} setAi={setAi} addJournal={addJournal} journal={journal} resolveTick={resolveTick} />
      )}
      {screen === 'journal' && <JournalScreen journal={journal} setJournal={setJournal} />}
      {screen === 'info' && <InfoScreen prefs={prefs} setPrefs={setPrefs} ai={ai} setAi={setAi} cap={cap} setCap={setCap} wl={wl} setWl={setWl} journal={journal} setJournal={setJournal} />}

      <div className="nav">
        <button className={screen === 'list' ? 'sel' : ''} onClick={() => setScreen('list')}>
          <Ic d={IC.rows} size={21} />RYNKI
        </button>
        <button className={screen === 'chart' ? 'sel' : ''} onClick={goChartTab}>
          <Ic d={IC.candle} size={21} />WYKRES
        </button>
        <button className={screen === 'journal' ? 'sel' : ''} onClick={() => setScreen('journal')}>
          <Ic d={IC.book} size={21} />DZIENNIK
        </button>
        <button className={screen === 'info' ? 'sel' : ''} onClick={() => setScreen('info')}>
          <Ic d={IC.info} size={21} extra={<circle cx="12" cy="12" r="9" />} />INFO
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
