const CACHE = 'biomed-pwa-v4';
const LOCAL_FILES = ['./', './index.html', './stock.html', './gestion-stock.html', './ajouter-consommable.html', './styles.css?v=93',
  './index.js?v=93', './stock-utils.js', './pwa.js?v=94', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './hopital_prive_drome_ardeche_logo.jpeg'];
const CDN_FILES = ['https://cdn.jsdelivr.net/npm/appwrite@15.0.0/+esm',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'];
// Keep application version parameters: ?v=94 must never match a cached ?v=93.
function cacheKey(input) {
  const url = new URL(typeof input === 'string' ? input : input.url, self.registration.scope);
  url.searchParams.delete('__pwa');
  if (url.pathname === new URL(self.registration.scope).pathname) url.pathname += 'index.html';
  return url.href;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fetch fresh bytes but store canonical URLs for reliable offline lookup.
    await Promise.all(LOCAL_FILES.map(async path => {
      const url = new URL(path, self.registration.scope);
      url.searchParams.set('__pwa', CACHE);
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`Installation impossible : ${path}`);
      await cache.put(cacheKey(url.href), response);
    }));
    await cache.addAll(CDN_FILES.map(url => new Request(url, { cache: 'reload' })));
    // Existing installations must not stay indefinitely on the old interface.
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('biomed-pwa-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache Appwrite requests, function executions, or mail-provider responses.
  const local = url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
  const cdn = ['cdn.jsdelivr.net', 'unpkg.com'].includes(url.hostname);
  if (!local && !cdn) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = local ? cacheKey(request) : request;
    const cached = await cache.match(key);
    const page = local && (request.mode === 'navigate' || /\.html$/.test(url.pathname));
    // Online navigation gets current HTML; offline navigation keeps the requested page.
    if (page) {
      const fresh = new URL(request.url);
      fresh.searchParams.set('__pwa', String(Date.now()));
      try {
        const response = await fetch(new Request(fresh, { cache: 'no-store', signal: AbortSignal.timeout(5000) }));
        if (response.ok) {
          await cache.put(key, response.clone());
          return response;
        }
        return cached || response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && (cdn || /\.(?:js|css|png|jpeg|webmanifest)$/.test(url.pathname))) await cache.put(key, response.clone());
    return response;
  })());
});
