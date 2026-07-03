/**
 * iziGSM — factures.js
 * Connecté à /api/factures via api() wrapper (JWT auto-refresh)
 * Fallback gracieux sur localStorage si l'API est indisponible
 */

// ─── État module ──────────────────────────────────────────────────────────────
let factureLines     = [];
let currentFactureId = null;        // null = création, number = édition
let allFacturesCache = [];          // cache local enrichi
let facturesUseApi   = true;        // false si l'API est indisponible
let allClientsForFactures = [];     // cache clients pour le <select>
let allDevisAcceptes      = [];     // cache devis acceptés pour le <select>
let _avoirFactureId       = null;   // facture source pour le modal avoir
let avoirLines            = [];     // lignes du modal avoir

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  const session = requireAuth();
  if (!session) return;

  buildSidebar('factures');
  updateTopbarAvatar(session);

  await Promise.all([
    loadFactures(),
    loadClientsForFactures(),
    loadDevisAcceptesForSelect(),
  ]);

  addFactureLine();       // première ligne vide par défaut
  initSigPad();
  checkFromDevis();
});

// ─── Helpers affichage ────────────────────────────────────────────────────────
function updateTopbarAvatar(session) {
  const el = document.getElementById('topbar-avatar');
  if (!el || !session) return;
  const name = session.name || session.email || '';
  el.textContent = name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || 'U';
}

// ─── Mapping API → format local ───────────────────────────────────────────────
const STATUT_API_TO_LABEL = {
  brouillon:           'Brouillon',
  emise:               'Envoyée',
  payee:               'Payée',
  partiellement_payee: 'Part. payée',
  annulee:             'Annulée',
};

const STATUT_LABEL_TO_API = {
  'Brouillon':    'brouillon',
  'Envoyée':      'emise',
  'Payée':        'payee',
  'Part. payée':  'partiellement_payee',
  'Annulée':      'annulee',
};

function mapApiFacture(f) {
  const statutLabel = STATUT_API_TO_LABEL[f.statut] || f.statut || 'Brouillon';
  const totalTTC    = parseFloat(f.total_ttc)    || 0;
  const totalHT     = parseFloat(f.total_ht)     || 0;
  const totalTVA    = parseFloat(f.total_tva)    || 0;
  const montantPaye = parseFloat(f.montant_paye) || 0;
  const reste       = Math.max(0, totalTTC - montantPaye);

  return {
    // Champs normalisés (compatibles avec le reste du code)
    id:             f.id,
    number:         f.numero,
    clientId:       f.client_id  || null,
    clientName:     f.client_nom || '—',
    description:    f.notes      || '',
    subtotalHT:     totalHT,
    tva:            totalTVA,
    totalTTC,
    montantPaye,
    resteAPayer:    reste,
    status:         statutLabel,
    createdAt:      f.date_emission || f.created_at || new Date().toISOString(),
    hash_nf525:     f.hash_nf525   || null,
    locked:         f.locked        === 1 || f.locked === true,
    issued_at:      f.issued_at     || null,
    // Champs bruts API (préservés pour les opérations serveur)
    _statut:        f.statut,
    _raw:           f,
  };
}

// ─── Chargement principal ─────────────────────────────────────────────────────
async function loadFactures() {
  const session    = requireAuth();
  const boutiqueId = getBoutiqueId();

  if (!boutiqueId) {
    facturesUseApi = false;
    loadFacturesFallback();
    return;
  }

  try {
    const result = await apiGet('/api/factures', { limit: 200, boutique_id: boutiqueId });

    if (result.ok) {
      allFacturesCache = (result.data?.data || []).map(mapApiFacture);
      setDB('factures', allFacturesCache);   // sync localStorage
      facturesUseApi = true;
    } else {
      console.warn('[factures] API KO, fallback localStorage', result.status);
      facturesUseApi = false;
      loadFacturesFallback();
      return;
    }
  } catch (err) {
    console.warn('[factures] Erreur réseau, fallback localStorage', err);
    facturesUseApi = false;
    loadFacturesFallback();
    return;
  }

  renderFactures();
}

function loadFacturesFallback() {
  const raw = getDB('factures');
  // Normaliser les entrées localStorage (peuvent être dans l'ancien format)
  allFacturesCache = raw.map(f => ({
    id:          f.id,
    number:      f.number      || f.numero    || '—',
    clientId:    f.clientId    || f.client_id || null,
    clientName:  f.clientName  || f.client_nom || '—',
    description: f.description || f.notes     || '',
    subtotalHT:  parseFloat(f.subtotalHT || f.total_ht)   || 0,
    tva:         parseFloat(f.tva        || f.total_tva)  || 0,
    totalTTC:    parseFloat(f.totalTTC   || f.total_ttc)  || 0,
    montantPaye: parseFloat(f.montantPaye|| f.montant_paye)|| 0,
    resteAPayer: Math.max(0, parseFloat(f.totalTTC || 0) - parseFloat(f.montantPaye || 0)),
    status:      f.status || 'Brouillon',
    createdAt:   f.createdAt || f.date_emission || new Date().toISOString(),
    hash_nf525:  f.hash_nf525 || null,
    _statut:     STATUT_LABEL_TO_API[f.status] || 'brouillon',
  }));
  renderFactures();
}

