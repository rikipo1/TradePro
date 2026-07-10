import { displacement } from '../smc/index.js';

export const DEFAULT_WL = [
  { sym:'^GDAXI',   name:'DAX 40 · DE40' },
  { sym:'^DJI',     name:'Dow Jones · US30' },
  { sym:'^GSPC',    name:'S&P 500 · US500' },
  { sym:'^IXIC',    name:'Nasdaq · NAS100' },
  { sym:'GC=F',     name:'Złoto · GOLD' },
  { sym:'EURUSD=X', name:'EUR/USD' },
];

export const DEFAULT_SMC = {
  premium: 62,      // % zakresu — powyżej = premium (strefa short)
  discount: 38,     // % zakresu — poniżej = discount (strefa long)
  dispImpulse: 1.2, // body świecy / ATR do uznania za displacement
  dispBody: 0.6,    // udział body w range świecy
  fvgDist: 0.5,     // max dystans FVG od ceny (×ATR) by liczył się do score
  strong: 55,       // próg „mocny sygnał" (gra kontrę HTF / omija filtr sesji)
  rangeBonus: 15,   // ile dodać do progu w konsolidacji (ADX<18)
  minRR: 1.5,       // minimalny akceptowalny RR do najbliższej struktury
};
export const DEFAULT_PREFS = { tf:'M5', emaVis:{ 9:true, 20:true, 50:true, 200:false }, auto:false, alert:false, autoTrade:false, bgScan:false, onlyStrong:false, waitPullback:false, minScore:30, source:'auto', ind:{ form:true, boll:false, vwap:false, sr:true, panels:['RSI'] }, smc:{ ...DEFAULT_SMC } };
