/**
 * agenda.js — Frontend Agenda / Rendez-vous + iCal
 * Sprint 2.6 — MOD-08
 * Principe 5 : tous les appels HTTP via ApiService (app.js)
 */

// ─── État global ──────────────────────────────────────────────────────────────

const AgendaState = {
  vue:          'semaine',      // 'semaine' | 'liste'
  currentDate:  new Date(),     // date pivot de la semaine affichée
  rdvCache:     {},             // cache vue semaine { "YYYY-MM-DD": [...] }
  listeData:    [],             // cache vue liste
  listePage:    1,
  listeTotal:   0,
  listeSearch:  '',
  listeStatut:  '',
  listeType:    '',
  editingId:    null,           // null = création, number = édition
  clientsCache: [],
  ticketsCache: [],
}

// Statut → libellé + couleur CSS
const STATUT_META = {
  PENDING:   { label: 'En attente',     css: 'badge-PENDING'   },
  SCHEDULED: { label: 'Confirmé',       css: 'badge-SCHEDULED' },
  DONE:      { label: 'Effectué',       css: 'badge-DONE'      },
  NO_SHOW:   { label: 'Client absent',  css: 'badge-NO_SHOW'   },
  CANCELLED: { label: 'Annulé',         css: 'badge-CANCELLED' },
  CONVERTED: { label: 'Converti ticket',css: 'badge-CONVERTED' },
}

const TYPE_META = {
  reparation:  { label: 'Réparation',   icon: 'fa-wrench'       },
  restitution: { label: 'Restitution',  icon: 'fa-box'          },
  devis:       { label: 'Devis',        icon: 'fa-comment-dots' },
  diagnostic:  { label: 'Diagnostic',   icon: 'fa-search'       },
  autre:       { label: 'Autre',        icon: 'fa-clipboard'    },
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await waitForAuth()
  await Promise.all([
    loadKpis(),
    loadClients(),
    loadTickets(),
  ])
  renderSemaine()
  setVue('semaine')
})

// ─── KPIs ─────────────────────────────────────────────────────────────────────

async function loadKpis() {
  try {
    const bid = getBoutiqueId()
    const r   = await apiGet(`/api/agenda/kpis?boutique_id=${bid}`)
    // apiGet() renvoie {ok,status,data,error} où `data` est le corps JSON complet
    // {success, data}. La route /agenda/kpis imbriquant sous `data`, il faut lire
    // r.data?.data — jamais r.success/r.data directement (même bug class que devis.js).
    if (!r.ok) return
    const k = r.data?.data
    if (!k) return
    document.getElementById('kpi-total-val').textContent   = k.total_rdv
    document.getElementById('kpi-auj-val').textContent     = k.rdv_auj
    document.getElementById('kpi-semaine-val').textContent = k.rdv_semaine
    document.getElementById('kpi-attente-val').textContent = k.en_attente
    document.getElementById('kpi-taux-val').textContent    = k.taux_honore + ' %'
  } catch (e) { console.error('[kpis]', e) }
}

// ─── Vue Semaine ──────────────────────────────────────────────────────────────

/**
 * Calcule le lundi de la semaine contenant `date`.
 */
function getMondayOf(date) {
  const d = new Date(date)
  const day = d.getDay() || 7   // dim=0→7
  d.setDate(d.getDate() - day + 1)
  d.setHours(0, 0, 0, 0)
  return d
}

function prevWeek() {
  AgendaState.currentDate.setDate(AgendaState.currentDate.getDate() - 7)
  renderSemaine()
}

function nextWeek() {
  AgendaState.currentDate.setDate(AgendaState.currentDate.getDate() + 7)
  renderSemaine()
}

function goToday() {
  AgendaState.currentDate = new Date()
  renderSemaine()
}

async function renderSemaine() {
  const monday = getMondayOf(AgendaState.currentDate)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59)

  // Label semaine
  const opts = { day: 'numeric', month: 'long', year: 'numeric' }
  document.getElementById('label-semaine').textContent =
    `${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('fr-FR', opts)}`

  // Charger données
  const bid       = getBoutiqueId()
  const dateDebut = toISOLocal(monday)
  const dateFin   = toISOLocal(sunday)
  const statut    = document.getElementById('filter-statut')?.value || ''
  const typeRdv   = document.getElementById('filter-type')?.value || ''

  let qs = `boutique_id=${bid}&date_debut=${encodeURIComponent(dateDebut)}&date_fin=${encodeURIComponent(dateFin)}`
  if (statut)  qs += `&statut=${statut}`
  if (typeRdv) qs += `&type_rdv=${typeRdv}`

  try {
    const r = await apiGet(`/api/agenda/view?${qs}`)
    // /agenda/view renvoie {success, data:{...}} imbriqué → r.data.data, pas r.data.
    AgendaState.rdvCache = r.ok ? (r.data?.data || {}) : {}
  } catch (e) {
    AgendaState.rdvCache = {}
  }

  buildCalendarDOM(monday)
}

