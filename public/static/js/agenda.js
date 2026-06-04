/**
 * agenda.js — Frontend Agenda / Rendez-vous
 * Sprint 2.6 — MOD-08
 * Principe 5 : tous les appels API passent par ApiService (app.js)
 */

// ─── État global ──────────────────────────────────────────────────────────────

const AgendaState = {
  vue:          'semaine',    // 'semaine' | 'liste'
  weekOffset:   0,            // 0 = semaine courante, -1 = précédente, +1 = suivante
  rdvMap:       {},           // id → rdv (cache)
  clients:      [],
  tickets:      [],
  listeSearch:  '',
  listePage:    1,
  listeStatut:  '',
  listeType:    '',
}

// Couleurs par type RDV
const COULEURS_TYPE = {
  reparation:  '#3B82F6',
  restitution: '#10B981',
  devis:       '#F59E0B',
  diagnostic:  '#8B5CF6',
  autre:       '#6B7280',
}

const LABELS_STATUT = {
  PENDING:   'En attente',
  SCHEDULED: 'Confirmé',
  DONE:      'Effectué',
  NO_SHOW:   'Absent',
  CANCELLED: 'Annulé',
  CONVERTED: 'Converti',
}

const ICONS_TYPE = {
  reparation:  '🔧',
  restitution: '📦',
  devis:       '💬',
  diagnostic:  '🔍',
  autre:       '📋',
}

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await waitForApp()
  await Promise.all([
    loadKpis(),
    loadClients(),
    loadTickets(),
    renderSemaine(),
  ])
})

function waitForApp() {
  return new Promise(resolve => {
    const check = setInterval(() => {
      if (typeof getBoutiqueId === 'function' && getBoutiqueId()) {
        clearInterval(check)
        resolve()
      }
    }, 50)
    setTimeout(() => { clearInterval(check); resolve() }, 3000)
  })
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

async function loadKpis() {
  try {
    const res = await apiGet(`/api/agenda/kpis?boutique_id=${getBoutiqueId()}`)
    if (!res.success) return
    const d = res.data
    document.getElementById('kpi-total-val').textContent   = d.total_rdv
    document.getElementById('kpi-auj-val').textContent     = d.rdv_auj
    document.getElementById('kpi-semaine-val').textContent = d.rdv_semaine
    document.getElementById('kpi-attente-val').textContent = d.en_attente
    document.getElementById('kpi-taux-val').textContent    = d.taux_honore + '%'
  } catch {}
}

// ─── Clients + Tickets (pour selects modale) ──────────────────────────────────

async function loadClients() {
  try {
    const res = await apiGet(`/api/clients?boutique_id=${getBoutiqueId()}&limit=200`)
    AgendaState.clients = res.data ?? []
    const sel = document.getElementById('rdv-client-id')
    AgendaState.clients.forEach(c => {
      const opt = document.createElement('option')
      opt.value = c.id
      opt.textContent = `${c.prenom ?? ''} ${c.nom}`.trim() + (c.telephone ? ` — ${c.telephone}` : '')
      sel.appendChild(opt)
    })
  } catch {}
}

async function loadTickets() {
  try {
    const res = await apiGet(`/api/tickets?boutique_id=${getBoutiqueId()}&limit=100&statut=en_attente,en_cours`)
    AgendaState.tickets = res.data ?? []
    const sel = document.getElementById('rdv-ticket-id')
    AgendaState.tickets.forEach(t => {
      const opt = document.createElement('option')
      opt.value = t.id
      opt.textContent = `${t.numero} — ${t.appareil_marque} ${t.appareil_modele}`
      sel.appendChild(opt)
    })
  } catch {}
}

// ─── Vue switch ───────────────────────────────────────────────────────────────

function setVue(vue) {
  AgendaState.vue = vue
  document.getElementById('vue-semaine').classList.toggle('hidden', vue !== 'semaine')
  document.getElementById('vue-liste').classList.toggle('hidden', vue !== 'liste')
  document.getElementById('nav-semaine').classList.toggle('hidden', vue === 'liste')

  document.querySelectorAll('.vue-btn').forEach(b => {
    b.classList.remove('active','bg-blue-50','text-blue-700')
    b.classList.add('bg-white','text-gray-600')
  })
  const active = document.getElementById(`btn-vue-${vue}`)
  active.classList.add('active','bg-blue-50','text-blue-700')
  active.classList.remove('bg-white','text-gray-600')

  if (vue === 'semaine') renderSemaine()
  else loadListe()
}

// ─── VUE SEMAINE ──────────────────────────────────────────────────────────────

function getWeekDates(offset = 0) {
  const now = new Date()
  const day = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    days.push(d)
  }
  return days
}

