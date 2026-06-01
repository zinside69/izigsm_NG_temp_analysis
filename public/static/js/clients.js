/**
 * iziGSM — Gestion Clients
 * CRUD complet : liste, création, édition, suppression
 */

'use strict';

// ─── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  buildSidebar('clients');
  initSeedData();
  renderClients();
  bindSearch();
  bindFilters();
});

// ─── Rendu de la liste ──────────────────────────────────────────────────────
function renderClients(search = '', filter = 'all') {
  const clients = getDB('clients');
  const tickets = getDB('tickets');
  const tbody   = document.getElementById('clients-tbody');
  const counter = document.getElementById('clients-count');

  if (!tbody) return;

  let filtered = clients;

  // Filtre par statut
  if (filter === 'actif') {
    filtered = filtered.filter(c => {
      const nb = tickets.filter(t => t.clientId == c.id).length;
      return nb > 0;
    });
  } else if (filter === 'nouveau') {
    const oneMonth = Date.now() - 30 * 24 * 3600 * 1000;
    filtered = filtered.filter(c => new Date(c.createdAt).getTime() > oneMonth);
  }

  // Filtre par recherche
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(c =>
      (c.name  || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.city  || '').toLowerCase().includes(q)
    );
  }

  if (counter) counter.textContent = filtered.length + ' client' + (filtered.length > 1 ? 's' : '');

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">
          <i class="fas fa-users" style="font-size:2rem;margin-bottom:8px;display:block;opacity:.3"></i>
          Aucun client trouvé
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const nbTickets = tickets.filter(t => t.clientId == c.id).length;
    const initials  = getInitials(c.name);
    const color     = avatarColor(c.id);
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="avatar-circle" style="background:${color}">${initials}</div>
            <div>
              <div style="font-weight:600">${escHtml(c.name)}</div>
              <div style="font-size:.75rem;color:var(--text-muted)">${escHtml(c.company || '')}</div>
            </div>
          </div>
        </td>
        <td>${escHtml(c.email || '—')}</td>
        <td>${escHtml(c.phone || '—')}</td>
        <td>${escHtml(c.city  || '—')}</td>
        <td><span class="badge badge-info">${nbTickets} ticket${nbTickets > 1 ? 's' : ''}</span></td>
        <td>${formatDate(c.createdAt, true)}</td>
        <td>
          <div class="action-btns">
            <button class="btn-icon" title="Voir les tickets" onclick="viewClientTickets(${c.id})">
              <i class="fas fa-clipboard-list"></i>
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

// ─── Recherche & filtres ────────────────────────────────────────────────────
function bindSearch() {
  const input = document.getElementById('search-client');
  if (!input) return;
  input.addEventListener('input', () => applyFilters());
}

