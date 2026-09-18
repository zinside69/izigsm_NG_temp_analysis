/**
 * caisse.js — Module Caisse POS (Sprint 2.12)
 * Exposé sur window.CaisseApp
 *
 * ⚠️ Niveau d'enveloppe — corrigé le 2026-08-02, en dernier des cinq fichiers du § P1
 * (`todo.md`) parce que celui-ci porte de l'argent.
 *
 * `apiGet`/`apiPost` renvoient `{ ok, status, data, error }` où `data` est le corps JSON
 * complet. Les neuf sites lisaient `data.success` sur l'enveloppe — toujours `undefined`.
 * Conséquences mesurées : KPI, journal et clôtures muets, et surtout **une vente
 * réellement enregistrée s'affichait comme un échec** (branche `else` du `if`), ce qui
 * invite l'exploitant à la ressaisir — un doublon de facture, avec chaînage NF525.
 *
 * Les lectures conservent `?.` : sur une réponse non-JSON (500 HTML), le corps est `null`,
 * et il ne faut ni lever ni afficher un succès. Un succès ne s'affiche que si le corps
 * lui-même porte `success: true`.
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
 *   debouncedSearchProduit()→ cherche produits, services, dossiers SAV (tickets 02-03 `vente-lit-catalogue`)
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
    lignes:       [],              // [{produit_id?, service_id?, designation, quantite, prix_unitaire_ht, tva_taux, remise_pct}]
    mode:         'especes',
    clientId:     null,
    clientNom:    '',
    factureId:    null,            // pour modal encaissement
    clientTimer:  null,
    factureTimer: null,
    produitTimer: null,
    produits:     new Map(),       // id → produit des derniers résultats de recherche catalogue
    services:     new Map(),       // id → service des derniers résultats de recherche catalogue
    ligneIdx:     0,
  }

  // ── Toast ───────────────────────────────────────────────────────────────────

  function toast(msg, type = 'success', dureeMs = 3500) {
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
    el._t = setTimeout(() => el.classList.add('hidden'), dureeMs)
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
    // La page réservait déjà la place de la barre (`ml-64`) et portait un conteneur, mais
    // n'appelait jamais le socle : l'exploitant perdait toute navigation en entrant ici.
    buildSidebar('caisse')

    // Un admin plateforme ne peut inscrire aucune pièce au registre légal d'une boutique
    // (ticket 004, ADR 0002) : `createVente()` refuse côté serveur, l'écran cesse donc
    // d'offrir la vente. Masqué plutôt que désactivé : un bouton grisé invite à chercher
    // comment l'activer, alors qu'il n'y a rien à activer.
    if (isAdminPlateforme()) {
      const btnVente = document.getElementById('btn-nouvelle-vente')
      if (btnVente) btnVente.remove()
    }

    // Date par défaut = aujourd'hui
    const today = new Date().toISOString().slice(0, 10)
    const fd = document.getElementById('filtre-date-journal')
    if (fd) fd.value = today

    const id = document.getElementById('integrite-debut')
    const if2 = document.getElementById('integrite-fin')
    if (id) id.value = today
    if (if2) if2.value = today

    // Résultats de recherche catalogue : un seul écouteur, l'identifiant est lu sur le bouton.
    // Pas d'arguments dans un `onclick` en ligne : un nom de produit est une saisie utilisateur.
    document.getElementById('vente-produit-results')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-produit-id], [data-service-id], [data-sav-id]')
      if (!btn) return
      if (btn.dataset.produitId) {
        const p = state.produits.get(Number(btn.dataset.produitId))
        if (p) ajouterLigneCatalogue({ produit_id: p.id }, p.nom, p.prix_vente_ht, p.tva_taux)
      } else if (btn.dataset.serviceId) {
        const s = state.services.get(Number(btn.dataset.serviceId))
        if (s) ajouterLigneCatalogue({ service_id: s.id }, s.nom, s.prix_ht, s.tva_taux)
      } else {
        // Un dossier SAV s'ouvre dans sa page ; le panier n'est pas touché (récit 7)
        window.location.href = `/sav?dossier=${Number(btn.dataset.savId)}`
      }
    })

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
      const data = (await apiGet('/api/caisse/kpis')).data
      if (!data?.success) return
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
      const data = (await apiGet(`/api/caisse/journal?date=${date}`)).data
      if (!data?.success) return

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
      const data = (await apiGet('/api/caisse/clotures')).data
      if (!data?.success) return
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
      const data = (await apiPost('/api/caisse/cloture', date ? { date } : {})).data
      if (data?.success) {
        toast(`Journée ${data.data.date_cloture} clôturée — ${data.data.nb_transactions} transaction(s)`, 'success')
        refreshKpis()
        refreshJournal()
      } else {
        toast(data?.error || 'Erreur clôture', 'error')
      }
    } catch (e) {
      toast(e.message || 'Erreur serveur', 'error')
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

      const data = (await apiGet(url)).data
      if (!data?.success) {
        zone.innerHTML = `<div class="text-red-600 text-sm">${esc(data?.error ?? 'Erreur de vérification.')}</div>`
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
      zone.innerHTML = `<div class="text-red-600 text-sm">${e.message || 'Erreur serveur'}</div>`
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
    clearEl('vente-produit-search')
    hideEl('vente-produit-results')
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
    // Prix d'une ligne du catalogue : la mise en évidence suit la saisie, sans re-rendu
    // (un re-rendu ferait perdre le focus du champ en cours de frappe)
    if (field === 'prix_unitaire_ht') {
      const champ = document.querySelector(`[data-field="prix_unitaire_ht"][data-idx="${idx}"]`)
      if (champ) champ.dataset.prixManquant = prixManquant(ligne) ? '1' : '0'
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
               data-field="quantite" data-idx="${l.idx}"
               type="number" min="0.01" step="0.01" value="${l.quantite}"
               oninput="CaisseApp._updateLigne(${l.idx},'quantite',this.value)">
        <input class="col-span-2 input-field text-xs py-1.5 px-2 text-right"
               data-field="prix_unitaire_ht" data-idx="${l.idx}"
               data-prix-manquant="${prixManquant(l) ? '1' : '0'}"
               type="number" min="0" step="0.01" value="${l.prix_unitaire_ht}"
               oninput="CaisseApp._updateLigne(${l.idx},'prix_unitaire_ht',this.value)">
        <select class="col-span-1 input-field text-xs py-1.5 px-1"
                data-field="tva_taux" data-idx="${l.idx}"
                onchange="CaisseApp._updateLigne(${l.idx},'tva_taux',this.value)">
          ${[0,5.5,10,20].map(t => `<option value="${t}" ${t===l.tva_taux?'selected':''}>${t}%</option>`).join('')}
        </select>
        <input class="col-span-1 input-field text-xs py-1.5 px-1 text-center"
               data-field="remise_pct" data-idx="${l.idx}"
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

  // ── Recherche produit (catalogue) ────────────────────────────────────────────

  /**
   * Vrai pour une ligne venue du catalogue dont le prix est encore à 0 € : la validation est
   * bloquée à l'écran tant qu'un prix n'est pas saisi. Le serveur, lui, garde « prix ≥ 0 » —
   * une ligne gratuite reste légitime ailleurs (spec, décision « Vente en caisse »).
   */
  function prixManquant(ligne) {
    return !!(ligne.produit_id || ligne.service_id) && !(ligne.prix_unitaire_ht > 0)
  }

  function debouncedSearchProduit() {
    clearTimeout(state.produitTimer)
    state.produitTimer = setTimeout(searchProduit, 250)
  }

  async function searchProduit() {
    const q = document.getElementById('vente-produit-search')?.value?.trim()
    const results = document.getElementById('vente-produit-results')
    if (!results) return
    if (!q || q.length < 2) { results.classList.add('hidden'); return }

    try {
      const res = (await apiGet(`/api/catalogue/recherche?q=${encodeURIComponent(q)}`)).data
      // Une saisie plus récente a pu partir entre-temps : ne pas afficher une réponse périmée
      if (document.getElementById('vente-produit-search')?.value?.trim() !== q) return
      if (!res?.success) { results.classList.add('hidden'); return }

      const parType = (type) => new Map(res.data.filter(r => r.type === type).map(r => [r.id, r]))
      state.produits = parType('produit')
      state.services = parType('service')
      results.classList.remove('hidden')
      results.innerHTML = res.data.length === 0
        ? `<div class="px-3 py-2 text-sm text-gray-500">Aucun résultat.</div>`
        : res.data.map(renderResultatCatalogue).join('')
    } catch {
      // Réseau coupé : `api()` ne rattrape pas le rejet de `fetch` (`CLAUDE.md` § Enveloppe)
      results.classList.remove('hidden')
      results.innerHTML = `<div class="px-3 py-2 text-sm text-red-600">Recherche impossible (connexion).</div>`
    }
  }

  /** Nature de chaque résultat, affichée : une coque et une pose de film peuvent porter le même mot. */
  const NATURE_RESULTAT = {
    produit: { libelle: 'Produit', classe: 'bg-blue-100 text-blue-700' },
    service: { libelle: 'Service', classe: 'bg-green-100 text-green-700' },
    sav:     { libelle: 'Dossier SAV', classe: 'bg-orange-100 text-orange-700' },
  }

  /** Libellés des statuts de dossier SAV (mêmes que `labelStatutSav()` de `sav.js`). */
  const STATUT_SAV = {
    ouvert: 'Ouvert', en_traitement: 'En traitement', resolu: 'Résolu', refuse: 'Refusé', clos: 'Clos',
  }

  /** Un résultat de `/api/catalogue/recherche` en bouton ; toute donnée d'API est échappée. */
  function renderResultatCatalogue(r) {
    const nature = NATURE_RESULTAT[r.type]
    if (!nature) return ''
    const badge = `<span class="text-xs px-1.5 py-0.5 rounded ${nature.classe} mr-2" data-nature="${r.type}">${nature.libelle}</span>`
    const [attribut, titre, detail, droite] =
      r.type === 'produit' ? ['data-produit-id', r.nom, r.sku, `${eur(r.prix_vente_ht)} HT · stock ${Number(r.stock_actuel)}`]
      : r.type === 'service' ? ['data-service-id', r.nom, r.reference, `${eur(r.prix_ht)} HT`]
      : ['data-sav-id', r.numero, r.client, `${esc(STATUT_SAV[r.statut] ?? r.statut)} · ouvrir`]
    return `
          <button type="button" ${attribut}="${Number(r.id)}"
                  class="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-0 flex justify-between gap-2">
            <span>
              ${badge}<span class="font-medium">${esc(titre)}</span>
              ${detail ? `<span class="text-gray-500 ml-2 text-xs">${esc(detail)}</span>` : ''}
            </span>
            <span class="text-xs text-gray-600 whitespace-nowrap">${droite}</span>
          </button>`
  }

  /**
   * Ajoute une ligne préremplie depuis le catalogue ; chaque champ reste modifiable.
   * `lien` porte `produit_id` ou `service_id` : il part avec la vente (récit 20).
   */
  function ajouterLigneCatalogue(lien, nom, prixHt, tvaTaux) {
    state.lignes.push({
      idx:              state.ligneIdx++,
      ...lien,
      designation:      nom,
      quantite:         1,
      prix_unitaire_ht: Number(prixHt) || 0,
      tva_taux:         Number(tvaTaux),
      remise_pct:       0,
    })
    clearEl('vente-produit-search')
    hideEl('vente-produit-results')
    renderLignes()
    updateTotaux()
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
      const data = (await apiGet(`/api/clients?search=${encodeURIComponent(q)}&limit=5`)).data
      if (!data?.success || !data.data?.length) { if (results) results.classList.add('hidden'); return }

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
      if (prixManquant(l)) {
        toast(`Saisissez le prix de « ${esc(l.designation)} » avant de valider.`, 'warn')
        document.querySelector(`[data-field="prix_unitaire_ht"][data-idx="${l.idx}"]`)?.focus()
        return
      }
    }

    const btn = document.getElementById('btn-submit-vente')
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Enregistrement…' }

    const montantRemis = parseFloat(document.getElementById('montant-remis')?.value || '0') || undefined
    const note = document.getElementById('vente-note')?.value?.trim() || undefined

    const payload = {
      client_id:      state.clientId || undefined,
      lignes:         state.lignes.map(l => ({
        produit_id:        l.produit_id || undefined,
        service_id:        l.service_id || undefined,
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
      const data = (await apiPost('/api/caisse/vente', payload)).data
      if (data?.success) {
        const rendu = data.data.rendu_monnaie
        let msg = `Vente ${data.data.facture.numero} enregistrée.`
        if (rendu && rendu > 0) msg += ` Rendu : ${eur(rendu)}`
        // Stock insuffisant : la vente est passée, le stock a été ramené à 0 — le dire
        const manques = data.data.stock_insuffisant || []
        if (manques.length) {
          const detail = manques
            .map(m => `« ${esc(m.designation)} » (stock ${Number(m.stock_avant)}, vendu ${Number(m.quantite)})`)
            .join(', ')
          toast(`${esc(msg)} Stock insuffisant : ${detail} — stock ramené à 0.`, 'warn', 10000)
        } else {
          toast(msg, 'success')
        }
        closeModal()
        refreshKpis()
        refreshJournal()
      } else {
        toast(data?.error || 'Erreur', 'error')
      }
    } catch (e) {
      toast(e.message || 'Erreur serveur', 'error')
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
      const data = (await apiGet(`/api/factures?search=${encodeURIComponent(q)}&limit=1`)).data
      if (!data?.success || !data.data?.length) {
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
      const data = (await apiPost('/api/caisse/encaissement', { facture_id: state.factureId, mode_paiement: mode })).data
      if (data?.success) {
        toast(`Encaissement ${data.data.reference_numero} enregistré.`, 'success')
        closeModalEnc()
        refreshKpis()
        refreshJournal()
      } else {
        toast(data?.error || 'Erreur', 'error')
      }
    } catch (e) {
      toast(e.message || 'Erreur serveur', 'error')
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
    debouncedSearchProduit,
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