function isoDate(d) { return d.toISOString().slice(0, 10) }
function fmtDate(d) {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

async function renderSemaine() {
  const days     = getWeekDates(AgendaState.weekOffset)
  const dateDebut = isoDate(days[0]) + ' 00:00:00'
  const dateFin   = isoDate(days[6]) + ' 23:59:59'

  // Label semaine
  const opts = { day: 'numeric', month: 'long', year: 'numeric' }
  document.getElementById('label-semaine').textContent =
    `${days[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} – ${days[6].toLocaleDateString('fr-FR', opts)}`

  // Headers jours
  const headers = document.getElementById('day-headers')
  const today   = isoDate(new Date())
  headers.innerHTML = days.map(d => {
    const isToday = isoDate(d) === today
    return `<div class="week-day p-2 text-center border-r border-gray-100 ${isToday ? 'today bg-blue-50' : ''}">
      <div class="day-name text-xs font-semibold ${isToday ? 'text-blue-600' : 'text-gray-500'} uppercase">${d.toLocaleDateString('fr-FR',{weekday:'short'})}</div>
      <div class="text-lg font-bold ${isToday ? 'text-blue-700' : 'text-gray-800'}">${d.getDate()}</div>
    </div>`
  }).join('')

  // Charger RDV de la semaine
  const res = await apiGet(
    `/api/agenda/view?boutique_id=${getBoutiqueId()}&date_debut=${encodeURIComponent(dateDebut)}&date_fin=${encodeURIComponent(dateFin)}`
  )
  const grouped = res.success ? (res.data ?? {}) : {}

  // Corps calendrier (8h → 20h, créneaux 30min)
  const body = document.getElementById('calendar-body')
  const HOUR_START = 8
  const HOUR_END   = 20
  const SLOT_MIN   = 30
  const slots      = (HOUR_END - HOUR_START) * (60 / SLOT_MIN)

  // Construire la grille : colonne heure + 7 colonnes jours
  let html = ''
  for (let s = 0; s < slots; s++) {
    const totalMin = HOUR_START * 60 + s * SLOT_MIN
    const h = String(Math.floor(totalMin / 60)).padStart(2, '0')
    const m = String(totalMin % 60).padStart(2, '0')
    const showLabel = s % 2 === 0 // toutes les heures

    html += `<div class="time-label border-r border-b border-gray-100 time-slot">${showLabel ? h + ':' + m : ''}</div>`
    for (const d of days) {
      html += `<div class="day-col border-b border-gray-100 time-slot" 
                    data-date="${isoDate(d)}" data-hour="${h}" data-min="${m}"
                    onclick="clickSlot('${isoDate(d)}','${h}','${m}')"></div>`
    }
  }
  body.innerHTML = html

  // Positionner les RDV dans la grille
  Object.entries(grouped).forEach(([dateKey, rdvs]) => {
    rdvs.forEach(rdv => {
      const col = body.querySelector(`[data-date="${dateKey}"]`)
      if (!col) return
      // Calculer position verticale
      const debutDate = new Date(rdv.debut.replace(' ','T') + 'Z')
      const debutMin  = debutDate.getUTCHours() * 60 + debutDate.getUTCMinutes()
      const finDate   = new Date(rdv.fin.replace(' ','T') + 'Z')
      const finMin    = finDate.getUTCHours() * 60 + finDate.getUTCMinutes()
      const topSlot   = (debutMin - HOUR_START * 60) / SLOT_MIN
      const heightSlots = Math.max(1, (finMin - debutMin) / SLOT_MIN)
      const topPx     = topSlot * 48
      const heightPx  = heightSlots * 48 - 2

      const couleur = rdv.couleur || COULEURS_TYPE[rdv.type_rdv] || '#3B82F6'
      const clientLabel = rdv.client_nom
        ? `${rdv.client_prenom ?? ''} ${rdv.client_nom}`.trim()
        : rdv.nom_client ?? ''

      const block = document.createElement('div')
      block.className = 'rdv-block'
      block.style.cssText = `top:${topPx}px;height:${heightPx}px;background:${couleur}22;color:${couleur};border-left-color:${couleur}`
      block.innerHTML = `<div class="font-semibold truncate">${escHtml(rdv.titre)}</div>
        ${clientLabel ? `<div class="truncate opacity-80">${escHtml(clientLabel)}</div>` : ''}`
      block.onclick = (e) => { e.stopPropagation(); openDetail(rdv.id) }

      // Injecter dans la bonne colonne (chercher la col du bon jour, première cellule)
      col.closest('.calendar-grid') || body
      // on positionne relativement à la 1ère cellule de cette colonne dans la grille
      // Approche: rendre la colonne du jour relative et y appender
      // Trouver toutes les cellules de ce jour
      const allCols = body.querySelectorAll(`[data-date="${dateKey}"]`)
      if (allCols.length === 0) return
      // Utiliser la 1ère cellule comme conteneur relatif
      const firstCol = allCols[0].parentElement || allCols[0]
      // Créer un wrapper absolu sur toute la colonne du jour
      // (positionné par rapport au corps entier)
      const colIndex = Array.from(body.querySelectorAll(`[data-date="${dateKey}"]`)[0].parentElement?.children ?? []).indexOf(allCols[0])
      // Simpler: on overlay directement dans chaque cellule concernée
      const targetCells = Array.from(allCols).slice(topSlot, topSlot + Math.ceil(heightSlots))
      if (targetCells[0]) {
        targetCells[0].style.position = 'relative'
        const b2 = block.cloneNode(true)
        b2.style.top = '0'; b2.style.height = heightPx + 'px'
        b2.onclick = (e) => { e.stopPropagation(); openDetail(rdv.id) }
        targetCells[0].appendChild(b2)
        AgendaState.rdvMap[rdv.id] = rdv
      }
    })
  })
}

function clickSlot(date, h, m) {
  // Pré-remplir le formulaire avec la date/heure du créneau cliqué
  const dt = `${date}T${h}:${m}`
  document.getElementById('rdv-debut').value = dt
  openModalRdv()
}

function prevWeek() { AgendaState.weekOffset--; renderSemaine() }
function nextWeek() { AgendaState.weekOffset++; renderSemaine() }
function goToday()  { AgendaState.weekOffset = 0; renderSemaine() }

// ─── VUE LISTE ────────────────────────────────────────────────────────────────

let _listeTimeout = null
function searchListe(v) {
  AgendaState.listeSearch = v
  AgendaState.listePage = 1
  clearTimeout(_listeTimeout)
  _listeTimeout = setTimeout(loadListe, 300)
}

function applyFilters() {
  AgendaState.listeStatut = document.getElementById('filter-statut').value
  AgendaState.listeType   = document.getElementById('filter-type').value
  AgendaState.listePage   = 1
  if (AgendaState.vue === 'liste') loadListe()
  else renderSemaine()
}

async function loadListe() {
  const params = new URLSearchParams({
    boutique_id: getBoutiqueId(),
    page:   AgendaState.listePage,
    limit:  20,
  })
  if (AgendaState.listeSearch)  params.set('search',  AgendaState.listeSearch)
  if (AgendaState.listeStatut)  params.set('statut',  AgendaState.listeStatut)
  if (AgendaState.listeType)    params.set('type_rdv', AgendaState.listeType)

  const res = await apiGet('/api/agenda?' + params)
  const container = document.getElementById('liste-rdv')

  if (!res.success || !res.data?.length) {
    container.innerHTML = `<div class="text-center text-gray-400 py-10">
      <i class="fas fa-calendar-xmark text-4xl mb-2"></i><p>Aucun rendez-vous</p></div>`
    document.getElementById('liste-pagination').innerHTML = ''
    return
  }

  container.innerHTML = res.data.map(rdv => rdvCard(rdv)).join('')
  res.data.forEach(rdv => { AgendaState.rdvMap[rdv.id] = rdv })

  // Pagination
  const pages = Math.ceil((res.total ?? 0) / 20)
  renderPagination('liste-pagination', AgendaState.listePage, pages, p => {
    AgendaState.listePage = p; loadListe()
  })
}

function rdvCard(rdv) {
  const couleur = rdv.couleur || COULEURS_TYPE[rdv.type_rdv] || '#3B82F6'
  const client  = rdv.client_nom
    ? `${rdv.client_prenom ?? ''} ${rdv.client_nom}`.trim()
    : rdv.nom_client ?? '—'
  const debutFmt = new Date(rdv.debut.replace(' ','T')+'Z').toLocaleString('fr-FR',{
    weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
  })

  return `<div class="rdv-card bg-white border border-gray-100 rounded-xl p-4 flex items-start gap-4 cursor-pointer hover:border-blue-200"
               onclick="openDetail(${rdv.id})" style="border-left: 4px solid ${couleur}">
    <div class="flex-shrink-0 text-2xl">${ICONS_TYPE[rdv.type_rdv] ?? '📋'}</div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-semibold text-gray-900">${escHtml(rdv.titre)}</span>
        <span class="badge-small badge-${rdv.statut}">${LABELS_STATUT[rdv.statut] ?? rdv.statut}</span>
      </div>
      <div class="text-sm text-gray-500 mt-1">${debutFmt} · ${rdv.duree_minutes} min</div>
      <div class="text-sm text-gray-600 mt-1"><i class="fas fa-user text-gray-400 mr-1"></i>${escHtml(client)}</div>
    </div>
    <div class="flex gap-2 flex-shrink-0">
      <button onclick="event.stopPropagation();editRdv(${rdv.id})" class="text-gray-400 hover:text-blue-600 p-1" title="Modifier">
        <i class="fas fa-edit"></i>
      </button>
    </div>
  </div>`
}

function renderPagination(containerId, current, total, onClick) {
  const c = document.getElementById(containerId)
  if (total <= 1) { c.innerHTML = ''; return }
  let html = ''
  for (let p = 1; p <= total; p++) {
    html += `<button onclick="(${onClick.toString()})(${p})"
      class="w-8 h-8 rounded-lg text-sm ${p === current ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}">${p}</button>`
  }
  c.innerHTML = html
}

// ─── Modale Détail ────────────────────────────────────────────────────────────

async function openDetail(id) {
  let rdv = AgendaState.rdvMap[id]
  if (!rdv) {
    const res = await apiGet(`/api/agenda/${id}?boutique_id=${getBoutiqueId()}`)
    if (!res.success) return
    rdv = res.data
    AgendaState.rdvMap[id] = rdv
  }

  document.getElementById('detail-titre').textContent = rdv.titre
  const client = rdv.client_nom
    ? `${rdv.client_prenom ?? ''} ${rdv.client_nom}`.trim()
    : rdv.nom_client ?? '—'
  const debutFmt = new Date((rdv.debut+'').replace(' ','T')+'Z').toLocaleString('fr-FR',{
    weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'
  })
  const finFmt = new Date((rdv.fin+'').replace(' ','T')+'Z').toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})

  document.getElementById('detail-body').innerHTML = `
    <div class="flex items-center gap-2">
      <span class="badge-small badge-${rdv.statut}">${LABELS_STATUT[rdv.statut] ?? rdv.statut}</span>
      <span class="text-gray-500">${ICONS_TYPE[rdv.type_rdv] ?? '📋'} ${rdv.type_rdv}</span>
    </div>
    <div><i class="fas fa-clock text-gray-400 mr-2"></i>${debutFmt} → ${finFmt} <span class="text-gray-400">(${rdv.duree_minutes} min)</span></div>
    <div><i class="fas fa-user text-gray-400 mr-2"></i>${escHtml(client)}
      ${rdv.telephone_client ? `<span class="text-gray-500 ml-2">· ${escHtml(rdv.telephone_client)}</span>` : ''}
      ${rdv.client_tel ? `<span class="text-gray-500 ml-2">· ${escHtml(rdv.client_tel)}</span>` : ''}
    </div>
    ${rdv.tech_prenom ? `<div><i class="fas fa-user-tie text-gray-400 mr-2"></i>${escHtml(rdv.tech_prenom+' '+rdv.tech_nom)}</div>` : ''}
    ${rdv.ticket_numero ? `<div><i class="fas fa-ticket-alt text-gray-400 mr-2"></i>Ticket ${escHtml(rdv.ticket_numero)}</div>` : ''}
    ${rdv.description ? `<div class="bg-gray-50 rounded-lg p-2 text-gray-600">${escHtml(rdv.description)}</div>` : ''}
  `

  // Boutons d'action selon statut
  const actions = document.getElementById('detail-actions')
  actions.innerHTML = ''
  const transitionMap = {
    PENDING:   [{s:'SCHEDULED',label:'✅ Confirmer',cls:'btn-primary'},{s:'CANCELLED',label:'❌ Annuler',cls:'btn-danger-sm'}],
    SCHEDULED: [{s:'DONE',label:'✅ Effectué',cls:'btn-primary'},{s:'NO_SHOW',label:'👻 Absent',cls:'btn-warning-sm'},{s:'CANCELLED',label:'❌ Annuler',cls:'btn-danger-sm'}],
    NO_SHOW:   [{s:'SCHEDULED',label:'🔄 Replanifier',cls:'btn-secondary'}],
  }
  const transitions = transitionMap[rdv.statut] ?? []
  transitions.forEach(({s, label, cls}) => {
    const btn = document.createElement('button')
    btn.className = cls + ' text-sm'
    btn.textContent = label
    btn.onclick = () => changeStatut(id, s, rdv.boutique_id ?? getBoutiqueId())
    actions.appendChild(btn)
  })

  // Bouton modifier toujours
  const btnEdit = document.createElement('button')
  btnEdit.className = 'btn-secondary text-sm'
  btnEdit.innerHTML = '<i class="fas fa-edit mr-1"></i>Modifier'
  btnEdit.onclick = () => { closeModal('modal-detail-rdv'); editRdv(id) }
  actions.appendChild(btnEdit)

  openModal('modal-detail-rdv')
}

