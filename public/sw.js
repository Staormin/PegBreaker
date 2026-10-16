// public/sw.js — service worker minimal de Pegbreaker (jeu jouable hors ligne).
// - precache : la page, le manifeste, l'icône, et les assets référencés par index.html
//   (découverts à l'installation : Vite ne génère pas de manifeste de precache) ;
// - navigations : réseau d'abord (pour recevoir les nouvelles versions), cache en secours ;
// - autres requêtes same-origin : cache d'abord, puis réseau avec mise en cache à la volée ;
// - la page envoie aussi la liste des ressources déjà chargées (message 'precache').
// Incrémenter CACHE_VERSION à chaque changement de stratégie ; les anciens caches sont purgés.
const CACHE_VERSION = 2;
const CACHE = `pegbreaker-v${CACHE_VERSION}`;
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-maskable.svg'];

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);
  // assets de la page (scripts, feuilles de style, préchargements)
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    const html = await res.text();
    const urls = new Set();
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const u = new URL(m[1], self.registration.scope);
      if (u.origin === self.location.origin) urls.add(u.href);
    }
    await Promise.all([...urls].map((u) => cache.add(u).catch(() => undefined)));
  } catch {
    /* hors ligne pendant l'installation : la mise en cache à la volée prendra le relais */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pegbreaker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'precache' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        data.urls
          .filter((u) => typeof u === 'string' && new URL(u).origin === self.location.origin)
          .map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => undefined))),
      ),
    ),
  );
});

function cacheIfOk(cache, req, res) {
  if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        fetch(req)
          .then((res) => cacheIfOk(cache, req, res))
          .catch(() =>
            cache.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || cache.match('./index.html', { ignoreVary: true })),
          ),
      ),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => cacheIfOk(cache, req, res))),
    ),
  );
});
