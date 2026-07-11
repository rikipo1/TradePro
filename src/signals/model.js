/* ---------------- Model prawdopodobieństwa (ETAP 3) ----------------
   Zastępuje "score jako sumę punktów" KALIBROWANYM P(win). Model to prosta
   regresja logistyczna nad ortogonalnymi czynnikami. Wagi mogą być:
     • domyślne (rozsądny priors), albo
     • WYUCZONE z wyników backtestu (adaptive weights) — trainLogistic().
   Output setupScore 0..100 = zaokrąglone P(win)*100 (realne prawdopodobieństwo,
   nie arbitralny score).                                                     */

import { FACTOR_KEYS } from './features.js';

/* priors: dodatnie wagi dla czynników sprzyjających wygranej po ustawieniu na dir.
   Dobrane tak, by przy pełnej zgodzie czynników P(win) ~0.72, przy zerowej ~0.5. */
/* Priors świadomie OSTROŻNE (anty-overconfidence): pełna zgoda czynników daje
   ~0.72, setup neutralny ~0.46 (poniżej progu → brak wejścia). Ujemny bias
   odzwierciedla, że edge jest trudny i koszty istnieją. Wagi wyuczone z
   backtestu (trainLogistic) je zastępują, gdy zbiorą dość danych. */
export const DEFAULT_WEIGHTS = {
  bias: -0.15,
  trend: 0.35,
  momentum: 0.20,
  location: 0.30,
  liquidity: 0.22,
  confirmation: 0.35,
  htf: 0.28,
};

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export function predictProb(oriented, weights) {
  const w = weights || DEFAULT_WEIGHTS;
  let z = w.bias || 0;
  for (const k of FACTOR_KEYS) z += (w[k] || 0) * (oriented[k] || 0);
  return sigmoid(z);
}

/* trening: samples = [{ x: orientedVector, y: 1|0 }]. Gradient descent + L2.
   Zwraca wagi + metryki (logloss, accuracy, n). Wagi nadpisują domyślne. */
export function trainLogistic(samples, opts = {}) {
  const lr = opts.lr || 0.1;
  const epochs = opts.epochs || 400;
  const l2 = opts.l2 || 0.002;
  if (!samples || samples.length < 30) {
    return { weights: { ...DEFAULT_WEIGHTS }, trained: false, n: samples ? samples.length : 0, reason: 'za mało próbek (min 30)' };
  }
  const w = { bias: 0 };
  for (const k of FACTOR_KEYS) w[k] = 0;

  for (let e = 0; e < epochs; e++) {
    const grad = { bias: 0 };
    for (const k of FACTOR_KEYS) grad[k] = 0;
    for (const s of samples) {
      let z = w.bias;
      for (const k of FACTOR_KEYS) z += w[k] * (s.x[k] || 0);
      const p = sigmoid(z);
      const err = p - s.y;
      grad.bias += err;
      for (const k of FACTOR_KEYS) grad[k] += err * (s.x[k] || 0);
    }
    const m = samples.length;
    w.bias -= lr * (grad.bias / m);
    for (const k of FACTOR_KEYS) w[k] -= lr * (grad[k] / m + l2 * w[k]);
  }

  // metryki na zbiorze treningowym (informacyjnie)
  let ll = 0, correct = 0;
  for (const s of samples) {
    let z = w.bias;
    for (const k of FACTOR_KEYS) z += w[k] * (s.x[k] || 0);
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
    ll += -(s.y * Math.log(p) + (1 - s.y) * Math.log(1 - p));
    if ((p >= 0.5 ? 1 : 0) === s.y) correct++;
  }
  return {
    weights: w, trained: true, n: samples.length,
    /* UWAGA: metryki poniżej są IN-SAMPLE (na zbiorze treningowym) — służą
       tylko diagnostyce zbieżności. Jedyny uczciwy dowód to OOS (walk-forward). */
    logloss: +(ll / samples.length).toFixed(4),
    accuracy: +(correct / samples.length).toFixed(3),
    baseRate: +(samples.reduce((a, s) => a + s.y, 0) / samples.length).toFixed(3),
    reliable: samples.length >= 150, // K5: poniżej 150 transakcji wagi = szum
  };
}

/* Expected Value w jednostkach R: p*RR - (1-p)*1 - koszt(R) */
export function expectedValueR(prob, rr, costR) {
  return prob * rr - (1 - prob) * 1 - (costR || 0);
}

/* ---------------- KALIBRACJA (K4) ----------------
   Surowa sigmoida nie jest prawdopodobieństwem skalibrowanym. Isotonic
   regression (algorytm PAV) uczy monotoniczną mapę p_surowe → p_realne
   z par (predykcja, wynik). Wymaga sensownej próby (≥150), inaczej null —
   lepiej nie kalibrować wcale niż kalibrować szumem.                     */
export function fitIsotonic(pairs, minN = 150) {
  if (!pairs || pairs.length < minN) return null;
  const s = pairs.slice().sort((a, b) => a.p - b.p);
  const st = [];
  for (const q of s) {
    st.push({ lo: q.p, hi: q.p, sum: q.y, n: 1 });
    while (st.length > 1 && st[st.length - 2].sum / st[st.length - 2].n >= st[st.length - 1].sum / st[st.length - 1].n) {
      const b2 = st.pop(), b1 = st.pop();
      st.push({ lo: b1.lo, hi: b2.hi, sum: b1.sum + b2.sum, n: b1.n + b2.n });
    }
  }
  return st.map(b => ({ lo: +b.lo, hi: +b.hi, v: +(b.sum / b.n) }));
}

export function applyIsotonic(p, calib) {
  if (!calib || !calib.length) return p;
  const cl = (x) => Math.max(0.02, Math.min(0.98, x));
  if (p <= calib[0].lo) return cl(calib[0].v);
  for (let i = 0; i < calib.length; i++) {
    if (p <= calib[i].hi) return cl(calib[i].v);
    const next = calib[i + 1];
    if (next && p < next.lo) { // interpolacja między blokami
      const t = (p - calib[i].hi) / (next.lo - calib[i].hi || 1e-9);
      return cl(calib[i].v + t * (next.v - calib[i].v));
    }
  }
  return cl(calib[calib.length - 1].v);
}

/* Brier score: średni (p − y)² — im niżej, tym uczciwsze prawdopodobieństwa.
   0.25 = poziom rzutu monetą; sensowny model < 0.23 na OOS. */
export function brierScore(pairs) {
  if (!pairs || !pairs.length) return null;
  return +(pairs.reduce((a, q) => a + (q.p - q.y) ** 2, 0) / pairs.length).toFixed(4);
}