async function changeStatut(id, statut, boutiqueId) {
  const res = await apiPatch(`/api/agenda/${id}/statut`, { boutique_id: boutiqueId, statut })
  if (res.success) {
    toast('Statut mis à jour.', 'success')
    closeModal('modal-detail-rdv')
    delete AgendaState.rdvMap[id]
    loadKpis()
    if (AgendaState.vue === 'semaine') renderSemaine()
    else loadListe()
  } else {
    toast(res.error, 'error')
  }
}

// ─── Modale Créer/Modifier RDV ────────────────────────────────────────────────

function openModalRdv(prefillDate) {
  document.getElementById('rdv-id').value = ''
  document.getElementById('form-rdv').reset()
  document.getElementById('rdv-couleur').value = '#3B82F6'
  document.getElementById('modal-rdv-title').textContent = 'Nouveau rendez-vous'
  document.getElementById('btn-save-rdv').textContent = 'Enregistrer'
  document.getElementById('statut-wrapper').classList.add('hidden')

  if (prefillDate) document.getElementById('rdv-debut').value = prefillDate

  // Pré-remplir avec maintenant + 30 min si vide
  if (!document.getElementById('rdv-debut').value) {
    const now = new Date()
    now.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0)
    document.getElementById('rdv-debut').value = toDatetimeLocal(now)
  }

  openModal('modal-rdv')
}

