/**
 * iziGSM — Gestion Stock
 * CRUD complet : pièces détachées, alertes stock bas, valorisation
 */

'use strict';

// ─── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  buildSidebar('stock');
  initSeedData();
  renderKPIs();
  renderStock();
  bindSearch();
  bindFilters();
  renderLowStockAlerts();
});

// ─── KPIs ──────────────────────────────────────────────────────────────────
function renderKPIs() {
  const items = getDB('stock');

  const total      = items.length;
  const lowStock   = items.filter(i => i.qty <= i.minQty).length;
  const outOfStock = items.filter(i => i.qty === 0).length;
  const valeur     = items.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 0), 0);

  setEl('kpi-total-pieces', total);
  setEl('kpi-low-stock',    lowStock);
  setEl('kpi-out-of-stock', outOfStock);
  setEl('kpi-valeur',       formatMoney(valeur));
}

// ─── Alertes stock bas ──────────────────────────────────────────────────────
function renderLowStockAlerts() {
  const items    = getDB('stock');
  const low      = items.filter(i => parseInt(i.qty) <= parseInt(i.minQty));
  const alertBox = document.getElementById('low-stock-alerts');
  if (!alertBox) return;

  if (!low.length) {
    alertBox.style.display = 'none';
    return;
  }

  alertBox.style.display = 'block';
  const list = document.getElementById('low-stock-list');
  if (list) {
    list.innerHTML = low.map(i => `
      <div class="alert-item">
        <span><i class="fas fa-exclamation-triangle" style="color:var(--warning);margin-right:6px"></i>
          <strong>${escHtml(i.name)}</strong> — Stock: <strong>${i.qty}</strong> / Min: ${i.minQty}
        </span>
        <button class="btn btn-sm btn-outline" onclick="quickRestock(${i.id})">
          <i class="fas fa-plus"></i> Réapprovisionner
        </button>
      </div>
    `).join('');
  }
}

