/* --- SESJE [M1] ---
   Wcześniej sessionInfo czytało czas LOKALNY przeglądarki (getHours), więc ta sama
   świeca dawała inną sesję u użytkownika w Warszawie i w Nowym Jorku, a backtest
   (czas świecy) rozjeżdżał się z live (wall-clock). Teraz LICZYMY Z UTC — spójnie
   live i backtest, niezależnie od strefy urządzenia.
   Okna zmapowane z czasu środkowoeuropejskiego (CET, zima UTC+1) na UTC.
   TODO(M1-DST): latem obowiązuje CEST (UTC+2) — okna byłyby przesunięte o 1h.
   Na razie stały offset zimowy (informacyjnie; wpływ na jakość sesji minimalny). */
export function sessionInfo(dt){
  dt = dt || new Date();
  const hm = dt.getUTCHours()*60 + dt.getUTCMinutes();
  const day = dt.getUTCDay(); // 0=nd
  const weekend = (day === 0 || day === 6);
  // okna w UTC (CET−1h): otwarcie DAX 09:00 CET = 08:00 UTC itd.
  const asia   = hm >= 0*60 && hm < 7*60;         // Tokio
  const london = hm >= 7*60 && hm < 15*60+30;     // otwarcie ~08:00 UTC (09:00 CET)
  const ny     = hm >= 13*60+30 && hm < 21*60;    // 14:30 UTC kasa, dane 13:30 UTC
  const overlap = hm >= 13*60+30 && hm < 15*60+30;// London×NY — najlepsza płynność
  const londonLunch = hm >= 11*60 && hm < 12*60;  // niska płynność
  const preOpen = hm < 7*60;                      // przed otwarciem Europy
  const lateNY  = hm >= 19*60;                     // po głównej sesji
  let quality = 0, label = 'poza sesją';
  if(overlap){ quality = 2; label = 'London×NY (overlap)'; }
  else if(ny){ quality = 1; label = 'sesja NY'; }
  else if(london && !londonLunch){ quality = 1; label = 'sesja londyńska'; }
  else if(londonLunch){ quality = -1; label = 'lunch londyński (niska płynność)'; }
  else if(asia){ quality = -1; label = 'sesja azjatycka (dla DE/US = szum)'; }
  else { quality = -1; label = preOpen ? 'przed otwarciem' : 'po sesji (cienki rynek)'; }
  if(weekend){ quality = -2; label = 'weekend / rynek zamknięty'; }
  return { quality, label, overlap, weekend, asia, londonLunch, lateNY };
}

/* [M1] Okna makro (podwyższona zmienność) — również w UTC, z czasu świecy.
   Zmapowane z CET (zima). Zwraca etykietę okna albo null. */
const MACRO_WINDOWS_UTC = [
  [8*60,        8*60+15,  'otwarcie DAX 09:00'],
  [13*60+22,    13*60+42, 'publikacje USA 14:30'],
  [14*60+25,    14*60+45, 'otwarcie Wall Street 15:30'],
  [14*60+52,    15*60+12, 'dane USA 16:00'],
  [18*60+52,    19*60+15, 'FOMC / minutes 20:00'],
];
export function macroWindow(dt){
  dt = dt || new Date();
  const hm = dt.getUTCHours()*60 + dt.getUTCMinutes();
  for(const w of MACRO_WINDOWS_UTC){ if(hm >= w[0] && hm <= w[1]) return w[2]; }
  return null;
}
