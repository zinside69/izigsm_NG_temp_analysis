/**
 * statsService.ts — Model layer pour statistiques & KPIs dashboard
 * Sprint 2.13 — Extraction depuis index.tsx (violation archi résolue)
 *
 * ⚠️  EXCEPTION ARCHITECTURE — Principe 1 (Modularité)
 * Ce service est le seul autorisé à agréger plusieurs modules métier
 * (tickets, factures, produits, rachats, rendez_vous, users, clients).
 * Justification : rôle exclusivement analytique — lecture seule, aucun write.
 * Cette exception est volontaire et documentée. Toute autre route CRUD
 * doit rester strictement mono-module (P1 sans dérogation).
 * Décision validée Sprint 2.13 — voir .architecture/PRINCIPES.md §Exception-Reporting
 *
 * Fonctions exportées :
 *   getKpisDashboard(db, boutiqueId)           — 12 KPIs temps réel
 *   getCaMensuel(db, boutiqueId)               — CA 12 mois glissants (Chart.js)
 *   getTicketsParStatut(db, boutiqueId)        — Répartition statuts tickets
 *   getTopProduits(db, boutiqueId, limit?)     — Top produits vendus 30 j + marge
 *   getActiviteRecente(db, boutiqueId, limit?) — Flux activité multi-modules
 *   getRapportTechnicien(db, boutiqueId)       — Tickets par technicien
 */

// ─── KPIs dashboard ───────────────────────────────────────────────────────────

/**
 * Calcule les 12 indicateurs clés de performance en temps réel.
 * Exécute 12 requêtes en parallèle (Promise.all) pour minimiser la latence.
 *
 * @param db         - Instance D1Database injectée par le contexte Hono
 * @param boutiqueId - ID de la boutique courante (multi-tenant)
 * @returns Objet KPIs : nb_clients, tickets_en_cours, ca_mois, evolution_ca_pct,
 *          stock_bas, employes_en_poste, devis_en_attente, garanties_expirent,
 *          factures_en_retard, rachats_mois, rdv_today
 */
