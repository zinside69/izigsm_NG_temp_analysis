/**
 * iziGSM — devis.js
 * Sprint 2.19 — MOD-03 Devis — UI complète connectée à l'API D1
 *
 * API endpoints utilisés :
 *   GET  /api/devis                      → liste paginée
 *   GET  /api/devis/stats                → KPIs agrégés
 *   GET  /api/devis/:id                  → détail + lignes
 *   POST /api/devis                      → création
 *   PUT  /api/devis/:id                  → modification (draft only)
 *   PUT  /api/devis/:id/statut           → machine à états
 *   POST /api/devis/:id/envoyer          → envoi email client + statut → envoye
 *   PUT  /api/devis/:id/convertir        → → facture NF525
 *
 * Machine à états :
 *   draft → envoye → accepte | refuse | expire | annule
 */

'use strict';

// ─── État global ───────────────────────────────────────────────────────────────
let devisLines         = [];   // IDs des lignes du formulaire en cours
let currentDevisId     = null; // ID édition (null = création)
let allDevisCache      = [];   // cache liste
let devisUseApi        = true;
let allClientsForDevis = [];   // cache select clients

// ─── Badges statuts ────────────────────────────────────────────────────────────
const STATUT_DEVIS = {
  draft:   { label: 'Brouillon', cls: 'badge-gray',   emoji: '📝' },
  envoye:  { label: 'Envoyé',    cls: 'badge-blue',   emoji: '📤' },
  accepte: { label: 'Accepté',   cls: 'badge-green',  emoji: '✅' },
  refuse:  { label: 'Refusé',    cls: 'badge-red',    emoji: '❌' },
  expire:  { label: 'Expiré',    cls: 'badge-orange', emoji: '⌛' },
  annule:  { label: 'Annulé',    cls: 'badge-gray',   emoji: '🚫' },
};

/**
 * Retourne le badge HTML pour un statut devis.
 * @param {string} statut
 */
