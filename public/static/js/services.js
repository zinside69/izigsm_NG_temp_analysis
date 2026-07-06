/**
 * iziGSM — services.js
 * Catalogue services hiérarchique (Sprint 2.4)
 * Connecté à /api/services/* via ApiService (app.js — Principe 5)
 */

// ─── État module ──────────────────────────────────────────────────────────────
let _categories   = [];   // liste plate des catégories
let _services     = [];   // liste plate des services (cache)
let _filtrecat    = null; // categorie_id actif (null = tous)
let _search       = '';   // texte recherche local

const COULEURS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444',
  '#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#64748b',
];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = requireAuth();
  if (!session) return;

  buildSidebar('services');
  updateTopbarAvatar(session);
  buildColorGrid();
  await loadCatalogue();
});

/** Met à jour l'avatar topbar */
function updateTopbarAvatar(session) {
  const el = document.getElementById('topbar-avatar');
  if (!el) return;
  const name = session.name || session.email || '';
  el.textContent = name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || 'U';
}

// ─── Chargement ───────────────────────────────────────────────────────────────

/**
 * Charge le catalogue complet (arbre + liste plate services).
 * Utilise /api/services/catalogue pour l'arbre et /api/services pour la grille.
 */
async function loadCatalogue() {
  const session    = requireAuth();
  const boutiqueId = getBoutiqueId();
  if (!boutiqueId) { renderEmpty('boutique_id introuvable.'); return; }

  const [resCats, resSvcs] = await Promise.all([
    apiGet('/api/services/categories', { boutique_id: boutiqueId }),
    apiGet('/api/services', { boutique_id: boutiqueId, limit: 500 }),
  ]);

  _categories = resCats.ok  ? (resCats.data?.data  || []) : [];
  _services   = resSvcs.ok  ? (resSvcs.data?.data  || []) : [];

  renderSidebarCats();
  renderServices();
  populateCatSelects();
}

// ─── Sidebar catégories ───────────────────────────────────────────────────────

/**
 * Rend la liste de catégories dans la sidebar (arbre parent → enfants).
 */
function renderSidebarCats() {
  const container = document.getElementById('cat-list');
  const badgeAll  = document.getElementById('badge-all');
  if (!container) return;

  badgeAll.textContent = _services.length;

  // Séparer parents et enfants
  const parents  = _categories.filter(c => !c.parent_id);
  const enfants  = _categories.filter(c =>  c.parent_id);

  let html = '';
  parents.forEach(parent => {
    const nbParent = _services.filter(s => s.categorie_id === parent.id).length;
    html += `
      <div class="cat-item ${_filtrecat === parent.id ? 'active' : ''}"
           data-cat="${parent.id}" onclick="filterByCategorie(${parent.id}, this)">
        <span class="cat-dot" style="background:${parent.couleur || '#6366f1'}"></span>
        <span>${parent.nom}</span>
        <div class="cat-actions">
          <button class="btn-cat-action" onclick="event.stopPropagation(); openModalCategorie(${parent.id})" title="Modifier">✏️</button>
          <button class="btn-cat-action" onclick="event.stopPropagation(); deleteCategorie(${parent.id})" title="Supprimer">🗑</button>
        </div>
        <span class="cat-badge">${nbParent}</span>
      </div>`;

    // Sous-catégories
    enfants.filter(e => e.parent_id === parent.id).forEach(enfant => {
      const nbEnfant = _services.filter(s => s.categorie_id === enfant.id).length;
      html += `
        <div class="cat-item child ${_filtrecat === enfant.id ? 'active' : ''}"
             data-cat="${enfant.id}" onclick="filterByCategorie(${enfant.id}, this)">
          <span class="cat-dot" style="background:${enfant.couleur || '#6366f1'}"></span>
          <span>${enfant.nom}</span>
          <div class="cat-actions">
            <button class="btn-cat-action" onclick="event.stopPropagation(); openModalCategorie(${enfant.id})" title="Modifier">✏️</button>
            <button class="btn-cat-action" onclick="event.stopPropagation(); deleteCategorie(${enfant.id})" title="Supprimer">🗑</button>
          </div>
          <span class="cat-badge">${nbEnfant}</span>
        </div>`;
    });
  });

  container.innerHTML = html || '<div class="cat-section-title">Aucune catégorie</div>';
}

