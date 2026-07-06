/**
 * iziGSM — Gestion Stock
 * CRUD complet : produits, familles, alertes stock bas, valorisation, import CSV
 * Sprint 2.34 — MOD-04 : familles produits + import catalogue fournisseur CSV
 */

'use strict';

let allStockCache    = [];
let stockUseApi      = true;
let adjustingStockId = null;
let currentFamilleFilter = '';

// Palette couleur par famille
const FAMILLE_CONFIG = {
  piece:       { label: '🔧 Pièce',       badgeClass: 'badge-famille-piece' },
  accessoire:  { label: '🔌 Accessoire',  badgeClass: 'badge-famille-accessoire' },
  appareil:    { label: '📱 Appareil',    badgeClass: 'badge-famille-appareil' },
  consommable: { label: '🧴 Consommable', badgeClass: 'badge-famille-consommable' },
};

// ─── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  buildSidebar('stock');
  initSeedData();
  loadCategories();
  loadStock();
  bindSearch();
  bindFilters();
});

// ─── Chargement catégories (pour les <select>) ─────────────────────────────
async function loadCategories() {
  try {
    const boutiqueId = getBoutiqueId();
    const params = {};
    if (boutiqueId) params.boutique_id = boutiqueId;
    const result = await apiGet('/api/categories', params);
    if (!result.ok) return;
    const cats = result.data?.data || [];

    // Remplir les selects catégorie
    const opts = cats.map(c => `<option value="${c.id}">${escHtml(c.nom)}</option>`).join('');
    const filterCat = document.getElementById('filter-category');
    if (filterCat) filterCat.innerHTML = '<option value="">Toutes catégories</option>' + opts;

    const stockCat = document.getElementById('stock-category');
    if (stockCat) stockCat.innerHTML = '<option value="">— Aucune —</option>' + opts;
  } catch {}
}

// ─── Chargement depuis l'API ───────────────────────────────────────────────
async function loadStock() {
  try {
    const boutiqueId = getBoutiqueId();
    const params = { limit: 200 };
    if (boutiqueId) params.boutique_id = boutiqueId;
    if (currentFamilleFilter) params.famille = currentFamilleFilter;

    const result = await apiGet('/api/produits', params);
    if (!result.ok) throw new Error(result.error || 'Erreur API');

    allStockCache = (result.data?.data || []).map(p => ({
      id:              p.id,
      name:            p.nom            || '—',
      nom:             p.nom            || '',
      reference:       p.sku            || p.reference || '',
      sku:             p.sku            || '',
      famille:         p.famille        || 'piece',
      category:        p.categorie_nom  || '—',
      categorie_id:    p.categorie_id   || null,
      qty:             p.stock_actuel   ?? 0,
      stock_actuel:    p.stock_actuel   ?? 0,
      minQty:          p.stock_minimum  ?? 0,
      stock_minimum:   p.stock_minimum  ?? 0,
      price:           p.prix_vente_ht  ?? 0,
      prix_vente_ht:   p.prix_vente_ht  ?? 0,
      prix_achat_ht:   p.prix_achat_ht  ?? 0,
      marque:          p.marque         || '',
      supplier:        p.fournisseur    || '',
      notes:           p.notes          || '',
      actif:           p.actif          ?? 1,
      createdAt:       p.created_at     || '',
    }));

    setDB('stock', allStockCache);
    stockUseApi = true;

  } catch (err) {
    console.warn('[Stock] API indisponible, fallback localStorage:', err.message);
    allStockCache = getDB('stock');
    stockUseApi = false;
  }

  renderKPIs();
  renderStock();
  renderLowStockAlerts();
}

// ─── KPIs ──────────────────────────────────────────────────────────────────
function renderKPIs() {
  const items = allStockCache.length ? allStockCache : getDB('stock');

  const total    = items.length;
  const lowStock = items.filter(i => parseInt(i.qty) > 0 && parseInt(i.qty) <= parseInt(i.minQty)).length;
  const rupture  = items.filter(i => parseInt(i.qty) === 0).length;
  const valeur   = items.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 0), 0);

  setEl('kpi-refs',       total);
  setEl('kpi-stock-val',  formatMoney(valeur));
  setEl('kpi-alerts',     lowStock + rupture);
}

