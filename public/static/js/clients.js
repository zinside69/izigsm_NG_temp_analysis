/**
 * iziGSM — Gestion Clients
 * CRUD complet connecté à la vraie API D1
 * Fallback gracieux sur localStorage si API indisponible
 */

'use strict';

// ─── État ─────────────────────────────────────────────────────────────────────
let allClients     = [];   // cache local
let useApiMode     = true; // false si API indisponible
let currentFilter  = 'all';
let currentSearch  = '';

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  buildSidebar('clients');
  initSeedData();
  loadClients();
  bindSearch();
  bindFilters();
});

// ─── Chargement depuis l'API ────────────────────────────────────────────────
async function loadClients() {
  const tbody   = document.getElementById('clients-tbody') || document.getElementById('clients-table');
  const counter = document.getElementById('clients-count');

  // Indicateur de chargement
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">
          <i class="fas fa-spinner fa-spin" style="font-size:1.5rem;margin-bottom:8px;display:block;"></i>
          Chargement des clients…
        </td>
      </tr>`;
  }

  try {
    const boutiqueId = getBoutiqueId();
    const params     = { limit: 100 };
    if (boutiqueId) params.boutique_id = boutiqueId;

    const result = await apiGet('/api/clients', params);

    if (!result.ok) {
      throw new Error(result.error || 'Erreur API');
    }

    // Mapper les champs API → format interne
    allClients = (result.data?.data || []).map(mapApiClient);
    useApiMode = true;

    // Mettre à jour aussi le localStorage pour que les autres pages (tickets, etc.) fonctionnent
    setDB('clients', allClients.map(c => ({ ...c, clientId: c.id, clientName: c.name })));

  } catch (err) {
    console.warn('[Clients] API indisponible, fallback localStorage:', err.message);
    useApiMode = false;
    allClients = getDB('clients');
  }

  renderClients(currentSearch, currentFilter);
}

/**
 * Mapper les champs de l'API vers le format attendu par le JS existant
 */
function mapApiClient(c) {
  return {
    id:        c.id,
    // Compatibilité : l'API retourne prenom + nom séparément
    name:      [c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || '—',
    prenom:    c.prenom || '',
    nom:       c.nom    || '',
    email:     c.email  || '',
    phone:     c.telephone || c.phone || '',
    telephone: c.telephone || c.phone || '',
    company:   c.entreprise || c.company || '',
    entreprise: c.entreprise || '',
    address:   c.adresse || c.address || '',
    adresse:   c.adresse || '',
    city:      c.ville || c.city || '',
    ville:     c.ville || '',
    zip:       c.code_postal || c.zip || '',
    code_postal: c.code_postal || '',
    notes:     c.notes || '',
    createdAt: c.created_at || c.createdAt || '',
    nb_tickets: c.nb_tickets || 0,
    ca_total:   c.ca_total   || 0,
  };
}

// ─── Rendu de la liste ──────────────────────────────────────────────────────
function renderClients(search = '', filter = 'all') {
  currentSearch = search;
  currentFilter = filter;

  const tbody   = document.getElementById('clients-tbody') || document.getElementById('clients-table');
  const counter = document.getElementById('clients-count');

  if (!tbody) return;

  let filtered = allClients;

  // Filtre
  if (filter === 'actif') {
    filtered = filtered.filter(c => c.nb_tickets > 0);
  } else if (filter === 'nouveau') {
    const oneMonth = Date.now() - 30 * 24 * 3600 * 1000;
    filtered = filtered.filter(c => new Date(c.createdAt).getTime() > oneMonth);
  }

  // Recherche
  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(c =>
      (c.name    || '').toLowerCase().includes(q) ||
      (c.email   || '').toLowerCase().includes(q) ||
      (c.phone   || '').toLowerCase().includes(q) ||
      (c.city    || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    );
  }

  if (counter) {
    counter.textContent = filtered.length + ' client' + (filtered.length > 1 ? 's' : '');
  }

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
    const nbTickets = c.nb_tickets || 0;
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

// ─── Recherche & filtres ─────────────────────────────────────────────────────
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

// ─── Modal Nouveau / Édition ─────────────────────────────────────────────────
function openNewClient() {
  resetClientForm();
  const title = document.getElementById('modal-client-title');
  if (title) title.textContent = 'Nouveau client';
  const idEl = document.getElementById('client-id');
  if (idEl) idEl.value = '';
  openModal('modal-client');
}

function editClient(id) {
  const c = allClients.find(x => x.id == id);
  if (!c) return;

  const title = document.getElementById('modal-client-title');
  if (title) title.textContent = 'Modifier le client';

  setVal('client-id',      c.id);
  setVal('client-name',    c.name    || [c.prenom, c.nom].filter(Boolean).join(' '));
  setVal('client-email',   c.email   || '');
  setVal('client-phone',   c.phone   || '');
  setVal('client-company', c.company || '');
  setVal('client-address', c.address || c.adresse || '');
  setVal('client-city',    c.city    || c.ville   || '');
  setVal('client-zip',     c.zip     || c.code_postal || '');
  setVal('client-notes',   c.notes   || '');
  openModal('modal-client');
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function resetClientForm() {
  ['client-name','client-email','client-phone','client-company',
   'client-address','client-city','client-zip','client-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function saveClient() {
  const name  = (document.getElementById('client-name')?.value || '').trim();
  const email = (document.getElementById('client-email')?.value || '').trim();
  const phone = (document.getElementById('client-phone')?.value || '').trim();

  if (!name) { showFlash('Le nom est obligatoire.', 'error'); return; }
  if (email && !isValidEmail(email)) { showFlash('Email invalide.', 'error'); return; }

  const id = document.getElementById('client-id')?.value;

  // Séparer prénom/nom si possible (format "Prénom Nom")
  const nameParts = name.split(' ');
  const prenom    = nameParts.length > 1 ? nameParts[0] : '';
  const nom       = nameParts.length > 1 ? nameParts.slice(1).join(' ') : name;

  const boutiqueId = getBoutiqueId();

  const data = {
    prenom,
    nom,
    email:       email  || undefined,
    telephone:   phone  || undefined,
    entreprise:  (document.getElementById('client-company')?.value || '').trim() || undefined,
    adresse:     (document.getElementById('client-address')?.value || '').trim() || undefined,
    ville:       (document.getElementById('client-city')?.value    || '').trim() || undefined,
    code_postal: (document.getElementById('client-zip')?.value     || '').trim() || undefined,
    notes:       (document.getElementById('client-notes')?.value   || '').trim() || undefined,
    boutique_id: boutiqueId,
  };

  // Bouton save
  const btn = document.querySelector('#modal-client .btn-primary');
  const origLabel = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

  try {
    if (useApiMode) {
      let result;
      if (id) {
        result = await apiPut(`/api/clients/${id}`, data);
      } else {
        result = await apiPost('/api/clients', data);
      }

      if (!result.ok) throw new Error(result.error || 'Erreur API');

      showFlash(id ? 'Client mis à jour.' : 'Client créé avec succès.', 'success');
    } else {
      // Fallback localStorage
      const legacyData = { name, email, phone, company: data.entreprise, address: data.adresse, city: data.ville, zip: data.code_postal, notes: data.notes };
      if (id) {
        updateInDB('clients', parseInt(id), legacyData);
        showFlash('Client mis à jour.', 'success');
      } else {
        legacyData.createdAt = new Date().toISOString();
        addToDB('clients', legacyData);
        showFlash('Client créé avec succès.', 'success');
      }
    }

    closeModal('modal-client');
    await loadClients();

  } catch (err) {
    console.error('Erreur saveClient:', err);
    showFlash(err.message || 'Erreur lors de la sauvegarde.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origLabel || 'Enregistrer'; }
  }
}

async function deleteClient(id) {
  if (!confirm('Supprimer ce client ? Les tickets associés ne seront pas supprimés.')) return;

  try {
    if (useApiMode) {
      const result = await apiDelete(`/api/clients/${id}`);
      if (!result.ok) throw new Error(result.error || 'Erreur API');
    } else {
      deleteFromDB('clients', id);
    }

    showFlash('Client supprimé.', 'success');
    allClients = allClients.filter(c => c.id !== id);
    renderClients(currentSearch, currentFilter);

  } catch (err) {
    console.error('Erreur deleteClient:', err);
    showFlash(err.message || 'Erreur lors de la suppression.', 'error');
  }
}

// ─── Voir les tickets d'un client ────────────────────────────────────────────
async function viewClientTickets(clientId) {
  const c = allClients.find(x => x.id == clientId);
  if (!c) return;

  const el    = document.getElementById('client-tickets-list');
  const title = document.getElementById('client-tickets-title');
  if (title) title.textContent = `Tickets de ${c.name}`;

  if (el) el.innerHTML = '<p style="text-align:center;padding:20px">Chargement…</p>';
  openModal('modal-client-tickets');

  try {
    let tickets = [];

    if (useApiMode) {
      const result = await apiGet(`/api/clients/${clientId}`, {});
      if (result.ok) {
        tickets = result.data?.data?.tickets || [];
      }
    }

    if (!tickets.length) {
      // Fallback localStorage
      tickets = getDB('tickets').filter(t => t.clientId == clientId);
    }

    if (!el) return;

    if (!tickets.length) {
      el.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px">Aucun ticket pour ce client.</p>';
    } else {
      el.innerHTML = tickets.map(t => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-weight:600">${escHtml(t.numero || t.number || '#' + t.id)}</div>
            <div style="font-size:.8rem;color:var(--text-muted)">${escHtml(t.marque || t.deviceType || '')} ${escHtml(t.modele || t.deviceModel || '')} — ${escHtml(t.description || t.issue || '')}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${statusBadge(t.statut || t.status)}
            <span style="font-size:.8rem;color:var(--text-muted)">${formatDate(t.created_at || t.createdAt, true)}</span>
          </div>
        </div>
      `).join('');
    }

  } catch (err) {
    console.error('Erreur viewClientTickets:', err);
    if (el) el.innerHTML = '<p style="color:red;padding:20px">Erreur lors du chargement des tickets.</p>';
  }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportClients() {
  const rows = [
    ['Nom','Email','Téléphone','Société','Ville','Code postal','Date création'],
    ...allClients.map(c => [
      c.name    || '',
      c.email   || '',
      c.phone   || '',
      c.company || '',
      c.city    || '',
      c.zip     || '',
      formatDate(c.createdAt, true)
    ])
  ];

  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'clients_izigsm.csv';
  a.click();
  URL.revokeObjectURL(url);
  showFlash('Export CSV téléchargé.', 'success');
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function avatarColor(id) {
  const colors = ['#6c47ff','#f5a623','#2ecc71','#e74c3c','#3498db','#9b59b6','#1abc9c','#e67e22','#34495e','#e91e63'];
  return colors[(parseInt(id) || 0) % colors.length];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Exposer globalement ─────────────────────────────────────────────────────
window.openNewClient      = openNewClient;
window.editClient         = editClient;
window.saveClient         = saveClient;
window.deleteClient       = deleteClient;
window.viewClientTickets  = viewClientTickets;
window.exportClients      = exportClients;
window.applyFilters       = applyFilters;