async function editRdv(id) {
  let rdv = AgendaState.rdvMap[id]
  if (!rdv) {
    const res = await apiGet(`/api/agenda/${id}?boutique_id=${getBoutiqueId()}`)
    if (!res.success) return
    rdv = res.data
  }

  document.getElementById('rdv-id').value        = rdv.id
  document.getElementById('rdv-titre').value     = rdv.titre
  document.getElementById('rdv-type').value      = rdv.type_rdv
  document.getElementById('rdv-debut').value     = toDatetimeLocal(new Date((rdv.debut+'').replace(' ','T')+'Z'))
  document.getElementById('rdv-duree').value     = rdv.duree_minutes
  document.getElementById('rdv-nom-client').value = rdv.nom_client ?? ''
  document.getElementById('rdv-tel-client').value = rdv.telephone_client ?? ''
  document.getElementById('rdv-client-id').value  = rdv.client_id ?? ''
  document.getElementById('rdv-ticket-id').value  = rdv.ticket_id ?? ''
  document.getElementById('rdv-description').value = rdv.description ?? ''
  document.getElementById('rdv-couleur').value    = rdv.couleur ?? '#3B82F6'
  document.getElementById('rdv-statut').value     = rdv.statut

  document.getElementById('modal-rdv-title').textContent = 'Modifier le rendez-vous'
  document.getElementById('btn-save-rdv').textContent    = 'Mettre à jour'
  document.getElementById('statut-wrapper').classList.remove('hidden')

  openModal('modal-rdv')
}