// ─── Alertes stock bas ──────────────────────────────────────────────────────
function renderLowStockAlerts() {
  const items    = allStockCache.length ? allStockCache : getDB('stock');
  const low      = items.filter(i => parseInt(i.qty) <= parseInt(i.minQty));
  const alertBox = document.getElementById('low-stock-alerts');
  if (!alertBox) return;

  if (!low.length) { alertBox.style.display = 'none'; return; }
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

// ─── Badge famille ───────────────────────────────────────────────────────────
function familleBadge(famille) {
  const cfg = FAMILLE_CONFIG[famille] || { label: famille || '—', badgeClass: 'badge-famille-default' };
  return `<span class="badge ${cfg.badgeClass}" style="font-size:.75rem;">${cfg.label}</span>`;
}

// ─── Rendu principal du tableau ─────────────────────────────────────────────
function renderStock(search = '', categoryFilter = '', statusFilter = 'all') {
  const items = allStockCache.length ? allStockCache : getDB('stock');
  const tbody = document.getElementById('stock-tbody');
  if (!tbody) return;

  let filtered = [...items];

  // Filtre catégorie
  if (categoryFilter) {
    // Peut être un id (depuis select dynamique) ou un nom (legacy)
    filtered = filtered.filter(i =>
      String(i.categorie_id) === categoryFilter || i.category === categoryFilter
    );
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
      (i.name      || '').toLowerCase().includes(q) ||
      (i.reference || '').toLowerCase().includes(q) ||
      (i.marque    || '').toLowerCase().includes(q) ||
      (i.supplier  || '').toLowerCase().includes(q) ||
      (i.category  || '').toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted);">
          <i class="fas fa-boxes" style="font-size:2rem;margin-bottom:8px;display:block;opacity:.3"></i>
          Aucun produit trouvé
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
        <td>${familleBadge(i.famille)}</td>
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
  if (qty === 0)       return { label: 'Rupture',   badgeClass: 'badge-danger',  color: '#e74c3c' };
  if (qty <= minQty)   return { label: 'Stock bas',  badgeClass: 'badge-warning', color: '#f5a623' };
  return                      { label: 'En stock',   badgeClass: 'badge-success', color: '#2ecc71' };
}

// ─── Filtre famille (boutons) ─────────────────────────────────────────────
function filterFamille(btn) {
  document.querySelectorAll('#famille-filters .btn-famille').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFamilleFilter = btn.dataset.f || '';
  loadStock(); // Relance l'API avec le filtre famille
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
  const category = catEl ? catEl.value : '';
  const active   = document.querySelector('[data-filter-stock].active');
  const status   = active ? active.dataset.filterStock : 'all';
  renderStock(search, category, status);
}

// ─── Modal Nouveau produit / Édition ───────────────────────────────────────
function openNewStock() {
  resetStockForm();
  document.getElementById('modal-stock-title').textContent = 'Nouveau produit';
  document.getElementById('stock-id').value = '';
  loadCategories(); // Refresh catégories
  openModal('modal-stock');
}

function editStock(id) {
  const items = allStockCache.length ? allStockCache : getDB('stock');
  const item  = items.find(x => x.id == id);
  if (!item) return;

  document.getElementById('modal-stock-title').textContent  = 'Modifier le produit';
  document.getElementById('stock-id').value                 = item.id;
  document.getElementById('stock-name').value               = item.name        || '';
  document.getElementById('stock-reference').value          = item.reference   || '';
  document.getElementById('stock-famille').value            = item.famille     || 'piece';
  document.getElementById('stock-marque').value             = item.marque      || '';
  document.getElementById('stock-qty').value                = item.qty         ?? 0;
  document.getElementById('stock-min-qty').value            = item.minQty      ?? 2;
  document.getElementById('stock-price').value              = item.prix_vente_ht ?? '';
  document.getElementById('stock-price-buy').value          = item.prix_achat_ht ?? '';
  document.getElementById('stock-supplier').value           = item.supplier    || '';
  document.getElementById('stock-notes').value              = item.notes       || '';

  // Catégorie
  const catEl = document.getElementById('stock-category');
  if (catEl && item.categorie_id) catEl.value = item.categorie_id;

  loadCategories().then(() => {
    const catEl2 = document.getElementById('stock-category');
    if (catEl2 && item.categorie_id) catEl2.value = item.categorie_id;
  });

  openModal('modal-stock');
}

function resetStockForm() {
  ['stock-name','stock-reference','stock-marque','stock-supplier','stock-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['stock-qty','stock-min-qty','stock-price','stock-price-buy'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id.includes('min') ? '2' : '0';
  });
  const familleEl = document.getElementById('stock-famille');
  if (familleEl) familleEl.value = 'piece';
  const catEl = document.getElementById('stock-category');
  if (catEl) catEl.value = '';
}