// ─── Rendu liste + KPIs ───────────────────────────────────────────────────────
function renderFactures(filter = '', statusFilter = '') {
  let data = allFacturesCache;

  // Filtrage texte
  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(f =>
      f.clientName?.toLowerCase().includes(q) ||
      f.number?.toLowerCase().includes(q) ||
      f.description?.toLowerCase().includes(q)
    );
  }

  // Filtrage statut
  if (statusFilter) {
    data = data.filter(f => f.status === statusFilter);
  }

  // ── KPIs (toujours calculés sur le cache complet) ──────────────────────────
  const all = allFacturesCache;
  const now = new Date();

  const caTotal     = all.reduce((s, f) => s + f.totalTTC, 0);
  const encaisse    = all.reduce((s, f) => s + f.montantPaye, 0);
  const enAttente   = all
    .filter(f => f._statut === 'emise' || f._statut === 'partiellement_payee')
    .reduce((s, f) => s + f.resteAPayer, 0);
  const enRetard    = all
    .filter(f => {
      if (f._statut !== 'emise' && f._statut !== 'partiellement_payee') return false;
      const dateEmission = new Date(f.createdAt);
      const echeance    = new Date(dateEmission.getTime() + 30 * 24 * 60 * 60 * 1000); // 30j
      return echeance < now;
    })
    .reduce((s, f) => s + f.resteAPayer, 0);

  const setKpi = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof val === 'number' ? formatMoney(val) : val;
  };
  setKpi('kpi-ca',      caTotal);
  setKpi('kpi-paid',    encaisse);
  setKpi('kpi-pending', enAttente);
  setKpi('kpi-overdue', enRetard);

  // ── Table ─────────────────────────────────────────────────────────────────
  const tbody = document.getElementById('factures-table');
  const empty = document.getElementById('factures-empty');
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(f => {
    const dateEmission = new Date(f.createdAt);
    const echeance     = new Date(dateEmission.getTime() + 30 * 24 * 60 * 60 * 1000);
    const isOverdue    = echeance < now && f._statut === 'emise';
    const echeanceStr  = formatDate(echeance.toISOString(), false);
    const nf525Badge   = f.hash_nf525
      ? `<span title="NF525 : ${esc(f.hash_nf525.slice(0, 16))}…" style="color:var(--green);font-size:0.78rem;margin-left:4px;">🔐</span>`
      : '';
    // Badge verrouillage CGI art. 289
    const lockBadge    = f.locked
      ? `<span title="Émise le ${f.issued_at ? new Date(f.issued_at).toLocaleDateString('fr-FR') : '—'} — Inaltérable (CGI art. 289)" style="color:var(--muted);font-size:0.78rem;margin-left:4px;">🔒</span>`
      : '';

    // Boutons actions contextuels
    const btnPrint   = `<button class="btn btn-ghost btn-sm" onclick="printFacture(${f.id})" title="Imprimer / PDF">🖨</button>`;
    const btnEmettre = !f.locked
      ? `<button class="btn btn-ghost btn-icon" onclick="emettreFacture(${f.id})" title="Émettre et verrouiller (CGI art. 289)" style="color:var(--primary);font-weight:700;">📤</button>`
      : '';
    const btnPaiement = !f.locked && f._statut !== 'payee' && f._statut !== 'annulee'
      ? `<button class="btn btn-ghost btn-icon" onclick="openMarkAsPaid(${f.id})" title="Enregistrer un paiement" style="color:var(--green);">💰</button>`
      : (f.locked && f._statut !== 'payee' && f._statut !== 'annulee'
          ? `<button class="btn btn-ghost btn-icon" onclick="openMarkAsPaid(${f.id})" title="Enregistrer un paiement" style="color:var(--green);">💰</button>`
          : '');
    const btnAvoir   = f.locked
      ? `<button class="btn btn-ghost btn-icon" onclick="openModalAvoir(${f.id})" title="Créer un avoir (NF525)" style="color:var(--accent);">↩️</button>`
      : '';
    const btnDelete  = !f.locked
      ? `<button class="btn btn-ghost btn-icon" onclick="deleteFacture(${f.id})" style="color:var(--red);" title="Supprimer">🗑</button>`
      : `<button class="btn btn-ghost btn-icon" disabled title="Facture verrouillée — non supprimable (NF525)" style="color:var(--muted);cursor:not-allowed;">🗑</button>`;

    return `
    <tr>
      <td>
        <span style="font-weight:700;color:var(--primary);">${esc(f.number)}</span>
        ${nf525Badge}${lockBadge}
      </td>
      <td>${esc(f.clientName)}</td>
      <td><span style="font-size:0.88rem;">${esc(f.description).slice(0, 40)}${f.description?.length > 40 ? '…' : ''}</span></td>
      <td>${formatMoney(f.subtotalHT)}</td>
      <td>${formatMoney(f.tva)}</td>
      <td><strong>${formatMoney(f.totalTTC)}</strong></td>
      <td>${statusBadgeFacture(f.status)}</td>
      <td>${formatDate(f.createdAt, true)}</td>
      <td style="${isOverdue ? 'color:var(--red);font-weight:700;' : ''}">
        ${echeanceStr}${isOverdue ? ' ⚠️' : ''}
      </td>
      <td>
        <div class="row-actions">
          ${btnPrint}${btnEmettre}${btnPaiement}${btnAvoir}${btnDelete}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Badge statut factures (avec les labels propres au module)
function statusBadgeFacture(status) {
  const map = {
    'Brouillon':   'status-badge status-new',
    'Envoyée':     'status-badge status-progress',
    'Part. payée': 'status-badge status-progress',
    'Payée':       'status-badge status-done',
    'Annulée':     'status-badge status-cancelled',
  };
  const cls = map[status] || 'status-badge';
  return `<span class="${cls}">${esc(status)}</span>`;
}

// ─── Filtres ──────────────────────────────────────────────────────────────────
function filterFactures(val) { renderFactures(val); }
function filterFactureStatus(val) { renderFactures('', val); }

// ─── Chargement clients (select modal) ────────────────────────────────────────
async function loadClientsForFactures() {
  const session    = requireAuth();
  const boutiqueId = getBoutiqueId();

  try {
    const result = await apiGet('/api/clients', { limit: 500, boutique_id: boutiqueId });
    if (result.ok && result.data?.data) {
      allClientsForFactures = result.data.data;
    } else {
      allClientsForFactures = getDB('clients');
    }
  } catch {
    allClientsForFactures = getDB('clients');
  }

  populateFactureClients();
}

function populateFactureClients() {
  const select = document.getElementById('f-client');
  if (!select) return;

  // Vider sauf le placeholder
  select.innerHTML = '<option value="">Sélectionner un client…</option>';

  allClientsForFactures.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    // Compatibilité ancien format localStorage (first/last) vs API (prenom/nom)
    const nom = c.prenom && c.nom
      ? `${c.prenom} ${c.nom}`
      : (c.name || `${c.first || ''} ${c.last || ''}`.trim() || c.clientName || `Client #${c.id}`);
    opt.textContent = nom;
    if (c.entreprise || c.company) opt.textContent += ` (${c.entreprise || c.company})`;
    select.appendChild(opt);
  });
}