/**
 * Construit le DOM calendrier (en-têtes + grille horaire).
 */
function buildCalendarDOM(monday) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // En-têtes jours
  const headersEl = document.getElementById('day-headers')
  headersEl.innerHTML = ''
  const jours = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const isToday = d.getTime() === today.getTime()

    const div = document.createElement('div')
    div.className = `week-day p-2 text-center border-r border-gray-100 bg-gray-50 ${isToday ? 'today' : ''}`
    div.innerHTML = `
      <div class="day-name text-xs font-semibold text-gray-500 uppercase">${jours[i]}</div>
      <div class="text-lg font-bold ${isToday ? 'text-blue-600' : 'text-gray-800'}">${d.getDate()}</div>
      <div class="text-xs text-gray-400">${d.toLocaleDateString('fr-FR', { month: 'short' })}</div>`
    headersEl.appendChild(div)
  }

  // Corps calendrier : heures 8h-20h
  const bodyEl = document.getElementById('calendar-body')
  bodyEl.innerHTML = ''

  for (let h = 8; h < 20; h++) {
    // Colonne heure
    const timeEl = document.createElement('div')
    timeEl.className = 'time-label time-slot border-t border-gray-50'
    timeEl.textContent = `${h}:00`
    bodyEl.appendChild(timeEl)

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const dateKey = d.toISOString().slice(0, 10)

      const cell = document.createElement('div')
      cell.className = 'day-col time-slot border-t border-gray-50 relative'
      cell.style.cursor = 'pointer'
      // Clic sur cellule → nouveau RDV pré-rempli
      cell.addEventListener('click', () => openModalRdvFromSlot(d, h))

      // Placer les RDV de cette heure
      const rdvs = (AgendaState.rdvCache[dateKey] || []).filter(r => {
        const rh = new Date(r.debut.replace(' ', 'T')).getHours()
        return rh === h
      })
      rdvs.forEach(rdv => {
        const block = buildRdvBlock(rdv)
        cell.appendChild(block)
      })

      bodyEl.appendChild(cell)
    }
  }
}

/**
 * Construit un bloc RDV coloré dans la grille.
 */
function buildRdvBlock(rdv) {
  const div = document.createElement('div')
  div.className = 'rdv-block'
  div.style.backgroundColor = (rdv.couleur || '#3B82F6') + '22'
  div.style.borderLeftColor = rdv.couleur || '#3B82F6'
  div.style.color = rdv.couleur || '#1d4ed8'

  const clientLabel = rdv.client_nom
    ? `${rdv.client_prenom || ''} ${rdv.client_nom}`.trim()
    : rdv.nom_client || ''

  const debutH = rdv.debut.slice(11, 16)

  div.innerHTML = `
    <div class="font-semibold truncate">${debutH} ${escHtml(rdv.titre)}</div>
    ${clientLabel ? `<div class="truncate opacity-75">${escHtml(clientLabel)}</div>` : ''}
  `
  div.addEventListener('click', e => { e.stopPropagation(); openDetailRdv(rdv) })
  return div
}

// ─── Vue Liste ────────────────────────────────────────────────────────────────

async function loadListe(page = 1) {
  const bid = getBoutiqueId()
  let qs = `boutique_id=${bid}&page=${page}&limit=20`
  if (AgendaState.listeSearch) qs += `&search=${encodeURIComponent(AgendaState.listeSearch)}`
  if (AgendaState.listeStatut) qs += `&statut=${AgendaState.listeStatut}`
  if (AgendaState.listeType)   qs += `&type_rdv=${AgendaState.listeType}`

  try {
    const r = await apiGet(`/api/agenda?${qs}`)
    // GET /agenda renvoie {success, ...result} avec result={data,total,page,limit}
    // spreadé au niveau racine du corps JSON → tout est sous r.data (pas r.data direct,
    // pas r.total au niveau du wrapper apiGet).
    if (!r.ok) return
    AgendaState.listeData  = r.data?.data  || []
    AgendaState.listeTotal = r.data?.total || 0
    AgendaState.listePage  = page
    renderListe()
  } catch (e) { console.error('[liste]', e) }
}

