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

// ─── Exports CSV ──────────────────────────────────────────────────────────────

/**
 * Helper interne : convertit un tableau d'objets en chaîne CSV RFC 4180.
 * Échappe les guillemets et les virgules, ajoute BOM UTF-8.
 */
function toCSV(rows: Record<string, any>[], headers: { key: string; label: string }[]): string {
  const BOM  = '\uFEFF'
  const sep  = ','
  const esc  = (v: any): string => {
    const s = v == null ? '' : String(v)
    return s.includes(sep) || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const head = headers.map(h => esc(h.label)).join(sep)
  const body = rows.map(r => headers.map(h => esc(r[h.key])).join(sep)).join('\r\n')
  return `${BOM}${head}\r\n${body}`
}

/**
 * Export CSV des tickets sur une période.
 * Inclut : numéro, statut, appareil, client, technicien, dates, prix.
 *
 * @param db         Instance D1Database
 * @param boutiqueId ID boutique
 * @param from       Date début ISO (YYYY-MM-DD) — défaut : -30 jours
 * @param to         Date fin ISO (YYYY-MM-DD) — défaut : aujourd'hui
 * @returns Contenu CSV UTF-8 BOM
 */
export async function exportCsvTickets(
  db:         D1Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
): Promise<string> {
  const dateFrom = from ?? "date('now','-30 days')"
  const dateTo   = to   ?? "date('now')"

  const rows = await db.prepare(`
    SELECT
      t.numero,
      t.statut,
      t.appareil_marque,
      t.appareil_modele,
      t.description_panne,
      t.diagnostic,
      c.nom   || ' ' || c.prenom  AS client,
      c.email                     AS client_email,
      c.telephone                 AS client_tel,
      u.prenom || ' ' || u.nom    AS technicien,
      ROUND(t.prix_estime, 2)     AS prix_estime,
      ROUND(t.prix_final,  2)     AS prix_final,
      DATE(t.created_at)          AS date_creation,
      DATE(t.updated_at)          AS date_modification,
      t.date_promesse
    FROM tickets t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users   u ON u.id = t.technicien_id
    WHERE t.boutique_id = ?
      AND DATE(t.created_at) BETWEEN ? AND ?
    ORDER BY t.created_at DESC
    LIMIT 5000
  `).bind(
    boutiqueId,
    from ?? new Date(Date.now() - 30*86400000).toISOString().slice(0,10),
    to   ?? new Date().toISOString().slice(0,10)
  ).all<any>()

  return toCSV(rows.results ?? [], [
    { key: 'numero',            label: 'N° Ticket'          },
    { key: 'statut',            label: 'Statut'             },
    { key: 'appareil_marque',   label: 'Marque'             },
    { key: 'appareil_modele',   label: 'Modèle'             },
    { key: 'description_panne', label: 'Panne déclarée'     },
    { key: 'diagnostic',        label: 'Diagnostic'         },
    { key: 'client',            label: 'Client'             },
    { key: 'client_email',      label: 'Email client'       },
    { key: 'client_tel',        label: 'Tél. client'        },
    { key: 'technicien',        label: 'Technicien'         },
    { key: 'prix_estime',       label: 'Prix estimé (€)'    },
    { key: 'prix_final',        label: 'Prix final (€)'     },
    { key: 'date_creation',     label: 'Date création'      },
    { key: 'date_modification', label: 'Dernière modif.'    },
    { key: 'date_promesse',     label: 'Date promesse'      },
  ])
}

/**
 * Export CSV du chiffre d'affaires (factures payées) sur une période.
 * Inclut : numéro, client, date, montants HT/TTC, mode paiement.
 *
 * @param db         Instance D1Database
 * @param boutiqueId ID boutique
 * @param from       Date début ISO — défaut : début du mois courant
 * @param to         Date fin ISO — défaut : aujourd'hui
 * @returns Contenu CSV UTF-8 BOM
 */
export async function exportCsvCa(
  db:         D1Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
): Promise<string> {
  const rows = await db.prepare(`
    SELECT
      f.numero,
      c.nom  || ' ' || c.prenom  AS client,
      c.email                    AS client_email,
      DATE(f.date_emission)      AS date_emission,
      DATE(f.date_echeance)      AS date_echeance,
      ROUND(f.total_ht,   2)     AS total_ht,
      ROUND(f.total_tva,  2)     AS total_tva,
      ROUND(f.total_ttc,  2)     AS total_ttc,
      f.mode_paiement,
      f.statut,
      COALESCE(f.notes, '')      AS notes
    FROM factures f
    LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.boutique_id = ?
      AND f.statut = 'payee'
      AND DATE(f.date_emission) BETWEEN ? AND ?
    ORDER BY f.date_emission DESC
    LIMIT 5000
  `).bind(
    boutiqueId,
    from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10),
    to   ?? new Date().toISOString().slice(0,10)
  ).all<any>()

  return toCSV(rows.results ?? [], [
    { key: 'numero',        label: 'N° Facture'       },
    { key: 'client',        label: 'Client'           },
    { key: 'client_email',  label: 'Email'            },
    { key: 'date_emission', label: 'Date émission'    },
    { key: 'date_echeance', label: 'Date échéance'    },
    { key: 'total_ht',      label: 'Montant HT (€)'   },
    { key: 'total_tva',     label: 'TVA (€)'          },
    { key: 'total_ttc',     label: 'Montant TTC (€)'  },
    { key: 'mode_paiement', label: 'Mode paiement'    },
    { key: 'statut',        label: 'Statut'           },
    { key: 'notes',         label: 'Notes'            },
  ])
}

