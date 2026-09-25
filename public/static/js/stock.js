/**
 * iziGSM — Gestion Stock
 * CRUD complet : produits, familles, produits à commander, valorisation, import CSV
 * Sprint 2.34 — MOD-04 : familles produits + import catalogue fournisseur CSV
 */

'use strict';

let allStockCache    = [];
let stockUseApi      = true;
let adjustingStockId = null;
let currentFamilleFilter = '';
// Seuil d'alerte par défaut effectif de la boutique (0 = non surveillé tant que rien n'est
// réglé), chargé par chargerDefautsStock() — pré-remplit le formulaire de création. `null` tant
// qu'il n'est pas lu : le champ reste alors vide, et un seuil vide n'est pas envoyé — c'est le
// serveur qui applique le réglage, jamais un 0 pris par défaut côté page.
let seuilAlerteDefaut = null;
// Stock initial par défaut effectif (ticket 05) : pré-remplit « Qté en rayon » de la recherche
// fournisseur. `null` tant qu'il n'est pas lu — champ vide, non envoyé, le serveur applique le réglage.
let stockInitialDefaut = null;
// Liste restreinte à une fiche fournisseur (`/stock?fournisseur_id=3`) — lien du bilan de l'import
// par génération (ticket 03). Filtré par le serveur : la liste n'en charge que 200.
const fournisseurFiltre = (() => {
  const n = Number(new URLSearchParams(location.search).get('fournisseur_id'));
  return Number.isInteger(n) && n > 0 ? n : null;
})();

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
  chargerDefautsStock();
  bindSearch();
  bindFilters();
  document.getElementById('filtre-fournisseur').hidden = !fournisseurFiltre;
});

// ─── Seuil d'alerte par défaut de la boutique (ticket 03 réglages de stock) ──
/**
 * Lit le seuil d'alerte par défaut dans les réglages de la boutique consultée : il pré-remplit
 * le formulaire de création. Tant qu'il n'a jamais été enregistré (`null`, distinct d'un 0
 * choisi), affiche le rappel menant à Réglages › Stock — pour les seuls rôles qui peuvent le
 * régler. Lecture en échec : seuil 0 et aucun rappel, plutôt qu'un rappel peut-être faux.
 */
async function chargerDefautsStock() {
  try {
    const boutiqueId = getBoutiqueId();
    if (!boutiqueId) return;
    // Enveloppe apiGet : le corps JSON est dans `.data` (CLAUDE.md § Enveloppe des réponses API)
    const res = (await apiGet('/api/boutiques/' + boutiqueId)).data;
    if (!res?.success) return;
    const seuil = res.data?.settings?.stock_seuil_defaut ?? null;
    seuilAlerteDefaut = seuil ?? 0;
    stockInitialDefaut = res.data?.settings?.stock_initial_defaut ?? 0;
    const peutRegler = ['admin', 'manager'].includes(sessionCourante()?.role);
    document.getElementById('rappel-seuil-defaut').hidden = !(seuil === null && peutRegler);
  } catch (err) {
    console.warn('[stock] seuil d\'alerte par défaut illisible — formulaire à 0, aucun rappel', err);
  }
}

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
    // Pages de 100 : le serveur plafonne toute page à 100 produits (`lib/db.ts`). N'en charger qu'une
    // rendait invisibles tous les suivants — recherche, filtres et compteurs compris (vécu en
    // production le 2026-09-15 : 100 produits affichés sur 795, les écrans iPhone introuvables).
    const params = { limit: 100 };
    if (boutiqueId) params.boutique_id = boutiqueId;
    if (currentFamilleFilter) params.famille = currentFamilleFilter;
    if (fournisseurFiltre) params.fournisseur_id = fournisseurFiltre;

    // Toutes les pages, jusqu'à la dernière annoncée par le serveur (pagination absente → une seule)
    const produits = [];
    for (let page = 1; ; page++) {
      const result = await apiGet('/api/produits', { ...params, page });
      if (!result.ok) throw new Error(result.error || 'Erreur API');
      // Déballage : `data` est le corps JSON complet (CLAUDE.md § enveloppe)
      produits.push(...(result.data?.data || []));
      if (page >= (Number(result.data?.pagination?.pages) || 1)) break;
    }

    allStockCache = produits.map(p => ({
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
      // « Notes » de la fiche = colonne `description` (aucune colonne `notes` n'existe)
      notes:           p.description    || '',
      reference_fournisseur: p.reference_fournisseur || '',
      fournisseur_id:  p.fournisseur_id ?? null,
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

  // Filtres de l'écran réappliqués (recherche, catégorie, stock) — les compteurs avec, par renderStock() : `renderStock()` sans argument
  // réaffichait toute la liste par-dessus la recherche, à la fin de chaque chargement — ouverture de
  // la page (8 pages chez l'exploitant, le temps de taper) et clic sur une famille (vécu le 2026-09-15)
  applyFilters();
  renderLowStockAlerts();
}

// ─── KPIs ──────────────────────────────────────────────────────────────────
/**
 * Compteurs « Références », « Valeur stock », « À commander » de la liste AFFICHÉE — recherche,
 * catégorie, famille et filtre de stock compris (décision de l'exploitant du 2026-09-15, option B :
 * « iphone 12 » doit compter les iPhone 12, pas toute la famille). Appelé par renderStock() seul.
 * @param items Produits affichés, déjà filtrés
 */
function renderKPIs(items) {

  const total    = items.length;
  // « À commander » (CONTEXT.md) : produits surveillés sous leur seuil, rupture comprise — même
  // règle que le serveur (sqlSousSeuil). Ne compte plus les ruptures des produits non surveillés.
  const aCommander = items.filter(estACommander).length;
  const valeur   = items.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 0), 0);

  setEl('kpi-refs',       total);
  setEl('kpi-stock-val',  formatMoney(valeur));
  setEl('kpi-alerts',     aCommander);
}

/**
 * Règle « à commander » côté page, reflet de `sqlSousSeuil()` (src/lib/stockSeuil.ts) : seuil
 * d'alerte > 0 (produit surveillé) et quantité ≤ seuil. Seuil 0 = non surveillé, jamais à commander.
 */
function estACommander(i) {
  return parseInt(i.minQty) > 0 && parseInt(i.qty) <= parseInt(i.minQty);
}

// ─── Produits à commander (code mort : #low-stock-alerts absent de stock.html) ─
function renderLowStockAlerts() {
  const items    = allStockCache.length ? allStockCache : getDB('stock');
  // Même règle que le serveur (src/lib/stockSeuil.ts) : un seuil 0 n'alerte jamais
  const low      = items.filter(i => parseInt(i.minQty) > 0 && parseInt(i.qty) <= parseInt(i.minQty));
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
    // Filtre « À commander » : même règle que l'indicateur, rupture surveillée comprise
    filtered = filtered.filter(estACommander);
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

  // Compteurs = liste affichée, y compris vide (0) — un seul filtrage pour les deux
  renderKPIs(filtered);

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
  // La rupture reste un état affiché à part ; seuil 0 = non surveillé, jamais « à commander »
  if (minQty > 0 && qty <= minQty) return { label: 'À commander', badgeClass: 'badge-warning', color: '#f5a623' };
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
  // Quantité en lecture seule : PUT /produits/:id ignore stock_actuel, le stock ne bouge que par
  // un mouvement tracé (décision du 2026-09-12) — la saisie était perdue sans message
  document.getElementById('stock-qty').readOnly             = true;
  document.getElementById('btn-stock-ajuster').style.display = '';
  document.getElementById('stock-min-qty').value            = item.minQty      ?? 2;
  document.getElementById('stock-price').value              = item.prix_vente_ht ?? '';
  document.getElementById('stock-price-buy').value          = item.prix_achat_ht ?? '';
  document.getElementById('stock-supplier').value           = item.supplier    || '';
  document.getElementById('stock-notes').value              = item.notes       || '';
  // Pièce importée de Mobilax : sa référence chez le grossiste, en lecture seule (textContent)
  const refMobilax = document.getElementById('stock-ref-mobilax');
  if (refMobilax) {
    refMobilax.textContent = item.reference_fournisseur ? `Réf. ${item.supplier || 'fournisseur'} : ${item.reference_fournisseur}` : '';
    refMobilax.hidden = !item.reference_fournisseur;
  }

  // Catégorie
  const catEl = document.getElementById('stock-category');
  if (catEl && item.categorie_id) catEl.value = item.categorie_id;

  loadCategories().then(() => {
    const catEl2 = document.getElementById('stock-category');
    if (catEl2 && item.categorie_id) catEl2.value = item.categorie_id;
  });

  // Une offre d'ajout ne vaut que pour la fiche ouverte juste après l'import qui l'a faite
  masquerAjoutImport();
  openModal('modal-stock');
}

