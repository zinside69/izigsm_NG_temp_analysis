/**
 * iziGSM — tickets.js
 * CRUD tickets connecté à la vraie API D1 (avec fallback localStorage)
 */

let currentTicketId = null;
let sigCanvas = null, sigCtx = null, sigDrawing = false;
let attachmentFiles = [];
let allTicketsCache  = [];  // cache local depuis l'API
let ticketsUseApi    = true;

// Le select #t-priority affiche des labels FR capitalisés (UX historique), l'API
// attend l'enum PrioriteTicket en minuscules — voir saveTicket().
const PRIORITE_MAP = { Basse: 'basse', Moyenne: 'normale', Haute: 'haute' };

// Miroir de StatutTicket/TRANSITIONS_TICKET/STATUT_LABELS (src/services/ticketService.ts)
// — le bouton "Changer le statut" doit envoyer l'enum réel, pas un libellé legacy.
const STATUT_LABELS = {
  recu:           'Reçu',
  en_diagnostic:  'En diagnostic',
  attente_accord: 'Attente accord',
  a_commander:    'À commander',
  commande:       'Commandé',
  pieces_recues:  'Pièces reçues',
  en_reparation:  'En réparation',
  termine:        'Terminé',
  livre:          'Livré',
  annule:         'Annulé',
};
const TRANSITIONS_TICKET = {
  recu:           ['en_diagnostic', 'attente_accord', 'en_reparation', 'annule'],
  en_diagnostic:  ['attente_accord', 'a_commander', 'en_reparation', 'annule'],
  attente_accord: ['a_commander', 'en_reparation', 'annule'],
  a_commander:    ['commande', 'en_reparation', 'annule'],
  commande:       ['pieces_recues', 'annule'],
  pieces_recues:  ['en_reparation', 'annule'],
  en_reparation:  ['termine', 'annule'],
  termine:        ['livre'],
  livre:          [],
  annule:         [],
};

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('tickets');
  loadTickets();   // remplace renderTickets() direct
  initSignature();
  initSchemaGrid();
  populateClients();
  populateTechniciens();
});