// ─── Chargement devis acceptés (select source) ───────────────────────────────
async function loadDevisAcceptesForSelect() {
  const session    = requireAuth();
  const boutiqueId = getBoutiqueId();

  try {
    const result = await apiGet('/api/devis', {
      limit: 200,
      boutique_id: boutiqueId,
      statut: 'accepte',
    });
    if (result.ok && result.data?.data) {
      allDevisAcceptes = result.data.data;
    } else {
      // Fallback : cache local devis (filtre accepté ou envoyé)
      allDevisAcceptes = getDB('devis').filter(d =>
        d.status === 'Accepté' || d.status === 'Envoyé' || d._statut === 'accepte'
      );
    }
  } catch {
    allDevisAcceptes = getDB('devis').filter(d =>
      d.status === 'Accepté' || d.status === 'Envoyé'
    );
  }

  populateDevisSelect();
}

function populateDevisSelect() {
  const select = document.getElementById('f-devis');
  if (!select) return;

  select.innerHTML = '<option value="">Créer sans devis</option>';
  allDevisAcceptes.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    const numero     = d.numero  || d.number || `#${d.id}`;
    const clientNom  = d.client_nom || d.clientName || '—';
    const montant    = formatMoney(parseFloat(d.total_ttc || d.totalTTC) || 0);
    opt.textContent  = `${numero} — ${clientNom} — ${montant}`;
    select.appendChild(opt);
  });
}

// ─── Pré-remplissage depuis devis (flux devis → facture) ─────────────────────
function checkFromDevis() {
  const stored = localStorage.getItem('izigsm_devis_to_facture');
  if (!stored) return;
  localStorage.removeItem('izigsm_devis_to_facture');

  let d;
  try { d = JSON.parse(stored); } catch { return; }

  openNewFacture();

  setTimeout(() => {
    // Client
    const clientSelect = document.getElementById('f-client');
    if (clientSelect && d.clientId) clientSelect.value = d.clientId;

    // Description
    const desc = document.getElementById('f-description');
    if (desc) desc.value = d.description || '';

    // Devis source
    const devisSelect = document.getElementById('f-devis');
    if (devisSelect && d.devisId) devisSelect.value = d.devisId;

    // Lignes
    if (d.lines?.length) {
      factureLines = [];
      document.getElementById('facture-lines').innerHTML = '';

      d.lines.forEach(l => {
        addFactureLine();
        const lid    = factureLines[factureLines.length - 1];
        const descEl = document.getElementById('fl-desc-'  + lid);
        const qtyEl  = document.getElementById('fl-qty-'   + lid);
        const priceEl= document.getElementById('fl-price-' + lid);
        if (descEl)  descEl.value  = l.desc || l.description || '';
        if (qtyEl)   qtyEl.value   = l.qty  || l.quantite    || 1;
        if (priceEl) priceEl.value = l.unitPrice || l.prix_unitaire_ht || '';
        updateFactureLineTotals(lid);
      });
    }
  }, 150);
}

