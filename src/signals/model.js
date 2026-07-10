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
    logloss: +(ll / samples.length).toFixed(4),
    accuracy: +(correct / samples.length).toFixed(3),
    baseRate: +(samples.reduce((a, s) => a + s.y, 0) / samples.length).toFixed(3),
  };
}

/* Expected Value w jednostkach R: p*RR - (1-p)*1 - koszt(R) */
export function expectedValueR(prob, rr, costR) {
  return prob * rr - (1 - prob) * 1 - (costR || 0);
}
