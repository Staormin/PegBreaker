// ui/pwa.ts — enregistrement du service worker (public/sw.js) pour jouer hors ligne.
// Uniquement sur le build de production et hors localhost : le serveur de dev et les tests
// Playwright (baseURL localhost) ne sont jamais servis par le cache.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const host = location.hostname;
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.localhost')) return;
  const register = (): void => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(async (reg) => {
        // les ressources déjà chargées avant l'activation du SW sont mises en cache aussi
        const ready = await navigator.serviceWorker.ready;
        const urls = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin));
        urls.push(location.href);
        (ready.active ?? reg.active)?.postMessage({ type: 'precache', urls });
      })
      .catch(() => {
        /* pas de SW (navigation privée, protocole file:) : le jeu marche quand même en ligne */
      });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
