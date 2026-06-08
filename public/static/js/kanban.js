/**
 * kanban.js — Vue Kanban tickets iziGSM
 * Sprint 2.8 — drag & drop, priorité, ancienneté couleur
 */

const KanbanApp = (() => {
  'use strict';

  // ─── État ───────────────────────────────────────────────────────────────────
  let _colonnes     = [];
  let _stats        = {};
  let _filterPrio   = '';
  let _filterAge    = '';
  let _filterSearch = '';
  let _showTerminal = false;
  let _dragSrc      = null;   // { ticketId, statutSrc }
  let _boutiqueId   = null;

  // Colonnes terminales (masquées par défaut)
  const TERMINAL = ['livre', 'annule'];

  const PRIO_ICON = {
    urgente: '🔴',
    haute:   '🟠',
    normale: '🟢',
    basse:   '⚪',
  };

  // ─── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    // Attendre que ApiService soit dispo (chargé par app.js)
    if (typeof ApiService === 'undefined') {
      setTimeout(init, 100);
      return;
    }
    const user = ApiService.getUser();
    if (!user) { window.location.href = '/index.html'; return; }
    _boutiqueId = user.boutique_id;
    await refresh();
  }

  // ─── Chargement données ─────────────────────────────────────────────────────
  async function refresh() {
    try {
      const params = _boutiqueId ? `?boutique_id=${_boutiqueId}` : '';
      const resp   = await ApiService.get(`/api/tickets/kanban${params}`);
      if (!resp.success) throw new Error(resp.error || 'Erreur API');
      _colonnes = resp.colonnes || [];
      _stats    = resp.stats    || {};
      renderStats();
      renderBoard();
    } catch (e) {
      document.getElementById('kanban-board').innerHTML =
        `<div class="text-red-500 text-center py-20 w-full">
          <i class="fas fa-exclamation-triangle text-3xl mb-3"></i>
          <p>${e.message}</p>
         </div>`;
    }
  }

  // ─── Stats header ───────────────────────────────────────────────────────────
  function renderStats() {
    const sa = document.getElementById('stat-actifs');
    const su = document.getElementById('stat-urgents');
    const sr = document.getElementById('stat-retard');
    sa.textContent = `${_stats.total_actifs ?? 0} actifs`;
    sa.classList.remove('hidden');
    if (_stats.urgents > 0) {
      su.textContent = `${_stats.urgents} urgent${_stats.urgents > 1 ? 's' : ''}`;
      su.classList.remove('hidden');
    }
    if (_stats.en_retard > 0) {
      sr.textContent = `${_stats.en_retard} en retard`;
      sr.classList.remove('hidden');
    }
  }

  // ─── Rendu Board ────────────────────────────────────────────────────────────
  function renderBoard() {
    const board = document.getElementById('kanban-board');
    board.innerHTML = '';

    for (const col of _colonnes) {
      const isTerminal = TERMINAL.includes(col.statut);
      if (isTerminal && !_showTerminal) continue;

      // Filtrer les tickets de cette colonne
      let tickets = col.tickets || [];
      if (_filterPrio)   tickets = tickets.filter(t => t.priorite === _filterPrio);
      if (_filterAge)    tickets = tickets.filter(t => t.anciennete_couleur === _filterAge);
      if (_filterSearch) {
        const q = _filterSearch.toLowerCase();
        tickets = tickets.filter(t =>
          (t.numero          || '').toLowerCase().includes(q) ||
          (t.appareil_marque || '').toLowerCase().includes(q) ||
          (t.appareil_modele || '').toLowerCase().includes(q) ||
          (t.client_nom      || '').toLowerCase().includes(q)
        );
      }

      const colEl = document.createElement('div');
      colEl.className = `kanban-col`;
      colEl.dataset.statut = col.statut;

      colEl.innerHTML = `
        <div class="kanban-col-header col-${col.statut}">
          <span>${col.emoji} ${col.label}</span>
          <span class="bg-white bg-opacity-70 text-gray-700 text-xs px-2 py-0.5 rounded-full font-bold">
            ${tickets.length}
          </span>
        </div>
        <div class="kanban-col-body" id="col-body-${col.statut}">
          ${tickets.length === 0
            ? '<p class="text-xs text-gray-400 text-center py-4">Aucun ticket</p>'
            : tickets.map(t => renderCard(t)).join('')}
        </div>`;

      // Drag & drop colonne
      const body = colEl.querySelector('.kanban-col-body');
      body.addEventListener('dragover',  onDragOver);
      body.addEventListener('dragleave', onDragLeave);
      body.addEventListener('drop',      onDrop);

      board.appendChild(colEl);
    }
  }

  // ─── Rendu carte ────────────────────────────────────────────────────────────
  function renderCard(t) {
    const ageCls = `age-${t.anciennete_couleur}`;
    const prioCls = `prio-${t.priorite}`;
    const jours = t.jours_anciennete ?? 0;
    const retard = t.date_promesse && new Date(t.date_promesse) < new Date()
                   && !['livre','annule','termine'].includes(t.statut);

    return `
      <div class="ticket-card" id="card-${t.id}"
           draggable="true"
           data-id="${t.id}" data-statut="${t.statut}"
           onclick="KanbanApp.openTicket(${t.id})"
           ondragstart="KanbanApp.onDragStart(event,${t.id},'${t.statut}')"
           ondragend="KanbanApp.onDragEnd(event)">
        <div class="age-bar ${ageCls}"></div>
        <div class="pl-2">
          <!-- Numéro + priorité -->
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-blue-700">${t.numero}</span>
            <span class="text-xs px-1.5 py-0.5 rounded font-semibold ${prioCls}">
              ${PRIO_ICON[t.priorite] || ''} ${t.priorite}
            </span>
          </div>
          <!-- Appareil -->
          <p class="text-sm font-semibold text-gray-800 leading-tight">
            ${t.appareil_marque || ''} ${t.appareil_modele || ''}
          </p>
          <!-- Client -->
          <p class="text-xs text-gray-500 mt-0.5">
            <i class="fas fa-user mr-1"></i>${t.client_nom || '—'}
          </p>
          <!-- Panne courte -->
          <p class="text-xs text-gray-400 mt-1 line-clamp-1">${t.description_panne || ''}</p>
          <!-- Footer carte -->
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <span class="text-xs text-gray-400">
              <i class="fas fa-clock mr-1"></i>${jours}j
            </span>
            ${retard ? '<span class="text-xs text-red-500 font-bold"><i class="fas fa-exclamation-circle mr-1"></i>En retard</span>' : ''}
            ${t.technicien_nom ? `<span class="text-xs text-gray-500"><i class="fas fa-user-cog mr-1"></i>${t.technicien_nom.split(' ')[0]}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  // ─── Drag & Drop ────────────────────────────────────────────────────────────
  function onDragStart(ev, ticketId, statutSrc) {
    _dragSrc = { ticketId, statutSrc };
    ev.dataTransfer.effectAllowed = 'move';
    ev.currentTarget.classList.add('dragging');
  }
  function onDragEnd(ev) {
    document.querySelectorAll('.ticket-card.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.kanban-col.drag-over').forEach(el => el.classList.remove('drag-over'));
  }
  function onDragOver(ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const col = ev.currentTarget.closest('.kanban-col');
    if (col) col.classList.add('drag-over');
  }
  function onDragLeave(ev) {
    const col = ev.currentTarget.closest('.kanban-col');
    if (col) col.classList.remove('drag-over');
  }
  async function onDrop(ev) {
    ev.preventDefault();
    const col = ev.currentTarget.closest('.kanban-col');
    if (col) col.classList.remove('drag-over');
    if (!_dragSrc) return;

    const statutDest = col?.dataset.statut;
    if (!statutDest || statutDest === _dragSrc.statutSrc) { _dragSrc = null; return; }

    // Trouver les transitions possibles depuis la source
    const colSrc = _colonnes.find(c => c.statut === _dragSrc.statutSrc);
    const ticket = (colSrc?.tickets || []).find(t => t.id === _dragSrc.ticketId);
    if (!ticket) { _dragSrc = null; return; }

    if (!ticket.transitions_possibles.includes(statutDest)) {
      showToast(`⛔ Transition invalide : ${_dragSrc.statutSrc} → ${statutDest}`, 'error');
      _dragSrc = null;
      return;
    }

    // Appel API
    try {
      const resp = await ApiService.put(`/api/tickets/${_dragSrc.ticketId}/statut`, {
        statut: statutDest,
        commentaire: `Déplacé via Kanban : ${_dragSrc.statutSrc} → ${statutDest}`
      });
      if (resp.success) {
        showToast(`✅ ${ticket.numero} → ${statutDest}`, 'success');
        await refresh();
      } else {
        showToast(`❌ ${resp.error}`, 'error');
      }
    } catch (e) {
      showToast(`❌ Erreur réseau`, 'error');
    }
    _dragSrc = null;
  }

  // ─── Modal ticket ────────────────────────────────────────────────────────────
  async function openTicket(id) {
    try {
      const params = _boutiqueId ? `?boutique_id=${_boutiqueId}` : '';
      const resp   = await ApiService.get(`/api/tickets/${id}${params}`);
      if (!resp.success) throw new Error(resp.error);
      const t = resp.data;

      // Trouver transitions possibles
      const colSrc = _colonnes.find(c => c.statut === t.statut);
      const ticket = (colSrc?.tickets || []).find(tk => tk.id === id);
      const transitions = ticket?.transitions_possibles || [];

      document.getElementById('modal-title').textContent = `Ticket ${t.numero}`;
      document.getElementById('modal-body').innerHTML = `
        <div class="space-y-4">
          <!-- Infos principales -->
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p class="text-gray-500 text-xs uppercase font-semibold mb-1">Appareil</p>
              <p class="font-semibold">${t.appareil_marque || ''} ${t.appareil_modele || ''}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase font-semibold mb-1">Client</p>
              <p class="font-semibold">${t.client_nom || '—'}</p>
              <p class="text-gray-400 text-xs">${t.client_telephone || ''}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase font-semibold mb-1">Statut</p>
              <span class="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">${t.statut}</span>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase font-semibold mb-1">Priorité</p>
              <span class="inline-block px-2 py-0.5 rounded text-xs font-bold prio-${t.priorite}">${PRIO_ICON[t.priorite] || ''} ${t.priorite}</span>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase font-semibold mb-1">Réception</p>
              <p>${t.date_reception ? new Date(t.date_reception).toLocaleDateString('fr-FR') : '—'}</p>
            </div>
            <div>
              <p class="text-gray-500 text-xs uppercase font-semibold mb-1">Promesse</p>
              <p class="${t.date_promesse && new Date(t.date_promesse) < new Date() ? 'text-red-500 font-bold' : ''}">
                ${t.date_promesse ? new Date(t.date_promesse).toLocaleDateString('fr-FR') : '—'}
              </p>
            </div>
          </div>

          <!-- Panne / Diagnostic -->
          <div class="bg-gray-50 rounded-lg p-3 text-sm">
            <p class="text-gray-500 text-xs uppercase font-semibold mb-1">Panne décrite</p>
            <p>${t.description_panne || '—'}</p>
          </div>
          ${t.diagnostic ? `<div class="bg-blue-50 rounded-lg p-3 text-sm">
            <p class="text-blue-600 text-xs uppercase font-semibold mb-1">Diagnostic</p>
            <p>${t.diagnostic}</p>
          </div>` : ''}

          <!-- Prix -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="bg-gray-50 rounded p-2">
              <p class="text-gray-500 text-xs">Prix estimé</p>
              <p class="font-semibold">${t.prix_estime != null ? t.prix_estime.toFixed(2) + ' €' : '—'}</p>
            </div>
            <div class="bg-gray-50 rounded p-2">
              <p class="text-gray-500 text-xs">Prix final</p>
              <p class="font-semibold">${t.prix_final != null ? t.prix_final.toFixed(2) + ' €' : '—'}</p>
            </div>
          </div>

          <!-- Changement priorité -->
          <div>
            <p class="text-gray-500 text-xs uppercase font-semibold mb-2">Changer la priorité</p>
            <div class="flex gap-2">
              ${['basse','normale','haute','urgente'].map(p => `
                <button onclick="KanbanApp.changePriorite(${t.id},'${p}')"
                  class="flex-1 py-1.5 rounded text-xs font-semibold border transition-colors
                         ${t.priorite === p ? 'prio-'+p+' ring-2 ring-offset-1 ring-gray-400' : 'prio-'+p+' opacity-60 hover:opacity-100'}">
                  ${PRIO_ICON[p]} ${p}
                </button>`).join('')}
            </div>
          </div>

          <!-- Transitions statut -->
          ${transitions.length > 0 ? `
          <div>
            <p class="text-gray-500 text-xs uppercase font-semibold mb-2">Changer le statut</p>
            <div class="flex flex-wrap gap-2">
              ${transitions.map(s => `
                <button onclick="KanbanApp.changeStatut(${t.id},'${s}')"
                  class="bg-white border-2 border-blue-200 hover:border-blue-500 hover:bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
                  → ${s.replace(/_/g,' ')}
                </button>`).join('')}
            </div>
          </div>` : ''}

          <!-- Actions -->
          <div class="flex gap-3 pt-2 border-t">
            <a href="/tickets.html?id=${t.id}" class="flex-1 text-center bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
              <i class="fas fa-edit mr-1"></i>Éditer
            </a>
            <button onclick="KanbanApp.closeModal()" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium transition-colors">
              Fermer
            </button>
          </div>
        </div>`;

      document.getElementById('modal-ticket').classList.remove('hidden');
    } catch (e) {
      showToast('❌ Impossible de charger le ticket', 'error');
    }
  }

  function closeModal() {
    document.getElementById('modal-ticket').classList.add('hidden');
  }

  // ─── Changement statut depuis modal ─────────────────────────────────────────
  async function changeStatut(id, statut) {
    try {
      const resp = await ApiService.put(`/api/tickets/${id}/statut`, {
        statut,
        commentaire: `Changement via Kanban modal → ${statut}`
      });
      if (resp.success) {
        showToast(`✅ Statut → ${statut}`, 'success');
        closeModal();
        await refresh();
      } else {
        showToast(`❌ ${resp.error}`, 'error');
      }
    } catch (e) {
      showToast('❌ Erreur réseau', 'error');
    }
  }

  // ─── Changement priorité ─────────────────────────────────────────────────────
  async function changePriorite(id, priorite) {
    try {
      const resp = await ApiService.put(`/api/tickets/${id}`, { priorite });
      if (resp.success) {
        showToast(`✅ Priorité → ${priorite}`, 'success');
        closeModal();
        await refresh();
      } else {
        showToast(`❌ ${resp.error}`, 'error');
      }
    } catch (e) {
      showToast('❌ Erreur réseau', 'error');
    }
  }

  // ─── Filtres ─────────────────────────────────────────────────────────────────
  function applyFilter() {
    _filterPrio   = document.getElementById('filter-priorite').value;
    _filterAge    = document.getElementById('filter-age').value;
    _filterSearch = document.getElementById('filter-search').value.trim();
    renderBoard();
  }

  function clearFilters() {
    document.getElementById('filter-priorite').value = '';
    document.getElementById('filter-age').value      = '';
    document.getElementById('filter-search').value   = '';
    _filterPrio = _filterAge = _filterSearch = '';
    renderBoard();
  }

  function toggleTerminal() {
    _showTerminal = document.getElementById('show-terminal').checked;
    renderBoard();
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-white text-sm font-semibold shadow-xl transition-all
      ${type === 'error' ? 'bg-red-500' : 'bg-green-500'}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // API publique
  return {
    init, refresh, openTicket, closeModal,
    changeStatut, changePriorite,
    applyFilter, clearFilters, toggleTerminal,
    onDragStart, onDragEnd,
  };
})();

// Démarrage
document.addEventListener('DOMContentLoaded', KanbanApp.init);
