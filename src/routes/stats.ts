/**
 * routes/stats.ts — Controller pur : KPIs & statistiques dashboard
 * Sprint 2.13 — Extraction /api/stats depuis index.tsx
 *
 * Principe P3 respecté : 0 SQL inline — tout délégué à statsService.ts
 * Principe P5 respecté : { success, data } | { success, error } systématique
 *
 * Endpoints exposés :
 *   GET /api/stats                 — 12 KPIs temps réel
 *   GET /api/stats/ca-mensuel      — CA 12 mois glissants (Chart.js)
 *   GET /api/stats/tickets-statut  — Répartition statuts pour doughnut
 *   GET /api/stats/top-produits    — Top ventes 30 j (?limit=N)
 *   GET /api/stats/activite        — Flux activité multi-modules
 *   GET /api/stats/techniciens     — Rapport équipe (admin/gérant only)
 */

import { Hono }        from 'hono'
import { authMiddleware, requireRole } from '../lib/middleware'
import { getBoutiqueId }              from '../lib/middleware'
import type { Database } from '../ports/database'
import {
  getKpisDashboard,
  getCaMensuel,
  getTicketsParStatut,
  getTopProduits,
  getActiviteRecente,
  getRapportTechnicien,
  exportCsvTickets,
  exportCsvCa,
  exportCsvTechniciens,
  getRapportComptable,
  lireEncaissementsPeriode,
  agregerEncaissementsMensuels,
  lireFacturesPayeesPeriode,
  COLONNES_FACTURES_PAYEES,
} from '../services/statsService'
import { construireOngletsComptables } from '../services/exportComptableService'
import { construireXlsx }             from '../lib/xlsx'
import { getBoutiqueById }            from '../services/boutiqueService'
import { todayParis, heureParis }     from '../lib/timezone'

type Bindings  = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { db: Database }

const stats = new Hono<{ Bindings: Bindings; Variables: Variables }>()

stats.use('*', authMiddleware)

// ─── Helper context ───────────────────────────────────────────────────────────

/**
 * Extrait les dépendances communes depuis le contexte Hono :
 * utilisateur courant, boutiqueId résolu (session ou query param), instance DB.
 * Centralise l'accès pour éviter la répétition dans chaque handler.
 *
 * @param c - Contexte Hono (type any : dette connue partagée avec les autres routes)
 * @returns { user, boutiqueId, db }
 */
function ctx(c: any) {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, new URL(c.req.url).searchParams.get('boutique_id') ?? undefined)
  return { user, boutiqueId, db: c.get('db') as Database }
}

// ─── GET /api/stats — KPIs dashboard ─────────────────────────────────────────

/**
 * Retourne les 12 KPIs en temps réel pour le widget dashboard.
 * Remplace l'ancien bloc SQL inline dans index.tsx (violation backlog résolue).
 *
 * @query boutique_id (optionnel) — override du boutique_id de session
 * @returns { success: true, data: KpisDashboard }
 */
