import { Client, Databases, ID, Query } from 'https://cdn.jsdelivr.net/npm/appwrite@15.0.0/+esm';

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

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

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

function generateQrValue(internalCode) {
  return internalCode;
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

function mailtoFor(item) {
  const supplierEmail = getSupplierEmail(item);

  const subject = encodeURIComponent(
    `Demande de réapprovisionnement - ${item.itemName} (${item.itemCode})`
  );

  const body = encodeURIComponent(
`Bonjour,

Nous souhaitons recevoir un devis ou organiser un réapprovisionnement pour le consommable suivant :

Référence : ${item.itemCode}
Désignation : ${item.itemName}
Famille / équipement : ${item.equipmentFamily || '-'}
Type de consommable : ${item.consumableType || '-'}
QR code : ${item.barcodeValue || '-'}
Emplacement : ${item.storageLocation || '-'}

Quantité actuelle : ${item.stockQuantity}
Seuil d’alerte : ${item.alertThreshold}
Prix connu : ${euro(item.unitPrice)}

Fournisseur : ${item.supplierName || '-'}

Merci de nous transmettre votre meilleure offre, le délai de livraison et le conditionnement.

Cordialement.`
  );

  return `mailto:${supplierEmail}?subject=${subject}&body=${body}`;
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
        <p>${escapeHtml(qrValue)}</p>
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
// PAGE STOCK
// ==============================

function initStockPage() {
  const itemSelect = document.querySelector('#itemSelect');
  const qrSearch = document.querySelector('#qrSearch');
  const searchQrBtn = document.querySelector('#searchQrBtn');
  const startScannerBtn = document.querySelector('#startScannerBtn');
  const stopScannerBtn = document.querySelector('#stopScannerBtn');
  const qrReader = document.querySelector('#qrReader');

  const currentQtyInput = document.querySelector('#currentQty');
  const stockTable = document.querySelector('#stockTable');
  const form = document.querySelector('#movementForm');
  const message = document.querySelector('#movementMessage');
  const scanMessage = document.querySelector('#scanMessage');
  const selectedItemInfo = document.querySelector('#selectedItemInfo');
  const addStockBtn = document.querySelector('#addStockBtn');
  const removeStockBtn = document.querySelector('#removeStockBtn');

  if (!itemSelect || !stockTable || !form) return;

  let itemsCache = [];
  let qrScanner = null;
  let scannerRunning = false;
  let lastScannedValue = '';

  function setScanMessage(text, type = '') {
    if (!scanMessage) return;
    scanMessage.textContent = text;
    scanMessage.className = type ? `message ${type}` : 'message';
  }

  function findItemByQr(value) {
    const search = String(value || '').trim().toLowerCase();

    if (!search) return null;

    return itemsCache.find(item =>
      String(item.barcodeValue || '').toLowerCase() === search ||
      String(item.internalCode || '').toLowerCase() === search ||
      String(item.itemCode || '').toLowerCase() === search
    );
  }

  function selectItem(item) {
    if (!item) return;

    itemSelect.value = item.$id;
    updateSelectedItemInfo();

    setScanMessage(`Consommable trouvé : ${item.itemCode} — ${item.itemName}`, 'success');

    const qtyInput = document.querySelector('#movementQty');
    if (qtyInput) qtyInput.focus();
  }

  async function handleQrSearch(value, shouldStopCamera = false) {
    const cleanValue = String(value || '').trim();

    if (!cleanValue) return;

    const item = findItemByQr(cleanValue);

    if (shouldStopCamera) {
      await stopScanner(false);
    }

    if (!item) {
      setScanMessage('Aucun consommable trouvé avec ce QR code.', 'error');
      return;
    }

    selectItem(item);

    if (qrSearch) qrSearch.value = '';
  }

  function updateSelectedItemInfo() {
    const selectedItem = itemsCache.find(item => item.$id === itemSelect.value);

    if (!selectedItem) {
      if (currentQtyInput) currentQtyInput.value = 0;
      if (selectedItemInfo) selectedItemInfo.textContent = '';
      return;
    }

    if (currentQtyInput) {
      currentQtyInput.value = safeNumber(selectedItem.stockQuantity);
    }

    if (selectedItemInfo) {
      const status = getStatus(selectedItem);

      selectedItemInfo.innerHTML = `
        <strong>${escapeHtml(selectedItem.itemCode)} — ${escapeHtml(selectedItem.itemName)}</strong><br />
        Famille : ${escapeHtml(selectedItem.equipmentFamily || '-')} |
        Type : ${escapeHtml(selectedItem.consumableType || '-')} |
        Emplacement : ${escapeHtml(selectedItem.storageLocation || '-')}<br />
        Quantité : ${safeNumber(selectedItem.stockQuantity)} |
        Seuil : ${safeNumber(selectedItem.alertThreshold)} |
        Statut : <strong>${escapeHtml(status.label)}</strong>
      `;
    }
  }

  async function renderStock() {
    try {
      itemsCache = await listItems();

      if (!itemsCache.length) {
        itemSelect.innerHTML = '<option value="">Aucun consommable</option>';

        if (currentQtyInput) currentQtyInput.value = 0;

        stockTable.innerHTML = '<tr><td colspan="10">Aucun consommable enregistré.</td></tr>';
        return;
      }

      itemSelect.innerHTML = itemsCache.map(item => `
        <option value="${item.$id}">
          ${escapeHtml(item.itemCode)} — ${escapeHtml(item.itemName)}
        </option>
      `).join('');

      updateSelectedItemInfo();

      const stockAlerts = itemsCache.filter(item => {
        const qty = safeNumber(item.stockQuantity);
        const threshold = safeNumber(item.alertThreshold);

        const isRupture = qty <= 0;
        const isStockBas = threshold > 0 && qty > 0 && qty <= threshold;

        return isRupture || isStockBas;
      });

      if (!stockAlerts.length) {
        stockTable.innerHTML = '<tr><td colspan="10">Aucun consommable en stock bas ou en rupture.</td></tr>';
        return;
      }

      stockTable.innerHTML = stockAlerts.map(item => {
        const status = getStatus(item);
        const supplierEmail = getSupplierEmail(item);

        return `
          <tr>
            <td>${escapeHtml(item.itemCode || '')}</td>
            <td>${escapeHtml(item.itemName || '')}</td>
            <td>${escapeHtml(item.equipmentFamily || '')}</td>
            <td>${escapeHtml(item.consumableType || '')}</td>
            <td>${escapeHtml(item.storageLocation || '')}</td>
            <td><strong>${safeNumber(item.stockQuantity)}</strong></td>
            <td>${safeNumber(item.alertThreshold)}</td>
            <td>${escapeHtml(item.supplierName || '')}</td>
            <td>
              <a href="mailto:${escapeHtml(supplierEmail)}">
                ${escapeHtml(supplierEmail)}
              </a>
            </td>
            <td>
              <span class="status ${status.className}">
                ${status.label}
              </span>
            </td>
          </tr>
        `;
      }).join('');

    } catch (error) {
      console.error(error);
      stockTable.innerHTML = '<tr><td colspan="10">Erreur de chargement Appwrite.</td></tr>';
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
    if (!qrReader) return;

    if (!window.Html5Qrcode) {
      setScanMessage('Le module de scan QR code n’est pas disponible.', 'error');
      return;
    }

    if (scannerRunning) {
      setScanMessage('La caméra est déjà ouverte.', 'success');
      return;
    }

    try {
      setScanMessage('Demande d’accès à la caméra du téléphone...');

      qrScanner = new window.Html5Qrcode('qrReader');

      const cameraId = await getBestCameraId();

      if (!cameraId) {
        setScanMessage(
          'Aucune caméra détectée. Essayez depuis un téléphone avec caméra ou saisissez le QR code manuellement.',
          'error'
        );
        return;
      }

      await qrScanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: {
            width: 260,
            height: 260
          },
          aspectRatio: 1.777
        },
        async decodedText => {
          const cleanDecoded = String(decodedText || '').trim();

          if (!cleanDecoded || cleanDecoded === lastScannedValue) return;

          lastScannedValue = cleanDecoded;

          if (navigator.vibrate) {
            navigator.vibrate(120);
          }

          await handleQrSearch(cleanDecoded, true);
        }
      );

      scannerRunning = true;
      setScanMessage('Caméra active. Flashez le QR code avec le téléphone.', 'success');

    } catch (error) {
      console.error(error);
      setScanMessage(`Erreur caméra : ${error.message || error}`, 'error');
    }
  }

  async function stopScanner(showMessage = true) {
    if (!qrScanner || !scannerRunning) return;

    try {
      await qrScanner.stop();
      await qrScanner.clear();

      scannerRunning = false;
      qrScanner = null;
      lastScannedValue = '';

      if (showMessage) {
        setScanMessage('Caméra fermée.');
      }

    } catch (error) {
      console.error(error);
      setScanMessage(`Erreur fermeture caméra : ${error.message || error}`, 'error');
    }
  }

  async function applyStockMovement(type) {
    message.textContent = '';
    message.className = 'message';

    const documentId = itemSelect.value;
    const movementQty = safeNumber(document.querySelector('#movementQty').value);
    const comment = document.querySelector('#movementComment')?.value.trim() || '';

    const item = itemsCache.find(doc => doc.$id === documentId);

    if (!item) {
      message.textContent = 'Veuillez choisir un consommable.';
      message.classList.add('error');
      return;
    }

    if (movementQty <= 0) {
      message.textContent = 'La quantité doit être supérieure à 0.';
      message.classList.add('error');
      return;
    }

    const oldQuantity = safeNumber(item.stockQuantity);

    if (type === 'out' && movementQty > oldQuantity) {
      message.textContent = 'Quantité insuffisante pour cette sortie.';
      message.classList.add('error');
      return;
    }

    const newQuantity = type === 'in'
      ? oldQuantity + movementQty
      : oldQuantity - movementQty;

    try {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.items,
        item.$id,
        {
          stockQuantity: newQuantity
        }
      );

      await databases.createDocument(
        DATABASE_ID,
        COLLECTIONS.movements,
        ID.unique(),
        {
          itemId: item.$id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          movementType: type === 'in' ? 'ENTREE' : 'SORTIE',
          quantity: movementQty,
          oldQuantity,
          newQuantity,
          date: new Date().toISOString(),
          comment,
          user: 'Utilisateur web'
        }
      );

      const updatedItem = {
        ...item,
        stockQuantity: newQuantity
      };

      const status = getStatus(updatedItem);

      message.textContent = `Mouvement enregistré. Nouveau stock : ${newQuantity}. Statut : ${status.label}.`;
      message.classList.add('success');

      document.querySelector('#movementQty').value = 1;
      document.querySelector('#movementComment').value = '';

      await renderStock();

      if (status.label === 'Rupture' || status.label === 'Stock bas') {
        const openEmail = confirm(
          `Alerte ${status.label} pour ${item.itemName}. Voulez-vous ouvrir l’email fournisseur ?`
        );

        if (openEmail) {
          window.location.href = mailtoFor(updatedItem);
        }
      }

    } catch (error) {
      console.error(error);
      message.textContent = `Erreur Appwrite : ${error.message}`;
      message.classList.add('error');
    }
  }

  itemSelect.addEventListener('change', updateSelectedItemInfo);

  qrSearch?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    handleQrSearch(qrSearch.value, false);
  });

  searchQrBtn?.addEventListener('click', () => {
    handleQrSearch(qrSearch?.value, false);
  });

  startScannerBtn?.addEventListener('click', startScanner);
  stopScannerBtn?.addEventListener('click', () => stopScanner(true));

  addStockBtn?.addEventListener('click', () => applyStockMovement('in'));
  removeStockBtn?.addEventListener('click', () => applyStockMovement('out'));

  form.addEventListener('submit', event => {
    event.preventDefault();
  });

  renderStock();
}

