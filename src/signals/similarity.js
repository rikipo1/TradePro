/* ---------------- Historical Similarity Engine (kNN) ----------------
   "Czy rynek wyglądał już tak wcześniej i co się wtedy stało?"
   Szukamy K najbliższych HISTORYCZNYCH sytuacji (po zorientowanym wektorze cech)
   i bierzemy ich empiryczną trafność. Łapie zależności NIELINIOWE i daje
   modelowi „pamięć". Historia z etykiet backtestu (walk-forward, część
   treningowa z embargo) — bez look-ahead względem OOS.

   [M2/N1] Poprawki:
   • STANDARYZACJA cech (z-score po historii) PRZED liczeniem dystansu — cechy
     o różnej skali/wariancji nie dominują metryki.
   • Jądro GAUSSOWSKIE exp(-d²/(2h²)) zamiast 1/(1e-6+d²) — brak wybuchu wag przy
     d→0, bandwidth h = MEDIANA dystansów (adaptacyjny).
   • Wymóg efektywnej liczby sąsiadów n_eff = (Σw)²/Σw² ≥ 5 — inaczej similar=null
     (kilka bardzo bliskich analogów to nie jest wiarygodna próba).             */

import { FACTOR_KEYS } from './features.js';

function standardizer(history) {
  const mean = {}, std = {};
  for (const k of FACTOR_KEYS) {
    let s = 0, n = 0;
    for (const h of history) { if (h && h.x) { s += (h.x[k] || 0); n++; } }
    const mu = n ? s / n : 0;
    let v = 0;
    for (const h of history) { if (h && h.x) { const d = (h.x[k] || 0) - mu; v += d * d; } }
    mean[k] = mu;
    std[k] = n > 1 ? Math.sqrt(v / (n - 1)) || 1 : 1; // std=0 (stała cecha) → 1 (neutralne)
  }
  return { mean, std };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function similarOutcomes(history, x, K = 20) {
  if (!history || history.length < 5) return null;
  const { mean, std } = standardizer(history);
  const zx = {};
  for (const k of FACTOR_KEYS) zx[k] = ((x[k] || 0) - mean[k]) / std[k];
  const d2 = (a) => {
    let s = 0;
    for (const k of FACTOR_KEYS) { const d = ((a[k] || 0) - mean[k]) / std[k] - zx[k]; s += d * d; }
    return s;
  };
  const scored = [];
  for (const h of history) {
    if (!h || !h.x) continue;
    scored.push({ y: h.y, d2: d2(h.x) });
  }
  if (scored.length < 5) return null;
  scored.sort((a, b) => a.d2 - b.d2);
  const nn = scored.slice(0, Math.min(K, scored.length));

  // bandwidth = mediana DYSTANSÓW (nie kwadratów), z dolną klamrą by uniknąć h=0
  const dists = nn.map(n => Math.sqrt(n.d2));
  const h = Math.max(1e-3, median(dists));
  const h2 = 2 * h * h;

  let W = 0, wy = 0, dSum = 0, W2 = 0;
  for (const n of nn) {
    const w = Math.exp(-n.d2 / h2);           // jądro gaussowskie
    W += w; wy += w * n.y; W2 += w * w; dSum += Math.sqrt(n.d2);
  }
  const nEff = W2 > 0 ? (W * W) / W2 : 0;      // efektywna liczba sąsiadów
  if (nEff < 5) return null;                    // za mało realnie ważących analogów

  return {
    pEmp: +(wy / W).toFixed(3),
    n: nn.length,
    nEff: +nEff.toFixed(2),
    avgDist: +(dSum / nn.length).toFixed(3),
    wins: nn.filter(n => n.y === 1).length,
  };
}

/* mieszanie z modelem: wpływ kNN rośnie z liczbą i bliskością analogów,
   ale twardo ograniczony (maxLambda) — kNN koryguje, nie przejmuje. */
export function blendProb(pModel, sim, maxLambda = 0.35) {
  if (!sim || !sim.n) return pModel;
  const lam = Math.min(maxLambda, sim.n / (sim.n + 20)) * Math.exp(-Math.min(2, sim.avgDist));
  return +(lam * sim.pEmp + (1 - lam) * pModel).toFixed(4);
}
