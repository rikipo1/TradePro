/* --- spread/koszt na instrument (w ułamku ceny, przybliżenie XTB CFD) --- */
export const INSTR_COST = {
  '^GDAXI':  { spr:0.00006, name:'DE40' },
  '^DJI':    { spr:0.00007, name:'US30' },
  '^GSPC':   { spr:0.00007, name:'US500' },
  '^IXIC':   { spr:0.00008, name:'NAS100' },
  'GC=F':    { spr:0.00010, name:'GOLD' },
  'EURUSD=X':{ spr:0.00004, name:'EURUSD' },
};
export function instrCost(sym){ return INSTR_COST[sym] || { spr:0.00010, name:sym }; }
/* koszt round-turn w jednostkach ceny: spread wejście + spread wyjście */
export function spreadPx(sym, price){ return instrCost(sym).spr * price * 2; }

/* --- profile per instrument: dynamiczne parametry decyzji ---
   klasa: index | gold | crypto | fx. Steruje: bufor SL (×ATR), min RR,
   wrażliwość na filtr sesji, czy honorować okna makro, czy jest 24/7. */
const CLASS_DEFAULTS = {
  index:  { slWick:0.18, minRR:1.6, sessionSensitive:true,  h24:false, macro:true  },
  gold:   { slWick:0.28, minRR:1.7, sessionSensitive:true,  h24:false, macro:true  },
  crypto: { slWick:0.35, minRR:1.8, sessionSensitive:false, h24:true,  macro:false },
  fx:     { slWick:0.15, minRR:1.6, sessionSensitive:true,  h24:false, macro:true  },
};
const SYM_CLASS = {
  '^GDAXI':'index', '^DJI':'index', '^GSPC':'index', '^IXIC':'index',
  'GC=F':'gold', 'SI=F':'gold', 'BTC-USD':'crypto', 'ETH-USD':'crypto',
  'EURUSD=X':'fx', 'GBPUSD=X':'fx', 'USDJPY=X':'fx', 'DX-Y.NYB':'fx',
};
export function instrClass(sym){
  if(SYM_CLASS[sym]) return SYM_CLASS[sym];
  if(/BTC|ETH|-USD$/.test(sym||'')) return 'crypto';
  if(/=X$/.test(sym||'')) return 'fx';
  if(/GC=F|XAU|SI=F/.test(sym||'')) return 'gold';
  return 'index';
}
export function instrProfile(sym){
  const cls = instrClass(sym);
  return { cls, ...CLASS_DEFAULTS[cls] };
}
