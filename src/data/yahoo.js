import { fetchJson } from '../core/net.js';

export const TFS = [
  { id:'M1',  interval:'1m',  range:'1d',  label:'M1'  },
  { id:'M5',  interval:'5m',  range:'5d',  label:'M5'  },
  { id:'M15', interval:'15m', range:'1mo', label:'M15' },
  { id:'M30', interval:'30m', range:'1mo', label:'M30' },
  { id:'H1',  interval:'60m', range:'3mo', label:'H1'  },
  { id:'D1',  interval:'1d',  range:'1y',  label:'D1'  },
];

/* Maksymalny zakres historii Yahoo per interwał — używany WYŁĄCZNIE do treningu
   i backtestu (nie do widoku wykresu). Limity Yahoo: 1m→7d, śróddzienne→60d,
   60m→730d, D1→max. Bez tego M5 miał tylko 5 dni ≈ 460 świec i training padał
   na „za mało próbek". */
export const TF_MAX_RANGE = { M1:'7d', M5:'60d', M15:'60d', M30:'60d', H1:'730d', D1:'10y' };

export async function yahooChart(symbol, tf){
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol)
    + '?interval=' + tf.interval + '&range=' + tf.range + '&includePrePost=false';
  const j = await fetchJson(url);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if(!r){
    const msg = j && j.chart && j.chart.error && j.chart.error.description;
    throw new Error(msg || ('Brak danych dla ' + symbol));
  }
  const ts = r.timestamp || [];
  const q  = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const O = q.open||[], H = q.high||[], L = q.low||[], C = q.close||[], V = q.volume||[];
  const candles = [];
  for(let i=0;i<ts.length;i++){
    const o=O[i], h=H[i], l=L[i], c=C[i];
    if(o==null || h==null || l==null || c==null) continue;
    candles.push({ t:ts[i], o, h, l, c, v:(V[i]==null?0:V[i]) });
  }
  const meta = r.meta || {};
  const price = (meta.regularMarketPrice != null) ? meta.regularMarketPrice : (candles.length ? candles[candles.length-1].c : null);
  const prev  = (meta.chartPreviousClose != null) ? meta.chartPreviousClose
              : (meta.previousClose != null) ? meta.previousClose
              : (candles.length ? candles[0].o : null);
  return { candles, meta, price, prev, tz: meta.exchangeTimezoneName || '' };
}
