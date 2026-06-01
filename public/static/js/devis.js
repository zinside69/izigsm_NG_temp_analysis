/**
 * iziGSM — devis.js
 * CRUD devis connecté à la vraie API D1 (avec fallback localStorage)
 *
 * API D1 (champs) :
 *   GET  /api/devis          → { id, numero, statut, total_ttc, date_emission, date_validite, client_nom, facture_id }
 *   POST /api/devis          → { client_id, ticket_id?, lignes[], notes?, conditions?, date_validite?, boutique_id }
 *     lignes[] = { description, quantite, prix_unitaire_ht, tva_taux? }
 *   PUT  /api/devis/:id/convertir → {} → { facture_id, facture_numero }
 */

'use strict';

// ─── État ─────────────────────────────────────────────────────────────────────
let devisLines      = [];
let currentDevisId  = null;
let allDevisCache   = [];
let devisUseApi     = true;
let allClientsForDevis = []; // cache clients pour le select

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('devis');
  Promise.all([loadDevis(), loadClientsForDevis()]).then(() => {
    checkFromTicket();
    addLine(); // Une ligne par défaut
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

async function loadDevis() {
  try {
    const boutiqueId = getBoutiqueId();
    const params = { limit: 100 };
    if (boutiqueId) params.boutique_id = boutiqueId;

    const result = await apiGet('/api/devis', params);
    if (!result.ok) throw new Error(result.error || 'Erreur API');

    allDevisCache = (result.data?.data || []).map(mapApiDevis);
    setDB('devis', allDevisCache);
    devisUseApi = true;

  } catch (err) {
    console.warn('[Devis] API indisponible, fallback localStorage:', err.message);
    allDevisCache = getDB('devis');
    devisUseApi = false;
  }

  renderDevis();
}

async function loadClientsForDevis() {
  try {
    const boutiqueId = getBoutiqueId();
    const params = { limit: 200 };
    if (boutiqueId) params.boutique_id = boutiqueId;

    const result = await apiGet('/api/clients', params);
    if (result.ok) {
      allClientsForDevis = (result.data?.data || []).map(c => ({
        id:   c.id,
        name: [c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || '—',
      }));
    }
  } catch (err) {
    // fallback localStorage
    allClientsForDevis = getDB('clients').map(c => ({
      id:   c.id,
      name: c.name || [c.first, c.last].filter(Boolean).join(' ') || '—',
    }));
  }

  populateDevisClients();
}

/**
 * Mapper les champs API D1 vers format interne
 */
function mapApiDevis(d) {
  // Mapper statuts API → libellés legacy
  const statutMap = { brouillon:'Brouillon', envoye:'Envoyé', accepte:'Accepté', refuse:'Refusé', expire:'Expiré', converti:'Accepté' };
  return {
    id:          d.id,
    number:      d.numero      || '',
    numero:      d.numero      || '',
    clientName:  d.client_nom  || '—',
    clientId:    d.client_id   || null,
    description: d.description || '',
    subtotalHT:  d.total_ht    ?? (d.total_ttc / 1.2 || 0),
    tva:         d.total_tva   ?? ((d.total_ttc / 1.2) * 0.2 || 0),
    totalTTC:    d.total_ttc   ?? 0,
    total_ttc:   d.total_ttc   ?? 0,
    status:      statutMap[d.statut] || d.statut || 'Brouillon',
    statut:      d.statut      || 'brouillon',
    validity:    d.date_validite ? Math.round((new Date(d.date_validite) - new Date(d.date_emission)) / 86400000) : 30,
    date_emission: d.date_emission || '',
    date_validite: d.date_validite || '',
    facture_id:  d.facture_id  || null,
    createdAt:   d.date_emission || '',
    notes:       d.notes       || '',
    lines:       [],  // pas chargées dans la liste — chargées à la demande
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDU LISTE
// ═══════════════════════════════════════════════════════════════════════════════

function renderDevis(filter = '', statusFilter = '') {
  let data = allDevisCache.length ? allDevisCache : getDB('devis');

  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(d =>
      (d.clientName || '').toLowerCase().includes(q) ||
      (d.number || d.numero || '').toLowerCase().includes(q)
    );
  }
  if (statusFilter) {
    data = data.filter(d => d.status === statusFilter || d.statut === statusFilter);
  }

  const tbody = document.getElementById('devis-table');
  const empty = document.getElementById('devis-empty');
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(d => `
    <tr>
      <td><span style="font-weight:700;color:var(--primary);">${esc(d.number || d.numero)}</span></td>
      <td>${esc(d.clientName)}</td>
      <td><span style="font-size:0.88rem;color:var(--muted);">${esc(d.description || '').slice(0,40)}${d.description?.length > 40 ? '…' : ''}</span></td>
      <td>${formatMoney(d.subtotalHT || d.total_ht || 0)}</td>
      <td>${formatMoney(d.tva || d.total_tva || 0)}</td>
      <td><strong>${formatMoney(d.totalTTC || d.total_ttc || 0)}</strong></td>
      <td>${statusBadge(d.status)}</td>
      <td>${formatDate(d.createdAt || d.date_emission, true)}</td>
      <td><span style="font-size:0.85rem;color:var(--muted);">${d.validity || 30}j</span></td>
      <td>
        <div class="row-actions">
          ${!d.facture_id ? `<button class="btn btn-ghost btn-sm" onclick="convertToFacture(${d.id})">→ Facture</button>` : '<span style="font-size:.8rem;color:var(--muted);">Converti</span>'}
          <button class="btn btn-ghost btn-icon" onclick="deleteDevis(${d.id})" style="color:var(--red);">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterDevis(val) { renderDevis(val, document.getElementById('filter-devis-status')?.value || ''); }
function filterDevisStatus(val) { renderDevis(document.getElementById('search-devis')?.value || '', val); }

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL CRÉATION DEVIS
// ═══════════════════════════════════════════════════════════════════════════════

function openNewDevis() {
  currentDevisId = null;
  devisLines = [];
  const container = document.getElementById('devis-lines');
  if (container) container.innerHTML = '';

  const fields = ['d-description', 'd-notes'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const statusEl = document.getElementById('d-status');
  if (statusEl) statusEl.value = 'Brouillon';

  const validEl = document.getElementById('d-validity');
  if (validEl) validEl.value = '30';

  // Remplir le select tickets depuis le cache
  const dTicket = document.getElementById('d-ticket');
  if (dTicket) {
    dTicket.innerHTML = '<option value="">Aucun</option>';
    const tickets = getDB('tickets');
    tickets.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = '#' + String(t.id).slice(-4) + ' — ' + (t.clientName || '') + ' (' + (t.deviceType || '') + ' ' + (t.deviceModel || '') + ')';
      dTicket.appendChild(opt);
    });
  }

  addLine();
  updateDevisTotals();
  openModal('modal-devis');
}

// ─── Pré-remplissage depuis ticket (localStorage) ────────────────────────────
function checkFromTicket() {
  const ticketId = localStorage.getItem('izigsm_new_devis_from_ticket');
  if (!ticketId) return;
  localStorage.removeItem('izigsm_new_devis_from_ticket');

  const ticket = getDB('tickets').find(t => t.id === parseInt(ticketId));
  if (!ticket) return;

  openNewDevis();

  const descEl = document.getElementById('d-description');
  if (descEl) descEl.value = ticket.description || '';

  // Tenter de trouver le client dans le select
  const clientSelect = document.getElementById('d-client');
  if (clientSelect) {
    const matchOption = Array.from(clientSelect.options).find(o =>
      o.textContent.toLowerCase().includes((ticket.clientName || '').toLowerCase())
    );
    if (matchOption) clientSelect.value = matchOption.value;
  }

  // Pré-remplir la première ligne
  devisLines = [];
  const tbody = document.getElementById('devis-lines');
  if (tbody) tbody.innerHTML = '';
  addLine();

  const firstLine = devisLines[0];
  if (firstLine) {
    const dDesc = document.getElementById('dl-desc-' + firstLine);
    const dPrice = document.getElementById('dl-price-' + firstLine);
    if (dDesc) dDesc.value = ticket.description || '';
    if (dPrice && ticket.price) dPrice.value = ticket.price;
    updateLineTotals(firstLine);
  }
}

// ─── Sauvegarde devis ─────────────────────────────────────────────────────────
async function saveDevis(status) {
  const clientSelect  = document.getElementById('d-client');
  const clientId      = clientSelect?.value ? parseInt(clientSelect.value) : null;
  const clientName    = clientSelect?.options[clientSelect?.selectedIndex]?.text || 'Client';
  const description   = document.getElementById('d-description')?.value.trim() || '';
  const validity      = parseInt(document.getElementById('d-validity')?.value) || 30;
  const notes         = document.getElementById('d-notes')?.value.trim() || '';
  const ticketId      = document.getElementById('d-ticket')?.value ? parseInt(document.getElementById('d-ticket').value) : null;
  const boutiqueId    = getBoutiqueId();

  // Construire les lignes
  const lignesData = devisLines.map(lid => ({
    description:      document.getElementById('dl-desc-' + lid)?.value || '',
    quantite:         parseFloat(document.getElementById('dl-qty-' + lid)?.value) || 1,
    prix_unitaire_ht: parseFloat(document.getElementById('dl-price-' + lid)?.value) || 0,
    tva_taux:         20,
    // Legacy
    desc:      document.getElementById('dl-desc-' + lid)?.value || '',
    qty:       parseFloat(document.getElementById('dl-qty-' + lid)?.value) || 1,
    unitPrice: parseFloat(document.getElementById('dl-price-' + lid)?.value) || 0,
    get total() { return this.qty * this.unitPrice; },
  }));
  const linesForStorage = lignesData.map(l => ({ desc: l.desc, qty: l.qty, unitPrice: l.unitPrice, total: l.qty * l.unitPrice }));

  const subtotalHT = linesForStorage.reduce((s, l) => s + l.total, 0);
  const tva        = subtotalHT * 0.2;

  // Calculer date_validite
  const dateValidite = new Date(Date.now() + validity * 86400000).toISOString().split('T')[0];

  // Statut API
  const statutApiMap = { 'Brouillon': 'brouillon', 'Envoyé': 'envoye', 'Accepté': 'accepte' };
  const statutApi    = statutApiMap[status] || 'brouillon';

  try {
    let devisId = currentDevisId;

    if (devisUseApi) {
      if (!clientId) {
        showFlash('Veuillez sélectionner un client.', 'error');
        return;
      }

      const payload = {
        client_id:    clientId,
        ticket_id:    ticketId,
        lignes:       lignesData,
        notes:        notes || undefined,
        date_validite: dateValidite,
        boutique_id:  boutiqueId,
        statut:       statutApi,
      };

      let result;
      if (currentDevisId) {
        // PUT n'est pas implémenté dans la route — on ne peut que créer
        result = await apiPost('/api/devis', payload);
      } else {
        result = await apiPost('/api/devis', payload);
      }

      if (!result.ok) throw new Error(result.error || 'Erreur API');
      devisId = result.data?.id;

    } else {
      // Fallback localStorage
      const existing = getDB('devis');
      const item = {
        number:     generateNumber('DEV-2026-', existing),
        clientId,
        clientName,
        ticketId,
        description,
        lines:      linesForStorage,
        subtotalHT,
        tva,
        totalTTC:   subtotalHT + tva,
        status,
        validity,
        notes,
        createdAt:  new Date().toISOString(),
      };
      addToDB('devis', item);
      devisId = item.id;
    }

    closeModal('modal-devis');
    showFlash('Devis ' + (status === 'Envoyé' ? 'envoyé' : 'enregistré') + ' avec succès', 'success');
    await loadDevis();

  } catch (err) {
    console.error('Erreur saveDevis:', err);
    showFlash('Erreur: ' + err.message, 'error');
  }
}

// ─── Convertir devis → facture ────────────────────────────────────────────────
async function convertToFacture(id) {
  if (!confirm('Convertir ce devis en facture ? Cette action est irréversible.')) return;

  try {
    if (devisUseApi) {
      const result = await apiPut('/api/devis/' + id + '/convertir', {});
      if (!result.ok) throw new Error(result.error || 'Erreur API');

      const factureNumero = result.data?.facture_numero || '';
      showFlash('Devis converti en facture ' + factureNumero + ' avec chaîne NF525', 'success');
      await loadDevis();

      // Proposer d'aller sur les factures
      setTimeout(() => {
        if (confirm('Aller sur la page Factures ?')) window.location.href = 'factures.html';
      }, 500);

    } else {
      // Fallback localStorage : copier vers factures
      const d = getDB('devis').find(x => x.id === id);
      if (!d) return;
      localStorage.setItem('izigsm_devis_to_facture', JSON.stringify(d));
      window.location.href = 'factures.html';
    }

  } catch (err) {
    showFlash('Erreur conversion: ' + err.message, 'error');
  }
}

// ─── Supprimer devis ──────────────────────────────────────────────────────────
async function deleteDevis(id) {
  if (!confirm('Supprimer ce devis ?')) return;
  try {
    // L'API ne propose pas de DELETE /api/devis/:id → on ne peut qu'en fallback localStorage
    // (ou on peut ajouter un appel si l'API l'expose un jour)
    deleteFromDB('devis', id);
    allDevisCache = allDevisCache.filter(d => d.id !== id);
    renderDevis();
    showFlash('Devis supprimé', 'info');
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGNES
// ═══════════════════════════════════════════════════════════════════════════════

function addLine() {
  const lid = Date.now();
  devisLines.push(lid);
  const tbody = document.getElementById('devis-lines');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.id = 'dl-row-' + lid;
  tr.innerHTML = `
    <td style="padding:6px 8px;">
      <input type="text" id="dl-desc-${lid}" placeholder="Description…" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font:inherit;font-size:0.88rem;">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="dl-qty-${lid}" value="1" min="1" style="width:70px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;" oninput="updateLineTotals(${lid})">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="dl-price-${lid}" value="" min="0" step="0.01" placeholder="0.00" style="width:100px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;" oninput="updateLineTotals(${lid})">
    </td>
    <td style="padding:6px 12px;text-align:right;">
      <span id="dl-total-${lid}" style="font-weight:600;font-size:0.92rem;">0,00 €</span>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button onclick="removeLine(${lid})" style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:1rem;">✕</button>
    </td>
  `;
  tbody.appendChild(tr);
}

function removeLine(lid) {
  if (devisLines.length <= 1) return;
  devisLines = devisLines.filter(l => l !== lid);
  document.getElementById('dl-row-' + lid)?.remove();
  updateDevisTotals();
}

function updateLineTotals(lid) {
  const qty   = parseFloat(document.getElementById('dl-qty-' + lid)?.value) || 0;
  const price = parseFloat(document.getElementById('dl-price-' + lid)?.value) || 0;
  const total = qty * price;
  const el    = document.getElementById('dl-total-' + lid);
  if (el) el.textContent = formatMoney(total);
  updateDevisTotals();
}

function updateDevisTotals() {
  const subtotal = devisLines.reduce((s, lid) => {
    const qty   = parseFloat(document.getElementById('dl-qty-' + lid)?.value) || 0;
    const price = parseFloat(document.getElementById('dl-price-' + lid)?.value) || 0;
    return s + qty * price;
  }, 0);
  const tva = subtotal * 0.2;
  const ttc = subtotal + tva;

  const s = document.getElementById('subtotal-ht');    if (s) s.textContent = formatMoney(subtotal);
  const t = document.getElementById('total-tva');      if (t) t.textContent = formatMoney(tva);
  const c = document.getElementById('total-ttc');      if (c) c.textContent = formatMoney(ttc);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECT CLIENTS
// ═══════════════════════════════════════════════════════════════════════════════

function populateDevisClients() {
  const select = document.getElementById('d-client');
  if (!select) return;

  // Vider et garder l'option vide
  select.innerHTML = '<option value="">— Sélectionner un client —</option>';

  const clients = allClientsForDevis.length ? allClientsForDevis : getDB('clients').map(c => ({
    id:   c.id,
    name: c.name || [c.first, c.last].filter(Boolean).join(' ') || '—',
  }));

  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Exposer globalement ──────────────────────────────────────────────────────
window.openNewDevis      = openNewDevis;
window.saveDevis         = saveDevis;
window.convertToFacture  = convertToFacture;
window.deleteDevis       = deleteDevis;
window.addLine           = addLine;
window.removeLine        = removeLine;
window.updateLineTotals  = updateLineTotals;
window.filterDevis       = filterDevis;
window.filterDevisStatus = filterDevisStatus;
