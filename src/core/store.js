/* ============================ [1] STORAGE ============================ */
export const Store = (() => {
  const mem = {};
  let ok = false;
  try { localStorage.setItem('__rt_test','1'); localStorage.removeItem('__rt_test'); ok = true; } catch(e){ ok = false; }
  return {
    persistent: ok,
    get(k, d){
      try{ if(ok){ const v = localStorage.getItem(k); if(v !== null) return JSON.parse(v); } }catch(e){}
      return (k in mem) ? mem[k] : d;
    },
    set(k, v){
      mem[k] = v;
      try{ if(ok) localStorage.setItem(k, JSON.stringify(v)); }catch(e){}
    },
    del(k){
      delete mem[k];
      try{ if(ok) localStorage.removeItem(k); }catch(e){}
    }
  };
})();

/* [C1] KLUCZ MODELU PER INSTRUMENT × TIMEFRAME.
   Wcześniej wagi/kalibracja/kNN były trzymane pod GLOBALNYMI kluczami
   (rt_model_weights itd.) i stosowane do WSZYSTKICH instrumentów/interwałów —
   co unieważniało kalibrację P(win) sterującą wejściem i sizingiem. Teraz każdy
   artefakt modelu jest namespace'owany: rt_${kind}_${sym}_${tfId}.
   kind ∈ 'weights' | 'calib' | 'knn' | 'meta'. */
export function modelKey(kind, sym, tfId){
  return `rt_${kind}_${sym}_${tfId}`;
}

/* [C3] scalanie bufora próbek: prior + świeże, deduplikacja po ts+i0,
   cap FIFO (najstarsze wypadają). Pozwala próbie rosnąć między sesjami. */
export function mergeSamples(prior, fresh, cap = 2000){
  const seen = new Set((prior || []).map(s => s.ts + '|' + s.i0));
  const add = (fresh || []).filter(s => !seen.has(s.ts + '|' + s.i0));
  return (prior || []).concat(add).slice(-cap);
}

const LEGACY_MODEL_KEYS = ['rt_model_weights', 'rt_model_calib', 'rt_knn_history', 'rt_model_meta'];

/* [C1] MIGRACJA v2: starych GLOBALNYCH kluczy modelu NIE da się przypisać do
   konkretnej pary (nie wiadomo z czego pochodzą), więc je USUWAMY (nie kasujemy
   danych użytkownika — dziennik/watchlista/prefs zostają nietknięte) i pokazujemy
   jednorazowy toast. Flaga rt_migrated_v2 zapobiega powtórzeniu. */
export function migrateModelV2(onToast){
  if(Store.get('rt_migrated_v2', false)) return false;
  const had = LEGACY_MODEL_KEYS.some(k => Store.get(k, null) != null);
  for(const k of LEGACY_MODEL_KEYS) Store.del(k);
  Store.set('rt_migrated_v2', true);
  if(had && typeof onToast === 'function'){
    onToast('Zresetowano stary globalny model — wytrenuj per instrument/TF');
  }
  return had;
}
