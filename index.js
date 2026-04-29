const STORAGE_KEY = 'biostock_items_v1';

const seedItems = [
  {
    id: crypto.randomUUID(),
    supplier: 'MedSupply',
    contact: 'Service commercial',
    email: 'devis@medsup.example',
    reference: 'GNT-M-100',
    designation: 'Gants nitrile taille M - boîte de 100',
    price: 8.5,
    quantity: 24,
    threshold: 10,
    notes: 'Livraison 72h'
  },
  {
    id: crypto.randomUUID(),
    supplier: 'BioClean',
    contact: 'Mme Martin',
    email: 'contact@bioclean.example',
    reference: 'DSF-500',
    designation: 'Désinfectant surface 500 ml',
    price: 4.9,
    quantity: 6,
    threshold: 8,
    notes: 'Demander conditionnement par carton'
  }
];

function getItems() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seedItems));
    return seedItems;
  }
  return JSON.parse(saved);
}

function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function euro(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

function getStatus(item) {
  if (Number(item.quantity) <= 0) return { label: 'Rupture', className: 'out' };
  if (Number(item.quantity) <= Number(item.threshold)) return { label: 'Stock bas', className: 'low' };
  return { label: 'OK', className: 'ok' };
}

function mailtoFor(item) {
  const subject = encodeURIComponent(`Demande de devis - ${item.designation} (${item.reference})`);
  const body = encodeURIComponent(
`Bonjour,

Nous souhaitons recevoir un devis pour le consommable suivant :

Référence : ${item.reference}
Désignation : ${item.designation}
Quantité actuelle : ${item.quantity}
Seuil d’alerte : ${item.threshold}
Prix connu : ${euro(item.price)}
Contact fournisseur : ${item.contact || '-'}
Notes : ${item.notes || '-'}

Merci de nous transmettre votre meilleure offre, délai de livraison et conditionnement.

Cordialement.`);
  return `mailto:${item.email}?subject=${subject}&body=${body}`;
}

function initStockPage() {
  const itemSelect = document.querySelector('#itemSelect');
  const stockTable = document.querySelector('#stockTable');
  const alertsList = document.querySelector('#alertsList');
  const form = document.querySelector('#movementForm');
  const message = document.querySelector('#movementMessage');
  const exportBtn = document.querySelector('#exportBtn');
  const prepareAlertsBtn = document.querySelector('#prepareAlertsBtn');
  if (!itemSelect || !stockTable) return;

  function render() {
    const items = getItems();
    itemSelect.innerHTML = items.map(item => `<option value="${item.id}">${item.reference} — ${item.designation}</option>`).join('');

    stockTable.innerHTML = items.map(item => {
      const status = getStatus(item);
      return `<tr>
        <td>${item.reference}</td>
        <td>${item.designation}</td>
        <td><strong>${item.quantity}</strong></td>
        <td>${item.threshold}</td>
        <td>${item.supplier}</td>
        <td><a href="mailto:${item.email}">${item.email}</a></td>
        <td><span class="status ${status.className}">${status.label}</span></td>
      </tr>`;
    }).join('');

    const lowItems = items.filter(item => Number(item.quantity) <= Number(item.threshold));
    alertsList.innerHTML = lowItems.length
      ? lowItems.map(item => `<div class="alert">
          <strong>${item.designation}</strong><br />
          Quantité actuelle : ${item.quantity} / seuil : ${item.threshold}<br />
          Fournisseur : ${item.supplier} — ${item.contact || 'Contact non renseigné'} — ${item.email}<br />
          <a class="btn warning" href="${mailtoFor(item)}">Envoyer une demande de devis</a>
        </div>`).join('')
      : '<p>Aucune alerte : tous les consommables sont au-dessus du seuil.</p>';
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const id = itemSelect.value;
    const type = document.querySelector('#movementType').value;
    const qty = Number(document.querySelector('#movementQty').value);
    const items = getItems();
    const item = items.find(article => article.id === id);
    if (!item || qty <= 0) return;

    if (type === 'out' && qty > Number(item.quantity)) {
      message.textContent = 'Quantité insuffisante pour cette sortie.';
      message.style.color = '#dc2626';
      return;
    }

    item.quantity = type === 'in' ? Number(item.quantity) + qty : Number(item.quantity) - qty;
    saveItems(items);
    message.style.color = '#0f766e';
    message.textContent = 'Stock mis à jour avec succès.';
    form.reset();
    render();
  });

  prepareAlertsBtn.addEventListener('click', () => {
    const firstLow = getItems().find(item => Number(item.quantity) <= Number(item.threshold));
    if (!firstLow) {
      alert('Aucune alerte à envoyer.');
      return;
    }
    window.location.href = mailtoFor(firstLow);
  });

  exportBtn.addEventListener('click', () => {
    const rows = getItems().map(item => [item.supplier, item.contact, item.email, item.reference, item.designation, item.price, item.quantity, item.threshold, item.notes]);
    const header = ['Fournisseur', 'Contact', 'Email', 'Référence', 'Désignation', 'Prix', 'Quantité', 'Seuil', 'Notes'];
    const csv = [header, ...rows].map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'stock-biomedical.csv';
    link.click();
  });

  render();
}

