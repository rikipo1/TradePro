import { Net, fetchT } from '../core/net.js';

/* ------------- Capital.com — realtime LIVE (darmowe API brokera) ------------- */
export const CAP_MAP = {
  '^GDAXI':'GERMANY40', '^DJI':'US30', '^GSPC':'US500', '^IXIC':'US100',
  'GC=F':'GOLD', 'EURUSD=X':'EURUSD', 'BTC-USD':'BTCUSD',
};
export const CAP_RES = { M1:'MINUTE', M5:'MINUTE_5', M15:'MINUTE_15', M30:'MINUTE_30', H1:'HOUR', D1:'DAY' };
export const CapCfg = { on:false, demo:false, key:'', id:'', pass:'' };
export const CapSess = { cst:null, xst:null, at:0, acctSet:false };
export let capWarned = false;
export function capEnabled(){ return !!(CapCfg.on && CapCfg.key && CapCfg.id && CapCfg.pass); }
export const CapDbg = { last:null };
export async function capRaw(path, method, body, extraHeaders){
  const base = CapCfg.demo ? 'https://demo-api-capital.backend-capital.com' : 'https://api-capital.backend-capital.com';
  const url = base + path;
  const headers = Object.assign({ 'Content-Type':'application/json', 'Accept':'application/json' }, extraHeaders || {});
  const parse = (d) => {
    if(d == null) return null;
    if(typeof d !== 'string') return d;
    try{ return JSON.parse(d); }catch(e){ return d; }
  };
  try{
    if(Net.plugin){
      const fn = (method === 'POST' || method === 'PUT') ? method.toLowerCase() : 'get';
      const opts = { url, headers };
      if(body != null) opts.data = JSON.stringify(body);
      const res = await window.Capacitor.Plugins.CapacitorHttp[fn](opts);
      CapDbg.last = { via:'native.' + fn, url, status:res.status, body:(typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '')).slice(0, 200) };
      return { status: res.status, data: parse(res.data), headers: res.headers || {} };
    }
    const r = await fetchT(url, 15000, { method: method || 'GET', headers, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    const hdrs = {};
    try{ r.headers.forEach((val, key) => { hdrs[key] = val; }); }catch(e){}
    CapDbg.last = { via:'fetch', url, status:r.status, body:(txt || '').slice(0, 200) };
    return { status: r.status, data: parse(txt), headers: hdrs };
  }catch(err){
    CapDbg.last = { via:(Net.plugin ? 'native' : 'fetch') + '.EXCEPTION', url, status:'—', body:String(err && err.message || err).slice(0, 200) };
    throw err;
  }
}
export function capHdr(h, name){
  if(!h) return null;
  return h[name] || h[name.toLowerCase()] || h[name.toUpperCase()] || null;
}

/* Szyfrowane logowanie (RSA) — eliminuje problem znaków specjalnych w haśle.
   Capital udostępnia klucz publiczny; hasło+timestamp szyfrujemy i wysyłamy w base64. */
export async function capEncryptedLogin(base){
  const keyRes = await capRaw('/api/v1/session/encryptionKey', 'GET', null, { 'X-CAP-API-KEY': CapCfg.key });
  if(!(keyRes.status >= 200 && keyRes.status < 300) || !keyRes.data || !keyRes.data.encryptionKey){
    throw new Error('encryptionKey HTTP ' + keyRes.status);
  }
  const pubB64 = keyRes.data.encryptionKey;
  const ts = keyRes.data.timeStamp;
  if(!(window.crypto && window.crypto.subtle)) throw new Error('brak WebCrypto');
  const der = Uint8Array.from(atob(pubB64), c => c.charCodeAt(0));
  const pubKey = await window.crypto.subtle.importKey(
    'spki', der.buffer,
    { name:'RSA-OAEP', hash:'SHA-1' },
    false, ['encrypt']
  );
  const plain = new TextEncoder().encode(CapCfg.pass + '|' + ts);
  const enc = await window.crypto.subtle.encrypt({ name:'RSA-OAEP' }, pubKey, plain);
  const encB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(enc)));
  const res = await capRaw('/api/v1/session', 'POST',
    { identifier: CapCfg.id, password: encB64, encryptedPassword: true },
    { 'X-CAP-API-KEY': CapCfg.key });
  return res;
}

