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