function bindFilters() {
  document.querySelectorAll('[data-filter-client]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-filter-client]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });
}

function applyFilters() {
  const search = (document.getElementById('search-client') || {}).value || '';
  const active = document.querySelector('[data-filter-client].active');
  const filter = active ? active.dataset.filterClient : 'all';
  renderClients(search, filter);
}

// ─── Modal Nouveau / Édition ────────────────────────────────────────────────
function openNewClient() {
  resetClientForm();
  document.getElementById('modal-client-title').textContent = 'Nouveau client';
  document.getElementById('client-id').value = '';
  openModal('modal-client');
}

function editClient(id) {
  const clients = getDB('clients');
  const c = clients.find(x => x.id == id);
  if (!c) return;

  document.getElementById('modal-client-title').textContent = 'Modifier le client';
  document.getElementById('client-id').value    = c.id;
  document.getElementById('client-name').value  = c.name    || '';
  document.getElementById('client-email').value = c.email   || '';
  document.getElementById('client-phone').value = c.phone   || '';
  document.getElementById('client-company').value = c.company || '';
  document.getElementById('client-address').value = c.address || '';
  document.getElementById('client-city').value  = c.city    || '';
  document.getElementById('client-zip').value   = c.zip     || '';
  document.getElementById('client-notes').value = c.notes   || '';
  openModal('modal-client');
}

function resetClientForm() {
  ['client-name','client-email','client-phone','client-company',
   'client-address','client-city','client-zip','client-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function saveClient() {
  const name  = document.getElementById('client-name').value.trim();
  const email = document.getElementById('client-email').value.trim();
  const phone = document.getElementById('client-phone').value.trim();

  if (!name) { showFlash('Le nom est obligatoire.', 'error'); return; }
  if (email && !isValidEmail(email)) { showFlash('Email invalide.', 'error'); return; }

  const id = document.getElementById('client-id').value;

  const data = {
    name,
    email,
    phone,
    company : document.getElementById('client-company').value.trim(),
    address : document.getElementById('client-address').value.trim(),
    city    : document.getElementById('client-city').value.trim(),
    zip     : document.getElementById('client-zip').value.trim(),
    notes   : document.getElementById('client-notes').value.trim(),
  };

  if (id) {
    updateInDB('clients', parseInt(id), data);
    showFlash('Client mis à jour.', 'success');
  } else {
    data.createdAt = new Date().toISOString();
    addToDB('clients', data);
    showFlash('Client créé avec succès.', 'success');
  }

  closeModal('modal-client');
  renderClients();
}

function deleteClient(id) {
  if (!confirm('Supprimer ce client ? Les tickets associés ne seront pas supprimés.')) return;
  deleteFromDB('clients', id);
  showFlash('Client supprimé.', 'success');
  renderClients();
}

// ─── Voir les tickets d'un client ──────────────────────────────────────────
function viewClientTickets(clientId) {
  const clients = getDB('clients');
  const tickets = getDB('tickets');
  const c = clients.find(x => x.id == clientId);
  if (!c) return;

  const clientTickets = tickets.filter(t => t.clientId == clientId);
  const el = document.getElementById('client-tickets-list');
  const title = document.getElementById('client-tickets-title');

  if (title) title.textContent = `Tickets de ${c.name}`;

  if (!el) return;
  if (!clientTickets.length) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px">Aucun ticket pour ce client.</p>';
  } else {
    el.innerHTML = clientTickets.map(t => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:600">${escHtml(t.number || '#' + t.id)}</div>
          <div style="font-size:.8rem;color:var(--text-muted)">${escHtml(t.device || '')} — ${escHtml(t.issue || '')}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${statusBadge(t.status)}
          <span style="font-size:.8rem;color:var(--text-muted)">${formatDate(t.createdAt, true)}</span>
        </div>
      </div>
    `).join('');
  }

  openModal('modal-client-tickets');
}

// ─── Export CSV ─────────────────────────────────────────────────────────────
function exportClients() {
  const clients = getDB('clients');
  const rows = [
    ['Nom','Email','Téléphone','Société','Ville','Code postal','Date création'],
    ...clients.map(c => [
      c.name    || '',
      c.email   || '',
      c.phone   || '',
      c.company || '',
      c.city    || '',
      c.zip     || '',
      formatDate(c.createdAt, true)
    ])
  ];

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'clients_izigsm.csv';
  a.click();
  URL.revokeObjectURL(url);
  showFlash('Export CSV téléchargé.', 'success');
}

// ─── Utilitaires ────────────────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function avatarColor(id) {
  const colors = [
    '#6c47ff','#f5a623','#2ecc71','#e74c3c','#3498db',
    '#9b59b6','#1abc9c','#e67e22','#34495e','#e91e63'
  ];
  return colors[id % colors.length];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─── Exposer globalement ────────────────────────────────────────────────────
window.openNewClient       = openNewClient;
window.editClient          = editClient;
window.saveClient          = saveClient;
window.deleteClient        = deleteClient;
window.viewClientTickets   = viewClientTickets;
window.exportClients       = exportClients;
window.applyFilters        = applyFilters;
