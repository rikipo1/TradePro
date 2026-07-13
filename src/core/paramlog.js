/* [E2-5] Log zmian parametrów toru decyzyjnego (rt_paramlog).
   Fundament pod Adaptive Learning Control (E4-3): każda zmiana progu
   wpływającego na decyzje jest zapisana (data, pole, stare→nowe), więc
   można ją później zwalidować i w razie regresji cofnąć. */

import { Store } from './store.js';

const KEY = 'rt_paramlog';
const CAP = 200;

export function logParamChange(field, oldV, newV, extra) {
  if (oldV === newV) return null;
  const entry = { ts: Date.now(), field, old: oldV != null ? oldV : null, nowy: newV != null ? newV : null, ...(extra || {}) };
  const list = Store.get(KEY, []);
  const next = [entry, ...list].slice(0, CAP);
  Store.set(KEY, next);
  return entry;
}

export function getParamLog() {
  return Store.get(KEY, []);
}
