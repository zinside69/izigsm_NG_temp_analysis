/**
 * statsService.ts — Model layer pour statistiques & KPIs dashboard
 * Sprint 2.13 — Extraction depuis index.tsx (violation archi résolue)
 *
 * Fuseau horaire : toutes les bornes "aujourd'hui"/"ce mois-ci" sont calculées
 * via lib/timezone.ts (todayParis/currentMonthParis) et liées en paramètre SQL
 * plutôt que déléguées à DATE('now')/strftime(...,'now') — le serveur SQLite
 * (D1) tourne en UTC, qui diverge du jour calendaire français une partie de la
 * journée (voir bugs.md, même pattern déjà corrigé sur personnelService.ts /
 * caisseService.ts).
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

// AVANT (2026-10-02, export comptable mensuel : parseUtcTimestamp et heureParis ajoutés) :
// import { todayParis, currentMonthParis } from '../lib/timezone'
import { todayParis, currentMonthParis, parseUtcTimestamp, heureParis } from '../lib/timezone'
import type { Database } from '../ports/database'
import { sqlSousSeuil } from '../lib/stockSeuil'

// ─── Helpers dates (arithmétique UTC pure sur une date Paris — voir agendaService.ts) ──

/**
 * Ajoute (ou retranche) N jours à une date "YYYY-MM-DD", en arithmétique UTC pure
 * (indépendante du fuseau de la machine d'exécution).
 */
