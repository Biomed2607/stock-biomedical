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
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    let reloadRequested = false;
    let reloading = false;
    const button = document.querySelector('#updateAppBtn');
    function offerUpdate() {
      if (!button) return;
      button.hidden = false;
      button.onclick = () => {
        if (!confirm('Recharger l’application ? Terminez d’abord votre mouvement en cours.')) return;
        reloadRequested = true;
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
      };
    }
    if (reg.waiting && hadController) offerUpdate();
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', () => {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate();
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // A background update must not erase an unsaved form or stock movement.
      // Fresh pages load automatically on the next navigation/opening.
      if (!hadController || reloading) return;
      if (reloadRequested) { reloading = true; location.reload(); }
      else offerUpdate();
    });
    const checkUpdate = () => { if (navigator.onLine) reg.update().catch(() => {}); };
    window.addEventListener('online', checkUpdate);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkUpdate();
    });
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