// ─── Grille services ──────────────────────────────────────────────────────────

/**
 * Filtre et rend la grille des services selon la catégorie active et la recherche.
 */
function renderServices() {
  let data = _services;

  // Filtre catégorie
  if (_filtrecat !== null) {
    data = data.filter(s => s.categorie_id === _filtrecat);
  }

  // Filtre recherche local
  if (_search) {
    const q = _search.toLowerCase();
    data = data.filter(s =>
      s.nom?.toLowerCase().includes(q) ||
      s.reference?.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q)
    );
  }

  // Titre
  const cat = _categories.find(c => c.id === _filtrecat);
  document.getElementById('services-title').textContent    = cat ? cat.nom : 'Tous les services';
  document.getElementById('services-subtitle').textContent = `${data.length} service${data.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('services-grid');
  if (!data.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="es-icon">🛠</div>
        <div class="es-title">Aucun service</div>
        <p>Cliquez sur <strong>+ Service</strong> pour créer votre premier service.</p>
      </div>`;
    return;
  }

  grid.innerHTML = data.map(s => buildServiceCard(s)).join('');
}

/**
 * Construit le HTML d'une carte service.
 */
function buildServiceCard(s) {
  const prixTtc = s.prix_ttc ?? (s.prix_ht * (1 + (s.tva_taux || 20) / 100));
  const badges  = [
    s.duree_minutes  ? `<span class="badge badge-duree">⏱ ${s.duree_minutes} min</span>` : '',
    s.garantie_jours ? `<span class="badge badge-garantie">🛡 ${s.garantie_jours}j</span>` : '',
    `<span class="badge badge-tva">TVA ${s.tva_taux || 20}%</span>`,
  ].join('');

  return `
    <div class="service-card">
      <div class="service-card-actions">
        <button class="btn-icon" onclick="openModalService(${s.id})" title="Modifier">✏️</button>
        <button class="btn-icon danger" onclick="deleteService(${s.id})" title="Supprimer">🗑</button>
      </div>
      <div class="service-card-header">
        <div>
          <div class="service-nom">${escHtml(s.nom)}</div>
          ${s.reference ? `<div class="service-ref">${escHtml(s.reference)}</div>` : ''}
        </div>
      </div>
      <div class="service-desc">${escHtml(s.description || '')}</div>
      <div class="service-footer">
        <div>
          <div class="service-prix">${prixTtc.toFixed(2)} €</div>
          <div class="service-prix-sub">HT : ${(s.prix_ht || 0).toFixed(2)} €</div>
        </div>
        <div class="service-badges">${badges}</div>
      </div>
    </div>`;
}

// ─── Filtres ──────────────────────────────────────────────────────────────────

/**
 * Filtre la grille par catégorie (appelé au clic sidebar).
 */
function filterByCategorie(catId, el) {
  _filtrecat = catId;
  document.querySelectorAll('.cat-item').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  renderServices();
}

/** Recherche texte locale */
function onSearch(val) {
  _search = val.trim();
  renderServices();
}

// ─── Modal Catégorie ──────────────────────────────────────────────────────────

/**
 * Ouvre le modal catégorie (création ou édition).
 * @param {number|null} id - null pour création, id pour édition
 */
function openModalCategorie(id = null) {
  document.getElementById('cat-id').value          = id || '';
  document.getElementById('modal-cat-title').textContent = id ? 'Modifier la catégorie' : 'Nouvelle catégorie';
  document.getElementById('cat-nom').value          = '';
  document.getElementById('cat-description').value  = '';
  document.getElementById('cat-couleur').value      = '#6366f1';

  // Pré-remplir si édition
  if (id) {
    const cat = _categories.find(c => c.id === id);
    if (cat) {
      document.getElementById('cat-nom').value         = cat.nom;
      document.getElementById('cat-description').value = cat.description || '';
      document.getElementById('cat-couleur').value     = cat.couleur || '#6366f1';
    }
  }

  updateColorGrid(document.getElementById('cat-couleur').value);
  populateCatParentSelect(id);
  openModal('modal-categorie');
}