function resetStockForm() {
  ['stock-name','stock-reference','stock-marque','stock-supplier','stock-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['stock-qty','stock-min-qty','stock-price','stock-price-buy'].forEach(id => {
    const el = document.getElementById(id);
    // Seuil : réglage de la boutique ; quantité et prix : 0 (jamais de pièces par mégarde)
    if (el) el.value = id.includes('min') ? (seuilAlerteDefaut === null ? '' : String(seuilAlerteDefaut)) : '0';
  });
  const familleEl = document.getElementById('stock-famille');
  if (familleEl) familleEl.value = 'piece';
  const catEl = document.getElementById('stock-category');
  if (catEl) catEl.value = '';
  // Création : la quantité initiale se saisit (POST /produits trace le mouvement d'entrée)
  const qtyEl = document.getElementById('stock-qty');
  if (qtyEl) qtyEl.readOnly = false;
  const btnAjuster = document.getElementById('btn-stock-ajuster');
  if (btnAjuster) btnAjuster.style.display = 'none';
  masquerAjoutImport();
}

/**
 * Offre « Ajouter N au stock » en cours (ticket 18) : `{ produitId, quantite }`, ou `null`.
 * Posée par un import unitaire qui a trouvé la pièce déjà en stock avec une quantité saisie ;
 * consommée par UN clic — le serveur n'ajoute jamais rien sans lui (règle du 2026-09-12).
 */
let ajoutImportEnAttente = null;

/** Referme la zone d'offre de la fiche produit. */
function masquerAjoutImport() {
  ajoutImportEnAttente = null;
  const zone = document.getElementById('stock-ajout-import');
  if (zone) zone.hidden = true;
}

/**
 * Affiche l'offre dans la fiche du produit déjà en stock, à côté du message d'import.
 * L'offre porte sa clé d'ajout, tirée ICI une fois pour toutes : chaque nouvel essai de la même
 * offre la renvoie, et le serveur ne l'applique qu'une fois (migration 0051, point 1 de la relecture).
 */
function proposerAjoutImport(produitId, quantite) {
  // AVANT (2026-09-25, point 1 : clé d'ajout tirée par offre) : ajoutImportEnAttente = { produitId, quantite };
  ajoutImportEnAttente = { produitId, quantite, cle: crypto.randomUUID() };
  document.getElementById('stock-ajout-import-texte').textContent =
    `La quantité saisie (${quantite}) n'a pas été ajoutée au stock de cette pièce.`;
  const bouton = document.getElementById('btn-stock-ajout-import');
  bouton.textContent = `Ajouter ${quantite} au stock`;
  bouton.disabled = false;
  document.getElementById('stock-ajout-import-action').hidden = false;
  document.getElementById('stock-ajout-import').hidden = false;
}

/**
 * Clic sur « Ajouter N au stock » : une entrée de stock tracée côté serveur, puis l'ancien et le
 * nouveau stock affichés. L'offre est consommée — le bouton disparaît, un second clic est
 * impossible. Un échec (réseau compris) laisse l'offre en place, message à l'appui.
 * Réessayer est sûr : la même clé part, le serveur rend le premier résultat sans rien rajouter.
 */
async function ajouterAuStockDepuisImport() {
  const offre = ajoutImportEnAttente;
  if (!offre) return;
  const bouton = document.getElementById('btn-stock-ajout-import');
  const texte = document.getElementById('stock-ajout-import-texte');
  bouton.disabled = true;
  try {
    // Déballage au point d'appel : `data` est le corps JSON complet (CLAUDE.md § enveloppe)
    // AVANT (2026-09-25, point 1 : la clé de l'offre accompagne chaque essai) : const res = (await apiPost(`/api/mobilax/produits/${offre.produitId}/ajout-stock`, { quantite: offre.quantite })).data;
    const res = (await apiPost(`/api/mobilax/produits/${offre.produitId}/ajout-stock`, { quantite: offre.quantite, cle: offre.cle })).data;
    if (!res?.success) {
      texte.textContent = res?.error || 'Ajout au stock impossible.';
      // AVANT (2026-09-25, point 1 : un ajout au résultat non confirmé ne se relance pas d'ici) : bouton.disabled = false;
      if (res?.code === 'cle_en_cours') {
        ajoutImportEnAttente = null;
        document.getElementById('stock-ajout-import-action').hidden = true;
        await loadStock();
      } else {
        bouton.disabled = false;
      }
      return;
    }
    ajoutImportEnAttente = null;
    document.getElementById('stock-ajout-import-action').hidden = true;
    texte.textContent = `${offre.quantite} ajouté${offre.quantite > 1 ? 's' : ''} au stock : ${res.data.stock_avant} → ${res.data.stock_apres}.`;
    document.getElementById('stock-qty').value = res.data.stock_apres;
    await loadStock();
  } catch (e) {
    // Réseau coupé : `api()` ne rattrape pas le rejet de `fetch` — l'offre reste, on peut réessayer
    // AVANT (2026-09-25, point 1 : réessayer est désormais sûr, la clé de l'offre repart) : texte.textContent = 'Connexion perdue : l\'ajout n\'a pas pu être vérifié — consultez le stock avant de réessayer.';
    texte.textContent = 'Connexion perdue : l\'ajout n\'a pas pu être confirmé. Vous pouvez réessayer — il ne sera jamais compté deux fois.';
    bouton.disabled = false;
  }
}
document.getElementById('btn-stock-ajout-import')?.addEventListener('click', ajouterAuStockDepuisImport);

/** Depuis la fiche d'un produit : la ferme et ouvre « Ajuster le stock » sur ce produit. */
function ajusterDepuisFiche() {
  const id = document.getElementById('stock-id').value;
  closeModal('modal-stock');
  openAdjustStock(id);
}