// ─── Ouverture modal nouvelle facture ────────────────────────────────────────
function openNewFacture() {
  currentFactureId = null;

  factureLines = [];
  document.getElementById('facture-lines').innerHTML = '';
  ['f-description', 'f-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const statusEl = document.getElementById('f-status');
  if (statusEl) statusEl.value = 'Brouillon';

  const modalTitle = document.getElementById('modal-facture-title');
  if (modalTitle) modalTitle.textContent = 'Nouvelle facture';

  addFactureLine();
  updateFactureTotals();
  openModal('modal-facture');
}

// ─── Sauvegarde facture (POST /api/factures) ──────────────────────────────────
async function saveFacture(statusLabel) {
  const clientSelect = document.getElementById('f-client');
  const clientId     = parseInt(clientSelect?.value, 10) || null;
  const devisSelect  = document.getElementById('f-devis');
  const devisId      = parseInt(devisSelect?.value, 10)  || null;
  const description  = document.getElementById('f-description')?.value.trim() || '';
  const notes        = document.getElementById('f-notes')?.value.trim() || '';
  const paymentEl    = document.getElementById('f-payment');
  const modeLabel    = paymentEl?.value || 'Virement bancaire';

  if (!clientId) {
    showFlash('⚠️ Veuillez sélectionner un client.', 'error');
    return;
  }

  // Construire les lignes
  const lignes = factureLines.map(lid => ({
    description:      document.getElementById('fl-desc-'  + lid)?.value || '',
    quantite:         parseFloat(document.getElementById('fl-qty-'   + lid)?.value) || 1,
    prix_unitaire_ht: parseFloat(document.getElementById('fl-price-' + lid)?.value) || 0,
    tva_taux:         20,
  })).filter(l => l.description || l.prix_unitaire_ht > 0);

  if (!lignes.length) {
    showFlash('⚠️ Ajoutez au moins une ligne à la facture.', 'error');
    return;
  }

  const statut     = STATUT_LABEL_TO_API[statusLabel] || 'brouillon';
  const session    = requireAuth();
  const boutiqueId = getBoutiqueId();

  const payload = {
    client_id:    clientId,
    devis_id:     devisId,
    boutique_id:  boutiqueId,
    statut,
    lignes,
    notes:        description + (notes ? '\n' + notes : ''),
    mode_paiement_prefere: modeLabel,
  };

  if (facturesUseApi) {
    try {
      const result = await apiPost('/api/factures', payload);
      if (result.ok) {
        const numero = result.data?.numero || result.data?.id || '?';
        closeModal('modal-facture');
        showFlash(`✓ Facture ${numero} ${statusLabel === 'Envoyée' ? 'envoyée' : 'enregistrée'}`, 'success');
        await loadFactures();
        return;
      } else {
        const msg = result.data?.error || 'Erreur lors de la création.';
        showFlash(`⚠️ ${msg}`, 'error');
        // En cas d'erreur API non fatale, on essaie le fallback localStorage
        if (result.status >= 500) {
          saveFactureFallback(payload, statusLabel, modeLabel, boutiqueId);
        }
        return;
      }
    } catch (err) {
      console.warn('[factures] saveFacture erreur réseau', err);
      saveFactureFallback(payload, statusLabel, modeLabel, boutiqueId);
      return;
    }
  }

  saveFactureFallback(payload, statusLabel, modeLabel, boutiqueId);
}

function saveFactureFallback(payload, statusLabel, modeLabel, boutiqueId) {
  const existing   = getDB('factures');
  const subtotalHT = (payload.lignes || []).reduce((s, l) =>
    s + l.quantite * l.prix_unitaire_ht, 0);
  const tva    = subtotalHT * 0.2;
  const totalTTC = subtotalHT + tva;

  const clientName = allClientsForFactures.find(c => c.id == payload.client_id)
    ? (() => {
        const c = allClientsForFactures.find(c => c.id == payload.client_id);
        return c.prenom && c.nom
          ? `${c.prenom} ${c.nom}`
          : (c.name || `Client #${c.id}`);
      })()
    : `Client #${payload.client_id}`;

  const item = {
    id:          Date.now(),
    number:      generateNumber('FAC-2026-', existing),
    clientId:    payload.client_id,
    clientName,
    description: payload.notes || '',
    lines:       payload.lignes,
    subtotalHT,
    tva,
    totalTTC,
    montantPaye: 0,
    resteAPayer: totalTTC,
    status:      statusLabel,
    paymentMethod: modeLabel,
    createdAt:   new Date().toISOString(),
    _statut:     STATUT_LABEL_TO_API[statusLabel] || 'brouillon',
  };

  addToDB('factures', item);
  allFacturesCache = getDB('factures').map(f => ({
    ...f,
    _statut: f._statut || STATUT_LABEL_TO_API[f.status] || 'brouillon',
    resteAPayer: Math.max(0, (f.totalTTC || 0) - (f.montantPaye || 0)),
  }));
  closeModal('modal-facture');
  showFlash(`✓ Facture ${item.number} enregistrée (mode hors-ligne)`, 'success');
  renderFactures();
}

// ─── Modal paiement ───────────────────────────────────────────────────────────
let _paiementFactureId = null;

function openMarkAsPaid(id) {
  const facture = allFacturesCache.find(f => f.id == id);
  if (!facture) return;

  _paiementFactureId = id;

  // Créer/réutiliser le modal de paiement
  let modal = document.getElementById('modal-paiement');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modal-paiement';
    modal.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h2>Enregistrer un paiement</h2>
          <button class="modal-close" onclick="closeModal('modal-paiement')">✕</button>
        </div>
        <div class="modal-body">
          <p id="paiement-info" style="font-size:0.9rem;color:var(--muted);margin-bottom:16px;"></p>
          <div class="form-grid">
            <div class="form-field">
              <label>Montant encaissé (€) *</label>
              <input type="number" id="paiement-montant" min="0.01" step="0.01" placeholder="0.00" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font:inherit;">
            </div>
            <div class="form-field">
              <label>Mode de paiement *</label>
              <select id="paiement-mode" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font:inherit;">
                <option value="especes">Espèces</option>
                <option value="carte">Carte bancaire</option>
                <option value="virement">Virement bancaire</option>
                <option value="cheque">Chèque</option>
              </select>
            </div>
            <div class="form-field full">
              <label>Référence / N° chèque (optionnel)</label>
              <input type="text" id="paiement-ref" placeholder="Ex: CHQ-001234" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font:inherit;">
            </div>
            <div class="form-field full">
              <label>Notes internes</label>
              <textarea id="paiement-notes" rows="2" placeholder="Observations…" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font:inherit;resize:vertical;"></textarea>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('modal-paiement')">Annuler</button>
          <button class="btn btn-primary" onclick="confirmPaiement()">💰 Confirmer le paiement</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  // Pré-remplir le reste à payer
  const infoEl = document.getElementById('paiement-info');
  if (infoEl) {
    infoEl.innerHTML =
      `<strong>${esc(facture.number)}</strong> — ${esc(facture.clientName)}<br>` +
      `Total TTC : <strong>${formatMoney(facture.totalTTC)}</strong> | ` +
      `Déjà encaissé : ${formatMoney(facture.montantPaye)} | ` +
      `Reste à payer : <strong style="color:var(--accent-strong);">${formatMoney(facture.resteAPayer)}</strong>`;
  }
  const montantEl = document.getElementById('paiement-montant');
  if (montantEl) montantEl.value = facture.resteAPayer.toFixed(2);

  openModal('modal-paiement');
}

async function confirmPaiement() {
  const id        = _paiementFactureId;
  const montant   = parseFloat(document.getElementById('paiement-montant')?.value) || 0;
  const mode      = document.getElementById('paiement-mode')?.value || 'especes';
  const reference = document.getElementById('paiement-ref')?.value.trim() || null;
  const notes     = document.getElementById('paiement-notes')?.value.trim() || null;

  if (!id || montant <= 0) {
    showFlash('⚠️ Montant invalide.', 'error');
    return;
  }

  if (facturesUseApi) {
    try {
      const result = await apiPost(`/api/factures/${id}/paiement`, {
        montant,
        mode_paiement: mode,
        reference,
        notes,
      });

      if (result.ok) {
        closeModal('modal-paiement');
        showFlash(`✓ Paiement de ${formatMoney(montant)} enregistré — ${result.data?.statut === 'payee' ? 'Facture soldée ✅' : 'Paiement partiel'}`, 'success');
        await loadFactures();
        return;
      } else {
        const msg = result.data?.error || 'Erreur lors de l\'enregistrement.';
        showFlash(`⚠️ ${msg}`, 'error');
        return;
      }
    } catch (err) {
      console.warn('[factures] confirmPaiement erreur réseau', err);
      // Fallback localStorage
    }
  }

  // Fallback localStorage
  const facture = allFacturesCache.find(f => f.id == id);
  if (facture) {
    const nouveauMontantPaye = facture.montantPaye + montant;
    const solde              = nouveauMontantPaye >= facture.totalTTC ? 'Payée' : 'Part. payée';
    updateInDB('factures', id, { status: solde, montantPaye: nouveauMontantPaye });
    allFacturesCache = allFacturesCache.map(f =>
      f.id == id ? { ...f, status: solde, montantPaye: nouveauMontantPaye,
                      resteAPayer: Math.max(0, f.totalTTC - nouveauMontantPaye),
                      _statut: STATUT_LABEL_TO_API[solde] || 'payee' } : f
    );
  }
  closeModal('modal-paiement');
  showFlash(`✓ Paiement de ${formatMoney(montant)} enregistré (hors-ligne)`, 'success');
  renderFactures();
}

// Alias legacy (utilisé dans le HTML inline onClick) → redirige vers openMarkAsPaid
function markAsPaid(id) { openMarkAsPaid(id); }

// ─── Suppression ─────────────────────────────────────────────────────────────
async function deleteFacture(id) {
  if (!confirm('Supprimer cette facture définitivement ? Cette action est irréversible.')) return;

  if (facturesUseApi) {
    try {
      const result = await apiDelete('/api/factures/' + id);
      if (result.ok) {
        allFacturesCache = allFacturesCache.filter(f => f.id != id);
        setDB('factures', allFacturesCache);
        renderFactures();
        showFlash('✓ Facture supprimée.', 'info');
        return;
      } else {
        // L'API factures peut ne pas exposer DELETE (factures inaltérables NF525)
        // On informe l'utilisateur
        showFlash('ℹ️ Les factures NF525 ne peuvent pas être supprimées (conformité légale). Vous pouvez les annuler.', 'info');
        return;
      }
    } catch (err) {
      console.warn('[factures] deleteFacture erreur réseau', err);
    }
  }

  // Fallback localStorage
  deleteFromDB('factures', id);
  allFacturesCache = allFacturesCache.filter(f => f.id != id);
  renderFactures();
  showFlash('✓ Facture supprimée (hors-ligne).', 'info');
}

// ─── Émission facture (CGI art. 289 — verrouillage) ─────────────────────────
async function emettreFacture(id) {
  const facture = allFacturesCache.find(f => f.id == id);
  if (!facture) return;
  if (facture.locked) {
    showFlash('ℹ️ Facture déjà émise et verrouillée.', 'info');
    return;
  }

  const confirm = window.confirm(
    `Émettre la facture ${esc(facture.number)} ?\n\n` +
    `⚠️ ATTENTION : Une fois émise, la facture sera verrouillée et ne pourra plus être modifiée (CGI art. 289).\n\n` +
    `Cliquez OK pour confirmer.`
  );
  if (!confirm) return;

  try {
    const result = await apiPost(`/api/factures/${id}/emettre`, {});
    if (result.ok) {
      showFlash(`✅ Facture ${esc(facture.number)} émise et verrouillée. Hash NF525 enregistré.`, 'success');
      await loadFactures();
    } else {
      const msg = result.data?.error || 'Erreur lors de l\'émission.';
      showFlash(`⚠️ ${msg}`, 'error');
    }
  } catch (err) {
    console.warn('[factures] emettreFacture erreur réseau', err);
    showFlash('⚠️ Erreur réseau — réessayez.', 'error');
  }
}

// ─── Modal Avoir (NF525) ──────────────────────────────────────────────────────
function openModalAvoir(factureId) {
  const facture = allFacturesCache.find(f => f.id == factureId);
  if (!facture) return;
  if (!facture.locked) {
    showFlash('⚠️ L\'avoir ne peut être émis que sur une facture émise.', 'error');
    return;
  }

  _avoirFactureId = factureId;
  avoirLines      = [];

  // Créer/réutiliser le modal avoir
  let modal = document.getElementById('modal-avoir');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modal-avoir';
    modal.innerHTML = `
      <div class="modal" style="max-width:640px;">
        <div class="modal-header">
          <h2>↩️ Créer un avoir — <span id="avoir-facture-numero"></span></h2>
          <button class="modal-close" onclick="closeModal('modal-avoir')">✕</button>
        </div>
        <div class="modal-body">
          <p id="avoir-facture-info" style="font-size:0.88rem;color:var(--muted);margin-bottom:16px;"></p>

          <div class="form-grid" style="grid-template-columns:1fr 1fr;">
            <div class="form-field">
              <label>Type d'avoir *</label>
              <select id="avoir-type" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font:inherit;">
                <option value="remboursement">Remboursement</option>
                <option value="bon_achat">Bon d'achat</option>
                <option value="echange">Échange</option>
              </select>
            </div>
            <div class="form-field">
              <label>Motif *</label>
              <input type="text" id="avoir-motif" placeholder="Ex: Retour produit défectueux"
                style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font:inherit;">
            </div>
            <div class="form-field full">
              <label>Notes internes</label>
              <textarea id="avoir-notes" rows="2" placeholder="Observations…"
                style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;font:inherit;resize:vertical;"></textarea>
            </div>
          </div>

          <hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb;">
          <h4 style="margin:0 0 8px;font-size:0.95rem;">Lignes de l'avoir</h4>
          <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
            <thead><tr style="color:var(--muted);">
              <th style="padding:4px 8px;text-align:left;">Description</th>
              <th style="padding:4px 8px;text-align:right;width:70px;">Qté</th>
              <th style="padding:4px 8px;text-align:right;width:100px;">P.U. HT (€)</th>
              <th style="padding:4px 8px;text-align:right;width:90px;">Total HT</th>
              <th style="width:32px;"></th>
            </tr></thead>
            <tbody id="avoir-lines"></tbody>
          </table>
          <button class="btn btn-ghost btn-sm" onclick="addAvoirLine()" style="margin-top:8px;">+ Ajouter une ligne</button>

          <div style="margin-top:12px;text-align:right;font-size:0.9rem;">
            <span style="color:var(--muted);">Total HT :</span> <strong id="avoir-total-ht">0,00 €</strong> &nbsp;
            <span style="color:var(--muted);">TVA 20% :</span> <strong id="avoir-total-tva">0,00 €</strong> &nbsp;
            <span style="color:var(--muted);">Total TTC :</span> <strong id="avoir-total-ttc" style="color:var(--primary);">0,00 €</strong>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal('modal-avoir')">Annuler</button>
          <button class="btn btn-primary" onclick="confirmAvoir()">↩️ Émettre l'avoir (NF525)</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  // Remplir les infos de la facture source
  const numEl  = document.getElementById('avoir-facture-numero');
  const infoEl = document.getElementById('avoir-facture-info');
  if (numEl)  numEl.textContent  = facture.number;
  if (infoEl) infoEl.innerHTML   =
    `Facture source : <strong>${esc(facture.number)}</strong> — ${esc(facture.clientName)} — ` +
    `Total TTC : <strong>${formatMoney(facture.totalTTC)}</strong>`;

  // Réinitialiser le formulaire
  const avoirType  = document.getElementById('avoir-type');  if (avoirType)  avoirType.value  = 'remboursement';
  const avoirMotif = document.getElementById('avoir-motif'); if (avoirMotif) avoirMotif.value = '';
  const avoirNotes = document.getElementById('avoir-notes'); if (avoirNotes) avoirNotes.value = '';
  const avoirLinesEl = document.getElementById('avoir-lines'); if (avoirLinesEl) avoirLinesEl.innerHTML = '';
  updateAvoirTotals();
  addAvoirLine();  // une ligne vide par défaut

  openModal('modal-avoir');
}

function addAvoirLine() {
  const lid    = Date.now() + Math.random();
  avoirLines.push(lid);
  const tbody  = document.getElementById('avoir-lines');
  if (!tbody) return;
  const tr     = document.createElement('tr');
  tr.id        = 'al-row-' + lid;
  tr.innerHTML = `
    <td style="padding:4px 8px;">
      <input type="text" id="al-desc-${lid}" placeholder="Description…"
        style="width:100%;border:1px solid #e5e7eb;border-radius:6px;padding:5px 8px;font:inherit;font-size:0.88rem;">
    </td>
    <td style="padding:4px 8px;">
      <input type="number" id="al-qty-${lid}" value="1" min="0.01" step="0.01"
        style="width:65px;border:1px solid #e5e7eb;border-radius:6px;padding:5px 6px;font:inherit;font-size:0.88rem;text-align:right;"
        oninput="updateAvoirLineTotals(${lid})">
    </td>
    <td style="padding:4px 8px;">
      <input type="number" id="al-price-${lid}" value="" min="0" step="0.01" placeholder="0.00"
        style="width:90px;border:1px solid #e5e7eb;border-radius:6px;padding:5px 6px;font:inherit;font-size:0.88rem;text-align:right;"
        oninput="updateAvoirLineTotals(${lid})">
    </td>
    <td style="padding:4px 8px;text-align:right;">
      <span id="al-total-${lid}" style="font-weight:600;">0,00 €</span>
    </td>
    <td style="padding:4px 4px;text-align:center;">
      <button onclick="removeAvoirLine(${lid})"
        style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:1rem;" title="Supprimer">✕</button>
    </td>`;
  tbody.appendChild(tr);
}

function removeAvoirLine(lid) {
  if (avoirLines.length <= 1) {
    showFlash('ℹ️ Au moins une ligne est requise.', 'info');
    return;
  }
  avoirLines = avoirLines.filter(l => l !== lid);
  document.getElementById('al-row-' + lid)?.remove();
  updateAvoirTotals();
}

function updateAvoirLineTotals(lid) {
  const qty   = parseFloat(document.getElementById('al-qty-'   + lid)?.value) || 0;
  const price = parseFloat(document.getElementById('al-price-' + lid)?.value) || 0;
  const total = qty * price;
  const el    = document.getElementById('al-total-' + lid);
  if (el) el.textContent = formatMoney(total);
  updateAvoirTotals();
}

function updateAvoirTotals() {
  const totalHT = avoirLines.reduce((s, lid) => {
    const qty   = parseFloat(document.getElementById('al-qty-'   + lid)?.value) || 0;
    const price = parseFloat(document.getElementById('al-price-' + lid)?.value) || 0;
    return s + qty * price;
  }, 0);
  const tva = totalHT * 0.2;
  const ttc = totalHT + tva;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatMoney(val); };
  set('avoir-total-ht',  totalHT);
  set('avoir-total-tva', tva);
  set('avoir-total-ttc', ttc);
}

async function confirmAvoir() {
  const type  = document.getElementById('avoir-type')?.value  || 'remboursement';
  const motif = document.getElementById('avoir-motif')?.value.trim() || '';
  const notes = document.getElementById('avoir-notes')?.value.trim() || null;

  if (!motif) {
    showFlash('⚠️ Le motif est obligatoire.', 'error');
    return;
  }

  // Construire les lignes
  const lignes = avoirLines.map(lid => ({
    description:      document.getElementById('al-desc-'  + lid)?.value.trim() || '',
    quantite:         parseFloat(document.getElementById('al-qty-'   + lid)?.value) || 1,
    prix_unitaire_ht: parseFloat(document.getElementById('al-price-' + lid)?.value) || 0,
    tva_taux:         20,
  })).filter(l => l.description || l.prix_unitaire_ht > 0);

  if (!lignes.length) {
    showFlash('⚠️ Ajoutez au moins une ligne à l\'avoir.', 'error');
    return;
  }

  const payload = {
    facture_id: _avoirFactureId,
    type,
    motif,
    notes,
    lignes,
  };

  try {
    const result = await apiPost('/api/avoirs', payload);
    if (result.ok) {
      const numero = result.data?.numero || '?';
      closeModal('modal-avoir');
      showFlash(`✅ Avoir ${numero} émis et enregistré dans le journal NF525.`, 'success');
      await loadFactures();
    } else {
      const msg = result.data?.error || 'Erreur lors de la création de l\'avoir.';
      showFlash(`⚠️ ${msg}`, 'error');
    }
  } catch (err) {
    console.warn('[factures] confirmAvoir erreur réseau', err);
    showFlash('⚠️ Erreur réseau — réessayez.', 'error');
  }
}

// ─── Impression / PDF (Sprint 2.13) ──────────────────────────────────────────
// Principe P4 : fonction principale déléguant à 3 sous-fonctions spécialisées.
// _money() et _fmtDate() proviennent de app.js (Principe P2 — centralisation).

/**
 * Point d'entrée public pour l'impression d'une facture.
 * Orchestre les 3 étapes : récupération API → construction HTML → déclenchement print.
 *
 * @param {number} id - ID de la facture à imprimer
 * @returns {Promise<void>}
 */
async function printFacture(id) {
  try {
    const data = await _fetchFacturePrintData(id);
    if (!data) return;
    const html = _buildFactureHTML(data);
    _triggerPrint(html);
  } catch (err) {
    console.error('[printFacture]', err);
    showFlash('⚠️ Erreur lors de la génération PDF.', 'error');
  }
}

/**
 * Récupère et normalise les données nécessaires à l'impression d'une facture :
 * détail facture (lignes, paiements) + profil boutique.
 *
 * @param {number} id - ID de la facture
 * @returns {Promise<object|null>} Objet normalisé prêt pour `_buildFactureHTML`,
 *          ou null si l'API retourne une erreur (flash affiché)
 */
async function _fetchFacturePrintData(id) {
  const boutiqueId = getBoutiqueId();
  const r = await apiGet(`/api/factures/${id}`, boutiqueId ? { boutique_id: boutiqueId } : {});
  if (!r.ok) {
    showFlash('⚠️ Impossible de récupérer la facture.', 'error');
    return null;
  }

  const f   = r.data?.data || r.data || {};
  const raw = f._raw || f;

  // Profil boutique (non bloquant — valeurs par défaut si API KO)
  let boutique = { nom: 'iziGSM', adresse: '', siret: '', telephone: '', email: '' };
  try {
    const bs = await apiGet('/api/boutiques');
    const b  = (bs.data?.data || bs.data || [])[0] || {};
    boutique = {
      nom:       b.nom       || b.name   || 'iziGSM',
      adresse:   b.adresse   || b.address || '',
      siret:     b.siret     || '',
      telephone: b.telephone || b.phone  || '',
      email:     b.email     || '',
    };
  } catch {}

  const lignes    = raw.lignes    || f.lignes    || [];
  const paiements = raw.paiements || f.paiements || [];
  const totalHT   = parseFloat(raw.total_ht  || f.totalHT  || f.subtotalHT || 0);
  const totalTVA  = parseFloat(raw.total_tva || f.tva      || 0);
  const totalTTC  = parseFloat(raw.total_ttc || f.totalTTC || 0);
  const paye      = paiements.reduce((s, p) => s + parseFloat(p.montant || 0), 0);

  return {
    boutique,
    lignes,
    paiements,
    totalHT,
    totalTVA,
    totalTTC,
    reste:        Math.max(0, totalTTC - paye),
    numero:       raw.numero  || f.number  || f.numero  || ('FAC-' + id),
    dateEm:       raw.date_emission  || f.createdAt || new Date().toISOString(),
    dateEch:      raw.date_echeance  || '',
    statut:       raw.statut  || f._statut || f.status || 'brouillon',
    notes:        raw.notes   || f.description || '',
    clientNom:    raw.client_nom       || f.clientName || '—',
    clientEmail:  raw.client_email     || '',
    clientTel:    raw.client_telephone || raw.client_tel || '',
    clientAdresse: raw.client_adresse  || '',
    hash_nf525:   raw.hash_nf525       || '',
  };
}

/**
 * Construit le HTML complet du document facture pour impression.
 * Utilise print.css via lien relatif (injecté dans le DOM au moment du print).
 *
 * @param {object} d - Données normalisées retournées par `_fetchFacturePrintData`
 * @returns {string} HTML complet prêt à être injecté dans #print-root
 */
function _buildFactureHTML(d) {
  const badgeCls = {
    payee:    'print-badge-paid',
    brouillon:'print-badge-draft',
    emise:    'print-badge-sent',
    annulee:  'print-badge-cancel',
  }[d.statut] || 'print-badge-draft';

  const badgeLbl = {
    payee:'Payée', brouillon:'Brouillon', emise:'Émise', annulee:'Annulée',
  }[d.statut] || d.statut;

  const lignesHTML = d.lignes.length
    ? d.lignes.map(l => `
        <tr>
          <td>${esc(l.description || l.designation || '—')}</td>
          <td class="text-center">${parseFloat(l.quantite || 1).toLocaleString('fr-FR')}</td>
          <td class="text-right">${_money(l.prix_unitaire_ht)}</td>
          <td class="text-center">${parseFloat(l.tva_taux || 20)}%</td>
          <td class="text-right"><strong>${_money(l.total_ttc)}</strong></td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:8px;">Aucune ligne</td></tr>`;

  const paiementsHTML = d.paiements.length ? `
    <div class="print-paiements print-no-break">
      <div class="print-paiements-title">Règlements enregistrés</div>
      ${d.paiements.map(p => `
        <div class="print-paiement-row">
          <span>${_fmtDate(p.date_paiement)} — ${esc(p.mode_paiement || '—')}</span>
          <span>${_money(p.montant)}</span>
        </div>`).join('')}
      <div class="print-solde">
        <span>Reste à payer</span>
        <span style="color:${d.reste <= 0 ? '#22c55e' : '#ef4444'};">${_money(d.reste)}</span>
      </div>
    </div>` : '';

  return `
    <div id="print-root">
      <link rel="stylesheet" href="/static/css/print.css">

      <div class="print-header print-no-break">
        <div class="print-logo">
          <div class="print-logo-mark">i</div>
          <div class="print-logo-name">iziGSM</div>
        </div>
        <div class="print-boutique-info">
          <strong>${esc(d.boutique.nom)}</strong><br>
          ${d.boutique.adresse   ? esc(d.boutique.adresse)   + '<br>' : ''}
          ${d.boutique.siret     ? 'SIRET : ' + esc(d.boutique.siret) + '<br>' : ''}
          ${d.boutique.telephone ? esc(d.boutique.telephone) + '<br>' : ''}
          ${d.boutique.email     ? esc(d.boutique.email)             : ''}
        </div>
      </div>

      <div class="print-doc-title print-no-break">
        <div>
          <div class="print-doc-type">Facture</div>
          <div class="print-doc-numero">${esc(d.numero)} &nbsp; <span class="print-badge ${badgeCls}">${badgeLbl}</span></div>
        </div>
        <div class="print-doc-meta">
          <strong>Date d'émission :</strong> ${_fmtDate(d.dateEm)}<br>
          ${d.dateEch   ? '<strong>Échéance :</strong> ' + _fmtDate(d.dateEch) + '<br>' : ''}
          ${d.hash_nf525 ? '<span style="font-size:7pt;color:#aaa;">NF525 ✓</span>' : ''}
        </div>
      </div>

      <div class="print-parties print-no-break">
        <div class="print-party-box">
          <div class="print-party-label">Émetteur</div>
          <div class="print-party-name">${esc(d.boutique.nom)}</div>
          <div class="print-party-detail">
            ${d.boutique.adresse ? esc(d.boutique.adresse) + '<br>' : ''}
            ${d.boutique.siret   ? 'SIRET : ' + esc(d.boutique.siret) : ''}
          </div>
        </div>
        <div class="print-party-box">
          <div class="print-party-label">Facturé à</div>
          <div class="print-party-name">${esc(d.clientNom)}</div>
          <div class="print-party-detail">
            ${d.clientEmail   ? esc(d.clientEmail)   + '<br>' : ''}
            ${d.clientTel     ? esc(d.clientTel)     + '<br>' : ''}
            ${d.clientAdresse ? esc(d.clientAdresse)          : ''}
          </div>
        </div>
      </div>

      <table class="print-table print-no-break">
        <thead>
          <tr>
            <th style="width:45%">Description</th>
            <th class="text-center" style="width:10%">Qté</th>
            <th class="text-right"  style="width:15%">P.U. HT</th>
            <th class="text-right"  style="width:10%">TVA</th>
            <th class="text-right"  style="width:20%">Total TTC</th>
          </tr>
        </thead>
        <tbody>${lignesHTML}</tbody>
      </table>

      <div class="print-totaux">
        <table class="print-totaux-table">
          <tr><td>Sous-total HT</td><td>${_money(d.totalHT)}</td></tr>
          <tr class="total-ht"><td>TVA</td><td>${_money(d.totalTVA)}</td></tr>
          <tr class="total-ttc"><td>TOTAL TTC</td><td>${_money(d.totalTTC)}</td></tr>
        </table>
      </div>

      ${paiementsHTML}

      ${d.notes ? `<div class="print-notes print-no-break"><div class="print-notes-label">Notes</div>${esc(d.notes)}</div>` : ''}

      <div class="print-footer">
        <div>${esc(d.boutique.nom)} ${d.boutique.siret ? '— SIRET : ' + esc(d.boutique.siret) : ''}</div>
        <div class="print-footer-legal">Document généré par iziGSM le ${new Date().toLocaleDateString('fr-FR')}</div>
        <div>Page 1</div>
      </div>
    </div>`;
}

/**
 * Injecte le HTML dans le DOM, masque le layout app, déclenche window.print(),
 * puis nettoie le DOM après impression.
 * Fonction partageable avec printTicket via même pattern.
 *
 * @param {string} html - HTML complet du document à imprimer (contient #print-root)
 * @returns {void}
 */
function _triggerPrint(html) {
  // Supprimer un éventuel print-root résiduel
  document.getElementById('print-root')?.remove();
  document.getElementById('_print_style_override')?.remove();

  // Injecter le document à imprimer
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper.firstElementChild);

  // Masquer le layout app pendant l'impression uniquement
  const style = document.createElement('style');
  style.id    = '_print_style_override';
  style.media = 'print';
  style.textContent = `
    body > .app-layout { display: none !important; }
    #print-root { display: block !important; }
  `;
  document.head.appendChild(style);

  // Déclencher après rendu CSS (200ms) puis nettoyer après fermeture dialogue (500ms)
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.getElementById('print-root')?.remove();
      document.getElementById('_print_style_override')?.remove();
    }, 500);
  }, 200);
}