function renderListe() {
  const el = document.getElementById('liste-rdv')
  if (!AgendaState.listeData.length) {
    el.innerHTML = `<div class="text-center text-gray-400 py-8">
      <i class="fas fa-calendar-xmark text-4xl mb-2"></i><p>Aucun rendez-vous trouvé</p></div>`
    return
  }

  el.innerHTML = AgendaState.listeData.map(rdv => {
    const sm = STATUT_META[rdv.statut] || { label: rdv.statut, css: '' }
    const tm = TYPE_META[rdv.type_rdv] || { label: rdv.type_rdv, icon: 'fa-calendar' }
    const clientLabel = rdv.client_nom
      ? `${rdv.client_prenom || ''} ${rdv.client_nom}`.trim()
      : rdv.nom_client || '—'
    const dateStr = formatDateTime(rdv.debut)
    const couleur = rdv.couleur || '#3B82F6'

    return `
    <div class="rdv-card bg-white rounded-xl border border-gray-100 p-4 flex gap-4 cursor-pointer hover:border-blue-200"
      onclick='openDetailRdvById(${rdv.id})'>
      <div class="w-1 rounded-full flex-shrink-0" style="background:${couleur}"></div>
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <div>
            <span class="font-semibold text-gray-900">${escHtml(rdv.titre)}</span>
            <span class="ml-2 text-xs px-2 py-0.5 rounded-full ${sm.css}">${sm.label}</span>
          </div>
          <span class="text-xs text-gray-400 flex-shrink-0">${dateStr}</span>
        </div>
        <div class="flex items-center gap-4 mt-1 text-xs text-gray-500">
          <span><i class="fas ${tm.icon} mr-1"></i>${tm.label}</span>
          <span><i class="fas fa-user mr-1"></i>${escHtml(clientLabel)}</span>
          <span><i class="fas fa-clock mr-1"></i>${rdv.duree_minutes} min</span>
          ${rdv.tech_prenom ? `<span><i class="fas fa-user-tie mr-1"></i>${escHtml(rdv.tech_prenom + ' ' + rdv.tech_nom)}</span>` : ''}
        </div>
      </div>
    </div>`
  }).join('')

  // Pagination
  renderListePagination()
}

function renderListePagination() {
  const el    = document.getElementById('liste-pagination')
  const pages = Math.ceil(AgendaState.listeTotal / 20)
  if (pages <= 1) { el.innerHTML = ''; return }

  const btns = []
  for (let p = 1; p <= pages; p++) {
    const active = p === AgendaState.listePage
    btns.push(`<button onclick="loadListe(${p})"
      class="px-3 py-1 rounded text-sm ${active ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}">${p}</button>`)
  }
  el.innerHTML = btns.join('')
}

// ─── Switch vue ───────────────────────────────────────────────────────────────

function setVue(v) {
  AgendaState.vue = v
  document.getElementById('vue-semaine').classList.toggle('hidden', v !== 'semaine')
  document.getElementById('vue-liste').classList.toggle('hidden', v !== 'liste')
  document.getElementById('btn-vue-semaine').className =
    v === 'semaine'
      ? 'vue-btn active px-4 py-2 text-sm font-medium bg-blue-50 text-blue-700'
      : 'vue-btn px-4 py-2 text-sm font-medium bg-white text-gray-600 hover:bg-gray-50'
  document.getElementById('btn-vue-liste').className =
    v === 'liste'
      ? 'vue-btn active px-4 py-2 text-sm font-medium bg-blue-50 text-blue-700'
      : 'vue-btn px-4 py-2 text-sm font-medium bg-white text-gray-600 hover:bg-gray-50'
  document.getElementById('nav-semaine').classList.toggle('hidden', v !== 'semaine')

  if (v === 'liste') loadListe(1)
}

function applyFilters() {
  AgendaState.listeStatut = document.getElementById('filter-statut').value
  AgendaState.listeType   = document.getElementById('filter-type').value
  if (AgendaState.vue === 'semaine') renderSemaine()
  else loadListe(1)
}

function searchListe(val) {
  AgendaState.listeSearch = val
  clearTimeout(AgendaState._searchTimer)
  AgendaState._searchTimer = setTimeout(() => loadListe(1), 350)
}