async function saveRdv(e) {
  e.preventDefault()
  const id = document.getElementById('rdv-id').value
  const payload = {
    boutique_id:      getBoutiqueId(),
    titre:            document.getElementById('rdv-titre').value.trim(),
    type_rdv:         document.getElementById('rdv-type').value,
    debut:            document.getElementById('rdv-debut').value.replace('T', ' '),
    duree_minutes:    Number(document.getElementById('rdv-duree').value),
    nom_client:       document.getElementById('rdv-nom-client').value.trim() || null,
    telephone_client: document.getElementById('rdv-tel-client').value.trim() || null,
    client_id:        document.getElementById('rdv-client-id').value || null,
    ticket_id:        document.getElementById('rdv-ticket-id').value || null,
    description:      document.getElementById('rdv-description').value.trim() || null,
    couleur:          document.getElementById('rdv-couleur').value,
  }

  if (id) {
    payload.statut = document.getElementById('rdv-statut').value
    const res = await apiPut(`/api/agenda/${id}`, payload)
    if (res.success) {
      toast('RDV mis à jour.', 'success')
      closeModal('modal-rdv')
      delete AgendaState.rdvMap[id]
      refresh()
    } else { toast(res.error, 'error') }
  } else {
    const res = await apiPost('/api/agenda', payload)
    if (res.success) {
      toast('RDV créé.', 'success')
      closeModal('modal-rdv')
      refresh()
    } else { toast(res.error, 'error') }
  }
}

