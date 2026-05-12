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
const ALERT_EMAIL = 'alpha.balde@ramsaysante.fr';

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
  const qrValue = item.barcodeValue || '';
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

async function listItems() {
  const response = await databases.listDocuments(
    DATABASE_ID,
    COLLECTIONS.items,
    [
      Query.orderAsc('itemCode'),
      Query.limit(100)
    ]
  );

  return response.documents || [];
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
    return false;
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

    if (execution.status && execution.status !== 'completed') {
      alert(`Alerte non envoyée : exécution ${execution.status}.`);
      return false;
    }

    return true;

  } catch (error) {
    console.error('Erreur création exécution alerte Appwrite :', error);
    alert(`Erreur alerte email : ${error.message || 'Impossible de lancer la Function Appwrite.'}`);
    return false;
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

  function findItemByCode(value) {
    const search = String(value || '').trim().toLowerCase();

    if (!search) return null;

    return itemsCache.find(item =>
      String(item.barcodeValue || '').toLowerCase() === search ||
      String(item.internalCode || '').toLowerCase() === search ||
      String(item.itemCode || '').toLowerCase() === search
    );
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

    const item = findItemByCode(cleanValue);

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

  async function validateStockMovement() {
    if (!selectedItem) {
      showNotification('Scannez ou saisissez d’abord un code.', 'error');
      qrSearch.focus();
      return;
    }

    if (pendingDelta === 0) {
      showNotification('Aucun mouvement à valider. Utilisez + ou −.', 'warning');
      return;
    }

    const oldQuantity = safeNumber(selectedItem.stockQuantity);
    const newQuantity = oldQuantity + pendingDelta;

    if (newQuantity < 0) {
      showNotification('Validation impossible : stock négatif.', 'error');
      return;
    }

    const movementType = pendingDelta > 0 ? 'ENTREE' : 'SORTIE';
    const movementQty = Math.abs(pendingDelta);

    try {
      validateStockBtn.disabled = true;
      validateStockBtn.textContent = 'Validation...';

      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.items,
        selectedItem.$id,
        {
          stockQuantity: newQuantity
        }
      );

      await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.movements,
        ID.unique(),
        {
          itemId: selectedItem.$id,
          itemCode: selectedItem.itemCode,
          itemName: selectedItem.itemName,
          movementType,
          quantity: movementQty,
          oldQuantity,
          newQuantity,
          date: new Date().toISOString(),
          comment: '',
          user: 'Utilisateur web'
        }
      );

      const alertSent = await sendAutomaticStockAlert(
        selectedItem,
        movementType,
        oldQuantity,
        newQuantity
      );

      selectedItem = {
        ...selectedItem,
        stockQuantity: newQuantity
      };

      itemsCache = itemsCache.map(item =>
        item.$id === selectedItem.$id ? selectedItem : item
      );

      displaySelectedItem(selectedItem);

      const resultText = movementType === 'ENTREE'
        ? `Ajout validé : +${movementQty}. Nouveau stock : ${newQuantity}.`
        : `Retrait validé : −${movementQty}. Nouveau stock : ${newQuantity}.`;

      const status = getStatus(selectedItem);

      const alertText = alertSent
        ? ` Alerte email envoyée (${status.label}).`
        : '';

      resetPending();
      showNotification(resultText + alertText, 'success');

      qrSearch.focus();

    } catch (error) {
      console.error(error);
      showNotification(`Erreur Appwrite : ${error.message}`, 'error');

    } finally {
      validateStockBtn.disabled = false;
      validateStockBtn.textContent = 'Valider le mouvement';
    }
  }

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

    if (scannerRunning) return;

    try {
      qrReader.classList.add('active');

      qrScanner = new window.Html5Qrcode('qrReader');

      const cameraId = await getBestCameraId();

      if (!cameraId) {
        qrReader.classList.remove('active');
        showNotification('Aucune caméra détectée. Saisissez le code manuellement.', 'error');
        return;
      }

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
      showNotification(`Erreur caméra : ${error.message || error}`, 'error');
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
    clearSelectedItem();
  });

  qrSearch.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    handleCode(qrSearch.value, false);
  });

  startScannerBtn?.addEventListener('click', startScanner);
  stopScannerBtn?.addEventListener('click', () => stopScanner(true));

  addStockBtn.addEventListener('click', addPendingStock);
  removeStockBtn.addEventListener('click', removePendingStock);
  validateStockBtn.addEventListener('click', validateStockMovement);

  if (stopScannerBtn) {
    stopScannerBtn.style.display = 'none';
  }

  updatePendingDisplay();

  loadItems().then(() => {
    qrSearch.focus();
  });
}

// ==============================
// PAGE GESTION DU STOCK
// ==============================

