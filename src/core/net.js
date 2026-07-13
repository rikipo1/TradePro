/* ========================= [2] WARSTWA DANYCH ======================== */
const W = (typeof window !== 'undefined') ? window : {}; // Node (testy) nie ma window
export const Net = {
  last: '—',                 // ostatni działający kanał
  mode: null,                // zapamiętany kanał (szybki start)
  blockedUntil: 0,           // bezpiecznik: do kiedy sieć uznana za zablokowaną
  native: !!(W.Capacitor && W.Capacitor.isNativePlatform && W.Capacitor.isNativePlatform()),
  plugin: !!(W.Capacitor && W.Capacitor.Plugins && W.Capacitor.Plugins.CapacitorHttp),
};

export const PROXIES = [
  { name:'proxy #1', raw:true,  mk:u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  { name:'proxy #2', raw:true,  mk:u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
  { name:'proxy #3', raw:true,  mk:u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u) },
  { name:'proxy #4', raw:false, mk:u => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u) },
];

/* fetch z twardym timeoutem */
export function fetchT(url, ms, opts){
  return new Promise((resolve, reject) => {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const to = setTimeout(() => {
      if(ctrl) ctrl.abort();
      reject(new Error('timeout'));
    }, ms);
    fetch(url, Object.assign({}, opts || {}, ctrl ? { signal: ctrl.signal } : {}))
      .then(r => { clearTimeout(to); resolve(r); })
      .catch(e => { clearTimeout(to); reject(e); });
  });
}

/* pierwszy udany z listy promisów (wyścig) */
export function firstOk(promises){
  return new Promise((resolve, reject) => {
    let pending = promises.length, done = false;
    if(!pending) return reject(new Error('empty'));
    promises.forEach(p => {
      p.then(v => { if(!done){ done = true; resolve(v); } })
       .catch(() => { pending--; if(pending === 0 && !done) reject(new Error('all failed')); });
    });
  });
}

export async function viaProxy(p, url, ms){
  const r = await fetchT(p.mk(url), ms);
  if(!r.ok) throw new Error('http ' + r.status);
  if(p.raw){
    const t = await r.text();
    if(!t) throw new Error('pusta odpowiedź');
    Net.last = p.name; Net.mode = p.name;
    return t;
  }
  const w = await r.json();
  if(!(w && w.contents)) throw new Error('pusta odpowiedź');
  Net.last = p.name; Net.mode = p.name;
  return w.contents;
}

/* --- pamięć podręczna + limit współbieżności + deduplikacja --- */
export const Cache = new Map();      // url -> { t, data, src }
export const Pending = new Map();    // url -> Promise
export const FRESH_MS = 10000;       // dane uznawane za świeże
export const STALE_MS = 10*60*1000;  // awaryjnie serwuj do 10 min wstecz
export let netBusy = 0; const netQueue = [];
export function netAcquire(){
  return new Promise(res => { if(netBusy < 2){ netBusy++; res(); } else netQueue.push(res); });
}
export function netRelease(){
  netBusy--;
  const n = netQueue.shift();
  if(n){ netBusy++; n(); }
}
export async function fetchText(url){
  const hit = Cache.get(url);
  if(hit && Date.now() - hit.t < FRESH_MS){
    Net.last = hit.src + ' · cache';
    return hit.data;
  }
  if(Pending.has(url)) return Pending.get(url);
  const p = (async () => {
    await netAcquire();
    try{
      const data = await fetchTextNet(url);
      Cache.set(url, { t: Date.now(), data, src: Net.last });
      return data;
    }catch(e){
      const st = Cache.get(url);
      if(st && Date.now() - st.t < STALE_MS){
        Net.last = 'pamięć podręczna (' + Math.round((Date.now()-st.t)/1000) + ' s temu)';
        return st.data;
      }
      throw e;
    }finally{
      netRelease();
      Pending.delete(url);
    }
  })();
  Pending.set(url, p);
  return p;
}
export async function fetchJson(url){
  const t = await fetchText(url);
  if(typeof t !== 'string') return t;
  try{
    return JSON.parse(t);
  }catch(e){
    Cache.delete(url);
    throw new Error('Niepoprawna odpowiedź z serwera danych (nie-JSON)');
  }
}

export async function fetchTextNet(url){
  /* bezpiecznik: po pełnej porażce odpuszczamy sieć na 12 s */
  if(Net.blockedUntil && Date.now() < Net.blockedUntil){
    throw new Error('Chwilowa przerwa po nieudanych próbach — odczekaj kilka sekund lub odśwież ręcznie.');
  }
  // 1) natywny HTTP (Capacitor) — omija CORS w APK
  if(Net.plugin){
    try{
      const res = await window.Capacitor.Plugins.CapacitorHttp.get({ url, headers:{ 'Accept':'application/json, text/plain, */*' } });
      if(res && res.status >= 200 && res.status < 300){
        Net.last = 'natywny (CapacitorHttp)'; Net.mode = 'cap';
        return (typeof res.data === 'string') ? res.data : JSON.stringify(res.data);
      }
    }catch(e){}
  }
  /* zapasowy host Yahoo — query2 przejmuje, gdy query1 limituje */
  const hosts = (url.indexOf('query1.finance.yahoo.com') !== -1)
    ? [url, url.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com')]
    : [url];
  // 2) zapamiętane proxy z poprzedniego sukcesu — jedna szybka próba
  if(Net.mode && Net.mode.indexOf('proxy') === 0){
    const p = PROXIES.find(x => x.name === Net.mode);
    if(p){ try{ return await viaProxy(p, hosts[0], 5000); }catch(e){} }
  }
  // 3) bezpośredni fetch (3.5 s)
  try{
    const r = await fetchT(hosts[0], 3500, { headers:{ 'Accept':'application/json, text/plain, */*' } });
    if(r.ok){ Net.last = 'bezpośredni fetch'; Net.mode = 'direct'; return await r.text(); }
  }catch(e){}
  // 4) proxy równolegle, hosty na przemian; druga runda po 1.2 s
  for(let round = 0; round < 2; round++){
    try{
      return await firstOk(PROXIES.map((p, i) => viaProxy(p, hosts[(i + round) % hosts.length], 6000)));
    }catch(e){}
    if(round === 0) await new Promise(res => setTimeout(res, 1200));
  }
  Net.blockedUntil = Date.now() + 12000;
  Net.mode = null;
  throw new Error('Nie udało się pobrać notowań. Publiczne proxy CORS bywają przeciążone — spróbuj za chwilę lub przełącz na DEMO. Pełną stabilność daje wersja APK (natywny HTTP).');
}