// ─── Chargement API ────────────────────────────────────────────────────────
async function loadTickets() {
  try {
    const boutiqueId = getBoutiqueId();
    const params = { limit: 100 };
    if (boutiqueId) params.boutique_id = boutiqueId;
    if (_showArchived) params.archived = 'true';  // Sprint 2.37

    const result = await apiGet('/api/tickets', params);
    if (!result.ok) throw new Error(result.error || 'Erreur API');

    // Mapper API vers format attendu par renderTickets — les noms doivent matcher
    // la sélection réelle de listTickets() (ticketService.ts) : description_panne,
    // appareil_marque/appareil_modele, client_telephone, prix_estime/prix_final.
    // Bug préexistant (voir bugs.md) : ces champs étaient mappés depuis des clés
    // qui n'existent pas dans la réponse API (description/marque/modele/client_tel/
    // devis_montant) — toujours vides en pratique, colonnes liste + fiche détail
    // (bouton œil) affichaient un dossier vidé de son contenu. email/imei/notes ne
    // sont pas renvoyés par la liste allégée — viewTicket() recharge la fiche
    // complète via /api/tickets/:id pour ces champs (même pattern qu'editTicket()).
    allTicketsCache = (result.data?.data || []).map(t => ({
      id:          t.id,
      clientName:  t.client_nom   || t.clientName  || '—',
      phone:       t.client_telephone || t.phone    || '',
      email:       t.client_email || t.email        || '',
      deviceType:  t.appareil_marque || t.deviceType  || '',
      deviceModel: t.appareil_modele || t.deviceModel || '',
      imei:        t.imei         || '',
      description: t.description_panne || t.description || '',
      notes:       t.notes_internes || t.notes      || '',
      status:      mapStatutToLegacy(t.statut || t.status),
      statut:      t.statut       || '',
      priority:    t.priorite     || t.priority     || 'Moyenne',
      technician:   t.technicien_nom || t.technician || 'Non assigné',
      technicianId: t.technicien_id ?? null,
      price:       t.prix_final ?? t.prix_estime ?? t.price ?? 0,
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
  const map = {
    recu:           'Nouveau',
    en_diagnostic:  'En cours',
    attente_accord: 'En cours',
    a_commander:    'En cours',
    commande:       'En cours',
    pieces_recues:  'En cours',
    en_reparation:  'En cours',
    termine:        'Terminé',
    livre:          'Terminé',
    annule:         'Annulé',
  };
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

async function editTicket(id) {
  const ticket = allTicketsCache.find(t => t.id === id);
  if (!ticket) return;
  currentTicketId = id;
  document.getElementById('modal-ticket-title').textContent = `Modifier la prise en charge #${String(id).slice(-4)}`;
  document.getElementById('t-new-client').value = ticket.clientName || '';
  document.getElementById('t-phone').value = ticket.phone || '';
  document.getElementById('t-email').value = ticket.email || '';
  document.getElementById('t-device-type').value = ticket.deviceType || '';
  document.getElementById('t-device-model').value = ticket.deviceModel || '';
  document.getElementById('t-imei').value = ticket.imei || '';
  document.getElementById('t-priority').value = ticket.priority || 'Moyenne';
  document.getElementById('t-technician').value = ticket.technicianId ?? '';
  document.getElementById('t-price').value = ticket.price || '';
  document.getElementById('t-description').value = ticket.description || '';
  document.getElementById('t-notes').value = ticket.notes || '';
  clearEtatSecuriteFields();
  openModal('modal-ticket');

  // État/sécurité/signature absents du cache liste (SELECT allégé côté API) —
  // récupérés depuis la fiche détail au moment de l'édition.
  if (ticketsUseApi) {
    try {
      const result = await apiGet('/api/tickets/' + id);
      if (result.ok) populateEtatSecurite(result.data?.data || result.data);
    } catch {}
  }
}

function viewTicket(id) {
  const ticket = allTicketsCache.find(t => t.id === id);
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
        <span id="detail-signature-badge" class="${ticket.hasSignature ? 'status-badge status-done' : 'status-badge status-draft'}">${ticket.hasSignature ? '✓ Signée' : 'Non signée'}</span>
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Créé le</div>
        <div style="font-size:0.9rem;">${formatDate(ticket.createdAt)}</div>
      </div>
    </div>
    <div id="detail-etat-securite"></div>
    <div id="detail-accord"></div>
    <div id="detail-acompte"></div>
    <div style="margin-top:16px;">
      <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Changer le statut</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <span class="btn btn-sm btn-primary" style="pointer-events:none;">${esc(STATUT_LABELS[ticket.statut] || ticket.statut)}</span>
        ${(TRANSITIONS_TICKET[ticket.statut] || []).map(s => `
          <button class="btn btn-sm btn-ghost" onclick="changeStatus(${ticket.id},'${s}')">${STATUT_LABELS[s] || s}</button>
        `).join('')}
      </div>
    </div>
  `;
  window._currentTicketId = id;
  _currentPhotoTicketId   = id;  // Sprint 2.36 — photos

  // Sprint 2.37 — afficher le bouton Archiver si statut terminal
  const btnArchiver = document.getElementById('btn-archiver-ticket');
  if (btnArchiver) {
    const isTerminal = ['Terminé', 'Annulé'].includes(ticket.status) ||
                       ['livre', 'annule'].includes(ticket.statut || '');
    btnArchiver.style.display = isTerminal ? 'inline-flex' : 'none';
  }

  // Réinitialiser l'onglet sur "Informations" à chaque ouverture
  switchDetailTab('detail-info');
  openModal('modal-ticket-detail');

  // État/sécurité/signature réelle absents du cache liste — chargés depuis la fiche détail.
  if (ticketsUseApi) {
    apiGet('/api/tickets/' + id)
      .then(result => {
        if (!result.ok) return;
        const t = result.data?.data || result.data;
        renderEtatSecuriteDetail(t);
        renderAccordDetail(t);
        renderAcompteDetail(t, 'ticket');
      })
      .catch(() => {});
  }
}

/**
 * Affiche l'état de l'accord (devis lié au ticket) dans la fiche détail, avec un
 * bouton de validation manuelle si le devis attend encore une réponse client —
 * feature "Accord" (double validation boutique→client, timeline suivi.html).
 * N'affiche rien si aucun devis n'est lié au ticket.
 */
function renderAccordDetail(t) {
  const el = document.getElementById('detail-accord');
  if (!el || !t) return;

  if (!t.devis_id || !t.devis_statut) { el.innerHTML = ''; return; }

  const BADGES = {
    envoye:  { cls: 'status-badge status-draft',  label: '🟠 Devis envoyé — en attente de réponse client' },
    accepte: { cls: 'status-badge status-done',   label: '✅ Accord client obtenu' },
    refuse:  { cls: 'status-badge status-draft',  label: '❌ Devis refusé par le client' },
  };
  const badge = BADGES[t.devis_statut];
  if (!badge) { el.innerHTML = ''; return; }

  const boutonOverride = t.devis_statut === 'envoye'
    ? `<button class="btn btn-sm btn-ghost" style="margin-top:8px;" onclick="validerAccordManuel(${t.devis_id})">
         Valider l'accord manuellement (client injoignable)
       </button>`
    : '';

  el.innerHTML = `
    <div style="margin-top:16px;">
      <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Accord devis</label>
      <span class="${badge.cls}">${badge.label}</span>
      ${boutonOverride}
    </div>`;
}

/**
 * Affiche le statut de l'acompte (facture d'acompte liée) dans la fiche détail,
 * avec un bouton de demande si aucun acompte n'existe encore — feature acompte
 * structuré (sous-projet A, voir docs/superpowers/specs/2026-07-16-acompte-structure-design.md).
 * @param t          Détail complet du ticket (ou devis) renvoyé par l'API
 * @param contextType 'ticket' ou 'devis' — détermine l'endpoint appelé
 */
function renderAcompteDetail(t, contextType) {
  const el = document.getElementById('detail-acompte');
  if (!el || !t) return;

  const entityId = t.id;

  if (!t.facture_acompte_id) {
    el.innerHTML = `
      <div style="margin-top:16px;">
        <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Acompte</label>
        <button class="btn btn-sm btn-ghost" onclick="demanderAcompte(${entityId}, '${contextType}')">
          💰 Demander un acompte
        </button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-top:16px;">
      <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Acompte</label>
      <span class="status-badge status-done">
        💰 Acompte facturé : ${formatMoney(t.facture_acompte_montant)} (${esc(t.facture_acompte_numero)})
      </span>
    </div>`;
}

/**
 * Ouvre un mini-formulaire (prompt) pour demander un acompte — montant HT libre,
 * TVA par défaut 20%, mode de paiement. POST /api/tickets/:id/acompte ou
 * /api/devis/:id/acompte selon contextType. `prompt()` est un choix volontairement
 * minimal pour ce MVP (pas de pattern de mini-modal existant ailleurs dans le
 * projet pour ce genre de saisie courte — vérifié absence de openQuickModal/promptModal).
 */
async function demanderAcompte(entityId, contextType) {
  const montantStr = prompt('Montant HT de l\'acompte (€) :');
  if (!montantStr) return;
  const montant_ht = parseFloat(montantStr.replace(',', '.'));
  if (!montant_ht || montant_ht <= 0) {
    showToast('❌ Montant invalide.', 'error');
    return;
  }
  const modePaiement = prompt('Mode de paiement (especes, cb, cheque, virement) :', 'especes');
  if (!modePaiement) return;

  const endpoint = contextType === 'devis'
    ? `/api/devis/${entityId}/acompte`
    : `/api/tickets/${entityId}/acompte`;

  try {
    const r = await apiPost(endpoint, { montant_ht, tva_taux: 20, mode_paiement: modePaiement });
    if (r.data?.success) {
      showToast(`✅ Acompte facturé : ${r.data.facture_numero}`);
      if (contextType === 'ticket' && window._currentTicketId) viewTicket(window._currentTicketId);
    } else {
      showToast('❌ ' + (r.error || r.data?.error || 'Échec de la facturation.'), 'error');
    }
  } catch (e) {
    showToast('❌ Erreur réseau.', 'error');
  }
}

/**
 * Force l'acceptation d'un devis "envoyé" sans réponse du client (technicien/manager/
 * admin) — POST /api/devis/:id/accord-manuel, tracé côté serveur (ACCORD_MANUEL_STAFF).
 * Recharge la fiche détail pour refléter le nouvel état.
 */
async function validerAccordManuel(devisId) {
  if (!confirm('Valider cet accord manuellement ? À utiliser uniquement si le client est injoignable — cette action est tracée.')) return;
  try {
    const r = await apiPost(`/api/devis/${devisId}/accord-manuel`, {});
    if (r.data?.success) {
      showToast('✅ Accord validé manuellement.');
      if (window._currentTicketId) viewTicket(window._currentTicketId);
    } else {
      showToast('❌ ' + (r.error || r.data?.error || 'Échec de la validation.'), 'error');
    }
  } catch (e) {
    showToast('❌ Erreur réseau.', 'error');
  }
}

/** Affiche état des lieux + codes de sécurité + signature réelle dans la fiche détail. */
function renderEtatSecuriteDetail(t) {
  const el = document.getElementById('detail-etat-securite');
  if (!el || !t) return;

  // Le badge "Signature" du bloc infos vient du cache liste (hasSignature, toujours
  // false — cette info n'est pas dans listTickets()) — corrigé ici avec la vraie donnée.
  const badge = document.getElementById('detail-signature-badge');
  if (badge && t.signature_client && isValidSignatureDataUrl(t.signature_client)) {
    badge.className = 'status-badge status-done';
    badge.textContent = '✓ Signée';
  }

  let etat = {};
  try { etat = t.etat_appareil ? JSON.parse(t.etat_appareil) : {}; } catch {}
  const ETAT_LABELS = {
    rayures: 'Rayures visibles', ecran_fissure: 'Écran fissuré',
    degats_eaux: 'Dégâts des eaux', boitier_endommage: 'Boîtier endommagé',
  };
  const items = (etat.items || []).map(k => ETAT_LABELS[k] || k);
  const etatLines = [...items, etat.autre].filter(Boolean);
  const hasCodes = t.code_deverrouillage || t.code_sim;

  el.innerHTML = `
    ${etatLines.length ? `
    <div style="margin-top:16px;">
      <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">État à l'entrée</div>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;font-size:0.88rem;">
        ${etatLines.map(l => `• ${esc(l)}`).join('<br>')}
      </div>
    </div>` : ''}
    ${hasCodes ? `
    <div style="margin-top:16px;">
      <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Codes de sécurité</div>
      <div style="background:#fff9ec;border:1px solid #ffe0a1;border-radius:10px;padding:12px;font-size:0.88rem;color:#7a5a1a;">
        ${t.code_deverrouillage ? `Déverrouillage : <strong>${esc(formatCodeDeverrouillage(t.code_deverrouillage))}</strong>` : ''}
        ${t.code_deverrouillage && t.code_sim ? '<br>' : ''}
        ${t.code_sim ? `Code SIM : <strong>${esc(t.code_sim)}</strong>` : ''}
      </div>
    </div>` : ''}
    ${t.signature_client && isValidSignatureDataUrl(t.signature_client) ? `
    <div style="margin-top:16px;">
      <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Signature client</div>
      <img src="${t.signature_client}" alt="Signature client" style="max-width:220px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;padding:8px;">
    </div>` : ''}
  `;
}

// ─── Impression fiche ticket (Sprint 2.13) ────────────────────────────────────
// ─── Impression / PDF fiche ticket (Sprint 2.13) ─────────────────────────────
// Principe P4 : fonction principale déléguant à 3 sous-fonctions spécialisées.
// _triggerPrint() est centralisé dans app.js (Principe P2), chargé avant tickets.js.
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
    etatAppareil:     t.etat_appareil    || null,
    signatureClient:  t.signature_client || null,
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
    recu:           'Reçu',
    en_diagnostic:  'En diagnostic',
    attente_accord: "En attente d'accord",
    a_commander:    'À commander',
    commande:       'Commandé',
    pieces_recues:  'Pièces reçues',
    en_reparation:  'En réparation',
    termine:        'Terminé',
    livre:          'Livré',
    annule:         'Annulé',
  };
  const PRIO_COLORS = {
    haute:'#ef4444', urgente:'#dc2626', normale:'#6366f1', basse:'#6b7280',
  };

  const statutLabel = STATUT_LABELS[d.statut]  || d.statut;
  const prioColor   = PRIO_COLORS[d.priorite]  || '#6366f1';
  const prixHTML    = d.prix > 0
    ? _money(d.prix)
    : 'Sur devis';

  // État de l'appareil constaté au dépôt (checklist onglet État & Sécurité)
  const ETAT_LABELS = {
    rayures: 'Rayures visibles', ecran_fissure: 'Écran fissuré',
    degats_eaux: 'Dégâts des eaux', boitier_endommage: 'Boîtier endommagé',
  };
  let etatParsed = {};
  try { etatParsed = d.etatAppareil ? JSON.parse(d.etatAppareil) : {}; } catch {}
  const etatLines = [...(etatParsed.items || []).map(k => ETAT_LABELS[k] || k), etatParsed.autre].filter(Boolean);
  const etatHTML = etatLines.length ? `
      <div style="margin-bottom:6mm;" class="print-no-break">
        <div class="print-notes-label" style="margin-bottom:2mm;">État constaté au dépôt</div>
        <div class="print-notes">${etatLines.map(esc).join(' · ')}</div>
      </div>` : '';

  // Signature client : image réelle si capturée (et de format valide — voir
  // isValidSignatureDataUrl()), sinon case blanche pour signature manuscrite
  const signatureBoxHTML = (d.signatureClient && isValidSignatureDataUrl(d.signatureClient))
    ? `<img src="${d.signatureClient}" alt="Signature client" style="max-width:100%;max-height:24mm;">`
    : `<div style="color:#aaa;font-size:8pt;">Je certifie avoir déposé l'appareil décrit ci-dessus et accepté les conditions de réparation.</div>`;

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

      ${etatHTML}

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
          ${signatureBoxHTML}
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

async function changeStatus(id, statut) {
  // Annulation d'un ticket ayant un acompte facturé : demander confirmation du
  // montant puis générer un avoir (60 jours de validité) AVANT d'annuler — feature
  // acompte structuré (sous-projet A, voir
  // docs/superpowers/specs/2026-07-16-acompte-structure-design.md). Le reste de la
  // fonction (appel PUT statut, refresh, toasts) est inchangé par rapport à
  // l'implémentation précédente : on ne fait qu'insérer ce garde-fou en tête pour
  // le seul cas statut === 'annule', sans toucher au comportement existant des
  // autres transitions.
  if (statut === 'annule' && ticketsUseApi) {
    // facture_acompte_id n'est pas dans le cache liste (allTicketsCache) — recharger
    // le détail complet pour savoir s'il y a un acompte avant de confirmer.
    let ticketDetail = null;
    try {
      const r = await apiGet('/api/tickets/' + id);
      if (r.ok) {
        const t = r.data?.data || r.data;
        if (t?.facture_acompte_id) ticketDetail = t;
      }
    } catch (_) { /* si le fetch échoue, on retombe sur la confirmation générique ci-dessous */ }

    if (ticketDetail) {
      const montant = ticketDetail.facture_acompte_montant;
      const confirmMsg = `Ce ticket a un acompte facturé de ${montant}€ — annuler générera un avoir de ${montant}€ valable 2 mois.`;
      if (!confirm(confirmMsg)) return;

      try {
        // facture_acompte_montant est un TTC ; approximation HT à 20% de TVA pour la
        // ligne de l'avoir (le taux réel de l'acompte n'est pas exposé par l'API —
        // cf. avertissement Task 8 brief, acceptée pour ce MVP).
        const rAvoir = await apiPost('/api/avoirs', {
          facture_id: ticketDetail.facture_acompte_id,
          motif:      `Annulation de la prise en charge #${id}`,
          lignes:     [{ description: 'Acompte annulé', quantite: 1, prix_unitaire_ht: Math.round((montant / 1.2) * 100) / 100, tva_taux: 20 }],
          date_expiration: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (!rAvoir.data?.success) {
          showFlash('Erreur: ' + (rAvoir.error || rAvoir.data?.error || 'Échec de la création de l\'avoir.'), 'error');
          return;
        }
      } catch (e) {
        showFlash('Erreur: création de l\'avoir impossible (réseau).', 'error');
        return;
      }
    } else {
      if (!confirm('Annuler cette prise en charge ?')) return;
    }
  }

  try {
    if (ticketsUseApi) {
      const result = await apiPut('/api/tickets/' + id + '/statut', { statut });
      if (!result.ok) throw new Error(result.error || 'Erreur API');
    } else {
      updateInDB('tickets', id, { status });
    }
    closeModal('modal-ticket-detail');
    await loadTickets();
    showFlash('Statut mis à jour.');
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
    window.location.href = 'devis';
  }
}

async function saveTicket() {
  const clientName = document.getElementById('t-new-client').value.trim() || 'Client inconnu';
  const description = document.getElementById('t-description').value.trim();
  if (!description) { showFlash('La description est requise.', 'error'); return; }
  if (!document.getElementById('t-device-type').value.trim()) { showFlash('L\'appareil (marque) est requis.', 'error'); return; }

  const boutiqueId = getBoutiqueId();

  // Résolution client_id — bug préexistant (voir bugs.md) : ni le client sélectionné
  // dans la liste, ni la saisie libre "nouveau client" n'étaient jamais transmis à
  // l'API, qui exige client_id — la création de ticket échouait systématiquement.
  // Le client existant sélectionné est prioritaire ; sinon, création à la volée
  // depuis le champ texte libre. Uniquement pour une NOUVELLE prise en charge via
  // l'API réelle : l'édition ne change jamais le client, et le mode localStorage
  // (fallback hors-ligne) n'a pas de contrainte de clé étrangère.
  let clientId = document.getElementById('t-client').value || null;
  if (ticketsUseApi && !currentTicketId && !clientId) {
    const newClientName = document.getElementById('t-new-client').value.trim();
    if (!newClientName) {
      showFlash('Sélectionnez un client existant ou renseignez un nouveau client.', 'error');
      return;
    }
    const [prenom, ...rest] = newClientName.split(/\s+/);
    const nom = rest.join(' ') || prenom;
    const createdClient = await apiPost('/api/clients', {
      prenom, nom,
      telephone:   document.getElementById('t-phone').value.trim(),
      email:       document.getElementById('t-email').value.trim(),
      boutique_id: boutiqueId,
    });
    if (!createdClient.ok) {
      showFlash('Erreur création client : ' + (createdClient.error || 'inconnue'), 'error');
      return;
    }
    clientId = createdClient.data?.id;
  }

  // État de l'appareil à l'entrée (onglet État & Sécurité) : sérialisé en un seul
  // JSON `{ items: string[], autre?: string }` — colonne unique `etat_appareil`,
  // pas une table séparée, pour rester simple tant que la checklist est fixe.
  const etatItems  = Array.from(document.querySelectorAll('.t-etat-item:checked')).map(cb => cb.value);
  const etatAutre  = document.getElementById('t-etat-autre').value.trim();
  const etatAppareil = (etatItems.length || etatAutre)
    ? JSON.stringify({ items: etatItems, autre: etatAutre || undefined })
    : null;

  // Signature réelle du canvas (PNG base64) — jusqu'ici seul un booléen `hasSignature`
  // était envoyé, le dessin n'était jamais persisté (voir docs/ANALYSE_COMPARATIVE_MONATELIER.md §1.1).
  const signed          = !!sigCanvas && !isSigEmpty();
  const signatureClient = signed ? sigCanvas.toDataURL('image/png') : null;
  const signatureDate   = signed ? new Date().toISOString() : null;

  const ticket = {
    // Champs API D1 — les noms doivent matcher CreateTicketData/UpdateTicketData
    // (ticketService.ts) : appareil_marque/appareil_modele/description_panne/
    // prix_estime, pas marque/modele/description/devis_montant. Bug préexistant
    // (voir bugs.md) : ces 4 clés étaient mal nommées, donc silencieusement
    // ignorées par l'API — la création ET la modification de ticket échouaient
    // ou perdaient ces champs sans erreur visible pour prix/description en édition.
    client_id:         clientId,
    client_nom:        clientName,
    client_tel:        document.getElementById('t-phone').value.trim(),
    client_email:      document.getElementById('t-email').value.trim(),
    appareil_marque:   document.getElementById('t-device-type').value,
    appareil_modele:   document.getElementById('t-device-model').value.trim(),
    imei:              document.getElementById('t-imei').value.trim(),
    // PRIORITE_MAP : le select affiche Basse/Moyenne/Haute (français, capitalisé),
    // l'API attend l'enum PrioriteTicket ('basse'|'normale'|'haute'|'urgente') —
    // même bug de valeurs non alignées, envoyer "Moyenne" tel quel fait échouer
    // la validation de updateTicket() avec une 422.
    priorite:          PRIORITE_MAP[document.getElementById('t-priority').value] || 'normale',
    description_panne: description,
    notes_internes:    document.getElementById('t-notes').value.trim(),
    prix_estime:       parseFloat(document.getElementById('t-price').value) || 0,
    boutique_id:       boutiqueId,
    etat_appareil:       etatAppareil,
    code_deverrouillage: getCodeDeverrouillageValue(),
    code_sim:            document.getElementById('t-code-sim').value.trim() || null,
    signature_client:    signatureClient,
    signature_date:      signatureDate,
    // Champs legacy pour fallback localStorage
    clientName,
    phone:      document.getElementById('t-phone').value.trim(),
    email:      document.getElementById('t-email').value.trim(),
    deviceType: document.getElementById('t-device-type').value,
    deviceModel: document.getElementById('t-device-model').value.trim(),
    priority:   document.getElementById('t-priority').value,
    technicien_id: document.getElementById('t-technician')?.value
      ? parseInt(document.getElementById('t-technician').value, 10)
      : null,
    price:      parseFloat(document.getElementById('t-price').value) || 0,
    notes:      document.getElementById('t-notes').value.trim(),
    status: 'Nouveau',
    hasSignature: signed,
    attachments: attachmentFiles.map(f => ({ name: f.name, size: f.size, type: f.type })),
  };

  // Toujours tenter l'API réelle en premier, quel que soit l'état de `ticketsUseApi`
  // (ce flag n'est fiable qu'au moment du dernier `loadTickets()` — un raté transitoire
  // au chargement de page ne doit pas condamner silencieusement toute la session au
  // localStorage : le dossier semblerait créé côté utilisateur mais ne serait jamais
  // en base, et disparaîtrait à la reconnexion. Le fallback localStorage ne doit
  // s'appliquer qu'en cas de vraie panne réseau — pas quand l'API répond une erreur.
  try {
    let result;
    try {
      result = currentTicketId
        ? await apiPut('/api/tickets/' + currentTicketId, ticket)
        : await apiPost('/api/tickets', ticket);
    } catch (networkErr) {
      if (currentTicketId) {
        updateInDB('tickets', currentTicketId, ticket);
      } else {
        ticket.createdAt = new Date().toISOString();
        addToDB('tickets', ticket);
      }
      ticketsUseApi = false;
      showFlash('Réseau indisponible — prise en charge enregistrée hors ligne, à resynchroniser.', 'error');
      closeModal('modal-ticket');
      await loadTickets();
      return;
    }
    if (!result.ok) throw new Error(result.error || 'Erreur API');
    ticketsUseApi = true;
    showFlash(currentTicketId ? 'Prise en charge mise à jour' : 'Prise en charge créée');
    closeModal('modal-ticket');
    await loadTickets();
  } catch (err) {
    showFlash('Erreur: ' + err.message, 'error');
  }
}

function clearTicketForm() {
  ['t-client','t-new-client','t-phone','t-email','t-device-type','t-device-type-id','t-device-model','t-imei','t-price','t-description','t-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  clearEtatSecuriteFields();
  attachmentFiles = [];
  document.getElementById('attachments-list').innerHTML = '';
  clearSignature();
}

// ─── État & Sécurité (prise en charge) ────────────────────────────────────────
/** Réinitialise la checklist d'état + les codes de sécurité (nouveau ticket ou avant re-population en édition). */
function clearEtatSecuriteFields() {
  document.querySelectorAll('.t-etat-item').forEach(cb => cb.checked = false);
  const autre = document.getElementById('t-etat-autre');
  const pin   = document.getElementById('t-code-deverrouillage');
  const sim   = document.getElementById('t-code-sim');
  if (autre) autre.value = '';
  if (pin)   pin.value = '';
  if (sim)   sim.value = '';
  clearSchema();
  setDeverrouillageMode('pin');
}

/** Peuple l'onglet État & Sécurité depuis la fiche détail (absent du cache liste). */
function populateEtatSecurite(t) {
  if (!t) return;
  let etat = {};
  try { etat = t.etat_appareil ? JSON.parse(t.etat_appareil) : {}; } catch {}
  document.querySelectorAll('.t-etat-item').forEach(cb => cb.checked = (etat.items || []).includes(cb.value));
  document.getElementById('t-etat-autre').value = etat.autre || '';
  const codeDeverrouillage = t.code_deverrouillage || '';
  if (codeDeverrouillage.startsWith(SCHEMA_PREFIX)) {
    _schemaPath = codeDeverrouillage.slice(SCHEMA_PREFIX.length).split('-').map(Number).filter(Boolean);
    renderSchemaGrid();
    setDeverrouillageMode('schema');
    document.getElementById('t-code-deverrouillage').value = '';
  } else {
    clearSchema();
    setDeverrouillageMode('pin');
    document.getElementById('t-code-deverrouillage').value = codeDeverrouillage;
  }
  document.getElementById('t-code-sim').value = t.code_sim || '';
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
  // Bug préexistant (2026-07-11) : le canvas garde une taille 0x0 tant que l'onglet
  // Signature n'a jamais été affiché (resizeSigCanvas() mesure #sig-area via
  // getBoundingClientRect(), qui vaut 0x0 tant que .tab-content est display:none —
  // voir tickets.html, le bouton d'onglet appelle resizeSigCanvas() à l'affichage).
  // Sans ce garde, getImageData() sur largeur 0 lève IndexSizeError et casse tout
  // openNewTicket() dès que clearTicketForm() → clearSignature() est appelé.
  if (!sigCanvas || sigCanvas.width === 0 || sigCanvas.height === 0) return true;
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
async function populateClients() {
  const select = document.getElementById('t-client');
  if (!select) return;
  // Charger depuis API
  try {
    const r = await apiGet('/api/clients', { limit: 200 });
    const clients = (r.data?.data || []).map(c => ({
      id:    c.id,
      nom:   (c.prenom || '') + ' ' + (c.nom || c.last || ''),
      phone: c.telephone || c.phone || '',
      email: c.email || '',
    }));
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.nom.trim() || `Client #${c.id}`;
      select.appendChild(opt);
    });
    select.addEventListener('change', function() {
      const client = clients.find(c => c.id == this.value);
      if (client) {
        document.getElementById('t-new-client').value = client.nom.trim();
        document.getElementById('t-phone').value = client.phone;
        document.getElementById('t-email').value = client.email;
      }
    });
  } catch {
    // fallback localStorage silencieux
    const clients = getDB('clients');
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.first || ''} ${c.last || ''}`.trim() || `Client #${c.id}`;
      select.appendChild(opt);
    });
  }
}

// ======================== TECHNICIEN LIST ========================
// Dépend de GET /api/users (admin/manager uniquement, cf. routes/users.ts) —
// pour un rôle technicien l'appel échoue en 403 et le select reste sur
// "Non assigné" (échec silencieux, même style que populateClients() ci-dessus).
async function populateTechniciens() {
  const select = document.getElementById('t-technician');
  if (!select) return;
  try {
    const r = await apiGet('/api/users');
    // Filtré au rôle technicien : GET /api/users est un endpoint générique (retourne
    // aussi admin/manager) — ce select n'a de sens que pour assigner un vrai technicien.
    const techniciens = (r.data?.data || [])
      .filter(u => u.role === 'technicien')
      .map(u => ({
        id:  u.id,
        nom: (u.prenom || '') + ' ' + (u.nom || ''),
      }));
    techniciens.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.nom.trim() || `Utilisateur #${t.id}`;
      select.appendChild(opt);
    });
  } catch {
    // Échec silencieux (ex: rôle technicien sans accès à GET /api/users) —
    // même style que populateClients() ci-dessus. Le select reste sur
    // "Non assigné" uniquement.
  }
}

function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/**
 * Valide qu'une signature (data URL image PNG/JPEG base64) est sûre à interpoler
 * dans un `<img src="...">`. `esc()` n'échappe pas les guillemets — insuffisant en
 * contexte attribut — donc on valide le charset au lieu d'échapper. Défense en
 * profondeur : la même règle est déjà appliquée côté API (lib/validators.ts),
 * mais on ne fait pas confiance à la donnée juste parce qu'elle vient du serveur.
 */
function isValidSignatureDataUrl(s) { return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s || ''); }

// ======================== ARCHIVAGE + RGPD (Sprint 2.37) ========================

let _showArchived = false;

/**
 * toggleArchived — bascule entre tickets actifs et tickets archivés
 */
async function toggleArchived() {
  _showArchived = !_showArchived;
  const btn = document.getElementById('btn-toggle-archived');
  if (btn) {
    btn.style.background     = _showArchived ? '#f0fdf4' : '#fff';
    btn.style.color          = _showArchived ? '#16a34a' : '#6b7280';
    btn.style.borderColor    = _showArchived ? '#86efac' : '#e5e7eb';
    btn.textContent          = _showArchived ? '📦 Archivés ✓' : '📦 Archivés';
  }
  await loadTickets();
}

/**
 * archiverTicket — archive manuellement le ticket courant (POST /api/tickets/:id/archiver)
 */
async function archiverTicket() {
  const id = window._currentTicketId;
  if (!id) return;
  if (!confirm(`Archiver le ticket #${id} ?\n\nIl sera déplacé dans l'archive et n'apparaîtra plus dans la liste principale.`)) return;

  try {
    const token = getToken();
    const res = await fetch(`/api/tickets/${id}/archiver`, {
      method:  'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

    showToast(`Ticket #${id} archivé avec succès.`, 'success');
    closeModal('modal-ticket-detail');
    await loadTickets();
  } catch (err) {
    showToast(err.message || 'Erreur archivage.', 'error');
  }
}

// ======================== PHOTOS TICKETS (Sprint 2.36) ========================

let _currentPhotoTicketId = null;

/**
 * switchDetailTab — gère les onglets du modal détail ticket
 */
function switchDetailTab(tabId) {
  document.querySelectorAll('#modal-ticket-detail .tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#modal-ticket-detail .tab-btn').forEach(btn => btn.classList.remove('active'));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
  // Activer le bon bouton (par ordre d'index)
  const tabs = ['detail-info', 'detail-photos'];
  const idx  = tabs.indexOf(tabId);
  const btns = document.querySelectorAll('#modal-ticket-detail .tab-btn');
  if (btns[idx]) btns[idx].classList.add('active');

  // Charger les photos à la première activation
  if (tabId === 'detail-photos' && _currentPhotoTicketId) {
    loadPhotos(_currentPhotoTicketId);
  }
}

/**
 * loadPhotos — charge et affiche la galerie d'un ticket
 */
async function loadPhotos(ticketId) {
  _currentPhotoTicketId = ticketId;

  const loading = document.getElementById('photos-loading');
  const warning = document.getElementById('photos-r2-warning');
  const gallery = document.getElementById('photos-gallery');

  if (!gallery) return;

  if (loading) loading.style.display = 'block';
  gallery.style.display = 'none';
  if (warning) warning.style.display = 'none';

  try {
    const r = await apiGet(`/api/tickets/${ticketId}/photos`);

    if (!r.ok && r.status === 503) {
      if (loading) loading.style.display = 'none';
      if (warning) warning.style.display = 'block';
      gallery.style.display = 'none';
      return;
    }

    const photos = r.data?.data || [];
    renderGallery(ticketId, photos);
  } catch (err) {
    console.warn('[Photos] Erreur chargement:', err.message);
    if (warning) warning.style.display = 'block';
  } finally {
    if (loading) loading.style.display = 'none';
    gallery.style.display = 'block';
  }
}

/**
 * renderGallery — construit la grille avant/après/autre
 */
function renderGallery(ticketId, photos) {
  const types = ['avant', 'apres', 'autre'];
  types.forEach(t => {
    const grid    = document.getElementById(`gallery-${t}`);
    const empty   = document.getElementById(`empty-${t}`);
    const counter = document.getElementById(`count-${t}`);
    if (!grid) return;

    const subset = photos.filter(p => p.type_photo === t);
    grid.innerHTML = '';

    if (subset.length === 0) {
      if (empty) empty.style.display = 'block';
      if (counter) counter.textContent = '';
    } else {
      if (empty) empty.style.display = 'none';
      if (counter) counter.textContent = `(${subset.length})`;
      subset.forEach(photo => {
        const thumb = buildPhotoThumb(ticketId, photo);
        grid.appendChild(thumb);
      });
    }
  });
}

/**
 * buildPhotoThumb — crée la vignette d'une photo
 */
function buildPhotoThumb(ticketId, photo) {
  const div = document.createElement('div');
  div.className = 'photo-thumb';
  div.dataset.photoId = photo.id;

  div.innerHTML = `
    <img alt="${esc(photo.nom_fichier)}" loading="lazy">
    <button class="photo-thumb-del" onclick="deletePhotoConfirm(event, ${ticketId}, ${photo.id})" title="Supprimer">✕</button>
    <div class="photo-thumb-label">${esc(photo.nom_fichier)}</div>
  `;
  const imgEl = div.querySelector('img');
  loadAuthenticatedImage(ticketId, photo.id, imgEl);
  imgEl.addEventListener('click', () => openLightbox(ticketId, photo.id));
  return div;
}

/**
 * loadAuthenticatedImage — affiche une photo protégée par JWT dans une balise
 * <img>, qui ne peut jamais porter de header Authorization. Récupère d'abord
 * une URL courte durée (5 min) via GET /photos/:photoId/url (JSON, authentifié
 * normalement), puis l'affecte directement à img.src — le token est encodé
 * dans l'URL elle-même (voir src/lib/photoToken.ts côté backend), pas de
 * fetch()/blob intermédiaire nécessaire.
 */
async function loadAuthenticatedImage(ticketId, photoId, imgEl) {
  try {
    const r = await apiGet(`/api/tickets/${ticketId}/photos/${photoId}/url`);
    if (!r.ok || !r.data?.url) throw new Error(r.error || 'URL indisponible');
    imgEl.src = r.data.url;
  } catch (err) {
    imgEl.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23f3f4f6%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%239ca3af%22>📷</text></svg>';
  }
}

// ── Drag & drop dropzone photos ───────────────────────────────────────────────

function photoDragOver(e) {
  e.preventDefault();
  document.getElementById('photo-dropzone')?.classList.add('drag-over');
}
function photoDragLeave(e) {
  document.getElementById('photo-dropzone')?.classList.remove('drag-over');
}
function photoDrop(e) {
  e.preventDefault();
  document.getElementById('photo-dropzone')?.classList.remove('drag-over');
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) processPhotoFile(files[0]);
}
function handlePhotoFile(e) {
  const files = e.target.files;
  if (files && files.length > 0) processPhotoFile(files[0]);
  e.target.value = ''; // reset pour re-sélection du même fichier
}

/**
 * processPhotoFile — compresse via canvas puis upload
 */
async function processPhotoFile(file) {
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    showToast('Format non supporté. Utilisez JPEG, PNG ou WebP.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Fichier trop lourd (max 5 Mo).', 'error');
    return;
  }
  if (!_currentPhotoTicketId) {
    showToast('Aucun ticket sélectionné.', 'error');
    return;
  }

  const type = document.getElementById('photo-type-select')?.value || 'autre';

  // Compression via canvas (cible max 1400px, qualité 0.82)
  let blob;
  try {
    blob = await compressImage(file, 1400, 0.82);
  } catch {
    blob = file; // fallback sans compression
  }

  await uploadPhoto(_currentPhotoTicketId, blob, file.name, type);
}

/**
 * compressImage — redimensionne et compresse une image via canvas
 * @param {File} file
 * @param {number} maxDim — dimension max en px
 * @param {number} quality — 0..1 pour JPEG
 * @returns {Promise<Blob>}
 */
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else                { width  = Math.round(width  * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), outMime, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

/**
 * uploadPhoto — POST multipart vers /api/tickets/:id/photos
 */
async function uploadPhoto(ticketId, blob, nom, type) {
  const progress   = document.getElementById('photo-upload-progress');
  const progressBar = document.getElementById('photo-progress-bar');
  const statusTxt  = document.getElementById('photo-upload-status');

  if (progress) progress.style.display = 'block';
  if (progressBar) progressBar.style.width = '30%';
  if (statusTxt) statusTxt.textContent = 'Compression et envoi...';

  try {
    const formData = new FormData();
    formData.append('photo', blob, nom);
    formData.append('type', type);

    const token = getToken();

    if (progressBar) progressBar.style.width = '60%';

    const res = await fetch(`/api/tickets/${ticketId}/photos`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (progressBar) progressBar.style.width = '90%';

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Erreur upload');

    if (progressBar) progressBar.style.width = '100%';
    if (statusTxt) statusTxt.textContent = '✅ Photo ajoutée !';

    setTimeout(() => {
      if (progress) progress.style.display = 'none';
      if (progressBar) progressBar.style.width = '0%';
    }, 1200);

    // Recharger la galerie
    await loadPhotos(ticketId);
    showToast('Photo ajoutée avec succès.', 'success');
  } catch (err) {
    if (progress) progress.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
    showToast(err.message || 'Erreur lors de l\'upload.', 'error');
  }
}

/**
 * deletePhotoConfirm — confirmation + suppression d'une photo
 */
async function deletePhotoConfirm(e, ticketId, photoId) {
  e.stopPropagation();
  if (!confirm('Supprimer cette photo ? Cette action est irréversible.')) return;

  try {
    const r = await apiDelete(`/api/tickets/${ticketId}/photos/${photoId}`);
    if (!r.ok) throw new Error(r.error || 'Erreur suppression');
    // Retirer la vignette du DOM directement (UX instantanée)
    const thumb = document.querySelector(`.photo-thumb[data-photo-id="${photoId}"]`);
    if (thumb) thumb.remove();
    showToast('Photo supprimée.', 'success');
    // Recharger pour mise à jour compteurs
    await loadPhotos(ticketId);
  } catch (err) {
    showToast(err.message || 'Erreur lors de la suppression.', 'error');
  }
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function openLightbox(ticketId, photoId) {
  const lb  = document.getElementById('photo-lightbox');
  const img = document.getElementById('lightbox-img');
  if (!lb || !img) return;
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  loadAuthenticatedImage(ticketId, photoId, img);
}
function closeLightbox() {
  const lb = document.getElementById('photo-lightbox');
  if (lb) lb.style.display = 'none';
  document.body.style.overflow = '';
}
// Fermer sur Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

// ══════════════════════════════════════════════════════════════════════════════
// AUTOCOMPLETE MODÈLE APPAREIL + SUGGESTION SERVICES (Sprint 2.38)
// ══════════════════════════════════════════════════════════════════════════════

let _modelesCache   = null;
let _modeleTimer    = null;

/** Déclenché à chaque frappe dans le champ Modèle */
async function onModeleInput(val) {
  clearTimeout(_modeleTimer);
  const box = document.getElementById('modele-suggestions');
  const hidId = document.getElementById('t-device-model-id');

  // Si valeur effacée → reset
  if (!val || val.length < 2) {
    box.style.display = 'none';
    hidId.value = '';
    hideSuggestions();
    return;
  }

  // Debounce 300ms
  _modeleTimer = setTimeout(async () => {
    if (!_modelesCache) {
      const res = await apiGet('/api/services/modeles?limit=500');
      _modelesCache = res.data?.data || [];
    }
    const lv = val.toLowerCase();
    const matches = _modelesCache.filter(m =>
      m.nom.toLowerCase().includes(lv) || (m.marque_nom || '').toLowerCase().includes(lv)
    ).slice(0, 10);

    if (!matches.length) { box.style.display = 'none'; return; }

    // data-* + délégation d'événement (pas de onclick inline construit par interpolation
    // de m.nom) : m.nom peut venir de l'API externe phone-specs-api ou d'une création
    // manuelle admin — un onclick="...('${m.nom}')" casserait l'attribut avec un simple
    // guillemet double et permettrait une injection HTML (voir bugs.md).
    box.innerHTML = matches.map(m => `
      <div class="modele-suggestion-item" data-id="${escapeHtml(String(m.id))}" data-nom="${escapeHtml(m.nom)}" data-marque="${escapeHtml(m.marque_nom || '')}"
           style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;"
           onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''">
        <span style="font-weight:600;">${escapeHtml(m.nom)}</span>
        <span style="color:#94a3b8;"> — ${escapeHtml(m.marque_nom || '')}</span>
        ${m.type ? `<span style="font-size:11px;color:#6366f1;margin-left:6px;">${escapeHtml(m.type)}</span>` : ''}
      </div>
    `).join('');
    box.style.display = 'block';
    if (!box.dataset.wired) {
      box.dataset.wired = '1';
      box.addEventListener('click', e => {
        const item = e.target.closest('.modele-suggestion-item');
        if (!item) return;
        selectModeleFromSuggestion(item.dataset.id, `${item.dataset.nom} — ${item.dataset.marque}`);
      });
    }
  }, 300);
}

async function selectModeleFromSuggestion(modeleId, nom) {
  document.getElementById('t-device-model').value   = nom;
  document.getElementById('t-device-model-id').value = modeleId;
  document.getElementById('modele-suggestions').style.display = 'none';

  // Charger les services suggérés
  await loadServicesSuggestionsForModele(modeleId);
}

async function loadServicesSuggestionsForModele(modeleId) {
  const box  = document.getElementById('services-suggestion-box');
  const list = document.getElementById('services-suggestion-list');

  if (!modeleId) { box.style.display = 'none'; return; }

  const res  = await apiGet(`/api/services/modeles/${modeleId}/services`);
  const svcs = res.data?.services || [];

  if (!svcs.length) { box.style.display = 'none'; return; }

  list.innerHTML = svcs.map(s => `
    <label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;">
      <input type="checkbox" value="${s.id}" data-prix="${s.prix_ttc_effectif || 0}" data-nom="${s.nom.replace(/"/g,'&quot;')}"
        style="accent-color:#6366f1;">
      <span>${escapeHtml(s.nom)}</span>
      <span style="color:#6366f1;font-weight:600;">${(s.prix_ttc_effectif || 0).toFixed(2)} €</span>
      ${s.prix_ht_specifique != null ? `<span style="font-size:10px;color:#f59e0b;">prix spé.</span>` : ''}
    </label>
  `).join('');

  box.style.display = 'block';
}

function hideSuggestions() {
  const box = document.getElementById('services-suggestion-box');
  if (box) box.style.display = 'none';
}

/** Fermer les suggestions si clic ailleurs */
document.addEventListener('click', e => {
  const box = document.getElementById('modele-suggestions');
  const inp = document.getElementById('t-device-model');
  if (box && inp && !inp.contains(e.target) && !box.contains(e.target)) {
    box.style.display = 'none';
  }
});

/** Petite fonction escapeHtml locale (évite conflit si app.js définit escHtml) */
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── Autocomplete Marque (champ Appareil) ──────────────────────────────────
// Même pattern que l'autocomplete Modèle ci-dessus : cache local, filtre
// client-side dès 2 caractères, debounce 300ms. /api/services/marques
// renvoie {success, data: MarqueAppareil[]} — la donnée est bien dans .data.data
// (voir bug corrigé dans onModeleInput pour la même API).
let _marquesCache = null;
let _marqueTimer  = null;

/** Déclenché à chaque frappe dans le champ Appareil (marque) */
async function onMarqueInput(val) {
  clearTimeout(_marqueTimer);
  const box = document.getElementById('marque-suggestions');

  if (!val || val.length < 2) {
    box.style.display = 'none';
    return;
  }

  _marqueTimer = setTimeout(async () => {
    if (!_marquesCache) {
      const res = await apiGet('/api/services/marques');
      _marquesCache = res.data?.data || [];
    }
    const lv = val.toLowerCase();
    const matches = _marquesCache.filter(m => m.nom.toLowerCase().includes(lv)).slice(0, 10);

    if (!matches.length) { box.style.display = 'none'; return; }

    // data-* + délégation (même raison que onModeleInput ci-dessus : m.nom non fiable
    // à 100%, pas d'onclick inline construit par interpolation de chaîne).
    box.innerHTML = matches.map(m => `
      <div class="marque-suggestion-item" data-id="${escapeHtml(String(m.id))}" data-nom="${escapeHtml(m.nom)}"
           style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;"
           onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''">
        <span style="font-weight:600;">${escapeHtml(m.nom)}</span>
      </div>
    `).join('');
    box.style.display = 'block';
    if (!box.dataset.wired) {
      box.dataset.wired = '1';
      box.addEventListener('click', e => {
        const item = e.target.closest('.marque-suggestion-item');
        if (!item) return;
        selectMarqueFromSuggestion(item.dataset.id, item.dataset.nom);
      });
    }
  }, 300);
}

/** Remplit le champ Appareil depuis une suggestion cliquée */
function selectMarqueFromSuggestion(marqueId, nom) {
  document.getElementById('t-device-type').value    = nom;
  document.getElementById('t-device-type-id').value = marqueId;
  document.getElementById('marque-suggestions').style.display = 'none';
}

document.addEventListener('click', e => {
  const box = document.getElementById('marque-suggestions');
  const inp = document.getElementById('t-device-type');
  if (box && inp && !inp.contains(e.target) && !box.contains(e.target)) {
    box.style.display = 'none';
  }
});

// ─── Schéma de déverrouillage (grille 9 points) ────────────────────────────
// Alternative au code PIN pour le champ code_deverrouillage (ticketService.ts) —
// même colonne texte, aucune migration nécessaire : le schéma est sérialisé en
// chaîne "SCHEMA:1-5-9-7-3" (index des points dans l'ordre du tracé, numérotés
// 1→9 comme un écran Android, gauche-droite puis haut-bas).
const SCHEMA_PREFIX = 'SCHEMA:';
let _schemaPath = [];

/** Affichage lisible du champ code_deverrouillage dans la fiche détail (PIN tel quel, schéma en flèche). */
function formatCodeDeverrouillage(code) {
  if (!code || !code.startsWith(SCHEMA_PREFIX)) return code;
  return 'Schéma ' + code.slice(SCHEMA_PREFIX.length).split('-').join(' → ');
}

/** Construit les 9 points de la grille schéma (appelé une fois au chargement de la page) */
function initSchemaGrid() {
  const dotsEl = document.getElementById('schema-dots');
  if (!dotsEl) return;
  dotsEl.innerHTML = '';
  for (let i = 1; i <= 9; i++) {
    const dot = document.createElement('div');
    dot.className = 'schema-dot';
    dot.dataset.idx = i;
    dot.style.cssText = 'width:58px;height:58px;border-radius:50%;border:2px solid #cbd5e1;'
      + 'display:flex;align-items:center;justify-content:center;cursor:pointer;'
      + 'font-size:13px;font-weight:700;color:#94a3b8;background:#fff;user-select:none;';
    dot.addEventListener('click', () => onSchemaDotClick(i));
    dotsEl.appendChild(dot);
  }
}

/** Ajoute un point au tracé en cours (ignoré si déjà utilisé) */
function onSchemaDotClick(idx) {
  if (_schemaPath.includes(idx)) return; // pas de repassage sur un point déjà utilisé
  _schemaPath.push(idx);
  renderSchemaGrid();
}

/** Centre pixel (x,y) d'un point 1-9 dans la grille 186x186 (58px + 15px gap). */
function schemaDotCenter(idx) {
  const col = (idx - 1) % 3;
  const row = Math.floor((idx - 1) / 3);
  return { x: col * 73 + 29, y: row * 73 + 29 };
}

/** Redessine les points (numéros d'ordre) + la polyline SVG depuis _schemaPath */
function renderSchemaGrid() {
  document.querySelectorAll('#schema-dots .schema-dot').forEach(dot => {
    const idx   = parseInt(dot.dataset.idx, 10);
    const order = _schemaPath.indexOf(idx);
    if (order === -1) {
      dot.textContent = '';
      dot.style.background   = '#fff';
      dot.style.borderColor  = '#cbd5e1';
    } else {
      dot.textContent = String(order + 1);
      dot.style.background   = '#6366f1';
      dot.style.borderColor  = '#6366f1';
      dot.style.color        = '#fff';
    }
  });
  const poly = document.getElementById('schema-polyline');
  if (poly) poly.setAttribute('points', _schemaPath.map(i => {
    const c = schemaDotCenter(i);
    return `${c.x},${c.y}`;
  }).join(' '));
  document.getElementById('t-schema-path').value = _schemaPath.join('-');
}

/** Réinitialise le tracé du schéma (bouton Effacer + reset formulaire) */
function clearSchema() {
  _schemaPath = [];
  renderSchemaGrid();
}

/** Bascule l'affichage entre saisie PIN (texte libre) et schéma (grille). */
function setDeverrouillageMode(mode) {
  const pinInput  = document.getElementById('t-code-deverrouillage');
  const gridWrap  = document.getElementById('schema-grid-wrap');
  const actions   = document.getElementById('schema-actions');
  const btnPin    = document.getElementById('btn-mode-pin');
  const btnSchema = document.getElementById('btn-mode-schema');
  const isSchema  = mode === 'schema';

  pinInput.style.display = isSchema ? 'none' : '';
  gridWrap.style.display = isSchema ? 'block' : 'none';
  actions.style.display  = isSchema ? 'block' : 'none';
  btnPin.classList.toggle('btn-primary', !isSchema);
  btnPin.classList.toggle('btn-secondary', isSchema);
  btnSchema.classList.toggle('btn-primary', isSchema);
  btnSchema.classList.toggle('btn-secondary', !isSchema);
  document.getElementById('t-schema-path').dataset.mode = mode;
}

/** Valeur à envoyer pour code_deverrouillage selon le mode actif (appelé par saveTicket). */
function getCodeDeverrouillageValue() {
  const mode = document.getElementById('t-schema-path')?.dataset.mode || 'pin';
  if (mode === 'schema') {
    return _schemaPath.length >= 4 ? SCHEMA_PREFIX + _schemaPath.join('-') : null;
  }
  return document.getElementById('t-code-deverrouillage').value.trim() || null;
}

window.onModeleInput                  = onModeleInput;
window.selectModeleFromSuggestion     = selectModeleFromSuggestion;
window.loadServicesSuggestionsForModele = loadServicesSuggestionsForModele;
window.onMarqueInput                  = onMarqueInput;
window.selectMarqueFromSuggestion     = selectMarqueFromSuggestion;
window.setDeverrouillageMode          = setDeverrouillageMode;
window.clearSchema                    = clearSchema;

// ── Helper : showToast (si pas défini globalement dans app.js) ─────────────────
function showToast(msg, type = 'info') {
  // Réutilise la fonction globale de app.js si disponible
  if (typeof window.showNotification === 'function') {
    window.showNotification(msg, type);
    return;
  }
  // Fallback minimal
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 18px;border-radius:10px;font-size:0.88rem;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.15);color:#fff;background:${type==='error'?'#ef4444':type==='success'?'#22c55e':'#6366f1'};transition:opacity .3s;`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 350); }, 3000);
}