function devisBadge(statut) {
  const s = STATUT_DEVIS[statut] ?? { label: statut, cls: 'badge-gray', emoji: '📋' };
  return `<span class="badge ${s.cls}">${s.emoji} ${s.label}</span>`;
}

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  buildSidebar('devis');
  Promise.all([loadDevisStats(), loadDevis(), loadClientsForDevis()]).then(() => {
    checkFromTicket();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Charge et affiche les KPIs stats en haut de page.
 */
async function loadDevisStats() {
  try {
    const result = await apiGet('/api/devis/stats');
    if (!result.ok) return;
    // apiGet() renvoie {ok,status,data,error} où data est le corps JSON complet
    // {success,data} de la route — result.data seul est l'enveloppe, pas les stats
    // (bug corrigé le 2026-07-16 : les KPIs affichaient toujours 0).
    const s = result.data?.data || {};
    const container = document.getElementById('devis-stats');
    if (!container) return;
    container.innerHTML = [
      kpiCard('Total',     s.total,           '📋', ''),
      kpiCard('Brouillon', s.draft,            '📝', 'var(--muted)'),
      kpiCard('Envoyés',   s.envoyes,          '📤', 'var(--blue, #3b82f6)'),
      kpiCard('Acceptés',  s.acceptes,         '✅', 'var(--green, #16a34a)'),
      kpiCard('Refusés',   s.refuses,          '❌', 'var(--red)'),
      kpiCard('CA signé',  fmtEur(s.montant_signe), '💰', 'var(--primary)'),
      kpiCard('Taux conv.', s.taux_conversion !== null ? s.taux_conversion + ' %' : '—', '📈', 'var(--primary)'),
    ].join('');
  } catch (_) { /* non bloquant */ }
}

function kpiCard(label, value, emoji, color) {
  return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;text-align:center;">
    <div style="font-size:1.4rem;">${emoji}</div>
    <div style="font-size:1.25rem;font-weight:800;color:${color || 'var(--text)'};">${value ?? 0}</div>
    <div style="font-size:0.78rem;color:var(--muted);margin-top:2px;">${label}</div>
  </div>`;
}

function fmtEur(n) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n ?? 0);
}

/**
 * Charge la liste des devis depuis l'API.
 */
async function loadDevis() {
  try {
    const result = await apiGet('/api/devis', { limit: 200 });
    if (!result.ok) throw new Error(result.error || 'Erreur API');

    allDevisCache = result.data?.data || [];
    setDB('devis', allDevisCache);
    devisUseApi = true;
  } catch (err) {
    console.warn('[Devis] API indisponible, fallback localStorage:', err.message);
    allDevisCache = getDB('devis');
    devisUseApi = false;
  }
  renderDevis();
}

/**
 * Charge les clients pour peupler le select.
 */
async function loadClientsForDevis() {
  try {
    const result = await apiGet('/api/clients', { limit: 500 });
    if (result.ok) {
      allClientsForDevis = (result.data?.data || []).map(c => ({
        id:   c.id,
        name: [c.prenom, c.nom].filter(Boolean).join(' ') || c.email || '—',
      }));
    }
  } catch (_) {
    allClientsForDevis = getDB('clients').map(c => ({
      id:   c.id,
      name: c.name || [c.first, c.last].filter(Boolean).join(' ') || '—',
    }));
  }
  populateDevisClients();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDU LISTE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Affiche la liste des devis avec filtres actifs.
 * @param {string} [searchVal]
 * @param {string} [statusVal]
 */
function renderDevis(searchVal = '', statusVal = '') {
  searchVal = searchVal ?? document.getElementById('search-devis')?.value ?? '';
  statusVal = statusVal ?? document.getElementById('filter-devis-status')?.value ?? '';

  let data = allDevisCache;

  if (searchVal) {
    const q = searchVal.toLowerCase();
    data = data.filter(d =>
      (d.numero || '').toLowerCase().includes(q) ||
      (d.client_nom || '').toLowerCase().includes(q) ||
      (d.client_prenom || '').toLowerCase().includes(q)
    );
  }
  if (statusVal) {
    data = data.filter(d => d.statut === statusVal);
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

  tbody.innerHTML = data.map(d => {
    const clientNom  = [d.client_prenom, d.client_nom].filter(Boolean).join(' ') || '—';
    const validiteJs = d.date_validite ? new Date(d.date_validite) : null;
    const jRestants  = validiteJs
      ? Math.ceil((validiteJs - Date.now()) / 86400000)
      : null;
    const validiteLabel = validiteJs
      ? (jRestants !== null && jRestants <= 0
          ? `<span style="color:var(--red);font-size:0.82rem;">Expiré</span>`
          : `<span style="font-size:0.85rem;color:${jRestants <= 5 ? 'var(--orange,#ea580c)' : 'var(--muted)'};">${jRestants}j</span>`)
      : '<span style="color:var(--muted);font-size:0.82rem;">—</span>';

    const actions = buildRowActions(d);

    return `<tr>
      <td>
        <span style="font-weight:700;color:var(--primary);cursor:pointer;" onclick="openDevisDetail(${d.id})">${esc(d.numero)}</span>
      </td>
      <td>${esc(clientNom)}</td>
      <td>${formatMoney(d.total_ht ?? 0)}</td>
      <td>${formatMoney(d.total_tva ?? 0)}</td>
      <td><strong>${formatMoney(d.total_ttc ?? 0)}</strong></td>
      <td>${devisBadge(d.statut)}</td>
      <td><span style="font-size:0.85rem;color:var(--muted);">${formatDate(d.created_at, true)}</span></td>
      <td>${validiteLabel}</td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>`;
  }).join('');
}

/**
 * Construit les boutons d'action selon le statut du devis.
 * @param {Object} d - Objet devis
 */
function buildRowActions(d) {
  const btns = [];

  btns.push(`<button class="btn btn-ghost btn-sm" onclick="openDevisDetail(${d.id})" title="Voir le détail">👁</button>`);

  if (d.statut === 'draft') {
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="envoyerDevis(${d.id})" title="Envoyer au client">📧</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="annulerDevis(${d.id})" style="color:var(--muted);" title="Annuler">🚫</button>`);
  }
  if (d.statut === 'envoye') {
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="changerStatutDevis(${d.id},'accepte')" style="color:var(--green,#16a34a);" title="Marquer accepté">✅</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="changerStatutDevis(${d.id},'refuse')" style="color:var(--red);" title="Marquer refusé">❌</button>`);
  }
  if ((d.statut === 'envoye' || d.statut === 'accepte') && !d.facture_id) {
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="convertToFacture(${d.id})" title="Convertir en facture">→ Facture</button>`);
  }
  if (d.facture_id) {
    btns.push(`<span style="font-size:.8rem;color:var(--muted);">Facturé</span>`);
  }

  return btns.join('');
}