/**
 * Enregistre la catégorie (création ou mise à jour) via ApiService.
 */
async function saveCategorie() {
  const id          = document.getElementById('cat-id').value;
  const boutiqueId  = getBoutiqueId();
  const body = {
    boutique_id:  boutiqueId,
    nom:          document.getElementById('cat-nom').value.trim(),
    parent_id:    parseInt(document.getElementById('cat-parent').value) || null,
    description:  document.getElementById('cat-description').value.trim() || null,
    couleur:      document.getElementById('cat-couleur').value,
  };

  if (!body.nom) { showFlash('Nom obligatoire.', 'error'); return; }

  const res = id
    ? await apiPut(`/api/services/categories/${id}`, body)
    : await apiPost('/api/services/categories', body);

  if (!res.ok) { showFlash(res.error || 'Erreur.', 'error'); return; }
  showFlash(id ? 'Catégorie mise à jour.' : 'Catégorie créée.', 'success');
  closeModal('modal-categorie');
  await loadCatalogue();
}

/**
 * Supprime (désactive) une catégorie après confirmation.
 */
async function deleteCategorie(id) {
  const cat = _categories.find(c => c.id === id);
  if (!confirm(`Désactiver la catégorie "${cat?.nom}" et tous ses services ?`)) return;

  const res = await apiDelete(`/api/services/categories/${id}`);
  if (!res.ok) { showFlash(res.error || 'Erreur.', 'error'); return; }
  showFlash('Catégorie désactivée.', 'success');
  _filtrecat = null;
  await loadCatalogue();
}

// ─── Modal Service ────────────────────────────────────────────────────────────

/**
 * Ouvre le modal service (création ou édition).
 * @param {number|null} id - null pour création, id pour édition
 */
async function openModalService(id = null) {
  document.getElementById('svc-id').value         = id || '';
  document.getElementById('modal-svc-title').textContent = id ? 'Modifier le service' : 'Nouveau service';
  document.getElementById('svc-nom').value         = '';
  document.getElementById('svc-description').value = '';
  document.getElementById('svc-prix').value        = '';
  document.getElementById('svc-tva').value         = '20';
  document.getElementById('svc-duree').value       = '';
  document.getElementById('svc-garantie').value    = '0';
  document.getElementById('svc-reference').value   = '';

  if (id) {
    const res = await apiGet(`/api/services/${id}`);
    if (res.ok && res.data?.data) {
      const s = res.data.data;
      document.getElementById('svc-nom').value         = s.nom;
      document.getElementById('svc-description').value = s.description || '';
      document.getElementById('svc-prix').value        = s.prix_ht;
      document.getElementById('svc-tva').value         = s.tva_taux || 20;
      document.getElementById('svc-duree').value       = s.duree_minutes || '';
      document.getElementById('svc-garantie').value    = s.garantie_jours || 0;
      document.getElementById('svc-reference').value   = s.reference || '';
      document.getElementById('svc-categorie').value   = s.categorie_id || '';
    }
  } else if (_filtrecat) {
    // Pré-sélectionner la catégorie active
    document.getElementById('svc-categorie').value = _filtrecat;
  }

  openModal('modal-service');
}

/**
 * Enregistre le service (création ou mise à jour) via ApiService.
 */
