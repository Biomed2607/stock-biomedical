import { inspectAlertExecution, describeAlertError, findMatchingItems } from './stock-utils.js';
import { Client, Databases, Functions, ID, Query } from 'https://cdn.jsdelivr.net/npm/appwrite@15.0.0/+esm';

// ==============================
// CONFIGURATION APPWRITE
// ==============================

const APPWRITE_ENDPOINT = 'https://cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69f1d5220033c670e25a';

const DATABASE_ID = 'stock_biomedical_db';

const COLLECTIONS = {
  suppliers: 'fournisseurs',
  items: 'consommables',
  movements: 'mouvements_stock'
};

const DEFAULT_CATEGORY = 'Consommable';
const DEFAULT_EQUIPMENT_FAMILY = 'Moniteur multiparamétrique';
const DEFAULT_CONSUMABLE_TYPE = 'Capteur SpO2';

const ALERT_FUNCTION_ID = '6a01cb32002e0eed267b';
const ALERT_EMAIL = 'biomed-pole2607@ramsaysante.fr';

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);
const functions = new Functions(client);

// ==============================
// OUTILS
// ==============================

function euro(value) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9_-]/g, '');
}

function generateInternalCode(itemCode, equipmentFamily, consumableType) {
  const ref = normalizeCode(itemCode || 'BIO');
  const family = normalizeCode(equipmentFamily || 'FAM').slice(0, 8);
  const type = normalizeCode(consumableType || 'TYPE').slice(0, 8);
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();

  return `BIO-${family}-${type}-${ref}-${stamp}-${random}`.slice(0, 100);
}

function generateQrValue(itemCode) {
  return normalizeCode(itemCode);
}

function getSupplierEmail(item) {
  return item.Email || item.supplierEmail || '';
}

function getStatus(item) {
  const qty = safeNumber(item.stockQuantity);
  const threshold = safeNumber(item.alertThreshold);

  if (qty <= 0) {
    return { label: 'Rupture', className: 'out' };
  }

  if (threshold > 0 && qty <= threshold) {
    return { label: 'Stock bas', className: 'low' };
  }

  return { label: 'OK', className: 'ok' };
}

function statusRank(label) {
  if (label === 'Rupture') return 1;
  if (label === 'Stock bas') return 2;
  return 3;
}

function renderQrCode(element, value, size = 74) {
  if (!element || !value) return;

  element.innerHTML = '';

  if (!window.QRCode) {
    element.textContent = value;
    return;
  }

  new window.QRCode(element, {
    text: value,
    width: size,
    height: size,
    correctLevel: window.QRCode.CorrectLevel.M
  });
}

function renderAllQrCodes() {
  document.querySelectorAll('[data-qr-value]').forEach(element => {
    const value = element.getAttribute('data-qr-value');
    renderQrCode(element, value, 74);
  });
}