// ─── Modale RDV (création / édition) ─────────────────────────────────────────

async function loadClients() {
  try {
    const bid = getBoutiqueId()
    const r   = await apiGet(`/api/clients?boutique_id=${bid}&limit=200`)
    // GET /clients renvoie {success, data:[...], pagination} imbriqué.
    if (!r.ok) return
    AgendaState.clientsCache = r.data?.data || []
    const sel = document.getElementById('rdv-client-id')
    AgendaState.clientsCache.forEach(c => {
      const opt = document.createElement('option')
      opt.value       = c.id
      opt.textContent = `${c.prenom || ''} ${c.nom} — ${c.telephone || ''}`
      sel.appendChild(opt)
    })
  } catch (e) { console.error('[clients]', e) }
}

async function loadTickets() {
  try {
    const bid = getBoutiqueId()
    const r   = await apiGet(`/api/tickets?boutique_id=${bid}&limit=200&statut=RECEIVED,DIAGNOSED,WAITING_PARTS`)
    // GET /tickets renvoie {success, ...result} avec result={data,total,...} imbriqué.
    if (!r.ok) return
    AgendaState.ticketsCache = r.data?.data || []
    const sel = document.getElementById('rdv-ticket-id')
    AgendaState.ticketsCache.forEach(t => {
      const opt = document.createElement('option')
      opt.value       = t.id
      opt.textContent = `${t.numero} — ${t.appareil_marque} ${t.appareil_modele}`
      sel.appendChild(opt)
    })
  } catch (e) { console.error('[tickets]', e) }
}

function openModalRdv(rdv = null) {
  AgendaState.editingId = rdv ? rdv.id : null
  const isEdit = !!rdv

  document.getElementById('modal-rdv-title').textContent = isEdit ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'
  document.getElementById('rdv-id').value          = rdv?.id || ''
  document.getElementById('rdv-titre').value       = rdv?.titre || ''
  document.getElementById('rdv-type').value        = rdv?.type_rdv || 'reparation'
  document.getElementById('rdv-description').value = rdv?.description || ''
  document.getElementById('rdv-nom-client').value  = rdv?.nom_client || ''
  document.getElementById('rdv-tel-client').value  = rdv?.telephone_client || ''
  document.getElementById('rdv-client-id').value   = rdv?.client_id || ''
  document.getElementById('rdv-ticket-id').value   = rdv?.ticket_id || ''
  document.getElementById('rdv-couleur').value     = rdv?.couleur || '#3B82F6'
  document.getElementById('rdv-duree').value       = rdv?.duree_minutes || 30

  // Début
  if (rdv?.debut) {
    const d = new Date(rdv.debut.replace(' ', 'T'))
    document.getElementById('rdv-debut').value = d.toISOString().slice(0, 16)
  } else {
    // Par défaut : prochaine demi-heure
    const now = new Date()
    now.setMinutes(now.getMinutes() >= 30 ? 60 : 30, 0, 0)
    document.getElementById('rdv-debut').value = now.toISOString().slice(0, 16)
  }

  // Statut visible seulement en édition
  document.getElementById('statut-wrapper').classList.toggle('hidden', !isEdit)
  if (isEdit && rdv?.statut) document.getElementById('rdv-statut').value = rdv.statut

  document.getElementById('modal-rdv').classList.remove('hidden')
}

function openModalRdvFromSlot(date, heure) {
  const d = new Date(date)
  d.setHours(heure, 0, 0, 0)
  openModalRdv()
  document.getElementById('rdv-debut').value = d.toISOString().slice(0, 16)
}

