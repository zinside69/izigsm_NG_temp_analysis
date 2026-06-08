/**
 * iziGSM — tickets.js
 * CRUD tickets connecté à la vraie API D1 (avec fallback localStorage)
 */

let currentTicketId = null;
let sigCanvas = null, sigCtx = null, sigDrawing = false;
let attachmentFiles = [];
let allTicketsCache  = [];  // cache local depuis l'API
let ticketsUseApi    = true;

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('tickets');
  loadTickets();   // remplace renderTickets() direct
  initSignature();
  populateClients();
});

// ─── Chargement API ────────────────────────────────────────────────────────
async function loadTickets() {
  try {
    const boutiqueId = getBoutiqueId();
    const params = { limit: 100 };
    if (boutiqueId) params.boutique_id = boutiqueId;

    const result = await apiGet('/api/tickets', params);
    if (!result.ok) throw new Error(result.error || 'Erreur API');

    // Mapper API vers format attendu par renderTickets
    allTicketsCache = (result.data?.data || []).map(t => ({
      id:          t.id,
      clientName:  t.client_nom   || t.clientName  || '—',
      phone:       t.client_tel   || t.phone        || '',
      email:       t.client_email || t.email        || '',
      deviceType:  t.marque       || t.deviceType   || '',
      deviceModel: t.modele       || t.deviceModel  || '',
      imei:        t.imei         || '',
      description: t.description  || '',
      notes:       t.notes_internes || t.notes      || '',
      status:      mapStatutToLegacy(t.statut || t.status),
      statut:      t.statut       || '',
      priority:    t.priorite     || t.priority     || 'Moyenne',
      technician:  t.technicien_nom || t.technician || 'Non assigné',
      price:       t.devis_montant  || t.price      || 0,
      numero:      t.numero       || '',
      hasSignature: false,
      attachments: [],
      createdAt:   t.created_at   || t.createdAt   || '',
    }));

    setDB('tickets', allTicketsCache);
    ticketsUseApi = true;

  } catch (err) {
    console.warn('[Tickets] API indisponible, fallback localStorage:', err.message);
    allTicketsCache = getDB('tickets');
    ticketsUseApi = false;
  }

  renderTickets();
}

// Mapper statuts API snake_case vers anciens libellés
function mapStatutToLegacy(statut) {
  const map = { recu:'Nouveau', diagnostic:'En cours', en_reparation:'En cours', termine:'Terminé', livre:'Terminé', annule:'Annulé' };
  return map[statut] || statut || 'Nouveau';
}

