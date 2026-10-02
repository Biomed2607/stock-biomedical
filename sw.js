const CACHE = 'biomed-pwa-v3';
const LOCAL_FILES = ['./', './index.html', './stock.html', './gestion-stock.html', './ajouter-consommable.html', './styles.css?v=93',
  './index.js?v=93', './stock-utils.js', './pwa.js?v=93', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './hopital_prive_drome_ardeche_logo.jpeg'];
const CDN_FILES = ['https://cdn.jsdelivr.net/npm/appwrite@15.0.0/+esm',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The SDK is necessary to start the application offline. Do not mark an incomplete installation ready.
    // A new worker must not seed its cache with HTML from the browser HTTP cache.
    const freshLocalRequests = LOCAL_FILES.map(path => {
      const url = new URL(path, self.registration.scope);
      url.searchParams.set('release', CACHE);
      return new Request(url, { cache: 'reload' });
    });
    await cache.addAll([...freshLocalRequests, ...CDN_FILES.map(url => new Request(url, { cache: 'reload' }))]);
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
    const cached = await cache.match(request, { ignoreSearch: local });
    // Serve a consistent version of the application until the user accepts the next service worker.
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && (cdn || /\.(?:js|css|png|jpeg|html)$/.test(url.pathname))) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (request.mode === 'navigate') return await cache.match(new URL('./stock.html', self.registration.scope).href, { ignoreSearch: true });
      throw error;
    }
  })());
});