export async function capSession(){
  if(CapSess.cst && Date.now() - CapSess.at < 8*60*1000) return;
  const base = CapCfg.demo ? 'https://demo-api-capital.backend-capital.com' : 'https://api-capital.backend-capital.com';
  const bodyObj = { identifier: CapCfg.id, password: CapCfg.pass, encryptedPassword: false };
  let res = await capRaw('/api/v1/session', 'POST', bodyObj, { 'X-CAP-API-KEY': CapCfg.key });

  /* jeśli plugin zniekształcił hasło ze znakami specjalnymi (invalid.details),
     spróbuj wariantu z surowym obiektem (drugi tryb wysyłki) */
  if(res.status === 401 && Net.plugin){
    const ec = (res.data && res.data.errorCode) ? res.data.errorCode : '';
    if(String(ec).indexOf('invalid.details') !== -1){
      try{
        const raw = await window.Capacitor.Plugins.CapacitorHttp.post({
          url: base + '/api/v1/session',
          headers: { 'Content-Type':'application/json', 'Accept':'application/json', 'X-CAP-API-KEY': CapCfg.key },
          data: bodyObj,
        });
        res = {
          status: raw.status,
          data: (typeof raw.data === 'string' && raw.data) ? (function(){ try{ return JSON.parse(raw.data); }catch(e){ return raw.data; } })() : raw.data,
          headers: raw.headers || {},
        };
      }catch(e){}
    }
  }

  /* ostateczny ratunek: logowanie szyfrowane RSA — omija każdy problem
     z kodowaniem znaków specjalnych w haśle */
  if(res.status === 401){
    const ec = (res.data && res.data.errorCode) ? res.data.errorCode : '';
    if(String(ec).indexOf('invalid.details') !== -1){
      try{
        const encRes = await capEncryptedLogin(base);
        if(encRes.status >= 200 && encRes.status < 300) res = encRes;
      }catch(e){}
    }
  }

  if(!(res.status >= 200 && res.status < 300)){
    let detail = '';
    try{
      if(res.data){
        detail = (typeof res.data === 'string') ? res.data : JSON.stringify(res.data);
        detail = detail.slice(0, 160);
      }
    }catch(e){}
    const ec = (res.data && res.data.errorCode) ? res.data.errorCode : detail;
    throw new Error('POST ' + base + '/api/v1/session → HTTP ' + res.status + (ec ? ' · ' + ec : '') + ' · środowisko: ' + (CapCfg.demo ? 'DEMO' : 'REALNE') + ' · transport: ' + (Net.plugin ? 'natywny' : 'fetch'));
  }
  const cst = capHdr(res.headers, 'CST');
  const xst = capHdr(res.headers, 'X-SECURITY-TOKEN');
  if(!cst || !xst){
    const hk = res.headers ? Object.keys(res.headers).join(', ') : '(brak)';
    throw new Error('Sesja bez tokenów (CST/X-SECURITY-TOKEN). Otrzymane nagłówki: ' + hk.slice(0, 160) + '. W przeglądarce CORS ukrywa nagłówki — w APK powinny być.');
  }
  CapSess.cst = cst; CapSess.xst = xst; CapSess.at = Date.now();

  /* Capital wymaga jawnego wskazania rachunku. Pobierz listę i ustaw aktywny. */
  if(!CapSess.acctSet){
    let accRes;
    try{
      accRes = await capRaw('/api/v1/accounts', 'GET', null,
        { 'CST': CapSess.cst, 'X-SECURITY-TOKEN': CapSess.xst });
    }catch(e){
      throw new Error('GET /accounts nie powiodło się: ' + (e.message || e));
    }
    if(!(accRes.status >= 200 && accRes.status < 300)){
      let d = ''; try{ d = (typeof accRes.data === 'string') ? accRes.data : JSON.stringify(accRes.data); }catch(e){}
      throw new Error('GET /accounts → HTTP ' + accRes.status + ' · ' + String(d).slice(0, 120));
    }
    const accs = (accRes.data && accRes.data.accounts) || [];
    if(!accs.length){
      throw new Error('Brak rachunków na koncie DEMO. Zaloguj się na capital.com, przełącz na konto Demo i utwórz/zasil rachunek demo.');
    }
    let pref = accs.find(a => a.preferred) || accs[0];
    const accId = pref.accountId;
    if(!accId){
      throw new Error('Rachunek bez accountId (' + JSON.stringify(pref).slice(0, 100) + ')');
    }
    try{
      const put = await capRaw('/api/v1/session', 'PUT',
        { accountId: accId },
        { 'CST': CapSess.cst, 'X-SECURITY-TOKEN': CapSess.xst });
      /* PUT może zwrócić świeże tokeny — zaktualizuj jeśli są */
      const nc = capHdr(put.headers, 'CST'), nx = capHdr(put.headers, 'X-SECURITY-TOKEN');
      if(nc) CapSess.cst = nc;
      if(nx) CapSess.xst = nx;
    }catch(e){
      throw new Error('PUT /session (wybór rachunku) nie powiodło się: ' + (e.message || e));
    }
    CapSess.acctSet = true;
  }
}
export async function capGet(path){
  await capSession();
  let res = await capRaw(path, 'GET', null, { 'CST': CapSess.cst, 'X-SECURITY-TOKEN': CapSess.xst });
  if(res.status === 401){
    CapSess.cst = null; CapSess.at = 0; CapSess.acctSet = false;
    await capSession();
    res = await capRaw(path, 'GET', null, { 'CST': CapSess.cst, 'X-SECURITY-TOKEN': CapSess.xst });
  }
  if(!(res.status >= 200 && res.status < 300)){
    let d = ''; try{ d = (typeof res.data === 'string') ? res.data : JSON.stringify(res.data); }catch(e){}
    throw new Error('GET ' + path.split('?')[0] + ' → HTTP ' + res.status + (d ? ' · ' + String(d).slice(0, 80) : ''));
  }
  return res.data;
}
export function capMid(q){
  if(!q || q.bid == null) return null;
  return (q.bid + (q.ask != null ? q.ask : q.bid)) / 2;
}

