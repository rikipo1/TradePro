import { Net, fetchT } from '../core/net.js';

/* ---------------- Faza 5: analiza AI (Claude / Gemini) ---------------- */
export async function aiPost(url, headers, body){
  if(Net.plugin){
    const res = await window.Capacitor.Plugins.CapacitorHttp.post({ url, headers, data: body });
    if(res && res.status >= 200 && res.status < 300){
      return (typeof res.data === 'string') ? JSON.parse(res.data) : res.data;
    }
    const raw = res && res.data ? (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)) : '';
    throw new Error('HTTP ' + (res ? res.status : '?') + ' ' + raw.slice(0, 200));
  }
  const r = await fetchT(url, 60000, { method:'POST', headers, body: JSON.stringify(body) });
  const txt = await r.text();
  if(!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 200));
  return JSON.parse(txt);
}
export function tolerantJson(txt){
  if(!txt) throw new Error('Pusta odpowiedź AI');
  const BT = String.fromCharCode(96);
  let t = String(txt).split(BT).join('').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if(a === -1 || b === -1 || b <= a) throw new Error('Odpowiedź AI bez poprawnego JSON');
  return JSON.parse(t.slice(a, b + 1));
}
export function buildAiContext(item, tf, candles, ind, emaData, patterns, signal, hasVol){
  const n = candles.length, i = n - 1;
  const v = (a, d) => (a && a[i] != null) ? +a[i].toFixed(d == null ? 4 : d) : null;
  return {
    instrument: item.sym,
    nazwa: item.name,
    interwal: tf.id,
    czas_ostatniej_swiecy: new Date(candles[i].t*1000).toISOString(),
    cena: +candles[i].c.toFixed(4),
    swiece_OHLCV_ostatnie_40: candles.slice(-40).map(c => [
      c.t, +c.o.toFixed(4), +c.h.toFixed(4), +c.l.toFixed(4), +c.c.toFixed(4), Math.round(c.v),
    ]),
    wskazniki: {
      RSI14: v(ind.rsi, 1),
      MACD: { linia: v(ind.macd.macd), sygnal: v(ind.macd.signal), histogram: v(ind.macd.hist) },
      ADX14: { adx: v(ind.adx.adx, 1), plusDI: v(ind.adx.pdi, 1), minusDI: v(ind.adx.mdi, 1) },
      Stochastic: { K: v(ind.stoch.k, 1), D: v(ind.stoch.d, 1) },
      ATR14: v(ind.atr),
      EMA: { e20: v(emaData[20]), e50: v(emaData[50]), e200: v(emaData[200]) },
      VWAP: ind.vwap ? v(ind.vwap) : null,
      Bollinger: { gorna: v(ind.boll.up), srodek: v(ind.boll.mid), dolna: v(ind.boll.dn) },
    },
    strefy_SR: (ind.sr || []).map(z => ({ dol: +z.lo.toFixed(4), gora: +z.hi.toFixed(4), odbicia: z.touches })),
    formacje_ostatnie: patterns.list.slice(0, 10).map(p => ({
      nazwa: p.name, kierunek: p.dir, pewnosc: p.conf, swiec_temu: n - 1 - p.i,
    })),
    sygnal_silnika: signal ? {
      kierunek: signal.dir > 0 ? 'LONG' : signal.dir < 0 ? 'SHORT' : 'WAIT',
      confluence: signal.score,
      poziomy: signal.levels || null,
      jakosc_wejscia: signal.entryQuality ? (signal.entryQuality.grade + ' (' + signal.entryQuality.dist + '×ATR od ' + signal.entryQuality.anchor + ')') : null,
      glowne_powody: signal.reasons.slice(0, 6).map(r => (r.pts > 0 ? '+' : '') + r.pts + ' ' + r.txt),
      ostrzezenia: signal.warns,
      smc: signal.smc || null,
      filary: signal.pillarsDetail || null,
      sesja: signal.session || null,
      blokady: [signal.macroBlock && 'makro', signal.sessionBlock && 'sesja', signal.rrBlock && 'RR<1.5'].filter(Boolean),
    } : null,
    wolumen_dostepny: hasVol,
  };
}
export function aiPrompt(ctx, wantNews){
  return 'Jesteś doświadczonym traderem Smart Money Concepts / ICT i intraday (indeksy DAX/US30/US100, akcje USA). Otrzymujesz dane z aplikacji tradingowej użytkownika, w tym analizę struktury rynku (BOS/CHOCH, order block, FVG, premium/discount, liquidity sweep), filary konfluencji i kontekst sesji.\n'
    + (wantNews ? ('Najpierw krótko sprawdź w wyszukiwarce najświeższe wiadomości (ostatnie 24h) istotne dla instrumentu ' + ctx.instrument + ' (' + ctx.nazwa + ') i uwzględnij je w ocenie.\n') : '')
    + 'Myśl jak trader z funduszu — masz prawo ZAWETOWAĆ sygnał silnika, jeśli struktura, lokalizacja (premium/discount) albo płynność temu przeczą. Wyjaśnij: dlaczego wejść, dlaczego NIE wchodzić, co jeszcze musi się wydarzyć, jakie ryzyko widzisz, mocne i słabe strony setupu oraz prawdopodobieństwo sukcesu. Bądź konkretny i krytyczny — nie potakuj silnikowi bezmyślnie.\n'
    + 'Odpowiedz WYŁĄCZNIE poprawnym JSON, bez markdown i bez tekstu poza JSON, w formacie:\n'
    + '{"verdict":"LONG|SHORT|WAIT","confidence":liczba 0-100,"agree_with_engine":true lub false,"summary":"2-3 zdania po polsku","key_risks":["maks 3 ryzyka po polsku"],"levels_comment":"krótka ocena Entry/SL/TP po polsku lub null","co_musi_sie_wydarzyc":"czego brakuje do wejścia po polsku lub null","news_impact":"wpływ aktualnych newsów po polsku lub null"}\n'
    + 'DANE APLIKACJI:\n' + JSON.stringify(ctx);
}
export async function callClaude(key, prompt, news){
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 900,
    messages: [{ role:'user', content: prompt }],
  };
  if(news) body.tools = [{ type:'web_search_20250305', name:'web_search', max_uses: 3 }];
  const j = await aiPost('https://api.anthropic.com/v1/messages', {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }, body);
  return (j.content || []).map(b => (b && b.type === 'text') ? b.text : '').join('\n');
}
export async function callGemini(key, prompt, news){
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if(news) body.tools = [{ google_search: {} }];
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(key);
  const j = await aiPost(url, { 'Content-Type':'application/json' }, body);
  const cand = j.candidates && j.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  return parts.map(p => p.text || '').join('\n');
}