async function saveService() {
  const id         = document.getElementById('svc-id').value;
  const boutiqueId = getBoutiqueId();
  const body = {
    boutique_id:    boutiqueId,
    nom:            document.getElementById('svc-nom').value.trim(),
    categorie_id:   parseInt(document.getElementById('svc-categorie').value) || null,
    description:    document.getElementById('svc-description').value.trim() || null,
    prix_ht:        parseFloat(document.getElementById('svc-prix').value) || 0,
    tva_taux:       parseFloat(document.getElementById('svc-tva').value) || 20,
    duree_minutes:  parseInt(document.getElementById('svc-duree').value)  || null,
    garantie_jours: parseInt(document.getElementById('svc-garantie').value) || 0,
    reference:      document.getElementById('svc-reference').value.trim() || null,
  };

  if (!body.nom) { showFlash('Nom obligatoire.', 'error'); return; }

  const res = id
    ? await apiPut(`/api/services/${id}`, body)
    : await apiPost('/api/services', body);

  if (!res.ok) { showFlash(res.error || 'Erreur.', 'error'); return; }
  showFlash(id ? 'Service mis à jour.' : 'Service créé.', 'success');
  closeModal('modal-service');
  await loadCatalogue();
}

/**
 * Désactive un service après confirmation.
 */
async function deleteService(id) {
  const svc = _services.find(s => s.id === id);
  if (!confirm(`Désactiver le service "${svc?.nom}" ?`)) return;

  const res = await apiDelete(`/api/services/${id}`);
  if (!res.ok) { showFlash(res.error || 'Erreur.', 'error'); return; }
  showFlash('Service désactivé.', 'success');
  await loadCatalogue();
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

/** Peuple les selects catégorie dans les modaux */
function populateCatSelects() {
  populateCatParentSelect(null);
  const selSvc = document.getElementById('svc-categorie');
  if (!selSvc) return;
  selSvc.innerHTML = '<option value="">— Aucune —</option>' +
    _categories.map(c => `<option value="${c.id}">${c.parent_id ? '  ↳ ' : ''}${escHtml(c.nom)}</option>`).join('');
}

/** Peuple le select parent dans le modal catégorie (exclut soi-même) */
function populateCatParentSelect(excludeId) {
  const sel = document.getElementById('cat-parent');
  if (!sel) return;
  const options = _categories
    .filter(c => c.id !== excludeId && !c.parent_id) // seulement les parents (1 niveau)
    .map(c => `<option value="${c.id}">${escHtml(c.nom)}</option>`)
    .join('');
  sel.innerHTML = '<option value="">— Aucune (catégorie racine) —</option>' + options;
}

/** Construit la grille de couleurs dans le modal catégorie */
function buildColorGrid() {
  const grid = document.getElementById('color-grid');
  if (!grid) return;
  grid.innerHTML = COULEURS.map(col => `
    <div class="color-swatch" style="background:${col}" data-color="${col}"
         onclick="selectColor('${col}')"></div>
  `).join('');
}

/** Met à jour la couleur sélectionnée dans la grille */
function updateColorGrid(selected) {
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('selected', sw.dataset.color === selected);
  });
}

/** Sélectionne une couleur */
function selectColor(col) {
  document.getElementById('cat-couleur').value = col;
  updateColorGrid(col);
}

/** Ouvre un modal */
function openModal(id) { document.getElementById(id)?.classList.add('open'); }

/** Ferme un modal */
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

/** Vide la grille avec un message */
function renderEmpty(msg) {
  document.getElementById('services-grid').innerHTML =
    `<div class="empty-state" style="grid-column:1/-1">
      <div class="es-icon">⚠️</div>
      <div class="es-title">${msg}</div>
    </div>`;
}

/** Échappe le HTML pour éviter les XSS */
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Fermeture modale au clic extérieur ───────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ONGLETS
// ══════════════════════════════════════════════════════════════════════════════

function switchTab(tab) {
  const isServices = tab === 'services';
  document.getElementById('pane-services').style.display = isServices ? '' : 'none';
  document.getElementById('pane-modeles').style.display  = isServices ? 'none' : '';
  document.getElementById('btns-services').style.display = isServices ? 'flex' : 'none';
  document.getElementById('btns-modeles').style.display  = isServices ? 'none' : 'flex';
  document.getElementById('tab-services').classList.toggle('active', isServices);
  document.getElementById('tab-modeles').classList.toggle('active', !isServices);

  if (!isServices && !_marquesLoaded) loadMarques();
}

