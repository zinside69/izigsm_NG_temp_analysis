/**
 * iziGSM — Personnel & Pointage
 * Gestion des employés + machine à états du pointage
 *
 * Transitions autorisées :
 *   absent    → en_poste
 *   en_poste  → pause | termine
 *   pause     → en_poste
 *   termine   → (état terminal)
 */

'use strict';

// ─── Config transitions & libellés ───────────────────────────────────────────
const TRANSITIONS = {
  absent:   ['en_poste'],
  en_poste: ['pause', 'termine'],
  pause:    ['en_poste'],
  termine:  [],
};

const STATUT_LABELS = {
  absent:   'Absent',
  en_poste: 'En poste',
  pause:    'En pause',
  termine:  'Terminé',
};

const TRANSITION_LABELS = {
  absent:   { en_poste: { label: '▶ Pointer entrée',   icon: 'fa-play',       cls: 'bg-green-600 hover:bg-green-700 text-white' } },
  en_poste: {
    pause:   { label: '⏸ Prendre une pause',  icon: 'fa-pause',      cls: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
    termine: { label: '⏹ Terminer la journée', icon: 'fa-stop',       cls: 'bg-red-600 hover:bg-red-700 text-white' },
  },
  pause:    { en_poste: { label: '▶ Reprendre le travail', icon: 'fa-play', cls: 'bg-green-600 hover:bg-green-700 text-white' } },
  termine:  {},
};

// ─── État global ─────────────────────────────────────────────────────────────
let allEmployes = [];
let currentEmploye = null;

// ─── Helpers Auth ────────────────────────────────────────────────────────────
function getToken() {
  return localStorage.getItem('izigsm_token') || sessionStorage.getItem('izigsm_token') || '';
}

function authHeaders() {
  const token = getToken();
  return token
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

function getSession() {
  try {
    const s = localStorage.getItem('izigsm_session');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

// ─── Toast notifications ─────────────────────────────────────────────────────
function toast(message, type = 'success') {
  const existing = document.querySelector('.toast-notif');
  if (existing) existing.remove();

  const colors = {
    success: 'bg-green-600',
    error:   'bg-red-600',
    info:    'bg-blue-600',
    warning: 'bg-yellow-500',
  };

  const el = document.createElement('div');
  el.className = `toast-notif fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-white text-sm font-medium shadow-2xl flex items-center gap-2 ${colors[type] || colors.success}`;
  el.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${message}`;
  document.body.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .4s';
    setTimeout(() => el.remove(), 400);
  }, 3500);
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

// ─── Sidebar toggle (mobile) ─────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('-translate-x-full');
}

// ─── logout ───────────────────────────────────────────────────────────────────
function logout() {
  localStorage.removeItem('izigsm_token');
  localStorage.removeItem('izigsm_session');
  sessionStorage.removeItem('izigsm_token');
  window.location.href = '/login';
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHARGEMENT DES DONNÉES
// ═══════════════════════════════════════════════════════════════════════════════

async function loadEmployes() {
  const grid = document.getElementById('employes-grid');
  const loadingState = document.getElementById('loading-state');

  try {
    const res = await apiGet('/api/pointage/statuts');

    if (!res.success) throw new Error(res.error || 'Erreur API');

    allEmployes = res.data || [];

    // Mise à jour des compteurs
    const resume = res.resume || {};
    document.getElementById('cnt-en-poste').textContent = resume.en_poste ?? 0;
    document.getElementById('cnt-pause').textContent    = resume.pause    ?? 0;
    document.getElementById('cnt-absent').textContent   = resume.absent   ?? 0;
    document.getElementById('cnt-termine').textContent  = resume.termine  ?? 0;

    renderEmployesGrid(allEmployes);

  } catch (err) {
    console.error('Erreur loadEmployes:', err);
    const code = err.response?.status;

    if (code === 401) {
      toast('Session expirée. Reconnectez-vous.', 'error');
      setTimeout(() => { window.location.href = '/login'; }, 1500);
      return;
    }

    // Affichage d'un état d'erreur
    if (loadingState) {
      loadingState.innerHTML = `
        <i class="fas fa-exclamation-circle text-4xl mb-4 text-red-400"></i>
        <p class="text-red-500 font-medium">Impossible de charger les employés</p>
        <p class="text-gray-400 text-sm mt-1">${err.message}</p>
        <button onclick="loadEmployes()" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          <i class="fas fa-redo mr-2"></i>Réessayer
        </button>
      `;
    }
  }
}

// ─── Rendu de la grille ───────────────────────────────────────────────────────
function renderEmployesGrid(employes) {
  const grid = document.getElementById('employes-grid');
  if (!grid) return;

  // Supprimer le loading state
  const loadingState = document.getElementById('loading-state');
  if (loadingState) loadingState.remove();

  // Vider les anciennes cartes (sauf loading)
  grid.querySelectorAll('.employe-card').forEach(c => c.remove());

  if (employes.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-16 text-gray-400">
        <i class="fas fa-users text-5xl mb-4"></i>
        <p class="font-medium">Aucun employé trouvé</p>
        <p class="text-sm mt-1">Créez votre premier employé avec le bouton "Nouvel employé"</p>
      </div>
    `;
    return;
  }

  employes.forEach(emp => {
    const card = buildEmployeCard(emp);
    grid.appendChild(card);
  });
}

// ─── Construction d'une carte employé ────────────────────────────────────────
function buildEmployeCard(emp) {
  const div = document.createElement('div');
  div.className = 'employe-card bg-white rounded-xl shadow-sm border border-gray-100 p-5 cursor-pointer';
  div.dataset.employeId = emp.id;
  div.dataset.statut = emp.statut_pointage;

  const initials = `${(emp.prenom || '?')[0]}${(emp.nom || '?')[0]}`.toUpperCase();
  const statut   = emp.statut_pointage || 'absent';
  const badgeCls = `statut-badge statut-${statut}`;

  // Formatage "depuis X"
  let depuisHtml = '';
  if (emp.depuis) {
    const since = formatDuree(emp.depuis);
    depuisHtml = `<p class="text-xs text-gray-400 mt-2"><i class="fas fa-clock mr-1"></i>${since}</p>`;
  }

  // Bouton d'action principal selon le statut
  const actionBtn = buildActionButton(emp);

  div.innerHTML = `
    <div class="flex flex-col items-center text-center">
      <div class="w-14 h-14 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-xl font-bold mb-3 shadow-md">
        ${initials}
      </div>
      <h3 class="font-semibold text-gray-900 text-base">${escHtml(emp.prenom)} ${escHtml(emp.nom)}</h3>
      <p class="text-xs text-gray-500 capitalize mb-2">${escHtml(emp.poste || 'Technicien')}</p>
      <span class="${badgeCls}">${statutIcon(statut)} ${STATUT_LABELS[statut] || statut}</span>
      ${depuisHtml}
    </div>
    <div class="mt-4 pt-4 border-t border-gray-50">
      ${actionBtn}
    </div>
  `;

  // Click sur la carte → ouvrir modal pointage
  div.addEventListener('click', (e) => {
    if (!e.target.closest('button')) {
      openPointageModal(emp.id);
    }
  });

  return div;
}

function buildActionButton(emp) {
  const statut      = emp.statut_pointage || 'absent';
  const transitions = TRANSITIONS[statut] || [];

  if (transitions.length === 0) {
    return `<div class="text-center text-sm text-gray-400"><i class="fas fa-check-circle mr-1"></i>Journée terminée</div>`;
  }

  if (transitions.length === 1) {
    const next   = transitions[0];
    const config = TRANSITION_LABELS[statut]?.[next] || { label: next, cls: 'bg-gray-600 text-white' };
    return `
      <button onclick="event.stopPropagation(); quickPointer(${emp.id}, '${next}')"
        class="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${config.cls}">
        ${config.label}
      </button>
    `;
  }

  // Plusieurs transitions → bouton "Pointer" ouvrant le modal
  return `
    <button onclick="event.stopPropagation(); openPointageModal(${emp.id})"
      class="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-700 text-white">
      <i class="fas fa-user-clock mr-1"></i>Pointer
    </button>
  `;
}

function statutIcon(statut) {
  const icons = { en_poste: '🟢', pause: '🟡', absent: '🔴', termine: '⚫' };
  return icons[statut] || '';
}

function formatDuree(isoStr) {
  if (!isoStr) return '';
  const diffMs  = Date.now() - new Date(isoStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)   return 'À l\'instant';
  if (diffMin < 60)  return `depuis ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m > 0 ? `depuis ${h}h${String(m).padStart(2,'0')}` : `depuis ${h}h`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILTRES
// ═══════════════════════════════════════════════════════════════════════════════

function filterEmployes() {
  const search = (document.getElementById('search-employes')?.value || '').toLowerCase().trim();
  const statut = document.getElementById('filter-statut')?.value || '';

  let filtered = allEmployes;

  if (statut) {
    filtered = filtered.filter(e => e.statut_pointage === statut);
  }

  if (search) {
    filtered = filtered.filter(e => {
      const fullName = `${e.prenom} ${e.nom}`.toLowerCase();
      const poste    = (e.poste || '').toLowerCase();
      return fullName.includes(search) || poste.includes(search);
    });
  }

  renderEmployesGrid(filtered);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL POINTAGE
// ═══════════════════════════════════════════════════════════════════════════════

function openPointageModal(employeId) {
  const emp = allEmployes.find(e => e.id === employeId);
  if (!emp) return;

  currentEmploye = emp;

  const statut   = emp.statut_pointage || 'absent';
  const initials = `${(emp.prenom || '?')[0]}${(emp.nom || '?')[0]}`.toUpperCase();

  // Remplir les infos
  document.getElementById('pointage-avatar').textContent     = initials;
  document.getElementById('pointage-nom').textContent        = `${emp.prenom} ${emp.nom}`;
  document.getElementById('pointage-poste').textContent      = emp.poste || 'Technicien';
  document.getElementById('pointage-statut-actuel').innerHTML = `<span class="statut-badge statut-${statut}">${statutIcon(statut)} ${STATUT_LABELS[statut]}</span>`;
  document.getElementById('pointage-note').value             = '';

  // Boutons de transitions
  const container  = document.getElementById('pointage-transitions');
  const transitions = TRANSITIONS[statut] || [];

  if (transitions.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-gray-500">
        <i class="fas fa-check-circle text-3xl text-green-500 mb-3 block"></i>
        <p class="font-medium">Journée terminée</p>
        <p class="text-sm text-gray-400 mt-1">Aucune action disponible pour aujourd'hui</p>
      </div>
    `;
  } else {
    container.innerHTML = transitions.map(next => {
      const cfg = TRANSITION_LABELS[statut]?.[next] || { label: next, cls: 'bg-gray-600 text-white' };
      return `
        <button onclick="pointer(${emp.id}, '${next}')"
          class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${cfg.cls}">
          <i class="fas ${cfg.icon || 'fa-arrow-right'}"></i>
          ${cfg.label}
        </button>
      `;
    }).join('');
  }

  openModal('modal-pointage');
}

// ─── Pointer rapide (1 seule transition depuis la carte) ─────────────────────
async function quickPointer(employeId, statut) {
  const emp = allEmployes.find(e => e.id === employeId);
  if (!emp) return;
  currentEmploye = emp;
  await pointer(employeId, statut);
}

// ─── Appel API pointage ───────────────────────────────────────────────────────
async function pointer(employeId, statut) {
  const notes = document.getElementById('pointage-note')?.value?.trim() || undefined;

  // Feedback visuel immédiat
  const btn = event?.currentTarget;
  if (btn) {
    btn.disabled   = true;
    btn.innerHTML  = '<i class="fas fa-spinner fa-spin mr-2"></i>Enregistrement…';
  }

  try {
    const res = await apiPost(`/api/pointage/${employeId}/pointer`, { statut, notes });

    if (!res.success) throw new Error(res.error || 'Erreur API');

    // Mettre à jour l'état local immédiatement
    const empIdx = allEmployes.findIndex(e => e.id === employeId);
    if (empIdx !== -1) {
      allEmployes[empIdx].statut_pointage = res.statut_apres;
      allEmployes[empIdx].depuis          = res.horodatage;
    }

    closeModal('modal-pointage');
    toast(res.message || 'Pointage enregistré', 'success');

    // Recharger pour avoir les données fraîches
    await loadEmployes();

  } catch (err) {
    console.error('Erreur pointer:', err);
    const msg = err.message || 'Erreur inconnue';
    toast(msg, 'error');

    if (btn) {
      btn.disabled  = false;
      btn.innerHTML = btn.dataset.originalLabel || 'Réessayer';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL AJOUT EMPLOYÉ
// ═══════════════════════════════════════════════════════════════════════════════

function openAddEmployeModal() {
  const form = document.getElementById('form-add-employe');
  if (form) form.reset();
  openModal('modal-add-employe');
}

async function submitAddEmploye(event) {
  event.preventDefault();

  const form    = event.target;
  const btn     = form.querySelector('[type="submit"]');
  const session = getSession();

  const data = {
    prenom:         form.prenom.value.trim(),
    nom:            form.nom.value.trim(),
    poste:          form.poste.value,
    email:          form.email.value.trim() || undefined,
    telephone:      form.telephone.value.trim() || undefined,
    taux_horaire:   form.taux_horaire.value ? parseFloat(form.taux_horaire.value) : undefined,
    commission_pct: form.commission_pct.value ? parseFloat(form.commission_pct.value) : 0,
    boutique_id:    session?.boutique_id,
  };

  if (!data.prenom || !data.nom) {
    toast('Le prénom et le nom sont obligatoires.', 'error');
    return;
  }

  // Feedback visuel
  const origLabel = btn.innerHTML;
  btn.disabled    = true;
  btn.innerHTML   = '<i class="fas fa-spinner fa-spin mr-2"></i>Création…';

  try {
    const res = await apiPost('/api/employes', data);

    if (!res.success) throw new Error(res.error || 'Erreur API');

    closeModal('modal-add-employe');
    toast(`${data.prenom} ${data.nom} ajouté avec succès !`, 'success');
    await loadEmployes();

  } catch (err) {
    console.error('Erreur submitAddEmploye:', err);
    const msg = err.message || 'Erreur inconnue';
    toast(msg, 'error');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = origLabel;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODAL RAPPORT
// ═══════════════════════════════════════════════════════════════════════════════

function openRapportModal() {
  // Préremplir les dates : semaine courante
  const today  = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1); // lundi

  const fmt = d => d.toISOString().split('T')[0];

  const inputDebut = document.getElementById('rapport-debut');
  const inputFin   = document.getElementById('rapport-fin');

  if (inputDebut) inputDebut.value = fmt(monday);
  if (inputFin)   inputFin.value   = fmt(today);

  // Réinitialiser le contenu
  const content = document.getElementById('rapport-content');
  if (content) {
    content.innerHTML = '<p class="text-gray-400 text-center py-8">Sélectionnez une période et cliquez sur <i class="fas fa-search"></i></p>';
  }

  openModal('modal-rapport');
}

async function loadRapport() {
  const debut   = document.getElementById('rapport-debut')?.value;
  const fin     = document.getElementById('rapport-fin')?.value;
  const content = document.getElementById('rapport-content');

  if (!debut || !fin) {
    toast('Veuillez sélectionner une période.', 'warning');
    return;
  }

  if (new Date(debut) > new Date(fin)) {
    toast('La date de début doit être antérieure à la date de fin.', 'error');
    return;
  }

  // Loading
  if (content) {
    content.innerHTML = `
      <div class="flex items-center justify-center py-12 text-gray-400">
        <i class="fas fa-spinner fa-spin text-2xl mr-3"></i> Chargement du rapport…
      </div>
    `;
  }

  try {
    const qs = new URLSearchParams({ date_debut: debut, date_fin: fin }).toString();
    const res = await apiGet(`/api/pointage/rapport?${qs}`);

    if (!res.success) throw new Error(res.error || 'Erreur API');

    renderRapport(res);

  } catch (err) {
    console.error('Erreur loadRapport:', err);
    const msg = err.message || 'Erreur inconnue';
    if (content) {
      content.innerHTML = `
        <div class="text-center py-8 text-red-500">
          <i class="fas fa-exclamation-circle text-3xl mb-3 block"></i>
          <p>${msg}</p>
        </div>
      `;
    }
    toast(msg, 'error');
  }
}

function renderRapport(data) {
  const content = document.getElementById('rapport-content');
  if (!content) return;

  const rows = data.data || [];
  const { debut, fin } = data.periode || {};

  if (rows.length === 0) {
    content.innerHTML = `
      <div class="text-center py-8 text-gray-400">
        <i class="fas fa-calendar-times text-3xl mb-3 block"></i>
        <p>Aucune présence enregistrée sur cette période</p>
      </div>
    `;
    return;
  }

  const tbody = rows.map(e => `
    <tr class="border-b border-gray-50 hover:bg-gray-50">
      <td class="py-3 px-4">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-600">
            ${(e.prenom[0] + e.nom[0]).toUpperCase()}
          </div>
          <div>
            <div class="font-medium text-gray-900 text-sm">${escHtml(e.prenom)} ${escHtml(e.nom)}</div>
            <div class="text-xs text-gray-400 capitalize">${escHtml(e.poste || '—')}</div>
          </div>
        </div>
      </td>
      <td class="py-3 px-4 text-center">
        <span class="inline-flex items-center justify-center w-8 h-8 rounded-full ${e.jours_presents > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} text-sm font-bold">
          ${e.jours_presents || 0}
        </span>
      </td>
      <td class="py-3 px-4 text-sm text-gray-600 text-center">
        ${e.premiere_entree ? formatHeure(e.premiere_entree) : '—'}
      </td>
      <td class="py-3 px-4 text-sm text-gray-600 text-center">
        ${e.derniere_sortie ? formatHeure(e.derniere_sortie) : '—'}
      </td>
    </tr>
  `).join('');

  content.innerHTML = `
    <div class="text-xs text-gray-400 mb-3">
      Rapport du <strong>${formatDateFr(debut)}</strong> au <strong>${formatDateFr(fin)}</strong>
      — ${rows.length} employé${rows.length > 1 ? 's' : ''}
    </div>
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
          <th class="py-2 px-4 text-left">Employé</th>
          <th class="py-2 px-4 text-center">Jours présents</th>
          <th class="py-2 px-4 text-center">1ère entrée</th>
          <th class="py-2 px-4 text-center">Dernière sortie</th>
        </tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

// ─── Helpers dates ────────────────────────────────────────────────────────────
function formatHeure(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateFr(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAFRAÎCHISSEMENT AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════════════════════

let refreshInterval = null;

function startAutoRefresh(intervalMs = 30000) {
  stopAutoRefresh();
  refreshInterval = setInterval(() => {
    // Ne pas rafraîchir si un modal est ouvert
    const modals = ['modal-pointage', 'modal-add-employe', 'modal-rapport'];
    const anyOpen = modals.some(id => !document.getElementById(id)?.classList.contains('hidden'));
    if (!anyOpen) loadEmployes();
  }, intervalMs);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// ─── Fermeture des modals par clic sur fond ───────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  ['modal-pointage', 'modal-add-employe', 'modal-rapport'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function (e) {
      if (e.target === el) closeModal(id);
    });
  });
});

// ─── Fermeture au touche Échap ────────────────────────────────────────────────
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    ['modal-pointage', 'modal-add-employe', 'modal-rapport'].forEach(closeModal);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  // Vérif auth basique
  const token = getToken();
  if (!token) {
    // Mode démo si pas de token (ou redirection)
    console.warn('[Personnel] Pas de token JWT — mode dégradé');
    // Pour le dev local, on continue quand même
  }

  // Afficher le nom de boutique dans le header
  const session = getSession();
  const headerBoutique = document.getElementById('header-boutique');
  if (headerBoutique && session?.boutique_name) {
    headerBoutique.textContent = session.boutique_name;
  }

  // Charger les données
  loadEmployes();

  // Rafraîchissement auto toutes les 30s
  startAutoRefresh(30000);
});
