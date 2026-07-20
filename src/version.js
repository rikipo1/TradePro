/* Wersja wstrzykiwana w czasie builda (vite.config.js) — jedyne źródło to package.json. */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const BUILD_NUMBER = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev';
export const VERSION_LABEL = `v${APP_VERSION} · build ${BUILD_NUMBER}`;