// ─── Gestion des lignes ───────────────────────────────────────────────────────
function addFactureLine() {
  const lid   = Date.now() + Math.random();
  factureLines.push(lid);
  const tbody = document.getElementById('facture-lines');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.id    = 'fl-row-' + lid;
  tr.innerHTML = `
    <td style="padding:6px 8px;">
      <input type="text" id="fl-desc-${lid}" placeholder="Description de la prestation ou du produit…"
        style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font:inherit;font-size:0.88rem;">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="fl-qty-${lid}" value="1" min="1" step="1"
        style="width:70px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;"
        oninput="updateFactureLineTotals(${lid})">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="fl-price-${lid}" value="" min="0" step="0.01" placeholder="0.00"
        style="width:100px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;"
        oninput="updateFactureLineTotals(${lid})">
    </td>
    <td style="padding:6px 12px;text-align:right;">
      <span id="fl-total-${lid}" style="font-weight:600;font-size:0.92rem;">0,00 €</span>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button onclick="removeFactureLine(${lid})"
        style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:1.1rem;line-height:1;"
        title="Supprimer la ligne">✕</button>
    </td>`;
  tbody.appendChild(tr);
}

function removeFactureLine(lid) {
  if (factureLines.length <= 1) {
    showFlash('ℹ️ Une facture doit contenir au moins une ligne.', 'info');
    return;
  }
  factureLines = factureLines.filter(l => l !== lid);
  document.getElementById('fl-row-' + lid)?.remove();
  updateFactureTotals();
}

