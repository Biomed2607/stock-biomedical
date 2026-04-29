cimport { Client, Databases, ID, Query } from 'https://cdn.jsdelivr.net/npm/appwrite/+esm';

// ==============================
// CONFIGURATION APPWRITE
// ==============================
const APPWRITE_ENDPOINT = 'https://cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69f1d5220033c670e25a';
const DATABASE_ID = 'base de données biomédicales de stock';

const COLLECTIONS = {
  suppliers: 'fournisseurs',
  items: 'consommables',
  movements: 'mouvements_stock'
};

// Cette valeur doit exister dans ton enum Appwrite "category"
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

function getStatus(item) {
  if (Number(item.stockQuantity) <= 0) {
    return { label: 'Rupture', className: 'out' };
  }

  if (Number(item.stockQuantity) <= Number(item.alertThreshold)) {
    return { label: 'Stock bas', className: 'low' };
  }

  return { label: 'OK', className: 'ok' };
}

function mailtoFor(item) {
  const subject = encodeURIComponent(`Demande de devis - ${item.itemName} (${item.itemCode})`);

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

  return `mailto:${item.Email}?subject=${subject}&body=${body}`;
}

async function listItems() {
  const response = await databases.listDocuments({
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.items,
    queries: [
      Query.orderAsc('itemName'),
      Query.limit(100)
    ]
  });

  return response.documents;
}