// ==============================
// PAGE GESTION DU STOCK
// ==============================

function initStockPage() {
  const qrSearch = document.querySelector('#qrSearch');
  const searchQrBtn = document.querySelector('#searchQrBtn');
  const startScannerBtn = document.querySelector('#startScannerBtn');
  const stopScannerBtn = document.querySelector('#stopScannerBtn');
  const qrReader = document.querySelector('#qrReader');

  const selectedStockBox = document.querySelector('#selectedStockBox');
  const selectedItemTitle = document.querySelector('#selectedItemTitle');
  const selectedItemDetails = document.querySelector('#selectedItemDetails');

  const movementQtyInput = document.querySelector('#movementQty');
  const movementCommentInput = document.querySelector('#movementComment');
  const addStockBtn = document.querySelector('#addStockBtn');
  const removeStockBtn = document.querySelector('#removeStockBtn');

  const stockTable = document.querySelector('#stockTable');
  const scanMessage = document.querySelector('#scanMessage');
  const movementMessage = document.querySelector('#movementMessage');

  if (!qrSearch || !stockTable) return;

  let itemsCache = [];
  let selectedItem = null;
  let qrScanner = null;
  let scannerRunning = false;
  let lastScannedValue = '';

  function setScanMessage(text, type = '') {
    if (!scanMessage) return;
    scanMessage.textContent = text;
    scanMessage.className = type ? `message ${type}` : 'message';
  }

  function setMovementMessage(text, type = '') {
    if (!movementMessage) return;
    movementMessage.textContent = text;
    movementMessage.className = type ? `message ${type}` : 'message';
  }

  function clearSelectedItem() {
    selectedItem = null;

    if (selectedStockBox) {
      selectedStockBox.classList.add('hidden');
    }

    if (selectedItemTitle) {
      selectedItemTitle.textContent = '';
    }

    if (selectedItemDetails) {
      selectedItemDetails.textContent = '';
    }

    if (movementQtyInput) {
      movementQtyInput.value = 1;
    }

    if (movementCommentInput) {
      movementCommentInput.value = '';
    }

    setMovementMessage('');
  }

  function findItemByQr(value) {
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

    if (!selectedItem) {
      clearSelectedItem();
      return;
    }

    const status = getStatus(selectedItem);

    if (selectedStockBox) {
      selectedStockBox.classList.remove('hidden');
    }

    if (selectedItemTitle) {
      selectedItemTitle.textContent = `${selectedItem.itemCode || ''} — ${selectedItem.itemName || ''}`;
    }

    if (selectedItemDetails) {
      selectedItemDetails.innerHTML = `
        <strong>Stock actuel :</strong> ${safeNumber(selectedItem.stockQuantity)} |
        <strong>Seuil :</strong> ${safeNumber(selectedItem.alertThreshold)} |
        <strong>Statut :</strong> ${escapeHtml(status.label)}<br />
        <strong>Emplacement :</strong> ${escapeHtml(selectedItem.storageLocation || '-')}<br />
        <strong>Fournisseur :</strong> ${escapeHtml(selectedItem.supplierName || '-')}
      `;
    }

    if (movementQtyInput) {
      movementQtyInput.value = 1;
      movementQtyInput.focus();
    }

    if (movementCommentInput) {
      movementCommentInput.value = '';
    }

    setMovementMessage('');
  }

  async function handleQrSearch(value, shouldStopCamera = false) {
    const cleanValue = String(value || '').trim();

    if (!cleanValue) return;

    if (shouldStopCamera) {
      await stopScanner(false);
    }

    const item = findItemByQr(cleanValue);

    if (!item) {
      clearSelectedItem();
      setScanMessage('Aucun consommable trouvé avec ce QR code.', 'error');
      return;
    }

    displaySelectedItem(item);
    setScanMessage(`Consommable trouvé : ${item.itemCode} — ${item.itemName}`, 'success');

    if (qrSearch) {
      qrSearch.value = '';
    }
  }

  async function renderStockAlerts() {
    try {
      itemsCache = await listItems();

      const stockAlerts = itemsCache.filter(item => {
        const qty = safeNumber(item.stockQuantity);
        const threshold = safeNumber(item.alertThreshold);

        const isRupture = qty <= 0;
        const isStockBas = threshold > 0 && qty > 0 && qty <= threshold;

        return isRupture || isStockBas;
      });

      if (!stockAlerts.length) {
        stockTable.innerHTML = '<tr><td colspan="7">Aucun consommable en stock bas ou en rupture.</td></tr>';
        return;
      }

      stockTable.innerHTML = stockAlerts.map(item => {
        const status = getStatus(item);

        return `
          <tr>
            <td>${escapeHtml(item.itemCode || '')}</td>
            <td>${escapeHtml(item.itemName || '')}</td>
            <td>${escapeHtml(item.storageLocation || '')}</td>
            <td><strong>${safeNumber(item.stockQuantity)}</strong></td>
            <td>${safeNumber(item.alertThreshold)}</td>
            <td>${escapeHtml(item.supplierName || '')}</td>
            <td>
              <span class="status ${status.className}">
                ${status.label}
              </span>
            </td>
          </tr>
        `;
      }).join('');

    } catch (error) {
      console.error(error);
      stockTable.innerHTML = '<tr><td colspan="7">Erreur de chargement Appwrite.</td></tr>';
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
    if (!qrReader) return;

    if (!window.Html5Qrcode) {
      setScanMessage('Le module de scan QR code n’est pas disponible.', 'error');
      return;
    }

    if (scannerRunning) {
      setScanMessage('La caméra est déjà ouverte.', 'success');
      return;
    }

    try {
      setScanMessage('Demande d’accès à la caméra...');

      qrScanner = new window.Html5Qrcode('qrReader');

      const cameraId = await getBestCameraId();

      if (!cameraId) {
        setScanMessage('Aucune caméra détectée. Saisissez le QR code manuellement.', 'error');
        return;
      }

      await qrScanner.start(
        cameraId,
        {
          fps: 10,
          qrbox: {
            width: 260,
            height: 260
          }
        },
        async decodedText => {
          const cleanDecoded = String(decodedText || '').trim();

          if (!cleanDecoded || cleanDecoded === lastScannedValue) return;

          lastScannedValue = cleanDecoded;

          if (navigator.vibrate) {
            navigator.vibrate(120);
          }

          await handleQrSearch(cleanDecoded, true);
        }
      );

      scannerRunning = true;
      setScanMessage('Caméra active. Flashez le QR code.', 'success');

    } catch (error) {
      console.error(error);
      setScanMessage(`Erreur caméra : ${error.message || error}`, 'error');
    }
  }

  async function stopScanner(showMessage = true) {
    if (!qrScanner || !scannerRunning) return;

    try {
      await qrScanner.stop();
      await qrScanner.clear();

      scannerRunning = false;
      qrScanner = null;
      lastScannedValue = '';

      if (showMessage) {
        setScanMessage('Caméra fermée.');
      }

    } catch (error) {
      console.error(error);
      setScanMessage(`Erreur fermeture caméra : ${error.message || error}`, 'error');
    }
  }

  async function applyStockMovement(type) {
    setMovementMessage('');

    if (!selectedItem) {
      setMovementMessage('Scannez ou saisissez d’abord un QR code.', 'error');
      return;
    }

    const movementQty = safeNumber(movementQtyInput?.value);
    const comment = movementCommentInput?.value.trim() || '';

    if (movementQty <= 0) {
      setMovementMessage('La quantité doit être supérieure à 0.', 'error');
      return;
    }

    const oldQuantity = safeNumber(selectedItem.stockQuantity);

    if (type === 'out' && movementQty > oldQuantity) {
      setMovementMessage('Quantité insuffisante pour cette sortie.', 'error');
      return;
    }

    const newQuantity = type === 'in'
      ? oldQuantity + movementQty
      : oldQuantity - movementQty;

    try {
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
          movementType: type === 'in' ? 'ENTREE' : 'SORTIE',
          quantity: movementQty,
          oldQuantity,
          newQuantity,
          date: new Date().toISOString(),
          comment,
          user: 'Utilisateur web'
        }
      );

      selectedItem = {
        ...selectedItem,
        stockQuantity: newQuantity
      };

      const status = getStatus(selectedItem);

      setMovementMessage(
        `${type === 'in' ? 'Ajout' : 'Retrait'} enregistré. Nouveau stock : ${newQuantity}. Statut : ${status.label}.`,
        'success'
      );

      displaySelectedItem(selectedItem);

      await renderStockAlerts();

      if (status.label === 'Rupture' || status.label === 'Stock bas') {
        const openEmail = confirm(
          `Alerte ${status.label} pour ${selectedItem.itemName}. Voulez-vous ouvrir l’email fournisseur ?`
        );

        if (openEmail) {
          window.location.href = mailtoFor(selectedItem);
        }
      }

    } catch (error) {
      console.error(error);
      setMovementMessage(`Erreur Appwrite : ${error.message}`, 'error');
    }
  }

  qrSearch?.addEventListener('input', () => {
    clearSelectedItem();
  });

  qrSearch?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    handleQrSearch(qrSearch.value, false);
  });

  searchQrBtn?.addEventListener('click', () => {
    handleQrSearch(qrSearch?.value, false);
  });

  startScannerBtn?.addEventListener('click', startScanner);
  stopScannerBtn?.addEventListener('click', () => stopScanner(true));

  addStockBtn?.addEventListener('click', () => applyStockMovement('in'));
  removeStockBtn?.addEventListener('click', () => applyStockMovement('out'));

  renderStockAlerts();
}
// ==============================
// DÉMARRAGE
// ==============================

initStockPage();
initGestionPage();
