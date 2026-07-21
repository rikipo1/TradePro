/* [E2-1] Harness ablacyjny (Feature Importance Engine).
   Dla każdej konfiguracji (pełna / bez jednego elementu) uruchamia
   walkForwardKFold NA TYCH SAMYCH świecach i zestawia metryki OOS.
   Reguła decyzyjna (brief): jeżeli usunięcie elementu poprawia med(avgR)
   OOS na ≥2 z 3 instrumentów — element wylatuje z toru decyzyjnego
   (zostaje w UI jako diagnostyka). Wyniki → docs/ABLACJA.md. */

import { walkForwardKFold } from './engine.js';
import { indicatorsFor } from '../signals/engine.js';

export const ABLATION_CONFIGS = [
  ['pełna', null],
  ['−liquidity', { liquidity: true }],
  ['−location', { location: true }],
  ['−session', { session: true }],
  ['−pillarGate', { pillarGate: true }],
  ['−htfGate', { htfGate: true }],
  ['−smc', { smc: true }],
];

export function ablationTable(candles, sym, tfId, opts = {}) {
  const pack = indicatorsFor(candles, tfId);
  if (!pack) return [];
  const rows = [];
  for (const [name, ablate] of ABLATION_CONFIGS) {
    const kf = walkForwardKFold(candles, pack.ind, pack.emaData, pack.hasVol, sym,
      opts.minScore != null ? opts.minScore : 30, opts.smcCfg || null, tfId,
      { timeBudgetMs: opts.timeBudgetMs != null ? opts.timeBudgetMs : 120000, ablate });
    if (kf.ok) {
      rows.push({
        konfiguracja: name, n_oos: kf.totalNoos,
        medAvgR: kf.agg.avgR.med, medPF: kf.agg.pf.med,
        medWin: kf.agg.winRate.med, brierP75: kf.agg.brier.p75,
      });
    } else {
      rows.push({ konfiguracja: name, n_oos: 0, blad: kf.reason });
    }
  }
  return rows;
}

export function ablationAscii(rows) {
  const cols = ['konfiguracja', 'n_oos', 'medAvgR', 'medPF', 'medWin', 'brierP75', 'blad'];
  const line = r => cols.map(c => String(r[c] != null ? r[c] : '—').padEnd(13)).join('| ');
  return [line(Object.fromEntries(cols.map(c => [c, c]))),
    ...rows.map(line)].join('\n');
}
