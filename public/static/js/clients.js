/**
 * clients.js — Vue Clients (Sprint 2.15)
 * Rôle architectural : View (P2 — 100% via ApiService app.js, 0 fetch direct).
 *
 * Fonctionnalités :
 *   - Liste paginée + KPIs synthèse
 *   - Recherche / filtres en temps réel
 *   - CRUD client (modal création / édition)
 *   - Historique CRM consolidé (tickets + factures + rachats + RDV)
 *   - Import CSV avec mapping colonnes + prévisualisation
 *   - Export CSV (côté client)
 */

'use strict';

// ─── État module ──────────────────────────────────────────────────────────────
let _clients      = [];   // cache liste courante
let _filterMode   = 'all';
let _searchQuery  = '';
let _csvHeaders   = [];   // colonnes CSV brutes
let _csvRows      = [];   // données CSV parsées

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  buildSidebar('clients');
  _setupCsvDropZone();
  loadClients();
});

// ─── Chargement liste ─────────────────────────────────────────────────────────

/**
 * Charge la liste des clients depuis l'API et met à jour l'UI.
 * @returns {Promise<void>}
 */
async function loadClients() {
  _setTableLoading();

  try {
    const boutiqueId = getBoutiqueId();
    const params     = { limit: 200 };
    if (boutiqueId) params.boutique_id = boutiqueId;
    if (_searchQuery) params.search = _searchQuery;

    const res = await apiGet('/api/clients', params);
    if (!res.ok) throw new Error(res.error || 'Erreur API');

    _clients = (res.data?.data || []);
    _computeKpis();
    _renderTable();
  } catch (err) {
    console.error('[clients] loadClients:', err.message);
    _setTableError('Erreur lors du chargement des clients.');
  }
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

/**
 * Calcule et affiche les KPIs synthèse depuis le cache local.
 */
function _computeKpis() {
  const total    = _clients.length;
  const oneMonth = Date.now() - 30 * 24 * 3600 * 1000;
  const nouveau  = _clients.filter(c => new Date(c.created_at).getTime() > oneMonth).length;
  const actif    = _clients.filter(c => (c.nb_tickets || 0) > 0).length;
  const totalCa  = _clients.reduce((s, c) => s + (parseFloat(c.ca_total) || 0), 0);
  const caMoyen  = total > 0 ? totalCa / total : 0;

  _setText('kpi-total',    total);
  _setText('kpi-new',      nouveau);
  _setText('kpi-actif',    actif);
  _setText('kpi-ca-moyen', _money(caMoyen));
  _setText('clients-count', total + ' client' + (total > 1 ? 's' : ''));
}

// ─── Rendu tableau ────────────────────────────────────────────────────────────

/**
 * Applique les filtres courants et re-rend le tableau.
 */
function _renderTable() {
  let filtered = _clients;

  if (_filterMode === 'actif') {
    filtered = filtered.filter(c => (c.nb_tickets || 0) > 0);
  } else if (_filterMode === 'nouveau') {
    const oneMonth = Date.now() - 30 * 24 * 3600 * 1000;
    filtered = filtered.filter(c => new Date(c.created_at).getTime() > oneMonth);
  }

  if (_searchQuery.trim()) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      (_fullName(c)).toLowerCase().includes(q) ||
      (c.email     || '').toLowerCase().includes(q) ||
      (c.telephone || '').toLowerCase().includes(q) ||
      (c.ville     || '').toLowerCase().includes(q)
    );
  }

  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);">
          <i class="fas fa-users" style="font-size:2rem;margin-bottom:8px;display:block;opacity:.3"></i>
          Aucun client trouvé
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const name      = _esc(_fullName(c));
    const nb        = c.nb_tickets || 0;
    const ca        = _money(c.ca_total || 0);
    const initials  = _initials(_fullName(c));
    const color     = _avatarColor(c.id);

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar-circle" style="background:${color}">${initials}</div>
            <div>
              <div style="font-weight:600">${name}</div>
              <div style="font-size:.73rem;color:var(--text-muted)">${_esc(c.ville || '')}</div>
            </div>
          </div>
        </td>
        <td>${_esc(c.email || '—')}</td>
        <td>${_esc(c.telephone || '—')}</td>
        <td>${_esc(c.ville || '—')}</td>
        <td><span class="badge badge-info">${nb} ticket${nb > 1 ? 's' : ''}</span></td>
        <td>${ca}</td>
        <td>${_fmtDate(c.created_at)}</td>
        <td>
          <div class="action-btns">
            <button class="btn-icon" title="Historique CRM" onclick="viewHistorique(${c.id})">
              <i class="fas fa-history"></i>
            </button>
            <button class="btn-icon" title="Modifier" onclick="editClient(${c.id})">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon btn-icon-danger" title="Supprimer" onclick="deleteClient(${c.id})">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ─── Filtres ──────────────────────────────────────────────────────────────────