async function saveRdv(e) {
  e.preventDefault()
  const btn = document.getElementById('btn-save-rdv')
  btn.disabled = true

  const bid   = getBoutiqueId()
  const id    = AgendaState.editingId
  const debut = document.getElementById('rdv-debut').value

  const payload = {
    boutique_id:      bid,
    titre:            document.getElementById('rdv-titre').value.trim(),
    type_rdv:         document.getElementById('rdv-type').value,
    debut:            debut.replace('T', ' ') + ':00',
    duree_minutes:    Number(document.getElementById('rdv-duree').value),
    description:      document.getElementById('rdv-description').value.trim() || null,
    nom_client:       document.getElementById('rdv-nom-client').value.trim() || null,
    telephone_client: document.getElementById('rdv-tel-client').value.trim() || null,
    client_id:        document.getElementById('rdv-client-id').value || null,
    ticket_id:        document.getElementById('rdv-ticket-id').value || null,
    couleur:          document.getElementById('rdv-couleur').value,
  }
  if (id) {
    payload.statut = document.getElementById('rdv-statut').value
  }

  try {
    let r
    if (id) {
      r = await apiPut(`/api/agenda/${id}`, payload)
    } else {
      r = await apiPost('/api/agenda', payload)
    }

    // POST/PUT /agenda ne renvoient pas de `data` exploitable ici (juste message) :
    // seul r.ok (statut HTTP) compte. r.error est déjà résolu par apiGet() en cas
    // d'échec (data?.error du corps JSON), donc directement utilisable.
    if (r.ok) {
      toast(id ? 'RDV mis à jour ✅' : 'RDV créé ✅', 'green')
      closeModal('modal-rdv')
      refreshAll()
    } else {
      toast(r.error, 'red')
    }
  } catch (err) {
    toast('Erreur réseau', 'red')
  } finally {
    btn.disabled = false
  }
}

// ─── Modale Détail ────────────────────────────────────────────────────────────

async function openDetailRdvById(id) {
  try {
    const bid = getBoutiqueId()
    const r   = await apiGet(`/api/agenda/${id}?boutique_id=${bid}`)
    // GET /agenda/:id renvoie {success, data:{...}} imbriqué.
    if (r.ok) openDetailRdv(r.data?.data)
  } catch (e) { toast('Erreur chargement RDV', 'red') }
}

