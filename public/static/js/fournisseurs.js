/**
 * fournisseurs.js — Fournisseurs, Bons de commande, Réceptions (CUMP)
 * Sprint 2.5 — MOD-10 Achats/Approvisionnement
 * Architecture : tous les appels réseau via ApiService (Principe 5)
 */

'use strict'

// ─── État global ──────────────────────────────────────────────────────────────
let currentTab        = 'bons'
let boutiqueId        = null
let pageBons          = 1
let pageFournisseurs  = 1
let fournisseursList  = []   // cache pour les selects

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  requireAuth()
  boutiqueId = getBoutiqueId()

  initTabs()
  initModals()
  initEventListeners()

  await Promise.all([loadKpis(), loadBons(), loadFournisseursCache()])
})

// ─── Onglets ──────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'))
      document.querySelectorAll('.tab-content').forEach(s => s.classList.add('hidden'))
      btn.classList.add('tab-active')
      document.getElementById(`tab-${tab}`).classList.remove('hidden')
      currentTab = tab
      if (tab === 'bons')        loadBons()
      if (tab === 'fournisseurs') loadFournisseurs()
      if (tab === 'a-commander') loadACommander()
    })
  })
}

// ─── Fermeture modales ────────────────────────────────────────────────────────
function initModals() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close))
  })
  document.querySelectorAll('.modal-backdrop').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id) })
  })
}

function openModal(id) { document.getElementById(id).classList.remove('hidden') }
function closeModal(id) { document.getElementById(id).classList.add('hidden') }