/**
 * Applique le filtre actif + la recherche et re-rend le tableau.
 */
function applyFilters() {
  _searchQuery = (document.getElementById('search-client') || {}).value || '';
  _renderTable();
}

/**
 * Change le filtre actif (boutons "Tous / Avec tickets / Ce mois").
 * @param {HTMLElement} el   - Bouton cliqué
 * @param {string}      mode - Valeur du filtre (all | actif | nouveau)
 */
function setFilter(el, mode) {
  document.querySelectorAll('[data-filter-client]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _filterMode = mode;
  _renderTable();
}

// ─── Modal Création / Édition ─────────────────────────────────────────────────

/**
 * Ouvre le modal vierge pour créer un nouveau client.
 */
function openNewClient() {
  _clearClientForm();
  _setText('modal-client-title', 'Nouveau client');
  document.getElementById('client-id').value = '';
  openModal('modal-client');
}

/**
 * Ouvre le modal pré-rempli pour modifier un client existant.
 * @param {number} id - ID du client à modifier
 */
function editClient(id) {
  const c = _clients.find(x => x.id == id);
  if (!c) return;

  _setText('modal-client-title', 'Modifier le client');
  document.getElementById('client-id').value = c.id;
  _setVal('c-prenom',      c.prenom      || '');
  _setVal('c-nom',         c.nom         || '');
  _setVal('c-email',       c.email       || '');
  _setVal('c-telephone',   c.telephone   || '');
  _setVal('c-adresse',     c.adresse     || '');
  _setVal('c-code-postal', c.code_postal || '');
  _setVal('c-ville',       c.ville       || '');
  _setVal('c-pays',        c.pays        || 'France');
  _setVal('c-notes',       c.notes       || '');
  openModal('modal-client');
}

/**
 * Enregistre (création ou mise à jour) un client via l'API.
 * @returns {Promise<void>}
 */
async function saveClient() {
  const id     = document.getElementById('client-id')?.value;
  const prenom = (document.getElementById('c-prenom')?.value || '').trim();
  const nom    = (document.getElementById('c-nom')?.value    || '').trim();
  const email  = (document.getElementById('c-email')?.value  || '').trim();

  if (!nom) { showFlash('Le nom est obligatoire.', 'error'); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFlash('Email invalide.', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-client');
  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

  const data = {
    prenom,
    nom,
    email:       email || null,
    telephone:   (document.getElementById('c-telephone')?.value   || '').trim() || null,
    adresse:     (document.getElementById('c-adresse')?.value     || '').trim() || null,
    code_postal: (document.getElementById('c-code-postal')?.value || '').trim() || null,
    ville:       (document.getElementById('c-ville')?.value       || '').trim() || null,
    pays:        (document.getElementById('c-pays')?.value        || '').trim() || 'France',
    notes:       (document.getElementById('c-notes')?.value       || '').trim() || null,
    boutique_id: getBoutiqueId(),
  };

  try {
    const res = id
      ? await apiPut(`/api/clients/${id}`, data)
      : await apiPost('/api/clients', data);

    if (!res.ok) throw new Error(res.error || 'Erreur API');

    showFlash(id ? 'Client mis à jour.' : 'Client créé.', 'success');
    closeModal('modal-client');
    await loadClients();
  } catch (err) {
    showFlash(err.message || 'Erreur lors de la sauvegarde.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
  }
}

/**
 * Supprime (soft delete) un client après confirmation.
 * @param {number} id - ID du client
 * @returns {Promise<void>}
 */
async function deleteClient(id) {
  if (!confirm('Supprimer ce client ? Les tickets ne seront pas supprimés.')) return;

  try {
    const res = await apiDelete(`/api/clients/${id}`);
    if (!res.ok) throw new Error(res.error || 'Erreur API');

    showFlash('Client supprimé.', 'success');
    _clients = _clients.filter(c => c.id !== id);
    _computeKpis();
    _renderTable();
  } catch (err) {
    showFlash(err.message || 'Erreur lors de la suppression.', 'error');
  }
}

// ─── Historique CRM ───────────────────────────────────────────────────────────

/**
 * Ouvre le modal historique consolidé d'un client.
 * Charge tickets + factures + rachats + RDV via GET /api/clients/:id/historique.
 *
 * @param {number} id - ID du client
 * @returns {Promise<void>}
 */
async function viewHistorique(id) {
  const c = _clients.find(x => x.id == id);
  if (!c) return;
  _rgpdClientId = id;  // Sprint 2.37 — capture pour export/purge RGPD

  _setText('hist-title', _esc(_fullName(c)));
  _setText('hist-subtitle', c.email || c.telephone || '');
  document.getElementById('hist-loader').style.display = 'block';
  document.getElementById('hist-kpis').innerHTML = '';
  ['hist-tickets','hist-factures','hist-rachats','hist-rdv'].forEach(p => {
    document.getElementById(p).innerHTML = '';
  });
  openModal('modal-historique');

  try {
    const boutiqueId = getBoutiqueId();
    const params = boutiqueId ? { boutique_id: boutiqueId } : {};
    const res = await apiGet(`/api/clients/${id}/historique`, params);
    if (!res.ok) throw new Error(res.error || 'Erreur API');

    const { tickets, factures, rachats, rendez_vous, kpis } = res.data?.data || {};
    _renderHistKpis(kpis || {});
    _renderHistTickets(tickets || []);
    _renderHistFactures(factures || []);
    _renderHistRachats(rachats || []);
    _renderHistRdv(rendez_vous || []);

    // Badges onglets
    _setText('hist-badge-tickets',  tickets?.length  || 0);
    _setText('hist-badge-factures', factures?.length || 0);
    _setText('hist-badge-rachats',  rachats?.length  || 0);
    _setText('hist-badge-rdv',      rendez_vous?.length || 0);

  } catch (err) {
    console.error('[clients] viewHistorique:', err.message);
    document.getElementById('hist-tickets').innerHTML =
      `<p style="color:var(--danger);padding:20px">${_esc(err.message)}</p>`;
  } finally {
    document.getElementById('hist-loader').style.display = 'none';
  }
}

/**
 * Rend les KPIs synthèse dans le modal historique.
 * @param {object} kpis - { nb_tickets, nb_factures, ca_total, ticket_ouvert }
 */
function _renderHistKpis(kpis) {
  const el = document.getElementById('hist-kpis');
  if (!el) return;
  el.innerHTML = [
    { label: 'Tickets total',   value: kpis.nb_tickets   || 0 },
    { label: 'Factures',        value: kpis.nb_factures   || 0 },
    { label: 'CA total',        value: _money(kpis.ca_total || 0) },
    { label: 'Tickets ouverts', value: kpis.ticket_ouvert || 0 },
    { label: 'Rachats',         value: kpis.nb_rachats    || 0 },
    { label: 'RDV',             value: kpis.nb_rdv        || 0 },
  ].map(k => `
    <div class="kpi-card-sm">
      <span class="kpi-label">${k.label}</span>
      <span class="kpi-value" style="font-size:1.2rem">${k.value}</span>
    </div>
  `).join('');
}

/**
 * Rend la liste des tickets dans l'onglet historique.
 * @param {Array} tickets - Tableau de tickets
 */
function _renderHistTickets(tickets) {
  const el = document.getElementById('hist-tickets');
  if (!el) return;
  if (!tickets.length) { el.innerHTML = _emptyMsg('Aucun ticket.'); return; }

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
    <thead><tr>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">N°</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Appareil</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Statut</th>
      <th style="padding:6px 8px;text-align:right;background:var(--surface-2)">Prix</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Date</th>
    </tr></thead>
    <tbody>${tickets.map(t => `
      <tr>
        <td style="padding:6px 8px;font-weight:600">${_esc(t.numero || '#'+t.id)}</td>
        <td style="padding:6px 8px">${_esc((t.appareil_marque||'')+' '+(t.appareil_modele||'')).trim() || '—'}</td>
        <td style="padding:6px 8px">${statusBadge(t.statut)}</td>
        <td style="padding:6px 8px;text-align:right">${_money(t.prix_final||0)}</td>
        <td style="padding:6px 8px;color:var(--text-muted)">${_fmtDate(t.created_at)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/**
 * Rend la liste des factures dans l'onglet historique.
 * @param {Array} factures - Tableau de factures
 */
function _renderHistFactures(factures) {
  const el = document.getElementById('hist-factures');
  if (!el) return;
  if (!factures.length) { el.innerHTML = _emptyMsg('Aucune facture.'); return; }

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
    <thead><tr>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">N°</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Statut</th>
      <th style="padding:6px 8px;text-align:right;background:var(--surface-2)">Total TTC</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Émise le</th>
    </tr></thead>
    <tbody>${factures.map(f => `
      <tr>
        <td style="padding:6px 8px;font-weight:600">${_esc(f.numero || '#'+f.id)}</td>
        <td style="padding:6px 8px">${statusBadge(f.statut)}</td>
        <td style="padding:6px 8px;text-align:right;font-weight:600">${_money(f.total_ttc||0)}</td>
        <td style="padding:6px 8px;color:var(--text-muted)">${_fmtDate(f.issued_at || f.created_at)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/**
 * Rend la liste des rachats dans l'onglet historique.
 * @param {Array} rachats - Tableau de rachats
 */
function _renderHistRachats(rachats) {
  const el = document.getElementById('hist-rachats');
  if (!el) return;
  if (!rachats.length) { el.innerHTML = _emptyMsg('Aucun rachat.'); return; }

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
    <thead><tr>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">N°</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Appareil</th>
      <th style="padding:6px 8px;text-align:right;background:var(--surface-2)">Prix final</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Date</th>
    </tr></thead>
    <tbody>${rachats.map(r => `
      <tr>
        <td style="padding:6px 8px;font-weight:600">${_esc(r.numero || '#'+r.id)}</td>
        <td style="padding:6px 8px">${_esc((r.marque||'')+' '+(r.modele||'')).trim() || '—'}</td>
        <td style="padding:6px 8px;text-align:right">${_money(r.prix_final || r.prix_propose || 0)}</td>
        <td style="padding:6px 8px;color:var(--text-muted)">${_fmtDate(r.created_at)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/**
 * Rend la liste des rendez-vous dans l'onglet historique.
 * @param {Array} rdv - Tableau de rendez-vous
 */
function _renderHistRdv(rdv) {
  const el = document.getElementById('hist-rdv');
  if (!el) return;
  if (!rdv.length) { el.innerHTML = _emptyMsg('Aucun rendez-vous.'); return; }

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.82rem;">
    <thead><tr>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Type</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Statut</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Description</th>
      <th style="padding:6px 8px;text-align:left;background:var(--surface-2)">Date</th>
    </tr></thead>
    <tbody>${rdv.map(r => `
      <tr>
        <td style="padding:6px 8px;text-transform:capitalize">${_esc(r.type || '—')}</td>
        <td style="padding:6px 8px">${statusBadge(r.statut)}</td>
        <td style="padding:6px 8px;color:var(--text-muted)">${_esc(r.description || '—')}</td>
        <td style="padding:6px 8px;color:var(--text-muted)">${_fmtDateTime(r.debut)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

/**
 * Bascule entre les onglets du modal historique.
 * @param {HTMLElement} tab   - Onglet cliqué
 * @param {string}      panelId - ID du panneau à afficher
 */
function switchHistTab(tab, panelId) {
  document.querySelectorAll('.hist-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.hist-tab-panel').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById(panelId)?.classList.add('active');
}

// ─── Import CSV ───────────────────────────────────────────────────────────────

/** Colonnes reconnues en mapping automatique */
const CSV_FIELD_MAP = {
  prenom: ['prenom','prénom','firstname','first_name','first name'],
  nom: ['nom','name','lastname','last_name','last name','surname'],
  email: ['email','e-mail','mail','courriel'],
  telephone: ['telephone','téléphone','tel','phone','mobile','portable'],
  adresse: ['adresse','address','rue','street'],
  code_postal: ['code_postal','codepostal','cp','zip','postal'],
  ville: ['ville','city','localite','localité'],
  pays: ['pays','country'],
  notes: ['notes','note','commentaire','remarks'],
};

/**
 * Ouvre le modal d'import CSV (réinitialisé à l'étape 1).
 */
function openImportCsv() {
  resetCsvImport();
  openModal('modal-import-csv');
}

/**
 * Configure les événements drag & drop sur la zone de dépôt CSV.
 */
function _setupCsvDropZone() {
  const zone = document.getElementById('csv-drop-zone');
  if (!zone) return;

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) onCsvFileSelect(file);
  });
}

/**
 * Traite le fichier CSV sélectionné : parse, mapping auto, prévisualisation.
 * @param {File} file - Fichier CSV sélectionné
 */
function onCsvFileSelect(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    _parseCsv(text, file.name);
  };
  reader.readAsText(file, 'UTF-8');
}

/**
 * Parse le contenu CSV, détecte le séparateur, mappe les colonnes.
 * @param {string} text     - Contenu brut du fichier
 * @param {string} fileName - Nom du fichier (pour affichage)
 */
function _parseCsv(text, fileName) {
  // Supprimer BOM UTF-8 si présent
  const clean = text.replace(/^\uFEFF/, '');
  const lines  = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    showFlash('Fichier CSV vide ou invalide.', 'error');
    return;
  }

  // Détection séparateur (virgule ou point-virgule)
  const sep = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';

  // En-têtes (première ligne)
  _csvHeaders = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  // Données (lignes suivantes)
  _csvRows = lines.slice(1).map(line => {
    const cells = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    const obj   = {};
    _csvHeaders.forEach((h, i) => { obj[h] = cells[i] || ''; });
    return obj;
  }).filter(row => Object.values(row).some(v => v)); // filtrer lignes vides

  if (_csvRows.length > 500) {
    showFlash('Import limité à 500 lignes. Seules les 500 premières seront traitées.', 'warning');
    _csvRows = _csvRows.slice(0, 500);
  }

  _setText('csv-file-name', `${fileName} — ${_csvRows.length} ligne(s) détectée(s)`);
  _buildCsvMapping();
  _buildCsvPreview();

  document.getElementById('csv-step-1').style.display = 'none';
  document.getElementById('csv-step-2').style.display = 'block';
  document.getElementById('csv-step-3').style.display = 'none';
  document.getElementById('btn-import-csv').style.display = '';
  _setText('btn-import-count', `(${_csvRows.length})`);
}

/**
 * Construit les selects de mapping colonne CSV → champ iziGSM.
 */
function _buildCsvMapping() {
  const area = document.getElementById('csv-mapping-area');
  if (!area) return;

  const iziFields = Object.keys(CSV_FIELD_MAP);
  const options   = ['— ignorer —', ..._csvHeaders]
    .map(h => `<option value="${_esc(h)}">${_esc(h)}</option>`)
    .join('');

  area.innerHTML = iziFields.map(field => {
    // Mapping automatique
    const aliases  = CSV_FIELD_MAP[field];
    const matched  = _csvHeaders.find(h => aliases.includes(h)) || '';
    const selOpts  = ['— ignorer —', ..._csvHeaders].map(h =>
      `<option value="${_esc(h)}" ${h === matched ? 'selected' : ''}>${_esc(h)}</option>`
    ).join('');

    return `
      <label>
        ${field}
        <select id="csv-map-${field}">${selOpts}</select>
      </label>`;
  }).join('');

  const stats = document.getElementById('csv-stats');
  if (stats) stats.textContent = `${_csvRows.length} ligne(s) à importer — ${_csvHeaders.length} colonne(s) CSV`;
}

/**
 * Construit la table de prévisualisation (5 premières lignes).
 */
function _buildCsvPreview() {
  const table = document.getElementById('csv-preview-table');
  if (!table || !_csvHeaders.length) return;

  const preview = _csvRows.slice(0, 5);
  table.innerHTML = `
    <thead><tr>${_csvHeaders.map(h => `<th>${_esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${preview.map(row =>
      `<tr>${_csvHeaders.map(h => `<td>${_esc(row[h] || '')}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
}

/**
 * Réinitialise le modal import CSV à l'étape 1.
 */
function resetCsvImport() {
  _csvHeaders = [];
  _csvRows    = [];
  document.getElementById('csv-step-1').style.display = 'block';
  document.getElementById('csv-step-2').style.display = 'none';
  document.getElementById('csv-step-3').style.display = 'none';
  document.getElementById('btn-import-csv').style.display = 'none';
  const input = document.getElementById('csv-file-input');
  if (input) input.value = '';
}

/**
 * Lance l'import CSV via POST /api/clients/import-csv.
 * Applique le mapping sélectionné par l'utilisateur avant envoi.
 * @returns {Promise<void>}
 */
async function doImportCsv() {
  if (!_csvRows.length) return;

  const btn = document.getElementById('btn-import-csv');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Import en cours…'; }

  // Construire le tableau mappé
  const iziFields = Object.keys(CSV_FIELD_MAP);
  const rows = _csvRows.map(raw => {
    const mapped = {};
    iziFields.forEach(field => {
      const sel = document.getElementById(`csv-map-${field}`);
      const col = sel?.value || '';
      if (col && col !== '— ignorer —') {
        mapped[field] = raw[col] || '';
      }
    });
    return mapped;
  });

  try {
    const boutiqueId = getBoutiqueId();
    const res = await apiPost('/api/clients/import-csv', {
      rows,
      boutique_id: boutiqueId,
    });

    if (!res.ok) throw new Error(res.error || 'Erreur API');

    const { inserted, skipped, errors } = res.data || {};
    document.getElementById('csv-step-2').style.display = 'none';
    document.getElementById('csv-step-3').style.display = 'block';
    if (btn) btn.style.display = 'none';

    _setText('csv-result-icon', inserted > 0 ? '✅' : '⚠️');
    _setText('csv-result-msg',  `${inserted} client(s) importé(s), ${skipped} ignoré(s).`);

    const detailEl = document.getElementById('csv-result-detail');
    if (detailEl) detailEl.textContent = res.data?.message || '';

    const errEl = document.getElementById('csv-result-errors');
    if (errEl && errors?.length) {
      errEl.innerHTML = errors.map(e => `<div>⚠️ ${_esc(e)}</div>`).join('');
    }

    if (inserted > 0) {
      showFlash(`${inserted} client(s) importé(s) avec succès.`, 'success');
      await loadClients();
    }
  } catch (err) {
    showFlash(err.message || 'Erreur lors de l\'import.', 'error');
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

/**
 * Exporte la liste de clients actuellement affichée en fichier CSV.
 */
function exportClients() {
  if (!_clients.length) { showFlash('Aucun client à exporter.', 'warning'); return; }

  const rows = [
    ['Prénom','Nom','Email','Téléphone','Adresse','Code postal','Ville','Pays','Notes','Date création','Nb tickets','CA total'],
    ..._clients.map(c => [
      c.prenom || '',
      c.nom    || '',
      c.email  || '',
      c.telephone || '',
      c.adresse   || '',
      c.code_postal || '',
      c.ville     || '',
      c.pays      || '',
      c.notes     || '',
      _fmtDate(c.created_at),
      c.nb_tickets || 0,
      c.ca_total   || 0,
    ])
  ];

  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `clients_izigsm_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showFlash('Export CSV téléchargé.', 'success');
}

// ─── Utilitaires privés ───────────────────────────────────────────────────────

/**
 * Retourne le nom complet d'un client.
 * @param {object} c - Objet client
 * @returns {string} Prénom + Nom
 */
function _fullName(c) {
  return [c.prenom, c.nom].filter(Boolean).join(' ') || '—';
}

/**
 * Retourne les initiales pour l'avatar (max 2 caractères).
 * @param {string} name - Nom complet
 * @returns {string}
 */
function _initials(name) {
  if (!name || name === '—') return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

/**
 * Retourne une couleur d'avatar déterministe selon l'ID.
 * @param {number} id - ID client
 * @returns {string} Couleur CSS hex
 */
function _avatarColor(id) {
  const palette = ['#6c47ff','#f5a623','#2ecc71','#e74c3c','#3498db','#9b59b6','#1abc9c','#e67e22','#34495e','#e91e63'];
  return palette[(parseInt(id) || 0) % palette.length];
}

/**
 * Retourne un bloc HTML "état vide" pour les panneaux historique.
 * @param {string} msg - Message à afficher
 * @returns {string} HTML
 */
function _emptyMsg(msg) {
  return `<p style="text-align:center;color:var(--text-muted);padding:24px">${_esc(msg)}</p>`;
}

/** Met l'état de chargement dans le tbody. */
function _setTableLoading() {
  const tbody = document.getElementById('clients-tbody');
  if (tbody) tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);">
        <i class="fas fa-spinner fa-spin" style="font-size:1.5rem;margin-bottom:8px;display:block;"></i>
        Chargement…
      </td>
    </tr>`;
}

/**
 * Met un message d'erreur dans le tbody.
 * @param {string} msg - Message d'erreur
 */
function _setTableError(msg) {
  const tbody = document.getElementById('clients-tbody');
  if (tbody) tbody.innerHTML = `
    <tr><td colspan="8" style="text-align:center;padding:40px;color:var(--danger);">${_esc(msg)}</td></tr>`;
}

/**
 * Raccourci : écrit textContent dans un élément par son ID.
 * @param {string} id  - ID de l'élément
 * @param {*}      val - Valeur à écrire
 */
function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '';
}

/**
 * Raccourci : définit la valeur d'un input par son ID.
 * @param {string} id  - ID de l'input
 * @param {string} val - Valeur
 */
function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

/**
 * Escape HTML pour affichage sécurisé.
 * @param {*} str - Valeur à échapper
 * @returns {string}
 */
function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Vide les champs du formulaire client. */
function _clearClientForm() {
  ['c-prenom','c-nom','c-email','c-telephone','c-adresse','c-code-postal','c-ville','c-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const pays = document.getElementById('c-pays');
  if (pays) pays.value = 'France';
}

// ─── RGPD (Sprint 2.37) ───────────────────────────────────────────────────────

/** ID du client actuellement ouvert dans le modal historique (Sprint 2.37) */
let _rgpdClientId = null;

/**
 * exportRgpd — Déclenche le téléchargement JSON (Art. 15 RGPD)
 */
async function exportRgpd() {
  if (!_rgpdClientId) return;
  try {
    const session = JSON.parse(localStorage.getItem('izigsm_session') || '{}');
    const token   = session.accessToken || session.access_token || '';
    const res = await fetch(`/api/clients/${_rgpdClientId}/export-rgpd`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob     = await res.blob();
    const filename = `rgpd_client_${_rgpdClientId}_${new Date().toISOString().slice(0,10)}.json`;
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Erreur export RGPD : ${err.message}`);
  }
}

/**
 * purgeRgpd — Anonymisation RGPD irréversible (Art. 17 RGPD)
 */
async function purgeRgpd() {
  if (!_rgpdClientId) return;
  const ok = confirm(
    '⚠️ PURGE RGPD — Action irréversible\n\n' +
    'Les données personnelles de ce client (nom, email, téléphone, adresse) ' +
    'seront anonymisées définitivement.\n\n' +
    'L\'historique comptable (tickets, factures) est conservé sans données personnelles.\n\n' +
    'Confirmer ?'
  );
  if (!ok) return;

  try {
    const session = JSON.parse(localStorage.getItem('izigsm_session') || '{}');
    const token   = session.accessToken || session.access_token || '';
    const res = await fetch(`/api/clients/${_rgpdClientId}/purge`, {
      method:  'DELETE',
      headers: {
        'Content-Type':  'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ confirm: true }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok || !r.success) throw new Error(r.error || `HTTP ${res.status}`);
    alert('✅ Client anonymisé (RGPD Art. 17). Les données personnelles ont été supprimées.');
    closeModal('modal-historique');
    await loadClients();
  } catch (err) {
    alert(`Erreur purge RGPD : ${err.message}`);
  }
}

// ─── Exposition globale ───────────────────────────────────────────────────────
window.loadClients       = loadClients;
window.openNewClient     = openNewClient;
window.editClient        = editClient;
window.saveClient        = saveClient;
window.deleteClient      = deleteClient;
window.viewHistorique    = viewHistorique;
window.switchHistTab     = switchHistTab;
window.applyFilters      = applyFilters;
window.setFilter         = setFilter;
window.exportClients     = exportClients;
window.openImportCsv     = openImportCsv;
window.onCsvFileSelect   = onCsvFileSelect;
window.resetCsvImport    = resetCsvImport;
window.doImportCsv       = doImportCsv;
window.exportRgpd        = exportRgpd;
window.purgeRgpd         = purgeRgpd;