function updateFactureLineTotals(lid) {
  const qty   = parseFloat(document.getElementById('fl-qty-'   + lid)?.value) || 0;
  const price = parseFloat(document.getElementById('fl-price-' + lid)?.value) || 0;
  const total = qty * price;
  const el    = document.getElementById('fl-total-' + lid);
  if (el) el.textContent = formatMoney(total);
  updateFactureTotals();
}

function updateFactureTotals() {
  const subtotal = factureLines.reduce((s, lid) => {
    const qty   = parseFloat(document.getElementById('fl-qty-'   + lid)?.value) || 0;
    const price = parseFloat(document.getElementById('fl-price-' + lid)?.value) || 0;
    return s + qty * price;
  }, 0);
  const tva = subtotal * 0.2;
  const ttc = subtotal + tva;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatMoney(val); };
  set('f-subtotal-ht', subtotal);
  set('f-total-tva',   tva);
  set('f-total-ttc',   ttc);
}

// ─── Signature canvas ─────────────────────────────────────────────────────────
function initSigPad() {
  const canvas = document.getElementById('f-sig-canvas');
  if (!canvas) return;
  const area = document.getElementById('f-sig-area');
  const ctx  = canvas.getContext('2d');
  let drawing = false;

  function resize() {
    if (!area) return;
    const rect    = area.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
  }
  resize();
  window.addEventListener('resize', resize);

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  area.addEventListener('mousedown',  e => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); const ph = document.getElementById('f-sig-placeholder'); if (ph) ph.style.display = 'none'; });
  area.addEventListener('mousemove',  e => { if (!drawing) return; const p = getPos(e); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#101828'; ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  area.addEventListener('mouseup',    () => { drawing = false; });
  area.addEventListener('mouseleave', () => { drawing = false; });
  area.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
  area.addEventListener('touchmove',  e => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#101828'; ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
  area.addEventListener('touchend',   () => { drawing = false; });
}

function clearSig(canvasId, placeholderId) {
  const canvas = document.getElementById(canvasId);
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  const ph = document.getElementById(placeholderId);
  if (ph) ph.style.display = '';
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Exposition globale ───────────────────────────────────────────────────────
window.openNewFacture          = openNewFacture;
window.saveFacture             = saveFacture;
window.markAsPaid              = markAsPaid;
window.openMarkAsPaid          = openMarkAsPaid;
window.confirmPaiement         = confirmPaiement;
window.deleteFacture           = deleteFacture;
window.printFacture            = printFacture;
window.filterFactures          = filterFactures;
window.filterFactureStatus     = filterFactureStatus;
window.addFactureLine          = addFactureLine;
window.removeFactureLine       = removeFactureLine;
window.updateFactureLineTotals = updateFactureLineTotals;
window.clearSig                = clearSig;
// Sprint 2.1 — Émission + Avoirs
window.emettreFacture          = emettreFacture;
window.openModalAvoir          = openModalAvoir;
window.confirmAvoir            = confirmAvoir;
window.addAvoirLine            = addAvoirLine;
window.removeAvoirLine         = removeAvoirLine;
window.updateAvoirLineTotals   = updateAvoirLineTotals;
