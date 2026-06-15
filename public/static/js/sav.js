/**
 * sav.js — Module frontend SAV & Garanties (Sprint 2.10)
 *
 * Dépend de app.js (token JWT, sidebar).
 * Exposition : window.SavApp
 */

const SavApp = (() => {
  // ── État local ──────────────────────────────────────────────
  let currentTab       = 'garanties'
  let garantiesPage    = 1
  let savPage          = 1
  let currentSavId     = null   // pour le modal détail
  let debounceTimer    = null
  let currentSavData   = null   // données du dossier ouvert dans le modal détail

  const TRANSITIONS_SAV = {
    ouvert:        ['en_traitement', 'refuse', 'clos'],
    en_traitement: ['resolu', 'refuse', 'clos'],
    resolu:        ['clos'],
    refuse:        ['clos'],
    clos:          [],
  }

  // ── Helpers auth ────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || ''
  }
  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }
  }

  async function apiGet(path) {
    const r = await fetch(path, { headers: authHeaders() })
    return r.json()
  }
  async function apiPost(path, body) {
    const r = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
    return r.json()
  }
  async function apiPut(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
    return r.json()
  }

  // ── Toast ────────────────────────────────────────────────────
  function toast(msg, type = 'success') {
    const el    = document.getElementById('toast')
    const inner = document.getElementById('toast-inner')
    inner.textContent = msg
    inner.className   = `px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white max-w-xs ${type === 'error' ? 'bg-red-500' : type === 'warn' ? 'bg-yellow-500' : 'bg-green-600'}`
    el.classList.remove('hidden')
    setTimeout(() => el.classList.add('hidden'), 3500)
  }

  // ── KPIs ─────────────────────────────────────────────────────
  async function loadKpis() {
    try {
      const r = await apiGet('/api/sav/kpis')
      if (!r.success) return
      const d = r.data
      document.getElementById('kv-actives').textContent     = d.garanties_actives    ?? 0
      document.getElementById('kv-expire-soon').textContent = d.garanties_expirant_7j ?? 0
      document.getElementById('kv-sav-ouverts').textContent = (d.sav_ouverts ?? 0) + (d.sav_en_traitement ?? 0)
      document.getElementById('kv-taux-retour').textContent  = (d.taux_retour_pct ?? 0) + '%'

      // Couleur warning si expire bientôt
      if (d.garanties_expirant_7j > 0) {
        document.getElementById('kv-expire-soon').classList.add('text-orange-500')
      }
    } catch (e) {
      console.error('KPIs SAV:', e)
    }
  }

  // ── Tabs ─────────────────────────────────────────────────────
  function switchTab(tab) {
    currentTab = tab
    document.getElementById('panel-garanties').classList.toggle('hidden', tab !== 'garanties')
    document.getElementById('panel-sav').classList.toggle('hidden', tab !== 'sav')
    document.getElementById('tab-garanties').classList.toggle('active', tab === 'garanties')
    document.getElementById('tab-sav').classList.toggle('active', tab === 'sav')
    if (tab === 'garanties') refreshGaranties()
    else                      refreshSav()
  }

  // ════════════════════════════════════════════════════════════
  // GARANTIES
  // ════════════════════════════════════════════════════════════

  async function refreshGaranties(page = 1) {
    garantiesPage = page
    const search     = document.getElementById('g-search').value.trim()
    const statut     = document.getElementById('g-statut').value
    const expSoon    = document.getElementById('g-expires-soon').checked ? '1' : ''

    let url = `/api/garanties?page=${page}&limit=15`
    if (search)  url += `&search=${encodeURIComponent(search)}`
    if (statut)  url += `&statut=${statut}`
    if (expSoon) url += `&expires_soon=1`

    const tbody = document.getElementById('garanties-body')
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</td></tr>'

    try {
      const r = await apiGet(url)
      if (!r.success) { tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red-400 py-8">${r.error}</td></tr>`; return }

      if (!r.data.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-400 py-8">Aucune garantie trouvée.</td></tr>'
        document.getElementById('garanties-pagination').innerHTML = ''
        return
      }

      tbody.innerHTML = r.data.map(g => {
        const joursR  = g.jours_restants ?? null
        let joursHtml = '—'
        if (joursR !== null) {
          const cls = joursR > 14 ? 'jours-ok' : joursR > 0 ? 'jours-warning' : 'jours-danger'
          joursHtml = `<span class="${cls}">${joursR > 0 ? joursR + 'j' : 'Expiré'}</span>`
        }
        const dateFinFmt = g.date_fin ? new Date(g.date_fin).toLocaleDateString('fr-FR') : '—'
        const clientNom  = g.client_prenom && g.client_nom ? `${g.client_prenom} ${g.client_nom}` : '—'

        return `<tr class="hover:bg-gray-50 cursor-pointer" onclick="SavApp.openNewSav(${g.id})">
          <td class="px-3 py-2">
            <div class="font-medium text-gray-800">${escHtml(clientNom)}</div>
            ${g.client_telephone ? `<div class="text-xs text-gray-400">${escHtml(g.client_telephone)}</div>` : ''}
          </td>
          <td class="px-3 py-2">
            <span class="font-medium">${escHtml(g.appareil_marque || '')} ${escHtml(g.appareil_modele || '')}</span>
          </td>
          <td class="px-3 py-2 text-center">
            ${g.ticket_numero ? `<span class="font-mono text-xs bg-gray-100 rounded px-1">${escHtml(g.ticket_numero)}</span>` : '—'}
          </td>
          <td class="px-3 py-2 text-center text-gray-600">${g.garantie_jours}j</td>
          <td class="px-3 py-2 text-center text-gray-600">${dateFinFmt}</td>
          <td class="px-3 py-2 text-center">${joursHtml}</td>
          <td class="px-3 py-2 text-center"><span class="badge badge-${g.statut}">${labelStatutGarantie(g.statut)}</span></td>
          <td class="px-3 py-2 text-center">
            ${g.statut === 'active'
              ? `<button onclick="event.stopPropagation();SavApp.openNewSav(${g.id})"
                         class="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded px-2 py-1 border border-indigo-200">
                   <i class="fas fa-rotate-left mr-1"></i> SAV
                 </button>`
              : `<span class="text-xs text-gray-300">—</span>`
            }
          </td>
        </tr>`
      }).join('')

      renderPagination('garanties-pagination', r.pagination, (p) => refreshGaranties(p))
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red-400 py-8">Erreur réseau.</td></tr>`
    }
  }

  function labelStatutGarantie(s) {
    return { active: '✅ Active', expiree: '⏰ Expirée', consommee: '🔄 Consommée' }[s] || s
  }

  async function expireGaranties() {
    if (!confirm('Marquer automatiquement comme expirées toutes les garanties dont la date de fin est passée ?')) return
    try {
      const r = await apiPost('/api/garanties/expire', {})
      if (r.success) { toast(`${r.data.expired} garantie(s) expirée(s).`); refreshGaranties(); loadKpis() }
      else toast(r.error, 'error')
    } catch { toast('Erreur réseau.', 'error') }
  }

  function debouncedRefreshGaranties() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => refreshGaranties(1), 350)
  }

  // ════════════════════════════════════════════════════════════
  // DOSSIERS SAV
  // ════════════════════════════════════════════════════════════

  async function refreshSav(page = 1) {
    savPage = page
    const search = document.getElementById('s-search').value.trim()
    const statut = document.getElementById('s-statut').value

    let url = `/api/sav?page=${page}&limit=15`
    if (search) url += `&search=${encodeURIComponent(search)}`
    if (statut) url += `&statut=${statut}`

    const tbody = document.getElementById('sav-body')
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</td></tr>'

    try {
      const r = await apiGet(url)
      if (!r.success) { tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red-400 py-8">${r.error}</td></tr>`; return }

      if (!r.data.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-400 py-8">Aucun dossier SAV.</td></tr>'
        document.getElementById('sav-pagination').innerHTML = ''
        return
      }

      tbody.innerHTML = r.data.map(s => {
        const client  = s.client_prenom && s.client_nom ? `${s.client_prenom} ${s.client_nom}` : '—'
        const dateOuv = new Date(s.date_ouverture).toLocaleDateString('fr-FR')
        return `<tr class="hover:bg-gray-50 cursor-pointer" onclick="SavApp.openSavDetail(${s.id})">
          <td class="px-3 py-2 font-mono font-semibold text-indigo-700 text-xs">${escHtml(s.numero)}</td>
          <td class="px-3 py-2 font-medium text-gray-800">${escHtml(client)}</td>
          <td class="px-3 py-2 text-gray-600 max-w-xs truncate" title="${escHtml(s.motif)}">${escHtml(s.motif)}</td>
          <td class="px-3 py-2 text-center">
            ${s.ticket_origine_numero ? `<span class="font-mono text-xs bg-gray-100 rounded px-1">${escHtml(s.ticket_origine_numero)}</span>` : '—'}
          </td>
          <td class="px-3 py-2 text-center">
            ${s.ticket_sav_numero ? `<span class="font-mono text-xs bg-blue-50 text-blue-700 rounded px-1">${escHtml(s.ticket_sav_numero)}</span>` : '—'}
          </td>
          <td class="px-3 py-2 text-center text-gray-500">${dateOuv}</td>
          <td class="px-3 py-2 text-center"><span class="badge badge-${s.statut}">${labelStatutSav(s.statut)}</span></td>
          <td class="px-3 py-2 text-center">
            ${!['resolu','refuse','clos'].includes(s.statut)
              ? `<button onclick="event.stopPropagation();SavApp.openSavDetail(${s.id})"
                         class="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded px-2 py-1 border border-indigo-200">
                   <i class="fas fa-pen mr-1"></i> Mettre à jour
                 </button>`
              : `<span class="text-xs text-gray-300">Clos</span>`
            }
          </td>
        </tr>`
      }).join('')

      renderPagination('sav-pagination', r.pagination, (p) => refreshSav(p))
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red-400 py-8">Erreur réseau.</td></tr>`
    }
  }

  function labelStatutSav(s) {
    const labels = {
      ouvert: '📂 Ouvert', en_traitement: '🔧 En traitement',
      resolu: '✅ Résolu', refuse: '❌ Refusé', clos: '🔒 Clos',
    }
    return labels[s] || s
  }

  function debouncedRefreshSav() {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => refreshSav(1), 350)
  }

  // ── Modal : Nouveau SAV ────────────────────────────────────
  function openNewSav(garantieId = null) {
    document.getElementById('sav-garantie-id').value  = garantieId ?? ''
    document.getElementById('sav-client-id').value    = ''
    document.getElementById('sav-motif').value         = ''
    document.getElementById('sav-description').value  = ''
    document.getElementById('garantie-preview').classList.add('hidden')
    document.getElementById('modal-sav').classList.remove('hidden')
    if (garantieId) previewGarantie()
  }

  async function previewGarantie() {
    const gId = parseInt(document.getElementById('sav-garantie-id').value)
    const preview = document.getElementById('garantie-preview')
    if (!gId || isNaN(gId)) { preview.classList.add('hidden'); return }

    try {
      const r = await apiGet(`/api/garanties/${gId}`)
      if (r.success && r.data) {
        const g = r.data
        const client = g.client_prenom && g.client_nom ? `${g.client_prenom} ${g.client_nom}` : 'Client inconnu'
        const dateFin = g.date_fin ? new Date(g.date_fin).toLocaleDateString('fr-FR') : '—'
        const actif   = g.statut === 'active'
        preview.innerHTML = `
          <div class="${actif ? 'text-green-700' : 'text-red-600'} font-semibold mb-1">
            ${actif ? '✅' : '⚠️'} Garantie ${g.statut} — ${g.appareil_marque} ${g.appareil_modele}
          </div>
          <div>Client : <strong>${escHtml(client)}</strong></div>
          <div>Ticket origine : <strong>${escHtml(g.ticket_numero || '—')}</strong> — Expire le <strong>${dateFin}</strong></div>
          ${!actif ? `<div class="text-red-500 text-xs mt-1">Cette garantie ne peut plus générer de SAV.</div>` : ''}
        `
        preview.classList.remove('hidden')
      } else {
        preview.innerHTML = '<span class="text-red-500">Garantie introuvable.</span>'
        preview.classList.remove('hidden')
      }
    } catch { preview.classList.add('hidden') }
  }

  async function submitSav(e) {
    e.preventDefault()
    const garantieId  = parseInt(document.getElementById('sav-garantie-id').value) || null
    const clientId    = parseInt(document.getElementById('sav-client-id').value) || null
    const motif       = document.getElementById('sav-motif').value.trim()
    const description = document.getElementById('sav-description').value.trim()

    if (!motif) { toast('Motif obligatoire.', 'error'); return }

    const body = { motif, description: description || undefined }
    if (garantieId) body.garantie_id = garantieId
    if (clientId)   body.client_id   = clientId

    try {
      const r = await apiPost('/api/sav', body)
      if (r.success) {
        toast(r.message || 'Dossier SAV ouvert.')
        closeModal('modal-sav')
        refreshSav(1)
        loadKpis()
        switchTab('sav')
      } else {
        toast(r.error || 'Erreur création SAV.', 'error')
      }
    } catch { toast('Erreur réseau.', 'error') }
  }

  // ── Modal : Détail SAV ──────────────────────────────────────
  async function openSavDetail(id) {
    currentSavId = id
    const modal = document.getElementById('modal-sav-detail')
    modal.classList.remove('hidden')
    document.getElementById('detail-body').innerHTML = '<div class="text-center text-gray-400 py-6"><i class="fas fa-spinner fa-spin mr-2"></i>Chargement…</div>'
    document.getElementById('detail-statut-form').classList.add('hidden')

    try {
      const r = await apiGet(`/api/sav/${id}`)
      if (!r.success) { document.getElementById('detail-body').innerHTML = `<p class="text-red-500">${r.error}</p>`; return }

      currentSavData = r.data
      const s = r.data
      const client = s.client_prenom && s.client_nom ? `${s.client_prenom} ${s.client_nom}` : '—'
      document.getElementById('detail-titre').textContent = `Dossier ${s.numero}`

      document.getElementById('detail-body').innerHTML = `
        <div class="grid grid-cols-2 gap-3">
          <div><span class="text-xs text-gray-400 block">Numéro</span><span class="font-mono font-semibold text-indigo-700">${escHtml(s.numero)}</span></div>
          <div><span class="text-xs text-gray-400 block">Statut</span><span class="badge badge-${s.statut}">${labelStatutSav(s.statut)}</span></div>
          <div><span class="text-xs text-gray-400 block">Client</span><strong>${escHtml(client)}</strong>${s.client_telephone ? `<span class="text-xs text-gray-400 ml-1">${escHtml(s.client_telephone)}</span>` : ''}</div>
          <div><span class="text-xs text-gray-400 block">Ouverture</span>${new Date(s.date_ouverture).toLocaleString('fr-FR')}</div>
          ${s.ticket_origine_numero ? `<div><span class="text-xs text-gray-400 block">Ticket origine</span><span class="font-mono text-xs bg-gray-100 px-1 rounded">${escHtml(s.ticket_origine_numero)}</span></div>` : ''}
          ${s.ticket_sav_numero ? `<div><span class="text-xs text-gray-400 block">Ticket SAV</span><span class="font-mono text-xs bg-blue-50 text-blue-700 px-1 rounded">${escHtml(s.ticket_sav_numero)}</span></div>` : ''}
          ${s.garantie_date_fin ? `<div class="col-span-2"><span class="text-xs text-gray-400 block">Garantie</span>Expire le ${new Date(s.garantie_date_fin).toLocaleDateString('fr-FR')} (${s.garantie_jours}j) — <span class="badge badge-${s.garantie_statut}">${s.garantie_statut}</span></div>` : ''}
        </div>
        <div class="bg-gray-50 rounded-lg p-3 mt-1">
          <span class="text-xs text-gray-400 block mb-1">Motif</span>
          <p class="text-gray-800">${escHtml(s.motif)}</p>
          ${s.description ? `<p class="text-gray-500 text-xs mt-1">${escHtml(s.description)}</p>` : ''}
        </div>
        ${s.resolution ? `<div class="bg-green-50 rounded-lg p-3 border border-green-200">
          <span class="text-xs text-green-600 block mb-1">Résolution</span>
          <p class="text-gray-800">${escHtml(s.resolution)}</p>
        </div>` : ''}
      `

      // Proposer les transitions disponibles
      const transitions = TRANSITIONS_SAV[s.statut] ?? []
      if (transitions.length > 0) {
        const sel = document.getElementById('detail-statut-select')
        sel.innerHTML = '<option value="">— Choisir —</option>' +
          transitions.map(t => `<option value="${t}">${labelStatutSav(t)}</option>`).join('')
        sel.onchange = () => {
          const needsResolution = ['resolu','refuse'].includes(sel.value)
          document.getElementById('resolution-row').classList.toggle('hidden', !needsResolution)
        }
        document.getElementById('detail-resolution').value = ''
        document.getElementById('resolution-row').classList.add('hidden')
        document.getElementById('detail-statut-form').classList.remove('hidden')
      }
    } catch (e) {
      document.getElementById('detail-body').innerHTML = '<p class="text-red-500">Erreur de chargement.</p>'
    }
  }

  async function submitStatutChange() {
    const statut     = document.getElementById('detail-statut-select').value
    const resolution = document.getElementById('detail-resolution').value.trim()
    if (!statut) { toast('Choisir un statut.', 'warn'); return }

    try {
      const r = await apiPut(`/api/sav/${currentSavId}/statut`, { statut, resolution: resolution || undefined })
      if (r.success) {
        toast(r.message || `Statut → ${statut}`)
        closeModal('modal-sav-detail')
        refreshSav(savPage)
        loadKpis()
      } else {
        toast(r.error || 'Erreur mise à jour.', 'error')
      }
    } catch { toast('Erreur réseau.', 'error') }
  }

  // ── Modale utilitaire ───────────────────────────────────────
  function closeModal(id) {
    document.getElementById(id).classList.add('hidden')
  }

  // ── Pagination ──────────────────────────────────────────────
  function renderPagination(containerId, pag, onPage) {
    const el = document.getElementById(containerId)
    if (!pag || pag.pages <= 1) { el.innerHTML = `<span>${pag?.total ?? 0} résultat(s)</span>`; return }
    el.innerHTML = `
      <span>${pag.total} résultat(s) — Page ${pag.page}/${pag.pages}</span>
      <div class="flex gap-1">
        ${pag.page > 1 ? `<button onclick="(${onPage.toString()})(${pag.page - 1})"
          class="px-2 py-1 rounded border text-xs hover:bg-gray-100">←</button>` : ''}
        ${Array.from({ length: Math.min(5, pag.pages) }, (_, i) => {
          const p = Math.max(1, Math.min(pag.pages - 4, pag.page - 2)) + i
          return `<button onclick="(${onPage.toString()})(${p})"
            class="px-2 py-1 rounded border text-xs ${p === pag.page ? 'bg-indigo-600 text-white' : 'hover:bg-gray-100'}">${p}</button>`
        }).join('')}
        ${pag.page < pag.pages ? `<button onclick="(${onPage.toString()})(${pag.page + 1})"
          class="px-2 py-1 rounded border text-xs hover:bg-gray-100">→</button>` : ''}
      </div>
    `
  }

  // ── Escaping ────────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return ''
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    // Vérif auth
    if (!getToken()) { window.location.href = '/login'; return }
    // Charger KPIs + données initiales
    loadKpis()
    refreshGaranties()
  }

  // Démarrage après DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  // ── API publique ──────────────────────────────────────────────
  return {
    switchTab,
    refreshGaranties, debouncedRefreshGaranties,
    refreshSav,       debouncedRefreshSav,
    expireGaranties,
    openNewSav, previewGarantie, submitSav,
    openSavDetail, submitStatutChange,
    closeModal,
  }
})()

window.SavApp = SavApp
