/**
 * dashboard.js — Module DashApp
 * Sprint 2.13 — Dashboard graphiques réels (Chart.js)
 *
 * Principe P2 : utilise exclusivement apiGet() de app.js — aucun fetch() direct.
 * Principe P4 : fonctions publiques documentées, helpers privés préfixés _.
 * _money() centralisé dans app.js (P2).
 *
 * API consommées :
 *   GET /api/stats                — KPIs temps réel
 *   GET /api/stats/ca-mensuel     — CA 12 mois (barchart)
 *   GET /api/stats/tickets-statut — Répartition statuts (doughnut)
 *   GET /api/stats/top-produits   — Top ventes 30 j
 *   GET /api/stats/activite       — Fil d'activité
 *   GET /api/stats/techniciens    — Rapport équipe
 *
 * Interface publique exposée via window.DashApp :
 *   init()    — Initialisation complète au chargement de la page
 *   refresh() — Rechargement de toutes les données (bouton + auto-refresh 5 min)
 */

window.DashApp = (() => {
  'use strict'

  // ─── Instances Chart.js ────────────────────────────────────────────────────
  let chartCa      = null
  let chartStatuts = null

  // ─── Init ──────────────────────────────────────────────────────────────────

  /**
   * Initialise le dashboard : sidebar, date topbar, avatar, puis charge les données.
   * Appelé automatiquement sur DOMContentLoaded.
   *
   * @returns {void}
   */
  function init() {
    buildSidebar('dashboard')
    _setDate()
    _setUser()
    refresh()
  }

  /**
   * Recharge toutes les sections du dashboard en parallèle.
   * Exposé publiquement pour le bouton « Actualiser » et l'auto-refresh.
   *
   * @returns {Promise<void>}
   */
  async function refresh() {
    const label = document.getElementById('refresh-label')
    if (label) label.textContent = '…'
    await Promise.all([
      _loadKpis(),
      _loadCaMensuel(),
      _loadTicketsStatut(),
      _loadTopProduits(),
      _loadActivite(),
      _loadTechniciens(),
    ])
    if (label) label.textContent = 'Actualiser'
  }

  // ─── Date topbar ──────────────────────────────────────────────────────────

  /**
   * Affiche la date longue fr-FR dans l'élément #topbar-date.
   * Exemple : « Dimanche 8 juin 2026 ».
   *
   * @returns {void}
   */
  function _setDate() {
    const el = document.getElementById('topbar-date')
    if (!el) return
    const d = new Date()
    const jours = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
    const mois  = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
    el.textContent = `${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]} ${d.getFullYear()}`
  }

  // ─── Utilisateur sidebar ──────────────────────────────────────────────────

  /**
   * Décrypte le JWT en localStorage et affiche les initiales dans #topbar-avatar.
   * Silencieux si token absent ou invalide.
   *
   * @returns {void}
   */
  function _setUser() {
    try {
      const tok = localStorage.getItem('access_token')
      if (!tok) return
      const [, b] = tok.split('.')
      const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - b.length % 4)
      const pay = JSON.parse(atob(b.replace(/-/g,'+').replace(/_/g,'/') + pad))
      const av = document.getElementById('topbar-avatar')
      if (av) av.textContent = ((pay.prenom||'')[0]||'') + ((pay.nom||'')[0]||'')
    } catch {}
  }

  // ─── KPIs ─────────────────────────────────────────────────────────────────

  /**
   * Charge les KPIs depuis GET /api/stats et met à jour les 4 cards
   * ainsi que les badges évolution CA et le strip d'alertes.
   *
   * @returns {Promise<void>}
   */
  async function _loadKpis() {
    try {
      const r = await apiGet('/api/stats')
      if (!r.ok) return
      const d = r.data?.data || {}

      _setText('kpi-tickets', d.tickets_en_cours ?? '—')
      _setText('kpi-ca',      _money(d.ca_mois ?? 0))
      _setText('kpi-clients', d.nb_clients ?? '—')
      _setText('kpi-stock',   d.stock_bas ?? '—')

      // Deltas
      _setText('kpi-delta-tickets', `Aujourd'hui : ${d.tickets_aujourd_hui ?? 0}`)
      _setText('kpi-delta-clients', `RDV aujourd'hui : ${d.rdv_today ?? 0}`)
      _setText('kpi-delta-stock',   `Factures en retard : ${d.factures_en_retard ?? 0}`)

      // Badge évolution CA
      const pct = d.evolution_ca_pct
      const badgeCa = document.getElementById('kpi-badge-ca')
      if (badgeCa) {
        if (pct === null) {
          badgeCa.textContent = 'N/A'
          badgeCa.className = 'kpi-badge info'
        } else if (pct >= 0) {
          badgeCa.textContent = `↑ +${pct}%`
          badgeCa.className = 'kpi-badge up'
        } else {
          badgeCa.textContent = `↓ ${pct}%`
          badgeCa.className = 'kpi-badge down'
        }
      }
      _setText('kpi-delta-ca', `Mois préc. : ${_money(d.ca_mois_precedent ?? 0)}`)

      const badgeTickets = document.getElementById('kpi-badge-tickets')
      if (badgeTickets) {
        badgeTickets.textContent = `+${d.tickets_aujourd_hui ?? 0} auj.`
      }

      const badgeStock = document.getElementById('kpi-badge-stock')
      if (badgeStock && d.stock_bas > 0) {
        badgeStock.textContent = 'Alerte'
        badgeStock.className = 'kpi-badge error'
      } else if (badgeStock) {
        badgeStock.textContent = 'OK'
        badgeStock.className = 'kpi-badge up'
      }

      // Alertes strip
      _buildAlerts(d)

    } catch (e) { console.warn('[Dashboard] KPIs error:', e) }
  }

  // ─── Alertes rapides ──────────────────────────────────────────────────────

  /**
   * Construit le strip d'alertes contextuelles à partir des KPIs.
   * Affiche un chip « Tout est en ordre » si aucune alerte active.
   *
   * @param {object} d - Objet KPIs retourné par getKpisDashboard
   * @returns {void}
   */
  function _buildAlerts(d) {
    const strip = document.getElementById('alert-strip')
    if (!strip) return
    const chips = []

    if (d.stock_bas > 0)
      chips.push({ cls:'error', icon:'📦', text:`${d.stock_bas} produit${d.stock_bas>1?'s':''} en rupture`, href:'stock.html' })
    if (d.factures_en_retard > 0)
      chips.push({ cls:'error', icon:'💶', text:`${d.factures_en_retard} facture${d.factures_en_retard>1?'s':''} en retard`, href:'factures.html' })
    if (d.garanties_expirent > 0)
      chips.push({ cls:'warn', icon:'🛡', text:`${d.garanties_expirent} garantie${d.garanties_expirent>1?'s':''} expirent bientôt`, href:'sav.html' })
    if (d.devis_en_attente > 0)
      chips.push({ cls:'info', icon:'📋', text:`${d.devis_en_attente} devis en attente`, href:'factures.html' })
    if (d.rdv_today > 0)
      chips.push({ cls:'info', icon:'📅', text:`${d.rdv_today} RDV aujourd'hui`, href:'agenda.html' })

    if (!chips.length) {
      strip.innerHTML = '<div class="alert-chip none">✅ Tout est en ordre</div>'
    } else {
      strip.innerHTML = chips.map(c =>
        `<div class="alert-chip ${c.cls}" onclick="window.location.href='${c.href}'">${c.icon} ${c.text}</div>`
      ).join('')
    }
  }

  // ─── Chart CA mensuel ─────────────────────────────────────────────────────

  /**
   * Charge le CA mensuel depuis GET /api/stats/ca-mensuel et dessine
   * un barchart Chart.js avec ligne de moyenne en overlay.
   * Détruit l'instance précédente avant de recréer (gestion mémoire).
   *
   * @returns {Promise<void>}
   */
  async function _loadCaMensuel() {
    try {
      const r = await apiGet('/api/stats/ca-mensuel')
      if (!r.ok) return
      const d = r.data?.data
      if (!d) return

      _setText('chart-ca-total', `Total 12 mois : ${_money(d.total_12_mois)}`)

      const labels   = d.mois.map(m => m.label)
      const values   = d.mois.map(m => +(m.ca_ttc / 100).toFixed(2))  // centimes → euros si nécessaire
      // D1 stocke en euros décimaux directement
      const valuesEur = d.mois.map(m => +m.ca_ttc.toFixed(2))

      const ctx = document.getElementById('chart-ca')
      if (!ctx) return

      if (chartCa) chartCa.destroy()
      chartCa = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'CA TTC (€)',
            data: valuesEur,
            backgroundColor: (ctx) => {
              const i = ctx.dataIndex
              return i === valuesEur.length - 1 ? '#6366f1' : '#c7d2fe'
            },
            borderRadius: 6,
            borderSkipped: false,
          }, {
            label: 'Moy. mensuelle',
            data: Array(12).fill(+d.moyenne_mensuelle.toFixed(2)),
            type: 'line',
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: ctx => ` ${_money(ctx.parsed.y)}`
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: {
              beginAtZero: true,
              ticks: {
                font: { size: 10 },
                callback: v => _money(v, false)
              },
              grid: { color: '#f3f4f6' }
            }
          }
        }
      })
    } catch (e) { console.warn('[Dashboard] Chart CA error:', e) }
  }

  // ─── Chart tickets par statut ─────────────────────────────────────────────

  /**
   * Charge la répartition des tickets depuis GET /api/stats/tickets-statut
   * et dessine un graphique doughnut Chart.js.
   * Affiche uniquement les statuts avec au moins 1 ticket.
   *
   * @returns {Promise<void>}
   */
  async function _loadTicketsStatut() {
    try {
      const r = await apiGet('/api/stats/tickets-statut')
      if (!r.ok) return
      const statuts = r.data?.data || []

      const active = statuts.filter(s => s.cnt > 0)
      const total  = active.reduce((s, x) => s + x.cnt, 0)
      _setText('chart-tickets-total', `${total} au total`)

      const ctx = document.getElementById('chart-statuts')
      if (!ctx) return

      if (chartStatuts) chartStatuts.destroy()

      if (!active.length) {
        ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height)
        return
      }

      chartStatuts = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels:   active.map(s => s.label),
          datasets: [{
            data:            active.map(s => s.cnt),
            backgroundColor: active.map(s => s.color),
            borderWidth:     2,
            borderColor:     '#fff',
            hoverOffset:     6,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'right',
              labels: {
                font: { size: 10 },
                boxWidth: 10,
                padding: 8,
              }
            },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.label} : ${ctx.parsed} (${Math.round(ctx.parsed/total*100)}%)`
              }
            }
          }
        }
      })
    } catch (e) { console.warn('[Dashboard] Chart statuts error:', e) }
  }

  // ─── Top produits ─────────────────────────────────────────────────────────

  /**
   * Charge le top 5 des produits vendus (30 j) et affiche une liste
   * avec barre de progression relative au premier.
   * Badge marge coloré : vert si marge > 20 %, orange sinon.
   *
   * @returns {Promise<void>}
   */
  async function _loadTopProduits() {
    const el = document.getElementById('top-produits-list')
    const sub = document.getElementById('top-produits-sub')
    if (!el) return
    try {
      const r = await apiGet('/api/stats/top-produits', { limit: 5 })
      if (!r.ok || !r.data?.data?.length) {
        el.innerHTML = '<div style="text-align:center;padding:16px;color:#9ca3af;font-size:.85rem;">Aucune vente sur 30 jours</div>'
        return
      }
      const items = r.data.data
      const maxCa = Math.max(...items.map(i => i.ca_total))
      if (sub) sub.textContent = `${items.length} références`

      el.innerHTML = items.map(item => `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f3f4f6;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:.84rem;font-weight:600;color:#1e1b4b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(item.nom)}</div>
            <div style="height:4px;background:#e5e7eb;border-radius:99px;margin-top:4px;">
              <div style="width:${Math.round((item.ca_total/maxCa)*100)}%;height:100%;background:#6366f1;border-radius:99px;"></div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:.84rem;font-weight:700;color:#1e1b4b;">${_money(item.ca_total)}</div>
            <div style="font-size:.74rem;color:${item.marge_pct>20?'#16a34a':'#f59e0b'};">${item.marge_pct}% marge</div>
          </div>
        </div>
      `).join('')
    } catch (e) {
      el.innerHTML = '<div style="padding:12px;color:#9ca3af;font-size:.85rem;">Erreur chargement</div>'
      console.warn('[Dashboard] Top produits error:', e)
    }
  }

  // ─── Activité récente ─────────────────────────────────────────────────────

  /**
   * Charge le fil d'activité multi-modules depuis GET /api/stats/activite
   * et affiche chaque item avec icône, référence, label client et horodatage relatif.
   *
   * @returns {Promise<void>}
   */
  async function _loadActivite() {
    const el = document.getElementById('activity-feed')
    if (!el) return
    try {
      const r = await apiGet('/api/stats/activite')
      if (!r.ok || !r.data?.data?.length) {
        el.innerHTML = '<div style="text-align:center;padding:24px;color:#9ca3af;font-size:.85rem;">Aucune activité récente</div>'
        return
      }
      const typeMap = {
        ticket:  { icon:'🔧', bg:'#ede9ff', href:'tickets.html'  },
        facture: { icon:'💶', bg:'#e0f2fe', href:'factures.html' },
        rachat:  { icon:'♻️', bg:'#ecfdf3', href:'rachats.html'  },
        rdv:     { icon:'📅', bg:'#fef9c3', href:'agenda.html'   },
      }
      el.innerHTML = r.data.data.map(item => {
        const t = typeMap[item.type] || { icon:'📌', bg:'#f3f4f6', href:'#' }
        return `
          <div class="activity-item" onclick="window.location.href='${t.href}'" style="cursor:pointer;">
            <div class="activity-icon" style="background:${t.bg};">${t.icon}</div>
            <div class="activity-body">
              <div class="activity-text">${_esc(item.ref || '')} — ${_esc(item.label || '—')}</div>
              <div class="activity-time">${_ago(item.date)} · <span style="color:#6366f1;text-transform:capitalize;">${_esc(item.detail||'')}</span></div>
            </div>
          </div>`
      }).join('')
    } catch (e) {
      el.innerHTML = '<div style="padding:12px;color:#9ca3af;font-size:.85rem;">Erreur chargement</div>'
      console.warn('[Dashboard] Activité error:', e)
    }
  }

  // ─── Techniciens ─────────────────────────────────────────────────────────

  /**
   * Charge le rapport technicien depuis GET /api/stats/techniciens
   * et affiche la liste avec barre de charge relative et taux de clôture.
   * Silencieux si l'utilisateur n'a pas le rôle requis (erreur API ignorée).
   *
   * @returns {Promise<void>}
   */
  async function _loadTechniciens() {
    const el = document.getElementById('tech-list')
    if (!el) return
    try {
      const r = await apiGet('/api/stats/techniciens')
      if (!r.ok || !r.data?.data?.length) {
        el.innerHTML = '<div style="text-align:center;padding:16px;color:#9ca3af;font-size:.85rem;">Aucun technicien</div>'
        return
      }
      const techs  = r.data.data
      const maxTix = Math.max(...techs.map(t => t.total_tickets || 0), 1)

      el.innerHTML = techs.map(t => {
        const initiales = t.technicien.split(' ').map(p => p[0]||'').join('').toUpperCase().slice(0,2)
        const pct       = Math.round(((t.total_tickets||0) / maxTix) * 100)
        const tauxTerm  = t.total_tickets > 0
          ? Math.round((t.termines / t.total_tickets) * 100)
          : 0
        return `
          <div class="tech-row">
            <div class="tech-avatar">${initiales}</div>
            <div class="tech-info">
              <div class="tech-name">${_esc(t.technicien)}</div>
              <div class="tech-sub">${t.en_cours} en cours · ${tauxTerm}% terminés · ${t.delai_moyen_jours ?? '—'}j moy.</div>
              <div class="tech-bar-wrap" style="width:100%;margin-top:4px;">
                <div class="tech-bar">
                  <div class="tech-bar-fill" style="width:${pct}%;"></div>
                </div>
              </div>
            </div>
            <div class="tech-count">${t.total_tickets}</div>
          </div>`
      }).join('')
    } catch (e) {
      el.innerHTML = '<div style="padding:12px;color:#9ca3af;font-size:.85rem;">Erreur chargement</div>'
      console.warn('[Dashboard] Techniciens error:', e)
    }
  }

  // ─── Helpers privés ─────────────────────────────────────────────────────────

  /**
   * Met à jour le textContent d'un élément DOM par son id.
   * No-op silencieux si l'élément est absent.
   *
   * @param {string} id  - Id de l'élément cible
   * @param {string|number} val - Valeur à afficher
   * @returns {void}
   */
  function _setText(id, val) {
    const el = document.getElementById(id)
    if (el) el.textContent = val
  }

  // _money() est défini dans app.js (Principe P2 — centralisation)

  /**
   * Échappe les caractères HTML dangereux pour une insertion sécurisée en innerHTML.
   *
   * @param {*} s - Valeur à échapper (convertie en string si besoin)
   * @returns {string} Chaîne sécurisée, &amp;, &lt;, &gt; encodés
   */
  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  }

  /**
   * Retourne une durée relative lisible depuis une date ISO (ex: « il y a 3h »).
   * Affiche la date courte fr-FR pour les événements > 7 jours.
   *
   * @param {string} isoDate - Date ISO 8601
   * @returns {string} Durée relative ou date courte, '—' si isoDate est falsy
   */
  function _ago(isoDate) {
    if (!isoDate) return '—'
    const diff = Date.now() - new Date(isoDate).getTime()
    const min  = Math.floor(diff / 60000)
    if (min < 1)  return 'À l\'instant'
    if (min < 60) return `il y a ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24)   return `il y a ${h}h`
    const d = Math.floor(h / 24)
    if (d < 7)    return `il y a ${d}j`
    return new Date(isoDate).toLocaleDateString('fr-FR', { day:'numeric', month:'short' })
  }

  // ─── Auto-refresh toutes les 5 minutes ────────────────────────────────────
  setInterval(refresh, 5 * 60 * 1000)

  document.addEventListener('DOMContentLoaded', init)

  return { init, refresh }
})()
