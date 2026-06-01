/**
 * iziGSM — dashboard.js
 * Tableau de bord connecté à la vraie API D1
 */

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('dashboard');
  loadDashboard();
});

// ─── Chargement principal ─────────────────────────────────────────────────────
async function loadDashboard() {
  await Promise.all([
    loadStats(),
    loadRecentTickets(),
  ]);
}

// ─── KPIs depuis /api/stats ───────────────────────────────────────────────────
async function loadStats() {
  try {
    const result = await apiGet('/api/stats');

    if (!result.ok) {
      // Fallback sur les données locales si l'API échoue (mode dégradé)
      loadStatsFallback();
      return;
    }

    const d = result.data?.data || {};

    // Mettre à jour les KPIs avec les données réelles
    setKpi('kpi-tickets', d.tickets_en_cours ?? '—');
    setKpi('kpi-revenue',  formatMoney(d.ca_mois ?? 0));
    setKpi('kpi-devis',    '—'); // Pas dans /api/stats, chargé séparément si besoin
    setKpi('kpi-qr',       '—');

    // Infos supplémentaires (si présents dans le DOM)
    setKpi('kpi-clients',        d.nb_clients       ?? '—');
    setKpi('kpi-stock-bas',      d.stock_bas        ?? '—');
    setKpi('kpi-employes',       d.employes_en_poste ?? '—');
    setKpi('kpi-tickets-today',  d.tickets_aujourd_hui ?? '—');

  } catch (err) {
    console.error('Erreur loadStats:', err);
    loadStatsFallback();
  }
}

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── Fallback localStorage si API indisponible ─────────────────────────────
function loadStatsFallback() {
  const tickets  = getDB('tickets');
  const devis    = getDB('devis');
  const factures = getDB('factures');
  const qr       = getDB('qualirepar');

  const inProgress = tickets.filter(t => t.status === 'En cours' || t.status === 'Nouveau').length;
  const devisPending = devis.filter(d => d.status === 'Envoyé').length;
  const revenue = factures.filter(f => f.status === 'Payée').reduce((s, f) => s + (f.totalTTC || 0), 0);

  setKpi('kpi-tickets', inProgress);
  setKpi('kpi-revenue', formatMoney(revenue));
  setKpi('kpi-devis',   devisPending);
  setKpi('kpi-qr',      qr.length);
}

// ─── Tickets récents depuis /api/tickets ─────────────────────────────────────
async function loadRecentTickets() {
  const tbody = document.getElementById('recent-tickets');
  const feed  = document.getElementById('activity-feed');

  try {
    const boutiqueId = getBoutiqueId();
    const params     = { limit: 6, page: 1 };
    if (boutiqueId) params.boutique_id = boutiqueId;

    const result = await apiGet('/api/tickets', params);

    if (!result.ok) {
      loadRecentTicketsFallback(tbody, feed);
      return;
    }

    const tickets = result.data?.data || [];

    // Tableau tickets récents
    if (tbody) {
      if (tickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted);">Aucune prise en charge</td></tr>';
      } else {
        tbody.innerHTML = tickets.map(t => `
          <tr>
            <td><span style="font-weight:700;color:var(--primary);">${escHtml(t.numero || '#' + t.id)}</span></td>
            <td>${escHtml(t.client_nom || t.clientName || '—')}</td>
            <td><span style="font-size:0.88rem;">${escHtml(t.marque || '')} ${escHtml(t.modele || t.deviceModel || '')}</span></td>
            <td>${statusBadgeApi(t.statut || t.status)}</td>
            <td><span style="font-size:0.85rem;color:var(--muted);">${formatDate(t.created_at || t.createdAt, true)}</span></td>
            <td><a href="tickets.html" class="btn btn-ghost btn-sm">Voir →</a></td>
          </tr>
        `).join('');
      }
    }

    // Flux d'activité basé sur les tickets
    if (feed) {
      buildActivityFeed(feed, tickets);
    }

  } catch (err) {
    console.error('Erreur loadRecentTickets:', err);
    loadRecentTicketsFallback(tbody, feed);
  }
}

