/* ---------------- Historical Similarity Engine (kNN) ----------------
   "Czy rynek wyglądał już tak wcześniej i co się wtedy stało?"
   Zamiast ufać wyłącznie modelowi liniowemu, szukamy K najbliższych
   HISTORYCZNYCH sytuacji (po wektorze cech zorientowanym na kierunek)
   i bierzemy ich empiryczną trafność. Łapie zależności NIELINIOWE
   (np. sweep w range ≠ sweep w trendzie) i daje modelowi "pamięć".
   Historia pochodzi z etykiet backtestu (walk-forward, część treningowa
   z embargo) — więc bez look-ahead względem danych OOS.               */

import { FACTOR_KEYS } from './features.js';

export function similarOutcomes(history, x, K = 20) {
  if (!history || history.length < 5) return null;
  const d2 = (a, b) => {
    let s = 0;
    for (const k of FACTOR_KEYS) { const d = (a[k] || 0) - (b[k] || 0); s += d * d; }
    return s;
  };
  const scored = [];
  for (const h of history) {
    if (!h || !h.x) continue;
    scored.push({ y: h.y, d: d2(h.x, x) });
  }
  if (scored.length < 5) return null;
  scored.sort((a, b) => a.d - b.d);
  const nn = scored.slice(0, Math.min(K, scored.length));
  let W = 0, wy = 0, dSum = 0;
  for (const n of nn) {
    const w = 1 / (1e-6 + n.d);
    W += w; wy += w * n.y; dSum += Math.sqrt(n.d);
  }
  return {
    pEmp: +(wy / W).toFixed(3),            // empiryczna trafność podobnych setupów
    n: nn.length,
    avgDist: +(dSum / nn.length).toFixed(3), // jak "blisko" są analogi (0 = identyczne)
    wins: nn.filter(n => n.y === 1).length,
  };
}

/* mieszanie z modelem: wpływ kNN rośnie z liczbą i bliskością analogów,
   ale jest twardo ograniczony (maxLambda) — kNN koryguje, nie przejmuje. */
export function blendProb(pModel, sim, maxLambda = 0.35) {
  if (!sim || !sim.n) return pModel;
  const lam = Math.min(maxLambda, sim.n / (sim.n + 20)) * Math.exp(-Math.min(2, sim.avgDist));
  return +(lam * sim.pEmp + (1 - lam) * pModel).toFixed(4);
}