function addDaysParis(dateParis: string, days: number): string {
  const d = new Date(`${dateParis}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Décale une date "YYYY-MM-DD" de N mois, en arithmétique pure sur (année, mois).
 *
 * Renvoie toujours le **1er du mois cible** : les deux appelants ne consomment que la
 * partie `YYYY-MM`, et c'est la seule façon d'avoir un résultat défini pour tous les
 * jours d'entrée.
 *
 * Ne jamais revenir à `Date.setUTCMonth()` ici : décaler un 31 vers un mois de 30 jours
 * fait déborder JavaScript sur le mois suivant (2026-07-31 −1 mois → 2026-06-31 →
 * normalisé en 2026-07-01). Le "mois précédent" retombait alors sur le mois courant, et
 * le KPI `ca_mois_precedent` du dashboard affichait le CA du mois en cours avec une
 * évolution de 0 % — les 31 mai, 31 juillet, 31 octobre et 31 décembre, pour toutes les
 * boutiques. Constaté en production le 2026-07-31 (voir `project-docs/bugs.md`).
 */
function addMonthsParis(dateParis: string, months: number): string {
  const [annee, mois] = dateParis.split('-').map(Number)
  const total  = annee * 12 + (mois - 1) + months
  const cible  = Math.floor(total / 12)
  const moisIx = ((total % 12) + 12) % 12
  return `${cible}-${String(moisIx + 1).padStart(2, '0')}-01`
}

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
export async function getKpisDashboard(db: Database, boutiqueId: number) {
  const today         = todayParis()
  const currentMonth  = currentMonthParis()
  const previousMonth = addMonthsParis(today, -1).slice(0, 7)
  const in30Days       = addDaysParis(today, 30)

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
    db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM clients WHERE boutique_id=? AND actif=1', [boutiqueId]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM tickets
       WHERE boutique_id=? AND statut NOT IN ('livre','annule')`, [boutiqueId]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM tickets
       WHERE boutique_id=? AND DATE(created_at)=?`, [boutiqueId, today]
    ),

    // AVANT (2026-10-04 — le CA HT s'ajoute à côté du TTC, ticket 11 prix TTC ; alias `ca` → `ca_ttc`) :
    // db.get<{ ca: number }>(
    //   `SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures
    //    WHERE boutique_id=? AND statut='payee'
    //    AND strftime('%Y-%m',date_emission)=?`, [boutiqueId, currentMonth]
    // ),
    // Factures PAYÉES seulement (décision de l'exploitant du 2026-10-04, ticket 11) : une facture
    // émise en attente de paiement n'entre pas au CA
    db.get<{ ca_ttc: number; ca_ht: number }>(
      `SELECT COALESCE(SUM(total_ttc),0) as ca_ttc, COALESCE(SUM(total_ht),0) as ca_ht FROM factures
       WHERE boutique_id=? AND statut='payee'
       AND strftime('%Y-%m',date_emission)=?`, [boutiqueId, currentMonth]
    ),

    // AVANT (2026-10-04 — même ajout du CA HT, même renommage d'alias) :
    // db.get<{ ca: number }>(
    //   `SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures
    //    WHERE boutique_id=? AND statut='payee'
    //    AND strftime('%Y-%m',date_emission)=?`, [boutiqueId, previousMonth]
    // ),
    db.get<{ ca_ttc: number; ca_ht: number }>(
      `SELECT COALESCE(SUM(total_ttc),0) as ca_ttc, COALESCE(SUM(total_ht),0) as ca_ht FROM factures
       WHERE boutique_id=? AND statut='payee'
       AND strftime('%Y-%m',date_emission)=?`, [boutiqueId, previousMonth]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM produits
       WHERE boutique_id=? AND ${sqlSousSeuil()} AND actif=1`, [boutiqueId]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM employes
       WHERE boutique_id=? AND statut_pointage='en_poste' AND actif=1`, [boutiqueId]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM factures
       WHERE boutique_id=? AND statut IN ('brouillon','emise')`, [boutiqueId]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM garanties
       WHERE boutique_id=? AND statut='active'
       AND date_fin <= ? AND date_fin >= ?`, [boutiqueId, in30Days, today]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM factures
       WHERE boutique_id=? AND statut='emise'
       AND date_echeance < ?`, [boutiqueId, today]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM rachats
       WHERE boutique_id=?
       AND strftime('%Y-%m',created_at)=?`, [boutiqueId, currentMonth]
    ),

    db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM rendez_vous
       WHERE boutique_id=? AND DATE(debut)=?
       AND statut NOT IN ('annule','no_show')`, [boutiqueId, today]
    ),
  ])

  // AVANT (2026-10-04 — alias `ca` renommé `ca_ttc`) :
  // const caMoisVal  = ca_mois?.ca  ?? 0
  // const caPrecVal  = ca_mois_precedent?.ca ?? 0
  const caMoisVal  = ca_mois?.ca_ttc  ?? 0
  const caPrecVal  = ca_mois_precedent?.ca_ttc ?? 0
  const evolutionCa = caPrecVal > 0
    ? Math.round(((caMoisVal - caPrecVal) / caPrecVal) * 100)
    : null

  return {
    nb_clients:           clients?.cnt              ?? 0,
    tickets_en_cours:     tickets_en_cours?.cnt     ?? 0,
    tickets_aujourd_hui:  tickets_today?.cnt        ?? 0,
    ca_mois:              caMoisVal,
    ca_mois_precedent:    caPrecVal,
    // CA HT à côté du TTC, sur les mêmes factures (ticket 11 prix TTC, 2026-10-04)
    ca_mois_ht:           ca_mois?.ca_ht            ?? 0,
    ca_mois_precedent_ht: ca_mois_precedent?.ca_ht  ?? 0,
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
 *            total_12_mois: number (TTC), total_12_mois_ht: number (HT, depuis le 2026-10-04),
 *            moyenne_mensuelle: number (TTC) }
 */
export async function getCaMensuel(db: Database, boutiqueId: number) {
  const today = todayParis()
  const startWindow = addMonthsParis(today, -11).slice(0, 7) + '-01'

  const rows = await db.all<{ mois: string; ca_ttc: number; ca_ht: number; nb_factures: number }>(
    `SELECT
       strftime('%Y-%m', date_emission) as mois,
       COALESCE(SUM(total_ttc),0)       as ca_ttc,
       COALESCE(SUM(total_ht),0)        as ca_ht,
       COUNT(*)                          as nb_factures
     FROM factures
     WHERE boutique_id=? AND statut='payee'
       AND date_emission >= ?
     GROUP BY mois
     ORDER BY mois ASC`, [boutiqueId, startWindow]
  )

  // Compléter les mois manquants avec 0 pour un graphique continu
  const result: Array<{ mois: string; label: string; ca_ttc: number; ca_ht: number; nb_factures: number }> = []
  const moisLabels = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']

  for (let i = 11; i >= 0; i--) {
    const key       = addMonthsParis(today, -i).slice(0, 7)              // "YYYY-MM"
    const moisIndex = Number(key.slice(5, 7)) - 1
    const label     = `${moisLabels[moisIndex]} ${key.slice(0, 4)}`
    const found     = rows.find(r => r.mois === key)
    result.push({
      mois:         key,
      label,
      ca_ttc:       found?.ca_ttc       ?? 0,
      ca_ht:        found?.ca_ht        ?? 0,
      nb_factures:  found?.nb_factures  ?? 0,
    })
  }

  const total12mois = result.reduce((s, r) => s + r.ca_ttc, 0)
  // Total HT des 12 mois, à côté du TTC (ticket 11 prix TTC, 2026-10-04)
  const total12moisHt = result.reduce((sommeHt, ligneDuMois) => sommeHt + ligneDuMois.ca_ht, 0)
  const moyenne     = total12mois / 12

  // AVANT (2026-10-04 — total HT ajouté) : return { mois: result, total_12_mois: total12mois, moyenne_mensuelle: moyenne }
  return { mois: result, total_12_mois: total12mois, total_12_mois_ht: total12moisHt, moyenne_mensuelle: moyenne }
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
export async function getTicketsParStatut(db: Database, boutiqueId: number) {
  const rows = await db.all<{ statut: string; cnt: number }>(
    `SELECT statut, COUNT(*) as cnt
     FROM tickets
     WHERE boutique_id=?
     GROUP BY statut`, [boutiqueId]
  )

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
    cnt: rows.find(r => r.statut === s.key)?.cnt ?? 0,
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
export async function getTopProduits(db: Database, boutiqueId: number, limit = 10) {
  const depuis = addDaysParis(todayParis(), -30)

  const rows = await db.all<{
    nom: string; reference: string; prix_vente_ttc: number;
    cump: number; nb_ventes: number; qte_vendue: number;
    ca_total: number; marge_brute: number
  }>(
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
       AND f.date_emission >= ?
     GROUP BY p.id
     ORDER BY ca_total DESC
     LIMIT ?`, [boutiqueId, depuis, limit]
  )

  return rows.map(r => ({
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
export async function getActiviteRecente(db: Database, boutiqueId: number, limit = 15) {
  const [tickets, factures, rachats, rdv] = await Promise.all([
    db.all<any>(
      `SELECT 'ticket' as type, t.numero as ref,
              c.nom || ' ' || c.prenom as label,
              t.statut as detail, t.created_at as date
       FROM tickets t
       LEFT JOIN clients c ON c.id = t.client_id
       WHERE t.boutique_id=?
       ORDER BY t.created_at DESC LIMIT 8`, [boutiqueId]
    ),

    db.all<any>(
      `SELECT 'facture' as type, f.numero as ref,
              c.nom || ' ' || c.prenom as label,
              f.statut as detail, f.created_at as date
       FROM factures f
       LEFT JOIN clients c ON c.id = f.client_id
       WHERE f.boutique_id=?
       ORDER BY f.created_at DESC LIMIT 6`, [boutiqueId]
    ),

    db.all<any>(
      `SELECT 'rachat' as type, r.numero as ref,
              r.vendeur_prenom || ' ' || r.vendeur_nom as label,
              r.statut as detail, r.created_at as date
       FROM rachats r
       WHERE r.boutique_id=?
       ORDER BY r.created_at DESC LIMIT 4`, [boutiqueId]
    ),

    db.all<any>(
      `SELECT 'rdv' as type, 'RDV' as ref,
              c.nom || ' ' || c.prenom as label,
              rv.statut as detail, rv.created_at as date
       FROM rendez_vous rv
       LEFT JOIN clients c ON c.id = rv.client_id
       WHERE rv.boutique_id=?
       ORDER BY rv.created_at DESC LIMIT 4`, [boutiqueId]
    ),
  ])

  const all = [
    ...tickets,
    ...factures,
    ...rachats,
    ...rdv,
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
  db:         Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
): Promise<string> {
  const today = todayParis()

  const rows = await db.all<any>(`
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
  `, [
    boutiqueId,
    from ?? addDaysParis(today, -30),
    to   ?? today
  ])

  return toCSV(rows ?? [], [
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
  db:         Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
): Promise<string> {
  // AVANT (2026-10-02, export comptable mensuel) : requête et colonnes déplacées TELLES QUELLES dans
  // `lireFacturesPayeesPeriode()` et `COLONNES_FACTURES_PAYEES` (ci-dessous), pour que l'onglet
  // « Factures payées » de l'export Excel lise exactement la même chose que ce CSV — une seule
  // définition, ⊥ une copie qui divergerait. Ancien code conservé en commentaire :
  return toCSV(await lireFacturesPayeesPeriode(db, boutiqueId, from, to), COLONNES_FACTURES_PAYEES)
  /*
  const today = todayParis()

  const rows = await db.all<any>(`
    SELECT
      f.numero,
      c.nom  || ' ' || c.prenom  AS client,
      c.email                    AS client_email,
      DATE(f.date_emission)      AS date_emission,
      DATE(f.date_echeance)      AS date_echeance,
      ROUND(f.total_ht,   2)     AS total_ht,
      ROUND(f.total_tva,  2)     AS total_tva,
      ROUND(f.total_ttc,  2)     AS total_ttc,
      COALESCE((
        SELECT GROUP_CONCAT(DISTINCT p.mode_paiement)
        FROM paiements p WHERE p.facture_id = f.id
      ), '')                     AS mode_paiement,
      f.statut,
      COALESCE(f.notes, '')      AS notes
    FROM factures f
    LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.boutique_id = ?
      AND f.statut = 'payee'
      AND DATE(f.date_emission) BETWEEN ? AND ?
    ORDER BY f.date_emission DESC
    LIMIT 5000
  `, [
    boutiqueId,
    from ?? (today.slice(0, 7) + '-01'),
    to   ?? today
  ])

  return toCSV(rows ?? [], [
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
  */
}

/** Colonnes de l'export des factures payées — CSV « CA » et onglet « Factures payées » de l'Excel. */
export const COLONNES_FACTURES_PAYEES: { key: string; label: string }[] = [
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
]

/**
 * Factures payées d'une boutique, à leur date d'émission — la requête de l'export CSV « CA »,
 * déplacée telle quelle le 2026-10-02 (voir `exportCsvCa()`).
 */
export async function lireFacturesPayeesPeriode(
  db:         Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
): Promise<any[]> {
  const today = todayParis()

  const rows = await db.all<any>(`
    SELECT
      f.numero,
      c.nom  || ' ' || c.prenom  AS client,
      c.email                    AS client_email,
      DATE(f.date_emission)      AS date_emission,
      DATE(f.date_echeance)      AS date_echeance,
      ROUND(f.total_ht,   2)     AS total_ht,
      ROUND(f.total_tva,  2)     AS total_tva,
      ROUND(f.total_ttc,  2)     AS total_ttc,
      COALESCE((
        SELECT GROUP_CONCAT(DISTINCT p.mode_paiement)
        FROM paiements p WHERE p.facture_id = f.id
      ), '')                     AS mode_paiement,
      f.statut,
      COALESCE(f.notes, '')      AS notes
    FROM factures f
    LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.boutique_id = ?
      AND f.statut = 'payee'
      AND DATE(f.date_emission) BETWEEN ? AND ?
    ORDER BY f.date_emission DESC
    LIMIT 5000
  `, [
    boutiqueId,
    from ?? (today.slice(0, 7) + '-01'),
    to   ?? today
  ])
  return rows ?? []
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
  db:         Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
): Promise<string> {
  const today = todayParis()

  // AVANT (2026-10-01) : `AND r.nom IN ('admin','gerant','technicien')` — le rôle `gerant` n'a jamais
  // existé : un manager qui répare n'apparaissait pas dans les statistiques. Remplacé par `manager`.
  const rows = await db.all<any>(`
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
      AND r.nom IN ('admin','manager','technicien')
    GROUP BY u.id
    ORDER BY total_tickets DESC
  `, [
    boutiqueId,
    from ?? addDaysParis(today, -30),
    to   ?? today,
    boutiqueId
  ])

  return toCSV(rows ?? [], [
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
  db:         Database,
  boutiqueId: number,
  from?:      string,
  to?:        string
) {
  const today    = todayParis()
  const dateFrom = from ?? (today.slice(0, 7) + '-01')
  const dateTo   = to   ?? today

  const [totaux, parTva, parMode] = await Promise.all([
    // Totaux globaux
    db.get<any>(`
      SELECT
        COUNT(*)                   AS nb_factures,
        ROUND(SUM(total_ht),  2)   AS total_ht,
        ROUND(SUM(total_tva), 2)   AS total_tva,
        ROUND(SUM(total_ttc), 2)   AS total_ttc
      FROM factures
      WHERE boutique_id = ? AND statut = 'payee'
        AND DATE(date_emission) BETWEEN ? AND ?
    `, [boutiqueId, dateFrom, dateTo]),

    // Ventilation par taux de TVA (depuis lignes_document)
    db.all<any>(`
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
    `, [boutiqueId, dateFrom, dateTo]),

    // Ventilation par mode de paiement — mode_paiement vit sur paiements (1:N par
    // facture), pas sur factures : on agrège les montants réellement encaissés par
    // mode plutôt que le total_ttc de la facture (qui peut être réglé en plusieurs
    // modes différents).
    db.all<any>(`
      SELECT
        COALESCE(p.mode_paiement, 'non renseigné') AS mode,
        COUNT(DISTINCT f.id)                        AS nb,
        ROUND(SUM(p.montant), 2)                    AS total_ttc
      FROM factures f
      JOIN paiements p ON p.facture_id = f.id
      WHERE f.boutique_id = ? AND f.statut = 'payee'
        AND DATE(f.date_emission) BETWEEN ? AND ?
      GROUP BY p.mode_paiement
      ORDER BY total_ttc DESC
    `, [boutiqueId, dateFrom, dateTo]),
  ])

  return {
    periode:            { from: dateFrom, to: dateTo },
    nb_factures:        totaux?.nb_factures      ?? 0,
    total_ht:           totaux?.total_ht         ?? 0,
    total_tva:          totaux?.total_tva        ?? 0,
    total_ttc:          totaux?.total_ttc        ?? 0,
    par_tva:            parTva            ?? [],
    par_mode_paiement:  parMode           ?? [],
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
export async function getRapportTechnicien(db: Database, boutiqueId: number) {
  return db.all<{
    id: number; technicien: string; total_tickets: number;
    termines: number; en_cours: number; delai_moyen_jours: number | null
  }>(
    // AVANT (2026-10-01) : `r.nom IN ('admin','gerant','technicien')` — rôle inexistant, remplacé par `manager`
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
     WHERE u.boutique_id=? AND u.actif=1 AND r.nom IN ('admin','manager','technicien')
     GROUP BY u.id
     ORDER BY total_tickets DESC`, [boutiqueId, boutiqueId]
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT COMPTABLE MENSUEL — encaissements par jour et par mode
// (ticket 001 `export-comptable-mensuel`, décisions de l'exploitant du 2026-10-02)
// ══════════════════════════════════════════════════════════════════════════════

/** Colonnes de mode, dans l'ordre de l'onglet « Mensuel ». `mixte` et `autre` : seulement si utilisées. */
export const MODES_ENCAISSEMENT = ['especes', 'cb', 'cheque', 'virement', 'mixte', 'autre'] as const
export type ModeEncaissement = typeof MODES_ENCAISSEMENT[number]

/** Un encaissement tel que lu en base : le paiement, sa facture, et les lignes de la facture par taux. */
export interface EncaissementBrut {
  id:             number
  date_paiement:  string          // UTC, format SQLite « AAAA-MM-JJ HH:MM:SS »
  montant:        number          // TTC encaissé
  mode_paiement:  string | null
  facture_numero: string | null
  client:         string | null
  facture_ht:     number | null
  facture_ttc:    number | null
  lignes:         { taux: number; ht: number; tva: number }[]
}

export interface JourMensuel {
  date:  string                                   // AAAA-MM-JJ, jour de Paris
  modes: Record<ModeEncaissement, number>
  ttc:   number
  ht:    number
  tva:   number
  nb:    number
}

export interface EncaissementDetail {
  date: string; heure: string; facture_numero: string; client: string
  mode: ModeEncaissement; ttc: number; ht: number; tva: number
}

export interface ExportMensuel {
  jours:         JourMensuel[]
  total:         Omit<JourMensuel, 'date'>
  colonnes:      ModeEncaissement[]
  tvaParTaux:    { taux: number; ht: number; tva: number }[]
  encaissements: EncaissementDetail[]
}

/** Mode normalisé : casse, accents et espaces ignorés (`CB` et `cb` coexistent en production). */
function normaliserMode(mode: string | null): ModeEncaissement {
  const m = (mode ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (m === 'especes' || m === 'espece') return 'especes'
  if (m === 'cb' || m === 'carte' || m === 'carte bancaire') return 'cb'
  if (m === 'cheque' || m === 'cheques') return 'cheque'
  if (m === 'virement') return 'virement'
  if (m === 'mixte') return 'mixte'
  return 'autre'
}

/** Jours AAAA-MM-JJ de `du` à `au` inclus (calendrier, sans fuseau). */
function joursEntre(du: string, au: string): string[] {
  const jours: string[] = []
  for (let d = new Date(`${du}T00:00:00Z`); d <= new Date(`${au}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1))
    jours.push(d.toISOString().slice(0, 10))
  return jours
}

/** Jour AAAA-MM-JJ décalé de `n` jours (calendrier). */
function decalerJour(jour: string, n: number): string {
  const d = new Date(`${jour}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const enEuros = (centimes: number) => Math.round(centimes) / 100

/**
 * Agrège les encaissements par jour de Paris et par mode — fonction pure.
 *
 * Calcul en **centimes** : HT d'un encaissement = montant × HT / TTC de sa facture (prorata : un
 * paiement partiel ou un acompte ne prend que sa part), TVA = montant − HT ; HT + TVA = TTC au
 * centime, chaque jour et au total. La TVA par taux répartit ce HT et cette TVA selon les lignes de
 * la facture, le reste d'arrondi porté sur le dernier taux.
 *
 * @param encaissements Lus par `lireEncaissementsPeriode()` (bornes larges, en UTC)
 * @param du            Premier jour (AAAA-MM-JJ), heure de Paris
 * @param au            Dernier jour (AAAA-MM-JJ), heure de Paris
 */
export function agregerEncaissementsMensuels(
  encaissements: EncaissementBrut[],
  du:            string,
  au:            string,
): ExportMensuel {
  type Cumul = { modes: Record<ModeEncaissement, number>; ttc: number; ht: number; tva: number; nb: number }
  const vide = () => Object.fromEntries(MODES_ENCAISSEMENT.map(m => [m, 0])) as Record<ModeEncaissement, number>
  const parJour = new Map<string, Cumul>(joursEntre(du, au).map(d => [d, { modes: vide(), ttc: 0, ht: 0, tva: 0, nb: 0 }]))
  const parTaux = new Map<number, { ht: number; tva: number }>()
  const detail: (EncaissementDetail & { tri: number })[] = []

  for (const e of encaissements) {
    const instant = parseUtcTimestamp(e.date_paiement)
    const jour = todayParis(instant)
    const cible = parJour.get(jour)
    if (!cible) continue                          // hors période une fois ramené à l'heure de Paris

    const mode  = normaliserMode(e.mode_paiement)
    const ttc   = Math.round((e.montant ?? 0) * 100)
    const ratio = e.facture_ttc ? (e.facture_ht ?? 0) / e.facture_ttc : 1
    const ht    = Math.round(ttc * ratio)
    const tva   = ttc - ht

    cible.modes[mode] += ttc; cible.ttc += ttc; cible.ht += ht; cible.tva += tva; cible.nb += 1

    // TVA par taux : part de chaque taux dans le HT de la facture ; facture sans ligne → taux déduit des totaux
    const lignes = e.lignes.filter(l => l.ht || l.tva)
    const htFacture = lignes.reduce((s, l) => s + l.ht, 0)
    const repartition = lignes.length && htFacture
      ? lignes.map(l => ({ taux: l.taux, part: l.ht / htFacture }))
      : [{ taux: e.facture_ht ? Math.round(((e.facture_ttc ?? 0) - e.facture_ht) / e.facture_ht * 1000) / 10 : 0, part: 1 }]
    let resteHt = ht, resteTva = tva
    repartition.forEach((r, i) => {
      const dernier = i === repartition.length - 1
      const h = dernier ? resteHt : Math.round(ht * r.part)
      const t = dernier ? resteTva : Math.round(tva * r.part)
      resteHt -= h; resteTva -= t
      const acc = parTaux.get(r.taux) ?? { ht: 0, tva: 0 }
      acc.ht += h; acc.tva += t
      parTaux.set(r.taux, acc)
    })

    detail.push({
      tri: instant.getTime(), date: jour, heure: heureParis(instant),
      facture_numero: e.facture_numero ?? '—', client: (e.client ?? '').trim() || '—',
      mode, ttc: enEuros(ttc), ht: enEuros(ht), tva: enEuros(tva),
    })
  }

  const versEuros = (c: Cumul) => ({
    modes: Object.fromEntries(MODES_ENCAISSEMENT.map(m => [m, enEuros(c.modes[m])])) as Record<ModeEncaissement, number>,
    ttc: enEuros(c.ttc), ht: enEuros(c.ht), tva: enEuros(c.tva), nb: c.nb,
  })
  const cumulTotal: Cumul = { modes: vide(), ttc: 0, ht: 0, tva: 0, nb: 0 }
  for (const j of parJour.values()) {
    for (const m of MODES_ENCAISSEMENT) cumulTotal.modes[m] += j.modes[m]
    cumulTotal.ttc += j.ttc; cumulTotal.ht += j.ht; cumulTotal.tva += j.tva; cumulTotal.nb += j.nb
  }

  return {
    jours: [...parJour].map(([date, j]) => ({ date, ...versEuros(j) })),
    total: versEuros(cumulTotal),
    colonnes: MODES_ENCAISSEMENT.filter(m =>
      m === 'especes' || m === 'cb' || m === 'cheque' || m === 'virement' || cumulTotal.modes[m] !== 0),
    tvaParTaux: [...parTaux].sort((a, b) => b[0] - a[0]).map(([taux, v]) => ({ taux, ht: enEuros(v.ht), tva: enEuros(v.tva) })),
    encaissements: detail.sort((a, b) => a.tri - b.tri).map(({ tri, ...d }) => d),
  }
}

/**
 * Lit les encaissements d'une boutique autour de la période, avec facture, client et lignes.
 *
 * Bornes **larges** en UTC (veille du premier jour → surlendemain du dernier) : `date_paiement` est
 * en UTC et un jour de Paris déborde sur deux jours UTC. Le filtre exact au jour de Paris est fait
 * par `agregerEncaissementsMensuels()`.
 */
export async function lireEncaissementsPeriode(
  db:         Database,
  boutiqueId: number,
  du:         string,
  au:         string,
): Promise<EncaissementBrut[]> {
  const debut = `${decalerJour(du, -1)} 00:00:00`
  const fin   = `${decalerJour(au, 2)} 00:00:00`

  const paiements = await db.all<any>(`
    SELECT p.id, p.date_paiement, p.montant, p.mode_paiement, p.facture_id,
           f.numero AS facture_numero, f.total_ht AS facture_ht, f.total_ttc AS facture_ttc,
           TRIM(COALESCE(NULLIF(c.raison_sociale, ''), COALESCE(c.prenom, '') || ' ' || COALESCE(c.nom, ''))) AS client
    FROM   paiements p
    LEFT   JOIN factures f ON f.id = p.facture_id
    LEFT   JOIN clients  c ON c.id = f.client_id
    WHERE  p.boutique_id = ? AND p.date_paiement >= ? AND p.date_paiement < ?
    ORDER  BY p.date_paiement
  `, [boutiqueId, debut, fin])

  const lignes = await db.all<any>(`
    SELECT l.document_id AS facture_id, l.tva_taux AS taux,
           SUM(l.total_ht) AS ht, SUM(l.total_tva) AS tva
    FROM   lignes_document l
    WHERE  l.document_type = 'facture'
      AND  l.document_id IN (
             SELECT p.facture_id FROM paiements p
             WHERE  p.boutique_id = ? AND p.date_paiement >= ? AND p.date_paiement < ?)
    GROUP  BY l.document_id, l.tva_taux
  `, [boutiqueId, debut, fin])

  const parFacture = new Map<number, { taux: number; ht: number; tva: number }[]>()
  for (const l of lignes ?? []) {
    const liste = parFacture.get(l.facture_id) ?? []
    liste.push({ taux: Number(l.taux), ht: Number(l.ht) || 0, tva: Number(l.tva) || 0 })
    parFacture.set(l.facture_id, liste)
  }

  return (paiements ?? []).map((p: any) => ({
    id: p.id, date_paiement: p.date_paiement, montant: Number(p.montant) || 0, mode_paiement: p.mode_paiement,
    facture_numero: p.facture_numero ?? null, client: p.client ?? null,
    facture_ht: p.facture_ht ?? null, facture_ttc: p.facture_ttc ?? null,
    lignes: parFacture.get(p.facture_id) ?? [],
  }))
}
