/* --- SESJE I OKNA MAKRO w czasie LOKALNYM rynków (DST-proof) [A6] ---
   Poprzednia wersja mapowała okna CET→UTC ze STAŁYM offsetem zimowym; latem
   (CEST) wszystko było przesunięte o 1 h, a filtr sesji to twarda bramka.
   Teraz każde okno liczone jest w strefie SWOJEGO rynku przez Intl —
   przejścia DST obsługuje tzdata, nie my. */

const fmtCache = {};
export function tzClock(dt, tz) {
  let f = fmtCache[tz];
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    fmtCache[tz] = f;
  }
  let h = 0, m = 0, wd = '';
  for (const p of f.formatToParts(dt)) {
    if (p.type === 'hour') h = +p.value;
    else if (p.type === 'minute') m = +p.value;
    else if (p.type === 'weekday') wd = p.value;
  }
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
  return { hm: h * 60 + m, day: day != null ? day : 0 };
}

export function sessionInfo(dt){
  dt = dt || new Date();
  const lon = tzClock(dt, 'Europe/London');
  const nyc = tzClock(dt, 'America/New_York');
  const tok = tzClock(dt, 'Asia/Tokyo');

  const weekend = (nyc.day === 0 || nyc.day === 6);          // dzień wg NY
  const london = lon.hm >= 8 * 60 && lon.hm < 16 * 60 + 30;  // 08:00–16:30 London
  const londonLunch = lon.hm >= 12 * 60 && lon.hm < 13 * 60; // 12:00–13:00 London
  const ny = nyc.hm >= 8 * 60 + 30 && nyc.hm < 16 * 60;      // 08:30–16:00 NY
  const overlap = london && ny;
  const asia = tok.hm >= 9 * 60 && tok.hm < 15 * 60;         // 09:00–15:00 Tokio
  const preOpen = !london && !ny && !asia && lon.hm < 8 * 60;
  const lateNY = nyc.hm >= 16 * 60;                          // po kasowej sesji NY

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

/* Okna makro w czasie lokalnym rynków; zwraca etykietę albo null.
   Etykiety zachowują nazewnictwo CET znane z UI (14:30/15:30/16:00/20:00). */
export function macroWindow(dt){
  dt = dt || new Date();
  const ber = tzClock(dt, 'Europe/Berlin');
  if(ber.hm >= 9 * 60 && ber.hm <= 9 * 60 + 15) return 'otwarcie DAX 09:00';
  const nyc = tzClock(dt, 'America/New_York');
  const wins = [
    [8 * 60 + 22, 8 * 60 + 42, 'publikacje USA 14:30'],       // 08:30 NY
    [9 * 60 + 25, 9 * 60 + 45, 'otwarcie Wall Street 15:30'], // 09:30 NY
    [9 * 60 + 52, 10 * 60 + 12, 'dane USA 16:00'],            // 10:00 NY
    [13 * 60 + 52, 14 * 60 + 15, 'FOMC / minutes 20:00'],     // 14:00 NY
  ];
  for(let q = 0; q < wins.length; q++){
    if(nyc.hm >= wins[q][0] && nyc.hm <= wins[q][1]) return wins[q][2];
  }
  return null;
}
