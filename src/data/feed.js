import { Bus } from '../core/bus.js';
import { Net, fetchJson } from '../core/net.js';
import { CAP_MAP, capEnabled, capWarned, capitalChart, setCapWarned } from './capital.js';
import { stooqDaily } from './stooq.js';
import { yahooChart } from './yahoo.js';
import { atrSeries, emaOver } from '../indicators/index.js';
import { zigzag } from '../patterns/index.js';
import { marketStructure } from '../smc/index.js';

export async function fetchChart(symbol, tf){
  if(capEnabled() && CAP_MAP[symbol]){
    try{
      return await capitalChart(symbol, tf);
    }catch(e){
      if(!capWarned){
        setCapWarned(true);
        Bus.show('Capital.com: ' + (e.message || 'błąd') + ' — używam Yahoo (opóźnione)');
      }
    }
  }
  try{
    return await yahooChart(symbol, tf);
  }catch(e){
    if(tf.id === 'D1'){
      try{ return await stooqDaily(symbol); }catch(e2){}
    }
    throw e;
  }
}

export async function searchSymbols(qstr){
  const url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(qstr)
    + '&quotesCount=8&newsCount=0&listsCount=0';
  const j = await fetchJson(url);
  return (j.quotes || []).filter(x => x.symbol).map(x => ({
    sym:  x.symbol,
    name: x.shortname || x.longname || x.symbol,
    exch: x.exchDisp || x.exchange || '',
    type: x.quoteType || '',
  }));
}

/* zbiorcze notowania dla całej watchlisty — JEDNO zapytanie (Yahoo spark) */
export async function fetchQuotes(symbols){
  const url = 'https://query1.finance.yahoo.com/v8/finance/spark?symbols='
    + encodeURIComponent(symbols.join(',')) + '&range=1d&interval=5m';
  let j = null;
  try{ j = await fetchJson(url); }catch(e){ return {}; }
  const arr = (j && j.spark && j.spark.result) || (j && j.result) || [];
  const out = {};
  for(let i=0;i<arr.length;i++){
    const it = arr[i];
    try{
      const resp = (it.response && it.response[0]) || it;
      const meta = resp.meta || {};
      let closes = [];
      if(resp.indicators && resp.indicators.quote && resp.indicators.quote[0] && resp.indicators.quote[0].close){
        closes = resp.indicators.quote[0].close.filter(v => v != null);
      } else if(resp.close){
        closes = resp.close.filter(v => v != null);
      }
      const price = (meta.regularMarketPrice != null) ? meta.regularMarketPrice
        : (closes.length ? closes[closes.length-1] : null);
      const prev = (meta.chartPreviousClose != null) ? meta.chartPreviousClose
        : (meta.previousClose != null) ? meta.previousClose
        : (closes.length ? closes[0] : null);
      const sym = it.symbol || meta.symbol;
      if(sym) out[sym] = { price, prev, closes };
    }catch(e){}
  }
  return out;
}

/* --------------------- STAŁE CZASOWE / HTF ------------------ */
export const TF_SEC = { M1:60, M5:300, M15:900, M30:1800, H1:3600, D1:86400 };
/* mapowanie interwału na wyższy interwał do filtra trendu */
export const HTF_MAP = { M1:{id:'M15',label:'M15'}, M5:{id:'M15',label:'M15'}, M15:{id:'H1',label:'H1'}, M30:{id:'H1',label:'H1'}, H1:{id:'D1',label:'D1'}, D1:null };
/* agregacja świec z niższego TF do wyższego (buckety po czasie) i kierunek EMA */
export function htfTrend(candles, tfId){
  const map = HTF_MAP[tfId];
  if(!map || !candles || candles.length < 60) return { dir:0, label: map ? map.label : '' };
  const step = TF_SEC[map.id];
  const buckets = new Map();
  for(let q=0;q<candles.length;q++){
    const c = candles[q];
    const key = Math.floor(c.t / step) * step;
    let b = buckets.get(key);
    if(!b){ b = { t:key, o:c.o, h:c.h, l:c.l, c:c.c }; buckets.set(key, b); }
    else { if(c.h > b.h) b.h = c.h; if(c.l < b.l) b.l = c.l; b.c = c.c; }
  }
  const agg = Array.from(buckets.values()).sort((a,b) => a.t - b.t);
  if(agg.length < 25) return { dir:0, label: map.label };
  const closes = agg.map(x => x.c);
  const e20 = emaOver(closes, 20), e50 = emaOver(closes, 50);
  const i = closes.length - 1;
  const p = closes[i], a20 = e20[i], a50 = e50[i], a20p = e20[i-3];
  /* trend HTF ze STRUKTURY (HH/HL/LH/LL), EMA jako potwierdzenie/fallback */
  let structDir = 0;
  try{
    const aggC = agg.map(x => ({ t:x.t, o:x.o, h:x.h, l:x.l, c:x.c, v:0 }));
    const atrH = atrSeries(aggC, 14);
    const pivH = zigzag(aggC, atrH);
    const msH = marketStructure(pivH, aggC.length - 1);
    if(msH) structDir = msH.trend;
  }catch(e){}
  let emaDir = 0;
  if(a20 != null && a50 != null){
    if(p > a20 && a20 > a50 && (a20p == null || a20 >= a20p)) emaDir = 1;
    else if(p < a20 && a20 < a50 && (a20p == null || a20 <= a20p)) emaDir = -1;
  }
  /* struktura ma priorytet; gdy niejednoznaczna, decyduje EMA;
     gdy struktura i EMA są sprzeczne → 0 (brak czystego trendu HTF) */
  let dir = 0;
  if(structDir !== 0 && emaDir !== 0) dir = (structDir === emaDir) ? structDir : 0;
  else dir = structDir !== 0 ? structDir : emaDir;
  return { dir, label: map.label };
}
/* [E3-1] licznik świeżości/luk per źródło (ostatnie 24 h) — widoczny w INFO */
export const FeedHealth = { bySrc: {} };
function feedHealthNote(src, staleFlag){
  const now = Date.now();
  let h = FeedHealth.bySrc[src];
  if(!h || now - h.since > 24*3600*1000){ h = { since: now, checks: 0, stale: 0 }; FeedHealth.bySrc[src] = h; }
  h.checks++;
  if(staleFlag) h.stale++;
  h.lastTs = now;
}

/* wybór źródła: tylko realne dane na żywo (DEMO usunięte) */
export async function getChart(symbol, tf, source){
  const r = await fetchChart(symbol, tf);
  r.demo = false;
  try{
    const last = r.candles && r.candles.length ? r.candles[r.candles.length-1] : null;
    const step = TF_SEC[tf.id] || 300;
    const stale = !!(last && (Date.now()/1000 - last.t) > step*2 + 90);
    r.stale = stale;
    feedHealthNote(Net.last || '—', stale);
  }catch(e){}
  return r;
}