function initGestionPage() {
  const form = document.querySelector('#itemForm');
  const table = document.querySelector('#itemsTable');
  const message = document.querySelector('#formMessage');
  const resetBtn = document.querySelector('#resetBtn');
  const searchInput = document.querySelector('#searchInput');
  if (!form || !table) return;

  function fillForm(item) {
    document.querySelector('#formTitle').textContent = 'Modifier un consommable';
    document.querySelector('#itemId').value = item.id;
    document.querySelector('#supplier').value = item.supplier;
    document.querySelector('#contact').value = item.contact || '';
    document.querySelector('#email').value = item.email;
    document.querySelector('#reference').value = item.reference;
    document.querySelector('#designation').value = item.designation;
    document.querySelector('#price').value = item.price;
    document.querySelector('#quantity').value = item.quantity;
    document.querySelector('#threshold').value = item.threshold;
    document.querySelector('#notes').value = item.notes || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearForm() {
    form.reset();
    document.querySelector('#itemId').value = '';
    document.querySelector('#formTitle').textContent = 'Ajouter un consommable';
  }

  function render() {
    const term = (searchInput.value || '').toLowerCase();
    const items = getItems().filter(item =>
      item.reference.toLowerCase().includes(term) ||
      item.designation.toLowerCase().includes(term) ||
      item.supplier.toLowerCase().includes(term)
    );
    table.innerHTML = items.map(item => `<tr>
      <td>${item.supplier}<br><small>${item.email}</small></td>
      <td>${item.reference}</td>
      <td>${item.designation}</td>
      <td>${euro(item.price)}</td>
      <td><strong>${item.quantity}</strong></td>
      <td>${item.threshold}</td>
      <td class="row-actions">
        <button class="btn secondary" data-edit="${item.id}">Modifier</button>
        <button class="btn danger" data-delete="${item.id}">Supprimer</button>
      </td>
    </tr>`).join('');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const id = document.querySelector('#itemId').value || crypto.randomUUID();
    const newItem = {
      id,
      supplier: document.querySelector('#supplier').value.trim(),
      contact: document.querySelector('#contact').value.trim(),
      email: document.querySelector('#email').value.trim(),
      reference: document.querySelector('#reference').value.trim(),
      designation: document.querySelector('#designation').value.trim(),
      price: Number(document.querySelector('#price').value),
      quantity: Number(document.querySelector('#quantity').value),
      threshold: Number(document.querySelector('#threshold').value),
      notes: document.querySelector('#notes').value.trim()
    };

    const items = getItems();
    const index = items.findIndex(item => item.id === id);
    if (index >= 0) items[index] = newItem;
    else items.push(newItem);
    saveItems(items);
    message.textContent = 'Consommable enregistré avec succès.';
    clearForm();
    render();
  });

  table.addEventListener('click', event => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    const items = getItems();
    if (editId) {
      const item = items.find(article => article.id === editId);
      if (item) fillForm(item);
    }
    if (deleteId && confirm('Supprimer ce consommable ?')) {
      saveItems(items.filter(article => article.id !== deleteId));
      render();
    }
  });

  resetBtn.addEventListener('click', clearForm);
  searchInput.addEventListener('input', render);
  render();
}

initStockPage();
initGestionPage();