function renderTickets(filter = '') {
  let data = allTicketsCache.length ? allTicketsCache : getDB('tickets');
  const statusFilter = document.getElementById('filter-status')?.value || '';
  const priorityFilter = document.getElementById('filter-priority')?.value || '';

  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(t =>
      t.clientName?.toLowerCase().includes(q) ||
      t.deviceModel?.toLowerCase().includes(q) ||
      t.deviceType?.toLowerCase().includes(q) ||
      String(t.id).includes(q)
    );
  }
  if (statusFilter) data = data.filter(t => t.status === statusFilter);
  if (priorityFilter) data = data.filter(t => t.priority === priorityFilter);

  const tbody = document.getElementById('tickets-table');
  const empty = document.getElementById('tickets-empty');
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(t => `
    <tr>
      <td><span style="font-weight:700;color:var(--primary);font-size:0.9rem;">#${String(t.id).slice(-4)}</span></td>
      <td>
        <div style="font-weight:600;">${esc(t.clientName)}</div>
        ${t.phone ? `<div style="font-size:0.8rem;color:var(--muted);">${esc(t.phone)}</div>` : ''}
      </td>
      <td>
        <div style="font-size:0.9rem;">${esc(t.deviceType)} ${esc(t.deviceModel)}</div>
        ${t.imei ? `<div style="font-size:0.78rem;color:var(--muted);">IMEI: ${esc(t.imei)}</div>` : ''}
      </td>
      <td>${esc(t.description).slice(0,50)}${t.description?.length > 50 ? '…' : ''}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${priorityLabel(t.priority)}</td>
      <td><span style="font-size:0.88rem;">${esc(t.technician)}</span></td>
      <td><span style="font-size:0.85rem;color:var(--muted);">${formatDate(t.createdAt, true)}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-icon" title="Voir" onclick="viewTicket(${t.id})">👁</button>
          <button class="btn btn-ghost btn-icon" title="Modifier" onclick="editTicket(${t.id})">✏️</button>
          <button class="btn btn-ghost btn-icon" title="Supprimer" onclick="deleteTicket(${t.id})" style="color:var(--red);">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterTickets() { renderTickets(document.getElementById('search-tickets')?.value || ''); }

function openNewTicket() {
  currentTicketId = null;
  document.getElementById('modal-ticket-title').textContent = 'Nouvelle prise en charge';
  clearTicketForm();
  openModal('modal-ticket');
  switchTab('info');
}

function editTicket(id) {
  const ticket = getDB('tickets').find(t => t.id === id);
  if (!ticket) return;
  currentTicketId = id;
  document.getElementById('modal-ticket-title').textContent = `Modifier la prise en charge #${String(id).slice(-4)}`;
  document.getElementById('t-new-client').value = ticket.clientName || '';
  document.getElementById('t-phone').value = ticket.phone || '';
  document.getElementById('t-email').value = ticket.email || '';
  document.getElementById('t-device-type').value = ticket.deviceType || 'iPhone';
  document.getElementById('t-device-model').value = ticket.deviceModel || '';
  document.getElementById('t-imei').value = ticket.imei || '';
  document.getElementById('t-priority').value = ticket.priority || 'Moyenne';
  document.getElementById('t-technician').value = ticket.technician || 'Non assigné';
  document.getElementById('t-price').value = ticket.price || '';
  document.getElementById('t-description').value = ticket.description || '';
  document.getElementById('t-notes').value = ticket.notes || '';
  openModal('modal-ticket');
}

