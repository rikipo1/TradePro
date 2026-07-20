import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// CI (GitHub Actions) ustawia GITHUB_RUN_NUMBER; lokalnie build oznaczany jest jako "dev".
const buildNumber = process.env.VERSION_CODE || process.env.GITHUB_RUN_NUMBER || 'dev';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_NUMBER__: JSON.stringify(String(buildNumber)),
  },
  server: { host: true, port: 5173 },
  build: {
    target: 'es2019',
    outDir: 'dist',
    sourcemap: false,
  },
});
