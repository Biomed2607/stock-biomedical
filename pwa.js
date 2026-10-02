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
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    function offerUpdate() {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      const button = document.querySelector('#updateAppBtn');
      button.hidden = false;
      button.onclick = () => { if (confirm('Recharger l’application ? Terminez d’abord votre mouvement en cours.')) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); };
    }
    offerUpdate();
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', offerUpdate);
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      // Initial installation needs no reload. Reload only for a user-approved update.
      if (!document.querySelector('#updateAppBtn').hidden) { reloading = true; location.reload(); }
    });
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
