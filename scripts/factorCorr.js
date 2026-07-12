/* ---------------- [W2] Diagnostyka korelacji faktorów ----------------
   NARZĘDZIE DEV (nie zmienia runtime aplikacji). Liczy macierz korelacji
   Pearsona między FACTOR_KEYS na podstawie zbuforowanych próbek rt_samples_*.
   Cel: wykryć faktory niosące tę samą informację (iluzja konfluencji).

   INTERPRETACJA: jeśli |corr| > 0.6 dla pary faktorów → są kandydatami do
   SCALENIA w kolejnej iteracji (dublują dowód, model liczy go podwójnie).

   Użycie:
     • w przeglądarce (konsola dev):
         import { factorCorrFromStore } from './scripts/factorCorr.js';
         factorCorrFromStore(Store, '^GDAXI', 'M5');   // drukuje macierz 6×6
     • w node (na wyeksportowanym buforze JSON):
         node scripts/factorCorr.js sciezka/do/rt_samples.json
*/

import { FACTOR_KEYS } from '../src/signals/features.js';

/* Pearson r dla dwóch wektorów równej długości */
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  const den = Math.sqrt(va * vb);
  return den > 0 ? cov / den : 0;
}

/* macierz korelacji 6×6 nad FACTOR_KEYS z listy próbek {x:{...}} */
export function factorCorrelation(samples) {
  const keys = FACTOR_KEYS;
  const cols = keys.map(k => samples.map(s => (s.x ? (s.x[k] || 0) : (s[k] || 0))));
  const matrix = keys.map((_, i) => keys.map((__, j) => +pearson(cols[i], cols[j]).toFixed(3)));
  return { keys, matrix, n: samples.length };
}

/* ładny wydruk macierzy + lista par |corr|>0.6 */
export function printFactorCorrelation(samples, log = console.log) {
  const { keys, matrix, n } = factorCorrelation(samples);
  log('Macierz korelacji faktorów (Pearson) — n=' + n + ' próbek:');
  const head = '        ' + keys.map(k => k.slice(0, 6).padStart(7)).join('');
  log(head);
  for (let i = 0; i < keys.length; i++) {
    log(keys[i].slice(0, 7).padEnd(8) + matrix[i].map(v => v.toFixed(2).padStart(7)).join(''));
  }
  const dup = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      if (Math.abs(matrix[i][j]) > 0.6) dup.push(keys[i] + '×' + keys[j] + '=' + matrix[i][j]);
  log(dup.length ? '⚠ Kandydaci do scalenia (|corr|>0.6): ' + dup.join(', ')
                 : '✓ Brak par |corr|>0.6 — faktory względnie ortogonalne.');
  return { keys, matrix, n, dup };
}

/* odczyt z bufora rt_samples_<sym>_<tf> w Store (przeglądarka) */
export function factorCorrFromStore(Store, sym, tfId, log = console.log) {
  const samples = Store.get('rt_samples_' + sym + '_' + tfId, []);
  if (!samples.length) { log('Brak zbuforowanych próbek dla ' + sym + ' · ' + tfId); return null; }
  return printFactorCorrelation(samples, log);
}

/* CLI: node scripts/factorCorr.js <plik.json> */
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('factorCorr.js')) {
  const file = process.argv[2];
  if (!file) { console.log('Użycie: node scripts/factorCorr.js <plik.json z listą próbek>'); }
  else {
    import('node:fs').then(fs => {
      const samples = JSON.parse(fs.readFileSync(file, 'utf8'));
      printFactorCorrelation(samples);
    });
  }
}
