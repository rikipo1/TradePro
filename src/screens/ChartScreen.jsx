import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { aiPrompt, buildAiContext, callClaude, callGemini, tolerantJson } from '../ai/index.js';
import { backtestEngine, walkForwardKFold } from '../backtest/engine.js';
import { riskStatus } from '../signals/riskEngine.js';
import { Store } from '../core/store.js';
import { ChartCanvas } from '../components/ChartCanvas.jsx';
import { EquityLine } from '../components/EquityLine.jsx';
import { IC, Ic } from '../components/icons.jsx';
import { Bus } from '../core/bus.js';
import { Net } from '../core/net.js';
import { CAP_MAP, capEnabled, capResolveEpic, capWsStart, capWsStop, capitalTick } from '../data/capital.js';
import { TF_SEC, getChart, htfTrend } from '../data/feed.js';
import { TFS } from '../data/yahoo.js';
import { EMA_DEFS, adxSeries, atrSeries, bollSeries, emaSeries, findSRZones, macdSeries, obvSeries, rsiSeries, stochSeries, vwapSeries } from '../indicators/index.js';
import { detectPatterns } from '../patterns/index.js';
import { computeSignal } from '../signals/engine.js';
import { displacement } from '../smc/index.js';
import { fmtClock, fmtFull, fmtPct, fmtPrice, fmtVol } from '../utils/format.js';
import { notifyUser } from '../utils/notify.js';

