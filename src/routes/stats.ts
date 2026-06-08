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
import {
  getKpisDashboard,
  getCaMensuel,
  getTicketsParStatut,
  getTopProduits,
  getActiviteRecente,
  getRapportTechnicien,
} from '../services/statsService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }

const stats = new Hono<{ Bindings: Bindings }>()

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
  return { user, boutiqueId, db: c.env.DB as D1Database }
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
stats.get('/stats/techniciens', requireRole('admin', 'gerant'), async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const data = await getRapportTechnicien(db, boutiqueId)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default stats
