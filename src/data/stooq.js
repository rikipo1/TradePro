import { Net, fetchText } from '../core/net.js';

/* zapasowe źródło dziennych świec — Stooq (CSV), gdy Yahoo limituje */
export const STOOQ_MAP = {
  '^GDAXI':'^dax', '^DJI':'^dji', '^GSPC':'^spx', '^IXIC':'^ndq',
  'GC=F':'gc.f', 'EURUSD=X':'eurusd', 'BTC-USD':'btcusd',
};
export async function stooqDaily(symbol){
  let code = STOOQ_MAP[symbol];
  if(!code && /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) code = symbol.toLowerCase() + '.us';
  if(!code) throw new Error('Brak mapowania Stooq dla ' + symbol);
  const txt = await fetchText('https://stooq.com/q/d/l/?s=' + encodeURIComponent(code) + '&i=d');
  const lines = String(txt).trim().split('\n');
  if(lines.length < 3 || lines[0].indexOf('Date') !== 0) throw new Error('Stooq: brak danych');
  const candles = [];
  for(let i=1;i<lines.length;i++){
    const p = lines[i].split(',');
    if(p.length < 5) continue;
    const t = Math.floor(Date.parse(p[0] + 'T12:00:00Z') / 1000);
    const o = parseFloat(p[1]), h = parseFloat(p[2]), l = parseFloat(p[3]), c = parseFloat(p[4]);
    const v = p.length > 5 ? (parseFloat(p[5]) || 0) : 0;
    if(!isFinite(t) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    candles.push({ t, o, h, l, c, v });
  }
  if(candles.length < 10) throw new Error('Stooq: za mało danych');
  const cs = candles.slice(-260);
  Net.last = 'Stooq (dzienne)';
  return {
    candles: cs, meta:{}, tz:'',
    price: cs[cs.length-1].c,
    prev: cs.length > 1 ? cs[cs.length-2].c : cs[0].o,
  };
}