export function ChartScreen({ item, onBack, prefs, setPrefs, ai, setAi, addJournal, journal, resolveTick }){
  const tf = TFS.find(t => t.id === prefs.tf) || TFS[1];
  const [data, setData] = useState({ candles:[], price:null, prev:null, demo:false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [updated, setUpdated] = useState(null);
  const [showPat, setShowPat] = useState(false);
  const [showSig, setShowSig] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [aiState, setAiState] = useState({ busy:false, res:null, err:null, at:null, provider:null });
  const [showBt, setShowBt] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [bt, setBt] = useState({ busy:false, res:null });
  const [wv, setWv] = useState(0); // wersja wag modelu (bump po treningu → recompute)
  const prevDirRef = useRef(0);
  const lastAlertRef = useRef({ dir:0, t:0, bar:null });
  const pbAlertRef = useRef({ key:null, t:0 });
  const macroRef = useRef(null);
  const [focus, setFocus] = useState(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqRef.current;
    const stale = () => !aliveRef.current || myReq !== reqRef.current;
    setLoading(true);
    try{
      const r = await getChart(item.sym, tf, prefs.source);
      if(stale()) return;
      setData({ candles:r.candles, price:r.price, prev:r.prev, demo:!!r.demo, live:!!r.live, sym:item.sym });
      setError(null);
      setUpdated(new Date());
    }catch(e){
      if(stale()) return;
      setError(e.message || 'Błąd pobierania');
    }
    if(!stale()) setLoading(false);
  }, [item.sym, tf.id, prefs.source]);

  useEffect(() => { setData({ candles:[], price:null, prev:null, demo:false, sym:item.sym }); setError(null); setFocus(null); setAiState({ busy:false, res:null, err:null, at:null, provider:null }); setBt({ busy:false, res:null }); prevDirRef.current = 0; load(); }, [load]);

  /* skróty klawiszowe (podgląd desktop): R = odśwież, A = przełącz AUTO */
  useEffect(() => {
    const onKey = (e) => {
      if(e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = (e.key || '').toLowerCase();
      if(k === 'r'){ Net.blockedUntil = 0; load(); Bus.show('Odświeżono (R)'); }
      else if(k === 'a'){ setPrefs(p => ({ ...p, auto:!p.auto })); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load]);

  /* auto-odświeżanie co 15 s */
  useEffect(() => {
    if(!prefs.auto) return;
    const h = setInterval(() => {
      if(document.visibilityState === 'visible') load();
    }, 15000);
    return () => clearInterval(h);
  }, [prefs.auto, load]);

  /* Capital.com LIVE: WebSocket (płynny stream) + poll 3 s jako zapas */
  useEffect(() => {
    if(!prefs.auto) return;
    if(!CAP_MAP[item.sym]) return;
    let pollH = null;
    let stopped = false;
    const mySym = item.sym;          /* symbol tego strumienia */
    const myTf = tf.id;
    const pending = { px:null };
    const applyTick = (px) => {
      /* odrzuć tick, jeśli efekt/symbol/interwał już się zmienił —
         inaczej stara ramka „w locie" dokleja się do świec nowego symbolu */
      if(stopped || !aliveRef.current) return;
      if(item.sym !== mySym || tf.id !== myTf) return;
      setData(d => {
        if(!d.candles.length || d.demo || d.sym !== mySym) return d;
        /* SANITY: odrzuć tick oderwany od świec (>12% od ostatniego close) —
           to prawie na pewno cena z innego instrumentu (wyciek strumienia),
           a nie realny ruch. Chroni wykres przed pionowym „skokiem". */
        const ref = d.candles[d.candles.length-1].c;
        if(ref && Math.abs(px - ref) / ref > 0.12) return d;
        const cs = d.candles.slice();
        let last = Object.assign({}, cs[cs.length-1]);
        const step = TF_SEC[tf.id] || 300;
        const bStart = Math.floor(Date.now()/1000/step)*step;
        if(tf.id !== 'D1' && last.t < bStart){
          last = { t:bStart, o:px, h:px, l:px, c:px, v:0 };
          cs.push(last);
          if(cs.length > 900) cs.shift();
        } else {
          last.c = px;
          if(px > last.h) last.h = px;
          if(px < last.l) last.l = px;
          cs[cs.length-1] = last;
        }
        return Object.assign({}, d, { candles:cs, price:px, live:true });
      });
      setUpdated(new Date());
      resolveTick(item.sym, px);
    };
    const flushH = setInterval(() => {
      if(pending.px == null) return;
      const px = pending.px;
      pending.px = null;
      applyTick(px);
    }, 180);
    const onQuote = px => {
      if(stopped || item.sym !== mySym) return;
      pending.px = px; Net.last = 'Capital LIVE · stream';
    };
    const startPoll = () => {
      if(pollH) return;
      pollH = setInterval(async () => {
        if(document.visibilityState !== 'visible' || !capEnabled()) return;
        if(stopped || item.sym !== mySym) return;
        try{
          const t = await capitalTick(mySym);
          if(t && !stopped && item.sym === mySym){ pending.px = t.px; Net.last = 'Capital LIVE · poll 3s'; }
        }catch(e){}
      }, 3000);
    };
    if(capEnabled()){
      capResolveEpic(item.sym).then(epic => {
        if(stopped || !epic) { startPoll(); return; }
        capWsStart(epic, onQuote, ok => {
          if(ok){ if(pollH){ clearInterval(pollH); pollH = null; } }
          else startPoll();
        });
      }).catch(() => { if(!stopped) startPoll(); });
    }
    return () => {
      stopped = true;
      clearInterval(flushH);
      if(pollH) clearInterval(pollH);
      capWsStop();
    };
  }, [prefs.auto, item.sym, tf.id]);

  /* świece obowiązują tylko dla aktualnego symbolu — chroni przed
     mignięciem wykresu poprzedniego instrumentu w jednym renderze po przełączeniu */
  const candlesSafe = (data.sym === item.sym) ? data.candles : [];
  const closes = useMemo(() => candlesSafe.map(c => c.c), [candlesSafe]);
  const emaData = useMemo(() => {
    const out = {};
    for(let i=0;i<EMA_DEFS.length;i++){
      out[EMA_DEFS[i].n] = emaSeries(closes, EMA_DEFS[i].n);
    }
    return out;
  }, [closes]);
  const hasVol = useMemo(() => candlesSafe.some(c => c.v > 0), [candlesSafe]);

  /* Faza 2: pakiet wskaźników */
  const ind = useMemo(() => {
    const cs = candlesSafe;
    if(cs.length < 5) return null;
    const closesI = cs.map(c => c.c);
    const atr = atrSeries(cs, 14);
    let atrLast = null;
    for(let i=atr.length-1;i>=0;i--){ if(atr[i] != null){ atrLast = atr[i]; break; } }
    return {
      rsi: rsiSeries(closesI, 14),
      macd: macdSeries(closesI, 12, 26, 9),
      boll: bollSeries(closesI, 20, 2),
      stoch: stochSeries(cs, 14, 3, 3),
      adx: adxSeries(cs, 14),
      atr: atr,
      obv: hasVol ? obvSeries(cs) : null,
      vwap: (hasVol && tf.id !== 'D1') ? vwapSeries(cs) : null,
      sr: findSRZones(cs, atrLast),
    };
  }, [candlesSafe, hasVol, tf.id]);

  const iprefs = prefs.ind || { form:true, boll:false, vwap:false, sr:true, panels:['RSI'] };
  const overlays = useMemo(() => ({
    boll: (ind && iprefs.boll) ? ind.boll : null,
    vwap: (ind && iprefs.vwap) ? ind.vwap : null,
    sr:   (ind && iprefs.sr)   ? ind.sr   : null,
  }), [ind, iprefs.boll, iprefs.vwap, iprefs.sr]);

  const panels = useMemo(() => {
    if(!ind) return [];
    const list = [];
    (iprefs.panels || []).forEach(id => {
      if(id === 'RSI') list.push({ id, kind:'rsi', a:ind.rsi });
      else if(id === 'MACD') list.push({ id, kind:'macd', m:ind.macd.macd, s:ind.macd.signal, h:ind.macd.hist });
      else if(id === 'STOCH') list.push({ id, kind:'stoch', k:ind.stoch.k, d:ind.stoch.d });
      else if(id === 'ADX') list.push({ id, kind:'adx', adx:ind.adx.adx, pdi:ind.adx.pdi, mdi:ind.adx.mdi });
      else if(id === 'OBV' && ind.obv) list.push({ id, kind:'line', a:ind.obv, color:'#c792ff', fmt:(v) => (v < 0 ? '−' : '') + fmtVol(Math.abs(v)) });
      else if(id === 'ATR') list.push({ id, kind:'line', a:ind.atr, color:'#ffc94d' });
    });
    return list;
  }, [ind, iprefs.panels]);

  const toggleOverlay = key => {
    if(key === 'vwap'){
      if(tf.id === 'D1'){ Bus.show('VWAP działa na interwałach śróddziennych (M1–H1)'); return; }
      if(!hasVol){ Bus.show('VWAP wymaga wolumenu — ten instrument go nie podaje'); return; }
    }
    setPrefs(p => {
      const ip = p.ind || { form:true, boll:false, vwap:false, sr:true, panels:['RSI'] };
      return { ...p, ind:{ ...ip, [key]: !ip[key] } };
    });
  };
  const togglePanel = id => {
    if(id === 'OBV' && !hasVol){ Bus.show('OBV wymaga wolumenu — indeksy zwykle go nie podają'); return; }
    setPrefs(p => {
      const ip = p.ind || { form:true, boll:false, vwap:false, sr:true, panels:['RSI'] };
      const cur = ip.panels || [];
      let nx;
      if(cur.indexOf(id) !== -1){
        nx = cur.filter(x => x !== id);
      } else {
        nx = cur.concat([id]);
        if(nx.length > 2){
          nx = nx.slice(nx.length - 2);
          Bus.show('Maks. 2 panele naraz — najstarszy został wyłączony');
        }
      }
      return { ...p, ind:{ ...ip, panels:nx } };
    });
  };

  /* Faza 3: formacje */
  const patterns = useMemo(() => {
    if(!ind || candlesSafe.length < 20) return { list:[], markers:{}, geoDraw:[], patMap:{} };
    const r = detectPatterns(candlesSafe, ind.atr, emaData[20], hasVol);
    const patMap = {};
    r.list.forEach(p => { (patMap[p.i] = patMap[p.i] || []).push(p); });
    return { list:r.list, markers:r.markers, geoDraw:r.geoDraw, patMap };
  }, [ind, candlesSafe, emaData, hasVol]);
  const recentPat = useMemo(
    () => patterns.list.filter(p => p.i >= candlesSafe.length - 30).length,
    [patterns, candlesSafe.length]
  );

  /* Faza 4: sygnał confluence (z filtrem trendu wyższego interwału) */
  const signal = useMemo(() => {
    if(!ind || candlesSafe.length < 30) return null;
    const ht = htfTrend(candlesSafe, tf.id);
    const srWithHtf = (ind.sr || []).slice();
    srWithHtf.__htf = ht;
    srWithHtf.__minScore = (prefs.minScore != null ? prefs.minScore : 30);
    srWithHtf.__waitPullback = !!prefs.waitPullback;
    srWithHtf.__sym = item.sym;
    srWithHtf.__smc = prefs.smc || null;
    srWithHtf.__weights = Store.get('rt_model_weights', null);
    srWithHtf.__calib = Store.get('rt_model_calib', null);
    srWithHtf.__knn = Store.get('rt_knn_history', null);
    const mMeta = Store.get('rt_model_meta', null);
    srWithHtf.__reliable = !!(mMeta && mMeta.reliable); // [A3] parytet skaner↔wykres
    srWithHtf.__payout = mMeta ? (mMeta.payout || null) : null; // [A4] EV empiryczne
    if(prefs.minProb != null) srWithHtf.__minProb = prefs.minProb;
    return computeSignal(candlesSafe, ind, emaData, patterns, hasVol, null, srWithHtf);
  }, [ind, candlesSafe, emaData, patterns, hasVol, tf.id, prefs.minScore, prefs.minProb, prefs.waitPullback, prefs.smc, item.sym, wv]);
  /* najlepsza „okazja" poza samym aktywnym sygnałem (do paska i alertu) */
  const topOpp = useMemo(() => {
    const ops = signal && signal.opportunities;
    if(!ops || !ops.length) return null;
    return ops.find(o => o.kind !== 'signal-now') || null;
  }, [signal]);

  const sigLevels = useMemo(() => {
    const out = [];
    if(signal && signal.dir !== 0 && signal.levels){
      const L = signal.levels;
      out.push(
        { p: L.entry, label: 'ENTRY', color: '#cfe4e0' },
        { p: L.sl,    label: 'SL',    color: '#ff6b5e' },
        { p: L.tp1,   label: 'TP1',   color: '#2fd6ae' },
        { p: L.tp2,   label: 'TP2',   color: 'rgba(47,214,174,.65)' },
      );
    }
    const op = topOpp;
    if(op && op.state !== 'invalidated' && op.entry != null){
      if(op.zone){
        out.push(
          { p: op.zone.hi, label: '', color: 'rgba(255,201,77,.3)' },
          { p: op.zone.lo, label: '', color: 'rgba(255,201,77,.3)' },
        );
      }
      out.push({ p: op.entry, label: '⌖ ' + op.grade, color: '#ffc94d' });
    }
    return out.length ? out : null;
  }, [signal, topOpp]);

  /* powiadomienie, gdy cena zbliża się do strefy dobrej okazji */
  useEffect(() => {
    const op = topOpp;
    if(!op) return;
    if(prefs.pbAlert === false) return;
    if(op.grade === 'D') return;
    if(op.state !== 'approaching' && op.state !== 'in_zone') return;
    const key = op.kind + '|' + op.dir + '|' + op.state + '|' + fmtPrice(op.entry);
    const la = pbAlertRef.current;
    if(la.key === key && (Date.now() - la.t) < 10*60*1000) return;
    pbAlertRef.current = { key, t: Date.now() };
    const dtxt = op.dir > 0 ? 'LONG' : 'SHORT';
    const head = (op.state === 'in_zone' ? '🎯 ' : '👀 ') + item.sym + ' — ' + op.title + ' (' + dtxt + ')';
    const extra = (op.target != null ? ' · cel ' + fmtPrice(op.target) : '') + (op.rr != null ? ' · RR ' + op.rr : '');
    const msg = 'Wejście ~' + fmtPrice(op.entry) + ' · pewność ' + op.confidence + '% [' + op.grade + ']'
      + extra + (op.state === 'in_zone' ? ' — potwierdź reakcję' : '');
    if(prefs.alert !== false) notifyUser(head, msg);
    Bus.show(head);
  }, [signal, topOpp, prefs.pbAlert, prefs.alert, item.sym]);

  /* powiadomienie, gdy OTWIERA SIĘ okno makro (bez blokady wejść) */
  useEffect(() => {
    const mw = signal && signal.macroWindow;
    if(!mw){ macroRef.current = null; return; }
    if(macroRef.current === mw) return;
    macroRef.current = mw;
    if(prefs.alert !== false) notifyUser('Rikipo Trader — okno makro', 'Otwiera się: ' + mw + ' — podwyższona zmienność. Wejścia niezablokowane, uważaj na szarpnięcia.');
    Bus.show('⏰ Okno makro: ' + mw);
  }, [signal, prefs.alert]);

  /* Faza 5: druga opinia AI */
  const runAi = async () => {
    const provider = ai.provider || 'claude';
    const key = provider === 'gemini' ? ai.keyGemini : ai.keyClaude;
    if(!key){ Bus.show('Najpierw wklej klucz API: INFO → Analiza AI'); return; }
    if(!ind || !signal || candlesSafe.length < 30){ Bus.show('Poczekaj na dane wykresu'); return; }
    setAiState(s => ({ ...s, busy:true, err:null }));
    const ctx = buildAiContext(item, tf, candlesSafe, ind, emaData, patterns, signal, hasVol);
    try{
      let txt;
      try{
        txt = provider === 'gemini'
          ? await callGemini(key, aiPrompt(ctx, !!ai.news), !!ai.news)
          : await callClaude(key, aiPrompt(ctx, !!ai.news), !!ai.news);
      }catch(e1){
        if(ai.news){
          txt = provider === 'gemini'
            ? await callGemini(key, aiPrompt(ctx, false), false)
            : await callClaude(key, aiPrompt(ctx, false), false);
        } else {
          throw e1;
        }
      }
      const res = tolerantJson(txt);
      setAiState({ busy:false, res, err:null, at:new Date(), provider });
    }catch(e){
      let msg = e.message || 'Błąd AI';
      if(msg.indexOf('429') !== -1) msg = 'Limit zapytań u dostawcy (429) — odczekaj minutę i spróbuj ponownie.';
      else if(msg.indexOf('401') !== -1 || msg.indexOf('403') !== -1) msg = 'Klucz API odrzucony (401/403) — sprawdź klucz w INFO → Analiza AI.';
      else if(msg.indexOf('timeout') !== -1) msg = 'Przekroczono czas oczekiwania — to środowisko może blokować API dostawcy (w APK i Chrome zadziała).';
      setAiState(s => ({ ...s, busy:false, err:msg }));
    }
  };
  const aiKeySet = (ai.provider || 'claude') === 'gemini' ? !!ai.keyGemini : !!ai.keyClaude;
  const aiRes = aiState.res;
  const aiVerdict = aiRes ? String(aiRes.verdict || 'WAIT').toUpperCase() : null;
  const aiVerdictCol = aiVerdict === 'LONG' ? 'var(--up)' : aiVerdict === 'SHORT' ? 'var(--down)' : 'var(--dim)';
  const engineDirTxt = signal ? (signal.dir > 0 ? 'LONG' : signal.dir < 0 ? 'SHORT' : 'WAIT') : null;
  const aiAgree = aiRes ? (typeof aiRes.agree_with_engine === 'boolean' ? aiRes.agree_with_engine : (aiVerdict === engineDirTxt)) : null;
  const aiRisks = (aiRes && Array.isArray(aiRes.key_risks)) ? aiRes.key_risks.slice(0, 3) : [];

  /* paper trading — pomocnicy */
  const makePaper = (dir, entry, sl, tp1, tp2, srcTag, score, eq) => {
    const risk = Math.abs(entry - sl);
    return {
      id: Date.now(), ts: Date.now(), sym:item.sym, name:item.name, tf:tf.id,
      dir, entry, sl, tp1, tp2, risk,
      rr1: +(Math.abs(tp1 - entry) / Math.max(risk, 1e-9)).toFixed(2),
      result:'open', r:0, paper:true, src:(srcTag || 'manual'), score:(score != null ? score : null),
      entryQuality: eq || null,
    };
  };
  /* zlecenie LIMIT w strefę okazji (paper): czeka aż cena DOJDZIE do wejścia,
     kasuje się przy unieważnieniu struktury albo po 12 h */
  const armLimit = (op) => {
    if(!signal || signal.atr == null || op.entry == null) return;
    const dir = op.dir, entry = op.entry;
    let sl;
    if(op.kind === 'pullback' && signal.pullback && signal.pullback.invalidation != null) sl = signal.pullback.invalidation;
    else sl = dir === 1 ? entry - signal.atr*1.1 : entry + signal.atr*1.1;
    const risk = Math.abs(entry - sl);
    if(!(risk > 0)) return;
    const tp1 = op.target != null ? op.target : (dir === 1 ? entry + risk*1.6 : entry - risk*1.6);
    const tp2 = dir === 1 ? entry + risk*2.5 : entry - risk*2.5;
    addJournal({
      id: Date.now(), ts: Date.now(), sym:item.sym, name:item.name, tf:tf.id,
      dir, entry, sl, tp1, tp2, risk,
      rr1: +(Math.abs(tp1 - entry)/Math.max(risk, 1e-9)).toFixed(2),
      result:'pending', r:0, paper:true, src:'limit:' + op.kind,
      score: signal.setupScore != null ? signal.setupScore : null,
      pendingUntil: Date.now() + 12*3600*1000,
      note: op.title,
    });
    Bus.show('⏳ LIMIT ' + (dir > 0 ? 'LONG' : 'SHORT') + ' @ ' + fmtPrice(entry) + ' — czeka na dojście ceny (ważne 12 h)');
  };

  const openTicket = (dir) => {
    if(!candlesSafe.length){
      Bus.show('Poczekaj na dane');
      return;
    }
    const px = data.price != null ? data.price : candlesSafe[candlesSafe.length-1].c;
    let a = null;
    if(ind && ind.atr){
      for(let q=ind.atr.length-1;q>=0;q--){ if(ind.atr[q] != null){ a = ind.atr[q]; break; } }
    }
    if(!a) a = px * 0.004;
    let sl, tp1, tp2;
    if(signal && signal.dir === dir && signal.levels){
      sl = signal.levels.sl; tp1 = signal.levels.tp1; tp2 = signal.levels.tp2;
    } else {
      sl  = dir === 1 ? px - a*1.1  : px + a*1.1;
      tp1 = dir === 1 ? px + a*1.65 : px - a*1.65;
      tp2 = dir === 1 ? px + a*2.75 : px - a*2.75;
    }
    setTicket({ dir, entry:px, sl:fmtPrice(sl), tp1:fmtPrice(tp1), tp2:fmtPrice(tp2) });
  };

  /* Faza 6: alert przy nowym sygnale (przy włączonym AUTO) */
  useEffect(() => {
    if(!signal) return;
    const pd = prevDirRef.current;
    prevDirRef.current = signal.dir;
    if(signal.dir === 0 || signal.dir === pd) return;
    if(prefs.onlyStrong && !signal.strong) return;
    if(prefs.waitPullback && signal.entryQuality && signal.entryQuality.chase && !signal.strong) return;

    /* dedup + cooldown: nie powtarzaj tego samego kierunku, dopóki nie minie nowa świeca
       lub 5 min; chroni przed serią alertów gdy score piłuje wokół progu */
    const la = lastAlertRef.current;
    const nowMs = Date.now();
    const curBar = signal.t;
    const sameDir = la.dir === signal.dir;
    const sameBar = la.bar === curBar;
    const tooSoon = (nowMs - la.t) < 5*60*1000;
    if(sameDir && (sameBar || tooSoon)) return;
    lastAlertRef.current = { dir:signal.dir, t:nowMs, bar:curBar };

    const dtxt = signal.dir > 0 ? 'LONG' : 'SHORT';
    const strong = !!signal.strong;
    const htfTag = signal.htfDir && signal.htfDir === signal.dir ? ' ✓HTF' : '';
    const eq = signal.entryQuality;
    const eqTag = eq ? (eq.good ? ' ✓przy strefie' : eq.chase ? ' ⚠gonienie' : '') : '';
    const msg = (strong ? '★ ' : '') + item.sym + ' ' + tf.label + ': ' + dtxt
      + ' (' + (signal.score > 0 ? '+' : '') + signal.score + htfTag + eqTag + ')'
      + (signal.levels ? ' · SL ' + fmtPrice(signal.levels.sl) + ' · TP1 ' + fmtPrice(signal.levels.tp1) : '');
    if(prefs.alert){
      notifyUser('Rikipo Trader — ' + (strong ? 'MOCNY sygnał ' : 'sygnał ') + dtxt, msg);
      Bus.show((strong ? '🔥 ' : '⚡ ') + msg);
    }
    if(prefs.autoTrade && signal.levels && !journal.some(e => e.paper && e.result === 'open' && e.sym === item.sym)){
      /* Risk Engine: kill-switch blokuje AUTOMAT (dzienny limit / seria strat) */
      const rs = riskStatus(journal);
      if(rs.blocked){
        Bus.show('🛑 Kill-switch: ' + rs.reason + ' — auto-trade wstrzymany');
      } else {
        addJournal(makePaper(signal.dir, signal.levels.entry, signal.levels.sl, signal.levels.tp1, signal.levels.tp2, 'auto', signal.score, signal.entryQuality));
        Bus.show('🤖 AUTO-TRADE: otwarto ' + dtxt + ' (paper) @ ' + fmtPrice(signal.levels.entry));
      }
    }
  }, [signal, prefs.alert, prefs.autoTrade, prefs.onlyStrong, prefs.waitPullback, item.sym, tf.label]);

  const lastT = candlesSafe.length ? candlesSafe[candlesSafe.length-1].t : null;
  const tfSecC = TF_SEC[tf.id] || 300;
  const ageSec = lastT ? (Date.now()/1000 - lastT) : null;
  const delayed = ageSec != null && ageSec > tfSecC*2 + 90;
  const pct = (data.price != null && data.prev) ? (data.price - data.prev) / data.prev * 100 : null;
  const chg = (data.price != null && data.prev != null) ? data.price - data.prev : null;
  const up = pct != null && pct >= 0;
  const priceColor = pct == null ? 'var(--text)' : up ? 'var(--up)' : 'var(--down)';

  return (
    <div className="screen" style={{overflow:'hidden'}}>
      <div className="topbar" style={{paddingBottom:4}}>
        <button className="iconbtn" onClick={onBack}><Ic d={IC.back} size={20} /></button>
        <div style={{minWidth:0}}>
          <div style={{fontWeight:800, fontSize:15, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{item.name}</div>
          <div className="wl-sym mono">{item.sym} · {tf.label} · zakres {tf.range}</div>
        </div>
        <div className="spacer" />
        <button className={'iconbtn' + (prefs.autoTrade ? ' on' : '')}
          onClick={() => setPrefs(p => {
            const nv = !p.autoTrade;
            Bus.show(nv ? '🤖 AUTO-TRADE (paper) WŁĄCZONE — bot otworzy wirtualną pozycję przy nowym sygnale' : 'AUTO-TRADE wyłączone');
            return { ...p, autoTrade:nv };
          })}>
          <span style={{fontSize:16, lineHeight:1}}>🤖</span>
        </button>
        <button className={'iconbtn' + (prefs.alert ? ' on' : '')}
          onClick={() => setPrefs(p => {
            const nv = !p.alert;
            if(nv) notifyUser('Rikipo Trader', 'Alerty sygnałów aktywne — ' + item.sym);
            Bus.show(nv ? 'Alerty sygnałów WŁĄCZONE — działają przy AUTO 15s' : 'Alerty sygnałów wyłączone');
            return { ...p, alert:nv };
          })}>
          <Ic d={IC.bell} size={18} />
        </button>
        <button className={'chip mono' + (prefs.auto ? ' sel' : '')}
          style={prefs.auto ? {color:'var(--up)', borderColor:'rgba(47,214,174,.4)'} : null}
          onClick={() => setPrefs(p => ({ ...p, auto:!p.auto }))}>
          {prefs.auto ? '● AUTO 15s' : '○ AUTO'}
        </button>
        <button className="iconbtn" onClick={() => { Net.blockedUntil = 0; load(); }}>
          <span className={loading ? 'spin' : ''} style={{display:'flex'}}><Ic d={IC.refresh} size={18} /></span>
        </button>
      </div>

      <div className="pricehero">
        <div className="ph-price mono" style={{color:priceColor}}>
          {fmtPrice(data.price)}
          {pct != null && (
            <span className={'wl-chip mono ' + (up ? 'chip-up' : 'chip-down')}
              style={{fontSize:13, verticalAlign:'middle', marginLeft:10}}>
              {(chg >= 0 ? '+' : '') + fmtPrice(chg)} · {fmtPct(pct)}
            </span>
          )}
        </div>
        <div className="ph-sub mono">
          {data.live ? <span style={{color:'var(--up)', fontWeight:800, animation:'pulse 1.6s infinite'}}>● LIVE&nbsp;·&nbsp;</span> : null}
          {updated ? 'akt. ' + fmtClock(updated) : '…'} · źródło: {error && !candlesSafe.length ? '—' : Net.last}
          {loading ? <span style={{color:'var(--accent)', animation:'pulse 1s infinite'}}> ●</span> : null}
          {error && candlesSafe.length ? <span style={{color:'var(--ema9)'}}> · offline — ostatnie dane</span> : null}
          {delayed ? <span style={{color:'var(--ema9)'}}>{' · świeca sprzed ' + Math.round(ageSec/60) + ' min (darmowe indeksy ≈15 min opóźnienia — LIVE: Capital.com w INFO)'}</span> : null}
        </div>
      </div>

      {delayed && !capEnabled() && CAP_MAP[item.sym] && (
        <div style={{
          margin:'2px 16px 0', padding:'8px 11px', borderRadius:10,
          background:'rgba(255,201,77,.10)', border:'1px solid rgba(255,201,77,.35)',
          fontSize:11.5, color:'var(--ema9)', lineHeight:1.5, display:'flex', alignItems:'center', gap:8,
        }}>
          <span style={{fontSize:15}}>⏱</span>
          <span>Dane opóźnione o ~15 min (darmowy feed indeksów). Włącz LIVE z Capital.com w zakładce INFO, by widzieć notowania w czasie rzeczywistym jak w XTB.</span>
        </div>
      )}

      <div className="chiprow">
        {TFS.map(t => (
          <button key={t.id} className={'chip mono' + (t.id === tf.id ? ' sel' : '')}
            onClick={() => setPrefs(p => ({ ...p, tf:t.id }))}>{t.label}</button>
        ))}
      </div>
      <div className="chiprow" style={{paddingTop:0}}>
        {EMA_DEFS.map(d => (
          <button key={d.n}
            className={'chip mono' + (prefs.emaVis[d.n] ? ' sel' : ' off')}
            onClick={() => setPrefs(p => ({ ...p, emaVis:{ ...p.emaVis, [d.n]: !p.emaVis[d.n] } }))}>
            <span className="dot" style={{background:d.color}} />EMA {d.n}
          </button>
        ))}
      </div>
      <div className="chiprow" style={{paddingTop:0}}>
        <button className="chip mono" style={{color:'var(--accent)', borderColor:'rgba(255,138,117,.35)'}}
          onClick={() => setShowPat(true)}>≡ FORMACJE{recentPat ? ' · ' + recentPat : ''}</button>
        <button className="chip mono" style={{color:'var(--cyan)', borderColor:'rgba(79,216,255,.35)'}}
          onClick={() => setShowAi(true)}>✦ AI</button>
        <button className="chip mono" style={{color:'var(--ema9)', borderColor:'rgba(255,201,77,.35)'}}
          onClick={() => setShowBt(true)}>⟲ BACKTEST</button>
        {[['form','ZNACZNIKI'],['boll','BB'],['vwap','VWAP'],['sr','S/R']].map(([k, l]) => (
          <button key={k} className={'chip mono' + (iprefs[k] ? ' sel' : ' off')}
            onClick={() => toggleOverlay(k)}>{l}</button>
        ))}
        <span style={{width:1, alignSelf:'stretch', background:'var(--border2)', margin:'2px 4px', flexShrink:0}} />
        {['RSI','MACD','STOCH','ADX','OBV','ATR'].map(id => (
          <button key={id} className={'chip mono' + ((iprefs.panels || []).indexOf(id) !== -1 ? ' sel' : ' off')}
            onClick={() => togglePanel(id)}>{id}</button>
        ))}
      </div>

      {signal && (
        <button className="sigstrip" onClick={() => setShowSig(true)}
          style={{
            borderColor: signal.dir > 0 ? 'rgba(47,214,174,.45)' : signal.dir < 0 ? 'rgba(255,107,94,.45)' : 'var(--border2)',
            background: signal.dir > 0 ? 'rgba(47,214,174,.07)' : signal.dir < 0 ? 'rgba(255,107,94,.07)' : 'var(--panel)',
          }}>
          <span className="sig-dir" style={{color: signal.dir > 0 ? '#2fd6ae' : signal.dir < 0 ? '#ff6b5e' : '#8fb0ac'}}>
            {signal.dir > 0 ? 'LONG' : signal.dir < 0 ? 'SHORT' : 'CZEKAJ'}{signal.strong ? ' ★' : ''}
          </span>
          <span className="sgauge">
            <i style={{width: Math.min(100, Math.abs(signal.score)) + '%',
              background: signal.dir > 0 ? '#2fd6ae' : signal.dir < 0 ? '#ff6b5e' : '#8fb0ac'}} />
          </span>
          <span className="sig-meta mono" style={{color:'var(--dim)'}}>
            {signal.setupScore != null ? 'P(win) ' + signal.setupScore + '%' + (signal.ev != null ? ' · EV ' + (signal.ev>0?'+':'') + signal.ev + 'R' : '') : 'confluence ' + (signal.score > 0 ? '+' : '') + signal.score}
            <br/>
            {signal.dir !== 0 && signal.levels
              ? 'SL ' + fmtPrice(signal.levels.sl) + ' · TP1 ' + fmtPrice(signal.levels.tp1)
              : 'brak przewagi (EV/prob poniżej progu)'}
          </span>
          {signal.dir !== 0 && signal.entryQuality && (
            <span className="mono" style={{
              fontSize:10.5, fontWeight:800, padding:'2px 6px', borderRadius:6, whiteSpace:'nowrap',
              color: signal.entryQuality.good ? '#2fd6ae' : signal.entryQuality.chase ? '#ff8a75' : '#8fb0ac',
              background: signal.entryQuality.good ? 'rgba(47,214,174,.12)' : signal.entryQuality.chase ? 'rgba(255,138,117,.12)' : 'rgba(143,176,172,.10)',
              border: '1px solid ' + (signal.entryQuality.good ? 'rgba(47,214,174,.35)' : signal.entryQuality.chase ? 'rgba(255,138,117,.35)' : 'rgba(143,176,172,.25)'),
            }}>
              {signal.entryQuality.good ? '✓ przy ' + signal.entryQuality.anchor
                : signal.entryQuality.chase ? '⚠ ' + signal.entryQuality.dist + '×ATR od ' + signal.entryQuality.anchor
                : '• ' + signal.entryQuality.dist + '×ATR'}
            </span>
          )}
          {signal.warns.length > 0 && <span style={{color:'var(--ema9)', fontSize:15}}>⚠</span>}
        </button>
      )}

      {topOpp && topOpp.state !== 'invalidated' && (() => {
        const op = topOpp;
        const dcol = op.dir > 0 ? '#2fd6ae' : '#ff6b5e';
        const st = ({
          watch:       { ic:'👁', txt:'obserwuję', col:'#8fb0ac' },
          approaching: { ic:'👀', txt:'zbliża się', col:'#ffc94d' },
          in_zone:     { ic:'🎯', txt:'W STREFIE',  col:'#2fd6ae' },
          ready:       { ic:'✅', txt:'gotowe',     col:'#2fd6ae' },
        })[op.state] || { ic:'•', txt:op.state, col:'#8fb0ac' };
        const dpct = signal && signal.price ? (op.entry - signal.price) / signal.price * 100 : null;
        return (
          <div className="sigstrip" onClick={() => setShowSig(true)}
            style={{ borderColor:'rgba(255,201,77,.4)', background:'rgba(255,201,77,.06)', flexDirection:'column', alignItems:'stretch', gap:6 }}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span style={{fontWeight:900, fontSize:12.5, color:dcol}}>{op.dir > 0 ? 'LONG' : 'SHORT'}</span>
              <span style={{fontSize:11, fontWeight:700, color:'var(--dim)', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{op.title}</span>
              <span style={{flex:1}} />
              <span className="mono" style={{fontSize:10.5, fontWeight:800, color:st.col}}>{st.ic} {st.txt}</span>
              <span className="mono" style={{fontSize:10.5, fontWeight:800, padding:'1px 6px', borderRadius:6, color:'#051b21', background:'#ffc94d'}}>{op.grade} · {op.confidence}%</span>
            </div>
            <div className="mono" style={{display:'flex', alignItems:'center', gap:8, fontSize:11.5}}>
              <span style={{color:'var(--text)', fontWeight:800}}>wejście ~{fmtPrice(op.entry)}</span>
              {op.target != null && <span style={{color:'var(--dim2)'}}>cel {fmtPrice(op.target)}{op.rr != null ? ' · RR ' + op.rr : ''}</span>}
              <span style={{flex:1}} />
              {dpct != null && <span style={{color:'var(--dim)'}}>{dpct > 0 ? '+' : ''}{dpct.toFixed(2)}%</span>}
            </div>
            {((op.factors && op.factors.length) || op.note) && (
              <div style={{fontSize:10.5, color:'var(--dim2)', lineHeight:1.5}}>
                {op.factors && op.factors.length ? op.factors.slice(0, 4).join(' · ') : ''}
                {op.note ? (op.factors && op.factors.length ? ' — ' : '') + op.note : ''}
              </div>
            )}
            {op.entry != null && op.grade !== 'D' && op.state !== 'ready' && op.state !== 'in_zone'
              && !journal.some(e => e.paper && (e.result === 'open' || e.result === 'pending') && e.sym === item.sym) && (
              <button className="chip mono" onClick={(ev) => { ev.stopPropagation(); armLimit(op); }}
                style={{justifyContent:'center', padding:'8px 0', fontSize:12, fontWeight:800, color:'var(--ema9)', borderColor:'rgba(255,201,77,.5)', background:'rgba(255,201,77,.08)'}}>
                ⏳ Zleć LIMIT w strefę @ {fmtPrice(op.entry)} · paper
              </button>
            )}
          </div>
        );
      })()}

      {candlesSafe.length > 0 && (
        <div style={{display:'flex', gap:8, margin:'4px 16px 2px'}}>
          <button className="chip mono" style={{flex:1, justifyContent:'center', padding:'10px 0', fontWeight:800, color:'var(--up)', borderColor:'rgba(47,214,174,.5)', background:'rgba(47,214,174,.08)'}}
            onClick={() => openTicket(1)}>▲ KUP · paper</button>
          <button className="chip mono" style={{flex:1, justifyContent:'center', padding:'10px 0', fontWeight:800, color:'var(--down)', borderColor:'rgba(255,107,94,.5)', background:'rgba(255,107,94,.08)'}}
            onClick={() => openTicket(-1)}>▼ SPRZEDAJ · paper</button>
        </div>
      )}

      <div style={{flex:1, display:'flex', flexDirection:'column', position:'relative', minHeight:280}}>
        <ChartCanvas
          key={item.sym + '|' + tf.id}
          candles={candlesSafe}
          emaData={emaData}
          emaVis={prefs.emaVis}
          tfId={tf.id}
          hasVol={hasVol}
          overlays={overlays}
          panels={panels}
          markers={iprefs.form ? patterns.markers : null}
          geoLines={iprefs.form ? patterns.geoDraw : null}
          patMap={patterns.patMap}
          focus={focus}
          levels={sigLevels}
          resetKey={item.sym + '|' + tf.id}
        />
        {loading && !candlesSafe.length && (
          <div className="overlaymsg"><div className="loader" /><div style={{color:'var(--dim)', fontSize:13}}>Pobieram świece {tf.label}…</div></div>
        )}
        {error && !candlesSafe.length && !loading && (
          <div className="overlaymsg">
            <div style={{fontWeight:800, color:'var(--down)'}}>Nie udało się pobrać danych</div>
            <div style={{color:'var(--dim)', fontSize:12.5, maxWidth:280}}>{error}</div>
            <div style={{display:'flex', gap:10}}>
              <button className="chip sel" onClick={() => { Net.blockedUntil = 0; load(); }}>Spróbuj ponownie</button>
            </div>
          </div>
        )}
      </div>

      <div style={{padding:'4px 16px 8px', fontSize:10.5, color:'var(--dim2)'}} className="mono">
        {candlesSafe.length ? candlesSafe.length + ' świec' : ''}
        {candlesSafe.length && !hasVol ? ' · brak wolumenu dla tego instrumentu (indeks)' : ''}
      </div>

      {showPat && (
        <div className="modal-bg" onClick={() => setShowPat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{fontWeight:900, fontSize:16, marginBottom:4}}>
              Wykryte formacje <span style={{color:'var(--dim2)', fontWeight:600, fontSize:12}}>· {item.sym} · {tf.label}</span>
            </div>
            <div style={{fontSize:11, color:'var(--dim2)', marginBottom:8}}>
              Tapnij formację, aby pokazać ją na wykresie (krzyżyk). ▲ pro-wzrostowa · ▼ pro-spadkowa · ◆ neutralna
            </div>
            <div style={{overflowY:'auto', flex:1}}>
              {patterns.list.length === 0 && (
                <div style={{padding:'26px 6px', color:'var(--dim2)', fontSize:13}}>
                  Brak wykrytych formacji w załadowanym zakresie.
                </div>
              )}
              {patterns.list.map((p, k) => (
                <div key={k} className="sr-row" onClick={() => { setFocus({ idx:p.i, k:Date.now() }); setShowPat(false); }}>
                  <span style={{
                    color: p.dir > 0 ? 'var(--up)' : p.dir < 0 ? 'var(--down)' : 'var(--dim)',
                    fontWeight:900, width:18, textAlign:'center', flexShrink:0,
                  }}>{p.dir > 0 ? '▲' : p.dir < 0 ? '▼' : '◆'}</span>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontWeight:700, fontSize:14}}>{p.name}</div>
                    <div className="wl-sym mono">
                      {candlesSafe[p.i] ? fmtFull(candlesSafe[p.i].t, tf.id) : ''}
                      {p.kind === 'geo' ? ' · geometryczna · ' + p.span + ' świec' : ''}
                    </div>
                  </div>
                  <span className="tag mono" style={{
                    color: p.conf >= 75 ? 'var(--up)' : p.conf >= 65 ? 'var(--text)' : 'var(--dim)',
                    fontSize:11, padding:'3px 8px',
                  }}>{p.conf}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSig && signal && (
        <div className="modal-bg" onClick={() => setShowSig(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'baseline', gap:10, marginBottom:2}}>
              <span style={{
                fontWeight:900, fontSize:22,
                color: signal.dir > 0 ? 'var(--up)' : signal.dir < 0 ? 'var(--down)' : 'var(--dim)',
              }}>{signal.dir > 0 ? 'LONG' : signal.dir < 0 ? 'SHORT' : 'CZEKAJ'}{signal.strong ? ' ★' : ''}</span>
              <span className="mono" style={{color:'var(--dim)', fontSize:13}}>
                confluence {signal.score > 0 ? '+' : ''}{signal.score} / 100
              </span>
              <span className="spacer" />
              <span className="mono" style={{color:'var(--dim2)', fontSize:11}}>{item.sym} · {tf.label}</span>
            </div>
            <div style={{fontSize:11, color:'var(--dim2)', marginBottom:8}} className="mono">
              świeca z {fmtFull(signal.t, tf.id)} · ATR {fmtPrice(signal.atr)}
            </div>

            {signal.setupScore != null && (
              <div style={{display:'flex', gap:6, marginBottom:8, flexWrap:'wrap'}}>
                <span className="mono" style={{fontSize:11, fontWeight:800, padding:'3px 8px', borderRadius:7, background: signal.setupScore>=66?'rgba(47,214,174,.15)':signal.setupScore>=52?'rgba(255,201,77,.15)':'rgba(143,176,172,.1)', color: signal.setupScore>=66?'var(--up)':signal.setupScore>=52?'var(--ema9)':'var(--dim)'}}>P(win) {signal.setupScore}%</span>
                {signal.ev != null && <span className="mono" style={{fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:7, background:'var(--bg)', border:'1px solid var(--border2)', color: signal.ev>0?'var(--up)':'var(--down)'}}>EV {signal.ev>0?'+':''}{signal.ev}R</span>}
                {signal.regime && <span className="mono" style={{fontSize:11, padding:'3px 8px', borderRadius:7, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--dim)'}}>{signal.regime.type} · ADX {signal.regime.adx}</span>}
                {signal.sizing && signal.dir !== 0 && <span className="mono" style={{fontSize:11, padding:'3px 8px', borderRadius:7, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--dim)'}}>ryzyko {signal.sizing.riskPct}%</span>}
                {signal.similar && <span className="mono" style={{fontSize:11, padding:'3px 8px', borderRadius:7, background:'var(--bg)', border:'1px solid rgba(79,216,255,.3)', color:'var(--cyan)'}}>≈ {signal.similar.n} podobnych: {signal.similar.wins}/{signal.similar.n} traf</span>}
              </div>
            )}

            <div style={{overflowY:'auto', flex:1}}>
              {signal.dir !== 0 && signal.levels && (
                <div style={{
                  background:'var(--bg)', border:'1px solid var(--border2)',
                  borderRadius:12, padding:'10px 12px', marginBottom:10,
                }}>
                  {[
                    ['Wejście', signal.levels.entry, 'var(--text)', ''],
                    ['Stop Loss', signal.levels.sl, 'var(--down)', 'za swingiem'],
                    ['Take Profit 1', signal.levels.tp1, 'var(--up)', 'RR 1:' + (signal.levels.rr1 || 1.5) + (signal.levels.tp1why ? ' · ' + signal.levels.tp1why : '')],
                    ['Take Profit 2', signal.levels.tp2, 'var(--up)', 'RR 1:' + (signal.levels.rr2 || 2.5)],
                  ].map(([lbl, p, col, extra], k) => (
                    <div key={k} className="kv">
                      <b>{lbl}{extra ? ' · ' + extra : ''}</b>
                      <span className="mono" style={{color:col, fontWeight:700}}>
                        {fmtPrice(p)}
                        <span style={{color:'var(--dim2)', fontWeight:500}}>
                          {'  (' + (p >= signal.levels.entry ? '+' : '−') + fmtPrice(Math.abs(p - signal.levels.entry)) + ')'}
                        </span>
                      </span>
                    </div>
                  ))}
                  <div className="kv">
                    <b>Ryzyko (do SL)</b>
                    <span className="mono" style={{color:'var(--dim)'}}>
                      {fmtPrice(signal.levels.slDist)} pkt · {(signal.levels.slDist/signal.levels.entry*100).toFixed(2)}% · {(signal.levels.slDist/signal.atr).toFixed(1)}×ATR
                    </span>
                  </div>
                </div>
              )}
              {signal.dir === 0 && (
                <div style={{
                  background:'var(--bg)', border:'1px solid var(--border)',
                  borderRadius:12, padding:'10px 12px', marginBottom:10,
                  fontSize:13, color:'var(--dim)', lineHeight:1.6,
                }}>
                  Brak wejścia: P(win) {signal.setupScore != null ? signal.setupScore + '%' : '—'}
                  {signal.ev != null ? ' · EV ' + (signal.ev > 0 ? '+' : '') + signal.ev + 'R' : ''}
                  {signal.evBlock ? ' — poniżej progu oczekiwanej wartości' : ''}.
                  Model nie widzi tu dodatniej przewagi (EV) — zgodnie z zasadą: brak edge = brak transakcji.
                </div>
              )}

              {signal.warns.map((w, k) => (
                <div key={'w'+k} style={{color:'var(--ema9)', fontSize:12.5, padding:'3px 0', lineHeight:1.5}}>⚠ {w}</div>
              ))}

              {signal.opportunities && signal.opportunities.filter(o => o.kind !== 'signal-now').length > 0 && (
                <>
                  <div className="section-label" style={{padding:'10px 0 4px', color:'var(--ema9)'}}>🎯 Okazje / co obserwować</div>
                  {signal.opportunities.filter(o => o.kind !== 'signal-now').map((op, k) => (
                    <div key={'op'+k} style={{background:'var(--bg)', border:'1px solid rgba(255,201,77,.25)', borderRadius:12, padding:'9px 12px', marginBottom:6}}>
                      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3}}>
                        <span style={{fontWeight:800, fontSize:12.5, color:op.dir>0?'var(--up)':'var(--down)'}}>{op.dir>0?'LONG':'SHORT'}</span>
                        <span style={{fontWeight:700, fontSize:13}}>{op.title}</span>
                        <span style={{flex:1}} />
                        <span className="mono" style={{fontSize:10.5, fontWeight:800, padding:'1px 6px', borderRadius:6, color:'#051b21', background:'#ffc94d'}}>{op.grade} · {op.confidence}%</span>
                      </div>
                      <div className="mono" style={{fontSize:11.5, color:'var(--dim)'}}>
                        wejście ~{fmtPrice(op.entry)}{op.target != null ? ' · cel ' + fmtPrice(op.target) : ''}{op.rr != null ? ' · RR ' + op.rr : ''}
                        {op.state ? ' · ' + ({watch:'obserwuję', approaching:'zbliża się', in_zone:'w strefie', ready:'gotowe'}[op.state] || op.state) : ''}
                      </div>
                      {op.note && <div style={{fontSize:11, color:'var(--dim2)', marginTop:2, lineHeight:1.5}}>{op.note}</div>}
                      {op.confirm && op.confirm.length > 0 && (
                        <div style={{fontSize:10.5, color:'var(--dim2)', marginTop:2}}>potwierdź: {op.confirm.slice(0, 3).join(' · ')}</div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {signal.smc && (
                <>
                  <div className="section-label" style={{padding:'10px 0 4px'}}>Struktura rynku (SMC)</div>
                  <div style={{background:'var(--bg)', border:'1px solid var(--border)', borderRadius:12, padding:'8px 12px', marginBottom:6, fontSize:12.5, lineHeight:1.7}}>
                    {signal.smc.struktura && <div><b style={{color:'var(--dim)'}}>Trend:</b> <span style={{color: signal.smc.trend>0?'var(--up)':signal.smc.trend<0?'var(--down)':'var(--dim)'}}>{signal.smc.struktura}</span></div>}
                    {signal.smc.strefa && <div><b style={{color:'var(--dim)'}}>Strefa:</b> {signal.smc.strefa}</div>}
                    {(signal.smc.bos !== 0) && <div style={{color:'var(--cyan)'}}>BOS {signal.smc.bos>0?'↑':'↓'} — kontynuacja</div>}
                    {(signal.smc.choch !== 0) && <div style={{color:'var(--accent)'}}>CHOCH {signal.smc.choch>0?'↑':'↓'} — możliwe odwrócenie</div>}
                    {signal.smc.orderBlock && <div><b style={{color:'var(--dim)'}}>Order Block:</b> {signal.smc.orderBlock}</div>}
                    {signal.smc.fvg && <div><b style={{color:'var(--dim)'}}>FVG:</b> {signal.smc.fvg}</div>}
                    {signal.smc.sweep && <div style={{color:'var(--ema9)'}}>{signal.smc.sweep}</div>}
                    {signal.smc.displacement !== 0 && <div><b style={{color:'var(--dim)'}}>Displacement:</b> {signal.smc.displacement>0?'wzrostowy':'spadkowy'}</div>}
                    {!signal.smc.struktura && <div style={{color:'var(--dim2)'}}>Za mało swingów do oceny struktury.</div>}
                  </div>
                </>
              )}

              {signal.pillarsDetail && (
                <div style={{display:'flex', gap:6, marginBottom:6}}>
                  {[['Struktura', signal.pillarsDetail.struktura], ['Lokalizacja', signal.pillarsDetail.lokalizacja], ['Potwierdz.', signal.pillarsDetail.potwierdzenie]].map(([lbl, val], k) => (
                    <div key={k} style={{flex:1, textAlign:'center', padding:'6px 4px', borderRadius:9, fontSize:11, fontWeight:700,
                      background: val>0?'rgba(47,214,174,.12)':val<0?'rgba(255,107,94,.12)':'rgba(143,176,172,.08)',
                      color: val>0?'var(--up)':val<0?'var(--down)':'var(--dim2)',
                      border:'1px solid ' + (val>0?'rgba(47,214,174,.3)':val<0?'rgba(255,107,94,.3)':'var(--border)')}}>
                      {val>0?'▲':val<0?'▼':'•'} {lbl}
                    </div>
                  ))}
                </div>
              )}
              {signal.session && (
                <div style={{fontSize:11.5, color: signal.session.quality<0?'var(--ema9)':'var(--dim2)', marginBottom:4}} className="mono">
                  Sesja: {signal.session.label}{signal.session.quality<0?' · cienki rynek':''}
                </div>
              )}

              <div className="section-label" style={{padding:'10px 0 4px'}}>Składowe oceny</div>
              {signal.reasons.map((r, k) => (
                <div key={k} style={{display:'flex', gap:9, padding:'5px 0', alignItems:'baseline'}}>
                  <span className="tag mono" style={{
                    color: r.pts > 0 ? 'var(--up)' : 'var(--down)',
                    minWidth:36, textAlign:'center', flexShrink:0,
                  }}>{r.pts > 0 ? '+' : ''}{r.pts}</span>
                  <span style={{fontSize:13, color:'var(--text)', lineHeight:1.45}}>{r.txt}</span>
                </div>
              ))}
              {signal.reasons.length === 0 && (
                <div style={{color:'var(--dim2)', fontSize:13, padding:'8px 0'}}>Żaden czynnik nie wychylił się z neutralności.</div>
              )}

              {signal.dir !== 0 && signal.levels && (
                <button className="chip mono sel"
                  style={{width:'100%', justifyContent:'center', padding:'12px', marginTop:12, fontSize:14,
                    color: signal.dir > 0 ? 'var(--up)' : 'var(--down)',
                    borderColor: signal.dir > 0 ? 'rgba(47,214,174,.5)' : 'rgba(255,107,94,.5)'}}
                  onClick={() => {
                    if(journal.some(e => e.paper && e.result === 'open' && e.sym === item.sym)){
                      Bus.show('Masz już otwartą pozycję paper na ' + item.sym);
                      return;
                    }
                    addJournal(makePaper(signal.dir, signal.levels.entry, signal.levels.sl, signal.levels.tp1, signal.levels.tp2, 'signal', signal.score, signal.entryQuality));
                    Bus.show('▶ Otwarto pozycję paper @ ' + fmtPrice(signal.levels.entry) + ' — rozliczy się sama na SL/TP');
                    setShowSig(false);
                  }}>▶ Wykonaj sygnał (paper trade)</button>
              )}

              <div style={{
                marginTop:12, paddingTop:10, borderTop:'1px solid var(--border)',
                fontSize:11, color:'var(--dim2)', lineHeight:1.6,
              }}>
                Analiza techniczna wyliczona lokalnie z danych wykresu — to nie jest rekomendacja inwestycyjna.
                Decyzja i zarządzanie ryzykiem należą do Ciebie. Pamiętaj o spreadzie CFD w XTB.
              </div>
            </div>
          </div>
        </div>
      )}

      {showAi && (
        <div className="modal-bg" onClick={() => setShowAi(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'center', gap:9, marginBottom:8}}>
              <span style={{fontWeight:900, fontSize:16}}>✦ Druga opinia AI</span>
              <span className="tag mono">{(ai.provider || 'claude') === 'gemini' ? 'Gemini Flash' : 'Claude Sonnet'}</span>
              <span className="spacer" />
              <button className={'chip mono' + (ai.news ? ' sel' : ' off')}
                style={{padding:'4px 10px', fontSize:11}}
                onClick={() => setAi(a => ({ ...a, news:!a.news }))}>NEWSY</button>
            </div>
            <div style={{overflowY:'auto', flex:1}}>
              {!aiKeySet ? (
                <div style={{fontSize:13, color:'var(--dim)', lineHeight:1.75, padding:'8px 2px'}}>
                  Brak klucza API dla wybranego dostawcy.
                  Wejdź w <b style={{color:'var(--text)'}}>INFO → Analiza AI</b>, wybierz dostawcę
                  i wklej klucz (Anthropic lub Google AI Studio). Klucz zostaje wyłącznie
                  na Twoim urządzeniu i jest wysyłany bezpośrednio do dostawcy — nigdy przez proxy.
                </div>
              ) : (
                <React.Fragment>
                  <button className="chip sel mono"
                    style={{width:'100%', justifyContent:'center', padding:'12px', fontSize:14, opacity: aiState.busy ? 0.6 : 1}}
                    onClick={() => { if(!aiState.busy) runAi(); }}>
                    {aiState.busy ? 'Analizuję… (do ~30 s)' : 'Analizuj ' + item.sym + ' · ' + tf.label + (ai.news ? ' + newsy' : '')}
                  </button>
                  {aiState.busy && (
                    <div style={{display:'flex', justifyContent:'center', padding:16}}><div className="loader" /></div>
                  )}
                  {aiState.err && !aiState.busy && (
                    <div style={{color:'var(--down)', fontSize:12.5, lineHeight:1.6, padding:'10px 2px'}}>{aiState.err}</div>
                  )}
                  {aiRes && !aiState.busy && (
                    <div style={{background:'var(--bg)', border:'1px solid var(--border2)', borderRadius:12, padding:'11px 12px', marginTop:10}}>
                      <div style={{display:'flex', alignItems:'baseline', gap:10}}>
                        <span style={{fontWeight:900, fontSize:21, color: aiVerdictCol}}>{aiVerdict}</span>
                        <span className="mono" style={{color:'var(--dim)', fontSize:12}}>
                          pewność {aiRes.confidence != null ? Math.round(aiRes.confidence) : '—'}%
                        </span>
                        <span className="spacer" />
                        <span className="mono" style={{fontSize:11, color: aiAgree ? 'var(--up)' : 'var(--ema9)'}}>
                          {aiAgree ? '✓ zgodna z silnikiem' : '≠ inna niż silnik (' + engineDirTxt + ')'}
                        </span>
                      </div>
                      <div style={{fontSize:13.5, lineHeight:1.65, marginTop:8}}>{String(aiRes.summary || '')}</div>
                      {aiRisks.length > 0 && (
                        <div className="section-label" style={{padding:'10px 0 3px'}}>Kluczowe ryzyka</div>
                      )}
                      {aiRisks.map((r, k) => (
                        <div key={k} style={{fontSize:12.5, color:'var(--dim)', padding:'2px 0', lineHeight:1.5}}>• {String(r)}</div>
                      ))}
                      {aiRes.levels_comment ? (
                        <div style={{fontSize:12.5, color:'var(--dim)', marginTop:9, lineHeight:1.55}}>
                          <b style={{color:'var(--cyan)'}}>Poziomy: </b>{String(aiRes.levels_comment)}
                        </div>
                      ) : null}
                      {aiRes.news_impact ? (
                        <div style={{fontSize:12.5, color:'var(--dim)', marginTop:7, lineHeight:1.55}}>
                          <b style={{color:'var(--accent)'}}>Newsy: </b>{String(aiRes.news_impact)}
                        </div>
                      ) : null}
                      <div className="mono" style={{fontSize:10.5, color:'var(--dim2)', marginTop:10}}>
                        {aiState.provider} · {aiState.at ? fmtClock(aiState.at) : ''} · to nie jest rekomendacja inwestycyjna
                      </div>
                    </div>
                  )}
                  {!aiRes && !aiState.busy && !aiState.err && (
                    <div style={{fontSize:12, color:'var(--dim2)', lineHeight:1.7, padding:'10px 2px'}}>
                      AI dostanie: 40 ostatnich świec, komplet wskaźników, strefy S/R,
                      wykryte formacje i sygnał silnika z uzasadnieniem.
                      {ai.news ? ' Dodatkowo sama wyszuka najnowsze wiadomości o instrumencie.' : ''}
                    </div>
                  )}
                </React.Fragment>
              )}
            </div>
          </div>
        </div>
      )}

      {ticket && (
        <div className="modal-bg" onClick={() => setTicket(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'baseline', gap:10, marginBottom:2}}>
              <span style={{fontWeight:900, fontSize:20, color: ticket.dir > 0 ? 'var(--up)' : 'var(--down)'}}>
                {ticket.dir > 0 ? '▲ KUP' : '▼ SPRZEDAJ'}
              </span>
              <span className="mono" style={{color:'var(--dim)', fontSize:12}}>{item.sym} · paper</span>
              <span className="spacer" />
              <span className="mono" style={{fontSize:14, fontWeight:800}}>@ {fmtPrice(ticket.entry)}</span>
            </div>
            <div style={{fontSize:11, color:'var(--dim2)', marginBottom:10, lineHeight:1.5}}>
              Wirtualne zlecenie po cenie rynkowej — rozliczy się automatycznie po żywych notowaniach (SL / TP1 / TP2).
            </div>
            {[['sl','Stop Loss'],['tp1','Take Profit 1'],['tp2','Take Profit 2']].map(([k, l]) => (
              <div key={k} style={{marginBottom:9}}>
                <div style={{fontSize:11.5, color:'var(--dim2)', marginBottom:4}}>{l}:</div>
                <div className="searchbox">
                  <input className="mono" inputMode="decimal" value={ticket[k]}
                    onChange={e => { const val = e.target.value; setTicket(t => ({ ...t, [k]: val })); }} />
                </div>
              </div>
            ))}
            {(() => {
              const sl = parseFloat(ticket.sl), t1 = parseFloat(ticket.tp1);
              const risk = isFinite(sl) ? Math.abs(ticket.entry - sl) : null;
              const rr = (risk && isFinite(t1)) ? Math.abs(t1 - ticket.entry)/risk : null;
              return (
                <div className="mono" style={{fontSize:11.5, color:'var(--dim)', margin:'2px 0 10px'}}>
                  ryzyko: {risk ? fmtPrice(risk) + ' pkt' : '—'} · RR do TP1: {rr ? '1:' + rr.toFixed(2) : '—'}
                  {rr != null && rr < 1.5 ? <span style={{color:'var(--ema9)'}}> · poniżej Twojej zasady 1:1.5!</span> : null}
                </div>
              );
            })()}
            <button className="chip sel mono" style={{width:'100%', justifyContent:'center', padding:'12px', fontSize:14}}
              onClick={() => {
                const sl = parseFloat(ticket.sl), t1 = parseFloat(ticket.tp1), t2 = parseFloat(ticket.tp2);
                if(!isFinite(sl) || !isFinite(t1)){ Bus.show('Podaj poprawne SL i TP1'); return; }
                const d = ticket.dir;
                if((d === 1 && !(sl < ticket.entry && t1 > ticket.entry)) || (d === -1 && !(sl > ticket.entry && t1 < ticket.entry))){
                  Bus.show('SL i TP muszą być po właściwych stronach ceny');
                  return;
                }
                addJournal(makePaper(d, ticket.entry, sl, t1, isFinite(t2) ? t2 : null, 'manual', null));
                Bus.show('▶ Pozycja paper otwarta @ ' + fmtPrice(ticket.entry));
                setTicket(null);
              }}>Otwórz pozycję (paper)</button>
          </div>
        </div>
      )}

      {showBt && (
        <div className="modal-bg" onClick={() => setShowBt(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'center', gap:9, marginBottom:8}}>
              <span style={{fontWeight:900, fontSize:16}}>⟲ Backtest silnika</span>
              <span className="tag mono">{item.sym} · {tf.label} · {candlesSafe.length} świec</span>
            </div>
            <div style={{overflowY:'auto', flex:1}}>
              <button className="chip sel mono"
                style={{width:'100%', justifyContent:'center', padding:'12px', fontSize:14, opacity: bt.busy ? 0.6 : 1}}
                onClick={() => {
                  if(bt.busy || !ind || candlesSafe.length < 90){
                    if(!bt.busy) Bus.show('Za mało świec do backtestu (min 90)');
                    return;
                  }
                  setBt({ busy:true, res:null });
                  setTimeout(() => {
                    const r = backtestEngine(candlesSafe, ind, emaData, hasVol, item.sym, prefs.minScore, prefs.smc,
                      { weights: Store.get('rt_model_weights', null), calib: Store.get('rt_model_calib', null), knn: Store.get('rt_knn_history', null), tfId: tf.id });
                    setBt({ busy:false, res:r });
                  }, 40);
                }}>
                {bt.busy ? 'Liczę świeca po świecy…' : 'Uruchom backtest na załadowanej historii'}
              </button>
              <button className="chip mono"
                style={{width:'100%', justifyContent:'center', padding:'10px', fontSize:13, marginTop:8, color:'var(--cyan)', borderColor:'rgba(79,216,255,.4)', opacity: bt.busy ? 0.6 : 1}}
                onClick={() => {
                  if(bt.busy || !ind || candlesSafe.length < 250){ if(!bt.busy) Bus.show('Do treningu wag trzeba ≥250 świec (zmień interwał na większy zakres)'); return; }
                  setBt({ busy:true, res:null });
                  setTimeout(() => {
                    const wf = walkForwardKFold(candlesSafe, ind, emaData, hasVol, item.sym, prefs.minScore, prefs.smc, tf.id);
                    if(wf && wf.ok){
                      Store.set('rt_model_weights', wf.weights);
                      Store.set('rt_model_calib', wf.calib || null); // [A1] kalibracja WYŁĄCZNIE z pooled OOS
                      Store.set('rt_knn_history', wf.samples && wf.samples.length >= 40 ? wf.samples : null);
                      Store.set('rt_model_meta', {
                        n: wf.training.n, reliable: !!wf.reliable, totalNoos: wf.totalNoos,
                        oosPairsN: wf.oosPairsN, agg: wf.agg, payout: wf.payout,
                        regimeCoverage: wf.regimeCoverage, at: Date.now(),
                      });
                      setWv(v => v + 1);
                      Bus.show('🧠 k-fold OOS: ' + wf.totalNoos + ' tr · med avgR ' + (wf.agg.avgR.med != null ? wf.agg.avgR.med : '—') + 'R'
                        + (wf.agg.brier.p75 != null ? ' · Brier p75 ' + wf.agg.brier.p75 : '')
                        + (wf.reliable ? '' : ' · ⚠ NIEWIARYGODNE — model nie będzie używany live'));
                    } else {
                      Bus.show('Trening nieudany: ' + (wf ? wf.reason : 'brak danych'));
                    }
                    const r = backtestEngine(candlesSafe, ind, emaData, hasVol, item.sym, prefs.minScore, prefs.smc,
                      { weights: Store.get('rt_model_weights', null), calib: Store.get('rt_model_calib', null), knn: Store.get('rt_knn_history', null), tfId: tf.id });
                    r.wf = wf;
                    setBt({ busy:false, res:r });
                  }, 40);
                }}>
                🧠 Trenuj wagi z backtestu (walk-forward)
              </button>
              {Store.get('rt_model_weights', null) && (() => {
                const meta = Store.get('rt_model_meta', null);
                return (
                  <div style={{marginTop:6, fontSize:10.5, color: meta && !meta.reliable ? 'var(--ema9)' : 'var(--dim2)'}} className="mono">
                    Model używa WYUCZONYCH wag{meta ? ' (n=' + meta.n + (meta.reliable ? ', wiarygodne' : ', ⚠ mała próba — traktuj jako eksperyment') + ')' : ''}.
                    <button className="mono" style={{marginLeft:8, color:'var(--down)', background:'none', border:'none', textDecoration:'underline'}}
                      onClick={() => { Store.set('rt_model_weights', null); Store.set('rt_model_calib', null); Store.set('rt_model_meta', null); setWv(v=>v+1); Bus.show('Przywrócono wagi domyślne'); }}>reset</button>
                  </div>
                );
              })()}
              {bt.busy && <div style={{display:'flex', justifyContent:'center', padding:16}}><div className="loader" /></div>}
              {bt.res && !bt.busy && bt.res.stats && (
                <div style={{marginTop:10}}>
                  {bt.res.stats.n === 0 ? (
                    <div style={{fontSize:13, color:'var(--dim)', padding:'8px 2px', lineHeight:1.65}}>
                      Silnik nie wygenerował ani jednego sygnału na tej historii (próg ±30).
                      To też jest informacja: na tym instrumencie i interwale nie było wystarczającej przewagi.
                    </div>
                  ) : (
                    <React.Fragment>
                      <div style={{background:'var(--bg)', border:'1px solid var(--border2)', borderRadius:12, padding:'10px 12px'}}>
                        <div className="kv"><b>Transakcje</b><span className="mono">{bt.res.stats.n} (▲{bt.res.stats.longs} / ▼{bt.res.stats.shorts})</span></div>
                        <div className="kv"><b>Trafność (TP1 vs SL)</b><span className="mono" style={{color: bt.res.stats.winRate >= 40 ? 'var(--up)' : 'var(--down)'}}>{bt.res.stats.winRate.toFixed(0)}%<span style={{color:'var(--dim2)', fontWeight:500}}> ({bt.res.stats.wins}/{bt.res.stats.wins + bt.res.stats.losses})</span></span></div>
                        <div className="kv"><b>Suma R</b><span className="mono" style={{color: bt.res.stats.sumR >= 0 ? 'var(--up)' : 'var(--down)'}}>{(bt.res.stats.sumR >= 0 ? '+' : '') + bt.res.stats.sumR} R</span></div>
                        <div className="kv"><b>Średnia R / trade</b><span className="mono">{bt.res.stats.avgR}</span></div>
                        <div className="kv"><b>Profit factor</b><span className="mono">{bt.res.stats.pf}</span></div>
                        <div className="kv"><b>Max obsunięcie</b><span className="mono" style={{color:'var(--down)'}}>−{bt.res.stats.maxDD} R</span></div>
                        <div className="kv"><b>Najdłuższa seria strat</b><span className="mono">{bt.res.stats.maxConsecLoss}</span></div>
                        <div className="kv"><b>Timeouty (60 świec)</b><span className="mono">{bt.res.stats.timeouts}</span></div>
                        <div className="kv"><b>TP2 dosięgnięte (wśród TP1)</b><span className="mono">{bt.res.stats.tp2Pct}%</span></div>
                      </div>
                      <div style={{margin:'12px 0 4px', fontSize:11, color:'var(--dim2)'}} className="mono">Krzywa kapitału (w R):</div>
                      <div style={{background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, padding:8}}>
                        <EquityLine data={bt.res.equity} />
                      </div>
                      <div className="section-label" style={{padding:'12px 0 4px'}}>Ostatnie transakcje</div>
                      {bt.res.trades.slice(-8).reverse().map((t, k) => (
                        <div key={k} className="kv" style={{fontSize:12}}>
                          <b className="mono" style={{color: t.dir > 0 ? 'var(--up)' : 'var(--down)', fontWeight:700}}>
                            {(t.dir > 0 ? '▲ ' : '▼ ') + (candlesSafe[t.i0] ? fmtFull(candlesSafe[t.i0].t, tf.id) : '')}
                          </b>
                          <span className="mono" style={{color: t.r > 0 ? 'var(--up)' : t.r < 0 ? 'var(--down)' : 'var(--dim)'}}>
                            {t.out + ' ' + (t.r > 0 ? '+' : '') + t.r + 'R'}
                          </span>
                        </div>
                      ))}
                    </React.Fragment>
                  )}
                  {bt.res.wf && bt.res.wf.ok && (
                    <div style={{marginTop:12, background:'var(--bg)', border:'1px solid rgba(79,216,255,.3)', borderRadius:12, padding:'10px 12px'}}>
                      <div className="section-label" style={{padding:'0 0 6px', color:'var(--cyan)'}}>Walk-forward k-fold (uczenie wag)</div>
                      {bt.res.wf.folds.map((f, k) => (
                        <div className="kv" key={k}><b>Fold {k+1}</b><span className="mono">
                          {f.skipped ? ('pominięty: ' + f.reason)
                            : (f.stats.n + ' tr · ' + (f.stats.avgR != null ? f.stats.avgR : '—') + 'R · PF ' + f.stats.pf + (f.brier != null ? ' · Brier ' + f.brier : ''))}
                        </span></div>
                      ))}
                      <div className="kv"><b>OOS łącznie (pooled)</b><span className="mono" style={{color: (bt.res.wf.agg.avgR.med||0) > 0 ? 'var(--up)' : 'var(--down)', fontWeight:700}}>{bt.res.wf.totalNoos} tr · med avgR {bt.res.wf.agg.avgR.med != null ? bt.res.wf.agg.avgR.med : '—'}R · p25 {bt.res.wf.agg.avgR.p25 != null ? bt.res.wf.agg.avgR.p25 : '—'}R</span></div>
                      {bt.res.wf.agg.brier.p75 != null && (
                        <div className="kv"><b>Brier p75 (foldy OOS)</b><span className="mono" style={{color: bt.res.wf.agg.brier.p75 < 0.25 ? 'var(--up)' : 'var(--ema9)'}}>{bt.res.wf.agg.brier.p75}<span style={{color:'var(--dim2)', fontWeight:500}}> (0.25 = moneta)</span></span></div>
                      )}
                      <div className="kv"><b>Kalibracja produkcyjna</b><span className="mono">{bt.res.wf.calib ? ('isotonic z ' + bt.res.wf.oosPairsN + ' par OOS') : ('wyłączona (' + bt.res.wf.oosPairsN + ' par OOS < 150)')}</span></div>
                      <div className="kv"><b>In-sample (diagnostyka)</b><span className="mono" style={{color:'var(--dim2)'}}>{bt.res.wf.prodInSample.n} tr · {bt.res.wf.prodInSample.avgR}R</span></div>
                      {!bt.res.wf.reliable && (
                        <div style={{fontSize:10.5, color:'var(--ema9)', marginTop:5, lineHeight:1.55}}>⚠ Model NIEWIARYGODNY — silnik live pozostaje na wagach domyślnych i stałym sizingu, dopóki k-fold OOS nie przejdzie progów.</div>
                      )}
                      <div style={{fontSize:10.5, color:'var(--dim2)', marginTop:5, lineHeight:1.55}}>Kalibracja isotonic fitowana WYŁĄCZNIE na pooled OOS (nigdy in-sample). Trening z embargo, HTF liczony identycznie jak live. OOS to jedyny uczciwy dowód przewagi.</div>
                    </div>
                  )}
                  <div style={{marginTop:12, fontSize:11, color:'var(--dim2)', lineHeight:1.65}}>
                    Metodologia: wejście po close świecy sygnału · <b style={{color:'var(--dim)'}}>dynamiczne zarządzanie</b>:
                    po +1R stop przesuwany na wejście (BE), na TP1 realizacja 50% pozycji, reszta („runner")
                    z trailingiem za 8-świecowym dołkiem/szczytem ±0.25 ATR aż do TP2 lub wybicia stopa ·
                    SL i cel w tej samej świecy = liczony stop (pesymistycznie) · time-stop po 60 świecach ·
                    5 świec przerwy między transakcjami · strefy S/R i HTF liczone przyczynowo (zero look-ahead) ·
                    spread odjęty od każdego R (poślizg pominięty) · trening wag: tylko transakcje ZAMKNIĘTE przed
                    splitem (embargo) · historia nie gwarantuje przyszłości.
                  </div>
                </div>
              )}
              {!bt.res && !bt.busy && (
                <div style={{fontSize:12, color:'var(--dim2)', lineHeight:1.7, padding:'10px 2px'}}>
                  Backtest przepuszcza silnik sygnałów przez całą załadowaną historię
                  ({candlesSafe.length} świec) i symuluje transakcje wg Twoich zasad.
                  Odpowiada na pytanie: czy ten setup miał tu w ogóle przewagę.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ====================== [5c] EKRAN: DZIENNIK ======================== */