/* Rozwiązywanie epica: nazwy w API bywają różne (GERMANY40 / DE40 / GDAXI…),
   więc wyszukujemy instrument dynamicznie i cache'ujemy wynik. */
export const CapEpicCache = {};
export const CAP_SEARCH = {
  '^GDAXI':['GERMANY40','DE40','Germany 40'], '^DJI':['US30','Wall Street','Dow'],
  '^GSPC':['US500','US 500'], '^IXIC':['US100','US Tech 100'],
  'GC=F':['GOLD','Gold'], 'EURUSD=X':['EURUSD','EUR/USD'], 'BTC-USD':['BTCUSD','Bitcoin'],
};
export async function capResolveEpic(symbol){
  const preferred = CAP_MAP[symbol];
  if(CapEpicCache[symbol]) return CapEpicCache[symbol];
  /* 1) spróbuj nazwy preferowanej wprost */
  if(preferred){
    try{
      const j = await capGet('/api/v1/markets/' + preferred);
      if(j && j.snapshot){ CapEpicCache[symbol] = preferred; return preferred; }
    }catch(e){}
  }
  /* 2) wyszukaj po frazach */
  const terms = CAP_SEARCH[symbol] || [symbol];
  for(let t=0;t<terms.length;t++){
    try{
      const j = await capGet('/api/v1/markets?searchTerm=' + encodeURIComponent(terms[t]));
      const arr = (j && j.markets) || [];
      /* preferuj instrument, który jest indeksem/otwarty i ma epic zbliżony */
      let pick = arr.find(m => m.epic === preferred)
              || arr.find(m => m.instrumentType && /INDEX|INDICES|COMMODIT|CURRENC|CRYPTO/i.test(m.instrumentType))
              || arr[0];
      if(pick && pick.epic){ CapEpicCache[symbol] = pick.epic; return pick.epic; }
    }catch(e){}
  }
  throw new Error('Nie znaleziono instrumentu „' + (preferred || symbol) + '" na Twoim koncie Capital');
}
export async function capitalChart(symbol, tf){
  const epic = await capResolveEpic(symbol);
  const maxN = tf.id === 'D1' ? 300 : (tf.id === 'H1' ? 400 : 420);
  const j = await capGet('/api/v1/prices/' + epic + '?resolution=' + (CAP_RES[tf.id] || 'MINUTE_5') + '&max=' + maxN);
  const arr = (j && j.prices) || [];
  const candles = [];
  for(let q=0;q<arr.length;q++){
    const p = arr[q];
    const o = capMid(p.openPrice), h = capMid(p.highPrice), l = capMid(p.lowPrice), c = capMid(p.closePrice);
    if(o == null || h == null || l == null || c == null) continue;
    const ts = p.snapshotTimeUTC ? Date.parse(p.snapshotTimeUTC + 'Z') : Date.parse(p.snapshotTime);
    if(!isFinite(ts)) continue;
    candles.push({ t: Math.floor(ts/1000), o, h, l, c, v: p.lastTradedVolume || 0 });
  }
  if(candles.length < 10) throw new Error('za mało świec z Capital.com');
  Net.last = 'Capital.com LIVE'; Net.mode = 'capital';
  return {
    candles, meta:{}, tz:'',
    price: candles[candles.length-1].c,
    prev: candles[0].o,
    live: true,
  };
}
export async function capitalTick(symbol){
  const epic = await capResolveEpic(symbol);
  const j = await capGet('/api/v1/markets/' + epic);
  const sn = j && j.snapshot;
  if(!sn || sn.bid == null) return null;
  const px = (sn.bid + (sn.offer != null ? sn.offer : sn.bid)) / 2;
  const net = (sn.netChange != null && isFinite(sn.netChange)) ? sn.netChange : null;
  return { px, net };
}

