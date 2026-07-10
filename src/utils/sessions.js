/* --- SESJE (czas lokalny przeglądarki ~ Europe/Berlin dla użytkownika) --- */
export function sessionInfo(dt){
  dt = dt || new Date();
  const hm = dt.getHours()*60 + dt.getMinutes();
  const day = dt.getDay(); // 0=nd
  const weekend = (day === 0 || day === 6);
  // okna czasu środkowoeuropejskiego (przybliżone, indeksy/DAX/US)
  const asia   = hm >= 1*60 && hm < 8*60;         // Tokio
  const london = hm >= 8*60 && hm < 16*60+30;     // otwarcie ~9:00 DAX
  const ny     = hm >= 14*60+30 && hm < 22*60;    // 15:30 kasa, dane 14:30
  const overlap = hm >= 14*60+30 && hm < 16*60+30;// London×NY — najlepsza płynność
  const londonLunch = hm >= 12*60 && hm < 13*60;  // niska płynność
  const preOpen = hm < 8*60;                      // przed otwarciem Europy
  const lateNY  = hm >= 20*60;                     // po głównej sesji
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