function initGestionPage() {
  const form = document.querySelector('#itemForm');
  const table = document.querySelector('#itemsTable');
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

  const showItemsBtn = document.querySelector('#showItemsBtn');
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

  const itemsListContainer = document.querySelector('#itemsListContainer');
  const stockListContainer = document.querySelector('#stockListContainer');

  if (!form) return;

  let itemsCache = [];
  let activeView = '';

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

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
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

      return matchesSearch && matchesSupplier && matchesFamily && matchesType;
    });
  }

  function renderItemsTable() {
    if (!table) return;

    const filtered = getFilteredItems();

    if (!filtered.length) {
      table.innerHTML = '<tr><td colspan="12">Aucun consommable trouvé.</td></tr>';
      return;
    }

    table.innerHTML = filtered.map(item => `
      <tr>
        <td>${escapeHtml(item.itemCode || '')}</td>
        <td>${escapeHtml(item.itemName || '')}</td>
        <td>${escapeHtml(item.equipmentFamily || '')}</td>
        <td>${escapeHtml(item.consumableType || '')}</td>
        <td>${escapeHtml(item.category || '')}</td>
        <td>${escapeHtml(item.storageLocation || '')}</td>
        <td>${safeNumber(item.alertThreshold)}</td>
        <td>${escapeHtml(item.supplierName || '')}</td>
        <td>${escapeHtml(getSupplierEmail(item))}</td>
        <td>${euro(item.unitPrice)}</td>
        <td>
          ${
            item.barcodeValue
              ? `<div class="qr-cell" data-qr-value="${escapeHtml(item.barcodeValue)}"></div>`
              : '<span>À générer</span>'
          }
        </td>
        <td class="row-actions">
          <button class="btn locate" type="button" data-locate="${item.$id}">Localiser</button>
          <button class="btn secondary" type="button" data-edit="${item.$id}">Modifier</button>
          <button class="btn warning" type="button" data-print="${item.$id}">Imprimer QR</button>
          <button class="btn danger" type="button" data-delete="${item.$id}">Supprimer</button>
        </td>
      </tr>
    `).join('');

    renderAllQrCodes();
  }

  function renderStockTable() {
    if (!stockGestionTable) return;

    const filtered = getFilteredItems();

    const sortedItems = [...filtered].sort((a, b) => {
      const statusPriority = statusRank(getStatus(a).label) - statusRank(getStatus(b).label);

      if (statusPriority !== 0) return statusPriority;

      return safeNumber(a.stockQuantity) - safeNumber(b.stockQuantity);
    });

    if (!sortedItems.length) {
      stockGestionTable.innerHTML = '<tr><td colspan="11">Aucun stock trouvé.</td></tr>';
      return;
    }

    stockGestionTable.innerHTML = sortedItems.map(item => {
      const status = getStatus(item);

      return `
        <tr>
          <td><strong>${safeNumber(item.stockQuantity)}</strong></td>
          <td><span class="status ${status.className}">${status.label}</span></td>
          <td>${escapeHtml(item.itemCode || '')}</td>
          <td>${escapeHtml(item.itemName || '')}</td>
          <td>${escapeHtml(item.equipmentFamily || '')}</td>
          <td>${escapeHtml(item.consumableType || '')}</td>
          <td>${safeNumber(item.alertThreshold)}</td>
          <td>${escapeHtml(item.storageLocation || '')}</td>
          <td>${escapeHtml(item.supplierName || '')}</td>
          <td>${escapeHtml(getSupplierEmail(item))}</td>
          <td>
            <button class="btn locate" type="button" data-locate="${item.$id}">Localiser</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function showItemsView() {
    activeView = 'items';

    itemsListContainer?.classList.remove('hidden');
    stockListContainer?.classList.add('hidden');

    showItemsBtn?.classList.add('primary');
    showItemsBtn?.classList.remove('secondary');

    showStockBtn?.classList.remove('primary');
    showStockBtn?.classList.add('secondary');

    await loadItems();
    renderItemsTable();
  }

  async function showStockView() {
    activeView = 'stock';

    stockListContainer?.classList.remove('hidden');
    itemsListContainer?.classList.add('hidden');

    showStockBtn?.classList.add('primary');
    showStockBtn?.classList.remove('secondary');

    showItemsBtn?.classList.remove('primary');
    showItemsBtn?.classList.add('secondary');

    await loadItems();
    renderStockTable();
  }

  function refreshActiveView() {
    updateFilterOptions();

    if (activeView === 'items') {
      renderItemsTable();
    }

    if (activeView === 'stock') {
      renderStockTable();
    }
  }

  async function sendManualStockAlerts() {
    await loadItems();

    const alertItems = itemsCache.filter(item => {
      const status = getStatus(item);
      return status.label === 'Rupture' || status.label === 'Stock bas';
    });

    if (!alertItems.length) {
      alert('Aucun consommable en stock bas ou en rupture.');
      return;
    }

    let sentCount = 0;

    for (const item of alertItems) {
      const qty = safeNumber(item.stockQuantity);
      const sent = await sendAutomaticStockAlert(item, 'ALERTE_MANUELLE', qty, qty);

      if (sent) {
        sentCount += 1;
      }
    }

    alert(`${sentCount} alerte(s) envoyée(s) vers ${ALERT_EMAIL}.`);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();

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

    const qrValue = generateQrValue(itemCode);

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

      message.textContent = 'Consommable enregistré avec succès. QR code généré à partir de la référence.';
      message.classList.add('success');

      clearForm();
      await loadItems();
      refreshActiveView();

    } catch (error) {
      console.error(error);
      message.textContent = `Erreur Appwrite : ${error.message}`;
      message.classList.add('error');
    }
  });

  table?.addEventListener('click', async event => {
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
      if (item) fillForm(item);
    }

    if (printId) {
      const item = itemsCache.find(doc => doc.$id === printId);
      if (item) printQrCode(item);
    }

    if (deleteId) {
      const confirmed = confirm('Supprimer ce consommable ?');

      if (!confirmed) return;

      try {
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

  stockGestionTable?.addEventListener('click', event => {
    const locateId = event.target.dataset.locate;

    if (locateId) {
      const item = itemsCache.find(doc => doc.$id === locateId);
      if (item) openLocationModal(item);
    }
  });

  resetBtn?.addEventListener('click', clearForm);

  searchInput?.addEventListener('input', refreshActiveView);
  supplierSearchInput?.addEventListener('input', refreshActiveView);
  familyFilter?.addEventListener('input', refreshActiveView);
  typeFilter?.addEventListener('input', refreshActiveView);

  showItemsBtn?.addEventListener('click', showItemsView);
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

  loadItems().catch(error => {
    console.error(error);
  });
}

// ==============================
// DÉMARRAGE
// ==============================

initStockPage();
initGestionPage();
