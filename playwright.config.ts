import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  retries: 0,
  reporter: [['list']],
  use: { headless: true, baseURL: 'http://localhost:4173', viewport: { width: 540, height: 960 } },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
});
