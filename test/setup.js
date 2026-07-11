/* Minimalny shim przeglądarki dla testów logiki (bez jsdom).
   Moduły data/* i core/net.js odwołują się do window/localStorage przy imporcie. */
if (typeof globalThis.window === 'undefined') globalThis.window = {};
if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { onLine: true, userAgent: 'node' };
if (typeof globalThis.localStorage === 'undefined') {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}
if (typeof globalThis.document === 'undefined') globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