export async function getKpisDashboard(db: D1Database, boutiqueId: number) {
  const [
    clients,
    tickets_en_cours,
    tickets_today,
    ca_mois,
    ca_mois_precedent,
    stock_bas,
    employes_en_poste,
    devis_en_attente,
    garanties_expirent,
    factures_en_retard,
    rachats_mois,
    rdv_today,
  ] = await Promise.all([
    db.prepare(
      'SELECT COUNT(*) as cnt FROM clients WHERE boutique_id=? AND actif=1'
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM tickets
       WHERE boutique_id=? AND statut NOT IN ('livre','annule')`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM tickets
       WHERE boutique_id=? AND DATE(created_at)=DATE('now')`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures
       WHERE boutique_id=? AND statut='payee'
       AND strftime('%Y-%m',date_emission)=strftime('%Y-%m','now')`
    ).bind(boutiqueId).first<{ ca: number }>(),

    db.prepare(
      `SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures
       WHERE boutique_id=? AND statut='payee'
       AND strftime('%Y-%m',date_emission)=strftime('%Y-%m',date('now','-1 month'))`
    ).bind(boutiqueId).first<{ ca: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM produits
       WHERE boutique_id=? AND stock_actuel<=stock_minimum AND actif=1`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM employes
       WHERE boutique_id=? AND statut_pointage='en_poste' AND actif=1`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM factures
       WHERE boutique_id=? AND statut IN ('brouillon','emise')`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM garanties
       WHERE boutique_id=? AND statut='active'
       AND date_fin <= date('now','+30 days') AND date_fin >= date('now')`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM factures
       WHERE boutique_id=? AND statut='emise'
       AND date_echeance < date('now')`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM rachats
       WHERE boutique_id=?
       AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')`
    ).bind(boutiqueId).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM rendez_vous
       WHERE boutique_id=? AND DATE(debut)=DATE('now')
       AND statut NOT IN ('annule','no_show')`
    ).bind(boutiqueId).first<{ cnt: number }>(),
  ])

  const caMoisVal  = ca_mois?.ca  ?? 0
  const caPrecVal  = ca_mois_precedent?.ca ?? 0
  const evolutionCa = caPrecVal > 0
    ? Math.round(((caMoisVal - caPrecVal) / caPrecVal) * 100)
    : null

  return {
    nb_clients:           clients?.cnt              ?? 0,
    tickets_en_cours:     tickets_en_cours?.cnt     ?? 0,
    tickets_aujourd_hui:  tickets_today?.cnt        ?? 0,
    ca_mois:              caMoisVal,
    ca_mois_precedent:    caPrecVal,
    evolution_ca_pct:     evolutionCa,
    stock_bas:            stock_bas?.cnt            ?? 0,
    employes_en_poste:    employes_en_poste?.cnt    ?? 0,
    devis_en_attente:     devis_en_attente?.cnt     ?? 0,
    garanties_expirent:   garanties_expirent?.cnt   ?? 0,
    factures_en_retard:   factures_en_retard?.cnt   ?? 0,
    rachats_mois:         rachats_mois?.cnt         ?? 0,
    rdv_today:            rdv_today?.cnt            ?? 0,
  }
}

// ─── CA 12 derniers mois (données Chart.js) ───────────────────────────────────

/**
 * Retourne le chiffre d'affaires TTC des 12 derniers mois glissants,
 * avec remplissage des mois sans vente à 0 pour garantir un graphique continu.
 *
 * @param db         - Instance D1Database injectée par le contexte Hono
 * @param boutiqueId - ID de la boutique courante (multi-tenant)
 * @returns { mois: Array<{mois, label, ca_ttc, ca_ht, nb_factures}>,
 *            total_12_mois: number, moyenne_mensuelle: number }
 */
export async function getCaMensuel(db: D1Database, boutiqueId: number) {
  const rows = await db.prepare(
    `SELECT
       strftime('%Y-%m', date_emission) as mois,
       COALESCE(SUM(total_ttc),0)       as ca_ttc,
       COALESCE(SUM(total_ht),0)        as ca_ht,
       COUNT(*)                          as nb_factures
     FROM factures
     WHERE boutique_id=? AND statut='payee'
       AND date_emission >= date('now','-11 months','start of month')
     GROUP BY mois
     ORDER BY mois ASC`
  ).bind(boutiqueId).all<{ mois: string; ca_ttc: number; ca_ht: number; nb_factures: number }>()

  // Compléter les mois manquants avec 0 pour un graphique continu
  const result: Array<{ mois: string; label: string; ca_ttc: number; ca_ht: number; nb_factures: number }> = []
  const now = new Date()

  for (let i = 11; i >= 0; i--) {
    const d    = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const moisLabels = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']
    const label = `${moisLabels[d.getMonth()]} ${d.getFullYear()}`
    const found = rows.results.find(r => r.mois === key)
    result.push({
      mois:         key,
      label,
      ca_ttc:       found?.ca_ttc       ?? 0,
      ca_ht:        found?.ca_ht        ?? 0,
      nb_factures:  found?.nb_factures  ?? 0,
    })
  }

  const total12mois = result.reduce((s, r) => s + r.ca_ttc, 0)
  const moyenne     = total12mois / 12

  return { mois: result, total_12_mois: total12mois, moyenne_mensuelle: moyenne }
}

// ─── Tickets par statut ───────────────────────────────────────────────────────

/**
 * Retourne la répartition des tickets par statut, avec couleurs Chart.js pré-assignées.
 * Les statuts absents en base sont retournés avec cnt=0 (liste exhaustive garantie).
 *
 * @param db         - Instance D1Database injectée par le contexte Hono
 * @param boutiqueId - ID de la boutique courante (multi-tenant)
 * @returns Tableau de 9 statuts : { key, label, color, cnt }
 */
export async function getTicketsParStatut(db: D1Database, boutiqueId: number) {
  const rows = await db.prepare(
    `SELECT statut, COUNT(*) as cnt
     FROM tickets
     WHERE boutique_id=?
     GROUP BY statut`
  ).bind(boutiqueId).all<{ statut: string; cnt: number }>()

  const statuts = [
    { key: 'recu',           label: 'Reçu',            color: '#6366f1' },
    { key: 'diagnostic',     label: 'Diagnostic',      color: '#f59e0b' },
    { key: 'en_reparation',  label: 'En réparation',   color: '#3b82f6' },
    { key: 'to_order',       label: 'À commander',     color: '#8b5cf6' },
    { key: 'ordered',        label: 'Commandé',        color: '#ec4899' },
    { key: 'parts_received', label: 'Pièces reçues',   color: '#14b8a6' },
    { key: 'termine',        label: 'Terminé',         color: '#22c55e' },
    { key: 'livre',          label: 'Livré',           color: '#64748b' },
    { key: 'annule',         label: 'Annulé',          color: '#ef4444' },
  ]

  return statuts.map(s => ({
    ...s,
    cnt: rows.results.find(r => r.statut === s.key)?.cnt ?? 0,
  }))
}

// ─── Top produits vendus ──────────────────────────────────────────────────────

/**
 * Retourne les N produits les plus vendus sur les 30 derniers jours,
 * avec CA total, quantité vendue et marge brute calculée.
 *
 * @param db         - Instance D1Database injectée par le contexte Hono
 * @param boutiqueId - ID de la boutique courante (multi-tenant)
 * @param limit      - Nombre maximum de produits retournés (défaut : 10)
 * @returns Tableau de produits : { nom, reference, prix_vente_ttc, cump,
 *          nb_ventes, qte_vendue, ca_total, marge_brute, marge_pct }
 */
export async function getTopProduits(db: D1Database, boutiqueId: number, limit = 10) {
  const rows = await db.prepare(
    `SELECT
       p.nom,
       p.sku            as reference,
       ROUND(p.prix_vente_ht * (1 + p.tva_taux/100.0), 2) as prix_vente_ttc,
       p.prix_achat_cump as cump,
       COUNT(ld.id)        as nb_ventes,
       SUM(ld.quantite)    as qte_vendue,
       SUM(ld.total_ttc)   as ca_total,
       SUM(ld.total_ttc - (p.prix_achat_cump * ld.quantite)) as marge_brute
     FROM lignes_document ld
     JOIN produits p ON p.id = ld.produit_id
     JOIN factures f ON f.id = ld.document_id AND ld.document_type='facture'
     WHERE f.boutique_id=? AND f.statut='payee'
       AND f.date_emission >= date('now','-30 days')
     GROUP BY p.id
     ORDER BY ca_total DESC
     LIMIT ?`
  ).bind(boutiqueId, limit).all<{
    nom: string; reference: string; prix_vente_ttc: number;
    cump: number; nb_ventes: number; qte_vendue: number;
    ca_total: number; marge_brute: number
  }>()

  return rows.results.map(r => ({
    ...r,
    marge_pct: r.ca_total > 0
      ? Math.round((r.marge_brute / r.ca_total) * 100)
      : 0,
  }))
}

// ─── Activité récente (multi-modules — cf. exception P1 en en-tête) ──────────

/**
 * Agrège les derniers événements de 4 modules (tickets, factures, rachats, rdv)
 * et les retourne triés par date décroissante.
 * Chaque item expose : { type, ref, label, detail, date }.
 *
 * @param db         - Instance D1Database injectée par le contexte Hono
 * @param boutiqueId - ID de la boutique courante (multi-tenant)
 * @param limit      - Nombre maximum d'items retournés après tri (défaut : 15)
 * @returns Tableau d'activités triées par date DESC, tronqué à `limit`
 */
export async function getActiviteRecente(db: D1Database, boutiqueId: number, limit = 15) {
  const [tickets, factures, rachats, rdv] = await Promise.all([
    db.prepare(
      `SELECT 'ticket' as type, t.numero as ref,
              c.nom || ' ' || c.prenom as label,
              t.statut as detail, t.created_at as date
       FROM tickets t
       LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.boutique_id=?
       ORDER BY t.created_at DESC LIMIT 8`
    ).bind(boutiqueId).all<any>(),

    db.prepare(
      `SELECT 'facture' as type, f.numero as ref,
              c.nom || ' ' || c.prenom as label,
              f.statut as detail, f.created_at as date
       FROM factures f
       LEFT JOIN clients c ON c.id = f.client_id
       WHERE f.boutique_id=?
       ORDER BY f.created_at DESC LIMIT 6`
    ).bind(boutiqueId).all<any>(),

    db.prepare(
      `SELECT 'rachat' as type, r.numero as ref,
              r.vendeur_prenom || ' ' || r.vendeur_nom as label,
              r.statut as detail, r.created_at as date
       FROM rachats r
       WHERE r.boutique_id=?
       ORDER BY r.created_at DESC LIMIT 4`
    ).bind(boutiqueId).all<any>(),

    db.prepare(
      `SELECT 'rdv' as type, 'RDV' as ref,
              c.nom || ' ' || c.prenom as label,
              rv.statut as detail, rv.created_at as date
       FROM rendez_vous rv
       LEFT JOIN clients c ON c.id = rv.client_id
       WHERE rv.boutique_id=?
       ORDER BY rv.created_at DESC LIMIT 4`
    ).bind(boutiqueId).all<any>(),
  ])

  const all = [
    ...tickets.results,
    ...factures.results,
    ...rachats.results,
    ...rdv.results,
  ]
  all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return all.slice(0, limit)
}

// ─── Rapport activité par technicien ─────────────────────────────────────────

/**
 * Calcule les indicateurs de performance par technicien :
 * volume de tickets, taux de clôture, délai moyen de résolution.
 * Filtre sur les rôles admin/gérant/technicien pour exclure les comptes
 * purement commerciaux.
 *
 * @param db         - Instance D1Database injectée par le contexte Hono
 * @param boutiqueId - ID de la boutique courante (multi-tenant)
 * @returns Tableau trié par total_tickets DESC :
 *          { id, technicien, total_tickets, termines, en_cours, delai_moyen_jours }
 */
export async function getRapportTechnicien(db: D1Database, boutiqueId: number) {
  const rows = await db.prepare(
    `SELECT
       u.id,
       u.prenom || ' ' || u.nom as technicien,
       COUNT(t.id)                             as total_tickets,
       SUM(CASE WHEN t.statut='termine' OR t.statut='livre' THEN 1 ELSE 0 END) as termines,
       SUM(CASE WHEN t.statut NOT IN ('livre','annule','termine') THEN 1 ELSE 0 END) as en_cours,
       ROUND(AVG(
         CASE WHEN t.statut IN ('termine','livre')
           THEN (julianday(t.updated_at) - julianday(t.created_at))
           ELSE NULL END
       ),1) as delai_moyen_jours
     FROM users u
     LEFT JOIN roles r ON r.id=u.role_id
     LEFT JOIN tickets t ON t.technicien_id=u.id AND t.boutique_id=?
     WHERE u.boutique_id=? AND u.actif=1 AND r.nom IN ('admin','gerant','technicien')
     GROUP BY u.id
     ORDER BY total_tickets DESC`
  ).bind(boutiqueId, boutiqueId).all<{
    id: number; technicien: string; total_tickets: number;
    termines: number; en_cours: number; delai_moyen_jours: number | null
  }>()

  return rows.results
}