// ─── Listeners boutons principaux ────────────────────────────────────────────
function initEventListeners() {
  // Fournisseur
  document.getElementById('btn-new-fournisseur').addEventListener('click', () => openModalFournisseur())
  document.getElementById('btn-save-fournisseur').addEventListener('click', saveFournisseur)

  // Bon de commande
  document.getElementById('btn-new-bc').addEventListener('click', () => openModalBC())
  document.getElementById('btn-save-bc').addEventListener('click', saveBonCommande)
  document.getElementById('btn-add-ligne').addEventListener('click', () => addLigneBC())

  // Réception
  document.getElementById('btn-confirm-reception').addEventListener('click', confirmerReception)

  // "À commander" → créer BC depuis sélection
  document.getElementById('btn-bc-depuis-selection').addEventListener('click', bcDepuisSelection)
  document.getElementById('check-all-acommander').addEventListener('change', e => {
    document.querySelectorAll('.check-acommander').forEach(cb => { cb.checked = e.target.checked })
    toggleBcDepuisSelection()
  })

  // Bouton "À commander" dans le header
  document.getElementById('btn-a-commander').addEventListener('click', () => {
    document.querySelector('[data-tab="a-commander"]').click()
  })

  // Filtres debounce
  let t1, t2
  document.getElementById('search-bc').addEventListener('input', () => { clearTimeout(t1); t1 = setTimeout(() => { pageBons = 1; loadBons() }, 350) })
  document.getElementById('filter-statut-bc').addEventListener('change', () => { pageBons = 1; loadBons() })
  document.getElementById('search-f').addEventListener('input', () => { clearTimeout(t2); t2 = setTimeout(() => { pageFournisseurs = 1; loadFournisseurs() }, 350) })
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
async function loadKpis() {
  const res = await apiGet(`/api/fournisseurs/kpis?boutique_id=${boutiqueId}`)
  if (!res?.success) return
  const d = res.data
  document.getElementById('kpi-nb-fournisseurs').textContent = d.nb_fournisseurs      ?? 0
  document.getElementById('kpi-nb-commandes').textContent    = d.nb_commandes_total   ?? 0
  document.getElementById('kpi-en-attente').textContent      = d.nb_en_attente        ?? 0
  document.getElementById('kpi-achats-ht').textContent       = formatCurrency(d.montant_achats_ht  ?? 0)
  document.getElementById('kpi-impaye').textContent          = formatCurrency(d.montant_impaye_ttc ?? 0)

  // Badge "À commander"
  const nbAC = d.nb_produits_a_commander ?? 0
  const badge = document.getElementById('badge-a-commander')
  if (nbAC > 0) { badge.textContent = nbAC; badge.classList.remove('hidden') }
  else badge.classList.add('hidden')
}

// ─── Bons de commande ─────────────────────────────────────────────────────────

/** Charge et affiche la liste des bons de commande */
async function loadBons() {
  const search = document.getElementById('search-bc').value.trim()
  const statut = document.getElementById('filter-statut-bc').value
  let url = `/api/bons-commande?boutique_id=${boutiqueId}&page=${pageBons}&limit=20`
  if (search) url += `&search=${encodeURIComponent(search)}`
  if (statut) url += `&statut=${statut}`

  const res = await apiGet(url)
  const tbody = document.getElementById('table-bons')
  const empty = document.getElementById('bons-empty')

  if (!res?.success || !res.data?.length) {
    tbody.innerHTML = ''
    empty.classList.remove('hidden')
    document.getElementById('bons-pagination').innerHTML = ''
    return
  }

  empty.classList.add('hidden')
  tbody.innerHTML = res.data.map(bc => `
    <tr class="table-row cursor-pointer" onclick="voirBC(${bc.id})">
      <td class="td-cell font-mono font-semibold text-indigo-700">${bc.numero}</td>
      <td class="td-cell">${esc(bc.fournisseur_nom ?? '—')}</td>
      <td class="td-cell text-gray-500">${formatDate(bc.created_at)}</td>
      <td class="td-cell">${badgeStatutBC(bc.statut)}</td>
      <td class="td-cell">${badgePaiementBC(bc.statut_paiement)}</td>
      <td class="td-cell text-right font-medium">${formatCurrency(bc.montant_ht)}</td>
      <td class="td-cell text-center text-gray-500">
        ${bc.total_articles_recus ?? 0}/${bc.total_articles_commandes ?? 0}
      </td>
      <td class="td-cell" onclick="event.stopPropagation()">
        ${bc.statut === 'awaiting_delivery' ? `
          <button onclick="ouvrirReception(${bc.id})" class="btn-xs bg-green-100 text-green-700 hover:bg-green-200">
            <i class="fas fa-box-open mr-1"></i>Réceptionner
          </button>` : ''}
        ${bc.statut === 'draft' ? `
          <button onclick="envoyerBC(${bc.id})" class="btn-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200">
            <i class="fas fa-paper-plane mr-1"></i>Envoyer
          </button>` : ''}
      </td>
    </tr>
  `).join('')

  // Pagination
  const p = res.pagination
  document.getElementById('bons-pagination').innerHTML = p
    ? `<span>Page ${p.page}/${p.pages} — ${p.total} bon(s)</span>
       <div class="flex gap-1">
         ${p.page > 1 ? `<button onclick="pageBons=${p.page-1};loadBons()" class="btn-xs">‹ Préc</button>` : ''}
         ${p.page < p.pages ? `<button onclick="pageBons=${p.page+1};loadBons()" class="btn-xs">Suiv ›</button>` : ''}
       </div>`
    : ''
}

function badgeStatutBC(statut) {
  const map = {
    draft:              '<span class="badge-gray">Brouillon</span>',
    awaiting_delivery:  '<span class="badge-yellow">En attente</span>',
    received:           '<span class="badge-green">Réceptionné</span>',
    cancelled:          '<span class="badge-red">Annulé</span>',
  }
  return map[statut] ?? `<span class="badge-gray">${statut}</span>`
}

function badgePaiementBC(statut) {
  const map = {
    pending:  '<span class="badge-yellow">À régler</span>',
    partial:  '<span class="badge-blue">Partiel</span>',
    paid:     '<span class="badge-green">Réglé</span>',
  }
  return map[statut] ?? `<span class="badge-gray">${statut}</span>`
}

/** Voir / ouvrir un bon de commande (futur : page dédiée ou modal détail) */
async function voirBC(id) {
  const res = await apiGet(`/api/bons-commande/${id}`)
  if (!res?.success) { showFlash('Erreur chargement bon de commande.', 'error'); return }
  const { bc, lignes } = res.data
  alert(`Bon ${bc.numero}\nFournisseur : ${bc.fournisseur_nom}\nStatut : ${bc.statut}\n\n${lignes.length} ligne(s)\nTotal HT : ${formatCurrency(bc.montant_ht)}`)
}

/** Passer un bon de draft → awaiting_delivery */
async function envoyerBC(id) {
  if (!confirm('Passer ce bon en statut "En attente de livraison" ?')) return
  const res = await apiPatch(`/api/bons-commande/${id}/statut`, { statut: 'awaiting_delivery' })
  if (res?.success) { showFlash('Bon envoyé au fournisseur.', 'success'); loadBons(); loadKpis() }
  else showFlash(res?.error ?? 'Erreur.', 'error')
}

// ─── Modal Bon de commande ────────────────────────────────────────────────────
let lignesBCCount = 0

function openModalBC(prefillLignes = []) {
  document.getElementById('modal-bc-title').textContent = 'Nouveau bon de commande'
  document.getElementById('bc-notes').value             = ''
  document.getElementById('bc-date-livraison').value    = ''
  document.getElementById('bc-error').classList.add('hidden')
  lignesBCCount = 0

  // Populer le select fournisseurs
  const sel = document.getElementById('bc-fournisseur')
  sel.innerHTML = '<option value="">— Choisir un fournisseur —</option>' +
    fournisseursList.map(f => `<option value="${f.id}">${esc(f.nom)}</option>`).join('')

  // Lignes pré-remplies (depuis "À commander")
  document.getElementById('bc-lignes-container').innerHTML = ''
  if (prefillLignes.length > 0) {
    prefillLignes.forEach(l => addLigneBC(l))
  } else {
    addLigneBC()
  }

  openModal('modal-bc')
  majTotauxBC()
}

function addLigneBC(prefill = null) {
  const i = lignesBCCount++
  const div = document.createElement('div')
  div.className = 'bc-ligne grid grid-cols-12 gap-2 items-center'
  div.dataset.index = i
  div.innerHTML = `
    <div class="col-span-5">
      <input type="text" placeholder="Désignation *" class="input-field w-full bc-designation"
             value="${esc(prefill?.designation ?? '')}" oninput="majTotauxBC()">
    </div>
    <div class="col-span-2">
      <input type="text" placeholder="Référence" class="input-field w-full bc-reference"
             value="${esc(prefill?.reference ?? '')}">
    </div>
    <div class="col-span-1">
      <input type="number" placeholder="Qté *" min="1" class="input-field w-full bc-qte"
             value="${prefill?.quantite ?? 1}" oninput="majTotauxBC()">
    </div>
    <div class="col-span-2">
      <input type="number" placeholder="Prix HT *" min="0" step="0.01" class="input-field w-full bc-prix"
             value="${prefill?.prix_achat_ht ?? ''}" oninput="majTotauxBC()">
    </div>
    <div class="col-span-1">
      <select class="input-field w-full bc-tva" onchange="majTotauxBC()">
        ${[0, 5.5, 10, 20].map(t => `<option value="${t}" ${t == (prefill?.tva_taux ?? 20) ? 'selected' : ''}>${t}%</option>`).join('')}
      </select>
    </div>
    <div class="col-span-1 flex justify-center">
      <button onclick="this.closest('.bc-ligne').remove(); majTotauxBC()"
              class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
    </div>
    <input type="hidden" class="bc-produit-id" value="${prefill?.produit_id ?? ''}">
  `
  document.getElementById('bc-lignes-container').appendChild(div)
}

function majTotauxBC() {
  let ht = 0, ttc = 0
  document.querySelectorAll('.bc-ligne').forEach(div => {
    const qte  = parseFloat(div.querySelector('.bc-qte')?.value  || 0)
    const prix = parseFloat(div.querySelector('.bc-prix')?.value || 0)
    const tva  = parseFloat(div.querySelector('.bc-tva')?.value  || 20)
    ht  += qte * prix
    ttc += qte * prix * (1 + tva / 100)
  })
  document.getElementById('bc-total-ht').textContent  = formatCurrency(ht)
  document.getElementById('bc-total-ttc').textContent = formatCurrency(ttc)
}

async function saveBonCommande() {
  const fournisseurId = parseInt(document.getElementById('bc-fournisseur').value, 10)
  if (!fournisseurId) { showError('bc-error', 'Sélectionnez un fournisseur.'); return }

  const lignes = []
  let valid = true
  document.querySelectorAll('.bc-ligne').forEach(div => {
    const designation = div.querySelector('.bc-designation').value.trim()
    const reference   = div.querySelector('.bc-reference').value.trim()
    const qte         = parseInt(div.querySelector('.bc-qte').value, 10)
    const prix        = parseFloat(div.querySelector('.bc-prix').value)
    const tva         = parseFloat(div.querySelector('.bc-tva').value)
    const produitId   = div.querySelector('.bc-produit-id').value

    if (!designation || isNaN(qte) || qte <= 0 || isNaN(prix) || prix < 0) {
      valid = false; return
    }
    lignes.push({
      designation,
      reference:         reference || null,
      quantite_commandee: qte,
      prix_achat_ht:      prix,
      tva_taux:           tva,
      produit_id:         produitId ? parseInt(produitId, 10) : null
    })
  })

  if (!valid || lignes.length === 0) { showError('bc-error', 'Vérifiez les lignes (désignation, quantité et prix obligatoires).'); return }

  const body = {
    boutique_id:          boutiqueId,
    fournisseur_id:        fournisseurId,
    notes:                 document.getElementById('bc-notes').value.trim() || null,
    date_livraison_prevue: document.getElementById('bc-date-livraison').value || null,
    lignes
  }

  const res = await apiPost('/api/bons-commande', body)
  if (res?.success) {
    closeModal('modal-bc')
    showFlash(`Bon de commande créé (#${res.id}).`, 'success')
    loadBons(); loadKpis()
  } else {
    showError('bc-error', res?.error ?? 'Erreur lors de la création.')
  }
}

// ─── Réception ────────────────────────────────────────────────────────────────
async function ouvrirReception(bcId) {
  const res = await apiGet(`/api/bons-commande/${bcId}`)
  if (!res?.success) { showFlash('Erreur chargement bon.', 'error'); return }

  const { bc, lignes } = res.data
  document.getElementById('reception-bc-id').value = bcId
  document.getElementById('reception-error').classList.add('hidden')

  document.getElementById('reception-lignes').innerHTML = `
    <p class="text-sm font-medium text-gray-700 mb-2">Bon : <span class="font-mono">${esc(bc.numero)}</span> — ${esc(bc.fournisseur_nom)}</p>
    ${lignes.map(l => `
      <div class="flex items-center gap-3 border rounded p-2 bg-gray-50">
        <div class="flex-1">
          <div class="font-medium text-sm">${esc(l.designation)}</div>
          ${l.produit_nom ? `<div class="text-xs text-gray-500">Produit : ${esc(l.produit_nom)} — Stock actuel : ${l.stock_actuel}</div>` : '<div class="text-xs text-gray-400">Aucun produit lié (stock non mis à jour)</div>'}
        </div>
        <div class="text-sm text-gray-500 w-28 text-right">Commandé : ${l.quantite_commandee}</div>
        <div class="w-24">
          <input type="number" min="0" max="${l.quantite_commandee - l.quantite_recue}"
                 value="${l.quantite_commandee - l.quantite_recue}"
                 data-ligne-id="${l.id}"
                 class="reception-qte input-field w-full text-right"
                 placeholder="Qté reçue">
        </div>
      </div>
    `).join('')}
  `

  openModal('modal-reception')
}

async function confirmerReception() {
  const bcId = parseInt(document.getElementById('reception-bc-id').value, 10)
  const lignesRecues = []

  document.querySelectorAll('.reception-qte').forEach(input => {
    const qte = parseInt(input.value, 10)
    if (!isNaN(qte) && qte > 0) {
      lignesRecues.push({ ligne_id: parseInt(input.dataset.ligneId, 10), quantite_recue: qte })
    }
  })

  if (lignesRecues.length === 0) {
    showError('reception-error', 'Entrez au moins une quantité reçue > 0.')
    return
  }

  const res = await apiPost(`/api/bons-commande/${bcId}/receptionner`, { lignes_recues: lignesRecues })
  if (res?.success) {
    closeModal('modal-reception')
    showFlash(res.message, 'success')
    loadBons(); loadKpis()
  } else {
    showError('reception-error', res?.error ?? 'Erreur lors de la réception.')
  }
}

// ─── Fournisseurs ─────────────────────────────────────────────────────────────

/** Cache fournisseurs pour les selects */
async function loadFournisseursCache() {
  const res = await apiGet(`/api/fournisseurs?boutique_id=${boutiqueId}&limit=200`)
  if (res?.success) fournisseursList = res.data ?? []
}

async function loadFournisseurs() {
  const search = document.getElementById('search-f').value.trim()
  let url = `/api/fournisseurs?boutique_id=${boutiqueId}&page=${pageFournisseurs}&limit=20`
  if (search) url += `&search=${encodeURIComponent(search)}`

  const res = await apiGet(url)
  const tbody = document.getElementById('table-fournisseurs')
  const empty = document.getElementById('f-empty')

  if (!res?.success || !res.data?.length) {
    tbody.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }

  empty.classList.add('hidden')
  tbody.innerHTML = res.data.map(f => `
    <tr class="table-row">
      <td class="td-cell font-semibold">${esc(f.nom)}</td>
      <td class="td-cell text-gray-600">${esc(f.contact ?? '—')}</td>
      <td class="td-cell">
        ${f.email ? `<a href="mailto:${esc(f.email)}" class="text-indigo-600 hover:underline">${esc(f.email)}</a>` : '—'}
      </td>
      <td class="td-cell text-gray-600">${esc(f.telephone ?? '—')}</td>
      <td class="td-cell text-center">${f.nb_commandes ?? 0}</td>
      <td class="td-cell text-center">
        ${f.nb_en_attente > 0 ? `<span class="badge-yellow">${f.nb_en_attente}</span>` : '—'}
      </td>
      <td class="td-cell">
        <div class="flex gap-1 justify-end">
          <button onclick="openModalFournisseur(${f.id})" class="btn-xs">
            <i class="fas fa-edit"></i>
          </button>
          <button onclick="deleteFournisseur(${f.id})" class="btn-xs text-red-600">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('')

  // Rafraîchir aussi le cache
  fournisseursList = res.data
}

function openModalFournisseur(id = null) {
  document.getElementById('modal-f-title').textContent = id ? 'Modifier le fournisseur' : 'Nouveau fournisseur'
  document.getElementById('f-id').value                = id ?? ''
  document.getElementById('f-error').classList.add('hidden')

  // Vider les champs
  ;['f-nom','f-contact','f-email','f-telephone','f-adresse','f-site-web','f-notes'].forEach(i => {
    document.getElementById(i).value = ''
  })

  if (id) {
    // Pré-remplir depuis le cache
    const f = fournisseursList.find(x => x.id === id)
    if (f) {
      document.getElementById('f-nom').value       = f.nom       ?? ''
      document.getElementById('f-contact').value   = f.contact   ?? ''
      document.getElementById('f-email').value     = f.email     ?? ''
      document.getElementById('f-telephone').value = f.telephone ?? ''
      document.getElementById('f-adresse').value   = f.adresse   ?? ''
      document.getElementById('f-site-web').value  = f.site_web  ?? ''
      document.getElementById('f-notes').value     = f.notes     ?? ''
    }
  }

  openModal('modal-fournisseur')
}

async function saveFournisseur() {
  const id  = document.getElementById('f-id').value
  const nom = document.getElementById('f-nom').value.trim()

  if (!nom) { showError('f-error', 'Nom obligatoire.'); return }

  const body = {
    boutique_id: boutiqueId,
    nom,
    contact:   document.getElementById('f-contact').value.trim()   || null,
    email:     document.getElementById('f-email').value.trim()     || null,
    telephone: document.getElementById('f-telephone').value.trim() || null,
    adresse:   document.getElementById('f-adresse').value.trim()   || null,
    site_web:  document.getElementById('f-site-web').value.trim()  || null,
    notes:     document.getElementById('f-notes').value.trim()     || null,
  }

  const res = id
    ? await apiPut(`/api/fournisseurs/${id}`, body)
    : await apiPost('/api/fournisseurs', body)

  if (res?.success) {
    closeModal('modal-fournisseur')
    showFlash(id ? 'Fournisseur mis à jour.' : `Fournisseur créé.`, 'success')
    loadFournisseurs(); loadFournisseursCache(); loadKpis()
  } else {
    showError('f-error', res?.error ?? 'Erreur.')
  }
}

async function deleteFournisseur(id) {
  if (!confirm('Désactiver ce fournisseur ?')) return
  const res = await apiDelete(`/api/fournisseurs/${id}`)
  if (res?.success) { showFlash('Fournisseur désactivé.', 'success'); loadFournisseurs(); loadKpis() }
  else showFlash(res?.error ?? 'Erreur.', 'error')
}

// ─── À commander ─────────────────────────────────────────────────────────────
let produitsACommander = []

async function loadACommander() {
  const res = await apiGet(`/api/fournisseurs/a-commander?boutique_id=${boutiqueId}`)
  const tbody = document.getElementById('table-a-commander')
  const empty = document.getElementById('ac-empty')

  if (!res?.success || !res.data?.length) {
    tbody.innerHTML = ''
    empty.classList.remove('hidden')
    document.getElementById('btn-bc-depuis-selection').classList.add('hidden')
    return
  }

  empty.classList.add('hidden')
  produitsACommander = res.data
  tbody.innerHTML = res.data.map(p => `
    <tr class="table-row">
      <td class="td-cell">
        <input type="checkbox" class="check-acommander" data-produit-id="${p.id}"
               onchange="toggleBcDepuisSelection()">
      </td>
      <td class="td-cell">
        <div class="font-medium">${esc(p.nom)}</div>
        ${p.marque ? `<div class="text-xs text-gray-400">${esc(p.marque)}</div>` : ''}
      </td>
      <td class="td-cell">${esc(p.fournisseur_nom ?? '—')}</td>
      <td class="td-cell text-right font-bold ${p.stock_actuel === 0 ? 'text-red-600' : 'text-orange-600'}">${p.stock_actuel}</td>
      <td class="td-cell text-right text-gray-500">${p.stock_minimum}</td>
      <td class="td-cell text-right text-indigo-600 font-medium">${p.quantite_suggere}</td>
      <td class="td-cell text-right">${formatCurrency(p.prix_achat_ht)}</td>
      <td class="td-cell">
        ${p.alerte === 'rupture'
          ? '<span class="badge-red"><i class="fas fa-times-circle mr-1"></i>Rupture</span>'
          : '<span class="badge-yellow"><i class="fas fa-exclamation-triangle mr-1"></i>Stock bas</span>'}
      </td>
    </tr>
  `).join('')
}

function toggleBcDepuisSelection() {
  const nb = document.querySelectorAll('.check-acommander:checked').length
  const btn = document.getElementById('btn-bc-depuis-selection')
  if (nb > 0) { btn.textContent = `Créer BC (${nb} produit${nb > 1 ? 's' : ''})`; btn.classList.remove('hidden') }
  else btn.classList.add('hidden')
}

function bcDepuisSelection() {
  const selected = [...document.querySelectorAll('.check-acommander:checked')]
    .map(cb => parseInt(cb.dataset.produitId, 10))

  const lignes = produitsACommander
    .filter(p => selected.includes(p.id))
    .map(p => ({
      produit_id:    p.id,
      designation:   p.nom + (p.marque ? ` — ${p.marque}` : ''),
      reference:     p.sku ?? null,
      quantite:      p.quantite_suggere,
      prix_achat_ht: p.prix_achat_ht,
      tva_taux:      20
    }))

  // Pré-sélectionner le fournisseur si tous ont le même
  openModalBC(lignes)
  // Changer l'onglet sur bons pour voir la modale en contexte
  document.querySelector('[data-tab="bons"]').click()
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────
function formatCurrency(v) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v ?? 0)
}
function formatDate(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function esc(s) {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}
function showError(elId, msg) {
  const el = document.getElementById(elId)
  if (!el) return
  el.textContent = msg
  el.classList.remove('hidden')
}
