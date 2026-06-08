/**
 * routes/stats.ts — Controller pur : KPIs & statistiques dashboard
 * Sprint 2.13 — Extraction /api/stats depuis index.tsx
 * Pattern : 0 SQL inline — tout délégué à statsService.ts
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
function ctx(c: any) {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, new URL(c.req.url).searchParams.get('boutique_id') ?? undefined)
  return { user, boutiqueId, db: c.env.DB as D1Database }
}

// ─── GET /api/stats — KPIs dashboard (remplace le bloc inline index.tsx) ─────
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
stats.get('/stats/ca-mensuel', async (c) => {
  try {
    const { db, boutiqueId } = ctx(c)
    const data = await getCaMensuel(db, boutiqueId)
    return c.json({ success: true, data })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── GET /api/stats/tickets-statut — Répartition pour graphique doughnut ──────
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
