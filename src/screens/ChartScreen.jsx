import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { aiPrompt, buildAiContext, callClaude, callGemini, tolerantJson } from '../ai/index.js';
import { backtestEngine, walkForwardKFold } from '../backtest/engine.js';
import { ablationTable, ablationAscii } from '../backtest/ablation.js';
import { nextModelStage, stageLabel } from '../core/governance.js';
import { saveModelVersion, listModelVersions, activateModelVersion, getActiveVersion } from '../core/modelStore.js';
import { compareValidation, summarizeRun } from '../core/adaptive.js';
import { logParamChange } from '../core/paramlog.js';
import { DEFAULT_SMC } from '../constants/defaults.js';
import { riskStatus } from '../signals/riskEngine.js';
import { Store } from '../core/store.js';
import { ChartCanvas } from '../components/ChartCanvas.jsx';
import { EquityLine } from '../components/EquityLine.jsx';
import { IC, Ic } from '../components/icons.jsx';
import { Bus } from '../core/bus.js';
import { Net } from '../core/net.js';
import { CAP_MAP, capEnabled, capResolveEpic, capWsStart, capWsStop, capitalTick } from '../data/capital.js';
import { TF_SEC, getChart, htfTrend, fetchTrainingCandles } from '../data/feed.js';
import { TFS } from '../data/yahoo.js';
import { EMA_DEFS, adxSeries, atrSeries, bollSeries, emaSeries, findSRZones, macdSeries, obvSeries, rsiSeries, stochSeries, vwapSeries } from '../indicators/index.js';
import { detectPatterns } from '../patterns/index.js';
import { computeSignal, indicatorsFor } from '../signals/engine.js';
import { displacement } from '../smc/index.js';
import { portfolioCheck } from '../signals/portfolio.js';
import { buildPaperEntry } from '../data/paperEntry.js';
import { buildStrategyCtx, rankStrategies } from '../strategies/engine.js';
import { masterVerdict } from '../signals/master.js';
import { fmtClock, fmtFull, fmtPct, fmtPrice, fmtVol } from '../utils/format.js';
import { notifyUser } from '../utils/notify.js';

