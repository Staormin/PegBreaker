// audio/playwright.audio.config.ts — propriétaire : audio-dev. Vérification audio jetable sur le
// serveur de dev (le module audio est importé à chaud par /src/audio/index.ts).
// npx playwright test -c src/audio/playwright.audio.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.pw.ts',
  timeout: 240_000,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    baseURL: 'http://localhost:5179',
    viewport: { width: 540, height: 960 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  // port dédié à cette vérification (5173 peut être occupé par un autre agent)
  webServer: { command: 'node node_modules/.bin/vite --port 5179 --strictPort', url: 'http://localhost:5179', reuseExistingServer: true, timeout: 60_000 },
});