/**
 * Export CSV d'activité des techniciens sur une période.
 * Inclut : nom, total tickets, terminés, en cours, délai moyen, CA associé.
 *
 * @param db         Instance D1Database
 * @param boutiqueId ID boutique
 * @param from       Date début ISO — défaut : -30 jours
 * @param to         Date fin ISO — défaut : aujourd'hui
 * @returns Contenu CSV UTF-8 BOM
 */
export async function exportCsvTechniciens(
  db:         D1Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
): Promise<string> {
  const rows = await db.prepare(`
    SELECT
      u.prenom || ' ' || u.nom AS technicien,
      r.nom                    AS role,
      COUNT(t.id)              AS total_tickets,
      SUM(CASE WHEN t.statut IN ('termine','livre') THEN 1 ELSE 0 END)                         AS termines,
      SUM(CASE WHEN t.statut NOT IN ('livre','annule','termine') THEN 1 ELSE 0 END)            AS en_cours,
      ROUND(AVG(
        CASE WHEN t.statut IN ('termine','livre')
          THEN julianday(t.updated_at) - julianday(t.created_at)
          ELSE NULL END
      ), 1)                    AS delai_moyen_jours,
      ROUND(COALESCE(SUM(t.prix_final), 0), 2) AS ca_genere
    FROM users u
    LEFT JOIN roles  r ON r.id  = u.role_id
    LEFT JOIN tickets t ON t.technicien_id = u.id
      AND t.boutique_id = ?
      AND DATE(t.created_at) BETWEEN ? AND ?
    WHERE u.boutique_id = ? AND u.actif = 1
      AND r.nom IN ('admin','gerant','technicien')
    GROUP BY u.id
    ORDER BY total_tickets DESC
  `).bind(
    boutiqueId,
    from ?? new Date(Date.now() - 30*86400000).toISOString().slice(0,10),
    to   ?? new Date().toISOString().slice(0,10),
    boutiqueId
  ).all<any>()

  return toCSV(rows.results ?? [], [
    { key: 'technicien',       label: 'Technicien'          },
    { key: 'role',             label: 'Rôle'                },
    { key: 'total_tickets',    label: 'Total tickets'       },
    { key: 'termines',         label: 'Terminés'            },
    { key: 'en_cours',         label: 'En cours'            },
    { key: 'delai_moyen_jours',label: 'Délai moyen (jours)' },
    { key: 'ca_genere',        label: 'CA généré (€)'       },
  ])
}

/**
 * Rapport comptable : totaux TVA par taux + ventilation par mode paiement.
 * Destiné à l'expert-comptable — agrège les factures payées sur une période.
 *
 * @param db         Instance D1Database
 * @param boutiqueId ID boutique
 * @param from       Date début ISO — défaut : début du mois courant
 * @param to         Date fin ISO — défaut : aujourd'hui
 * @returns { periode, totaux, par_tva, par_mode_paiement, nb_factures }
 */
export async function getRapportComptable(
  db:         D1Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
) {
  const dateFrom = from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10)
  const dateTo   = to   ?? new Date().toISOString().slice(0,10)

  const [totaux, parTva, parMode] = await Promise.all([
    // Totaux globaux
    db.prepare(`
      SELECT
        COUNT(*)                   AS nb_factures,
        ROUND(SUM(total_ht),  2)   AS total_ht,
        ROUND(SUM(total_tva), 2)   AS total_tva,
        ROUND(SUM(total_ttc), 2)   AS total_ttc
      FROM factures
      WHERE boutique_id = ? AND statut = 'payee'
        AND DATE(date_emission) BETWEEN ? AND ?
    `).bind(boutiqueId, dateFrom, dateTo).first<any>(),

    // Ventilation par taux de TVA (depuis lignes_document)
    db.prepare(`
      SELECT
        ROUND(ld.tva_taux, 2)     AS taux_tva,
        ROUND(SUM(ld.total_ht),  2) AS base_ht,
        ROUND(SUM(ld.total_ttc - ld.total_ht), 2) AS montant_tva,
        ROUND(SUM(ld.total_ttc), 2) AS total_ttc
      FROM lignes_document ld
      JOIN factures f ON f.id = ld.document_id AND ld.document_type = 'facture'
      WHERE f.boutique_id = ? AND f.statut = 'payee'
        AND DATE(f.date_emission) BETWEEN ? AND ?
      GROUP BY ROUND(ld.tva_taux, 2)
      ORDER BY taux_tva ASC
    `).bind(boutiqueId, dateFrom, dateTo).all<any>(),

    // Ventilation par mode de paiement
    db.prepare(`
      SELECT
        COALESCE(mode_paiement, 'non renseigné') AS mode,
        COUNT(*)                                  AS nb,
        ROUND(SUM(total_ttc), 2)                  AS total_ttc
      FROM factures
      WHERE boutique_id = ? AND statut = 'payee'
        AND DATE(date_emission) BETWEEN ? AND ?
      GROUP BY mode_paiement
      ORDER BY total_ttc DESC
    `).bind(boutiqueId, dateFrom, dateTo).all<any>(),
  ])

  return {
    periode:            { from: dateFrom, to: dateTo },
    nb_factures:        totaux?.nb_factures      ?? 0,
    total_ht:           totaux?.total_ht         ?? 0,
    total_tva:          totaux?.total_tva        ?? 0,
    total_ttc:          totaux?.total_ttc        ?? 0,
    par_tva:            parTva.results            ?? [],
    par_mode_paiement:  parMode.results           ?? [],
  }
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