// ─── Rendu principal du tableau ─────────────────────────────────────────────
function renderStock(search = '', categoryFilter = 'all', statusFilter = 'all') {
  const items = getDB('stock');
  const tbody = document.getElementById('stock-tbody');
  const counter = document.getElementById('stock-count');

  if (!tbody) return;

  let filtered = [...items];

  // Filtre catégorie
  if (categoryFilter !== 'all') {
    filtered = filtered.filter(i => i.category === categoryFilter);
  }

  // Filtre statut stock
  if (statusFilter === 'low') {
    filtered = filtered.filter(i => parseInt(i.qty) > 0 && parseInt(i.qty) <= parseInt(i.minQty));
  } else if (statusFilter === 'out') {
    filtered = filtered.filter(i => parseInt(i.qty) === 0);
  } else if (statusFilter === 'ok') {
    filtered = filtered.filter(i => parseInt(i.qty) > parseInt(i.minQty));
  }

  // Filtre recherche
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(i =>
      (i.name       || '').toLowerCase().includes(q) ||
      (i.reference  || '').toLowerCase().includes(q) ||
      (i.supplier   || '').toLowerCase().includes(q) ||
      (i.category   || '').toLowerCase().includes(q)
    );
  }

  if (counter) counter.textContent = filtered.length + ' pièce' + (filtered.length > 1 ? 's' : '');

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);">
          <i class="fas fa-boxes" style="font-size:2rem;margin-bottom:8px;display:block;opacity:.3"></i>
          Aucune pièce trouvée
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(i => {
    const qty    = parseInt(i.qty)    || 0;
    const minQty = parseInt(i.minQty) || 0;
    const statusInfo = getStockStatus(qty, minQty);
    return `
      <tr class="${qty === 0 ? 'row-danger' : qty <= minQty ? 'row-warning' : ''}">
        <td>
          <div style="font-weight:600">${escHtml(i.name)}</div>
          <div style="font-size:.75rem;color:var(--text-muted)">${escHtml(i.reference || '')}</div>
        </td>
        <td><span class="badge badge-secondary">${escHtml(i.category || '—')}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <strong style="font-size:1.1rem;color:${statusInfo.color}">${qty}</strong>
            <span style="font-size:.75rem;color:var(--text-muted)">/ min. ${minQty}</span>
          </div>
        </td>
        <td><span class="badge ${statusInfo.badgeClass}">${statusInfo.label}</span></td>
        <td>${formatMoney(parseFloat(i.price) || 0)}</td>
        <td>${formatMoney((parseFloat(i.price) || 0) * qty)}</td>
        <td>${escHtml(i.supplier || '—')}</td>
        <td>
          <div class="action-btns">
            <button class="btn-icon" title="Ajuster le stock" onclick="openAdjustStock(${i.id})">
              <i class="fas fa-sliders-h"></i>
            </button>
            <button class="btn-icon" title="Modifier" onclick="editStock(${i.id})">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon btn-icon-danger" title="Supprimer" onclick="deleteStock(${i.id})">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function getStockStatus(qty, minQty) {
  if (qty === 0) return { label: 'Rupture', badgeClass: 'badge-danger', color: '#e74c3c' };
  if (qty <= minQty) return { label: 'Stock bas', badgeClass: 'badge-warning', color: '#f5a623' };
  return { label: 'En stock', badgeClass: 'badge-success', color: '#2ecc71' };
}

// ─── Recherche & filtres ────────────────────────────────────────────────────
function bindSearch() {
  const input = document.getElementById('search-stock');
  if (!input) return;
  input.addEventListener('input', () => applyFilters());
}

function bindFilters() {
  document.querySelectorAll('[data-filter-stock]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-stock]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  const catSelect = document.getElementById('filter-category');
  if (catSelect) catSelect.addEventListener('change', () => applyFilters());
}

function applyFilters() {
  const search   = (document.getElementById('search-stock') || {}).value || '';
  const catEl    = document.getElementById('filter-category');
  const category = catEl ? catEl.value : 'all';
  const active   = document.querySelector('[data-filter-stock].active');
  const status   = active ? active.dataset.filterStock : 'all';
  renderStock(search, category, status);
}

// ─── Modal Nouvelle pièce / Édition ────────────────────────────────────────
function openNewStock() {
  resetStockForm();
  document.getElementById('modal-stock-title').textContent = 'Nouvelle pièce';
  document.getElementById('stock-id').value = '';
  openModal('modal-stock');
}

function editStock(id) {
  const items = getDB('stock');
  const item  = items.find(x => x.id == id);
  if (!item) return;

  document.getElementById('modal-stock-title').textContent = 'Modifier la pièce';
  document.getElementById('stock-id').value         = item.id;
  document.getElementById('stock-name').value       = item.name       || '';
  document.getElementById('stock-reference').value  = item.reference  || '';
  document.getElementById('stock-category').value   = item.category   || '';
  document.getElementById('stock-qty').value        = item.qty        ?? 0;
  document.getElementById('stock-min-qty').value    = item.minQty     ?? 5;
  document.getElementById('stock-price').value      = item.price      ?? '';
  document.getElementById('stock-supplier').value   = item.supplier   || '';
  document.getElementById('stock-location').value   = item.location   || '';
  document.getElementById('stock-notes').value      = item.notes      || '';
  openModal('modal-stock');
}

function resetStockForm() {
  ['stock-name','stock-reference','stock-category','stock-qty','stock-min-qty',
   'stock-price','stock-supplier','stock-location','stock-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id.includes('qty') || id.includes('price') ? '0' : '';
  });
  const minEl = document.getElementById('stock-min-qty');
  if (minEl) minEl.value = '5';
}

function saveStock() {
  const name = document.getElementById('stock-name').value.trim();
  if (!name) { showFlash('Le nom de la pièce est obligatoire.', 'error'); return; }

  const qty    = parseInt(document.getElementById('stock-qty').value)     || 0;
  const minQty = parseInt(document.getElementById('stock-min-qty').value) || 0;
  const price  = parseFloat(document.getElementById('stock-price').value) || 0;

  const id = document.getElementById('stock-id').value;

  const data = {
    name,
    reference : document.getElementById('stock-reference').value.trim(),
    category  : document.getElementById('stock-category').value,
    qty,
    minQty,
    price,
    supplier  : document.getElementById('stock-supplier').value.trim(),
    location  : document.getElementById('stock-location').value.trim(),
    notes     : document.getElementById('stock-notes').value.trim(),
  };

  if (id) {
    updateInDB('stock', parseInt(id), data);
    showFlash('Pièce mise à jour.', 'success');
  } else {
    data.createdAt = new Date().toISOString();
    addToDB('stock', data);
    showFlash('Pièce ajoutée au stock.', 'success');
  }

  closeModal('modal-stock');
  renderKPIs();
  renderStock();
  renderLowStockAlerts();
}

function deleteStock(id) {
  if (!confirm('Supprimer cette pièce du stock ?')) return;
  deleteFromDB('stock', id);
  showFlash('Pièce supprimée.', 'success');
  renderKPIs();
  renderStock();
  renderLowStockAlerts();
}

// ─── Modal Ajustement de stock ──────────────────────────────────────────────
let adjustingStockId = null;

function openAdjustStock(id) {
  adjustingStockId = id;
  const items  = getDB('stock');
  const item   = items.find(x => x.id == id);
  if (!item) return;

  document.getElementById('adjust-stock-name').textContent   = item.name;
  document.getElementById('adjust-current-qty').textContent  = item.qty;
  document.getElementById('adjust-qty').value                = '';
  document.getElementById('adjust-operation').value          = 'add';
  document.getElementById('adjust-reason').value             = '';
  openModal('modal-adjust-stock');
}

function confirmAdjustStock() {
  if (!adjustingStockId) return;

  const qty       = parseInt(document.getElementById('adjust-qty').value);
  const operation = document.getElementById('adjust-operation').value;

  if (isNaN(qty) || qty <= 0) { showFlash('Quantité invalide.', 'error'); return; }

  const items = getDB('stock');
  const item  = items.find(x => x.id == adjustingStockId);
  if (!item) return;

  let newQty = parseInt(item.qty) || 0;
  if (operation === 'add') newQty += qty;
  else if (operation === 'remove') {
    newQty = Math.max(0, newQty - qty);
  } else if (operation === 'set') {
    newQty = qty;
  }

  updateInDB('stock', adjustingStockId, { qty: newQty });
  showFlash(`Stock mis à jour : ${newQty} unité(s).`, 'success');

  closeModal('modal-adjust-stock');
  adjustingStockId = null;
  renderKPIs();
  renderStock();
  renderLowStockAlerts();
}

// ─── Réapprovisionnement rapide ─────────────────────────────────────────────
function quickRestock(id) {
  openAdjustStock(id);
  setTimeout(() => {
    const el = document.getElementById('adjust-operation');
    if (el) el.value = 'add';
    const qtyEl = document.getElementById('adjust-qty');
    if (qtyEl) qtyEl.focus();
  }, 100);
}

// ─── Export CSV ─────────────────────────────────────────────────────────────
function exportStock() {
  const items = getDB('stock');
  const rows  = [
    ['Nom','Référence','Catégorie','Quantité','Stock min','Prix HT','Fournisseur','Emplacement'],
    ...items.map(i => [
      i.name       || '',
      i.reference  || '',
      i.category   || '',
      i.qty        ?? 0,
      i.minQty     ?? 0,
      i.price      ?? 0,
      i.supplier   || '',
      i.location   || ''
    ])
  ];

  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'stock_izigsm.csv';
  a.click();
  URL.revokeObjectURL(url);
  showFlash('Export CSV téléchargé.', 'success');
}

// ─── Utilitaires ────────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─── Exposer globalement ────────────────────────────────────────────────────
window.openNewStock       = openNewStock;
window.editStock          = editStock;
window.saveStock          = saveStock;
window.deleteStock        = deleteStock;
window.openAdjustStock    = openAdjustStock;
window.confirmAdjustStock = confirmAdjustStock;
window.quickRestock       = quickRestock;
window.exportStock        = exportStock;
window.applyFilters       = applyFilters;