stats.get('/stats', async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const data = await getKpisDashboard(db, boutiqueId)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/ca-mensuel — CA 12 mois pour Chart.js ────────────────────

/**
 * Retourne le CA TTC mensuel des 12 derniers mois glissants.
 * Mois sans vente inclus avec valeur 0 pour un graphique bar continu.
 *
 * @query boutique_id (optionnel)
 * @returns { success: true, data: { mois[], total_12_mois, moyenne_mensuelle } }
 */
stats.get('/stats/ca-mensuel', async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const data = await getCaMensuel(db, boutiqueId)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/tickets-statut — Répartition pour graphique doughnut ─────

/**
 * Retourne la répartition des tickets par statut avec couleurs Chart.js.
 * Tous les statuts sont inclus (cnt=0 si absent) pour cohérence graphique.
 *
 * @query boutique_id (optionnel)
 * @returns { success: true, data: Array<{ key, label, color, cnt }> }
 */
stats.get('/stats/tickets-statut', async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const data = await getTicketsParStatut(db, boutiqueId)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/top-produits — Top ventes 30 jours ───────────────────────

/**
 * Retourne les N produits les plus vendus sur les 30 derniers jours.
 *
 * @query boutique_id (optionnel)
 * @query limit       — Nombre de produits (défaut : 10, max conseillé : 20)
 * @returns { success: true, data: Array<TopProduit> }
 */
stats.get('/stats/top-produits', async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const limit = parseInt(new URL(c.req.url).searchParams.get('limit') ?? '10')
    const data  = await getTopProduits(db, boutiqueId, limit)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/activite — Flux activité multi-modules ───────────────────

/**
 * Retourne les derniers événements agrégés (tickets, factures, rachats, rdv)
 * triés par date décroissante — alimentation du fil d'activité dashboard.
 *
 * @query boutique_id (optionnel)
 * @returns { success: true, data: Array<{ type, ref, label, detail, date }> }
 */
stats.get('/stats/activite', async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const data = await getActiviteRecente(db, boutiqueId)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/techniciens — Rapport activité équipe ────────────────────

/**
 * Retourne les indicateurs de performance par technicien.
 * Accès restreint aux rôles admin et gérant.
 *
 * @query boutique_id (optionnel)
 * @returns { success: true, data: Array<{ id, technicien, total_tickets,
 *            termines, en_cours, delai_moyen_jours }> }
 */
// AVANT (2026-10-01) : requireRole('admin', 'gerant') — le rôle `gerant` n'a jamais existé : seul
// l'admin plateforme passait. Le manager dirige sa boutique (décision de l'exploitant).
stats.get('/stats/techniciens', requireRole('admin', 'manager'), async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const data = await getRapportTechnicien(db, boutiqueId)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/export/csv — Exports CSV ─────────────────────────────────

/**
 * Génère un fichier CSV téléchargeable pour les types : tickets, ca, techniciens.
 * Les paramètres from/to sont optionnels (défauts : mois courant ou -30 jours).
 *
 * @query type   — 'tickets' | 'ca' | 'techniciens'
 * @query from   — YYYY-MM-DD (optionnel)
 * @query to     — YYYY-MM-DD (optionnel)
 * @query boutique_id (optionnel)
 * @returns text/csv avec Content-Disposition attachment
 */
// AVANT (2026-10-01) : requireRole('admin', 'gerant', 'technicien') — rôle inexistant : le technicien
// exportait, son manager non.
stats.get('/stats/export/csv', requireRole('admin', 'manager', 'technicien'), async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const q    = new URL(c.req.url).searchParams
    const type = q.get('type') ?? 'tickets'
    const from = q.get('from') ?? undefined
    const to   = q.get('to')   ?? undefined

    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    let csv  = ''
    let name = ''

    if (type === 'tickets') {
      csv  = await exportCsvTickets(db, boutiqueId, from, to)
      name = `tickets_${from ?? 'debut'}_${to ?? 'fin'}.csv`
    } else if (type === 'ca') {
      csv  = await exportCsvCa(db, boutiqueId, from, to)
      name = `ca_${from ?? 'debut'}_${to ?? 'fin'}.csv`
    } else if (type === 'techniciens') {
      csv  = await exportCsvTechniciens(db, boutiqueId, from, to)
      name = `techniciens_${from ?? 'debut'}_${to ?? 'fin'}.csv`
    } else {
      return c.json({ success: false, error: `Type inconnu : ${type}. Valeurs : tickets, ca, techniciens.` }, 400)
    }

    return new Response(csv, {
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/export/xlsx — Export comptable Excel (3 onglets) ──────────

/** Date calendaire valide AAAA-MM-JJ. */
const estDateIso = (s: string | null): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s

/**
 * Export comptable Excel de la boutique : onglets « Mensuel » (encaissements par jour et par
 * mode), « Encaissements » (une ligne par paiement) et « Factures payées » (le CSV « CA »).
 * Ticket 001 `export-comptable-mensuel`, décisions de l'exploitant du 2026-10-02.
 *
 * Réservé à la gestion de la boutique (manager, admin plateforme) : c'est un document comptable.
 *
 * @query from  AAAA-MM-JJ (défaut : 1er du mois courant, heure de Paris)
 * @query to    AAAA-MM-JJ (défaut : aujourd'hui) — période d'au plus 366 jours
 * @returns     .xlsx en pièce jointe ; 400 si période invalide
 */
stats.get('/stats/export/xlsx', requireRole('admin', 'manager'), async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    const q     = new URL(c.req.url).searchParams
    const today = todayParis()
    const du    = q.get('from') || `${today.slice(0, 7)}-01`
    const au    = q.get('to')   || today
    if (!estDateIso(du) || !estDateIso(au))
      return c.json({ success: false, error: 'Période invalide : dates attendues au format AAAA-MM-JJ.' }, 400)
    if (du > au)
      return c.json({ success: false, error: 'Période invalide : la date de début suit la date de fin.' }, 400)
    if ((Date.parse(au) - Date.parse(du)) / 86_400_000 > 366)
      return c.json({ success: false, error: 'Période trop longue : 366 jours au plus.' }, 400)

    const [encaissements, factures, boutique] = await Promise.all([
      lireEncaissementsPeriode(db, boutiqueId, du, au),
      lireFacturesPayeesPeriode(db, boutiqueId, du, au),
      getBoutiqueById(db, boutiqueId),
    ])
    const maintenant = new Date()
    const onglets = construireOngletsComptables(
      agregerEncaissementsMensuels(encaissements, du, au),
      factures,
      COLONNES_FACTURES_PAYEES,
      {
        boutique: (boutique as any)?.nom || 'Boutique',
        ville:    (boutique as any)?.ville ?? null,
        du, au,
        genereLe: `${todayParis(maintenant).split('-').reverse().join('/')} à ${heureParis(maintenant)}`,
      },
    )

    const slug = String((boutique as any)?.slug || (boutique as any)?.nom || `boutique-${boutiqueId}`)
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    const nom = du.slice(0, 7) === au.slice(0, 7)
      ? `export-comptable_${slug}_${du.slice(0, 7)}.xlsx`
      : `export-comptable_${slug}_${du}_${au}.xlsx`

    return new Response(construireXlsx(onglets), {
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nom}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/rapport-comptable — Synthèse TVA + modes paiement ────────

/**
 * Synthèse comptable sur une période : totaux TVA par taux + ventilation
 * par mode de paiement. Accès restreint admin/gérant.
 *
 * @query from  — YYYY-MM-DD (optionnel, défaut : 1er du mois courant)
 * @query to    — YYYY-MM-DD (optionnel, défaut : aujourd'hui)
 * @query boutique_id (optionnel)
 * @returns { success, data: { periode, nb_factures, total_ht, total_tva,
 *            total_ttc, par_tva, par_mode_paiement } }
 */
// AVANT (2026-10-01) : requireRole('admin', 'gerant') — rôle inexistant, voir /stats/techniciens
stats.get('/stats/rapport-comptable', requireRole('admin', 'manager'), async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const q    = new URL(c.req.url).searchParams
    const from = q.get('from') ?? undefined
    const to   = q.get('to')   ?? undefined

    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

    const data = await getRapportComptable(db, boutiqueId, from, to)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default stats
