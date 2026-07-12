import { describe, it, expect, beforeEach, vi } from 'vitest';

/* Prosty in-memory localStorage do testu Store (jsdom niepotrzebny). */
function installLocalStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
  return map;
}

let store;
beforeEach(async () => {
  installLocalStorage();
  vi.resetModules();
  store = await import('../src/core/store.js? v=' + Math.random());
});

describe('[C1] modelKey namespacing per instrument × TF', () => {
  it('klucz zawiera symbol i TF', () => {
    const { modelKey } = store;
    expect(modelKey('weights', '^GDAXI', 'M5')).toBe('rt_weights_^GDAXI_M5');
    expect(modelKey('calib', 'EURUSD=X', 'H1')).toBe('rt_calib_EURUSD=X_H1');
  });

  it('trening pary A/TF NIE zmienia modelu odczytywanego dla pary B/innego TF', () => {
    const { Store, modelKey } = store;
    // zapis modelu dla A/M5
    Store.set(modelKey('weights', 'AAA', 'M5'), { trend: 0.9 });
    Store.set(modelKey('meta', 'AAA', 'M5'), { reliable: true, n: 200 });
    // odczyt dla B/M15 → brak (null) → fallback DEFAULT
    expect(Store.get(modelKey('weights', 'BBB', 'M15'), null)).toBeNull();
    expect(Store.get(modelKey('meta', 'BBB', 'M15'), null)).toBeNull();
    // odczyt dla A/M15 (inny TF tej samej pary) → też brak
    expect(Store.get(modelKey('weights', 'AAA', 'M15'), null)).toBeNull();
    // A/M5 nietknięte
    expect(Store.get(modelKey('weights', 'AAA', 'M5'), null)).toEqual({ trend: 0.9 });
  });
});

describe('[C1] migracja v2 usuwa stare globalne klucze i nie kasuje danych usera', () => {
  it('usuwa rt_model_* i pokazuje toast raz', () => {
    const { Store, migrateModelV2 } = store;
    Store.set('rt_model_weights', { trend: 1 });
    Store.set('rt_model_calib', [{ lo: 0, hi: 1, v: 0.5 }]);
    Store.set('rt_journal_v1', [{ id: 1 }]); // dane usera — muszą przetrwać
    let toasts = 0;
    const had = migrateModelV2(() => toasts++);
    expect(had).toBe(true);
    expect(toasts).toBe(1);
    expect(Store.get('rt_model_weights', null)).toBeNull();
    expect(Store.get('rt_model_calib', null)).toBeNull();
    expect(Store.get('rt_journal_v1', null)).toEqual([{ id: 1 }]); // dane usera OK
    expect(Store.get('rt_migrated_v2', false)).toBe(true);
    // druga migracja: nic nie robi (flaga)
    let toasts2 = 0;
    expect(migrateModelV2(() => toasts2++)).toBe(false);
    expect(toasts2).toBe(0);
  });
});