// ══════════════════════════════════════════════════════════════════════════════
// MARQUES
// ══════════════════════════════════════════════════════════════════════════════

let _marques        = [];
let _selectedMarque = null;
let _marquesLoaded  = false;

async function loadMarques() {
  const res = await apiGet('/api/services/marques');
  _marques = res.data || [];
  _marquesLoaded = true;
  renderMarques();
  if (_marques.length > 0) selectMarque(_marques[0].id);
}

function renderMarques() {
  const el = document.getElementById('marques-list');
  if (!_marques.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="es-icon">📱</div><div class="es-title">Aucune marque</div><div class="es-desc">Cliquez sur "＋ Marque" pour commencer.</div></div>`;
    return;
  }
  el.innerHTML = _marques.map(m => `
    <div class="marque-item ${m.id === _selectedMarque ? 'active' : ''}" id="marque-row-${m.id}" onclick="selectMarque(${m.id})">
      <div style="display:flex;align-items:center;gap:8px;">
        ${m.logo_url ? `<img src="${escHtml(m.logo_url)}" style="width:20px;height:20px;object-fit:contain;border-radius:3px;" onerror="this.style.display='none'">` : '<span style="font-size:18px;">📱</span>'}
        <span>${escHtml(m.nom)}</span>
        <span style="font-size:11px;color:#94a3b8;background:#f1f5f9;border-radius:10px;padding:1px 7px;">${m.nb_modeles || 0}</span>
      </div>
      <div class="marque-actions">
        <button class="btn" style="padding:2px 8px;font-size:12px;" onclick="event.stopPropagation();openModalMarque(${m.id})">✏️</button>
        <button class="btn btn-danger" style="padding:2px 8px;font-size:12px;" onclick="event.stopPropagation();deleteMarque(${m.id})">🗑</button>
      </div>
    </div>
  `).join('');
}

function selectMarque(id) {
  _selectedMarque = id;
  renderMarques();
  const marque = _marques.find(m => m.id === id);
  document.getElementById('modeles-title').textContent = marque ? `Modèles — ${marque.nom}` : 'Modèles';
  document.getElementById('modeles-search').style.display = 'block';
  loadModeles(id);
}

// ── Modal Marque ──────────────────────────────────────────────────────────────

function openModalMarque(id = null) {
  const m = id ? _marques.find(x => x.id === id) : null;
  document.getElementById('modal-marque-title').textContent = m ? 'Modifier la marque' : 'Nouvelle marque';
  document.getElementById('marque-id').value    = m?.id    || '';
  document.getElementById('marque-nom').value   = m?.nom   || '';
  document.getElementById('marque-logo').value  = m?.logo_url || '';
  document.getElementById('marque-ordre').value = m?.ordre ?? 0;
  document.getElementById('modal-marque').classList.add('open');
}

async function saveMarque() {
  const id   = document.getElementById('marque-id').value;
  const nom  = document.getElementById('marque-nom').value.trim();
  if (!nom) return alert('Le nom est requis.');

  const body = {
    nom,
    logo_url: document.getElementById('marque-logo').value.trim() || null,
    ordre:    parseInt(document.getElementById('marque-ordre').value, 10) || 0,
  };

  const method = id ? 'PUT' : 'POST';
  const url    = id ? `/api/services/marques/${id}` : '/api/services/marques';
  const res = method === 'PUT' ? await apiPut(url, body) : await apiPost(url, body);

  if (!res.success) return alert(res.error || 'Erreur lors de l\'enregistrement.');
  closeModal('modal-marque');
  await loadMarques();
}

async function deleteMarque(id) {
  const m = _marques.find(x => x.id === id);
  if (!confirm(`Désactiver la marque "${m?.nom}" et tous ses modèles ?`)) return;
  await apiDelete(`/api/services/marques/${id}`);
  await loadMarques();
  if (_selectedMarque === id) {
    _selectedMarque = null;
    document.getElementById('modeles-list').innerHTML = '';
    document.getElementById('modeles-title').textContent = 'Sélectionner une marque';
    document.getElementById('modeles-search').style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MODÈLES
// ══════════════════════════════════════════════════════════════════════════════

let _modeles     = [];
let _modelesFull = [];

const TYPE_LABELS = { smartphone:'📱', tablette:'📟', pc:'💻', console:'🎮', autre:'📦' };

async function loadModeles(marqueId) {
  const res  = await apiGet(`/api/services/modeles?marque_id=${marqueId}`);
  _modeles     = res.data || [];
  _modelesFull = [..._modeles];
  renderModeles();
}

function renderModeles() {
  const el = document.getElementById('modeles-list');
  if (!_modeles.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:24px;"><div class="es-icon">📦</div><div class="es-title">Aucun modèle</div><div class="es-desc">Cliquez sur "＋ Modèle" pour en ajouter.</div></div>`;
    return;
  }
  el.innerHTML = _modeles.map(mo => `
    <div class="modele-card">
      <div class="modele-card-title">${TYPE_LABELS[mo.type] || '📦'} ${escHtml(mo.nom)}</div>
      <div class="modele-card-meta">
        <span>${escHtml(mo.marque_nom || '')}</span>
        ${mo.annee ? `<span>· ${mo.annee}</span>` : ''}
        <span>· ${mo.type}</span>
      </div>
      <div class="modele-card-actions">
        <button class="btn btn-secondary" style="font-size:12px;padding:4px 10px;"
          onclick="openModalLiaison(${mo.id}, '${escHtml(mo.nom)}')">🔗 Services</button>
        <button class="btn" style="font-size:12px;padding:4px 10px;"
          onclick="openModalModele(${mo.id})">✏️</button>
        <button class="btn btn-danger" style="font-size:12px;padding:4px 10px;"
          onclick="deleteModele(${mo.id})">🗑</button>
      </div>
    </div>
  `).join('');
}