function refresh() {
  loadKpis()
  if (AgendaState.vue === 'semaine') renderSemaine()
  else loadListe()
}

// ─── Export iCal ─────────────────────────────────────────────────────────────

async function exportIcal() {
  const res = await apiGet(`/api/agenda/ical-token?boutique_id=${getBoutiqueId()}`)
  if (!res.success) { toast(res.error, 'error'); return }

  const fullUrl = window.location.origin + res.url
  document.getElementById('ical-url').textContent = fullUrl
  const dl = document.getElementById('ical-download')
  dl.href = res.url
  openModal('modal-ical')
}

async function copyIcalUrl() {
  const url = document.getElementById('ical-url').textContent
  await navigator.clipboard.writeText(url).catch(() => {})
  toast('URL copiée !', 'success')
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.remove('hidden') }
function closeModal(id) { document.getElementById(id).classList.add('hidden') }

function toDatetimeLocal(date) {
  const pad = n => String(n).padStart(2,'0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function toast(msg, type = 'info') {
  const t = document.getElementById('toast')
  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600', warning: 'bg-yellow-500' }
  t.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white max-w-sm ${colors[type] ?? colors.info}`
  t.textContent = msg
  t.classList.remove('hidden')
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.classList.add('hidden'), 3500)
}

// ─── Styles dynamiques badges ─────────────────────────────────────────────────

const badgeStyle = document.createElement('style')
badgeStyle.textContent = `
.badge-small { display:inline-flex;align-items:center;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600; }
.badge-PENDING   { background:#fef9c3;color:#854d0e; }
.badge-SCHEDULED { background:#dbeafe;color:#1e40af; }
.badge-DONE      { background:#dcfce7;color:#166534; }
.badge-NO_SHOW   { background:#fee2e2;color:#991b1b; }
.badge-CANCELLED { background:#f3f4f6;color:#6b7280; }
.badge-CONVERTED { background:#f3e8ff;color:#7e22ce; }
.btn-warning-sm  { padding:6px 12px;border-radius:8px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:600;cursor:pointer; }
.btn-danger-sm   { padding:6px 12px;border-radius:8px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:600;cursor:pointer; }
`
document.head.appendChild(badgeStyle)
