const installButton = document.querySelector('#installAppBtn');
const connectionStatus = document.querySelector('#connectionStatus');
let installPrompt;
function updateConnection() {
  connectionStatus.textContent = navigator.onLine ? 'En ligne' : 'Hors connexion · consultation uniquement';
  connectionStatus.classList.toggle('offline', !navigator.onLine);
  document.body.classList.toggle('offline', !navigator.onLine);
}
updateConnection();
window.addEventListener('online', () => {
  updateConnection();
  const status = document.querySelector('#dataStatus');
  if (status) status.textContent = 'Connexion rétablie. Actualisez le stock avant de continuer.';
});
window.addEventListener('offline', updateConnection);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; if (installButton) installButton.hidden = false;
});
window.addEventListener('appinstalled', () => { if (installButton) installButton.hidden = true; installPrompt = null; });
installButton?.addEventListener('click', async () => {
  if (installPrompt) {
    await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null;
  } else {
    const help = document.querySelector('#installHelp');
    help.hidden = !help.hidden;
  }
});
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) if (installButton) installButton.hidden = true;
// Increment with CACHE in sw.js for every published application release.
const APP_VERSION = 'biomed-pwa-v6';
let updateNoticeTimer;
function showUpdateNotice(updated) {
  let notice = document.querySelector('#appUpdateNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'appUpdateNotice';
    notice.className = 'app-update-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-atomic', 'true');
    document.body.append(notice);
  }
  notice.textContent = updated
    ? '✓ Application mise à jour'
    : '↻ Mise à jour prête · Elle s’appliquera à la prochaine ouverture ou navigation.';
  notice.hidden = false;
  window.clearTimeout(updateNoticeTimer);
  updateNoticeTimer = window.setTimeout(() => { notice.hidden = true; }, 5000);
}
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  // Remember the version actually loaded, not merely downloaded in the background.
  let previousVersion = null;
  try {
    previousVersion = localStorage.getItem('biomed-app-version');
    localStorage.setItem('biomed-app-version', APP_VERSION);
  } catch (_) { /* Private browsing may make storage unavailable. */ }
  if ((previousVersion && previousVersion !== APP_VERSION) || (!previousVersion && hadController)) {
    showUpdateNotice(true);
  }
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    let offeredVersion = null;
    const readVersion = worker => worker?.postMessage({ type: 'GET_APP_VERSION' });
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type !== 'APP_VERSION') return;
      const version = event.data.version;
      const number = /^biomed-pwa-v(\d+)$/.exec(version || '');
      if (!number || Number(number[1]) <= Number(APP_VERSION.split('-v')[1])) return;
      // One brief notice per detected version; never interrupt a stock movement.
      if (offeredVersion === version) return;
      offeredVersion = version;
      showUpdateNotice(false);
    });
    const watchWorker = worker => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') readVersion(worker);
      });
      if (worker.state === 'installed' || worker.state === 'activated') readVersion(worker);
    };
    watchWorker(reg.installing);
    readVersion(reg.waiting);
    readVersion(navigator.serviceWorker.controller);
    reg.addEventListener('updatefound', () => watchWorker(reg.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      readVersion(navigator.serviceWorker.controller);
    });
    const checkUpdate = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    window.addEventListener('online', checkUpdate);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkUpdate();
    });
    window.setInterval(() => {
      if (document.visibilityState === 'visible') checkUpdate();
    }, 5 * 60 * 1000);
    checkUpdate();
  }).catch(() => {
    const help = document.querySelector('#installHelp');
    if (help) help.textContent = 'Le mode hors connexion n’est pas disponible dans ce navigateur. Le site reste utilisable en ligne.';
  });
}

const backToTop = document.querySelector('#backToTopBtn');
if (backToTop) {
  const updateScrollButton = () => { backToTop.hidden = window.scrollY < 240; };
  window.addEventListener('scroll', updateScrollButton, { passive: true });
  updateScrollButton();
  backToTop.addEventListener('click', () => window.scrollTo({
    top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  }));
}