function filterModeles(q) {
  const lq = q.toLowerCase();
  _modeles = lq ? _modelesFull.filter(m => m.nom.toLowerCase().includes(lq)) : [..._modelesFull];
  renderModeles();
}

// ── Modal Modèle ──────────────────────────────────────────────────────────────

function openModalModele(id = null) {
  const mo = id ? _modelesFull.find(x => x.id === id) : null;
  document.getElementById('modal-modele-title').textContent = mo ? 'Modifier le modèle' : 'Nouveau modèle';
  document.getElementById('modele-id').value     = mo?.id    || '';
  document.getElementById('modele-nom').value    = mo?.nom   || '';
  document.getElementById('modele-annee').value  = mo?.annee || '';

  // Remplir le select marques
  const sel = document.getElementById('modele-marque-id');
  sel.innerHTML = _marques.map(m =>
    `<option value="${m.id}" ${m.id === (mo?.marque_id ?? _selectedMarque) ? 'selected' : ''}>${escHtml(m.nom)}</option>`
  ).join('');

  const typeEl = document.getElementById('modele-type');
  typeEl.value = mo?.type || 'smartphone';

  document.getElementById('modal-modele').classList.add('open');
}

async function saveModele() {
  const id      = document.getElementById('modele-id').value;
  const nom     = document.getElementById('modele-nom').value.trim();
  const marqueId = parseInt(document.getElementById('modele-marque-id').value, 10);
  if (!nom)     return alert('Le nom est requis.');
  if (!marqueId) return alert('La marque est requise.');

  const body = {
    nom,
    marque_id: marqueId,
    type:   document.getElementById('modele-type').value,
    annee:  parseInt(document.getElementById('modele-annee').value, 10) || null,
  };

  const method = id ? 'PUT' : 'POST';
  const url    = id ? `/api/services/modeles/${id}` : '/api/services/modeles';
  const res    = method === 'PUT' ? await apiPut(url, body) : await apiPost(url, body);

  if (!res.success) return alert(res.error || 'Erreur.');
  closeModal('modal-modele');
  await loadModeles(_selectedMarque);
  await loadMarques(); // refresh nb_modeles
}

