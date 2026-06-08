/**
 * caisse.js — Module Caisse POS (Sprint 2.12)
 * Exposé sur window.CaisseApp
 *
 * Fonctions publiques :
 *   init()                 → initialise la page
 *   switchTab(tab)         → journal | clotures | integrite
 *   refreshKpis()          → recharge KPIs
 *   refreshJournal()       → recharge journal du jour
 *   openNouvelleVente()    → ouvre le modal de vente
 *   ajouterLigne()         → ajoute une ligne dans le panier
 *   supprimerLigne(idx)    → supprime une ligne
 *   calcRendu()            → calcule le rendu monnaie
 *   selectMode(mode)       → sélectionne le mode paiement
 *   submitVente()          → soumet la vente à l'API
 *   debouncedSearchClient()→ cherche un client
 *   clearClient()          → efface la sélection client
 *   cloturerJournee()      → POST /api/caisse/cloture
 *   verifierIntegrite()    → GET /api/caisse/integrite
 *   closeModal()           → ferme modal vente
 *   closeModalEnc()        → ferme modal encaissement
 */

;(function () {
  'use strict'

  // ── État interne ────────────────────────────────────────────────────────────

  const state = {
    tab:          'journal',
    lignes:       [],              // [{designation, quantite, prix_unitaire_ht, tva_taux, remise_pct}]
    mode:         'especes',
    clientId:     null,
    clientNom:    '',
    factureId:    null,            // pour modal encaissement
    clientTimer:  null,
    factureTimer: null,
    ligneIdx:     0,
  }

  // ── Helpers auth ────────────────────────────────────────────────────────────

  function token() {
    return localStorage.getItem('access_token') || ''
  }

  function headers() {
    return { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }
  }

  function boutique() {
    try {
      const p = JSON.parse(atob(token().split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
      return p.boutique_id
    } catch { return null }
  }

  // ── Toast ───────────────────────────────────────────────────────────────────

  function toast(msg, type = 'success') {
    const el = document.getElementById('toast')
    const inner = document.getElementById('toast-inner')
    if (!el || !inner) return
    const styles = {
      success: 'bg-green-600 text-white',
      error:   'bg-red-600 text-white',
      info:    'bg-blue-600 text-white',
      warn:    'bg-orange-500 text-white',
    }
    inner.className = `px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 max-w-sm ${styles[type] || styles.info}`
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' }
    inner.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`
    el.classList.remove('hidden')
    clearTimeout(el._t)
    el._t = setTimeout(() => el.classList.add('hidden'), 3500)
  }

  // ── Format monnaie ──────────────────────────────────────────────────────────

  function eur(val) {
    return Number(val || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  function isoToDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('fr-FR')
  }

  function isoToTime(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    // Date par défaut = aujourd'hui
    const today = new Date().toISOString().slice(0, 10)
    const fd = document.getElementById('filtre-date-journal')
    if (fd) fd.value = today

    const id = document.getElementById('integrite-debut')
    const if2 = document.getElementById('integrite-fin')
    if (id) id.value = today
    if (if2) if2.value = today

    refreshKpis()
    refreshJournal()
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────

  function switchTab(tab) {
    state.tab = tab
    ;['journal', 'clotures', 'integrite'].forEach(t => {
      const sec = document.getElementById(`tab-${t}`)
      const btn = document.getElementById(`tab-btn-${t}`)
      if (sec) sec.classList.toggle('hidden', t !== tab)
      if (btn) {
        btn.classList.toggle('active', t === tab)
        if (t === tab) btn.classList.add('active')
        else btn.classList.remove('active')
      }
    })
    if (tab === 'clotures') refreshClotures()
  }

  // ── KPIs ────────────────────────────────────────────────────────────────────

  async function refreshKpis() {
    try {
      const { data } = await axios.get('/api/caisse/kpis', { headers: headers() })
      if (!data.success) return
      const d = data.data

      setEl('kpi-nb-tx',       d.today.nb_transactions)
      setEl('kpi-ca-jour',     eur(d.today.total_ttc))
      setEl('kpi-ca-mois',     eur(d.mois.total_ttc))

      const statut = d.today.est_cloture
        ? '<span class="text-green-600 font-semibold"><i class="fas fa-check-circle mr-1"></i>Clôturée</span>'
        : '<span class="text-orange-500 font-semibold"><i class="fas fa-circle mr-1 text-xs"></i>Ouverte</span>'
      setElHtml('kpi-statut-journee', statut)
    } catch (e) {
      console.error('KPIs caisse:', e)
    }
  }

  // ── Journal ─────────────────────────────────────────────────────────────────

  async function refreshJournal() {
    const date = document.getElementById('filtre-date-journal')?.value || new Date().toISOString().slice(0, 10)

    try {
      const { data } = await axios.get(`/api/caisse/journal?date=${date}`, { headers: headers() })
      if (!data.success) return

      const d = data.data
      const list = document.getElementById('journal-list')
      const totauxZone = document.getElementById('totaux-jour')
      const clotBadge = document.getElementById('journal-cloture-badge')
      const btnClot = document.getElementById('btn-cloture')

      // Totaux
      if (totauxZone) {
        totauxZone.classList.toggle('hidden', d.transactions.length === 0)
        setEl('total-ht-jour',  eur(d.totaux.total_ht))
        setEl('total-tva-jour', eur(d.totaux.total_tva))
        setEl('total-ttc-jour', eur(d.totaux.total_ttc))
      }

      // Badge clôture + bouton
      const today = new Date().toISOString().slice(0, 10)
      const isToday = date === today

      if (clotBadge) clotBadge.classList.toggle('hidden', !d.est_cloture)
      if (btnClot) {
        const canClose = isToday && !d.est_cloture && d.transactions.length > 0
        btnClot.classList.toggle('hidden', !canClose)
      }

      // Lignes
      if (!list) return
      if (d.transactions.length === 0) {
        list.innerHTML = `
          <div class="px-4 py-8 text-center text-gray-400 text-sm">
            <i class="fas fa-receipt text-2xl mb-2 block"></i>
            Aucune transaction pour le ${isoToDate(date + 'T00:00:00')}
          </div>`
        return
      }

      list.innerHTML = d.transactions.map(t => `
        <div class="journal-row">
          <span class="text-gray-500 tabular-nums">${isoToTime(t.date_transaction)}</span>
          <span><span class="badge-type badge-${t.type_transaction}">${t.type_transaction}</span></span>
          <span class="font-medium text-gray-800">${esc(t.reference_numero)}</span>
          <span class="text-gray-500 truncate">${t.caissier_nom ? esc(t.caissier_nom) : '—'}</span>
          <span class="text-right text-gray-600 tabular-nums">${eur(t.montant_ht)}</span>
          <span class="text-right font-semibold text-gray-800 tabular-nums">${eur(t.montant_ttc)}</span>
        </div>
      `).join('')

    } catch (e) {
      console.error('Journal caisse:', e)
    }
  }

  // ── Clôtures ────────────────────────────────────────────────────────────────

  async function refreshClotures() {
    try {
      const { data } = await axios.get('/api/caisse/clotures', { headers: headers() })
      if (!data.success) return
      const list = document.getElementById('clotures-list')
      if (!list) return

      if (!data.data.length) {
        list.innerHTML = `<div class="px-4 py-8 text-center text-gray-400 text-sm">
          <i class="fas fa-lock text-2xl mb-2 block"></i>Aucune clôture enregistrée</div>`
        return
      }

      list.innerHTML = data.data.map(c => `
        <div class="grid grid-cols-6 gap-2 px-4 py-2.5 border-b border-gray-50 text-sm hover:bg-gray-50">
          <span class="font-medium text-gray-800">${c.date_cloture}</span>
          <span class="text-center text-gray-600">${c.nb_transactions}</span>
          <span class="text-right text-gray-600 tabular-nums">${eur(c.total_ht)}</span>
          <span class="text-right text-orange-600 tabular-nums">${eur(c.total_tva)}</span>
          <span class="text-right font-semibold text-gray-800 tabular-nums">${eur(c.total_ttc)}</span>
          <span class="text-center text-gray-500 text-xs truncate">${c.caissier_nom || '—'}</span>
        </div>
      `).join('')
    } catch (e) {
      console.error('Clôtures:', e)
    }
  }

  // ── Clôturer la journée ──────────────────────────────────────────────────────

  async function cloturerJournee() {
    const date = document.getElementById('filtre-date-journal')?.value
    if (!confirm(`Clôturer définitivement la journée du ${date} ? Cette action est irréversible.`)) return

    try {
      const { data } = await axios.post('/api/caisse/cloture',
        date ? { date } : {},
        { headers: headers() }
      )
      if (data.success) {
        toast(`Journée ${data.data.date_cloture} clôturée — ${data.data.nb_transactions} transaction(s)`, 'success')
        refreshKpis()
        refreshJournal()
      } else {
        toast(data.error || 'Erreur clôture', 'error')
      }
    } catch (e) {
      toast(e.response?.data?.error || 'Erreur serveur', 'error')
    }
  }

  // ── Intégrité NF525 ─────────────────────────────────────────────────────────

  async function verifierIntegrite() {
    const debut = document.getElementById('integrite-debut')?.value
    const fin   = document.getElementById('integrite-fin')?.value
    const zone  = document.getElementById('integrite-result')
    if (!zone) return

    zone.classList.remove('hidden')
    zone.innerHTML = `<div class="text-gray-500 text-sm animate-pulse"><i class="fas fa-spinner fa-spin mr-2"></i>Vérification en cours…</div>`

    try {
      let url = '/api/caisse/integrite?'
      if (debut) url += `date_debut=${debut}&`
      if (fin)   url += `date_fin=${fin}&`

      const { data } = await axios.get(url, { headers: headers() })
      if (!data.success) {
        zone.innerHTML = `<div class="text-red-600 text-sm">${esc(data.error)}</div>`
        return
      }

      const d = data.data
      if (d.integre) {
        zone.innerHTML = `
          <div class="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
            <i class="fas fa-shield-alt text-green-600 text-2xl"></i>
            <div>
              <div class="font-semibold text-green-700">Chaîne NF525 intègre</div>
              <div class="text-sm text-green-600 mt-0.5">Aucune anomalie détectée sur la période sélectionnée.</div>
            </div>
          </div>`
      } else {
        const rows = d.anomalies.map(a => `
          <tr class="border-b border-red-100">
            <td class="py-1.5 px-2 text-sm text-gray-700">#${a.id}</td>
            <td class="py-1.5 px-2 text-sm font-medium text-red-700">${esc(a.reference_numero)}</td>
            <td class="py-1.5 px-2 text-xs text-red-600 font-mono">${esc(a.details)}</td>
          </tr>`).join('')

        zone.innerHTML = `
          <div class="p-4 bg-red-50 border border-red-200 rounded-xl">
            <div class="flex items-center gap-2 mb-3">
              <i class="fas fa-exclamation-triangle text-red-600 text-lg"></i>
              <span class="font-semibold text-red-700">${d.anomalies.length} anomalie(s) détectée(s)</span>
            </div>
            <table class="w-full">
              <thead><tr class="text-xs font-medium text-red-600 uppercase">
                <th class="text-left py-1 px-2">ID</th>
                <th class="text-left py-1 px-2">Référence</th>
                <th class="text-left py-1 px-2">Détail</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`
      }
    } catch (e) {
      zone.innerHTML = `<div class="text-red-600 text-sm">${e.response?.data?.error || 'Erreur serveur'}</div>`
    }
  }

  // ── Modal Vente POS ─────────────────────────────────────────────────────────

  function openNouvelleVente() {
    // Reset état
    state.lignes   = []
    state.clientId = null
    state.clientNom = ''
    state.mode     = 'especes'
    state.ligneIdx = 0

    clearEl('vente-client-search')
    clearEl('vente-note')
    clearEl('montant-remis')
    hideEl('vente-client-results')
    hideEl('vente-client-selected')
    setEl('rendu-montant', '0,00 €')

    selectMode('especes')
    renderLignes()
    updateTotaux()
    showEl('modal-vente')
    document.getElementById('modal-vente')?.classList.remove('hidden')
  }

  function closeModal() {
    document.getElementById('modal-vente')?.classList.add('hidden')
  }

  function closeModalEnc() {
    document.getElementById('modal-encaissement')?.classList.add('hidden')
  }

  // ── Lignes du panier ─────────────────────────────────────────────────────────

  function ajouterLigne() {
    state.lignes.push({
      idx:             state.ligneIdx++,
      designation:     '',
      quantite:        1,
      prix_unitaire_ht: 0,
      tva_taux:        20,
      remise_pct:      0,
    })
    renderLignes()
    // Focus sur la désignation de la nouvelle ligne
    setTimeout(() => {
      const inputs = document.querySelectorAll('[data-field="designation"]')
      const last = inputs[inputs.length - 1]
      if (last) last.focus()
    }, 50)
  }

  function supprimerLigne(idx) {
    state.lignes = state.lignes.filter(l => l.idx !== idx)
    renderLignes()
    updateTotaux()
  }

  function updateLigne(idx, field, value) {
    const ligne = state.lignes.find(l => l.idx === idx)
    if (!ligne) return
    if (['quantite', 'prix_unitaire_ht', 'tva_taux', 'remise_pct'].includes(field)) {
      ligne[field] = parseFloat(value) || 0
    } else {
      ligne[field] = value
    }
    // Mettre à jour le total de la ligne en temps réel
    updateLigneTotaux(idx)
    updateTotaux()
  }

  function updateLigneTotaux(idx) {
    const ligne = state.lignes.find(l => l.idx === idx)
    if (!ligne) return
    const ht  = ligne.quantite * ligne.prix_unitaire_ht * (1 - ligne.remise_pct / 100)
    const ttc = ht * (1 + ligne.tva_taux / 100)
    const el  = document.querySelector(`[data-ligne-ttc="${idx}"]`)
    if (el) el.textContent = eur(ttc)
  }

  function renderLignes() {
    const container = document.getElementById('lignes-container')
    if (!container) return

    if (state.lignes.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">
          <i class="fas fa-shopping-cart mb-1 block text-lg"></i>
          Aucun article — cliquez "Ajouter une ligne"
        </div>`
      return
    }

    container.innerHTML = state.lignes.map(l => {
      const ht  = l.quantite * l.prix_unitaire_ht * (1 - l.remise_pct / 100)
      const ttc = ht * (1 + l.tva_taux / 100)
      return `
      <div class="grid grid-cols-12 gap-1 items-center linha-row" data-idx="${l.idx}">
        <input class="col-span-4 input-field text-xs py-1.5 px-2"
               data-field="designation" data-idx="${l.idx}"
               value="${esc(l.designation)}" placeholder="Désignation…"
               oninput="CaisseApp._updateLigne(${l.idx},'designation',this.value)">
        <input class="col-span-2 input-field text-xs py-1.5 px-2 text-center"
               type="number" min="0.01" step="0.01" value="${l.quantite}"
               oninput="CaisseApp._updateLigne(${l.idx},'quantite',this.value)">
        <input class="col-span-2 input-field text-xs py-1.5 px-2 text-right"
               type="number" min="0" step="0.01" value="${l.prix_unitaire_ht}"
               oninput="CaisseApp._updateLigne(${l.idx},'prix_unitaire_ht',this.value)">
        <select class="col-span-1 input-field text-xs py-1.5 px-1"
                onchange="CaisseApp._updateLigne(${l.idx},'tva_taux',this.value)">
          ${[0,5.5,10,20].map(t => `<option value="${t}" ${t===l.tva_taux?'selected':''}>${t}%</option>`).join('')}
        </select>
        <input class="col-span-1 input-field text-xs py-1.5 px-1 text-center"
               type="number" min="0" max="100" step="1" value="${l.remise_pct}"
               oninput="CaisseApp._updateLigne(${l.idx},'remise_pct',this.value)">
        <span class="col-span-1 text-right text-xs font-semibold text-gray-700 tabular-nums"
              data-ligne-ttc="${l.idx}">${eur(ttc)}</span>
        <button class="col-span-1 text-gray-400 hover:text-red-500 text-center"
                onclick="CaisseApp.supprimerLigne(${l.idx})">
          <i class="fas fa-trash-alt text-xs"></i>
        </button>
      </div>`
    }).join('')
  }

  // ── Totaux ──────────────────────────────────────────────────────────────────

  function updateTotaux() {
    let ht = 0, tva = 0

    for (const l of state.lignes) {
      const ligneHt  = l.quantite * l.prix_unitaire_ht * (1 - l.remise_pct / 100)
      const ligneTva = ligneHt * (l.tva_taux / 100)
      ht  += ligneHt
      tva += ligneTva
    }

    const ttc = ht + tva
    ht  = Math.round(ht  * 100) / 100
    tva = Math.round(tva * 100) / 100
    const ttcR = Math.round(ttc * 100) / 100

    setEl('total-ht-vente',  eur(ht))
    setEl('total-tva-vente', eur(tva))
    setEl('total-ttc-vente', eur(ttcR))

    calcRendu()
  }

  // ── Mode paiement ────────────────────────────────────────────────────────────

  function selectMode(mode) {
    state.mode = mode
    document.querySelectorAll('.btn-mode').forEach(btn => {
      const isActive = btn.dataset.mode === mode
      btn.classList.toggle('active', isActive)
      if (isActive) {
        btn.classList.add('border-blue-500', 'bg-blue-50')
        btn.classList.remove('border-gray-200')
      } else {
        btn.classList.remove('border-blue-500', 'bg-blue-50')
        btn.classList.add('border-gray-200')
      }
    })

    // Afficher rendu monnaie uniquement si espèces ou mixte
    const zone = document.getElementById('rendu-monnaie-zone')
    if (zone) zone.classList.toggle('hidden', mode === 'cb' || mode === 'virement' || mode === 'cheque')
  }

  function calcRendu() {
    const ttcStr = document.getElementById('total-ttc-vente')?.textContent || '0'
    const ttc = parseFloat(ttcStr.replace(/[^\d,.-]/g, '').replace(',', '.')) || 0
    const remis = parseFloat(document.getElementById('montant-remis')?.value || '0') || 0
    const rendu = Math.max(0, Math.round((remis - ttc) * 100) / 100)
    setEl('rendu-montant', eur(rendu))
    const el = document.getElementById('rendu-montant')
    if (el) el.className = `ml-2 text-xl font-bold ${rendu > 0 ? 'text-green-600' : 'text-gray-400'}`
  }

  // ── Recherche client ─────────────────────────────────────────────────────────

  function debouncedSearchClient() {
    clearTimeout(state.clientTimer)
    state.clientTimer = setTimeout(searchClient, 300)
  }

  async function searchClient() {
    const q = document.getElementById('vente-client-search')?.value?.trim()
    const results = document.getElementById('vente-client-results')
    if (!q || q.length < 2) { if (results) results.classList.add('hidden'); return }

    try {
      const { data } = await axios.get(`/api/clients?search=${encodeURIComponent(q)}&limit=5`, { headers: headers() })
      if (!data.success || !data.data?.length) { if (results) results.classList.add('hidden'); return }

      if (results) {
        results.classList.remove('hidden')
        results.innerHTML = data.data.map(c => `
          <button class="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-0"
                  onclick="CaisseApp._selectClient(${c.id},'${esc(c.prenom)} ${esc(c.nom)}','${esc(c.telephone||'')}')">
            <span class="font-medium">${esc(c.prenom)} ${esc(c.nom)}</span>
            ${c.telephone ? `<span class="text-gray-500 ml-2 text-xs">${esc(c.telephone)}</span>` : ''}
          </button>`).join('')
      }
    } catch { if (results) results.classList.add('hidden') }
  }

  function _selectClient(id, nom, tel) {
    state.clientId  = id
    state.clientNom = nom
    hideEl('vente-client-results')
    setEl('vente-client-nom', nom + (tel ? ` · ${tel}` : ''))
    showEl('vente-client-selected')
    clearEl('vente-client-search')
  }

  function clearClient() {
    state.clientId  = null
    state.clientNom = ''
    clearEl('vente-client-search')
    hideEl('vente-client-results')
    hideEl('vente-client-selected')
  }

  // ── Submit vente ─────────────────────────────────────────────────────────────

  async function submitVente() {
    if (state.lignes.length === 0) { toast('Ajoutez au moins une ligne.', 'warn'); return }

    // Valider chaque ligne
    for (const l of state.lignes) {
      if (!l.designation.trim()) { toast('Chaque ligne doit avoir une désignation.', 'warn'); return }
      if (l.quantite <= 0)        { toast('Quantité invalide (doit être > 0).', 'warn'); return }
    }

    const btn = document.getElementById('btn-submit-vente')
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Enregistrement…' }

    const montantRemis = parseFloat(document.getElementById('montant-remis')?.value || '0') || undefined
    const note = document.getElementById('vente-note')?.value?.trim() || undefined

    const payload = {
      client_id:      state.clientId || undefined,
      lignes:         state.lignes.map(l => ({
        designation:       l.designation,
        quantite:          l.quantite,
        prix_unitaire_ht:  l.prix_unitaire_ht,
        tva_taux:          l.tva_taux,
        remise_pct:        l.remise_pct || 0,
      })),
      mode_paiement:  state.mode,
      montant_especes: (state.mode === 'especes' || state.mode === 'mixte') ? montantRemis : undefined,
      note,
    }

    try {
      const { data } = await axios.post('/api/caisse/vente', payload, { headers: headers() })
      if (data.success) {
        const rendu = data.data.rendu_monnaie
        let msg = `Vente ${data.data.facture.numero} enregistrée.`
        if (rendu && rendu > 0) msg += ` Rendu : ${eur(rendu)}`
        toast(msg, 'success')
        closeModal()
        refreshKpis()
        refreshJournal()
      } else {
        toast(data.error || 'Erreur', 'error')
      }
    } catch (e) {
      toast(e.response?.data?.error || 'Erreur serveur', 'error')
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check mr-2"></i>Valider la vente' }
    }
  }

  // ── Encaissement (facture existante) ─────────────────────────────────────────

  function debouncedSearchFacture() {
    clearTimeout(state.factureTimer)
    state.factureTimer = setTimeout(searchFacture, 400)
  }

  async function searchFacture() {
    const q = document.getElementById('enc-facture-search')?.value?.trim()
    const result = document.getElementById('enc-facture-result')
    if (!q || q.length < 3) { if (result) result.classList.add('hidden'); return }

    try {
      const { data } = await axios.get(`/api/factures?search=${encodeURIComponent(q)}&limit=1`, { headers: headers() })
      if (!data.success || !data.data?.length) {
        if (result) { result.classList.remove('hidden'); result.innerHTML = '<span class="text-red-500">Facture introuvable.</span>' }
        state.factureId = null
        return
      }
      const f = data.data[0]
      state.factureId = f.id
      if (result) {
        result.classList.remove('hidden')
        result.innerHTML = `
          <div class="flex justify-between items-center">
            <div>
              <div class="font-medium text-gray-800">${esc(f.numero)}</div>
              <div class="text-xs text-gray-500">Statut : ${f.statut}</div>
            </div>
            <div class="text-right">
              <div class="font-bold text-blue-600">${eur(f.total_ttc)}</div>
              <div class="text-xs text-gray-500">TTC</div>
            </div>
          </div>`
      }
    } catch { state.factureId = null }
  }

  async function submitEncaissement() {
    if (!state.factureId) { toast('Recherchez d\'abord une facture.', 'warn'); return }
    const mode = document.getElementById('enc-mode-paiement')?.value || 'especes'

    try {
      const { data } = await axios.post('/api/caisse/encaissement',
        { facture_id: state.factureId, mode_paiement: mode },
        { headers: headers() }
      )
      if (data.success) {
        toast(`Encaissement ${data.data.reference_numero} enregistré.`, 'success')
        closeModalEnc()
        refreshKpis()
        refreshJournal()
      } else {
        toast(data.error || 'Erreur', 'error')
      }
    } catch (e) {
      toast(e.response?.data?.error || 'Erreur serveur', 'error')
    }
  }

  // ── Utilitaires DOM ──────────────────────────────────────────────────────────

  function setEl(id, val) {
    const el = document.getElementById(id)
    if (el) el.textContent = val
  }
  function setElHtml(id, html) {
    const el = document.getElementById(id)
    if (el) el.innerHTML = html
  }
  function clearEl(id) {
    const el = document.getElementById(id)
    if (el) el.value = ''
  }
  function showEl(id) {
    const el = document.getElementById(id)
    if (el) el.classList.remove('hidden')
  }
  function hideEl(id) {
    const el = document.getElementById(id)
    if (el) el.classList.add('hidden')
  }
  function esc(s) {
    if (s == null) return ''
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  }

  // ── API publique ─────────────────────────────────────────────────────────────

  window.CaisseApp = {
    init,
    switchTab,
    refreshKpis,
    refreshJournal,
    openNouvelleVente,
    ajouterLigne,
    supprimerLigne,
    calcRendu,
    selectMode,
    submitVente,
    debouncedSearchClient,
    clearClient,
    debouncedSearchFacture,
    submitEncaissement,
    cloturerJournee,
    verifierIntegrite,
    closeModal,
    closeModalEnc,
    // Fonctions internes exposées pour les handlers inline
    _updateLigne:   updateLigne,
    _selectClient:  _selectClient,
  }

})()