async function saveStock() {
  const name = document.getElementById('stock-name').value.trim();
  if (!name) { showFlash('Le nom du produit est obligatoire.', 'error'); return; }

  const id         = document.getElementById('stock-id').value;
  const boutiqueId = getBoutiqueId();
  const famille    = document.getElementById('stock-famille').value || 'piece';
  const catEl      = document.getElementById('stock-category');
  const categorieId = catEl && catEl.value ? parseInt(catEl.value, 10) : undefined;
  // Seuil vide = pas de choix : non envoyé (JSON omet `undefined`). À la création, le serveur
  // applique le seuil par défaut de la boutique ; en modification, le seuil existant est gardé.
  const seuilSaisi = document.getElementById('stock-min-qty').value.trim();

  const data = {
    nom:                  name,
    sku:                  document.getElementById('stock-reference').value.trim() || undefined,
    famille,
    marque:               document.getElementById('stock-marque').value.trim()   || undefined,
    categorie_id:         categorieId,
    stock_actuel:         parseInt(document.getElementById('stock-qty').value)     || 0,
    stock_minimum:        seuilSaisi === '' ? undefined : (parseInt(seuilSaisi, 10) || 0),
    prix_vente_ht:        parseFloat(document.getElementById('stock-price').value) || 0,
    prix_achat_ht:        parseFloat(document.getElementById('stock-price-buy').value) || 0,
    fournisseur:          document.getElementById('stock-supplier').value.trim()  || undefined,
    // Colonne `description` : `notes` n'existe pas, la saisie était perdue (trouvé le 2026-09-11)
    description:          document.getElementById('stock-notes').value.trim()     || undefined,
    boutique_id:          boutiqueId,
  };

  try {
    if (stockUseApi) {
      let result;
      if (id) {
        // stock_actuel non envoyé : le serveur l'ignore, le stock passe par « Ajuster le stock »
        const { stock_actuel, ...modifs } = data;
        result = await apiPut('/api/produits/' + id, modifs);
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

// ─── Recherche et import Mobilax (tickets 03-04, chantier integration-mobilax) ─
// Toute donnée Mobilax est tierce — échappée comme une saisie utilisateur (escHtml), le
// message en textContent. L'import n'envoie que l'identifiant : nom et prix sont relus
// chez Mobilax côté serveur, jamais pris dans ce que l'écran affiche.

function ouvrirRechercheMobilax() {
  // Import par génération en cours : rouvrir la fenêtre sans effacer sa progression
  if (importEnCours) { openModal('modal-mobilax'); return; }
  document.getElementById('mobilax-terme').value = '';
  // Résultats vidés et message d'aide du mode en cours (article ou génération)
  basculerModeMobilax();
  openModal('modal-mobilax');
  document.getElementById('mobilax-terme').focus();
}

/** Message sous le champ de recherche — `erreur` le passe en rouge. */
function messageMobilax(texte, erreur = false) {
  const el = document.getElementById('mobilax-message');
  el.textContent = texte;
  el.style.color = erreur ? '#b42318' : '';
}

// Recherche en cours : le terme reste celui de la recherche lancée, même si le champ change
// entre deux pages. 100 pièces par page, une page = un appel au quota Mobilax (30/min).
let rechercheMobilax = { terme: '', page: 1, pages: 1, fournisseurId: null };
document.getElementById('btn-mobilax-precedente')?.addEventListener('click', () => chercherMobilax(rechercheMobilax.page - 1, true));
document.getElementById('btn-mobilax-suivante')?.addEventListener('click', () => chercherMobilax(rechercheMobilax.page + 1, true));

/**
 * Lance (page 1) ou poursuit (navigation) une recherche Mobilax.
 * @param page             Page voulue, 1 par défaut
 * @param depuisNavigation `true` depuis Précédente/Suivante : garde le terme de la recherche lancée
 */
async function chercherMobilax(page = 1, depuisNavigation = false) {
  const terme  = depuisNavigation ? rechercheMobilax.terme : document.getElementById('mobilax-terme').value.trim();
  const tbody  = document.getElementById('mobilax-resultats');
  const bouton = document.getElementById('btn-mobilax-chercher');
  const pagination = document.getElementById('mobilax-pagination');
  if (terme.length < 2) { messageMobilax('Saisissez au moins 2 caractères.', true); return; }

  tbody.innerHTML = '';
  // Nouvelle recherche = sélection oubliée (story 4) ; Précédente / Suivante la gardent (story 2)
  if (!depuisNavigation) oublierSelection();
  pagination.hidden = true;
  messageMobilax('Recherche en cours chez Mobilax…');
  bouton.disabled = true;
  try {
    // Déballage au point d'appel : `data` est le corps JSON complet (CLAUDE.md § enveloppe)
    const res = (await apiGet(`/api/mobilax/produits?q=${encodeURIComponent(terme)}&page=${page}`)).data;
    // Échec nommé par le serveur (pas de fiche, pas de clé, quota, panne) : son message tel quel
    if (!res?.success) { messageMobilax(res?.error || 'Recherche Mobilax impossible.', true); return; }

    const { produits, total, pages } = res.data;
    // Fiche fournisseur de la boutique : lien du bilan de l'import d'une sélection (ticket 02)
    rechercheMobilax = { terme, page: res.data.page, pages, fournisseurId: res.data.fournisseur_id };
    if (!produits.length) {
      messageMobilax(`Aucune pièce trouvée chez Mobilax pour « ${terme} ».`);
      return;
    }
    messageMobilax(`${total} pièce${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''}.`);
    if (pages > 1) {
      document.getElementById('mobilax-page').textContent = `Page ${rechercheMobilax.page} / ${pages}`;
      document.getElementById('btn-mobilax-precedente').disabled = rechercheMobilax.page <= 1;
      document.getElementById('btn-mobilax-suivante').disabled   = rechercheMobilax.page >= pages;
      pagination.hidden = false;
    }
    // Case, « Qté en rayon » et « Importer » : manager et admin de boutique seulement (story 38 —
    // un geste proposé ne doit pas échouer à coup sûr). Pendant un import, les lignes d'une
    // nouvelle recherche naissent figées (un seul import à la fois, story 33-34).
    const importer = peutImporterMobilax();
    const fige = importEnCours ? ' disabled' : '';
    tbody.innerHTML = produits.map(p => `
      <tr>
        <td>${importer
          ? `<label style="display:flex;align-items:center;gap:8px;margin:0;">
               <input type="checkbox" class="mobilax-case" value="${Number(p.mobilax_id)}"${fige}${
                 selectionMobilax.has(Number(p.mobilax_id)) ? ' checked' : ''}>
               <span class="mobilax-nom">${escHtml(p.nom)}</span></label>`
          : escHtml(p.nom)}</td>
        <td style="font-family:monospace;font-size:.82rem">${escHtml(p.ean13 ?? '—')}</td>
        <td style="text-align:right">${p.prix_achat_ht != null
          ? Number(p.prix_achat_ht).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—'}</td>
        <td style="text-align:right">${Number(p.stock) || 0}</td>
        <td style="text-align:right;white-space:nowrap">${importer ? `
          <input type="number" min="0" step="1" class="mobilax-qte" aria-label="Qté en rayon"
                 value="${escHtml(qteDeLigne(Number(p.mobilax_id)))}"${
                 // Texte illisible retenu : `value` ne peut le rendre, la ligne revient donc EN ERREUR
                 // (même marque que le refus au lancement), jamais comme un champ vide valide
                 selectionMobilax.get(Number(p.mobilax_id))?.illisible
                   ? ' aria-invalid="true" style="width:64px;margin-right:6px;border-color:#b42318"'
                   : ' style="width:64px;margin-right:6px"'}>
          <button type="button" class="btn btn-sm btn-secondary" data-mobilax-id="${Number(p.mobilax_id)}"${fige}>Importer</button>` : ''}
        </td>
      </tr>`).join('');
  } finally {
    bouton.disabled = false;
    // « Tout cocher » suit les lignes affichées (aucune, page de résultats, échec de la recherche)
    majToutCocher();
  }
}

/**
 * Importe une pièce dans le stock avec la « Qté en rayon » de sa ligne (ticket 05), puis ouvre
 * sa fiche pour ajuster le prix de vente. Pièce déjà importée (409 `deja_importe`) : aucun
 * doublon, la fiche existante s'ouvre, et la quantité saisie n'est PAS ajoutée — le message le
 * dit. Après l'import, la quantité ne se règle plus dans la fiche (`updateProduit()` ignore le
 * stock) : elle passe par « Ajuster le stock », qui trace le mouvement.
 */
/** Message du serveur pour une pièce fournisseur déjà importée (même fiche, même référence). */
const MESSAGE_PIECE_DEJA_IMPORTEE = 'Cette pièce est déjà dans votre stock.';

async function importerMobilax(mobilaxId, bouton) {
  // Un seul import à la fois : l'import unitaire fermerait la fenêtre sous l'import en cours
  if (importEnCours) return;
  bouton.disabled = true;
  bouton.textContent = 'Import…';
  // « Qté en rayon » de la ligne (ticket 05) : vide = non envoyée, le serveur applique le stock
  // initial par défaut ; une saisie invalide est refusée par le serveur, message affiché
  const corps = { mobilax_id: mobilaxId };
  const saisie = bouton.closest('tr')?.querySelector('input.mobilax-qte')?.value.trim() ?? '';
  if (saisie !== '') corps.quantite_en_rayon = Number(saisie);
  // Déballage au point d'appel : `data` est le corps JSON complet (CLAUDE.md § enveloppe)
  const res = (await apiPost('/api/mobilax/import', corps)).data;
  const dejaImporte = res?.code === 'deja_importe';
  const produitId = (res?.success || dejaImporte) ? res.data?.produit_id : null;
  if (!produitId) {
    messageMobilax(res?.error || 'Import Mobilax impossible.', true);
    bouton.disabled = false;
    bouton.textContent = 'Importer';
    return;
  }
  // Le message dit ce qui est réellement arrivé à la quantité saisie : entrée en stock, ou —
  // pièce déjà importée — ignorée (le doublon ne touche jamais au stock existant, règle du
  // 2026-09-12 confirmée le 2026-09-17). Un EAN ou un SKU déjà porté (migration 0048) : le
  // serveur nomme le produit trouvé, repris tel quel — une information, jamais un échec.
  const quantite = corps.quantite_en_rayon ?? 0;
  const motif = res?.error && res.error !== MESSAGE_PIECE_DEJA_IMPORTEE
    ? 'Déjà en stock : ' + res.error.charAt(0).toLowerCase() + res.error.slice(1).replace(/\.$/, '')
    : MESSAGE_PIECE_DEJA_IMPORTEE.replace(/\.$/, '');
  showFlash(dejaImporte
    ? `${motif} — voici sa fiche.`
      + (quantite > 0 ? ` La quantité saisie (${quantite}) n'a pas été ajoutée : passez par « Ajuster le stock ».` : '')
    : quantite > 0
      ? `Pièce importée avec ${quantite} en stock — ajustez le prix de vente ici.`
      : 'Pièce importée — ajustez le prix de vente ici, la quantité par « Ajuster le stock ».',
    dejaImporte ? 'info' : 'success');
  await loadStock();
  closeModal('modal-mobilax');
  editStock(produitId);
  // Pièce déjà en stock avec une quantité saisie : l'ajout se propose dans la fiche, il ne se
  // fait jamais tout seul (ticket 18). Après editStock(), qui referme toute offre précédente.
  if (dejaImporte && quantite > 0) proposerAjoutImport(produitId, quantite);
}

// Un seul écouteur pour tous les boutons « Importer » : aucune donnée Mobilax dans un onclick
document.getElementById('mobilax-resultats')?.addEventListener('click', e => {
  const bouton = e.target.closest('button[data-mobilax-id]');
  if (bouton) importerMobilax(Number(bouton.dataset.mobilaxId), bouton);
});

// ─── Import d'une sélection (ticket 02, chantier import-d-une-selection) ──────
// L'opérateur coche des articles de la page affichée ; « Importer la sélection » les passe à la
// boucle commune (importerArticles), chacun avec la « Qté en rayon » de sa ligne. Après l'import,
// importés et déjà en stock sont décochés : échecs et restants restent cochés, prêts à relancer.
// Ticket 03 : sélection tenue par l'écran, gardée d'une page à l'autre ; « Tout cocher » (page
// affichée), « Vider la sélection », confirmation renforcée commune au-delà de 200 articles.

/**
 * Manager ou admin de boutique : seuls rôles autorisés à importer (le serveur garde son propre
 * refus). L'admin plateforme n'atteint jamais les résultats : la recherche le refuse.
 */
function peutImporterMobilax() {
  return ['admin', 'manager'].includes(sessionCourante()?.role);
}

/** Cases des résultats affichés — une par article, pour un manager ou un admin de boutique. */
const SELECTEUR_CASES = '#mobilax-resultats input.mobilax-case';

/**
 * Sélection de la recherche en cours (ticket 03), tenue par l'écran : identifiant fournisseur →
 * `{ nom, saisie, illisible }` — « Qté en rayon » retenue = dernière valeur vue sur la ligne
 * (`illisible` : texte non numérique, que `value` d'un champ nombre rend vide). Gardée d'une page à
 * l'autre, oubliée par une nouvelle recherche, vidée par « Vider la sélection ». Ordre = ordre des
 * coches, qui est celui de l'import.
 */
const selectionMobilax = new Map();
/** Numéro de la recherche en cours : le bilan d'un import sait si sa sélection existe encore. */
let numeroRecherche = 0;

/** Cases des lignes affichées. */
function casesAffichees() {
  return [...document.querySelectorAll(SELECTEUR_CASES)];
}

/** Case d'un article, s'il est sur la page affichée. */
function caseAffichee(id) {
  return document.querySelector(`${SELECTEUR_CASES}[value="${Number(id)}"]`);
}

/** « Qté en rayon » à afficher : la quantité retenue d'un article sélectionné, sinon le stock initial par défaut. */
function qteDeLigne(id) {
  const retenue = selectionMobilax.get(id);
  if (retenue) return retenue.saisie;
  return stockInitialDefaut === null ? '' : String(Number(stockInitialDefaut));
}

/** Retient (case cochée) ou oublie (décochée) l'article d'une ligne, avec la quantité de la ligne. */
function retenirLigne(caseArticle) {
  const id = Number(caseArticle.value);
  if (!caseArticle.checked) { selectionMobilax.delete(id); return; }
  const ligne = caseArticle.closest('tr');
  const champ = ligne.querySelector('input.mobilax-qte');
  selectionMobilax.set(id, {
    nom: ligne.querySelector('.mobilax-nom')?.textContent ?? '',
    saisie: champ?.value.trim() ?? '',
    illisible: Boolean(champ?.validity.badInput),
  });
}

/**
 * Vide la sélection et décoche la page. Une confirmation renforcée ouverte pour elle se referme par
 * la barre (`suivreConfirmation()` : 0 article, sous le seuil) — aucune fermeture en double ici.
 */
function viderSelection() {
  selectionMobilax.clear();
  casesAffichees().forEach(c => { c.checked = false; });
  majAffichageSelection();
}

/** Nouvelle recherche ou changement de mode : la sélection de la recherche précédente est oubliée (story 4). */
function oublierSelection() {
  numeroRecherche++;
  viderSelection();
}

/**
 * Barre de sélection : nombre et durée estimée sur TOUTE la sélection (même règle que l'import par
 * génération), masquée sans coche. Une confirmation renforcée ouverte pour elle suit le compte.
 */
function majBarreSelection() {
  const n = selectionMobilax.size;
  document.getElementById('mobilax-selection').hidden = n === 0;
  document.getElementById('mobilax-selection-texte').textContent =
    `${compter(n, 'sélectionné')} · durée estimée : ${libelleDuree(n)}`;
  document.getElementById('btn-selection-importer').disabled = importEnCours;
  document.getElementById('btn-selection-vider').disabled = importEnCours;
  suivreConfirmation(lancerSelectionConfirmee, n);
}

/** « Tout cocher » reflète la page affichée : coché si toutes ses lignes le sont, mixte si certaines. */
function majToutCocher() {
  const cases = casesAffichees();
  const cochees = cases.filter(c => c.checked).length;
  const tout = document.getElementById('mobilax-tout-cocher');
  document.getElementById('mobilax-tout-cocher-zone').hidden = cases.length === 0;
  tout.checked = cases.length > 0 && cochees === cases.length;
  tout.indeterminate = cochees > 0 && cochees < cases.length;
  tout.disabled = importEnCours;
}

/** Barre de sélection et « Tout cocher » : seuls écrivains de leur état, ils lisent `importEnCours`. */
function majAffichageSelection() { majBarreSelection(); majToutCocher(); }

/**
 * « Importer la sélection » : quantités vérifiées AVANT tout départ, sur toute la sélection (pages
 * non affichées comprises) — une quantité invalide (autre qu'un entier ≥ 0 ou vide) bloque tout et
 * est signalée (story 15). Vide → quantité non envoyée, le serveur applique le stock initial par
 * défaut. Au-delà de SEUIL_CONFIRMATION articles, ouvre d'abord la confirmation renforcée.
 * @param confirme `true` depuis « Lancer l'import » de la confirmation : ne la redemande pas
 */
async function lancerImportSelection(confirme = false) {
  if (importEnCours || selectionMobilax.size === 0) return;
  // Quantités vérifiées sur TOUTE la sélection, pages non affichées comprises : les lignes affichées
  // fautives sont signalées, toutes sont nommées dans le message
  const invalides = [];
  for (const [id, article] of selectionMobilax) {
    const valide = !article.illisible && (article.saisie === '' || /^\d+$/.test(article.saisie));
    const champ = caseAffichee(id)?.closest('tr')?.querySelector('input.mobilax-qte');
    champ?.setAttribute('aria-invalid', valide ? 'false' : 'true');
    if (champ) champ.style.borderColor = valide ? '' : '#b42318';
    if (!valide) invalides.push(article.nom);
  }
  if (invalides.length) {
    messageMobilax(`Qté en rayon invalide pour ${invalides.join(', ')} : saisissez une quantité entière, `
      + 'positive ou nulle, ou laissez vide.', true);
    // « Lancer l'import » refusé : la confirmation ne reste pas ouverte sur un import qui ne part pas
    if (importAConfirmer === lancerSelectionConfirmee) afficherConfirmation(null);
    return;
  }
  // Au-delà du seuil, confirmation renforcée d'abord (story 17) : « Lancer l'import » revient ici
  if (!confirme && selectionMobilax.size > SEUIL_CONFIRMATION) {
    remplirConfirmation(selectionMobilax.size);
    afficherConfirmation(lancerSelectionConfirmee);
    return;
  }
  // Saisie corrigée : un signalement d'une tentative précédente ne doit pas rester à l'écran
  messageMobilax('');
  const articles = [...selectionMobilax].map(([id, a]) =>
    ({ mobilax_id: id, nom: a.nom, ...(a.saisie !== '' ? { quantite: Number(a.saisie) } : {}) }));
  // Une nouvelle recherche pendant l'import oublie la sélection : bilan et décochage le vérifient
  const recherche = numeroRecherche;
  const bilan = await importerArticles(articles, {
    deja: 0,   // « déjà en stock » connu à l'import seulement (`deja_importe`)
    fournisseurId: rechercheMobilax.fournisseurId,
    // Lu au moment du bilan : les restants ne « restent cochés » que si la sélection existe encore
    relance: () => numeroRecherche === recherche
      ? 'ils restent cochés, relancez « Importer la sélection ».'
      : 'relancez la recherche pour les cocher à nouveau.',
  });
  if (!bilan) return;
  // Importés et déjà en stock sortent de la sélection (story 31) ; échecs et restants y restent (story 30)
  if (numeroRecherche === recherche) {
    for (const id of bilan.idsTraites) {
      selectionMobilax.delete(id);
      const caseArticle = caseAffichee(id);
      if (caseArticle) caseArticle.checked = false;
    }
  }
  majAffichageSelection();
  await loadStock();
}

/** « Lancer l'import » de la confirmation renforcée ouverte pour la sélection. */
function lancerSelectionConfirmee() {
  return lancerImportSelection(true);
}

document.getElementById('mobilax-resultats')?.addEventListener('change', e => {
  if (!e.target.matches('input.mobilax-case')) return;
  retenirLigne(e.target);
  majAffichageSelection();
});
document.getElementById('mobilax-resultats')?.addEventListener('input', e => {
  if (!e.target.matches('input.mobilax-qte')) return;
  // Quantité corrigée : le signalement de la ligne disparaît
  e.target.removeAttribute('aria-invalid');
  e.target.style.borderColor = '';
  // Quantité retenue = dernière valeur vue sur la ligne, tant qu'elle est cochée (story 13)
  const caseArticle = e.target.closest('tr')?.querySelector('input.mobilax-case');
  if (caseArticle?.checked) retenirLigne(caseArticle);
});
// « Tout cocher » : lignes de la page affichée seulement (story 6), jamais toute la recherche
document.getElementById('mobilax-tout-cocher')?.addEventListener('change', e => {
  for (const caseArticle of casesAffichees()) {
    if (caseArticle.disabled) continue;
    caseArticle.checked = e.target.checked;
    retenirLigne(caseArticle);
  }
  majAffichageSelection();
});
// Enveloppé : un gestionnaire nu recevrait l'événement comme `confirme`
document.getElementById('btn-selection-importer')?.addEventListener('click', () => lancerImportSelection());
document.getElementById('btn-selection-vider')?.addEventListener('click', viderSelection);

// ─── Mode « Par génération » (ticket 01, chantier import-par-generation) ─────
// L'opérateur tape un nom de base (« iPhone 17 ») : les séries Mobilax de cette génération
// s'affichent, toutes cochées. Aucun import à ce stade — aperçu et boucle d'import viennent
// aux tickets 02-04. Noms de série = donnée tierce, échappés (escHtml).

/** Mode de la fenêtre Mobilax : `'article'` (recherche texte) ou `'generation'`. */
function modeMobilax() {
  return document.querySelector('input[name="mobilax-mode"]:checked')?.value === 'generation' ? 'generation' : 'article';
}

/** Affiche la zone du mode choisi, vide les résultats des deux modes, adapte l'aide de saisie. */
function basculerModeMobilax() {
  const generation = modeMobilax() === 'generation';
  document.getElementById('mobilax-zone-articles').hidden = generation;
  document.getElementById('mobilax-series').hidden = !generation;
  document.getElementById('mobilax-pagination').hidden = true;
  document.getElementById('mobilax-resultats').innerHTML = '';
  // Résultats vidés : la sélection de la recherche affichée est oubliée
  oublierSelection();
  // Import en cours : chercher une pièce par article reste possible (story 14), mais séries,
  // aperçu et zone d'import (commune aux deux modes) sont gardés tels quels
  if (!importEnCours) {
    document.getElementById('mobilax-series-liste').innerHTML = '';
    oublierApercu();
    document.getElementById('mobilax-import').hidden = true;
    document.getElementById('mobilax-bilan').hidden = true;
  }
  document.getElementById('mobilax-terme').placeholder = generation
    ? 'Nom de la génération — ex. iPhone 17, Galaxy S24'
    : 'Nom ou EAN — ex. écran iPhone 12';
  messageMobilax(generation
    ? 'Saisissez le nom d\'une génération : ses séries vous seront proposées.'
    : 'Saisissez le nom d\'une pièce ou son code EAN.');
}
document.querySelectorAll('input[name="mobilax-mode"]').forEach(r => r.addEventListener('change', basculerModeMobilax));

/** Envoi du formulaire de la fenêtre Mobilax : recherche du mode choisi. */
function soumettreRechercheMobilax() {
  if (modeMobilax() !== 'generation') return chercherMobilax();
  // Une nouvelle génération effacerait la progression de l'import en cours
  if (importEnCours) {
    messageMobilax('Un import est en cours : attendez sa fin pour préparer une génération.', true);
    return;
  }
  return chercherGeneration();
}

/** Séries Mobilax de la génération saisie, cochées par défaut ; message clair si aucune. */
async function chercherGeneration() {
  const texte  = document.getElementById('mobilax-terme').value.trim();
  const liste  = document.getElementById('mobilax-series-liste');
  const bouton = document.getElementById('btn-mobilax-chercher');
  if (!texte) { messageMobilax('Saisissez le nom d\'une génération, ex. « iPhone 17 ».', true); return; }

  liste.innerHTML = '';
  oublierApercu();
  messageMobilax('Recherche des séries chez Mobilax…');
  bouton.disabled = true;
  try {
    // Déballage au point d'appel : `data` est le corps JSON complet (CLAUDE.md § enveloppe)
    const res = (await apiGet(`/api/mobilax/series?q=${encodeURIComponent(texte)}`)).data;
    // Échec nommé par le serveur (pas de fournisseur connecté, pas de clé, panne) : son message tel quel
    if (!res?.success) { messageMobilax(res?.error || 'Lecture des séries Mobilax impossible.', true); return; }

    const { series } = res.data;
    if (!series.length) {
      messageMobilax(`Aucune série Mobilax ne s'appelle « ${texte} » ni ne commence par « ${texte} ». `
        + 'Saisissez le nom de base de la génération, ex. « iPhone 17 » ou « Galaxy S24 ».', true);
      return;
    }
    const n = series.length;
    messageMobilax(`${n} série${n > 1 ? 's' : ''} pour « ${texte} », ${n > 1 ? 'toutes cochées' : 'cochée'} — décochez celles que vous ne vendez pas.`);
    liste.innerHTML = series.map(s => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;">
        <input type="checkbox" class="mobilax-serie" value="${Number(s.id)}" checked>
        <span class="mobilax-serie-nom">${escHtml(s.nom)}</span>
        <span class="mobilax-serie-nb" data-serie="${Number(s.id)}" style="color:var(--text-muted);font-size:.82rem;"></span>
      </label>`).join('');
    // Aperçu de TOUTES les séries proposées, lu une fois : décocher ne rappelle pas Mobilax
    chargerApercuGeneration(series.map(s => Number(s.id)));
  } catch {
    // `api()` laisse passer un rejet de `fetch` (réseau coupé) : sans ce message, « Recherche
    // des séries… » resterait affiché indéfiniment
    messageMobilax(MESSAGE_MOBILAX_INJOIGNABLE, true);
  } finally {
    bouton.disabled = false;
  }
}

// ─── Aperçu d'une génération (ticket 02, chantier import-par-generation) ──────
// Lu une fois pour toutes les séries proposées ; chaque article sait dans quelles séries il
// figure, donc décocher une série recalcule l'aperçu sur place, sans appel au quota Mobilax.

/** Message affiché quand `fetch` est rejeté (réseau coupé) — `api()` ne le rattrape pas. */
const MESSAGE_MOBILAX_INJOIGNABLE = 'Mobilax est injoignable pour le moment (réseau coupé ?). Réessayez dans un instant.';
/** Rythme de l'import par génération (spec) : un départ toutes les 3 s au plus. */
const SECONDES_PAR_IMPORT = 3;
/** Au-delà, confirmation renforcée avant l'import (spec, story 11). */
const SEUIL_CONFIRMATION = 200;

/** Aperçu lu chez Mobilax (`{ series, articles }`), `null` tant qu'il n'est pas là. */
let apercuCourant = null;
/** Numéro de la dernière demande d'aperçu : une réponse plus ancienne (recherche relancée entre-temps) est ignorée. */
let numeroApercu = 0;

/** Oublie l'aperçu affiché et toute demande encore en vol. */
function oublierApercu() {
  apercuCourant = null;
  numeroApercu++;
  recalculerApercu();
}

/**
 * Lit l'aperçu des séries proposées. Quota atteint ou fournisseur indisponible : message du
 * serveur tel quel (il porte le délai), bouton d'import inactif.
 */
async function chargerApercuGeneration(seriesIds) {
  const numero = ++numeroApercu;
  document.getElementById('mobilax-apercu').textContent = 'Calcul de l\'aperçu chez Mobilax…';
  try {
    // Déballage au point d'appel : `data` est le corps JSON complet (CLAUDE.md § enveloppe)
    const res = (await apiGet(`/api/mobilax/apercu?series=${seriesIds.join(',')}`)).data;
    if (numero !== numeroApercu) return;
    if (!res?.success) {
      document.getElementById('mobilax-apercu').textContent = '';
      messageMobilax(res?.error || 'Aperçu Mobilax impossible.', true);
      return;
    }
    apercuCourant = res.data;
    recalculerApercu();
  } catch {
    if (numero !== numeroApercu) return;
    document.getElementById('mobilax-apercu').textContent = '';
    messageMobilax(MESSAGE_MOBILAX_INJOIGNABLE, true);
  }
}

/** Articles des séries cochées : retenus, déjà dans le stock, à importer. */
function selectionApercu() {
  const cochees = new Set([...document.querySelectorAll('#mobilax-series-liste input.mobilax-serie:checked')]
    .map(c => Number(c.value)));
  const retenus = (apercuCourant?.articles ?? []).filter(a => a.series.some(id => cochees.has(Number(id))));
  const aImporter = retenus.filter(a => !a.deja_en_stock);
  return { retenus, deja: retenus.length - aImporter.length, aImporter };
}

/** « 1 article », « 2 articles » — `mot` au pluriel par simple « s ». */
function compter(n, mot) {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

/**
 * Import que « Lancer l'import » de la confirmation renforcée déclenchera — commune à la génération
 * et à la sélection (ticket 03) —, `null` tant qu'elle est masquée. Chacun ne touche à la
 * confirmation que s'il l'a ouverte.
 */
let importAConfirmer = null;

/** Affiche la confirmation renforcée pour l'import `lancer`, ou la masque (`null`). */
function afficherConfirmation(lancer) {
  importAConfirmer = lancer || null;
  document.getElementById('mobilax-confirmation').hidden = !lancer;
}

/** Confirmation ouverte pour `lancer` : elle suit le compte `n` — refermée sous le seuil, texte mis à jour au-delà. */
function suivreConfirmation(lancer, n) {
  if (importAConfirmer !== lancer) return;
  if (n <= SEUIL_CONFIRMATION) afficherConfirmation(null);
  else remplirConfirmation(n);
}

/** Durée estimée d'un import de `n` articles : `n` × 3 s, arrondie à la minute (spec). */
function libelleDuree(n) {
  if (n === 0) return 'aucune';
  const minutes = Math.round(n * SECONDES_PAR_IMPORT / 60);
  return minutes === 0 ? 'moins d\'une minute' : `environ ${minutes} min`;
}

/** Réaffiche l'aperçu pour les séries cochées (textContent : noms tiers jamais interprétés). */
function recalculerApercu() {
  const zone = document.getElementById('mobilax-apercu');
  const bouton = document.getElementById('btn-generation-importer');
  if (!apercuCourant) {
    zone.textContent = '';
    bouton.disabled = true;
    bouton.textContent = 'Importer';
    if (importAConfirmer === lancerImportGeneration) afficherConfirmation(null);
    return;
  }
  for (const s of apercuCourant.series) {
    const el = document.querySelector(`.mobilax-serie-nb[data-serie="${Number(s.id)}"]`);
    if (el) el.textContent = `— ${compter(Number(s.nb_articles) || 0, 'article')}`;
  }
  const { retenus, deja, aImporter } = selectionApercu();
  const n = aImporter.length;
  zone.textContent = `${compter(retenus.length, 'article')} fournisseur · `
    + `${deja} déjà dans votre stock · ${n} à importer · durée estimée : ${libelleDuree(n)}`;
  bouton.disabled = n === 0;
  bouton.textContent = n ? `Importer ${compter(n, 'article')}` : 'Importer';
  // Confirmation ouverte pour la génération : elle suit le compte, et se referme sous le seuil
  suivreConfirmation(lancerImportGeneration, n);
}

/** Texte de la confirmation renforcée pour `n` articles à importer. */
function remplirConfirmation(n) {
  document.getElementById('mobilax-confirmation-texte').textContent =
    `${n} articles à importer — ${libelleDuree(n)}. Pendant l'import, gardez cet onglet ouvert.`;
}

/** « Importer » : confirmation renforcée au-delà du seuil, sinon lancement direct. */
function demanderImportGeneration() {
  const n = selectionApercu().aImporter.length;
  if (n === 0) return;
  if (n > SEUIL_CONFIRMATION) {
    remplirConfirmation(n);
    afficherConfirmation(lancerImportGeneration);
    return;
  }
  lancerImportGeneration();
}

// ─── Boucle d'import commune (génération, puis sélection) : progression, bilan (ticket 03) ; ──
// quota, arrêt (ticket 04) ; « Interrompre » (ticket 01, chantier import-d-une-selection)
// Quota atteint avec délai annoncé : pause, compte à rebours, même article (seule reprise
// automatique). Quota sans délai, fournisseur `indisponible` ou connexion perdue : arrêt, bilan
// partiel avec les restants — relancer la même génération n'importe que le manquant.
// Pilotée par le navigateur (précédent : startSync() de services.js) : un article à la fois, par
// la route d'import unitaire existante, un départ toutes les 3 s au plus (20 par minute) pour
// laisser 10 appels par minute aux recherches du comptoir. Sans quantité en rayon : le serveur
// applique le stock initial et le seuil d'alerte par défaut de la boutique. Un échec n'arrête
// pas les suivants ; `deja_importe` est compté « déjà en stock », jamais en échec.

/** Écart minimal entre deux départs d'import (spec : au plus 20 par minute). */
const INTERVALLE_IMPORT_MS = SECONDES_PAR_IMPORT * 1000;

/** Motif d'arrêt quand `fetch` est rejeté pendant l'import — distinct d'une panne du fournisseur. */
const MESSAGE_CONNEXION_PERDUE = 'Connexion perdue avec iziGSM (réseau coupé ?).';

/** Import en cours (génération ou sélection) : fenêtre gardée telle quelle, fermeture de l'onglet avertie. */
let importEnCours = false;
/** « Interrompre » cliqué : la boucle s'arrête avant le prochain départ (ticket 01 import-d-une-selection). */
let interruptionDemandee = false;
/** Réveille l'attente en cours (rythme ou seconde de pause) ; `null` hors attente. */
let reveillerAttente = null;

/** Avertissement du navigateur à la fermeture de l'onglet pendant l'import (story 28). */
function retenirFermeture(e) {
  e.preventDefault();
  e.returnValue = '';
}

/**
 * Attend `ms` millisecondes — `setTimeout`, que l'horloge simulée des E2E pilote. « Interrompre »
 * met fin à l'attente sur-le-champ : ni l'écart entre deux départs ni une pause ne le retardent.
 */
function patienter(ms) {
  return new Promise(resolve => {
    const minuteur = setTimeout(() => { reveillerAttente = null; resolve(); }, ms);
    reveillerAttente = () => { clearTimeout(minuteur); reveillerAttente = null; resolve(); };
  });
}

/**
 * « Interrompre » : l'article en vol finit son import, puis la boucle s'arrête ; une attente
 * (rythme, pause de quota) est coupée net (stories 26-27, spec import-d-une-selection).
 */
function interrompreImport() {
  if (!importEnCours) return;
  interruptionDemandee = true;
  const bouton = document.getElementById('btn-import-interrompre');
  bouton.disabled = true;
  bouton.textContent = 'Interruption…';
  reveillerAttente?.();
}

/**
 * Pause de quota (story 15) : compte à rebours seconde par seconde du délai annoncé par le
 * fournisseur, puis la boucle reprend l'article interrompu (story 16) — sauf « Interrompre »,
 * qui arrête le compte à rebours sur-le-champ.
 * @param secondes Délai entier > 0, lu dans la réponse du serveur (`reessayer_dans_s`)
 */
async function compteARebours(secondes) {
  const pause = document.getElementById('mobilax-import-pause');
  pause.hidden = false;
  for (let reste = secondes; reste > 0 && !interruptionDemandee; reste--) {
    pause.textContent = `Quota fournisseur atteint — reprise dans ${reste} s`;
    await patienter(1000);
  }
  pause.hidden = true;
}

/**
 * Fige (ou libère) la saisie pendant l'import : séries cochées et bouton d'import. Le mode et
 * la recherche restent libres — un collègue doit pouvoir chercher une pièce (story 14).
 */
function basculerSaisieImport(actif) {
  document.querySelectorAll('#mobilax-series-liste input').forEach(el => { el.disabled = !actif; });
  // Libéré, le bouton de la génération reprend l'état de l'aperçu : réactivé d'office, il resterait
  // actif sur un aperçu vide après un import d'une sélection
  if (actif) recalculerApercu();
  else document.getElementById('btn-generation-importer').disabled = true;
  // Import d'une sélection (ticket 02) : cases et « Importer » des lignes figés, barre inactive
  document.querySelectorAll(`${SELECTEUR_CASES}, #mobilax-resultats button[data-mobilax-id]`)
    .forEach(el => { el.disabled = !actif; });
  // Barre de sélection (« Importer », « Vider ») et « Tout cocher » : un seul écrivain, qui lit
  // `importEnCours` — déjà basculé par l'appelant
  majAffichageSelection();
}

/** Ajoute une ligne au journal de l'import (textContent : noms tiers jamais interprétés). */
function journaliserImport(texte, couleur) {
  const journal = document.getElementById('mobilax-import-journal');
  const ligne = document.createElement('div');
  ligne.textContent = texte;
  ligne.style.color = couleur;
  journal.appendChild(ligne);
  journal.scrollTop = journal.scrollHeight;
}

/** Barre et libellé de progression : `fait` articles traités sur `total`. */
function afficherProgression(fait, total) {
  document.getElementById('mobilax-import-barre').style.width = `${Math.round(fait / total * 100)}%`;
  document.getElementById('mobilax-import-progression').textContent = `${fait} / ${total}`;
}

/**
 * Import par génération : les articles à importer des séries cochées, sans quantité (stock
 * initial par défaut de la boutique), par la boucle commune.
 */
async function lancerImportGeneration() {
  const { deja, aImporter } = selectionApercu();
  if (!aImporter.length) return;
  await importerArticles(aImporter.map(a => ({ mobilax_id: a.mobilax_id, nom: a.nom })), {
    deja,
    // Fiche fournisseur figée au lancement : le lien du bilan ne dépend pas de l'aperçu, oublié ensuite
    fournisseurId: apercuCourant?.fournisseur_id,
    relance: 'relancez la même génération, seul le manquant sera importé.',
  });
  // L'aperçu est périmé (ce qui était à importer l'est désormais) : une nouvelle recherche en relit
  // un. AVANT le rechargement du stock : sinon « Importer N articles » redevient cliquable sur
  // l'aperçu périmé le temps de l'aller-retour, et relancerait l'import (défaut vu en revue)
  oublierApercu();
  await loadStock();
}

/**
 * Boucle d'import commune (ticket 01 import-d-une-selection) — import par génération et import
 * d'une sélection : un article à la fois, puis le bilan. Le rythme se mesure de départ à départ :
 * une réponse lente ne rajoute pas 3 s d'attente.
 * @param articles `{ mobilax_id, nom, quantite? }` — `quantite` absente : non envoyée, le
 *   serveur applique le stock initial par défaut de la boutique
 * @param options.deja Articles déjà dans le stock connus d'avance (aperçu), comptés au bilan
 * @param options.fournisseurId Fiche fournisseur du lien du bilan
 * @param options.relance Fin de phrase du bilan partiel : comment importer les restants — texte,
 *   ou fonction lue au moment du bilan (l'écran a pu changer pendant l'import)
 * Rend la main après le bilan, stock NON rechargé : l'appelant range d'abord son propre état
 * (aperçu, sélection), puis appelle `loadStock()`.
 * @returns Le bilan (`idsTraites` : identifiants importés ou déjà en stock), `null` si rien n'est parti
 */
async function importerArticles(articles, { deja, fournisseurId, relance }) {
  // Un seul import à la fois : les deux modes partagent la même zone et le même quota
  if (importEnCours || !articles.length) return null;
  // Confirmation renforcée, quel que soit l'import qui l'a ouverte : l'import part, elle n'a plus d'objet
  afficherConfirmation(null);
  // `idsTraites` : identifiants importés ou déjà en stock — l'import d'une sélection les décoche
  const bilan = { importes: 0, deja, echecs: [], familles: {}, fournisseurId, relance, idsTraites: [] };

  importEnCours = true;
  interruptionDemandee = false;
  basculerSaisieImport(false);
  document.getElementById('mobilax-bilan').hidden = true;
  document.getElementById('mobilax-import-journal').replaceChildren();
  afficherProgression(0, articles.length);
  const interrompre = document.getElementById('btn-import-interrompre');
  interrompre.disabled = false;
  interrompre.textContent = 'Interrompre';
  // Enveloppe, pas le bouton : le `display` de `.btn` l'emporte sur l'attribut `hidden`
  document.getElementById('mobilax-import-interrompre').hidden = false;
  document.getElementById('mobilax-import').hidden = false;
  window.addEventListener('beforeunload', retenirFermeture);

  let dernierDepart = -Infinity;
  try {
    for (const [i, article] of articles.entries()) {
      // Un article peut partir plusieurs fois : après une pause de quota, c'est LUI qui repart
      let res = null;
      let connexionPerdue = false;
      let interrompu = false;
      for (;;) {
        const attente = dernierDepart + INTERVALLE_IMPORT_MS - Date.now();
        if (attente > 0 && !interruptionDemandee) await patienter(attente);
        // « Interrompre » pendant l'attente ou la pause : cet article n'est pas reparti
        if (interruptionDemandee) { interrompu = true; break; }
        dernierDepart = Date.now();
        res = null;
        connexionPerdue = false;
        try {
          // Import unitaire existant ; quantité en rayon seulement si l'appelant en donne une
          const corps = { mobilax_id: article.mobilax_id };
          if (article.quantite != null) corps.quantite_en_rayon = article.quantite;
          // Déballage au point d'appel (CLAUDE.md § enveloppe)
          res = (await apiPost('/api/mobilax/import', corps)).data;
        } catch {
          // Rejet de `fetch` : c'est la connexion à iziGSM qui manque, pas le fournisseur
          connexionPerdue = true;
        }
        // Quota atteint AVEC délai annoncé (`ratelimit-reset`) : pause, compte à rebours, puis
        // même article (ticket 04). Sans délai connu : pas de nouvelle tentative, arrêt ci-dessous.
        const delai = Math.ceil(Number(res?.reessayer_dans_s));
        if (res?.code !== 'quota' || !(delai > 0)) break;
        journaliserImport(`⏸ ${article.nom} — quota fournisseur atteint, pause de ${delai} s`, '#b45309');
        await compteARebours(delai);
      }

      if (interrompu) {
        // Arrêt voulu par l'opérateur (story 28, spec import-d-une-selection) : distinct d'un
        // arrêt sur incident. Interrompre pendant le DERNIER article en vol : voir après la boucle
        bilan.interruption = { restants: articles.length - i };
        journaliserImport('■ Import interrompu à votre demande', '#b42318');
        break;
      }
      if (res?.success) {
        bilan.importes++;
        bilan.idsTraites.push(article.mobilax_id);
        // Famille décidée par le serveur (illisible → pièce, côté service) : aucun repli ici, qui
        // rangerait en silence un défaut futur dans « Pièce »
        const famille = res.data?.famille ?? 'famille inconnue';
        bilan.familles[famille] = (bilan.familles[famille] || 0) + 1;
        journaliserImport(`✓ ${article.nom}`, '#059669');
      } else if (res?.code === 'deja_importe') {
        bilan.deja++;
        bilan.idsTraites.push(article.mobilax_id);
        journaliserImport(`= ${article.nom} — déjà dans votre stock`, '#6b7280');
      } else if (connexionPerdue || res?.code === 'indisponible' || res?.code === 'quota') {
        // Arrêt (ticket 04) : fournisseur injoignable, connexion perdue, ou quota sans délai
        // connu — jamais de nouvelle tentative à l'aveugle. Cet article et les suivants restent
        // à importer ; relancer le même import n'importera qu'eux (anti-doublon 0046).
        bilan.arret = {
          motif: connexionPerdue ? MESSAGE_CONNEXION_PERDUE : (res?.error || MESSAGE_MOBILAX_INJOIGNABLE),
          restants: articles.length - i,
        };
        journaliserImport(`■ Import arrêté — ${bilan.arret.motif}`, '#b42318');
        break;
      } else {
        const motif = res?.error || 'Réponse inattendue du serveur.';
        bilan.echecs.push({ nom: article.nom, motif });
        journaliserImport(`✗ ${article.nom} — ${motif}`, '#b42318');
      }
      afficherProgression(i + 1, articles.length);
    }
    // « Interrompre » pendant le DERNIER article en vol : la boucle a fini d'elle-même, rien ne
    // reste — mais le clic se lit au bilan (décision de l'exploitant, 2026-09-15), jamais « terminé »
    if (interruptionDemandee && !bilan.arret && !bilan.interruption) {
      bilan.interruption = { restants: 0 };
      journaliserImport('■ Import interrompu à votre demande', '#b42318');
    }
  } finally {
    window.removeEventListener('beforeunload', retenirFermeture);
    document.getElementById('mobilax-import-pause').hidden = true;
    document.getElementById('mobilax-import-interrompre').hidden = true;
    importEnCours = false;
    interruptionDemandee = false;
    basculerSaisieImport(true);
  }
  afficherBilan(bilan);
  return bilan;
}

/**
 * Bilan : importés, déjà en stock, échecs nommés, répartition par famille, lien vers le stock ;
 * sur arrêt (`arret` : motif, restants — ticket 04), « Import arrêté » et ce qu'il reste à importer ;
 * sur « Interrompre » (`interruption` : restants), « Import interrompu », distinct d'un incident.
 */
function afficherBilan({ importes, deja, echecs, familles, fournisseurId, relance, arret, interruption }) {
  const zone = document.getElementById('mobilax-bilan');
  zone.replaceChildren();
  const ajouter = (parent, balise, texte) => {
    const el = document.createElement(balise);
    el.textContent = texte;
    parent.appendChild(el);
    return el;
  };
  // Fin partielle, s'il y en a une : un seul aiguillage donne le titre, le motif et les restants
  const partielle = interruption ? { titre: 'Import interrompu', motif: 'Interrompu à votre demande', restants: interruption.restants }
    : arret ? { titre: 'Import arrêté', motif: arret.motif, restants: arret.restants }
    : null;
  ajouter(zone, 'strong', `${partielle?.titre ?? 'Import terminé'} : ${compter(importes, 'importé')} · `
    + `${deja} déjà dans votre stock · ${compter(echecs.length, 'échec')}`);
  // Bilan partiel : pourquoi l'import s'est arrêté, et ce qu'il reste à importer
  if (partielle) {
    const { motif, restants } = partielle;
    // 0 restant : interruption pendant le dernier article (un arrêt sur incident en laisse toujours un)
    ajouter(zone, 'p', restants > 0
      ? `${motif} — ${compter(restants, 'article')} restant${restants > 1 ? 's' : ''} : `
        + (typeof relance === 'function' ? relance() : relance)
      : `${motif} pendant le dernier article : rien ne reste à importer.`);
  }
  const repartition = Object.entries(familles)
    .map(([famille, n]) => `${FAMILLE_CONFIG[famille]?.label || famille} : ${n}`).join(' · ');
  if (repartition) ajouter(zone, 'p', `Répartition des importés — ${repartition}`);
  if (echecs.length) {
    const liste = ajouter(zone, 'ul', '');
    for (const e of echecs) ajouter(liste, 'li', `${e.nom} — ${e.motif}`);
  }
  if (Number(fournisseurId) > 0) {
    const lien = ajouter(zone, 'a', 'Voir les produits de ce fournisseur dans le stock');
    lien.href = `/stock?fournisseur_id=${Number(fournisseurId)}`;
  }
  zone.hidden = false;
}

document.getElementById('mobilax-series-liste')?.addEventListener('change', recalculerApercu);
document.getElementById('btn-generation-importer')?.addEventListener('click', demanderImportGeneration);
// Confirmation renforcée commune (ticket 03) : « Lancer l'import » déclenche l'import qui l'a ouverte
document.getElementById('btn-import-lancer')?.addEventListener('click', () => importAConfirmer?.());
document.getElementById('btn-import-annuler')?.addEventListener('click', () => afficherConfirmation(null));
document.getElementById('btn-import-interrompre')?.addEventListener('click', interrompreImport);

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
window.ouvrirRechercheMobilax = ouvrirRechercheMobilax;
window.chercherMobilax        = chercherMobilax;
window.chercherGeneration     = chercherGeneration;
window.soumettreRechercheMobilax = soumettreRechercheMobilax;
