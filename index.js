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

// Valeurs acceptées dans Appwrite pour category : Consommable, piece_detachee, autre
const DEFAULT_CATEGORY = 'Consommable';

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
    .replace(/[^A-Z0-9_-]/g, '');
}

function generateBarcodeValue(itemCode, internalCode) {
  const base = normalizeCode(internalCode || itemCode || 'BIO');
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();

  return `BIO-${base}-${stamp}-${random}`.slice(0, 150);
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
Code interne : ${item.internalCode || '-'}
Code-barres : ${item.barcodeValue || '-'}
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

function renderBarcodeSvg(svgElement, barcodeValue) {
  if (!svgElement || !barcodeValue) return;

  if (!window.JsBarcode) {
    svgElement.outerHTML = `<span>${escapeHtml(barcodeValue)}</span>`;
    return;
  }

  window.JsBarcode(svgElement, barcodeValue, {
    format: 'CODE128',
    width: 1.2,
    height: 42,
    displayValue: true,
    fontSize: 11,
    margin: 4
  });
}

function renderAllBarcodes() {
  document.querySelectorAll('[data-barcode-value]').forEach(svg => {
    const value = svg.getAttribute('data-barcode-value');
    renderBarcodeSvg(svg, value);
  });
}

function printBarcode(item) {
  const barcodeValue = item.barcodeValue || '';
  const itemCode = item.itemCode || '';
  const itemName = item.itemName || '';
  const internalCode = item.internalCode || '';
  const storageLocation = item.storageLocation || '';

  if (!barcodeValue) {
    alert('Aucun code-barres disponible pour ce consommable.');
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
      <title>Code-barres — ${escapeHtml(itemCode)}</title>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 24px;
          color: #111827;
        }

        .label {
          width: 360px;
          border: 1px solid #111827;
          border-radius: 12px;
          padding: 18px;
        }

        h1 {
          font-size: 18px;
          margin: 0 0 6px;
        }

        p {
          margin: 4px 0;
          font-size: 13px;
        }

        svg {
          margin-top: 12px;
          width: 100%;
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
        <p><strong>Code interne :</strong> ${escapeHtml(internalCode)}</p>
        <p><strong>Emplacement :</strong> ${escapeHtml(storageLocation)}</p>
        <svg id="barcode"></svg>
      </div>

      <br />
      <button onclick="window.print()">Imprimer</button>

      <script>
        JsBarcode("#barcode", ${JSON.stringify(barcodeValue)}, {
          format: "CODE128",
          width: 1.4,
          height: 60,
          displayValue: true,
          fontSize: 14,
          margin: 8
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
  const barcodeSearch = document.querySelector('#barcodeSearch');
  const currentQtyInput = document.querySelector('#currentQty');
  const thresholdInput = document.querySelector('#stockThreshold');
  const stockTable = document.querySelector('#stockTable');
  const form = document.querySelector('#movementForm');
  const message = document.querySelector('#movementMessage');
  const selectedItemInfo = document.querySelector('#selectedItemInfo');

  if (!itemSelect || !stockTable || !form) return;

  let itemsCache = [];

  function findItemByBarcodeOrCode(value) {
    const search = String(value || '').trim().toLowerCase();

    if (!search) return null;

    return itemsCache.find(item =>
      String(item.barcodeValue || '').toLowerCase() === search ||
      String(item.internalCode || '').toLowerCase() === search ||
      String(item.itemCode || '').toLowerCase() === search
    );
  }

  function updateSelectedItemInfo() {
    const selectedItem = itemsCache.find(item => item.$id === itemSelect.value);

    if (!selectedItem) {
      if (currentQtyInput) currentQtyInput.value = 0;
      if (thresholdInput) thresholdInput.value = 0;
      if (selectedItemInfo) selectedItemInfo.textContent = '';
      return;
    }

    if (currentQtyInput) {
      currentQtyInput.value = safeNumber(selectedItem.stockQuantity);
    }

    if (thresholdInput) {
      thresholdInput.value = safeNumber(selectedItem.alertThreshold);
    }

    if (selectedItemInfo) {
      selectedItemInfo.innerHTML = `
        <strong>${escapeHtml(selectedItem.itemCode)} — ${escapeHtml(selectedItem.itemName)}</strong><br />
        Code interne : ${escapeHtml(selectedItem.internalCode || '-')} |
        Code-barres : ${escapeHtml(selectedItem.barcodeValue || '-')} |
        Emplacement : ${escapeHtml(selectedItem.storageLocation || '-')}
      `;
    }
  }

  async function renderStock() {
    try {
      itemsCache = await listItems();

      if (!itemsCache.length) {
        itemSelect.innerHTML = '<option value="">Aucun consommable</option>';

        if (currentQtyInput) currentQtyInput.value = 0;
        if (thresholdInput) thresholdInput.value = 0;

        stockTable.innerHTML = '<tr><td colspan="10">Aucun consommable enregistré.</td></tr>';
        return;
      }

      itemSelect.innerHTML = itemsCache.map(item => `
        <option value="${item.$id}">
          ${escapeHtml(item.itemCode)} — ${escapeHtml(item.itemName)}
        </option>
      `).join('');

      updateSelectedItemInfo();

      stockTable.innerHTML = itemsCache.map(item => {
        const status = getStatus(item);
        const supplierEmail = getSupplierEmail(item);

        return `
          <tr>
            <td>${escapeHtml(item.itemCode)}</td>
            <td>${escapeHtml(item.itemName)}</td>
            <td>${escapeHtml(item.internalCode || '')}</td>
            <td>${escapeHtml(item.barcodeValue || '')}</td>
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

  itemSelect.addEventListener('change', updateSelectedItemInfo);

  barcodeSearch?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;

    event.preventDefault();

    const foundItem = findItemByBarcodeOrCode(barcodeSearch.value);

    if (!foundItem) {
      message.textContent = 'Aucun consommable trouvé avec ce code.';
      message.className = 'message error';
      return;
    }

    itemSelect.value = foundItem.$id;
    updateSelectedItemInfo();

    message.textContent = `Consommable trouvé : ${foundItem.itemCode} — ${foundItem.itemName}`;
    message.className = 'message success';

    barcodeSearch.value = '';
    document.querySelector('#movementQty')?.focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    message.textContent = '';
    message.className = 'message';

    const documentId = itemSelect.value;
    const movementType = document.querySelector('#movementType').value;
    const movementQty = safeNumber(document.querySelector('#movementQty').value);
    const newThreshold = thresholdInput ? safeNumber(thresholdInput.value) : 0;
    const comment = document.querySelector('#movementComment')?.value.trim() || '';

    const item = itemsCache.find(doc => doc.$id === documentId);

    if (!item) {
      message.textContent = 'Veuillez choisir un consommable.';
      message.classList.add('error');
      return;
    }

    if (movementQty <= 0) {
      message.textContent = 'La quantité du mouvement doit être supérieure à 0.';
      message.classList.add('error');
      return;
    }

    const oldQuantity = safeNumber(item.stockQuantity);

    if (movementType === 'out' && movementQty > oldQuantity) {
      message.textContent = 'Quantité insuffisante pour cette sortie.';
      message.classList.add('error');
      return;
    }

    const newQuantity = movementType === 'in'
      ? oldQuantity + movementQty
      : oldQuantity - movementQty;

    try {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.items,
        item.$id,
        {
          stockQuantity: newQuantity,
          alertThreshold: newThreshold
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
          movementType: movementType === 'in' ? 'ENTREE' : 'SORTIE',
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
        stockQuantity: newQuantity,
        alertThreshold: newThreshold
      };

      const status = getStatus(updatedItem);

      message.textContent = `Stock mis à jour avec succès. Nouveau stock : ${newQuantity}. Statut : ${status.label}.`;
      message.classList.add('success');

      await renderStock();

      if (status.label === 'Rupture' || status.label === 'Stock bas') {
        const openEmail = confirm(
          `Alerte ${status.label} pour ${item.itemName}. Voulez-vous ouvrir l’email fournisseur ?`
        );

        if (openEmail) {
          window.location.href = mailtoFor(updatedItem);
        }
      }

      form.reset();
      updateSelectedItemInfo();

    } catch (error) {
      console.error(error);
      message.textContent = `Erreur Appwrite : ${error.message}`;
      message.classList.add('error');
    }
  });

  renderStock();
}

// ==============================
// PAGE GESTION DU STOCK
// ==============================

function initGestionPage() {
  const form = document.querySelector('#itemForm');
  const table = document.querySelector('#itemsTable');
  const message = document.querySelector('#formMessage');
  const resetBtn = document.querySelector('#resetBtn');
  const searchInput = document.querySelector('#searchInput');

  if (!form || !table) return;

  let itemsCache = [];

  function clearForm() {
    form.reset();
    document.querySelector('#itemId').value = '';
    document.querySelector('#itemBarcode').value = '';
    document.querySelector('#formTitle').textContent = 'Ajouter un consommable';
    message.textContent = '';
    message.className = 'message';
  }

  function fillForm(item) {
    document.querySelector('#formTitle').textContent = 'Modifier un consommable';
    document.querySelector('#itemId').value = item.$id;
    document.querySelector('#itemBarcode').value = item.barcodeValue || '';
    document.querySelector('#reference').value = item.itemCode || '';
    document.querySelector('#designation').value = item.itemName || '';

    const categoryInput = document.querySelector('#category');
    if (categoryInput) {
      categoryInput.value = item.category || DEFAULT_CATEGORY;
    }

    document.querySelector('#price').value = item.unitPrice || 0;
    document.querySelector('#internalCode').value = item.internalCode || '';
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

  async function renderGestion() {
    try {
      itemsCache = await listItems();

      const term = String(searchInput?.value || '').toLowerCase();

      const filtered = itemsCache.filter(item =>
        String(item.itemCode || '').toLowerCase().includes(term) ||
        String(item.itemName || '').toLowerCase().includes(term) ||
        String(item.category || '').toLowerCase().includes(term) ||
        String(item.internalCode || '').toLowerCase().includes(term) ||
        String(item.barcodeValue || '').toLowerCase().includes(term) ||
        String(item.storageLocation || '').toLowerCase().includes(term) ||
        String(item.supplierName || '').toLowerCase().includes(term)
      );

      if (!filtered.length) {
        table.innerHTML = '<tr><td colspan="10">Aucun consommable trouvé.</td></tr>';
        return;
      }

      table.innerHTML = filtered.map(item => `
        <tr>
          <td>${escapeHtml(item.itemCode || '')}</td>
          <td>${escapeHtml(item.itemName || '')}</td>
          <td>${escapeHtml(item.category || '')}</td>
          <td>${escapeHtml(item.internalCode || '')}</td>
          <td>${escapeHtml(item.storageLocation || '')}</td>
          <td>${escapeHtml(item.supplierName || '')}</td>
          <td>${escapeHtml(getSupplierEmail(item))}</td>
          <td>${euro(item.unitPrice)}</td>
          <td>
            ${
              item.barcodeValue
                ? `<svg data-barcode-value="${escapeHtml(item.barcodeValue)}"></svg>`
                : '<span>À générer</span>'
            }
          </td>
          <td class="row-actions">
            <button class="btn secondary" type="button" data-edit="${item.$id}">Modifier</button>
            <button class="btn warning" type="button" data-print="${item.$id}">Imprimer</button>
            <button class="btn danger" type="button" data-delete="${item.$id}">Supprimer</button>
          </td>
        </tr>
      `).join('');

      renderAllBarcodes();

    } catch (error) {
      table.innerHTML = `<tr><td colspan="10">Erreur Appwrite : ${escapeHtml(error.message)}</td></tr>`;
      console.error(error);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();

    message.textContent = '';
    message.className = 'message';

    const documentId = document.querySelector('#itemId').value;

    const itemCode = document.querySelector('#reference').value.trim();
    const itemName = document.querySelector('#designation').value.trim();
    const category = document.querySelector('#category')?.value || DEFAULT_CATEGORY;
    const unitPrice = safeNumber(document.querySelector('#price').value);
    const internalCode = document.querySelector('#internalCode').value.trim();
    const storageLocation = document.querySelector('#storageLocation').value.trim();

    const supplierName = document.querySelector('#supplier').value.trim();
    const contact = document.querySelector('#contact').value.trim();
    const email = document.querySelector('#email').value.trim();
    const notes = document.querySelector('#notes').value.trim();

    let barcodeValue = document.querySelector('#itemBarcode').value.trim();

    if (!itemCode || !itemName || !category || !supplierName || !email || !internalCode || !storageLocation) {
      message.textContent = 'Veuillez remplir référence, désignation, catégorie, fournisseur, email, code interne et emplacement.';
      message.classList.add('error');
      return;
    }

    if (!barcodeValue) {
      barcodeValue = generateBarcodeValue(itemCode, internalCode);
    }

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
        category,
        unitPrice,
        expirationDate: null,
        supplierId: supplierDoc.$id,
        supplierName,
        Email: email,
        internalCode,
        storageLocation,
        barcodeValue
      };

      if (isNewItem) {
        data.stockQuantity = 0;
        data.alertThreshold = 0;
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

      message.textContent = `Consommable enregistré avec succès. Code-barres : ${barcodeValue}`;
      message.classList.add('success');

      clearForm();
      await renderGestion();

    } catch (error) {
      console.error(error);
      message.textContent = `Erreur Appwrite : ${error.message}`;
      message.classList.add('error');
    }
  });

  table.addEventListener('click', async event => {
    const editId = event.target.dataset.edit;
    const printId = event.target.dataset.print;
    const deleteId = event.target.dataset.delete;

    if (editId) {
      const item = itemsCache.find(doc => doc.$id === editId);
      if (item) fillForm(item);
    }

    if (printId) {
      const item = itemsCache.find(doc => doc.$id === printId);
      if (item) printBarcode(item);
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

        await renderGestion();

      } catch (error) {
        alert(`Erreur Appwrite : ${error.message}`);
      }
    }
  });

  resetBtn?.addEventListener('click', clearForm);
  searchInput?.addEventListener('input', renderGestion);

  renderGestion();
}

// ==============================
// DÉMARRAGE
// ==============================

initStockPage();
initGestionPage();