async function deleteModele(id) {
  const mo = _modelesFull.find(x => x.id === id);
  if (!confirm(`Désactiver le modèle "${mo?.nom}" ?`)) return;
  await apiDelete(`/api/services/modeles/${id}`);
  await loadModeles(_selectedMarque);
  await loadMarques();
}

// ══════════════════════════════════════════════════════════════════════════════
// LIAISON SERVICE ↔ MODÈLE
// ══════════════════════════════════════════════════════════════════════════════

let _allServices = [];

async function openModalLiaison(modeleId, modeleName) {
  document.getElementById('modal-liaison-title').textContent = `Services — ${modeleName}`;
  document.getElementById('liaison-modele-id').value = modeleId;
  document.getElementById('liaison-prix-specifique').value = '';

  // Charger tous les services pour le select
  if (!_allServices.length) {
    const res = await apiGet('/api/services?limit=200');
    _allServices = res.data || [];
  }
  const sel = document.getElementById('liaison-service-select');
  sel.innerHTML = `<option value="">— Sélectionner un service —</option>` +
    _allServices.map(s => `<option value="${s.id}">${escHtml(s.nom)} (${s.categorie_nom || 'Sans catégorie'})</option>`).join('');

  await refreshLiaisonList(modeleId);
  document.getElementById('modal-liaison').classList.add('open');
}

async function refreshLiaisonList(modeleId) {
  const res  = await apiGet(`/api/services/modeles/${modeleId}/services`);
  const svcs = res.data?.services || [];

  const el = document.getElementById('liaison-services-list');
  if (!svcs.length) {
    el.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="es-icon">🔗</div><div class="es-title">Aucun service lié</div></div>`;
    return;
  }
  el.innerHTML = svcs.map(s => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
      <div>
        <span style="font-weight:600;font-size:13px;">${escHtml(s.nom)}</span>
        <span style="color:#6366f1;margin-left:8px;font-size:13px;">${s.prix_ttc_effectif?.toFixed(2)} € TTC</span>
        ${s.prix_ht_specifique != null ? `<span style="font-size:11px;color:#f59e0b;margin-left:6px;">prix spécifique</span>` : ''}
        <div style="font-size:11px;color:#94a3b8;">${escHtml(s.categorie_nom || '')}</div>
      </div>
      <button class="btn btn-danger" style="font-size:12px;padding:3px 8px;"
        onclick="removeLiaison(${s.id})">✕</button>
    </div>
  `).join('');
}

async function addLiaison() {
  const modeleId  = parseInt(document.getElementById('liaison-modele-id').value, 10);
  const serviceId = parseInt(document.getElementById('liaison-service-select').value, 10);
  const prix      = parseFloat(document.getElementById('liaison-prix-specifique').value) || null;

  if (!serviceId) return alert('Sélectionner un service.');

  const res = await apiPost(`/api/services/modeles/${modeleId}/services`, {
    service_id:          serviceId,
    prix_ht_specifique:  prix,
  });
  if (!res.success) return alert(res.error || 'Erreur.');
  document.getElementById('liaison-service-select').value = '';
  document.getElementById('liaison-prix-specifique').value = '';
  await refreshLiaisonList(modeleId);
}

async function removeLiaison(serviceId) {
  const modeleId = parseInt(document.getElementById('liaison-modele-id').value, 10);
  await apiDelete(`/api/services/modeles/${modeleId}/services/${serviceId}`);
  await refreshLiaisonList(modeleId);
}

window.switchTab         = switchTab;
window.openModalMarque   = openModalMarque;
window.saveMarque        = saveMarque;
window.deleteMarque      = deleteMarque;
window.selectMarque      = selectMarque;
window.openModalModele   = openModalModele;
window.saveModele        = saveModele;
window.deleteModele      = deleteModele;
window.filterModeles     = filterModeles;
window.openModalLiaison  = openModalLiaison;
window.addLiaison        = addLiaison;
window.removeLiaison     = removeLiaison;
