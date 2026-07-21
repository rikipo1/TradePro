/* [E3-5] Wersjonowanie modelu + rollback (Model Risk Governance).
   Każdy trening tworzy NOWĄ wersję pod kluczami rt_weights_<sym>_<tf>_v<N>
   (max 3, FIFO) ze wskaźnikiem rt_active_<sym>_<tf>. Globalne klucze
   rt_model_* pozostają źródłem prawdy dla toru live (konsumenci bez zmian);
   wersje służą historii i przywracaniu. */

import { Store } from './store.js';

export const MAX_MODEL_VERSIONS = 3;
const wKey = (sym, tf, v) => 'rt_weights_' + sym + '_' + tf + '_v' + v;
const aKey = (sym, tf) => 'rt_active_' + sym + '_' + tf;
const lKey = (sym, tf) => 'rt_versions_' + sym + '_' + tf;

/* payload: { weights, calib, meta, knn } */
export function saveModelVersion(sym, tf, payload) {
  const list = Store.get(lKey(sym, tf), []);
  const v = (list.length ? Math.max(...list) : 0) + 1;
  Store.set(wKey(sym, tf, v), payload);
  const next = [...list, v];
  while (next.length > MAX_MODEL_VERSIONS) {
    const drop = next.shift();
    Store.set(wKey(sym, tf, drop), null); // FIFO — najstarsza wersja wypada
  }
  Store.set(lKey(sym, tf), next);
  Store.set(aKey(sym, tf), v);
  return v;
}

export function listModelVersions(sym, tf) {
  return Store.get(lKey(sym, tf), [])
    .map(v => {
      const p = Store.get(wKey(sym, tf, v), null);
      return p ? { v, meta: p.meta || null } : null;
    })
    .filter(Boolean);
}

export function getActiveVersion(sym, tf) {
  return Store.get(aKey(sym, tf), null);
}

export function getModelVersion(sym, tf, v) {
  return Store.get(wKey(sym, tf, v), null);
}

/* rollback: ustaw wskaźnik + skopiuj payload do kluczy live */
export function activateModelVersion(sym, tf, v) {
  const p = Store.get(wKey(sym, tf, v), null);
  if (!p) return false;
  Store.set(aKey(sym, tf), v);
  Store.set('rt_model_weights', p.weights || null);
  Store.set('rt_model_calib', p.calib || null);
  Store.set('rt_knn_history', p.knn || null);
  Store.set('rt_model_meta', p.meta || null);
  return true;
}