async function findOrCreateSupplier({ supplier, contact, email, notes }) {
  const cleanEmail = email.trim();

  const existing = await databases.listDocuments({
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.suppliers,
    queries: [
      Query.equal('email', [cleanEmail]),
      Query.limit(1)
    ]
  });

  if (existing.documents.length > 0) {
    const supplierDoc = existing.documents[0];

    await databases.updateDocument({
      databaseId: DATABASE_ID,
      collectionId: COLLECTIONS.suppliers,
      documentId: supplierDoc.$id,
      data: {
        nom: supplier.trim(),
        contact: contact.trim() || null,
        email: cleanEmail,
        notes: notes.trim() || null
      }
    });

    return {
      ...supplierDoc,
      nom: supplier.trim(),
      email: cleanEmail
    };
  }

  return databases.createDocument({
    databaseId: DATABASE_ID,
    collectionId: COLLECTIONS.suppliers,
    documentId: ID.unique(),
    data: {
      nom: supplier.trim(),
      contact: contact.trim() || null,
      email: cleanEmail,
      telephone: null,
      adresse: null,
      notes: notes.trim() || null
    }
  });
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

  if (!itemSelect || !stockTable) return;

  let itemsCache = [];

  async function render() {
    try {
      itemsCache = await listItems();

      itemSelect.innerHTML = itemsCache.map(item =>
        `<option value="${item.$id}">${escapeHtml(item.itemCode)} — ${escapeHtml(item.itemName)}</option>`
      ).join('');

      stockTable.innerHTML = itemsCache.map(item => {
        const status = getStatus(item);

        return `<tr>
          <td>${escapeHtml(item.itemCode)}</td>
          <td>${escapeHtml(item.itemName)}</td>
          <td><strong>${Number(item.stockQuantity || 0)}</strong></td>
          <td>${Number(item.alertThreshold || 0)}</td>
          <td>${escapeHtml(item.supplierName || '')}</td>
          <td><a href="mailto:${escapeHtml(item.Email || '')}">${escapeHtml(item.Email || '')}</a></td>
          <td><span class="status ${status.className}">${status.label}</span></td>
        </tr>`;
      }).join('');

      const lowItems = itemsCache.filter(item =>
        Number(item.stockQuantity) <= Number(item.alertThreshold)
      );

      alertsList.innerHTML = lowItems.length
        ? lowItems.map(item => `<div class="alert">
            <strong>${escapeHtml(item.itemName)}</strong><br />
            Quantité actuelle : ${Number(item.stockQuantity || 0)} / seuil : ${Number(item.alertThreshold || 0)}<br />
            Fournisseur : ${escapeHtml(item.supplierName || '-')} — ${escapeHtml(item.Email || '-')}<br />
            <a class="btn warning" href="${mailtoFor(item)}">Envoyer une demande de devis</a>
          </div>`).join('')
        : '<p>Aucune alerte : tous les consommables sont au-dessus du seuil.</p>';

    } catch (error) {
      console.error(error);
      alertsList.innerHTML = '<p>Erreur Appwrite : impossible de charger le stock. Vérifie Endpoint, Project ID, Database ID et permissions.</p>';
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    message.textContent = '';

    const id = itemSelect.value;
    const type = document.querySelector('#movementType').value;
    const qty = Number(document.querySelector('#movementQty').value);
    const item = itemsCache.find(article => article.$id === id);

    if (!item || qty <= 0) return;

    const oldQuantity = Number(item.stockQuantity || 0);

    if (type === 'out' && qty > oldQuantity) {
      message.textContent = 'Quantité insuffisante pour cette sortie.';
      message.style.color = '#dc2626';
      return;
    }

    const newQuantity = type === 'in'
      ? oldQuantity + qty
      : oldQuantity - qty;

    try {
      await databases.updateDocument({
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.items,
        documentId: item.$id,
        data: {
          stockQuantity: newQuantity
        }
      });

      await databases.createDocument({
        databaseId: DATABASE_ID,
        collectionId: COLLECTIONS.movements,
        documentId: ID.unique(),
        data: {
          itemId: item.$id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          movementType: type === 'in' ? 'ENTREE' : 'SORTIE',
          quantity: qty,
          oldQuantity,
          newQuantity,
          date: new Date().toISOString(),
          comment: '',
          user: 'Utilisateur web'
        }
      });

      message.style.color = '#0f766e';
      message.textContent = 'Stock mis à jour avec succès dans Appwrite.';

      form.reset();
      await render();

    } catch (error) {
      console.error(error);
      message.style.color = '#dc2626';
      message.textContent = `Erreur Appwrite : ${error.message}`;
    }
  });

  prepareAlertsBtn.addEventListener('click', () => {
    const firstLow = itemsCache.find(item =>
      Number(item.stockQuantity) <= Number(item.alertThreshold)
    );

    if (!firstLow) {
      alert('Aucune alerte à envoyer.');
      return;
    }

    window.location.href = mailtoFor(firstLow);
  });

  exportBtn.addEventListener('click', () => {
    const rows = itemsCache.map(item => [
      item.supplierName,
      item.Email,
      item.itemCode,
      item.itemName,
      item.unitPrice,
      item.stockQuantity,
      item.alertThreshold,
      item.category,
      item.expirationDate || ''
    ]);

    const header = [
      'Fournisseur',
      'Email',
      'Référence',
      'Désignation',
      'Prix',
      'Quantité',
      'Seuil',
      'Catégorie',
      'Expiration'
    ];

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

  render();
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

  async function fillForm(item) {
    document.querySelector('#formTitle').textContent = 'Modifier un consommable';
    document.querySelector('#itemId').value = item.$id;
    document.querySelector('#supplier').value = item.supplierName || '';
    document.querySelector('#contact').value = '';
    document.querySelector('#email').value = item.Email || '';
    document.querySelector('#reference').value = item.itemCode || '';
    document.querySelector('#designation').value = item.itemName || '';
    document.querySelector('#price').value = item.unitPrice || 0;
    document.querySelector('#quantity').value = item.stockQuantity || 0;
    document.querySelector('#threshold').value = item.alertThreshold || 0;
    document.querySelector('#notes').value = '';

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  function clearForm() {
    form.reset();
    document.querySelector('#itemId').value = '';
    document.querySelector('#formTitle').textContent = 'Ajouter un consommable';
  }

  async function render() {
    try {
      const term = (searchInput.value || '').toLowerCase();
      itemsCache = await listItems();

      const filteredItems = itemsCache.filter(item =>
        String(item.itemCode || '').toLowerCase().includes(term) ||
        String(item.itemName || '').toLowerCase().includes(term) ||
        String(item.supplierName || '').toLowerCase().includes(term)
      );

      table.innerHTML = filteredItems.map(item => `<tr>
        <td>${escapeHtml(item.supplierName || '')}<br><small>${escapeHtml(item.Email || '')}</small></td>
        <td>${escapeHtml(item.itemCode || '')}</td>
        <td>${escapeHtml(item.itemName || '')}</td>
        <td>${euro(item.unitPrice)}</td>
        <td><strong>${Number(item.stockQuantity || 0)}</strong></td>
        <td>${Number(item.alertThreshold || 0)}</td>
        <td class="row-actions">
          <button class="btn secondary" data-edit="${item.$id}">Modifier</button>
          <button class="btn danger" data-delete="${item.$id}">Supprimer</button>
        </td>
      </tr>`).join('');

    } catch (error) {
      console.error(error);
      table.innerHTML = `<tr><td colspan="7">Erreur Appwrite : ${escapeHtml(error.message)}</td></tr>`;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    message.textContent = '';

    const documentId = document.querySelector('#itemId').value;
    const supplierName = document.querySelector('#supplier').value.trim();
    const contact = document.querySelector('#contact').value.trim();
    const email = document.querySelector('#email').value.trim();
    const notes = document.querySelector('#notes').value.trim();

    try {
      const supplierDoc = await findOrCreateSupplier({
        supplier: supplierName,
        contact,
        email,
        notes
      });

      const data = {
        itemName: document.querySelector('#designation').value.trim(),
        itemCode: document.querySelector('#reference').value.trim(),
        category: DEFAULT_CATEGORY,
        stockQuantity: Number(document.querySelector('#quantity').value),
        unitPrice: Number(document.querySelector('#price').value),
        expirationDate: null,
        alertThreshold: Number(document.querySelector('#threshold').value),
        supplierId: supplierDoc.$id,
        supplierName,
        Email: email
      };

      if (documentId) {
        await databases.updateDocument({
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.items,
          documentId,
          data
        });
      } else {
        await databases.createDocument({
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.items,
          documentId: ID.unique(),
          data
        });
      }

      message.style.color = '#0f766e';
      message.textContent = 'Consommable enregistré avec succès dans Appwrite.';

      clearForm();
      await render();

    } catch (error) {
      console.error(error);
      message.style.color = '#dc2626';
      message.textContent = `Erreur Appwrite : ${error.message}`;
    }
  });

  table.addEventListener('click', async event => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;

    if (editId) {
      const item = itemsCache.find(article => article.$id === editId);
      if (item) fillForm(item);
    }

    if (deleteId && confirm('Supprimer ce consommable ?')) {
      try {
        await databases.deleteDocument({
          databaseId: DATABASE_ID,
          collectionId: COLLECTIONS.items,
          documentId: deleteId
        });

        await render();

      } catch (error) {
        alert(`Erreur Appwrite : ${error.message}`);
      }
    }
  });

  resetBtn.addEventListener('click', clearForm);
  searchInput.addEventListener('input', render);

  render();
}

initStockPage();
initGestionPage();