function printQrCode(item) {
  const qrValue = `BIOID:${item.$id}`;
  const itemCode = item.itemCode || '';
  const itemName = item.itemName || '';
  const equipmentFamily = item.equipmentFamily || '';
  const consumableType = item.consumableType || '';
  const storageLocation = item.storageLocation || '';

  if (!qrValue) {
    alert('Aucun QR code disponible pour ce consommable.');
    return;
  }

  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    alert('La fenêtre d’impression a été bloquée par le navigateur.');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <title>QR code — ${escapeHtml(itemCode)}</title>
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 24px;
          color: #111827;
        }

        .label {
          width: 370px;
          border: 1px solid #111827;
          border-radius: 12px;
          padding: 18px;
          text-align: center;
        }

        h1 {
          font-size: 18px;
          margin: 0 0 8px;
        }

        p {
          margin: 5px 0;
          font-size: 13px;
        }

        #qrcode {
          width: 170px;
          height: 170px;
          margin: 16px auto;
        }

        @media print {
          button {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="label">
        <h1>${escapeHtml(itemName)}</h1>
        <p><strong>Référence :</strong> ${escapeHtml(itemCode)}</p>
        <p><strong>Famille :</strong> ${escapeHtml(equipmentFamily)}</p>
        <p><strong>Type :</strong> ${escapeHtml(consumableType)}</p>
        <p><strong>Emplacement :</strong> ${escapeHtml(storageLocation)}</p>
        <div id="qrcode"></div>
        <p><strong>QR :</strong> ${escapeHtml(qrValue)}</p>
      </div>

      <br />
      <button onclick="window.print()">Imprimer</button>

      <script>
        new QRCode(document.getElementById("qrcode"), {
          text: ${JSON.stringify(qrValue)},
          width: 170,
          height: 170,
          correctLevel: QRCode.CorrectLevel.M
        });
      <\/script>
    </body>
    </html>
  `);

  printWindow.document.close();
}

// ==============================
// APPWRITE
// ==============================

const SNAPSHOT_KEY = 'biomed-stock-snapshot-v1';
let usingSnapshot = false;

function setDataState(cached, savedAt) {
  usingSnapshot = cached;
  document.body.classList.toggle('read-only-stock', cached || !navigator.onLine);
  const status = document.querySelector('#dataStatus');
  if (status) status.textContent = cached
    ? `Dernier stock connu du ${new Date(savedAt).toLocaleString('fr-FR')} · consultation uniquement`
    : 'Stock actualisé · mouvements disponibles en ligne';
}

async function listItems() {
  try {
    if (!navigator.onLine) throw new Error('Hors connexion');
    const items = [];
    let cursor;
    while (true) {
      const queries = [Query.orderAsc('$id'), Query.limit(100)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const response = await databases.listDocuments(DATABASE_ID, COLLECTIONS.items, queries);
      const page = response.documents || [];
      items.push(...page);
      if (page.length < 100) break;
      cursor = page[page.length - 1].$id;
    }
    items.sort((a, b) => String(a.itemCode || '').localeCompare(String(b.itemCode || ''), 'fr'));
    const savedAt = new Date().toISOString();
    // Offline consultation stores only article and quantity data, not supplier contacts or prices.
    const fields = ['$id', 'itemCode', 'itemName', 'stockQuantity', 'alertThreshold',
      'storageLocation', 'barcodeValue', 'internalCode', 'equipmentFamily', 'consumableType', 'category'];
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt,
        items: items.map(item => Object.fromEntries(fields.map(key => [key, item[key]]))) }));
    } catch (_) { /* Storage may be unavailable on this device. */ }
    setDataState(false);
    return items;
  } catch (error) {
    if (navigator.onLine) throw error;
    let snapshot;
    try { snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)); } catch (_) {}
    if (!snapshot || !Array.isArray(snapshot.items)) {
      throw new Error('Hors connexion : ouvrez le stock une première fois avec Internet sur cet appareil.');
    }
    setDataState(true, snapshot.savedAt);
    return snapshot.items;
  }
}

function requireOnline() {
  if (!navigator.onLine || usingSnapshot) throw new Error('Connexion et actualisation du stock nécessaires avant toute modification.');
}

async function findOrCreateSupplier({ supplier, contact, email, notes }) {
  const cleanSupplier = supplier.trim();
  const cleanEmail = email.trim();

  const existing = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.suppliers,
    [
      Query.equal('email', [cleanEmail]),
      Query.limit(1)
    ]
  );

  const found = existing.documents || [];

  if (found.length > 0) {
    const supplierDoc = found[0];

    return databases.updateDocument(
      DATABASE_ID,
      COLLECTIONS.suppliers,
      supplierDoc.$id,
      {
        nom: cleanSupplier,
        contact: contact.trim() || null,
        email: cleanEmail,
        notes: notes.trim() || null
      }
    );
  }

  return databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.suppliers,
    ID.unique(),
    {
      nom: cleanSupplier,
      contact: contact.trim() || null,
      email: cleanEmail,
      telephone: null,
      adresse: null,
      notes: notes.trim() || null
    }
  );
}

// ==============================
// ALERTE AUTOMATIQUE EMAIL
// ==============================

async function sendAutomaticStockAlert(item, movementType, oldQuantity, newQuantity) {
  const status = getStatus({
    ...item,
    stockQuantity: newQuantity
  });

  if (status.label !== 'Stock bas' && status.label !== 'Rupture') {
    return { state: 'skipped' };
  }

  const payload = {
    to: ALERT_EMAIL,
    status: status.label,
    movementType,
    item: {
      id: item.$id,
      itemCode: item.itemCode || '',
      itemName: item.itemName || '',
      equipmentFamily: item.equipmentFamily || '',
      consumableType: item.consumableType || '',
      category: item.category || '',
      storageLocation: item.storageLocation || '',
      supplierName: item.supplierName || '',
      supplierEmail: getSupplierEmail(item),
      stockQuantity: newQuantity,
      alertThreshold: safeNumber(item.alertThreshold),
      oldQuantity,
      newQuantity,
      barcodeValue: item.barcodeValue || '',
      internalCode: item.internalCode || ''
    }
  };

  try {
    const execution = await functions.createExecution(
      ALERT_FUNCTION_ID,
      JSON.stringify(payload),
      false,
      '/',
      'POST',
      {
        'content-type': 'application/json'
      }
    );

    return inspectAlertExecution(execution);
  } catch (error) {
    console.error('Erreur alerte Appwrite :', error);
    return { state: 'failed', message: describeAlertError(error.message), executionId: '' };
  }
}

// ==============================
// PAGE STOCK
// ==============================

function initStockPage() {
  const qrSearch = document.querySelector('#qrSearch');
  const currentCode = document.querySelector('#currentCode');
  const notification = document.querySelector('#stockNotification');
  const pendingQuantity = document.querySelector('#pendingQuantity');

  const startScannerBtn = document.querySelector('#startScannerBtn');
  const stopScannerBtn = document.querySelector('#stopScannerBtn');
  const qrReader = document.querySelector('#qrReader');

  const addStockBtn = document.querySelector('#addStockBtn');
  const removeStockBtn = document.querySelector('#removeStockBtn');
  const validateStockBtn = document.querySelector('#validateStockBtn');

  if (
    !qrSearch ||
    !currentCode ||
    !notification ||
    !pendingQuantity ||
    !addStockBtn ||
    !removeStockBtn ||
    !validateStockBtn
  ) {
    return;
  }

  let itemsCache = [];
  let selectedItem = null;
  let pendingDelta = 0;

  let qrScanner = null;
  let scannerRunning = false;
  let lastScannedValue = '';
  let movementBusy = false;
  let lastAlert = null;
  const retryAlertBtn = document.querySelector('#retryAlertBtn');
  const alertResult = document.querySelector('#alertResult');
  const matchChoices = document.querySelector('#matchChoices');

  function showNotification(message, type = '') {
    notification.textContent = message;
    notification.className = type ? `notification ${type}` : 'notification';
    notification.style.display = 'block';
  }

  function hideNotification() {
    notification.textContent = '';
    notification.className = 'notification';
    notification.style.display = 'none';
  }

  function updatePendingDisplay() {
    pendingQuantity.textContent = String(pendingDelta);
  }

  function resetPending() {
    pendingDelta = 0;
    updatePendingDisplay();
  }

  function showPendingMessage() {
    if (pendingDelta > 0) {
      showNotification(`Préparation : ajout de ${pendingDelta} article(s).`, 'success');
      return;
    }

    if (pendingDelta < 0) {
      showNotification(`Préparation : retrait de ${Math.abs(pendingDelta)} article(s).`, 'warning');
      return;
    }

    showNotification('Mouvement annulé. Quantité à valider : 0.', 'warning');
  }

  function clearSelectedItem() {
    selectedItem = null;
    currentCode.textContent = 'Aucun article';
    currentCode.classList.add('empty');
    resetPending();
    hideNotification();
  }

  function displaySelectedItem(item) {
    selectedItem = item;

    const status = getStatus(item);

    currentCode.classList.remove('empty');
    currentCode.innerHTML = `
      ${escapeHtml(item.itemCode || '')}<br>
      <span class="current-item-detail">
        ${escapeHtml(item.itemName || '')}<br>
        Stock : ${safeNumber(item.stockQuantity)} | Seuil : ${safeNumber(item.alertThreshold)} | ${escapeHtml(status.label)}
      </span>
    `;
  }

  async function loadItems() {
    try {
      itemsCache = await listItems();
    } catch (error) {
      console.error(error);
      showNotification(`Erreur Appwrite : ${error.message}`, 'error');
    }
  }

  async function handleCode(value, shouldStopCamera = false) {
    const cleanValue = String(value || '').trim();

    if (!cleanValue) return;

    if (shouldStopCamera) {
      await stopScanner(false);
    }

    if (movementBusy) return;
    const matches = findMatchingItems(itemsCache, cleanValue);
    matchChoices.replaceChildren();
    if (matches.length > 1) {
      clearSelectedItem();
      showNotification('Plusieurs articles portent cette référence. Choisissez le bon emplacement.', 'warning');
      for (const candidate of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'match-choice';
        button.textContent = `${candidate.itemName} · ${candidate.storageLocation || 'Emplacement non renseigné'} · Stock : ${safeNumber(candidate.stockQuantity)}`;
        button.addEventListener('click', () => {
          matchChoices.replaceChildren();
          resetPending();
          displaySelectedItem(candidate);
          showNotification('Article sélectionné. Choisissez + ou − puis validez.', 'success');
        });
        matchChoices.append(button);
      }
      return;
    }
    const item = matches[0];

    if (!item) {
      clearSelectedItem();
      showNotification('Aucun article trouvé avec ce code.', 'error');
      qrSearch.value = '';
      qrSearch.focus();
      return;
    }

    resetPending();
    displaySelectedItem(item);
    showNotification(`Article chargé : ${item.itemCode}. Choisissez + ou − puis validez.`, 'success');

    qrSearch.value = '';
    qrSearch.focus();
  }

  function addPendingStock() {
    if (movementBusy) return;
    if (!selectedItem) {
      showNotification('Scannez ou saisissez d’abord un code.', 'error');
      qrSearch.focus();
      return;
    }

    pendingDelta += 1;
    updatePendingDisplay();
    showPendingMessage();
  }

  function removePendingStock() {
    if (movementBusy) return;
    if (!selectedItem) {
      showNotification('Scannez ou saisissez d’abord un code.', 'error');
      qrSearch.focus();
      return;
    }

    const currentStock = safeNumber(selectedItem.stockQuantity);
    const futureStock = currentStock + pendingDelta - 1;

    if (futureStock < 0) {
      showNotification('Retrait impossible : stock insuffisant.', 'error');
      return;
    }

    pendingDelta -= 1;
    updatePendingDisplay();
    showPendingMessage();
  }

  function showAlertResult(result) {
    alertResult.hidden = result.state === 'skipped';
    alertResult.className = `notification ${result.state === 'accepted' ? 'success' : 'warning'}`;
    alertResult.textContent = result.state === 'accepted'
      ? `Alerte acceptée par le service d’envoi pour ${ALERT_EMAIL}. Réception en boîte mail non confirmée.`
      : `Alerte non confirmée : ${result.message || 'réponse inconnue'}`;
    if (result.executionId) alertResult.textContent += ` Référence de diagnostic : ${result.executionId}.`;
    retryAlertBtn.hidden = !['failed', 'unconfirmed'].includes(result.state);
  }

  async function validateStockMovement() {
    if (movementBusy) return;
    if (!selectedItem) {
      showNotification('Scannez ou saisissez d’abord une référence.', 'error');
      return;
    }
    if (pendingDelta === 0) {
      showNotification('Choisissez une quantité avec + ou −.', 'warning');
      return;
    }
    const itemId = selectedItem.$id;
    const delta = pendingDelta;
    let stockSaved = false;
    try {
      requireOnline();
      movementBusy = true;
      [validateStockBtn, addStockBtn, removeStockBtn, qrSearch, startScannerBtn].forEach(el => el.disabled = true);
      validateStockBtn.textContent = 'Validation…';
      // Read the latest quantity before writing; true cross-device transactions require a server function.
      const freshItem = await databases.getDocument(DATABASE_ID, COLLECTIONS.items, itemId);
      const oldQuantity = safeNumber(freshItem.stockQuantity);
      if (oldQuantity !== safeNumber(selectedItem.stockQuantity)) {
        displaySelectedItem(freshItem);
        itemsCache = itemsCache.map(item => item.$id === itemId ? freshItem : item);
        showNotification('Le stock a changé sur un autre poste. Vérifiez la quantité puis validez à nouveau.', 'warning');
        return;
      }
      const newQuantity = oldQuantity + delta;
      if (newQuantity < 0) throw new Error('Stock insuffisant pour ce retrait.');
      const movementType = delta > 0 ? 'ENTREE' : 'SORTIE';
      const updated = await databases.updateDocument(DATABASE_ID, COLLECTIONS.items, itemId, { stockQuantity: newQuantity });
      stockSaved = true;
      selectedItem = updated;
      itemsCache = itemsCache.map(item => item.$id === itemId ? updated : item);
      resetPending();
      displaySelectedItem(updated);
      let historyWarning = '';
      try {
        await databases.createDocument(DATABASE_ID, COLLECTIONS.movements, ID.unique(), {
          itemId, itemCode: freshItem.itemCode, itemName: freshItem.itemName, movementType,
          quantity: Math.abs(delta), oldQuantity, newQuantity, date: new Date().toISOString(),
          comment: '', user: 'Utilisateur web'
        });
      } catch (_) {
        historyWarning = ' Attention : historique non enregistré. Ne répétez pas le mouvement.';
      }
      showNotification(`Mouvement enregistré : ${delta > 0 ? '+' : ''}${delta}. Stock : ${newQuantity}.${historyWarning}`, historyWarning ? 'warning' : 'success');
      lastAlert = { item: freshItem, movementType, oldQuantity, newQuantity };
      alertResult.hidden = false;
      alertResult.textContent = 'Vérification de l’alerte…';
      const result = await sendAutomaticStockAlert(freshItem, movementType, oldQuantity, newQuantity);
      showAlertResult(result);
      // Refresh the offline snapshot after successful writes.
      try { itemsCache = await listItems(); } catch (_) {}
    } catch (error) {
      showNotification(stockSaved
        ? `Stock enregistré. ${error.message} Ne répétez pas le mouvement.`
        : `Mouvement non confirmé : ${error.message} En cas de coupure réseau, actualisez le stock avant de recommencer.`, 'error');
    } finally {
      movementBusy = false;
      [validateStockBtn, addStockBtn, removeStockBtn, qrSearch, startScannerBtn].forEach(el => el.disabled = false);
      validateStockBtn.textContent = 'Valider le mouvement';
    }
  }

  retryAlertBtn.addEventListener('click', async () => {
    if (!lastAlert || retryAlertBtn.disabled) return;
    try {
      requireOnline();
      if (!confirm('Relancer uniquement l’alerte email ? Si un premier envoi a été accepté sans confirmation, un doublon est possible.')) return;
      retryAlertBtn.disabled = true;
      const { item, movementType, oldQuantity, newQuantity } = lastAlert;
      showAlertResult(await sendAutomaticStockAlert(item, movementType, oldQuantity, newQuantity));
    } catch (error) { showNotification(error.message, 'error'); }
    finally { retryAlertBtn.disabled = false; }
  });

  async function getBestCameraId() {
    const cameras = await window.Html5Qrcode.getCameras();

    if (!cameras || cameras.length === 0) {
      return null;
    }

    const backCamera = cameras.find(camera => {
      const label = String(camera.label || '').toLowerCase();

      return (
        label.includes('back') ||
        label.includes('rear') ||
        label.includes('environment') ||
        label.includes('arrière') ||
        label.includes('arriere')
      );
    });

    if (backCamera) return backCamera.id;
    if (cameras.length > 1) return cameras[cameras.length - 1].id;

    return cameras[0].id;
  }

  async function startScanner() {
    if (!qrReader || !window.Html5Qrcode) {
      showNotification('Le scanner QR code n’est pas disponible.', 'error');
      return;
    }

    if (scannerRunning || movementBusy) return;
    lastScannedValue = '';

    try {
      qrReader.classList.add('active');

      qrScanner = new window.Html5Qrcode('qrReader');

      const cameraId = { facingMode: 'environment' };

      await qrScanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: {
            width: 240,
            height: 240
          }
        },
        async decodedText => {
          const cleanDecoded = String(decodedText || '').trim();

          if (!cleanDecoded || cleanDecoded === lastScannedValue) return;

          lastScannedValue = cleanDecoded;

          if (navigator.vibrate) {
            navigator.vibrate(120);
          }

          await handleCode(cleanDecoded, true);
        }
      );

      scannerRunning = true;

      if (startScannerBtn) startScannerBtn.style.display = 'none';
      if (stopScannerBtn) stopScannerBtn.style.display = 'block';

    } catch (error) {
      console.error(error);
      qrReader.classList.remove('active');
      showNotification('Caméra indisponible ou accès refusé. Saisissez la référence ci-dessus puis appuyez sur Scanner.', 'warning');
      scannerRunning = false;
      lastScannedValue = '';
      qrSearch.focus();
    }
  }

  async function stopScanner(showMessage = true) {
    if (!qrScanner || !scannerRunning) {
      qrReader?.classList.remove('active');

      if (startScannerBtn) startScannerBtn.style.display = 'block';
      if (stopScannerBtn) stopScannerBtn.style.display = 'none';

      return;
    }

    try {
      await qrScanner.stop();
      await qrScanner.clear();

      scannerRunning = false;
      qrScanner = null;
      lastScannedValue = '';

      qrReader.classList.remove('active');

      if (startScannerBtn) startScannerBtn.style.display = 'block';
      if (stopScannerBtn) stopScannerBtn.style.display = 'none';

      if (showMessage) {
        showNotification('Caméra fermée.', 'success');
      }

    } catch (error) {
      console.error(error);
      showNotification(`Erreur fermeture caméra : ${error.message || error}`, 'error');
    }
  }

  qrSearch.addEventListener('input', () => {
    if (movementBusy) return;
    matchChoices.replaceChildren();
    clearSelectedItem();
  });

  qrSearch.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    handleCode(qrSearch.value, false);
  });

  document.querySelector('#refreshStockBtn').addEventListener('click', async () => {
    if (movementBusy) return;
    clearSelectedItem();
    matchChoices.replaceChildren();
    await loadItems();
  });
  startScannerBtn?.addEventListener('click', () => {
    if (qrSearch.value.trim()) return handleCode(qrSearch.value, scannerRunning);
    return startScanner();
  });
  stopScannerBtn?.addEventListener('click', () => stopScanner(true));

  addStockBtn.addEventListener('click', addPendingStock);
  removeStockBtn.addEventListener('click', removePendingStock);
  validateStockBtn.addEventListener('click', validateStockMovement);

  if (stopScannerBtn) {
    stopScannerBtn.style.display = 'none';
  }

  updatePendingDisplay();

  loadItems();
}

// ==============================
// PAGE GESTION DU STOCK
// ==============================

function initGestionPage() {
  const form = document.querySelector('#itemForm');
  const stockGestionTable = document.querySelector('#stockGestionTable');

  const message = document.querySelector('#formMessage');
  const resetBtn = document.querySelector('#resetBtn');

  const searchInput = document.querySelector('#searchInput');
  const supplierSearchInput = document.querySelector('#supplierSearchInput');
  const familyFilter = document.querySelector('#familyFilter');
  const typeFilter = document.querySelector('#typeFilter');

  const supplierOptions = document.querySelector('#supplierOptions');
  const familyOptions = document.querySelector('#familyOptions');
  const typeOptions = document.querySelector('#typeOptions');

  const formSupplierOptions = document.querySelector('#formSupplierOptions');
  const formFamilyOptions = document.querySelector('#formFamilyOptions');
  const formTypeOptions = document.querySelector('#formTypeOptions');

  const showStockBtn = document.querySelector('#showStockBtn');
  const sendStockAlertBtn = document.querySelector('#sendStockAlertBtn');

  const openVisualSearchBtn = document.querySelector('#openVisualSearchBtn');
  const locationModal = document.querySelector('#locationModal');
  const closeLocationModal = document.querySelector('#closeLocationModal');
  const visualSearchInput = document.querySelector('#visualSearchInput');
  const visualSearchBtn = document.querySelector('#visualSearchBtn');
  const visualSearchOptions = document.querySelector('#visualSearchOptions');

  const locationSubtitle = document.querySelector('#locationSubtitle');
  const locationRef = document.querySelector('#locationRef');
  const locationName = document.querySelector('#locationName');
  const locationPlace = document.querySelector('#locationPlace');
  const locationSupplier = document.querySelector('#locationSupplier');
  const rackTitle = document.querySelector('#rackTitle');
  const rackHint = document.querySelector('#rackHint');

  const stockListContainer = document.querySelector('#stockListContainer');

  if (!form) return;

  let itemsCache = [];
  const editDialog = document.querySelector('#editDialog');
  const statusFilter = document.querySelector('#statusFilter');
  const managementMessage = document.querySelector('#managementMessage');

  function fillDatalist(element, values) {
    if (!element) return;

    const uniqueValues = [...new Set(
      values
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'fr'));

    element.innerHTML = uniqueValues
      .map(value => `<option value="${escapeHtml(value)}"></option>`)
      .join('');
  }

  function updateFilterOptions() {
    const suppliers = itemsCache.flatMap(item => [
      item.supplierName,
      getSupplierEmail(item)
    ]);

    const families = itemsCache.map(item => item.equipmentFamily);
    const types = itemsCache.map(item => item.consumableType);

    const visualValues = itemsCache.flatMap(item => [
      item.itemCode,
      item.itemName,
      `${item.itemCode || ''} - ${item.itemName || ''}`
    ]);

    fillDatalist(supplierOptions, suppliers);
    fillDatalist(formSupplierOptions, suppliers);

    fillDatalist(familyOptions, families);
    fillDatalist(formFamilyOptions, families);

    fillDatalist(typeOptions, types);
    fillDatalist(formTypeOptions, types);

    fillDatalist(visualSearchOptions, visualValues);
  }

  function parseStorageLocation(location) {
    const raw = String(location || '').trim();
    const text = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const rayonMatch =
      text.match(/rayon\s*([0-9]+)/i) ||
      text.match(/\br\s*([0-9]+)/i);

    const shelfMatch =
      text.match(/etagere\s*([0-9]+)/i) ||
      text.match(/etage\s*([0-9]+)/i) ||
      text.match(/\be\s*([0-9]+)/i);

    return {
      raw,
      rayon: rayonMatch ? rayonMatch[1] : '?',
      shelf: shelfMatch ? shelfMatch[1] : null
    };
  }

  function clearLocationView() {
    document.querySelectorAll('.rack-shelf').forEach(shelf => {
      shelf.classList.remove('active');
    });

    if (locationSubtitle) {
      locationSubtitle.textContent = 'Sélectionnez une référence ou utilisez le bouton Localiser.';
    }

    if (locationRef) locationRef.textContent = '-';
    if (locationName) locationName.textContent = '-';
    if (locationPlace) locationPlace.textContent = '-';
    if (locationSupplier) locationSupplier.textContent = '-';
    if (rackTitle) rackTitle.textContent = 'Rayon';
    if (rackHint) rackHint.textContent = 'Étagère à repérer';
  }

  function openLocationModal(item = null) {
    if (!locationModal) return;

    locationModal.classList.remove('hidden');
    locationModal.setAttribute('aria-hidden', 'false');

    if (!item) {
      clearLocationView();
      setTimeout(() => visualSearchInput?.focus(), 50);
      return;
    }

    renderLocation(item);
  }

  function closeLocationView() {
    if (!locationModal) return;

    locationModal.classList.add('hidden');
    locationModal.setAttribute('aria-hidden', 'true');
  }

  function findItemForVisualSearch(value) {
    const search = String(value || '').trim().toLowerCase();

    if (!search) return null;

    return itemsCache.find(item =>
      String(item.itemCode || '').toLowerCase() === search ||
      String(item.itemName || '').toLowerCase() === search ||
      `${String(item.itemCode || '').toLowerCase()} - ${String(item.itemName || '').toLowerCase()}` === search ||
      String(item.itemCode || '').toLowerCase().includes(search) ||
      String(item.itemName || '').toLowerCase().includes(search)
    );
  }

  function renderLocation(item) {
    if (!item) return;

    const parsed = parseStorageLocation(item.storageLocation);

    document.querySelectorAll('.rack-shelf').forEach(shelf => {
      shelf.classList.remove('active');
    });

    if (locationSubtitle) {
      locationSubtitle.textContent = `${item.itemCode || '-'} — ${item.itemName || '-'}`;
    }

    if (locationRef) locationRef.textContent = item.itemCode || '-';
    if (locationName) locationName.textContent = item.itemName || '-';
    if (locationPlace) locationPlace.textContent = item.storageLocation || '-';
    if (locationSupplier) locationSupplier.textContent = item.supplierName || '-';

    if (rackTitle) {
      rackTitle.textContent = parsed.rayon !== '?'
        ? `Rayon ${parsed.rayon}`
        : 'Rayon non identifié';
    }

    if (rackHint) {
      rackHint.textContent = parsed.shelf
        ? `Étagère ${parsed.shelf}`
        : 'Étagère non identifiée';
    }

    if (parsed.shelf) {
      const activeShelf = document.querySelector(`.rack-shelf[data-shelf="${parsed.shelf}"]`);

      if (activeShelf) {
        activeShelf.classList.add('active');
      }
    }

    if (visualSearchInput) {
      visualSearchInput.value = item.itemCode || '';
    }
  }

  function handleVisualSearch() {
    const item = findItemForVisualSearch(visualSearchInput?.value);

    if (!item) {
      alert('Aucun consommable trouvé pour cette recherche visuelle.');
      return;
    }

    renderLocation(item);
  }

  function clearForm() {
    form.reset();

    document.querySelector('#itemId').value = '';
    document.querySelector('#itemInternalCode').value = '';
    document.querySelector('#itemQrValue').value = '';
    document.querySelector('#formTitle').textContent = 'Ajouter un consommable';

    message.textContent = '';
    message.className = 'message';
  }

  function fillForm(item) {
    document.querySelector('#formTitle').textContent = 'Modifier un consommable';

    document.querySelector('#itemId').value = item.$id;
    document.querySelector('#itemInternalCode').value = item.internalCode || '';
    document.querySelector('#itemQrValue').value = item.barcodeValue || '';

    document.querySelector('#reference').value = item.itemCode || '';
    document.querySelector('#designation').value = item.itemName || '';
    document.querySelector('#equipmentFamily').value = item.equipmentFamily || DEFAULT_EQUIPMENT_FAMILY;
    document.querySelector('#consumableType').value = item.consumableType || DEFAULT_CONSUMABLE_TYPE;
    document.querySelector('#category').value = item.category || DEFAULT_CATEGORY;
    document.querySelector('#price').value = item.unitPrice || 0;
    document.querySelector('#alertThreshold').value = safeNumber(item.alertThreshold);
    document.querySelector('#storageLocation').value = item.storageLocation || '';
    document.querySelector('#supplier').value = item.supplierName || '';
    document.querySelector('#contact').value = '';
    document.querySelector('#email').value = getSupplierEmail(item);
    document.querySelector('#notes').value = '';

    if (editDialog && !editDialog.open) editDialog.showModal();
    document.querySelector('#reference').focus();
  }

  async function loadItems() {
    itemsCache = await listItems();
    updateFilterOptions();
  }

  function getFilteredItems() {
    const term = String(searchInput?.value || '').toLowerCase();
    const supplierTerm = String(supplierSearchInput?.value || '').toLowerCase();
    const familyValue = String(familyFilter?.value || '').toLowerCase();
    const typeValue = String(typeFilter?.value || '').toLowerCase();

    return itemsCache.filter(item => {
      const matchesSearch =
        String(item.itemCode || '').toLowerCase().includes(term) ||
        String(item.itemName || '').toLowerCase().includes(term) ||
        String(item.equipmentFamily || '').toLowerCase().includes(term) ||
        String(item.consumableType || '').toLowerCase().includes(term) ||
        String(item.category || '').toLowerCase().includes(term) ||
        String(item.storageLocation || '').toLowerCase().includes(term) ||
        String(item.supplierName || '').toLowerCase().includes(term) ||
        String(getSupplierEmail(item) || '').toLowerCase().includes(term) ||
        String(item.barcodeValue || '').toLowerCase().includes(term);

      const matchesSupplier =
        !supplierTerm ||
        String(item.supplierName || '').toLowerCase().includes(supplierTerm) ||
        String(getSupplierEmail(item) || '').toLowerCase().includes(supplierTerm);

      const matchesFamily =
        !familyValue ||
        String(item.equipmentFamily || '').toLowerCase().includes(familyValue);

      const matchesType =
        !typeValue ||
        String(item.consumableType || '').toLowerCase().includes(typeValue);

      const matchesStatus = !statusFilter?.value || getStatus(item).label === statusFilter.value;
      return matchesSearch && matchesSupplier && matchesFamily && matchesType && matchesStatus;
    });
  }

  function renderStockTable() {
    if (!stockGestionTable) return;
    const sortedItems = getFilteredItems().sort((a, b) =>
      statusRank(getStatus(a).label) - statusRank(getStatus(b).label) ||
      safeNumber(a.stockQuantity) - safeNumber(b.stockQuantity));
    const ruptureCount = itemsCache.filter(item => getStatus(item).label === 'Rupture').length;
    const lowCount = itemsCache.filter(item => getStatus(item).label === 'Stock bas').length;
    document.querySelector('#stockSummary').textContent = `${sortedItems.length} / ${itemsCache.length} articles · ${ruptureCount} en rupture · ${lowCount} en stock bas`;
    if (!sortedItems.length) {
      stockGestionTable.innerHTML = '<tr><td colspan="8" class="empty-stock">Aucun article ne correspond aux filtres.</td></tr>';
      return;
    }
    stockGestionTable.innerHTML = sortedItems.map(item => {
      const status = getStatus(item);
      const id = escapeHtml(item.$id);
      return `<tr>
        <td data-label="Article" class="article-cell"><strong>${escapeHtml(item.itemCode || '')}</strong>
          <span>${escapeHtml(item.itemName || '')}</span>
          <small>${escapeHtml([item.equipmentFamily, item.consumableType, item.category].filter(Boolean).join(' · '))}</small></td>
        <td data-label="Stock"><strong>${safeNumber(item.stockQuantity)}</strong></td>
        <td data-label="État"><span class="status ${status.className}">${status.label}</span></td>
        <td data-label="Seuil">${safeNumber(item.alertThreshold)}</td>
        <td data-label="Emplacement">${escapeHtml(item.storageLocation || '—')}</td>
        <td data-label="Fournisseur" class="supplier-cell">${escapeHtml(item.supplierName || '—')}<small>${escapeHtml(getSupplierEmail(item))}</small></td>
        <td data-label="Prix HT">${usingSnapshot ? '—' : euro(item.unitPrice)}</td>
        <td data-label="Actions" class="stock-actions-cell"><div class="row-actions">
          <button class="btn locate" type="button" data-locate="${id}">Localiser</button>
          <button class="btn secondary" type="button" data-edit="${id}">Modifier</button>
          <button class="btn warning" type="button" data-print="${id}">Imprimer QR</button>
          <button class="btn danger" type="button" data-delete="${id}">Supprimer</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  async function showStockView() {
    if (!showStockBtn || showStockBtn.disabled) return;
    showStockBtn.disabled = true;
    try {
      await loadItems();
      renderStockTable();
      managementMessage.textContent = '';
    } catch (error) {
      managementMessage.textContent = `Chargement impossible : ${error.message}`;
      managementMessage.className = 'message error';
    } finally { showStockBtn.disabled = false; }
  }

  function refreshActiveView() {
    renderStockTable();
  }

  const emailStatus = document.querySelector('#emailStatus');
  function showEmailStatus(text, type = '') {
    emailStatus.textContent = text;
    emailStatus.className = `message ${type}`;
  }

  async function sendManualStockAlerts() {
    if (sendStockAlertBtn.disabled) return;
    sendStockAlertBtn.disabled = true;
    try {
      requireOnline();
      await loadItems();
      const alertItems = itemsCache.filter(item => getStatus(item).label !== 'OK');
      if (!alertItems.length) { showEmailStatus('Aucun article en alerte.'); return; }
      if (!confirm(`Envoyer ${alertItems.length} alerte(s) à ${ALERT_EMAIL} ?`)) return;
      let accepted = 0;
      const failures = [];
      for (const item of alertItems) {
        showEmailStatus(`Envoi ${accepted + failures.length + 1}/${alertItems.length}…`);
        const qty = safeNumber(item.stockQuantity);
        const result = await sendAutomaticStockAlert(item, 'ALERTE_MANUELLE', qty, qty);
        if (result.state === 'accepted') accepted++;
        else {
          failures.push(`${item.itemCode} : ${result.message} ${result.executionId ? `(diagnostic ${result.executionId})` : ''}`);
          // A configuration error affects all articles: avoid a cascade of failed emails.
          break;
        }
      }
      showEmailStatus(`${accepted} alerte(s) acceptée(s) par le service d’envoi sur ${alertItems.length}. ${failures.join(' ')}${failures.length ? ' Envoi interrompu ; les articles restants n’ont pas été envoyés.' : ' Réception en boîte mail non confirmée.'}`, failures.length ? 'error' : 'success');
    } catch (error) { showEmailStatus(error.message, 'error'); }
    finally { sendStockAlertBtn.disabled = false; }
  }

  document.querySelector('#testEmailBtn')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    try {
      requireOnline();
      button.disabled = true;
      showEmailStatus('Test d’envoi en cours…');
      const result = await sendAutomaticStockAlert({
        itemCode: 'TEST-EMAIL', itemName: 'TEST TECHNIQUE — aucun réapprovisionnement nécessaire',
        alertThreshold: 1, storageLocation: 'Test sans mouvement de stock'
      }, 'TEST_EMAIL', 0, 0);
      showEmailStatus(result.state === 'accepted'
        ? `Test accepté par le service d’envoi pour ${ALERT_EMAIL}. Vérifiez la boîte de réception et les indésirables.`
        : `Test non confirmé : ${result.message}${result.executionId ? ` (diagnostic ${result.executionId})` : ''}`, result.state === 'accepted' ? 'success' : 'error');
    } catch (error) { showEmailStatus(error.message, 'error'); }
    finally { button.disabled = false; }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    try { requireOnline(); } catch (error) { message.textContent = error.message; return; }

    message.textContent = '';
    message.className = 'message';

    const documentId = document.querySelector('#itemId').value;

    const itemCode = document.querySelector('#reference').value.trim();
    const itemName = document.querySelector('#designation').value.trim();
    const equipmentFamily = document.querySelector('#equipmentFamily').value.trim();
    const consumableType = document.querySelector('#consumableType').value.trim();
    const category = document.querySelector('#category').value || DEFAULT_CATEGORY;
    const unitPrice = safeNumber(document.querySelector('#price').value);
    const alertThreshold = safeNumber(document.querySelector('#alertThreshold').value);
    const storageLocation = document.querySelector('#storageLocation').value.trim();

    const supplierName = document.querySelector('#supplier').value.trim();
    const contact = document.querySelector('#contact').value.trim();
    const email = document.querySelector('#email').value.trim();
    const notes = document.querySelector('#notes').value.trim();

    let internalCode = document.querySelector('#itemInternalCode').value.trim();

    if (!itemCode || !itemName || !supplierName || !email || !storageLocation) {
      message.textContent = 'Veuillez remplir référence, désignation, fournisseur, email et emplacement.';
      message.classList.add('error');
      return;
    }

    if (!internalCode) {
      internalCode = generateInternalCode(itemCode, equipmentFamily, consumableType);
    }

    const qrValue = document.querySelector('#itemQrValue').value.trim() || internalCode;

    try {
      const supplierDoc = await findOrCreateSupplier({
        supplier: supplierName,
        contact,
        email,
        notes
      });

      const isNewItem = !documentId;

      const data = {
        itemName,
        itemCode,
        equipmentFamily,
        consumableType,
        category,
        unitPrice,
        alertThreshold,
        expirationDate: null,
        supplierId: supplierDoc.$id,
        supplierName,
        Email: email,
        internalCode,
        barcodeValue: qrValue,
        storageLocation
      };

      if (isNewItem) {
        data.stockQuantity = 0;
      }

      if (documentId) {
        await databases.updateDocument(
          DATABASE_ID,
          COLLECTIONS.items,
          documentId,
          data
        );
      } else {
        await databases.createDocument(
          DATABASE_ID,
          COLLECTIONS.items,
          ID.unique(),
          data
        );
      }

      clearForm();
      if (editDialog) editDialog.close();
      const resultMessage = managementMessage || message;
      resultMessage.textContent = 'Consommable enregistré avec succès. QR code individuel disponible.';
      resultMessage.className = 'message success';
      try { await loadItems(); refreshActiveView(); }
      catch (error) { resultMessage.textContent += ' Actualisez la page pour recharger la liste.'; }

    } catch (error) {
      console.error(error);
      message.textContent = `Erreur Appwrite : ${error.message}`;
      message.classList.add('error');
    }
  });

  stockGestionTable?.addEventListener('click', async event => {
    const locateId = event.target.dataset.locate;
    const editId = event.target.dataset.edit;
    const printId = event.target.dataset.print;
    const deleteId = event.target.dataset.delete;

    if (locateId) {
      const item = itemsCache.find(doc => doc.$id === locateId);
      if (item) openLocationModal(item);
    }

    if (editId) {
      const item = itemsCache.find(doc => doc.$id === editId);
      try { requireOnline(); if (item) fillForm(item); }
      catch (error) { managementMessage.textContent = error.message; }
    }

    if (printId) {
      const item = itemsCache.find(doc => doc.$id === printId);
      if (item) printQrCode(item);
    }

    if (deleteId) {
      const confirmed = confirm('Supprimer ce consommable ?');

      if (!confirmed) return;

      try {
        requireOnline();
        await databases.deleteDocument(
          DATABASE_ID,
          COLLECTIONS.items,
          deleteId
        );

        await loadItems();
        refreshActiveView();

      } catch (error) {
        alert(`Erreur Appwrite : ${error.message}`);
      }
    }
  });

  resetBtn?.addEventListener('click', () => {
    const id = document.querySelector('#itemId').value;
    const item = itemsCache.find(item => item.$id === id);
    if (item && editDialog) fillForm(item); else clearForm();
  });
  document.querySelector('#closeEditBtn')?.addEventListener('click', () => editDialog.close());
  statusFilter?.addEventListener('change', refreshActiveView);
  document.querySelector('#resetFiltersBtn')?.addEventListener('click', () => {
    [searchInput, supplierSearchInput, familyFilter, typeFilter, statusFilter].forEach(el => { if (el) el.value = ''; });
    refreshActiveView();
  });

  searchInput?.addEventListener('input', refreshActiveView);
  supplierSearchInput?.addEventListener('input', refreshActiveView);
  familyFilter?.addEventListener('input', refreshActiveView);
  typeFilter?.addEventListener('input', refreshActiveView);

  showStockBtn?.addEventListener('click', showStockView);
  sendStockAlertBtn?.addEventListener('click', sendManualStockAlerts);

  openVisualSearchBtn?.addEventListener('click', () => {
    openLocationModal();
  });

  closeLocationModal?.addEventListener('click', closeLocationView);

  locationModal?.addEventListener('click', event => {
    if (event.target === locationModal) {
      closeLocationView();
    }
  });

  visualSearchBtn?.addEventListener('click', handleVisualSearch);

  visualSearchInput?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    handleVisualSearch();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeLocationView();
    }
  });

  loadItems().then(refreshActiveView).catch(error => {
    const target = managementMessage || message;
    target.textContent = `Chargement impossible : ${error.message}`;
    target.className = 'message error';
  });
}

// ==============================
// DÉMARRAGE
// ==============================

initStockPage();
initGestionPage();