function viewTicket(id) {
  const ticket = getDB('tickets').find(t => t.id === id);
  if (!ticket) return;
  currentTicketId = id;
  document.getElementById('detail-title').textContent = `Prise en charge #${String(id).slice(-4)}`;
  document.getElementById('detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Client</div>
        <div style="font-weight:600;">${esc(ticket.clientName)}</div>
        ${ticket.phone ? `<div style="font-size:0.88rem;color:var(--muted);">${esc(ticket.phone)}</div>` : ''}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Appareil</div>
        <div style="font-weight:600;">${esc(ticket.deviceType)} ${esc(ticket.deviceModel)}</div>
        ${ticket.imei ? `<div style="font-size:0.88rem;color:var(--muted);">IMEI: ${esc(ticket.imei)}</div>` : ''}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Statut</div>
        ${statusBadge(ticket.status)}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Priorité</div>
        ${priorityLabel(ticket.priority)}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Technicien</div>
        <div>${esc(ticket.technician)}</div>
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Prix estimé</div>
        <div style="font-weight:700;color:var(--primary);">${formatMoney(ticket.price)}</div>
      </div>
      <div class="full" style="grid-column:1/-1;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Description</div>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;font-size:0.92rem;">${esc(ticket.description)}</div>
      </div>
      ${ticket.notes ? `<div class="full" style="grid-column:1/-1;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Notes internes</div>
        <div style="background:#fff9ec;border:1px solid #ffe0a1;border-radius:10px;padding:12px;font-size:0.88rem;color:#7a5a1a;">${esc(ticket.notes)}</div>
      </div>` : ''}
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Signature</div>
        <span class="${ticket.hasSignature ? 'status-badge status-done' : 'status-badge status-draft'}">${ticket.hasSignature ? '✓ Signée' : 'Non signée'}</span>
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Créé le</div>
        <div style="font-size:0.9rem;">${formatDate(ticket.createdAt)}</div>
      </div>
    </div>
    <div style="margin-top:16px;">
      <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Changer le statut</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${['Nouveau','En cours','Terminé','Annulé'].map(s => `
          <button class="btn btn-sm ${ticket.status===s?'btn-primary':'btn-ghost'}" onclick="changeStatus(${ticket.id},'${s}')">${s}</button>
        `).join('')}
      </div>
    </div>
  `;
  window._currentTicketId = id;
  openModal('modal-ticket-detail');
}

// ─── Impression fiche ticket (Sprint 2.13) ────────────────────────────────────
// ─── Impression / PDF fiche ticket (Sprint 2.13) ─────────────────────────────
// Principe P4 : fonction principale déléguant à 3 sous-fonctions spécialisées.
// _triggerPrint() est défini dans factures.js (chargé avant tickets.js).
// _money() et _fmtDateTime() proviennent de app.js (Principe P2 — centralisation).

/**
 * Point d'entrée public pour l'impression d'une fiche de prise en charge ticket.
 * Orchestre les 3 étapes : récupération API → construction HTML → déclenchement print.
 *
 * @param {number} id - ID du ticket à imprimer
 * @returns {Promise<void>}
 */
async function printTicket(id) {
  if (!id) return;
  try {
    const data = await _fetchTicketPrintData(id);
    if (!data) return;
    const html = _buildTicketHTML(data);
    _triggerPrint(html);
  } catch (err) {
    console.error('[printTicket]', err);
    showFlash('⚠️ Erreur lors de la génération de la fiche.', 'error');
  }
}

/**
 * Récupère et normalise les données nécessaires à l'impression d'une fiche ticket :
 * détail ticket + profil boutique.
 *
 * @param {number} id - ID du ticket
 * @returns {Promise<object|null>} Objet normalisé prêt pour `_buildTicketHTML`,
 *          ou null si l'API retourne une erreur (flash affiché)
 */
async function _fetchTicketPrintData(id) {
  const boutiqueId = getBoutiqueId();
  const r = await apiGet(`/api/tickets/${id}`, boutiqueId ? { boutique_id: boutiqueId } : {});
  if (!r.ok) {
    showFlash('⚠️ Impossible de récupérer le ticket.', 'error');
    return null;
  }
  const t = r.data?.data || r.data || {};

  // Profil boutique (non bloquant — valeurs par défaut si API KO)
  let boutique = { nom: 'iziGSM', adresse: '', telephone: '', email: '' };
  try {
    const bs = await apiGet('/api/boutiques');
    const b  = (bs.data?.data || bs.data || [])[0] || {};
    boutique = {
      nom:       b.nom       || b.name || 'iziGSM',
      adresse:   b.adresse   || '',
      telephone: b.telephone || '',
      email:     b.email     || '',
    };
  } catch {}

  return {
    boutique,
    numero:     t.numero    || ('#' + id),
    statut:     t.statut    || 'recu',
    client:     t.client_nom
                  ? (t.client_nom + (t.client_prenom ? ' ' + t.client_prenom : ''))
                  : (t.clientName || '—'),
    tel:        t.client_telephone || t.client_tel || t.phone || '',
    email:      t.client_email     || t.email      || '',
    marque:     t.marque    || t.deviceType  || '',
    modele:     t.modele    || t.deviceModel || '',
    imei:       t.imei      || '',
    panne:      t.description      || t.panne_declaree || '',
    notes:      t.notes_internes   || t.notes          || '',
    prix:       parseFloat(t.prix_estime || t.prix_reparation || 0),
    dateEm:     t.created_at       || new Date().toISOString(),
    technicien: t.technicien_nom   || t.technician     || '—',
    priorite:   t.priorite         || t.priority       || 'normale',
    tracking:   t.tracking_token   || '',
  };
}

/**
 * Construit le HTML complet de la fiche de prise en charge ticket pour impression.
 * Inclut zones de signature client/technicien et lien de suivi si token présent.
 *
 * @param {object} d - Données normalisées retournées par `_fetchTicketPrintData`
 * @returns {string} HTML complet prêt à être injecté dans #print-root
 */
function _buildTicketHTML(d) {
  const STATUT_LABELS = {
    recu:'Reçu', diagnostic:'En diagnostic', en_reparation:'En réparation',
    to_order:'À commander', ordered:'Commandé', parts_received:'Pièces reçues',
    termine:'Terminé', livre:'Livré', annule:'Annulé',
  };
  const PRIO_COLORS = {
    haute:'#ef4444', urgente:'#dc2626', normale:'#6366f1', basse:'#6b7280',
  };

  const statutLabel = STATUT_LABELS[d.statut]  || d.statut;
  const prioColor   = PRIO_COLORS[d.priorite]  || '#6366f1';
  const prixHTML    = d.prix > 0
    ? _money(d.prix)
    : 'Sur devis';

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
          ${d.boutique.telephone ? esc(d.boutique.telephone) + '<br>' : ''}
          ${d.boutique.email     ? esc(d.boutique.email)             : ''}
        </div>
      </div>

      <div class="print-doc-title print-no-break">
        <div>
          <div class="print-doc-type">Fiche de prise en charge</div>
          <div class="print-doc-numero">${esc(d.numero)}</div>
        </div>
        <div class="print-doc-meta">
          <strong>Date :</strong> ${_fmtDateTime(d.dateEm)}<br>
          <strong>Statut :</strong> ${esc(statutLabel)}<br>
          <strong>Priorité :</strong> <span style="color:${prioColor};font-weight:700;">${esc(d.priorite)}</span>
        </div>
      </div>

      <div class="print-parties print-no-break">
        <div class="print-party-box">
          <div class="print-party-label">Client</div>
          <div class="print-party-name">${esc(d.client)}</div>
          <div class="print-party-detail">
            ${d.tel   ? '📞 ' + esc(d.tel)   + '<br>' : ''}
            ${d.email ? '✉ '  + esc(d.email)          : ''}
          </div>
        </div>
        <div class="print-party-box">
          <div class="print-party-label">Appareil</div>
          <div class="print-party-name">${esc(d.marque)} ${esc(d.modele)}</div>
          <div class="print-party-detail">
            ${d.imei ? 'IMEI / S.N. : <strong>' + esc(d.imei) + '</strong><br>' : ''}
            <strong>Technicien :</strong> ${esc(d.technicien)}
          </div>
        </div>
      </div>

      <div style="margin-bottom:6mm;" class="print-no-break">
        <div class="print-notes-label" style="margin-bottom:2mm;">Panne déclarée</div>
        <div class="print-notes">${esc(d.panne) || '<em style="color:#aaa;">Non renseignée</em>'}</div>
      </div>

      ${d.notes ? `
      <div style="margin-bottom:6mm;" class="print-no-break">
        <div class="print-notes-label" style="margin-bottom:2mm;">Notes internes</div>
        <div class="print-notes" style="background:#fff9ec;border-color:#ffe0a1;">${esc(d.notes)}</div>
      </div>` : ''}

      <table class="print-table print-no-break" style="margin-bottom:4mm;">
        <thead>
          <tr>
            <th>Intervention</th>
            <th class="text-right" style="width:25%">Montant estimé</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${esc(d.panne) || 'Diagnostic + réparation'}</td>
            <td class="text-right"><strong>${prixHTML}</strong></td>
          </tr>
        </tbody>
      </table>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;margin-top:8mm;" class="print-no-break">
        <div style="border:1px solid #e5e7eb;border-radius:6px;padding:4mm;min-height:30mm;">
          <div class="print-notes-label" style="margin-bottom:2mm;">Signature du client</div>
          <div style="color:#aaa;font-size:8pt;">Je certifie avoir déposé l'appareil décrit ci-dessus et accepté les conditions de réparation.</div>
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:6px;padding:4mm;min-height:30mm;">
          <div class="print-notes-label" style="margin-bottom:2mm;">Signature du technicien</div>
        </div>
      </div>

      ${d.tracking ? `
      <div style="margin-top:6mm;text-align:center;font-size:8pt;color:#aaa;" class="print-no-break">
        Suivi en ligne : ${window.location.origin}/suivi/${esc(d.tracking)}
      </div>` : ''}

      <div class="print-footer">
        <div>${esc(d.boutique.nom)}</div>
        <div class="print-footer-legal">Fiche générée par iziGSM le ${new Date().toLocaleDateString('fr-FR')}</div>
        <div>${esc(d.numero)}</div>
      </div>
    </div>`;
}

// _fmtDateTime() (avec heure) est défini dans app.js (Principe P2 — centralisation)

window.printTicket = printTicket;

async function changeStatus(id, status) {
  // Mapper statut legacy vers statut API
  const statutMap = { 'Nouveau': 'recu', 'En cours': 'en_reparation', 'Terminé': 'termine', 'Annulé': 'annule' };
  const statutApi = statutMap[status] || status;

  try {
    if (ticketsUseApi) {
      const result = await apiPut('/api/tickets/' + id + '/statut', { statut: statutApi });
      if (!result.ok) throw new Error(result.error || 'Erreur API');
    } else {
      updateInDB('tickets', id, { status });
    }
    closeModal('modal-ticket-detail');
    await loadTickets();
    showFlash('Statut mis à jour : ' + status);
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
}

async function deleteTicket(id) {
  if (!confirm('Supprimer cette prise en charge ?')) return;
  try {
    if (ticketsUseApi) {
      const result = await apiDelete('/api/tickets/' + id);
      if (!result.ok) throw new Error(result.error || 'Erreur API');
    } else {
      deleteFromDB('tickets', id);
    }
    allTicketsCache = allTicketsCache.filter(t => t.id !== id);
    renderTickets();
    showFlash('Prise en charge supprimée', 'info');
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
}

function createDevisFromTicket() {
  if (currentTicketId) {
    localStorage.setItem('izigsm_new_devis_from_ticket', String(currentTicketId));
    window.location.href = 'devis.html';
  }
}

async function saveTicket() {
  const clientName = document.getElementById('t-new-client').value.trim() || 'Client inconnu';
  const description = document.getElementById('t-description').value.trim();
  if (!description) { showFlash('La description est requise.', 'error'); return; }

  const boutiqueId = getBoutiqueId();

  const ticket = {
    // Champs API D1
    client_nom:     clientName,
    client_tel:     document.getElementById('t-phone').value.trim(),
    client_email:   document.getElementById('t-email').value.trim(),
    marque:         document.getElementById('t-device-type').value,
    modele:         document.getElementById('t-device-model').value.trim(),
    imei:           document.getElementById('t-imei').value.trim(),
    priorite:       document.getElementById('t-priority').value,
    description,
    notes_internes: document.getElementById('t-notes').value.trim(),
    devis_montant:  parseFloat(document.getElementById('t-price').value) || 0,
    boutique_id:    boutiqueId,
    // Champs legacy pour fallback localStorage
    clientName,
    phone:      document.getElementById('t-phone').value.trim(),
    email:      document.getElementById('t-email').value.trim(),
    deviceType: document.getElementById('t-device-type').value,
    deviceModel: document.getElementById('t-device-model').value.trim(),
    priority:   document.getElementById('t-priority').value,
    technician: document.getElementById('t-technician')?.value || 'Non assigné',
    price:      parseFloat(document.getElementById('t-price').value) || 0,
    notes:      document.getElementById('t-notes').value.trim(),
    status: 'Nouveau',
    hasSignature: !!sigCanvas && !isSigEmpty(),
    attachments: attachmentFiles.map(f => ({ name: f.name, size: f.size, type: f.type })),
  };

  try {
    if (ticketsUseApi) {
      let result;
      if (currentTicketId) {
        result = await apiPut('/api/tickets/' + currentTicketId, ticket);
      } else {
        result = await apiPost('/api/tickets', ticket);
      }
      if (!result.ok) throw new Error(result.error || 'Erreur API');
      showFlash(currentTicketId ? 'Prise en charge mise à jour' : 'Prise en charge créée');
    } else {
      if (currentTicketId) {
        updateInDB('tickets', currentTicketId, ticket);
        showFlash('Prise en charge mise à jour');
      } else {
        ticket.createdAt = new Date().toISOString();
        addToDB('tickets', ticket);
        showFlash('Prise en charge créée');
      }
    }
    closeModal('modal-ticket');
    await loadTickets();
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
}

function clearTicketForm() {
  ['t-new-client','t-phone','t-email','t-device-model','t-imei','t-price','t-description','t-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  attachmentFiles = [];
  document.getElementById('attachments-list').innerHTML = '';
  clearSignature();
}

function exportTickets() { showFlash('📥 Export CSV — disponible en production avec backend', 'info'); }

// ======================== SIGNATURE ========================
function initSignature() {
  sigCanvas = document.getElementById('sig-canvas');
  if (!sigCanvas) return;
  sigCtx = sigCanvas.getContext('2d');
  resizeSigCanvas();

  const area = document.getElementById('sig-area');
  area.addEventListener('mousedown', startDraw);
  area.addEventListener('mousemove', draw);
  area.addEventListener('mouseup', stopDraw);
  area.addEventListener('mouseleave', stopDraw);
  area.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e.touches[0]); }, { passive:false });
  area.addEventListener('touchmove', e => { e.preventDefault(); draw(e.touches[0]); }, { passive:false });
  area.addEventListener('touchend', stopDraw);
  window.addEventListener('resize', resizeSigCanvas);
}

function resizeSigCanvas() {
  if (!sigCanvas) return;
  const area = document.getElementById('sig-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  const data = sigCanvas.toDataURL();
  sigCanvas.width = rect.width;
  sigCanvas.height = rect.height;
  const img = new Image();
  img.onload = () => sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
  img.src = data;
}

function getPos(e) {
  const rect = sigCanvas.getBoundingClientRect();
  return { x: (e.clientX || e.pageX) - rect.left, y: (e.clientY || e.pageY) - rect.top };
}
function startDraw(e) {
  sigDrawing = true;
  const pos = getPos(e);
  sigCtx.beginPath();
  sigCtx.moveTo(pos.x, pos.y);
  document.getElementById('sig-placeholder').style.display = 'none';
}
function draw(e) {
  if (!sigDrawing) return;
  const pos = getPos(e);
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = 'round';
  sigCtx.strokeStyle = '#101828';
  sigCtx.lineTo(pos.x, pos.y);
  sigCtx.stroke();
  sigCtx.beginPath();
  sigCtx.moveTo(pos.x, pos.y);
}
function stopDraw() { sigDrawing = false; updateSigStatus(); }
function clearSignature() {
  if (!sigCtx || !sigCanvas) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  const ph = document.getElementById('sig-placeholder');
  if (ph) ph.style.display = '';
  updateSigStatus();
}
function isSigEmpty() {
  if (!sigCanvas) return true;
  const data = sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data;
  return !data.some(v => v !== 0);
}
function updateSigStatus() {
  const status = document.getElementById('sig-status');
  if (status) {
    const signed = !isSigEmpty();
    status.textContent = signed ? '✓ Signé' : '✓ Non signé';
    status.className = signed ? 'btn btn-sm status-badge status-done' : 'btn btn-ghost btn-sm';
  }
}

// Signature factures
function clearSig(canvasId, placeholderId) {
  const c = document.getElementById(canvasId);
  const p = document.getElementById(placeholderId);
  if (c) { const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); }
  if (p) p.style.display = '';
}

// ======================== PIÈCES JOINTES ========================
function handleDragOver(e) { e.preventDefault(); document.getElementById('dropzone').classList.add('dragging'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('dragging');
  addFiles(e.dataTransfer.files);
}
function handleFiles(e) { addFiles(e.target.files); }
function addFiles(files) {
  Array.from(files).forEach(file => {
    attachmentFiles.push(file);
    addAttachmentItem(file);
  });
}
function addAttachmentItem(file) {
  const list = document.getElementById('attachments-list');
  if (!list) return;
  const icon = file.type.startsWith('image/') ? '🖼' : '📄';
  const size = file.size < 1024*1024 ? `${Math.round(file.size/1024)} Ko` : `${(file.size/1024/1024).toFixed(1)} Mo`;
  const item = document.createElement('div');
  item.className = 'attachment-item';
  item.innerHTML = `
    <span class="att-icon">${icon}</span>
    <span class="att-name">${esc(file.name)}</span>
    <span class="att-size">${size}</span>
    <span class="att-remove" onclick="this.parentElement.remove()">✕</span>
  `;
  list.appendChild(item);
}

// ======================== CLIENT LIST ========================
function populateClients() {
  const clients = getDB('clients');
  const select = document.getElementById('t-client');
  if (select) {
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.first} ${c.last}`;
      select.appendChild(opt);
    });
    select.addEventListener('change', function() {
      const client = clients.find(c => c.id == this.value);
      if (client) {
        document.getElementById('t-new-client').value = client.first + ' ' + client.last;
        document.getElementById('t-phone').value = client.phone || '';
        document.getElementById('t-email').value = client.email || '';
      }
    });
  }
}

function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