/* --- Capital.com streaming (WebSocket) — płynne ticki jak w xStation --- */
export const CapWS = { ws:null, epic:null, onQ:null, timer:null, alive:false, retries:0 };
export function capWsStop(){
  CapWS.alive = false; CapWS.epic = null; CapWS.onQ = null;
  if(CapWS.timer){ clearInterval(CapWS.timer); CapWS.timer = null; }
  if(CapWS.ws){ try{ CapWS.ws.close(); }catch(e){} CapWS.ws = null; }
}
export function capWsStart(epic, onQuote, onState){
  capWsStop();
  CapWS.alive = true; CapWS.epic = epic; CapWS.onQ = onQuote;
  const loop = async () => {
    if(!CapWS.alive || CapWS.epic !== epic) return;
    try{
      await capSession();
      const ws = new WebSocket('wss://api-streaming-capital.backend-capital.com/connect');
      CapWS.ws = ws;
      ws.onopen = () => {
        CapWS.retries = 0;
        try{
          ws.send(JSON.stringify({
            destination:'marketData.subscribe', correlationId:'1',
            cst:CapSess.cst, securityToken:CapSess.xst,
            payload:{ epics:[epic] },
          }));
        }catch(e){}
        if(CapWS.timer) clearInterval(CapWS.timer);
        CapWS.timer = setInterval(() => {
          try{
            ws.send(JSON.stringify({ destination:'ping', correlationId:'p', cst:CapSess.cst, securityToken:CapSess.xst }));
          }catch(e){}
        }, 30000);
        if(onState) onState(true);
      };
      ws.onmessage = ev => {
        try{
          const m = JSON.parse(ev.data);
          if(m.destination === 'quote' && m.payload && m.payload.epic === epic){
            const b = m.payload.bid;
            const o = (m.payload.ofr != null) ? m.payload.ofr : m.payload.offer;
            if(b != null && CapWS.onQ) CapWS.onQ((b + (o != null ? o : b))/2);
          }
        }catch(e){}
      };
      ws.onclose = () => {
        if(CapWS.timer){ clearInterval(CapWS.timer); CapWS.timer = null; }
        if(onState) onState(false);
        if(CapWS.alive && CapWS.epic === epic){
          CapSess.at = 0; CapSess.cst = null; CapSess.acctSet = false;
          CapWS.retries++;
          setTimeout(loop, Math.min(15000, 1500 * CapWS.retries));
        }
      };
      ws.onerror = () => { try{ ws.close(); }catch(e){} };
    }catch(e){
      if(onState) onState(false);
      if(CapWS.alive && CapWS.epic === epic){
        CapWS.retries++;
        setTimeout(loop, Math.min(20000, 2500 * CapWS.retries));
      }
    }
  };
  loop();
}


export function setCapWarned(v){ capWarned = v; }
