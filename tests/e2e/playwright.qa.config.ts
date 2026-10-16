// tests/e2e/playwright.qa.config.ts — propriétaire : qa-tester.
// Variante de playwright.config.ts (racine) qui sert dist/ sur un port dédié (4177) au lieu de 4173 :
// évite de réutiliser (reuseExistingServer) un `vite preview` étranger déjà lancé sur 4173.
// Usage : npm run build && npx playwright test -c tests/e2e/playwright.qa.config.ts
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const PORT = 4177;

export default defineConfig({
  ...base,
  testDir: '.',
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
