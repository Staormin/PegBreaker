// tests/e2e/offline.spec.ts — propriétaire : qa-tester. Build statique jouable hors ligne (service worker).
// Le SW ne s'enregistre pas sur localhost (ui/pwa.ts) : un second `vite preview` est lancé sur 127.0.0.1:4176.
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { QA_OUT, FINAL_SHOTS, watchErrors, type QaWindow } from './bots';

const ORIGIN = 'http://127.0.0.1:4176';
let server: ChildProcess | null = null;

test.beforeAll(async () => {
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${ORIGIN}/`);
      if (r.ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('vite preview sur 127.0.0.1:4176 injoignable');
});

test.afterAll(() => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
});

test('hors ligne : SW actif, rechargement sans réseau → jeu en phase aiming, 0 erreur console', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 540, height: 960 } });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => !!(window as unknown as QaWindow).__pegbreaker?.sim);
  // attendre l'activation du SW puis qu'il contrôle la page (clients.claim ou rechargement)
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15_000 });
  let controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) {
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as QaWindow).__pegbreaker?.sim);
    controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  }
  expect(controlled, 'navigator.serviceWorker.controller').toBe(true);
  await page.waitForTimeout(800); // precache des ressources chargées (message 'precache')
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    let n = 0;
    for (const k of keys) n += (await (await caches.open(k)).keys()).length;
    return { keys, entries: n };
  });

  await context.setOffline(true);
  const online = await page.evaluate(() => navigator.onLine);
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as QaWindow).__pegbreaker?.sim, null, { timeout: 15_000 });
  const st = await page.evaluate(() => {
    const api = (window as unknown as QaWindow).__pegbreaker;
    return { phase: api.sim.state.phase, errors: api.errors.slice(), controlled: !!navigator.serviceWorker.controller };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${FINAL_SHOTS}/08-hors-ligne.png` });
  const out = { cached, navigatorOnLineAfterSetOffline: online, afterOfflineReload: st };
  writeFileSync(`${QA_OUT}-offline.json`, JSON.stringify(out, null, 2) + '\n');
  test.info().annotations.push({ type: 'offline', description: JSON.stringify(out) });
  expect(online).toBe(false);
  expect(st.phase).toBe('aiming');
  expect(st.errors).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});
