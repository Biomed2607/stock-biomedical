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

// Cette valeur doit exister dans l'enum Appwrite "category"
const DEFAULT_CATEGORY = 'consommable';

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

function getSupplierEmail(item) {
  return item.Email || item.supplierEmail || '';
}

function mailtoFor(item) {
  const supplierEmail = getSupplierEmail(item);

  const subject = encodeURIComponent(
    `Demande de devis - ${item.itemName} (${item.itemCode})`
  );

  const body = encodeURIComponent(
`Bonjour,

Nous souhaitons recevoir un devis pour le consommable suivant :

Référence : ${item.itemCode}
Désignation : ${item.itemName}
Quantité actuelle : ${item.stockQuantity}
Seuil d’alerte : ${item.alertThreshold}
Prix connu : ${euro(item.unitPrice)}
Fournisseur : ${item.supplierName || '-'}

Merci de nous transmettre votre meilleure offre, le délai de livraison et le conditionnement.

Cordialement.`
  );

  return `mailto:${supplierEmail}?subject=${subject}&body=${body}`;
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
  const stockTable = document.querySelector('#stockTable');
  const alertsList = document.querySelector('#alertsList');
  const form = document.querySelector('#movementForm');
  const message = document.querySelector('#movementMessage');
  const exportBtn = document.querySelector('#exportBtn');
  const prepareAlertsBtn = document.querySelector('#prepareAlertsBtn');

  if (!itemSelect || !stockTable || !form) return;

  let itemsCache = [];

  async function renderStock() {
    try {
      itemsCache = await listItems();

      if (!itemsCache.length) {
        itemSelect.innerHTML = '<option value="">Aucun consommable</option>';
        stockTable.innerHTML = '<tr><td colspan="7">Aucun consommable enregistré.</td></tr>';
        alertsList.innerHTML = '<p>Aucune donnée disponible.</p>';
        return;
      }

      itemSelect.innerHTML = itemsCache.map(item => `
        <option value="${item.$id}">
          ${escapeHtml(item.itemCode)} — ${escapeHtml(item.itemName)}
        </option>
      `).join('');

      stockTable.innerHTML = itemsCache.map(item => {
        const status = getStatus(item);
        const supplierEmail = getSupplierEmail(item);

        return `
          <tr>
            <td>${escapeHtml(item.itemCode)}</td>
            <td>${escapeHtml(item.itemName)}</td>
            <td><strong>${safeNumber(item.stockQuantity)}</strong></td>
            <td>${safeNumber(item.alertThreshold)}</td>
            <td>${escapeHtml(item.supplierName || '')}</td>
            <td><a href="mailto:${escapeHtml(supplierEmail)}">${escapeHtml(supplierEmail)}</a></td>
            <td><span class="status ${status.className}">${status.label}</span></td>
          </tr>
        `;
      }).join('');

      const lowItems = itemsCache.filter(item => {
        const threshold = safeNumber(item.alertThreshold);
        return threshold > 0 && safeNumber(item.stockQuantity) <= threshold;
      });

      alertsList.innerHTML = lowItems.length
        ? lowItems.map(item => `
          <div class="alert">
            <strong>${escapeHtml(item.itemName)}</strong><br />
            Référence : ${escapeHtml(item.itemCode)}<br />
            Quantité actuelle : ${safeNumber(item.stockQuantity)}<br />
            Seuil : ${safeNumber(item.alertThreshold)}<br />
            Fournisseur : ${escapeHtml(item.supplierName || '-')}<br />
            Email : ${escapeHtml(getSupplierEmail(item) || '-')}<br />
            <a class="btn warning" href="${mailtoFor(item)}">
              Envoyer une demande de devis
            </a>
          </div>
        `).join('')
        : '<p>Aucune alerte : tous les consommables sont au-dessus du seuil.</p>';

    } catch (error) {
      console.error(error);
      stockTable.innerHTML = '<tr><td colspan="7">Erreur de chargement Appwrite.</td></tr>';
      alertsList.innerHTML = `<p class="message error">Erreur Appwrite : ${escapeHtml(error.message)}</p>`;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();

    message.textContent = '';
    message.className = 'message';

    const documentId = itemSelect.value;
    const movementType = document.querySelector('#movementType').value;
    const movementQty = safeNumber(document.querySelector('#movementQty').value);
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
          movementType: movementType === 'in' ? 'ENTREE' : 'SORTIE',
          quantity: movementQty,
          oldQuantity,
          newQuantity,
          date: new Date().toISOString(),
          comment: '',
          user: 'Utilisateur web'
        }
      );

      message.textContent = 'Stock mis à jour avec succès.';
      message.classList.add('success');

      form.reset();
      await renderStock();

    } catch (error) {
      console.error(error);
      message.textContent = `Erreur Appwrite : ${error.message}`;
      message.classList.add('error');
    }
  });

  prepareAlertsBtn?.addEventListener('click', () => {
    const firstLow = itemsCache.find(item => {
      const threshold = safeNumber(item.alertThreshold);
      return threshold > 0 && safeNumber(item.stockQuantity) <= threshold;
    });

    if (!firstLow) {
      alert('Aucune alerte à envoyer.');
      return;
    }

    window.location.href = mailtoFor(firstLow);
  });

  exportBtn?.addEventListener('click', () => {
    const header = [
      'Référence',
      'Désignation',
      'Catégorie',
      'Fournisseur',
      'Email',
      'Prix',
      'Quantité',
      'Seuil'
    ];

    const rows = itemsCache.map(item => [
      item.itemCode || '',
      item.itemName || '',
      item.category || '',
      item.supplierName || '',
      getSupplierEmail(item),
      item.unitPrice || 0,
      item.stockQuantity || 0,
      item.alertThreshold || 0
    ]);

    const csv = [header, ...rows]
      .map(row =>
        row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')
      )
      .join('\n');

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'stock-biomedical.csv';
    link.click();
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
    document.querySelector('#formTitle').textContent = 'Ajouter un consommable';
    message.textContent = '';
    message.className = 'message';
  }

  function fillForm(item) {
    document.querySelector('#formTitle').textContent = 'Modifier un consommable';
    document.querySelector('#itemId').value = item.$id;
    document.querySelector('#reference').value = item.itemCode || '';
    document.querySelector('#designation').value = item.itemName || '';

    const categoryInput = document.querySelector('#category');
    if (categoryInput) {
      categoryInput.value = item.category || DEFAULT_CATEGORY;
    }

    document.querySelector('#price').value = item.unitPrice || 0;
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
        String(item.supplierName || '').toLowerCase().includes(term)
      );

      if (!filtered.length) {
        table.innerHTML = '<tr><td colspan="7">Aucun consommable trouvé.</td></tr>';
        return;
      }

      table.innerHTML = filtered.map(item => `
        <tr>
          <td>${escapeHtml(item.itemCode || '')}</td>
          <td>${escapeHtml(item.itemName || '')}</td>
          <td>${escapeHtml(item.category || '')}</td>
          <td>${escapeHtml(item.supplierName || '')}</td>
          <td>${escapeHtml(getSupplierEmail(item))}</td>
          <td>${euro(item.unitPrice)}</td>
          <td class="row-actions">
            <button class="btn secondary" type="button" data-edit="${item.$id}">Modifier</button>
            <button class="btn danger" type="button" data-delete="${item.$id}">Supprimer</button>
          </td>
        </tr>
      `).join('');

    } catch (error) {
      table.innerHTML = `<tr><td colspan="7">Erreur Appwrite : ${escapeHtml(error.message)}</td></tr>`;
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

    const supplierName = document.querySelector('#supplier').value.trim();
    const contact = document.querySelector('#contact').value.trim();
    const email = document.querySelector('#email').value.trim();
    const notes = document.querySelector('#notes').value.trim();

    if (!itemCode || !itemName || !supplierName || !email) {
      message.textContent = 'Veuillez remplir référence, désignation, fournisseur et email fournisseur.';
      message.classList.add('error');
      return;
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
        Email: email
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

      message.textContent = 'Consommable enregistré avec succès.';
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
    const deleteId = event.target.dataset.delete;

    if (editId) {
      const item = itemsCache.find(doc => doc.$id === editId);
      if (item) fillForm(item);
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