function filterDevis(val) {
  renderDevis(val, document.getElementById('filter-devis-status')?.value || '');
}
function filterDevisStatus(val) {
  renderDevis(document.getElementById('search-devis')?.value || '', val);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL DÉTAIL DEVIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ouvre le modal de détail d'un devis avec ses lignes et les boutons d'action.
 * @param {number} id - ID du devis
 */
async function openDevisDetail(id) {
  const body   = document.getElementById('detail-body');
  const footer = document.getElementById('detail-footer');
  const titre  = document.getElementById('detail-titre');
  if (!body || !footer || !titre) return;

  body.innerHTML   = '<div style="text-align:center;padding:32px;color:var(--muted);">Chargement…</div>';
  footer.innerHTML = '';
  openModal('modal-devis-detail');

  try {
    const result = await apiGet('/api/devis/' + id);
    if (!result.ok) throw new Error(result.error || 'Erreur API');

    // result.data est l'enveloppe {success,data} de la route, pas le devis lui-même
    // (même bug que loadDevisStats() ci-dessus — corrigé le 2026-07-16, cette fiche
    // détail n'affichait jamais aucune donnée réelle auparavant).
    const d = result.data?.data;
    titre.textContent = `Devis ${d.numero}`;

    const clientNom = [d.client_prenom, d.client_nom].filter(Boolean).join(' ') || '—';
    const badge     = devisBadge(d.statut);

    // Lien public
    const lienPublic = d.public_token
      ? `<a href="/devis-public?token=${d.public_token}" target="_blank"
           style="font-size:0.82rem;color:var(--primary);word-break:break-all;">
           🔗 Lien client
         </a>`
      : '';

    // Lignes
    const lignesHTML = (d.lignes || []).map((l, i) => `
      <tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:8px 12px;font-size:0.88rem;">${i + 1}. ${esc(l.description)}</td>
        <td style="padding:8px 12px;text-align:right;font-size:0.88rem;">${l.quantite}</td>
        <td style="padding:8px 12px;text-align:right;font-size:0.88rem;">${formatMoney(l.prix_unitaire_ht)}</td>
        <td style="padding:8px 12px;text-align:right;font-size:0.88rem;">${l.tva_taux ?? 20} %</td>
        <td style="padding:8px 12px;text-align:right;font-size:0.88rem;font-weight:700;">${formatMoney(l.total_ttc)}</td>
      </tr>`).join('');

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div>
          <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Client</div>
          <div style="font-weight:700;">${esc(clientNom)}</div>
          ${d.client_email ? `<div style="font-size:0.85rem;color:var(--muted);">${esc(d.client_email)}</div>` : ''}
          ${d.client_telephone ? `<div style="font-size:0.85rem;color:var(--muted);">${esc(d.client_telephone)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="margin-bottom:6px;">${badge}</div>
          <div style="font-size:0.82rem;color:var(--muted);">Créé le ${formatDate(d.created_at, true)}</div>
          ${d.date_validite ? `<div style="font-size:0.82rem;color:var(--muted);">Valide jusqu'au ${formatDate(d.date_validite, true)}</div>` : ''}
          ${d.envoye_le    ? `<div style="font-size:0.82rem;color:var(--muted);">Envoyé le ${formatDate(d.envoye_le, true)}</div>` : ''}
          ${d.repondu_le   ? `<div style="font-size:0.82rem;color:var(--muted);">Répondu le ${formatDate(d.repondu_le, true)}</div>` : ''}
          <div style="margin-top:6px;">${lienPublic}</div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:10px 12px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);">Description</th>
            <th style="text-align:right;padding:10px 12px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);width:55px;">Qté</th>
            <th style="text-align:right;padding:10px 12px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);width:95px;">PU HT</th>
            <th style="text-align:right;padding:10px 12px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);width:60px;">TVA</th>
            <th style="text-align:right;padding:10px 12px;font-size:0.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);width:95px;">TTC</th>
          </tr>
        </thead>
        <tbody>${lignesHTML || '<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--muted);font-size:0.88rem;">Aucune ligne</td></tr>'}</tbody>
      </table>

      <div style="margin-top:14px;text-align:right;">
        <div style="font-size:0.88rem;color:var(--muted);">Sous-total HT : <strong>${formatMoney(d.total_ht)}</strong></div>
        <div style="font-size:0.88rem;color:var(--muted);">TVA : <strong>${formatMoney(d.total_tva)}</strong></div>
        <div style="font-size:1.15rem;font-weight:800;margin-top:6px;">Total TTC : <span style="color:var(--primary);">${formatMoney(d.total_ttc)}</span></div>
      </div>

      ${d.notes ? `<div style="margin-top:14px;padding:12px 14px;background:#f1f5f9;border-radius:8px;font-size:0.88rem;color:var(--text);">
        <strong>Notes :</strong> ${esc(d.notes)}
      </div>` : ''}

      <!-- Placeholder acompte : id 'detail-acompte' réutilisé volontairement (même id
           que la fiche détail ticket dans tickets.js) — les modals modal-ticket-detail
           et modal-devis-detail ne sont jamais ouverts simultanément, donc pas de
           collision réelle dans le DOM. Voir renderAcompteDetail() ci-dessous. -->
      <div id="detail-acompte"></div>
    `;

    renderAcompteDetail(d, 'devis');

    // Boutons footer selon statut
    const footerBtns = [];
    footerBtns.push(`<button class="btn btn-secondary" onclick="closeModal('modal-devis-detail')">Fermer</button>`);

    if (d.statut === 'draft') {
      footerBtns.push(`<button class="btn btn-ghost" onclick="closeModal('modal-devis-detail');openEditDevis(${d.id})">✏️ Modifier</button>`);
      footerBtns.push(`<button class="btn btn-primary" onclick="closeModal('modal-devis-detail');envoyerDevis(${d.id})">📧 Envoyer au client</button>`);
    }
    if (d.statut === 'envoye') {
      footerBtns.push(`<button class="btn btn-ghost" style="color:var(--green,#16a34a);border-color:var(--green,#16a34a);" onclick="closeModal('modal-devis-detail');changerStatutDevis(${d.id},'accepte')">✅ Accepter</button>`);
      footerBtns.push(`<button class="btn btn-ghost" style="color:var(--red);border-color:var(--red);" onclick="closeModal('modal-devis-detail');changerStatutDevis(${d.id},'refuse')">❌ Refuser</button>`);
    }
    if ((d.statut === 'envoye' || d.statut === 'accepte') && !d.facture_id) {
      footerBtns.push(`<button class="btn btn-primary" onclick="closeModal('modal-devis-detail');convertToFacture(${d.id})">→ Convertir en facture</button>`);
    }

    footer.innerHTML = footerBtns.join('');

  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--red);">Erreur : ${esc(err.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL CRÉATION / MODIFICATION DEVIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ouvre le modal de création d'un nouveau devis.
 */
function openNewDevis() {
  currentDevisId = null;
  devisLines = [];

  document.getElementById('modal-devis-title').textContent = 'Nouveau devis';
  document.getElementById('d-client').value = '';
  document.getElementById('d-ticket').innerHTML = '<option value="">Aucun</option>';
  document.getElementById('d-notes').value   = '';
  document.getElementById('d-validity').value = '30';
  document.getElementById('d-tva').value     = '20';

  const tbody = document.getElementById('devis-lines');
  if (tbody) tbody.innerHTML = '';

  // Peupler le select tickets depuis cache localStorage
  _populateDevisTickets();

  addLine(); // Ligne par défaut
  updateDevisTotals();
  openModal('modal-devis');
}

/**
 * Ouvre le modal en mode édition d'un devis existant.
 * @param {number} id - ID du devis à modifier
 */
async function openEditDevis(id) {
  currentDevisId = id;
  devisLines = [];

  document.getElementById('modal-devis-title').textContent = 'Modifier le devis';
  document.getElementById('d-notes').value = '';

  const tbody = document.getElementById('devis-lines');
  if (tbody) tbody.innerHTML = '';

  openModal('modal-devis');

  try {
    const result = await apiGet('/api/devis/' + id);
    if (!result.ok) throw new Error(result.error || 'Erreur API');
    // Même bug que openDevisDetail() ci-dessus (corrigé le 2026-07-16) : sans
    // ?.data, le formulaire de modification ne se pré-remplissait jamais.
    const d = result.data?.data;

    document.getElementById('d-client').value  = d.client_id || '';
    document.getElementById('d-notes').value   = d.notes     || '';
    if (d.date_validite) {
      const jours = Math.ceil((new Date(d.date_validite) - Date.now()) / 86400000);
      const valSelect = document.getElementById('d-validity');
      if (valSelect) {
        const closest = ['15','30','60','90'].reduce((a, b) =>
          Math.abs(parseInt(b) - jours) < Math.abs(parseInt(a) - jours) ? b : a
        );
        valSelect.value = closest;
      }
    }

    // Charger les lignes
    for (const l of d.lignes || []) {
      addLine(l);
    }
    if (!d.lignes?.length) addLine();
    updateDevisTotals();

    _populateDevisTickets(d.ticket_id);
  } catch (err) {
    showFlash('Impossible de charger le devis : ' + err.message, 'error');
    closeModal('modal-devis');
  }
}

/**
 * Peuple le select ticket dans le formulaire.
 * @param {number|null} [selectedId]
 */
function _populateDevisTickets(selectedId = null) {
  const sel = document.getElementById('d-ticket');
  if (!sel) return;
  sel.innerHTML = '<option value="">Aucun</option>';
  const tickets = getDB('tickets');
  tickets.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = '#' + String(t.id).slice(-4) + ' — ' + (t.clientName || '') + ' (' + (t.deviceType || t.appareil_marque || '') + ')';
    if (selectedId && t.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

/**
 * Sauvegarde (création ou mise à jour) du devis.
 * @param {string} statut - 'draft' | 'envoye'
 */
async function saveDevis(statut) {
  const clientId   = parseInt(document.getElementById('d-client')?.value) || null;
  const ticketId   = parseInt(document.getElementById('d-ticket')?.value) || null;
  const notes      = document.getElementById('d-notes')?.value.trim() || '';
  const validity   = parseInt(document.getElementById('d-validity')?.value) || 30;
  const defaultTva = parseFloat(document.getElementById('d-tva')?.value) || 20;
  const boutiqueId = getBoutiqueId();

  // Validation
  if (devisUseApi && !clientId) {
    showFlash('Veuillez sélectionner un client.', 'error');
    return;
  }
  if (!devisLines.length) {
    showFlash('Ajoutez au moins une ligne.', 'error');
    return;
  }

  // Construire les lignes
  const lignes = devisLines.map(lid => ({
    description:      document.getElementById('dl-desc-' + lid)?.value || '',
    quantite:         parseFloat(document.getElementById('dl-qty-' + lid)?.value) || 1,
    prix_unitaire_ht: parseFloat(document.getElementById('dl-price-' + lid)?.value) || 0,
    tva_taux:         parseFloat(document.getElementById('dl-tva-' + lid)?.value) || defaultTva,
  })).filter(l => l.description || l.prix_unitaire_ht);

  if (!lignes.length) {
    showFlash('Remplissez au moins une ligne avec une description ou un prix.', 'error');
    return;
  }

  const dateValidite = new Date(Date.now() + validity * 86400000).toISOString().split('T')[0];

  const payload = {
    client_id:    clientId,
    ticket_id:    ticketId || undefined,
    lignes,
    notes:        notes || undefined,
    date_validite: dateValidite,
    boutique_id:  boutiqueId,
  };

  try {
    let result;
    if (currentDevisId && statut === 'draft') {
      // Mise à jour brouillon existant
      result = await apiPut('/api/devis/' + currentDevisId, payload);
    } else {
      // Création
      result = await apiPost('/api/devis', payload);
    }

    if (!result.ok) throw new Error(result.error || 'Erreur API');

    const newId = result.data?.id ?? currentDevisId;

    // Si demande d'envoi immédiat, appeler l'endpoint envoyer
    if (statut === 'envoye' && newId) {
      const sendResult = await apiPost('/api/devis/' + newId + '/envoyer', {});
      if (!sendResult.ok) {
        showFlash('Devis créé mais envoi email échoué : ' + (sendResult.error || 'Erreur'), 'warning');
      } else {
        showFlash('Devis envoyé au client 📧', 'success');
      }
    } else {
      showFlash('Devis ' + (currentDevisId ? 'mis à jour' : 'créé') + ' en brouillon 💾', 'success');
    }

    closeModal('modal-devis');
    await Promise.all([loadDevisStats(), loadDevis()]);

  } catch (err) {
    console.error('Erreur saveDevis:', err);
    showFlash('Erreur : ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIONS SUR STATUT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Envoie le devis au client par email (statut draft → envoye).
 * @param {number} id
 */
async function envoyerDevis(id) {
  if (!confirm('Envoyer ce devis au client par email ?')) return;
  try {
    const result = await apiPost('/api/devis/' + id + '/envoyer', {});
    if (!result.ok) throw new Error(result.error || 'Erreur API');
    showFlash('Devis envoyé au client 📧', 'success');
    await Promise.all([loadDevisStats(), loadDevis()]);
  } catch (err) {
    showFlash('Erreur envoi : ' + err.message, 'error');
  }
}

/**
 * Change le statut d'un devis via la machine à états.
 * @param {number} id
 * @param {string} statut - 'accepte' | 'refuse' | 'annule' | 'expire'
 */
async function changerStatutDevis(id, statut) {
  const labels = { accepte: 'accepter', refuse: 'refuser', annule: 'annuler', expire: 'expirer' };
  const label  = labels[statut] || statut;
  if (!confirm(`Voulez-vous ${label} ce devis ?`)) return;

  try {
    const result = await apiPut('/api/devis/' + id + '/statut', { statut });
    if (!result.ok) throw new Error(result.error || 'Erreur API');
    const s = STATUT_DEVIS[statut];
    showFlash('Devis ' + (s?.label?.toLowerCase() || statut) + ' ' + (s?.emoji || ''), 'success');
    await Promise.all([loadDevisStats(), loadDevis()]);
  } catch (err) {
    showFlash('Erreur : ' + err.message, 'error');
  }
}

/**
 * Annule un devis (raccourci).
 * @param {number} id
 */
async function annulerDevis(id) {
  return changerStatutDevis(id, 'annule');
}

/**
 * Convertit un devis en facture (NF525).
 * @param {number} id
 */
async function convertToFacture(id) {
  if (!confirm('Convertir ce devis en facture ? Cette action est irréversible.')) return;

  try {
    const result = await apiPut('/api/devis/' + id + '/convertir', {});
    if (!result.ok) throw new Error(result.error || 'Erreur API');

    const factureNumero = result.data?.facture_numero || '';
    showFlash('Devis converti en facture ' + factureNumero + ' ✅', 'success');
    await Promise.all([loadDevisStats(), loadDevis()]);

    setTimeout(() => {
      if (confirm('Aller sur la page Factures ?')) window.location.href = '/factures';
    }, 600);

  } catch (err) {
    showFlash('Erreur conversion : ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GESTION DES LIGNES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ajoute une ligne au formulaire devis.
 * @param {Object|null} [prefill] - Données de pré-remplissage (depuis API)
 */
function addLine(prefill = null) {
  const lid   = Date.now() + Math.random();
  const safeId = String(lid).replace('.', '');
  devisLines.push(safeId);

  const defaultTva = document.getElementById('d-tva')?.value || '20';
  const desc  = prefill?.description      || '';
  const qty   = prefill?.quantite         || 1;
  const price = prefill?.prix_unitaire_ht || '';
  const tva   = prefill?.tva_taux         ?? defaultTva;

  const tbody = document.getElementById('devis-lines');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.id = 'dl-row-' + safeId;
  tr.innerHTML = `
    <td style="padding:6px 8px;">
      <input type="text" id="dl-desc-${safeId}" value="${esc(desc)}" placeholder="Description…"
        style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font:inherit;font-size:0.88rem;">
    </td>
    <td style="padding:6px 6px;">
      <input type="number" id="dl-qty-${safeId}" value="${qty}" min="0.01" step="0.01"
        style="width:64px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 6px;font:inherit;font-size:0.88rem;text-align:right;"
        oninput="updateLineTotals('${safeId}')">
    </td>
    <td style="padding:6px 6px;">
      <input type="number" id="dl-price-${safeId}" value="${price}" min="0" step="0.01" placeholder="0.00"
        style="width:100px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;"
        oninput="updateLineTotals('${safeId}')">
    </td>
    <td style="padding:6px 4px;text-align:right;">
      <span id="dl-total-${safeId}" style="font-weight:600;font-size:0.92rem;">0,00 €</span>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button onclick="removeLine('${safeId}')"
        style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:1rem;">✕</button>
    </td>
  `;
  tbody.appendChild(tr);

  // Champ TVA caché pour récupération dans saveDevis
  const hiddenTva = document.createElement('input');
  hiddenTva.type  = 'hidden';
  hiddenTva.id    = 'dl-tva-' + safeId;
  hiddenTva.value = tva;
  tbody.appendChild(hiddenTva);

  if (prefill) updateLineTotals(safeId);
}

/**
 * Supprime une ligne.
 * @param {string} safeId
 */
function removeLine(safeId) {
  if (devisLines.length <= 1) return;
  devisLines = devisLines.filter(l => l !== safeId);
  document.getElementById('dl-row-' + safeId)?.remove();
  document.getElementById('dl-tva-' + safeId)?.remove();
  updateDevisTotals();
}

/**
 * Met à jour le total HT d'une ligne et recalcule les totaux.
 * @param {string} safeId
 */
function updateLineTotals(safeId) {
  const qty   = parseFloat(document.getElementById('dl-qty-'   + safeId)?.value) || 0;
  const price = parseFloat(document.getElementById('dl-price-' + safeId)?.value) || 0;
  const el    = document.getElementById('dl-total-' + safeId);
  if (el) el.textContent = formatMoney(qty * price);
  updateDevisTotals();
}

/**
 * Recalcule les totaux HT / TVA / TTC du formulaire.
 */
function updateDevisTotals() {
  const defaultTva = parseFloat(document.getElementById('d-tva')?.value) || 20;
  let totalHT = 0;
  let totalTVA = 0;

  devisLines.forEach(safeId => {
    const qty   = parseFloat(document.getElementById('dl-qty-'   + safeId)?.value) || 0;
    const price = parseFloat(document.getElementById('dl-price-' + safeId)?.value) || 0;
    const tva   = parseFloat(document.getElementById('dl-tva-'   + safeId)?.value) || defaultTva;
    const ht    = qty * price;
    totalHT  += ht;
    totalTVA += ht * (tva / 100);
  });

  const el_ht  = document.getElementById('subtotal-ht');
  const el_tva = document.getElementById('total-tva');
  const el_ttc = document.getElementById('total-ttc');
  if (el_ht)  el_ht.textContent  = formatMoney(totalHT);
  if (el_tva) el_tva.textContent = formatMoney(totalTVA);
  if (el_ttc) el_ttc.textContent = formatMoney(totalHT + totalTVA);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECT CLIENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Peuple le select client dans le formulaire devis.
 */
function populateDevisClients() {
  const select = document.getElementById('d-client');
  if (!select) return;
  select.innerHTML = '<option value="">— Sélectionner un client —</option>';
  const clients = allClientsForDevis.length ? allClientsForDevis
    : getDB('clients').map(c => ({ id: c.id, name: c.name || [c.first, c.last].filter(Boolean).join(' ') || '—' }));
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRÉREMPLISSAGE DEPUIS TICKET
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Si `izigsm_new_devis_from_ticket` est en localStorage, pré-remplit le formulaire.
 */
function checkFromTicket() {
  const ticketId = localStorage.getItem('izigsm_new_devis_from_ticket');
  if (!ticketId) return;
  localStorage.removeItem('izigsm_new_devis_from_ticket');

  const ticket = getDB('tickets').find(t => String(t.id) === ticketId);
  if (!ticket) return;

  openNewDevis();

  // Sélectionner le client
  const clientSelect = document.getElementById('d-client');
  if (clientSelect) {
    const match = Array.from(clientSelect.options).find(o =>
      o.textContent.toLowerCase().includes((ticket.clientName || '').toLowerCase())
    );
    if (match) clientSelect.value = match.value;
  }

  // Pré-remplir la 1ère ligne
  if (devisLines.length > 0) {
    const safeId = devisLines[0];
    const dDesc  = document.getElementById('dl-desc-'  + safeId);
    const dPrice = document.getElementById('dl-price-' + safeId);
    if (dDesc)  dDesc.value  = ticket.description || '';
    if (dPrice && ticket.price) dPrice.value = ticket.price;
    updateLineTotals(safeId);
  }
}

// ─── Utilitaires internes ──────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Acompte (dupliqué depuis tickets.js) ──────────────────────────────────────
// devis.html ne charge PAS tickets.js (vérifié : `grep static/js/tickets.js
// public/devis.html` → aucun résultat, seul devis.js est inclus). renderAcompteDetail()
// et demanderAcompte() sont donc dupliquées ici À L'IDENTIQUE plutôt que partagées —
// NE PAS SUPPRIMER en pensant que c'est du code mort, c'est la seule copie disponible
// sur la page Devis. Si tickets.js est un jour chargé sur devis.html, envisager de
// factoriser dans un fichier commun (ex. acompte.js) et de supprimer ce duplicata.
// Source : tickets.js (feature acompte structuré, sous-projet A — voir
// docs/superpowers/specs/2026-07-16-acompte-structure-design.md).

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

// ── Helper : showToast (si pas défini globalement dans app.js) ─────────────────
// Dépendance de demanderAcompte() ci-dessus, dupliquée pour la même raison (voir
// commentaire en tête de section) — devis.html ne charge ni tickets.js ni kanban.js
// (seuls fichiers du projet définissant showToast), et app.js n'expose pas
// showNotification. Sans ce fallback, demanderAcompte() lèverait une ReferenceError
// non interceptée à l'appel (vérifié : `grep showToast public/static/js/app.js
// public/devis.html` → aucun résultat).
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

// ─── Exposition globale ────────────────────────────────────────────────────────
window.openNewDevis       = openNewDevis;
window.openEditDevis      = openEditDevis;
window.openDevisDetail    = openDevisDetail;
window.saveDevis          = saveDevis;
window.envoyerDevis       = envoyerDevis;
window.changerStatutDevis = changerStatutDevis;
window.annulerDevis       = annulerDevis;
window.convertToFacture   = convertToFacture;
window.addLine            = addLine;
window.removeLine         = removeLine;
window.updateLineTotals   = updateLineTotals;
window.filterDevis        = filterDevis;
window.filterDevisStatus  = filterDevisStatus;