async function saveStock() {
  const name = document.getElementById('stock-name').value.trim();
  if (!name) { showFlash('Le nom du produit est obligatoire.', 'error'); return; }

  const id         = document.getElementById('stock-id').value;
  const boutiqueId = getBoutiqueId();
  const famille    = document.getElementById('stock-famille').value || 'piece';
  const catEl      = document.getElementById('stock-category');
  const categorieId = catEl && catEl.value ? parseInt(catEl.value, 10) : undefined;

  const data = {
    nom:                  name,
    sku:                  document.getElementById('stock-reference').value.trim() || undefined,
    famille,
    marque:               document.getElementById('stock-marque').value.trim()   || undefined,
    categorie_id:         categorieId,
    stock_actuel:         parseInt(document.getElementById('stock-qty').value)     || 0,
    stock_minimum:        parseInt(document.getElementById('stock-min-qty').value) || 0,
    prix_vente_ht:        parseFloat(document.getElementById('stock-price').value) || 0,
    prix_achat_ht:        parseFloat(document.getElementById('stock-price-buy').value) || 0,
    fournisseur:          document.getElementById('stock-supplier').value.trim()  || undefined,
    notes:                document.getElementById('stock-notes').value.trim()     || undefined,
    boutique_id:          boutiqueId,
  };

  try {
    if (stockUseApi) {
      let result;
      if (id) {
        result = await apiPut('/api/produits/' + id, data);
      } else {
        result = await apiPost('/api/produits', data);
      }
      if (!result.ok) throw new Error(result.error || 'Erreur API');
      showFlash(id ? 'Produit mis à jour.' : 'Produit ajouté au stock.', 'success');
    } else {
      const legacy = { ...data, name: data.nom, qty: data.stock_actuel, minQty: data.stock_minimum, price: data.prix_vente_ht, supplier: data.fournisseur };
      if (id) { updateInDB('stock', parseInt(id), legacy); showFlash('Produit mis à jour.', 'success'); }
      else    { legacy.createdAt = new Date().toISOString(); addToDB('stock', legacy); showFlash('Produit ajouté.', 'success'); }
    }
    closeModal('modal-stock');
    await loadStock();
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
}

async function deleteStock(id) {
  if (!confirm('Supprimer ce produit du stock ?')) return;
  try {
    if (stockUseApi) {
      const result = await apiDelete('/api/produits/' + id);
      if (!result.ok) throw new Error(result.error || 'Erreur API');
    } else {
      deleteFromDB('stock', id);
    }
    showFlash('Produit supprimé.', 'success');
    await loadStock();
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
}

// ─── Modal Ajustement de stock ──────────────────────────────────────────────
function openAdjustStock(id) {
  adjustingStockId = id;
  const items = allStockCache.length ? allStockCache : getDB('stock');
  const item  = items.find(x => x.id == id);
  if (!item) return;

  document.getElementById('adjust-stock-name').textContent  = item.name;
  document.getElementById('adjust-current-qty').textContent = item.qty;
  document.getElementById('adjust-qty').value               = '';
  document.getElementById('adjust-operation').value         = 'add';
  document.getElementById('adjust-reason').value            = '';
  openModal('modal-adjust-stock');
}

async function confirmAdjustStock() {
  if (!adjustingStockId) return;

  const qty       = parseInt(document.getElementById('adjust-qty').value);
  const operation = document.getElementById('adjust-operation').value;
  const reason    = document.getElementById('adjust-reason')?.value || '';

  if (isNaN(qty) || qty <= 0) { showFlash('Quantité invalide.', 'error'); return; }

  const items = allStockCache.length ? allStockCache : getDB('stock');
  const item  = items.find(x => x.id == adjustingStockId);
  if (!item) return;

  let newQty = parseInt(item.qty) || 0;
  if (operation === 'add')    newQty += qty;
  else if (operation === 'remove') newQty = Math.max(0, newQty - qty);
  else if (operation === 'set')    newQty = qty;

  const typeMap = { add: 'entree', remove: 'sortie', set: 'ajustement' };

  try {
    if (stockUseApi) {
      const result = await apiPost('/api/produits/' + adjustingStockId + '/mouvement', {
        type_mouvement: typeMap[operation] || 'ajustement',
        quantite:       operation === 'set' ? newQty : qty,
        motif:          reason || 'Ajustement manuel',
      });
      if (!result.ok) throw new Error(result.error || 'Erreur API');
    } else {
      updateInDB('stock', adjustingStockId, { qty: newQty });
    }
    showFlash('Stock mis à jour : ' + newQty + ' unité(s).', 'success');
    closeModal('modal-adjust-stock');
    adjustingStockId = null;
    await loadStock();
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
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

// ─── Import CSV catalogue fournisseur ───────────────────────────────────────
let csvFileContent = null;

function openImportCsv() {
  csvFileContent = null;
  const fileInput  = document.getElementById('csv-file-input');
  const preview    = document.getElementById('import-preview');
  const result     = document.getElementById('import-result');
  if (fileInput)  fileInput.value = '';
  if (preview)  { preview.textContent = ''; preview.style.display = 'none'; }
  if (result)   { result.innerHTML = '';   result.style.display  = 'none'; }

  // Listener fichier
  if (fileInput && !fileInput._bound) {
    fileInput._bound = true;
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        csvFileContent = ev.target.result;
        const lines = csvFileContent.split('\n').slice(0, 5).join('\n');
        if (preview) {
          preview.textContent = lines + (csvFileContent.split('\n').length > 5 ? '\n[…]' : '');
          preview.style.display = 'block';
        }
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  openModal('modal-import-csv');
}

async function confirmImportCsv() {
  if (!csvFileContent) { showFlash('Veuillez sélectionner un fichier CSV.', 'error'); return; }

  const boutiqueId = getBoutiqueId();
  const resultEl   = document.getElementById('import-result');
  const btn        = document.getElementById('btn-confirm-import');

  if (btn) { btn.disabled = true; btn.textContent = 'Import en cours…'; }
  if (resultEl) { resultEl.innerHTML = ''; resultEl.style.display = 'none'; }

  try {
    const params = {};
    if (boutiqueId) params.boutique_id = boutiqueId;

    const token = getToken ? getToken() : (localStorage.getItem('auth_token') || '');
    const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    const resp = await fetch('/api/produits/import-csv' + qs, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/csv',
        'Authorization': 'Bearer ' + token,
      },
      body: csvFileContent,
    });

    const data = await resp.json();

    if (resultEl) {
      resultEl.style.display = 'block';
      if (data.success !== false) {
        resultEl.innerHTML = `
          <div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:12px;font-size:.87rem;">
            <strong>✅ Import terminé</strong><br>
            Créés : <strong>${data.imported ?? 0}</strong> &nbsp;|&nbsp;
            Mis à jour : <strong>${data.updated ?? 0}</strong> &nbsp;|&nbsp;
            Ignorés : <strong>${data.skipped ?? 0}</strong>
            ${data.errors?.length ? `<br><details style="margin-top:8px;"><summary>${data.errors.length} erreur(s)</summary><pre style="font-size:.78rem;white-space:pre-wrap">${escHtml(data.errors.join('\n'))}</pre></details>` : ''}
          </div>`;
        showFlash(`Import OK — ${data.imported ?? 0} créés, ${data.updated ?? 0} mis à jour.`, 'success');
        await loadStock();
      } else {
        resultEl.innerHTML = `
          <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:12px;font-size:.87rem;">
            <strong>❌ Erreur</strong> : ${escHtml(data.error || 'Import échoué')}
          </div>`;
        showFlash('Erreur import CSV.', 'error');
      }
    }
  } catch (err) {
    showFlash('Erreur réseau : ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Importer'; }
  }
}

// ─── Export CSV local ────────────────────────────────────────────────────────
function exportStock() {
  const items = allStockCache.length ? allStockCache : getDB('stock');
  const rows  = [
    ['Nom','SKU','Famille','Catégorie','Stock','Min','Prix achat HT','Prix vente HT','Fournisseur'],
    ...items.map(i => [
      i.name        || '',
      i.reference   || '',
      i.famille     || '',
      i.category    || '',
      i.qty         ?? 0,
      i.minQty      ?? 0,
      i.prix_achat_ht ?? 0,
      i.price       ?? 0,
      i.supplier    || '',
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
window.openNewStock        = openNewStock;
window.editStock           = editStock;
window.saveStock           = saveStock;
window.deleteStock         = deleteStock;
window.openAdjustStock     = openAdjustStock;
window.confirmAdjustStock  = confirmAdjustStock;
window.quickRestock        = quickRestock;
window.exportStock         = exportStock;
window.applyFilters        = applyFilters;
window.filterFamille       = filterFamille;
window.openImportCsv       = openImportCsv;
window.confirmImportCsv    = confirmImportCsv;