export function ChartScreen({ item, onBack, prefs, setPrefs, ai, setAi, addJournal, journal, resolveTick, liveRisk }){
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
  const [showStrat, setShowStrat] = useState(false); // 🏛 ranking strategii
  const [showMaster, setShowMaster] = useState(false); // ⚡ silnik nadrzędny MASTER
  const [fs, setFs] = useState(false);               // pełny ekran wykresu
  const [expStrat, setExpStrat] = useState(null);     // rozwinięty wiersz rankingu
  const [ticket, setTicket] = useState(null);
  const [bt, setBt] = useState({ busy:false, res:null });
  const [wv, setWv] = useState(0); // wersja wag modelu (bump po treningu → recompute)
  const [trainCool, setTrainCool] = useState(0); // [E2-4] cooldown przycisku treningu (s)
  useEffect(() => {
    if(trainCool <= 0) return;
    const h = setInterval(() => setTrainCool(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(h);
  }, [trainCool > 0]);
  const prevDirRef = useRef(0);
  const liveCandlesRef = useRef([]);
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
        liveCandlesRef.current = cs;   // najświeższe świece (z knotami) do rozliczeń
        return Object.assign({}, d, { candles:cs, price:px, live:true });
      });
      setUpdated(new Date());
      /* [FIX] rozliczaj paper po EKSTREMACH świec (knoty), tak jak skaner tła w App.jsx —
         inaczej na ekranie wykresu wejścia/TP1/TP2/SL nie zawsze „łapały" (tylko cena próbki) */
      const cs = liveCandlesRef.current;
      let ropts;
      if(cs && cs.length >= 20){
        const last8 = cs.slice(-8);
        const atrArr = atrSeries(cs.slice(-60), 14);
        let atr = null;
        for(let q=atrArr.length-1; q>=0; q--){ if(atrArr[q] != null){ atr = atrArr[q]; break; } }
        ropts = {
          bars: cs.slice(-40), atr,
          trailLow: Math.min(...last8.map(c => c.l)),
          trailHigh: Math.max(...last8.map(c => c.h)),
        };
      }
      resolveTick(item.sym, px, ropts);
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
    srWithHtf.__tfSec = TF_SEC[tf.id] || 300; // [E3-1] twarda bramka stale
    /* [E4-2] drawdown dziennika (R) → tryb obronny sizingu */
    {
      let peak = 0, cur = 0, dd = 0;
      journal.filter(e => e.result && e.result !== 'open' && e.result !== 'pending' && e.result !== 'cancelled')
        .slice().sort((a, b) => (a.exitTs || a.ts || 0) - (b.exitTs || b.ts || 0))
        .forEach(e => { cur += (e.r || 0); if(cur > peak) peak = cur; if(peak - cur > dd) dd = peak - cur; });
      srWithHtf.__ddR = +dd.toFixed(2);
    }
    if(prefs.minProb != null) srWithHtf.__minProb = prefs.minProb;
    return computeSignal(candlesSafe, ind, emaData, patterns, hasVol, null, srWithHtf);
  }, [ind, candlesSafe, emaData, patterns, hasVol, tf.id, prefs.minScore, prefs.minProb, prefs.waitPullback, prefs.smc, item.sym, wv]);
  /* 🏛 Instytucjonalny ranking strategii — moduł DORADCZY obok zwalidowanego
     silnika (auto-trade nadal decyduje computeSignal; parytet validate↔serve).
     THROTTLE: detektory pracują na ZAMKNIĘTEJ świecy (n-2), więc przeliczamy
     ranking tylko przy NOWEJ świecy (barSig) i zmianie dziennika — nie na
     każdym ticku ceny. To eliminuje zbędne obciążenie CPU przy streamie. */
  const barSig = candlesSafe.length ? candlesSafe.length + ':' + candlesSafe[candlesSafe.length-1].t : '0';
  const stratRank = useMemo(() => {
    if(!ind || candlesSafe.length < 60) return null;
    try{
      const ctx = buildStrategyCtx(candlesSafe, ind, emaData, hasVol, item.sym, TF_SEC[tf.id] || 300, null);
      return ctx ? rankStrategies(ctx, journal) : null;
    }catch(e){ return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barSig, item.sym, tf.id, journal, wv]);

  /* 🌐 kanoniczny feed MASTER: M15, NIEZALEŻNIE od oglądanego interwału.
     Bez tego werdykt liczył się ze świec bieżącego widoku i na H1 potrafił
     mówić SHORT, a na M15 LONG w tej samej minucie. Teraz drabina i detektory
     zawsze pracują na tym samym materiale → jeden globalny werdykt. */
  const [mfeed, setMfeed] = useState(null);
  useEffect(() => {
    let stop = false;
    if(tf.id === 'M15') return; // widok M15 = kanon, drugi fetch zbędny
    const M15 = TFS.find(t => t.id === 'M15');
    const pull = async () => {
      try{
        const r = await getChart(item.sym, M15, prefs.source);
        if(!stop && r && r.candles && r.candles.length >= 60) setMfeed({ sym:item.sym, candles:r.candles });
      }catch(e){}
    };
    pull();
    const h = setInterval(pull, 60000);
    return () => { stop = true; clearInterval(h); };
  }, [item.sym, prefs.source, tf.id]);

  /* ranking 🏛 na feedzie kanonicznym (gdy widok ≠ M15) — przeliczany tylko
     przy odświeżeniu feedu (60 s), nie na każdym ticku */
  const canonRank = useMemo(() => {
    if(tf.id === 'M15' || !mfeed || mfeed.sym !== item.sym || mfeed.candles.length < 60) return null;
    try{
      const pack = indicatorsFor(mfeed.candles, 'M15');
      if(!pack) return null;
      const ctx = buildStrategyCtx(mfeed.candles, pack.ind, pack.emaData, pack.hasVol, item.sym, 900, null);
      return ctx ? rankStrategies(ctx, journal) : null;
    }catch(e){ return null; }
  }, [mfeed, item.sym, tf.id, journal]);

  /* ⚡ SILNIK NADRZĘDNY MASTER — jeden werdykt z: silnika k-fold (trigger),
     rankingu 🏛 (konfluencja) i drabiny WSZYSTKICH interwałów (kontekst
     top-down), liczony z kanonu M15 — ten sam na każdym widoku. */
  const master = useMemo(() => {
    if(!candlesSafe.length) return null;
    try{
      if(tf.id === 'M15'){
        return masterVerdict({ candles: candlesSafe, tfId:'M15', tfSec:900, signal, rank: stratRank });
      }
      if(mfeed && mfeed.sym === item.sym && mfeed.candles.length >= 60){
        return masterVerdict({ candles: mfeed.candles, tfId:'M15', tfSec:900, signal, rank: canonRank });
      }
      /* kanon jeszcze się ładuje — tymczasowo licz z widoku (oznaczone) */
      const m = masterVerdict({ candles: candlesSafe, tfId: tf.id, tfSec: TF_SEC[tf.id] || 300, signal, rank: stratRank });
      if(m) m.provisional = true;
      return m;
    }catch(e){ return null; }
  }, [candlesSafe, tf.id, signal, stratRank, mfeed, canonRank, item.sym]);

  /* najlepsza „okazja" poza samym aktywnym sygnałem (do paska i alertu);
     okazje z RR < 1.2 odsiane — proponowanie wejścia z celem bliżej niż
     ryzyko to amatorka, która tylko zaśmiecała ekran */
  const topOpp = useMemo(() => {
    const ops = signal && signal.opportunities;
    if(!ops || !ops.length) return null;
    return ops.find(o => o.kind !== 'signal-now' && (o.rr == null || o.rr >= 1.2)) || null;
  }, [signal]);

  /* znaczniki WEJŚĆ w otwarte pozycje paper na tym symbolu (na wykresie) */
  const posMarkers = useMemo(() => {
    return (journal || [])
      .filter(e => e.paper && e.sym === item.sym && (e.result === 'open' || e.result === 'pending'))
      .map(e => {
        const d = new Date(e.ts);
        const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        return { t: Math.floor(e.ts / 1000), price: e.entry, dir: e.dir, label: (e.result === 'pending' ? '⏳ ' : '') + hm };
      });
  }, [journal, item.sym]);

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
    /* 🏛 poziomy zwycięskiej strategii rankingu na wykresie, gdy główny
       silnik nie ma aktywnego sygnału (fiolet — odróżnienie od silnika) */
    if(!(signal && signal.dir !== 0 && signal.levels) && stratRank && stratRank.dir !== 0 && stratRank.levels){
      const L = stratRank.levels;
      out.push(
        { p: L.entry, label: '🏛 E',   color: '#c792ff' },
        { p: L.sl,    label: '🏛 SL',  color: 'rgba(255,107,94,.8)' },
        { p: L.tp1,   label: '🏛 TP1', color: 'rgba(47,214,174,.8)' },
        { p: L.tp2,   label: '🏛 TP2', color: 'rgba(47,214,174,.5)' },
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
  }, [signal, topOpp, stratRank]);

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
  /* kolor paska gotowości: czerwony → żółty → zielony */
  const readyColor = (pct) => pct >= 85 ? '#2fd6ae' : pct >= 50 ? '#ffc94d' : '#ff6b5e';
  const aiRes = aiState.res;
  const aiVerdict = aiRes ? String(aiRes.verdict || 'WAIT').toUpperCase() : null;
  const aiVerdictCol = aiVerdict === 'LONG' ? 'var(--up)' : aiVerdict === 'SHORT' ? 'var(--down)' : 'var(--dim)';
  const engineDirTxt = signal ? (signal.dir > 0 ? 'LONG' : signal.dir < 0 ? 'SHORT' : 'WAIT') : null;
  const aiAgree = aiRes ? (typeof aiRes.agree_with_engine === 'boolean' ? aiRes.agree_with_engine : (aiVerdict === engineDirTxt)) : null;
  const aiRisks = (aiRes && Array.isArray(aiRes.key_risks)) ? aiRes.key_risks.slice(0, 3) : [];

  /* paper trading — pomocnicy (budowa wpisu: data/paperEntry.js [E4-4]) */
  const makePaper = (dir, entry, sl, tp1, tp2, srcTag, score, eq, sig) => buildPaperEntry({
    sym: item.sym, name: item.name, tfId: tf.id,
    dir, entry, sl, tp1, tp2, srcTag, score, eq, sig,
    modelV: (Store.get('rt_model_meta', null) || {}).modelV || null,
  });

  /* [E4-1] każde otwarcie paper przechodzi przez Portfolio Risk Engine
     (cap sumaryczny, korelacje, VaR-lite) — zastępuje klasowe proxy z [A5] */
  const tryOpenPaper = (dir, entry, sl, tp1, tp2, srcTag, score, eq, sig, extra) => {
    const e = makePaper(dir, entry, sl, tp1, tp2, srcTag, score, eq, sig);
    if(extra) Object.assign(e, extra); // np. strategy — zasila uczenie rankingu
    const open = journal
      .filter(x => x.paper && x.result === 'open')
      .map(x => ({ sym: x.sym, dir: x.dir, riskPct: x.riskPct != null ? x.riskPct : 0.5 }));
    const volR = (sig && sig.atr && e.risk > 0) ? +(sig.atr / e.risk).toFixed(2) : null;
    const freeTrade = prefs.freeTrade !== false; // domyślnie WŁĄCZONY — bez twardych blokad portfela
    const pc = portfolioCheck(
      { sym: item.sym, dir, riskPct: e.riskPct != null ? e.riskPct : 0.5, volR },
      open, Store.get('rt_corr_matrix', null));
    if(!pc.allowed){
      if(!freeTrade){
        Bus.show('🛑 Portfel: ' + pc.reason + ' — wejście odrzucone');
        return false;
      }
      Bus.show('⚠️ Portfel: ' + pc.reason + ' — otwieram mimo limitu (tryb swobodny)');
      e.note = ((e.note || '') + (e.note ? ' · ' : '') + '⚠ ' + pc.reason).trim();
    } else if(pc.scale < 1 && !freeTrade){
      if(e.riskPct != null) e.riskPct = +(e.riskPct * pc.scale).toFixed(2);
      e.note = ((e.note || '') + (e.note ? ' · ' : '') + pc.reason).trim();
    }
    addJournal(e);
    return true;
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
    if(prefs.autoTrade && signal.levels && (prefs.freeTrade !== false || !journal.some(e => e.paper && e.result === 'open' && e.sym === item.sym))){
      /* [E3-3] okno makro = zakaz dla automatu (ręczne wejście z ostrzeżeniem) */
      if(signal.autoTradeBlock){
        Bus.show('⛔ Okno makro: ' + signal.macroWindow + ' — auto-trade zablokowany');
        return;
      }
      /* ⚡ MASTER: drabina WSZYSTKICH interwałów przeciw → bot nie wchodzi
         pod prąd wyższego rzędu (kontrola jakości sygnału, nie limit ryzyka) */
      if(master && master.veto){
        Bus.show('⛔ MASTER: ' + master.veto + ' — auto-trade wstrzymany');
        return;
      }
      /* Risk Engine v2 [A5]: floating + limit otwartych + dzienny limit UTC */
      const live = liveRisk ? liveRisk(journal, { [item.sym]: data.price }) : undefined;
      const rs = riskStatus(journal, {}, live);
      if(rs.blocked && prefs.freeTrade === false){
        Bus.show('🛑 Kill-switch: ' + rs.reason + ' — auto-trade wstrzymany');
      } else {
        if(tryOpenPaper(signal.dir, signal.levels.entry, signal.levels.sl, signal.levels.tp1, signal.levels.tp2, 'auto', signal.score, signal.entryQuality, signal)){
          Bus.show('🤖 AUTO-TRADE: otwarto ' + dtxt + ' (paper) @ ' + fmtPrice(signal.levels.entry));
        }
      }
    }
  }, [signal, master, prefs.alert, prefs.autoTrade, prefs.onlyStrong, prefs.waitPullback, item.sym, tf.label]);

  const lastT = candlesSafe.length ? candlesSafe[candlesSafe.length-1].t : null;
  const tfSecC = TF_SEC[tf.id] || 300;
  const ageSec = lastT ? (Date.now()/1000 - lastT) : null;
  const delayed = ageSec != null && ageSec > tfSecC*2 + 90;
  const pct = (data.price != null && data.prev) ? (data.price - data.prev) / data.prev * 100 : null;
  const chg = (data.price != null && data.prev != null) ? data.price - data.prev : null;
  const up = pct != null && pct >= 0;
  const priceColor = pct == null ? 'var(--text)' : up ? 'var(--up)' : 'var(--down)';

  return (
    <div className="screen" style={{overflowY:'auto', overflowX:'hidden'}}>
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
        <button className="iconbtn" title="Pełny ekran wykresu" onClick={() => setFs(true)}>
          <span style={{fontSize:17, lineHeight:1}}>⛶</span>
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
        <button className="chip mono" style={{color:'#c792ff', borderColor:'rgba(199,146,255,.4)'}}
          onClick={() => setShowStrat(true)}>🏛 RANKING{stratRank && stratRank.verdict !== 'BRAK TRANSAKCJI' ? ' · ' + stratRank.verdict : ''}</button>
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

      {/* ⚡ MASTER — JEDEN werdykt: silnik k-fold (trigger) + ranking 🏛
          (konfluencja) + drabina wszystkich interwałów (kontekst top-down) */}
      {master && (() => {
        const m = master;
        const dcol = m.dir > 0 ? '#2fd6ae' : m.dir < 0 ? '#ff6b5e' : '#8fb0ac';
        const rc = readyColor(m.readiness);
        const L = m.levels;
        return (
          <div className="stratstrip" onClick={() => setShowMaster(true)}
            style={{
              cursor:'pointer',
              borderColor: m.dir > 0 ? 'rgba(47,214,174,.45)' : m.dir < 0 ? 'rgba(255,107,94,.45)' : m.veto ? 'rgba(255,201,77,.45)' : 'var(--border2)',
              background: m.dir > 0 ? 'rgba(47,214,174,.07)' : m.dir < 0 ? 'rgba(255,107,94,.07)' : 'var(--panel)',
            }}>
            {/* wiersz 1: werdykt + ocena + drabina interwałów + przycisk */}
            <div style={{display:'flex', alignItems:'center', gap:9}}>
              <span style={{fontWeight:900, fontSize:14.5, letterSpacing:.3, color:dcol, flexShrink:0}}>
                ⚡ {m.verdict}{m.state === 'entry' && signal && signal.strong ? ' ★' : ''}
                {m.dir === 0 && m.lean !== 0 && (
                  <span style={{color: m.lean > 0 ? '#2fd6ae' : '#ff6b5e', marginLeft:4}}>{m.lean > 0 ? '▲' : '▼'}</span>
                )}
              </span>
              {m.dir !== 0 && (
                <span className="mono" style={{fontSize:10.5, fontWeight:800, padding:'2px 7px', borderRadius:6, flexShrink:0,
                  color:'#051b21', background:dcol}}>{m.grade} · {m.confidence}%</span>
              )}
              <span className="mono" style={{flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:10.5, color:'var(--dim)'}}>
                {(m.provisional ? '' : '🌐 ') + m.ladder.map(f => f.id + (f.dir > 0 ? '▲' : f.dir < 0 ? '▼' : '•')).join(' ')}
              </span>
              {m.dir !== 0 && L && (
                <button className="stratbtn" onClick={(ev) => {
                    ev.stopPropagation();
                    if(tryOpenPaper(m.dir, L.entry, L.sl, L.tp1, L.tp2, m.state === 'setup' ? 'strategy:' + (m.srcStrategy || 'master') : 'signal', m.confidence, signal ? signal.entryQuality : null, signal, m.srcStrategy ? { strategy: m.srcStrategy } : undefined)){
                      Bus.show('▶ ' + (m.dir > 0 ? 'KUP' : 'SPRZEDAJ') + ' (paper) @ ' + fmtPrice(L.entry) + (m.state === 'setup' ? ' — setup warunkowy 🏛' : ''));
                    }
                  }}
                  style={{color: m.dir > 0 ? '#051b21' : '#fff', background: m.dir > 0 ? '#2fd6ae' : '#ff6b5e'}}>
                  ▶ {m.dir > 0 ? 'KUP' : 'SPRZEDAJ'}
                </button>
              )}
            </div>
            {/* wiersz 2: pasek gotowości */}
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span className="readybar"><i style={{width: Math.max(6, m.readiness) + '%', background: rc}} /></span>
              <span className="mono" style={{fontSize:10, fontWeight:800, color: rc, flexShrink:0, minWidth:64, textAlign:'right'}}>
                {m.readiness >= 100 ? 'GOTOWE' : 'gotowość ' + m.readiness + '%'}
              </span>
            </div>
            {/* wiersz 3: poziomy albo status lejka / veto */}
            <div className="mono" style={{fontSize:10.5, color: m.veto ? 'var(--ema9)' : 'var(--dim2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              {L
                ? (m.state === 'setup' ? '(warunkowo 🏛) ' : '') + 'E ' + fmtPrice(L.entry) + ' · SL ' + fmtPrice(L.sl) + ' · TP1 ' + fmtPrice(L.tp1) + ' · TP2 ' + fmtPrice(L.tp2)
                : m.label}
            </div>
          </div>
        );
      })()}

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
            {master && master.dir !== 0 && op.dir !== master.dir && (
              <div className="mono" style={{fontSize:10.5, fontWeight:800, color:'var(--ema9)'}}>
                ⚠ przeciw werdyktowi ⚡ MASTER ({master.verdict}) — to gra na korektę, nie z trendem
              </div>
            )}
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

      <div style={{flex:1, display:'flex', flexDirection:'column', position:'relative', minHeight:160}}>
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
          posMarkers={posMarkers}
          resetKey={item.sym + '|' + tf.id}
        />
        {/* zawsze widoczny przycisk pełnego ekranu (pasek górny bywa ciasny na wąskich ekranach) */}
        {candlesSafe.length > 0 && (
          <button title="Pełny ekran wykresu" onClick={() => setFs(true)}
            style={{position:'absolute', top:8, right:8, zIndex:5, width:34, height:34, borderRadius:10,
              display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(5,27,33,.72)', border:'1px solid var(--border2)', color:'var(--text)', backdropFilter:'blur(3px)'}}>
            <span style={{fontSize:16, lineHeight:1}}>⛶</span>
          </button>
        )}
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
                {signal.sizing && signal.dir !== 0 && <span className="mono" style={{fontSize:11, padding:'3px 8px', borderRadius:7, background:'var(--bg)', border:'1px solid var(--border)', color: signal.sizing.defensive ? 'var(--ema9)' : 'var(--dim)'}}>ryzyko {signal.sizing.riskPct}%{signal.sizing.defensive ? ' · tryb obronny (DD>5R)' : ''}</span>}
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
                    if(prefs.freeTrade === false && journal.some(e => e.paper && e.result === 'open' && e.sym === item.sym)){
                      Bus.show('Masz już otwartą pozycję paper na ' + item.sym);
                      return;
                    }
                    if(tryOpenPaper(signal.dir, signal.levels.entry, signal.levels.sl, signal.levels.tp1, signal.levels.tp2, 'signal', signal.score, signal.entryQuality, signal)){
                      Bus.show('▶ Otwarto pozycję paper @ ' + fmtPrice(signal.levels.entry) + ' — rozliczy się sama na SL/TP');
                    }
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
                if(tryOpenPaper(d, ticket.entry, sl, t1, isFinite(t2) ? t2 : null, 'manual', null)){
                  Bus.show('▶ Pozycja paper otwarta @ ' + fmtPrice(ticket.entry));
                }
                setTicket(null);
              }}>Otwórz pozycję (paper)</button>
          </div>
        </div>
      )}


      {showStrat && (
        <div className="modal-bg" onClick={() => setShowStrat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'center', gap:9, marginBottom:6}}>
              <span style={{fontWeight:900, fontSize:16}}>🏛 Ranking strategii</span>
              <span className="tag mono">{item.sym} · {tf.label}</span>
              <span className="spacer" />
              {stratRank && <span className="mono" style={{fontSize:10.5, color:'var(--dim2)'}}>{stratRank.regime} · {stratRank.session}</span>}
            </div>
            <div style={{overflowY:'auto', flex:1}}>
              {!stratRank && <div style={{fontSize:13, color:'var(--dim2)', padding:'20px 4px'}}>Poczekaj na dane wykresu (min 60 świec).</div>}
              {stratRank && (
                <>
                  {/* WERDYKT */}
                  <div style={{background:'var(--bg)', border:'1px solid ' + (stratRank.dir > 0 ? 'rgba(47,214,174,.45)' : stratRank.dir < 0 ? 'rgba(255,107,94,.45)' : 'var(--border2)'), borderRadius:12, padding:'10px 12px', marginBottom:8}}>
                    <div style={{display:'flex', alignItems:'baseline', gap:10}}>
                      <span style={{fontWeight:900, fontSize:20, color: stratRank.dir > 0 ? 'var(--up)' : stratRank.dir < 0 ? 'var(--down)' : 'var(--dim)'}}>{stratRank.verdict}</span>
                      {stratRank.best && <span style={{fontSize:12, fontWeight:700, color:'var(--text)'}}>{stratRank.best.name}</span>}
                      <span className="spacer" />
                      {stratRank.best && <span className="mono" style={{fontSize:12, fontWeight:800, color:'#c792ff'}}>{stratRank.confidence}%</span>}
                    </div>
                    {stratRank.levels && (
                      <div className="mono" style={{fontSize:11.5, marginTop:6, lineHeight:1.7}}>
                        <div>Entry <b>{fmtPrice(stratRank.levels.entry)}</b> · SL <b style={{color:'var(--down)'}}>{fmtPrice(stratRank.levels.sl)}</b> · R:R {stratRank.expectedRR}</div>
                        <div>TP1 {fmtPrice(stratRank.levels.tp1)} · TP2 {fmtPrice(stratRank.levels.tp2)} · TP3 {fmtPrice(stratRank.levels.tp3)} · TP4 {fmtPrice(stratRank.levels.tp4)}</div>
                        <div style={{color:'var(--dim2)'}}>trailing: {stratRank.levels.trailing}</div>
                        <div>P(win) ~{Math.round(stratRank.probability*100)}% <span style={{color:'var(--dim2)'}}>({stratRank.probabilitySrc})</span></div>
                      </div>
                    )}
                    {stratRank.dir !== 0 && stratRank.levels
                      && !journal.some(e => e.paper && (e.result === 'open' || e.result === 'pending') && e.sym === item.sym) && (
                      <button className="chip mono sel" style={{width:'100%', justifyContent:'center', padding:'10px', marginTop:8, fontSize:13,
                        color: stratRank.dir > 0 ? 'var(--up)' : 'var(--down)'}}
                        onClick={() => {
                          const L = stratRank.levels;
                          if(tryOpenPaper(stratRank.dir, L.entry, L.sl, L.tp1, L.tp2, 'strategy:' + stratRank.best.id, stratRank.confidence, null, signal, { strategy: stratRank.best.id })){
                            Bus.show('▶ Paper z rankingu: ' + stratRank.best.name + ' — wynik zasili uczenie strategii');
                            setShowStrat(false);
                          }
                        }}>▶ Otwórz paper wg tej strategii</button>
                    )}
                  </div>

                  {/* SUB-SCORES */}
                  <div style={{display:'flex', gap:5, flexWrap:'wrap', marginBottom:8}}>
                    {[['Struktura', stratRank.scores.marketStructure], ['Trend', stratRank.scores.trend], ['Momentum', stratRank.scores.momentum],
                      ['Płynność', stratRank.scores.liquidity], ['Zmienność', stratRank.scores.volatility], ['Ryzyko', stratRank.scores.risk]].map(([l, v], k) => (
                      <span key={k} className="mono" style={{fontSize:10.5, padding:'3px 8px', borderRadius:7, background:'var(--bg)', border:'1px solid var(--border)',
                        color: l === 'Ryzyko' ? (v > 60 ? 'var(--down)' : 'var(--dim)') : (v >= 65 ? 'var(--up)' : v <= 35 ? 'var(--down)' : 'var(--dim)')}}>{l} {v}</span>
                    ))}
                    {stratRank.mtf && stratRank.mtf.frames.length > 0 && (
                      <span className="mono" style={{fontSize:10.5, padding:'3px 8px', borderRadius:7, background:'var(--bg)', border:'1px solid rgba(199,146,255,.35)', color:'#c792ff'}}>
                        MTF {stratRank.mtf.align > 0 ? '▲' : stratRank.mtf.align < 0 ? '▼' : '•'} {stratRank.mtf.frames.map(f => f.id + (f.dir > 0 ? '↑' : f.dir < 0 ? '↓' : '·')).join(' ')}
                      </span>
                    )}
                  </div>

                  {/* RANKING */}
                  <div className="section-label" style={{padding:'4px 0'}}>Ranking wykrytych strategii</div>
                  {stratRank.ranking.length === 0 && <div style={{fontSize:12, color:'var(--dim2)', padding:'6px 2px'}}>Żaden detektor nie widzi aktywnego setupu na tej świecy.</div>}
                  {stratRank.ranking.map((r, k) => {
                    const isExp = expStrat === r.id;
                    const L = r.levels;
                    return (
                      <React.Fragment key={r.id}>
                        <div style={{display:'flex', alignItems:'center', gap:8, padding:'5px 2px', borderBottom: isExp ? 'none' : '1px solid var(--border)', cursor:'pointer'}}
                          onClick={() => setExpStrat(x => x === r.id ? null : r.id)}>
                          <span className="mono" style={{width:16, color:'var(--dim2)', fontSize:11}}>{k+1}.</span>
                          <span style={{color: r.dir > 0 ? 'var(--up)' : 'var(--down)', fontWeight:900, width:14}}>{r.dir > 0 ? '▲' : '▼'}</span>
                          <span style={{flex:1, fontSize:12.5, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{isExp ? '▾ ' : '▸ '}{r.name}</span>
                          <span className="sgauge" style={{width:52}}><i style={{width: r.score + '%', background: r.score >= 60 ? '#c792ff' : '#8fb0ac'}} /></span>
                          <span className="mono" style={{fontSize:12, fontWeight:800, width:38, textAlign:'right', color: r.score >= 60 ? '#c792ff' : 'var(--dim)'}}>{r.score}%</span>
                        </div>
                        {isExp && L && (
                          <div style={{margin:'0 0 6px 20px', padding:'8px 10px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, borderBottom:'1px solid var(--border)'}}>
                            {r.score < 60 && (
                              <div style={{fontSize:10.5, color:'var(--ema9)', marginBottom:4}}>⚠ scenariusz WARUNKOWY ({r.score}% &lt; próg 60%) — poziomy orientacyjne, czekaj na spełnienie warunków</div>
                            )}
                            <div className="mono" style={{fontSize:11.5, lineHeight:1.7}}>
                              <div>Entry <b>{fmtPrice(L.entry)}</b> · SL <b style={{color:'var(--down)'}}>{fmtPrice(L.sl)}</b> <span style={{color:'var(--dim2)'}}>({fmtPrice(L.slDist)} pkt)</span></div>
                              <div>TP1 <b style={{color:'var(--up)'}}>{fmtPrice(L.tp1)}</b> · TP2 {fmtPrice(L.tp2)} · TP3 {fmtPrice(L.tp3)} · TP4 {fmtPrice(L.tp4)}</div>
                              <div style={{color:'var(--dim2)'}}>P(win) ~{Math.round((r.probability || 0)*100)}% ({r.probabilitySrc}) · {r.learn}</div>
                            </div>
                            <div style={{fontSize:11, color:'var(--dim)', marginTop:4, lineHeight:1.5}}>{r.why.join(' · ')}</div>
                            <div style={{fontSize:10.5, color:'var(--down)', marginTop:2}}>unieważnia: {r.invalidates.join(' · ')}</div>
                            {!journal.some(e => e.paper && (e.result === 'open' || e.result === 'pending') && e.sym === item.sym) && (
                              <button className="chip mono" style={{width:'100%', justifyContent:'center', padding:'8px 0', marginTop:6, fontSize:12,
                                color: r.dir > 0 ? 'var(--up)' : 'var(--down)', borderColor: r.dir > 0 ? 'rgba(47,214,174,.4)' : 'rgba(255,107,94,.4)'}}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  if(tryOpenPaper(r.dir, L.entry, L.sl, L.tp1, L.tp2, 'strategy:' + r.id, r.score, null, signal, { strategy: r.id })){
                                    Bus.show('▶ Paper: ' + r.name + (r.score < 60 ? ' (scenariusz warunkowy!)' : '') + ' — wynik zasili uczenie');
                                    setShowStrat(false);
                                  }
                                }}>▶ Otwórz paper wg tej strategii ({r.dir > 0 ? 'LONG' : 'SHORT'})</button>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* EXPLAIN AI */}
                  <div className="section-label" style={{padding:'10px 0 4px'}}>Explain AI — dlaczego ta decyzja</div>
                  <div style={{background:'var(--bg)', border:'1px solid var(--border)', borderRadius:12, padding:'9px 12px', fontSize:12, lineHeight:1.65}}>
                    {stratRank.explain.why.map((w, k) => <div key={'w'+k}>• {w}</div>)}
                    {stratRank.explain.rejected && stratRank.explain.rejected.length > 0 && (
                      <div style={{marginTop:6}}><b style={{color:'var(--dim)'}}>Odrzucone / niżej:</b>{stratRank.explain.rejected.map((t, k) => <div key={'r'+k} style={{color:'var(--dim2)'}}>· {t}</div>)}</div>
                    )}
                    {stratRank.explain.invalidates && (
                      <div style={{marginTop:6}}><b style={{color:'var(--down)'}}>Unieważni analizę:</b>{stratRank.explain.invalidates.map((t, k) => <div key={'i'+k} style={{color:'var(--dim2)'}}>· {t}</div>)}</div>
                    )}
                    {(stratRank.explain.conditions || stratRank.explain.watch) && (
                      <div style={{marginTop:6}}><b style={{color:'var(--up)'}}>Warunki / co obserwować:</b>{(stratRank.explain.conditions || stratRank.explain.watch).map((t, k) => <div key={'c'+k} style={{color:'var(--dim2)'}}>· {t}</div>)}</div>
                    )}
                    {stratRank.explain.improves && (
                      <div style={{marginTop:6}}><b style={{color:'var(--cyan)'}}>Zwiększy prawdopodobieństwo:</b>{stratRank.explain.improves.map((t, k) => <div key={'p'+k} style={{color:'var(--dim2)'}}>· {t}</div>)}</div>
                    )}
                  </div>

                  <div style={{marginTop:10, fontSize:10.5, color:'var(--dim2)', lineHeight:1.6}}>{stratRank.disclaimer}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showBt && (
        <div className="modal-bg" onClick={() => setShowBt(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'center', gap:9, marginBottom:8}}>
              <span style={{fontWeight:900, fontSize:16}}>⟲ Backtest silnika</span>
              <span className="tag mono">{item.sym} · {tf.label} · {bt.res && bt.res.trainMeta ? bt.res.trainMeta.candles + ' świec' + (bt.res.trainMeta.source ? ' · ' + bt.res.trainMeta.source : '') : candlesSafe.length + ' świec (wykres)'}</span>
            </div>
            <div style={{overflowY:'auto', flex:1}}>
              <button className="chip sel mono"
                style={{width:'100%', justifyContent:'center', padding:'12px', fontSize:14, opacity: bt.busy ? 0.6 : 1}}
                onClick={async () => {
                  if(bt.busy || !ind || candlesSafe.length < 90){
                    if(!bt.busy) Bus.show('Za mało świec do backtestu (min 90)');
                    return;
                  }
                  setBt({ busy:true, res:null });
                  /* [FIX] backtest na MAKSYMALNEJ historii (nie 5 dni z wykresu) —
                     żeby nie pokazywał „3 transakcji" na tak małej próbie */
                  let cc = candlesSafe, cpack = { ind, emaData, hasVol }, cext = false, csrc = 'wykres';
                  if(tf.id !== 'D1'){
                    try{
                      const tc = await fetchTrainingCandles(item.sym, tf, candlesSafe);
                      if(tc.candles && tc.candles.length > candlesSafe.length){
                        cc = tc.candles; cext = tc.extended; csrc = tc.source || 'wykres';
                        cpack = indicatorsFor(cc, tf.id) || cpack;
                      }
                    }catch(e){}
                  }
                  setTimeout(() => {
                    const r = backtestEngine(cc, cpack.ind, cpack.emaData, cpack.hasVol, item.sym, prefs.minScore, prefs.smc,
                      { weights: Store.get('rt_model_weights', null), calib: Store.get('rt_model_calib', null), knn: Store.get('rt_knn_history', null), tfId: tf.id });
                    r.trainMeta = { candles: cc.length, extended: cext, source: csrc };
                    r.candlesUsed = cc;
                    setBt({ busy:false, res:r });
                  }, 40);
                }}>
                {bt.busy ? 'Liczę świeca po świecy…' : 'Uruchom backtest (maks. historia)'}
              </button>
              <button className="chip mono"
                style={{width:'100%', justifyContent:'center', padding:'10px', fontSize:13, marginTop:8, color:'var(--cyan)', borderColor:'rgba(79,216,255,.4)', opacity: bt.busy ? 0.6 : 1}}
                onClick={async () => {
                  if(bt.busy || !ind || candlesSafe.length < 90){ if(!bt.busy) Bus.show('Poczekaj na dane wykresu'); return; }
                  if(trainCool > 0){ Bus.show('⏳ Cooldown treningu: odczekaj ' + trainCool + ' s'); return; } // [E2-4]
                  if(tf.id === 'D1'){ Bus.show('Trening wag działa na interwałach śróddziennych (M5–H1)'); return; }
                  setTrainCool(60);
                  setBt({ busy:true, res:null });
                  Bus.show('⏳ Pobieram maksymalną historię do treningu…');
                  /* [FIX] trening na MAKSYMALNEJ historii Yahoo (nie 5 dni z wykresu) —
                     wprost mnoży podaż etykiet TP1/SL, które gatowały „za mało próbek" */
                  let tc, tpack, trainCandles, ext = false, tsrc = 'wykres';
                  try{
                    tc = await fetchTrainingCandles(item.sym, tf, candlesSafe);
                    trainCandles = tc.candles; ext = tc.extended; tsrc = tc.source || 'wykres';
                    tpack = indicatorsFor(trainCandles, tf.id);
                  }catch(e){ trainCandles = candlesSafe; tpack = { ind, emaData, hasVol }; }
                  if(!tpack || !trainCandles || trainCandles.length < 250){
                    setBt({ busy:false, res:null });
                    Bus.show('Za mało historii do treningu (' + (trainCandles ? trainCandles.length : 0) + ' świec, min 250) — Yahoo nie daje dłuższej dla ' + tf.label);
                    return;
                  }
                  setTimeout(() => {
                    const wf = walkForwardKFold(trainCandles, tpack.ind, tpack.emaData, tpack.hasVol, item.sym, prefs.minScore, prefs.smc, tf.id, { timeBudgetMs: 20000 });
                    if(wf && wf.ok){
                      /* [E2-3] pełna aktywacja dopiero po 2 treningach reliable ≥24 h */
                      const prevMeta = Store.get('rt_model_meta', null);
                      const st = nextModelStage(prevMeta, !!wf.reliable, Date.now());
                      Store.set('rt_model_weights', wf.weights);
                      Store.set('rt_model_calib', wf.calib || null); // [A1] kalibracja WYŁĄCZNIE z pooled OOS
                      Store.set('rt_knn_history', wf.samples && wf.samples.length >= 40 ? wf.samples : null);
                      const meta = {
                        sym: item.sym, tf: tf.id, // [E3-1] monitoring wie, czego pilnować
                        n: wf.training.n,
                        reliable: st.stage === 'active', // konsumenci __reliable bez zmian
                        kfReliable: !!wf.reliable, reliableWhy: wf.reliableWhy || [],
                        stage: st.stage, reliableStreak: st.streak, candidateAt: st.candidateAt,
                        totalNoos: wf.totalNoos,
                        oosPairsN: wf.oosPairsN, agg: wf.agg, payout: wf.payout,
                        regimeCoverage: wf.regimeCoverage, at: Date.now(),
                        trainCandles: trainCandles.length, trainExtended: ext, trainSource: tsrc, // [FIX] ile świec i skąd
                        /* [E3-5] odcisk danych treningowych: pierwsza/ostatnia świeca + n */
                        dataHash: trainCandles.length ? (trainCandles[0].t + '-' + trainCandles[trainCandles.length-1].t + '-' + trainCandles.length) : null,
                      };
                      /* [E3-5] każdy trening = nowa wersja (max 3, FIFO) */
                      const knnPayload = wf.samples && wf.samples.length >= 40 ? wf.samples : null;
                      meta.modelV = saveModelVersion(item.sym, tf.id, { weights: wf.weights, calib: wf.calib || null, meta, knn: knnPayload });
                      Store.set('rt_model_meta', meta);
                      setWv(v => v + 1);
                      Bus.show('🧠 k-fold OOS (' + trainCandles.length + ' świec · ' + tsrc + '): ' + wf.totalNoos + ' tr · med avgR ' + (wf.agg.avgR.med != null ? wf.agg.avgR.med : '—') + 'R'
                        + (wf.agg.brier.p75 != null ? ' · Brier p75 ' + wf.agg.brier.p75 : '')
                        + ' · ' + stageLabel(meta));
                    } else if(wf && wf.samplesCollected != null){
                      /* [FIX] czytelny komunikat zamiast gołego „za mało próbek": ile
                         zebrano vs potrzeba i dlaczego (BE/TIMEOUT poza etykietami K5) */
                      Bus.show('⚠ Za mało etykiet TP1/SL: zebrano ' + wf.samplesCollected + ' z ' + wf.samplesNeeded
                        + ' (na ' + trainCandles.length + ' świecach było ' + wf.tradesN + ' transakcji, reszta to BE/TIMEOUT). '
                        + 'Ten instrument·TF handluje za rzadko — spróbuj większy interwał (M15/H1) lub bardziej zmienny instrument.');
                    } else {
                      Bus.show('Trening nieudany: ' + (wf ? wf.reason : 'brak danych'));
                    }
                    const r = backtestEngine(trainCandles, tpack.ind, tpack.emaData, tpack.hasVol, item.sym, prefs.minScore, prefs.smc,
                      { weights: Store.get('rt_model_weights', null), calib: Store.get('rt_model_calib', null), knn: Store.get('rt_knn_history', null), tfId: tf.id });
                    r.wf = wf;
                    r.trainMeta = { candles: trainCandles.length, extended: ext, source: tsrc };
                    r.candlesUsed = trainCandles;
                    setBt({ busy:false, res:r });
                  }, 40);
                }}>
                🧠 Trenuj wagi z backtestu (walk-forward){trainCool > 0 ? ' · ' + trainCool + ' s' : ''}
              </button>
              <button className="chip mono"
                style={{width:'100%', justifyContent:'center', padding:'8px', fontSize:12, marginTop:8, color:'var(--dim)', borderColor:'var(--border2)', opacity: bt.busy ? 0.6 : 1}}
                onClick={() => {
                  if(bt.busy || !ind || candlesSafe.length < 250){ if(!bt.busy) Bus.show('Do ablacji trzeba ≥250 świec'); return; }
                  setBt({ busy:true, res:null });
                  setTimeout(() => {
                    /* [E2-1] harness ablacyjny na bieżących świecach — wynik do konsoli */
                    const rows = ablationTable(candlesSafe, item.sym, tf.id, { minScore: prefs.minScore, smcCfg: prefs.smc, timeBudgetMs: 60000 });
                    console.log('[ABLACJA] ' + item.sym + ' · ' + tf.id + '\n' + ablationAscii(rows));
                    const scored = rows.filter(r => r.medAvgR != null).sort((a, b) => b.medAvgR - a.medAvgR);
                    Bus.show('🔬 Ablacja w konsoli · najlepsza konfiguracja: ' + (scored.length ? scored[0].konfiguracja + ' (' + scored[0].medAvgR + 'R)' : 'za mało transakcji OOS'));
                    setBt({ busy:false, res:null });
                  }, 40);
                }}>
                🔬 Ablacja (dev) — wynik do konsoli
              </button>
              {(() => {
                /* [E4-3] Adaptive Learning Control: zmienione progi SMC muszą
                   przejść k-fold vs ostatnio zwalidowane — inaczej rollback */
                const validated = Store.get('rt_smc_validated', null) || DEFAULT_SMC;
                const changed = JSON.stringify(validated) !== JSON.stringify(prefs.smc || DEFAULT_SMC);
                if(!changed) return null;
                return (
                  <button className="chip mono"
                    style={{width:'100%', justifyContent:'center', padding:'10px', fontSize:12.5, marginTop:8, color:'var(--ema9)', borderColor:'rgba(255,201,77,.45)', background:'rgba(255,201,77,.07)', opacity: bt.busy ? 0.6 : 1}}
                    onClick={() => {
                      if(bt.busy || !ind || candlesSafe.length < 250){ if(!bt.busy) Bus.show('Do walidacji trzeba ≥250 świec'); return; }
                      setBt({ busy:true, res:null });
                      setTimeout(() => {
                        const oldRes = walkForwardKFold(candlesSafe, ind, emaData, hasVol, item.sym, prefs.minScore, validated, tf.id, { timeBudgetMs: 20000 });
                        const newRes = walkForwardKFold(candlesSafe, ind, emaData, hasVol, item.sym, prefs.minScore, prefs.smc, tf.id, { timeBudgetMs: 20000 });
                        const cmp = compareValidation(oldRes, newRes);
                        logParamChange('smc.walidacja', summarizeRun(oldRes), summarizeRun(newRes), { accept: cmp.accept, reasons: cmp.reasons });
                        if(cmp.accept){
                          Store.set('rt_smc_validated', { ...(prefs.smc || DEFAULT_SMC) });
                          Bus.show('✓ Nowe progi zwalidowane OOS (' + summarizeRun(newRes) + ')' + (cmp.reasons.length ? ' · ' + cmp.reasons[0] : ''));
                        } else {
                          setPrefs(pp => ({ ...pp, smc: { ...validated } }));
                          Bus.show('↩ ROLLBACK progów SMC: ' + cmp.reasons.join('; '));
                        }
                        setBt({ busy:false, res:null });
                      }, 40);
                    }}>
                    ⚖ Zastosuj: zwaliduj zmienione progi SMC (k-fold, auto-rollback)
                  </button>
                );
              })()}
              {Store.get('rt_model_weights', null) && (() => {
                const meta = Store.get('rt_model_meta', null);
                return (
                  <div style={{marginTop:6, fontSize:10.5, color: meta && !meta.reliable ? 'var(--ema9)' : 'var(--dim2)'}} className="mono">
                    {meta && meta.reliable
                      ? 'Model używa WYUCZONYCH wag (n=' + meta.n + ', OOS ' + (meta.totalNoos || 0) + ' tr, wiarygodne).'
                      : 'Wagi zapisane, ale NIEAKTYWNE (live liczy na domyślnych). Powód: ' + ((meta && meta.reliableWhy && meta.reliableWhy.length) ? meta.reliableWhy.join(' · ') : 'model niewiarygodny') + '.'}
                    <button className="mono" style={{marginLeft:8, color:'var(--down)', background:'none', border:'none', textDecoration:'underline'}}
                      onClick={() => { Store.set('rt_model_weights', null); Store.set('rt_model_calib', null); Store.set('rt_model_meta', null); setWv(v=>v+1); Bus.show('Przywrócono wagi domyślne'); }}>reset</button>
                  </div>
                );
              })()}
              {(() => {
                /* [E3-5] wersje modelu dla sym×TF + przywracanie */
                const vers = listModelVersions(item.sym, tf.id);
                if(!vers.length) return null;
                const act = getActiveVersion(item.sym, tf.id);
                return (
                  <div style={{marginTop:8, padding:'8px 10px', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10}}>
                    <div style={{fontSize:11, color:'var(--dim2)', marginBottom:4}}>Wersje modelu · {item.sym} · {tf.label} (max 3, FIFO)</div>
                    {vers.slice().reverse().map(({ v, meta }) => (
                      <div key={v} className="kv" style={{fontSize:11.5}}>
                        <b className="mono" style={{color: v === act ? 'var(--up)' : 'var(--dim)'}}>
                          v{v}{v === act ? ' · aktywna' : ''}
                        </b>
                        <span className="mono" style={{color:'var(--dim2)'}}>
                          {meta ? (new Date(meta.at).toLocaleDateString() + ' · n=' + meta.n + ' · OOS ' + (meta.totalNoos != null ? meta.totalNoos : '—')) : '—'}
                          {v !== act && (
                            <button className="mono" style={{marginLeft:8, color:'var(--cyan)', background:'none', border:'none', textDecoration:'underline'}}
                              onClick={() => {
                                if(activateModelVersion(item.sym, tf.id, v)){ setWv(x => x + 1); Bus.show('↩ Przywrócono model v' + v); }
                              }}>przywróć</button>
                          )}
                        </span>
                      </div>
                    ))}
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
                            {(t.dir > 0 ? '▲ ' : '▼ ') + (() => { const cu = (bt.res.candlesUsed || candlesSafe); return cu[t.i0] ? fmtFull(cu[t.i0].t, tf.id) : ''; })()}
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
                        <div style={{fontSize:10.5, color:'var(--ema9)', marginTop:5, lineHeight:1.55}}>
                          ⚠ Model NIEWIARYGODNY — silnik live pozostaje na wagach domyślnych i stałym sizingu.
                          Niespełnione warunki: {(bt.res.wf.reliableWhy || []).join(' · ') || '—'}.
                        </div>
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

      {/* ===================== PEŁNY EKRAN WYKRESU ===================== */}
      {/* ⚡ modal silnika nadrzędnego MASTER — pełne uzasadnienie decyzji */}
      {showMaster && master && (() => {
        const m = master;
        const dcol = m.dir > 0 ? 'var(--up)' : m.dir < 0 ? 'var(--down)' : 'var(--dim)';
        const L = m.levels;
        return (
          <div className="modal-bg" onClick={() => setShowMaster(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:4}}>
                <span style={{fontWeight:900, fontSize:19, color:dcol}}>⚡ {m.verdict}</span>
                {m.dir !== 0 && (
                  <span className="mono" style={{fontSize:12, fontWeight:800, padding:'2px 8px', borderRadius:7, color:'#051b21',
                    background: m.dir > 0 ? '#2fd6ae' : '#ff6b5e'}}>{m.grade} · {m.confidence}%</span>
                )}
                <span style={{flex:1}} />
                <button className="iconbtn" onClick={() => setShowMaster(false)}><span style={{fontSize:15}}>✕</span></button>
              </div>
              <div style={{fontSize:11.5, color:'var(--dim2)', marginBottom:10}}>{m.label}</div>

              <div className="card" style={{marginBottom:8}}>
                <b style={{fontSize:12}}>Drabina interwałów (top-down)</b>
                <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:7}}>
                  {m.ladder.map(f => (
                    <span key={f.id} className="mono" style={{fontSize:11.5, fontWeight:800, padding:'4px 9px', borderRadius:8,
                      color: f.dir > 0 ? '#2fd6ae' : f.dir < 0 ? '#ff6b5e' : 'var(--dim)',
                      background:'var(--panel)', border:'1px solid ' + (f.cur ? 'var(--accent)' : 'var(--border2)')}}>
                      {f.id} {f.dir > 0 ? '▲' : f.dir < 0 ? '▼' : '•'}
                    </span>
                  ))}
                </div>
                <div className="mono" style={{fontSize:11, color:'var(--dim2)', marginTop:6}}>
                  zgodność ważona: {(m.align > 0 ? '+' : '') + m.align} — wyższa ramka waży więcej; master nie gra przeciw zgodnej drabinie
                </div>
                <div style={{fontSize:10.5, color: m.provisional ? 'var(--ema9)' : 'var(--dim2)', marginTop:5, lineHeight:1.5}}>
                  {m.provisional
                    ? '⏳ kanon M15 jeszcze się ładuje — werdykt tymczasowo z oglądanego interwału'
                    : '🌐 werdykt GLOBALNY: liczony zawsze z kanonu M15 — identyczny niezależnie od tego, który interwał oglądasz'}
                </div>
              </div>

              {m.veto && (
                <div style={{padding:'8px 11px', borderRadius:10, marginBottom:8, fontSize:12, lineHeight:1.5,
                  background:'rgba(255,201,77,.10)', border:'1px solid rgba(255,201,77,.4)', color:'var(--ema9)'}}>
                  🛑 {m.veto}
                </div>
              )}

              <div className="card" style={{marginBottom:8}}>
                <b style={{fontSize:12}}>Dlaczego</b>
                <ul style={{margin:'6px 0 0', paddingLeft:18, fontSize:11.5, lineHeight:1.65, color:'var(--dim)'}}>
                  {m.reasons.map((r, q) => <li key={q}>{r}</li>)}
                </ul>
              </div>

              {L && (
                <div className="card" style={{marginBottom:8}}>
                  <b style={{fontSize:12}}>{m.state === 'setup' ? 'Poziomy (setup warunkowy 🏛)' : 'Poziomy wejścia'}</b>
                  <div className="mono" style={{fontSize:12, marginTop:6, lineHeight:1.7}}>
                    E {fmtPrice(L.entry)} · SL {fmtPrice(L.sl)}<br/>TP1 {fmtPrice(L.tp1)} · TP2 {fmtPrice(L.tp2)}
                  </div>
                  <button className="chip mono sel" style={{width:'100%', justifyContent:'center', padding:'11px', marginTop:9, fontSize:13.5, fontWeight:800,
                      color: m.dir > 0 ? 'var(--up)' : 'var(--down)',
                      borderColor: m.dir > 0 ? 'rgba(47,214,174,.5)' : 'rgba(255,107,94,.5)'}}
                    onClick={() => {
                      if(tryOpenPaper(m.dir, L.entry, L.sl, L.tp1, L.tp2, m.state === 'setup' ? 'strategy:' + (m.srcStrategy || 'master') : 'signal', m.confidence, signal ? signal.entryQuality : null, signal, m.srcStrategy ? { strategy: m.srcStrategy } : undefined)){
                        Bus.show('▶ ' + (m.dir > 0 ? 'KUP' : 'SPRZEDAJ') + ' (paper) @ ' + fmtPrice(L.entry));
                        setShowMaster(false);
                      }
                    }}>
                    ▶ {m.dir > 0 ? 'KUP' : 'SPRZEDAJ'} · paper
                  </button>
                </div>
              )}

              <div style={{display:'flex', gap:8}}>
                <button className="chip mono" style={{flex:1, justifyContent:'center'}} onClick={() => { setShowMaster(false); setShowSig(true); }}>szczegóły silnika →</button>
                <button className="chip mono" style={{flex:1, justifyContent:'center', color:'#c792ff', borderColor:'rgba(199,146,255,.4)'}} onClick={() => { setShowMaster(false); setShowStrat(true); }}>🏛 pełny ranking →</button>
              </div>
            </div>
          </div>
        );
      })()}

      {fs && (
        <div style={{position:'fixed', inset:0, zIndex:200, background:'var(--bg)', display:'flex', flexDirection:'column'}}>
          {/* pasek górny: symbol · cena · WERDYKTY (silnik + ranking) · wyjście */}
          <div style={{display:'flex', alignItems:'center', gap:8, padding:'calc(env(safe-area-inset-top,0px) + 8px) 12px 4px', flexShrink:0, flexWrap:'wrap'}}>
            <b style={{fontSize:14}}>{item.sym}</b>
            <span className="mono" style={{fontSize:12.5, color:priceColor, fontWeight:800}}>{fmtPrice(data.price)}</span>
            {pct != null && <span className="mono" style={{fontSize:11, color:priceColor}}>{fmtPct(pct)}</span>}
            {data.live && <span style={{color:'var(--up)', fontSize:10, fontWeight:800}}>● LIVE</span>}
            {/* ⚡ MASTER — jeden werdykt (silnik + ranking + drabina interwałów) */}
            {master && (
              <button onClick={() => setShowMaster(true)} className="mono"
                style={{display:'inline-flex', alignItems:'center', gap:6, padding:'4px 9px', borderRadius:9, fontSize:11.5, fontWeight:800,
                  color: master.dir > 0 ? '#2fd6ae' : master.dir < 0 ? '#ff6b5e' : '#8fb0ac',
                  background:'var(--panel)', border:'1px solid ' + (master.dir > 0 ? 'rgba(47,214,174,.4)' : master.dir < 0 ? 'rgba(255,107,94,.4)' : master.veto ? 'rgba(255,201,77,.45)' : 'var(--border2)')}}>
                ⚡ {master.verdict}
                {master.dir === 0 && master.lean !== 0 && <span style={{color: master.lean > 0 ? '#2fd6ae' : '#ff6b5e'}}>{master.lean > 0 ? '▲' : '▼'}</span>}
                {master.dir !== 0 && <span style={{color:'var(--dim)', fontWeight:600}}>{master.grade}·{master.confidence}%</span>}
                {master.veto && <span style={{fontSize:12}}>🛑</span>}
              </button>
            )}
            <span style={{flex:1}} />
            <button className="iconbtn" onClick={() => { Net.blockedUntil = 0; load(); }}>
              <span className={loading ? 'spin' : ''} style={{display:'flex'}}><Ic d={IC.refresh} size={17} /></span>
            </button>
            <button className="iconbtn" title="Wyjdź z pełnego ekranu" onClick={() => setFs(false)}>
              <span style={{fontSize:16, lineHeight:1}}>✕</span>
            </button>
          </div>
          {/* TF chips + KUP/SPRZEDAJ w jednym pasku (oszczędza pion w poziomie) */}
          <div style={{display:'flex', alignItems:'center', gap:6, padding:'0 12px 4px', flexShrink:0}}>
            <div className="chiprow" style={{padding:0, flex:1}}>
              {TFS.map(t => (
                <button key={t.id} className={'chip mono' + (t.id === tf.id ? ' sel' : '')}
                  onClick={() => setPrefs(p => ({ ...p, tf:t.id }))}>{t.label}</button>
              ))}
            </div>
            {candlesSafe.length > 0 && (
              <>
                <button className="chip mono" style={{padding:'7px 12px', fontWeight:800, color:'var(--up)', borderColor:'rgba(47,214,174,.5)', flexShrink:0}}
                  onClick={() => openTicket(1)}>▲ KUP</button>
                <button className="chip mono" style={{padding:'7px 12px', fontWeight:800, color:'var(--down)', borderColor:'rgba(255,107,94,.5)', flexShrink:0}}
                  onClick={() => openTicket(-1)}>▼ SPRZEDAJ</button>
              </>
            )}
          </div>
          {/* wykres wypełnia resztę — bez pływających paneli, nic nie zasłania świec */}
          <div style={{flex:1, position:'relative', minHeight:0}}>
            <ChartCanvas
              key={'fs|' + item.sym + '|' + tf.id}
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
              posMarkers={posMarkers}
              resetKey={'fs|' + item.sym + '|' + tf.id}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ====================== [5c] EKRAN: DZIENNIK ======================== */