function openDetailRdv(rdv) {
  const sm = STATUT_META[rdv.statut] || { label: rdv.statut, css: '' }
  const tm = TYPE_META[rdv.type_rdv] || { label: rdv.type_rdv, icon: 'fa-calendar' }
  const clientLabel = rdv.client_nom
    ? `${rdv.client_prenom || ''} ${rdv.client_nom}`.trim()
    : rdv.nom_client || '—'

  document.getElementById('detail-titre').textContent = rdv.titre

  document.getElementById('detail-body').innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-xs px-2 py-0.5 rounded-full ${sm.css}">${sm.label}</span>
      <span class="text-xs text-gray-500"><i class="fas ${tm.icon} mr-1"></i>${tm.label}</span>
    </div>
    <div class="flex items-center gap-2 text-gray-600">
      <i class="fas fa-calendar w-4 text-blue-400"></i>
      <span>${formatDateTime(rdv.debut)} — ${rdv.duree_minutes} min</span>
    </div>
    <div class="flex items-center gap-2 text-gray-600">
      <i class="fas fa-user w-4 text-green-400"></i>
      <span>${escHtml(clientLabel)}</span>
      ${rdv.client_tel ? `<a href="tel:${rdv.client_tel}" class="text-blue-500 ml-1">${rdv.client_tel}</a>` : ''}
    </div>
    ${rdv.tech_prenom ? `<div class="flex items-center gap-2 text-gray-600">
      <i class="fas fa-user-tie w-4 text-purple-400"></i>
      <span>${escHtml(rdv.tech_prenom + ' ' + rdv.tech_nom)}</span>
    </div>` : ''}
    ${rdv.ticket_numero ? `<div class="flex items-center gap-2 text-gray-600">
      <i class="fas fa-ticket w-4 text-orange-400"></i>
      <span>Ticket ${rdv.ticket_numero}</span>
    </div>` : ''}
    ${rdv.description ? `<div class="flex items-start gap-2 text-gray-600">
      <i class="fas fa-align-left w-4 text-gray-400 mt-0.5"></i>
      <span>${escHtml(rdv.description)}</span>
    </div>` : ''}
  `

  // Boutons d'action selon statut
  const actions = []
  const transMap = {
    PENDING:   [['SCHEDULED','Confirmer','blue'],['CANCELLED','Annuler','red']],
    SCHEDULED: [['DONE','Marquer effectué','green'],['NO_SHOW','Client absent','orange'],['CANCELLED','Annuler','red']],
    NO_SHOW:   [['SCHEDULED','Replanifier','blue']],
  }
  const transitions = transMap[rdv.statut] || []
  transitions.forEach(([s, label, color]) => {
    actions.push(`<button onclick="changeStatut(${rdv.id},${JSON.stringify(getBoutiqueId())},'${s}',event)"
      class="px-3 py-1.5 text-xs font-medium rounded-lg bg-${color}-50 text-${color}-700 hover:bg-${color}-100 border border-${color}-200">
      ${label}</button>`)
  })
  actions.push(`<button onclick="editRdv(${rdv.id})"
    class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200">
    <i class="fas fa-edit mr-1"></i>Modifier</button>`)
  actions.push(`<button onclick="deleteRdv(${rdv.id})"
    class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 border border-red-200">
    <i class="fas fa-trash mr-1"></i>Supprimer</button>`)

  document.getElementById('detail-actions').innerHTML = actions.join('')
  document.getElementById('modal-detail-rdv').classList.remove('hidden')
}

async function changeStatut(id, boutiqueId, statut, e) {
  e.stopPropagation()
  try {
    const r = await apiPatch(`/api/agenda/${id}/statut`, { boutique_id: boutiqueId, statut })
    // PATCH /agenda/:id/statut ne renvoie qu'un message — seul r.ok compte.
    if (r.ok) {
      toast(`Statut → ${statut} ✅`, 'green')
      closeModal('modal-detail-rdv')
      refreshAll()
    } else {
      toast(r.error, 'red')
    }
  } catch (err) { toast('Erreur', 'red') }
}

async function editRdv(id) {
  closeModal('modal-detail-rdv')
  try {
    const bid = getBoutiqueId()
    const r   = await apiGet(`/api/agenda/${id}?boutique_id=${bid}`)
    // GET /agenda/:id renvoie {success, data:{...}} imbriqué.
    if (r.ok) openModalRdv(r.data?.data)
  } catch (e) { toast('Erreur chargement', 'red') }
}

async function deleteRdv(id) {
  if (!confirm('Supprimer ce rendez-vous ?')) return
  try {
    const bid = getBoutiqueId()
    const r   = await apiDelete(`/api/agenda/${id}?boutique_id=${bid}`)
    // DELETE /agenda/:id ne renvoie qu'un message — seul r.ok compte.
    if (r.ok) {
      toast('RDV supprimé', 'green')
      closeModal('modal-detail-rdv')
      refreshAll()
    } else {
      toast(r.error, 'red')
    }
  } catch (e) { toast('Erreur', 'red') }
}

// ─── Export iCal ──────────────────────────────────────────────────────────────

async function exportIcal() {
  try {
    const bid = getBoutiqueId()
    const r   = await apiGet(`/api/agenda/ical-token?boutique_id=${bid}`)
    // /agenda/ical-token renvoie {success, token, url} — `token` au même niveau que
    // `success` (PAS imbriqué sous `data`), donc r.data.token (une seule imbrication,
    // pas r.data.data.token comme les autres endpoints de ce fichier).
    if (!r.ok) { toast(r.error, 'red'); return }

    const base = window.location.origin
    const url  = `${base}/api/calendar/${r.data?.token}.ics`
    document.getElementById('ical-url').textContent     = url
    document.getElementById('ical-download').href       = url
    document.getElementById('modal-ical').classList.remove('hidden')
  } catch (e) { toast('Erreur iCal', 'red') }
}

function copyIcalUrl() {
  const url = document.getElementById('ical-url').textContent
  navigator.clipboard.writeText(url).then(() => toast('URL copiée ✅', 'green'))
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function closeModal(id) {
  document.getElementById(id).classList.add('hidden')
}

function refreshAll() {
  loadKpis()
  if (AgendaState.vue === 'semaine') renderSemaine()
  else loadListe(AgendaState.listePage)
}

/** Date ISO locale (pas UTC) pour les filtres */
function toISOLocal(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

function formatDateTime(str) {
  if (!str) return '—'
  const d = new Date(str.replace(' ', 'T'))
  return d.toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short', year:'numeric' }) +
    ' ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function toast(msg, color = 'blue') {
  const el = document.getElementById('toast')
  const map = { green:'bg-green-500', red:'bg-red-500', blue:'bg-blue-500', orange:'bg-orange-500' }
  el.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white max-w-sm ${map[color] || map.blue}`
  el.textContent = msg
  el.classList.remove('hidden')
  clearTimeout(window._toastTimer)
  window._toastTimer = setTimeout(() => el.classList.add('hidden'), 3500)
}

function waitForAuth() {
  return new Promise(resolve => {
    const check = () => { if (typeof apiGet === 'function') resolve(); else setTimeout(check, 50) }
    check()
  })
}

function getBoutiqueId() {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}')
    return u.boutique_id || 1
  } catch { return 1 }
}
