/* ---------------- Korelacja instrumentów (ETAP 4) ----------------
   Liczy korelację zwrotów między instrumentami z listy, żeby wykryć
   ZDUBLOWANE ryzyko (DAX/US500/NAS100 to często ~jedna ekspozycja).
   Wejście: mapa sym -> tablica close. Zwraca macierz + funkcję pomocniczą. */

function returns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]) r.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return r;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 20) return 0;
  const A = a.slice(a.length - n), B = b.slice(b.length - n);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += A[i]; mb += B[i]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = A[i] - ma, db = B[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  return (va > 0 && vb > 0) ? cov / Math.sqrt(va * vb) : 0;
}

export function correlationMatrix(closesBySym) {
  const syms = Object.keys(closesBySym);
  const rets = {};
  for (const s of syms) rets[s] = returns(closesBySym[s]);
  const m = {};
  for (const a of syms) {
    m[a] = {};
    for (const b of syms) m[a][b] = a === b ? 1 : +pearson(rets[a], rets[b]).toFixed(2);
  }
  return m;
}

/* czy otwarcie pozycji na `sym` w kierunku `dir` dubluje istniejącą ekspozycję
   z pozycji już otwartych (openPositions: [{sym, dir}]) przy korelacji > próg */
export function duplicatesExposure(sym, dir, openPositions, corr, threshold = 0.7) {
  if (!openPositions || !corr || !corr[sym]) return null;
  for (const p of openPositions) {
    if (p.sym === sym) continue;
    const c = corr[sym][p.sym];
    if (c == null) continue;
    // wysoka korelacja + ten sam kierunek = zdublowane ryzyko; ujemna + przeciwny = też
    if (c >= threshold && p.dir === dir) return { with: p.sym, corr: c, type: 'duplikat (ten sam kierunek, skorelowane)' };
    if (c <= -threshold && p.dir !== dir) return { with: p.sym, corr: c, type: 'duplikat (przeciwny kierunek, antykorelacja)' };
  }
  return null;
}