// ─── Flux d'activité ──────────────────────────────────────────────────────────
function buildActivityFeed(feed, tickets) {
  if (!tickets.length) {
    feed.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.9rem;">Aucune activité récente</div>';
    return;
  }

  feed.innerHTML = tickets.slice(0, 8).map(t => {
    const icon = statutIconMap(t.statut || t.status);
    const nom  = t.client_nom || t.clientName || 'Client';
    const num  = t.numero || ('#' + String(t.id).slice(-4));
    return `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:1.1rem;flex-shrink:0;">${icon}</span>
        <div>
          <div style="font-size:0.88rem;font-weight:600;color:var(--navy);">Ticket ${escHtml(num)} — ${escHtml(nom)}</div>
          <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">${formatDate(t.created_at || t.createdAt)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function statutIconMap(statut) {
  const map = {
    recu:          '📥',
    diagnostic:    '🔍',
    en_reparation: '🔧',
    termine:       '✅',
    livre:         '📦',
    annule:        '❌',
    // Anciens statuts (fallback)
    'Nouveau':     '📥',
    'En cours':    '🔧',
    'Terminé':     '✅',
    'Annulé':      '❌',
  };
  return map[statut] || '🔧';
}

// ─── Badge statut API ─────────────────────────────────────────────────────────
function statusBadgeApi(statut) {
  // Mapping statuts API (snake_case) → classes CSS existantes
  const map = {
    recu:          ['status-new',       'Reçu'],
    diagnostic:    ['status-progress',  'Diagnostic'],
    en_reparation: ['status-progress',  'En réparation'],
    termine:       ['status-done',      'Terminé'],
    livre:         ['status-paid',      'Livré'],
    annule:        ['status-cancelled', 'Annulé'],
    // Fallback anciens statuts
    'Nouveau':     ['status-new',       'Nouveau'],
    'En cours':    ['status-progress',  'En cours'],
    'Terminé':     ['status-done',      'Terminé'],
    'Annulé':      ['status-cancelled', 'Annulé'],
    'Payée':       ['status-paid',      'Payée'],
    'Envoyé':      ['status-sent',      'Envoyé'],
  };
  const [cls, label] = map[statut] || ['status-draft', statut || '—'];
  return `<span class="status-badge ${cls}">${label}</span>`;
}

// ─── Fallback localStorage ────────────────────────────────────────────────────
function loadRecentTicketsFallback(tbody, feed) {
  const tickets  = getDB('tickets');
  const devis    = getDB('devis');
  const factures = getDB('factures');
  const qr       = getDB('qualirepar');

  if (tbody) {
    const recent = tickets.slice(0, 6);
    tbody.innerHTML = recent.map(t => `
      <tr>
        <td><span style="font-weight:700;color:var(--primary);">#${String(t.id).slice(-4)}</span></td>
        <td>${escHtml(t.clientName)}</td>
        <td><span style="font-size:0.88rem;">${escHtml(t.deviceType)} ${escHtml(t.deviceModel)}</span></td>
        <td>${statusBadge(t.status)}</td>
        <td><span style="font-size:0.85rem;color:var(--muted);">${formatDate(t.createdAt, true)}</span></td>
        <td><a href="tickets.html" class="btn btn-ghost btn-sm">Voir →</a></td>
      </tr>
    `).join('');
    if (!recent.length) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted);">Aucune prise en charge</td></tr>';
  }

  if (feed) {
    const activities = buildActivityLegacy(tickets, devis, factures, qr);
    feed.innerHTML = activities.slice(0, 8).map(a => `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:1.1rem;flex-shrink:0;">${a.icon}</span>
        <div>
          <div style="font-size:0.88rem;font-weight:600;color:var(--navy);">${a.text}</div>
          <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">${a.time}</div>
        </div>
      </div>
    `).join('');
  }
}

function buildActivityLegacy(tickets, devis, factures, qr) {
  const items = [
    ...tickets.map(t  => ({ icon:'🔧', text:`Ticket #${String(t.id).slice(-4)} — ${t.clientName}`, time: formatDate(t.createdAt),  date: new Date(t.createdAt) })),
    ...devis.map(d    => ({ icon:'📋', text:`Devis ${d.number} — ${d.clientName}`,                  time: formatDate(d.createdAt),  date: new Date(d.createdAt) })),
    ...factures.map(f => ({ icon:'💶', text:`Facture ${f.number} — ${formatMoney(f.totalTTC)}`,     time: formatDate(f.createdAt),  date: new Date(f.createdAt) })),
    ...qr.map(q       => ({ icon:'🌿', text:`QR ${q.number} — ${q.clientName}`,                     time: formatDate(q.createdAt),  date: new Date(q.createdAt) })),
  ];
  return items.sort((a, b) => b.date - a.date);
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
