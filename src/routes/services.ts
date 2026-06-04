/**
 * routes/services.ts — Catalogue services hiérarchique (Sprint 2.4)
 * Rôle architectural (P1 MVC) : Controller pur — orchestration uniquement.
 * Toute logique métier et SQL est déléguée à servicesService.ts (Model).
 * Toute validation d'entrée est déléguée à validators.ts.
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { validateService, validateCategorieService } from '../lib/validators'
import {
  listCategories, createCategorie, updateCategorie, deleteCategorie,
  listServices, getService, createService, updateService, deleteService,
  getCatalogueArbre,
} from '../services/servicesService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const services = new Hono<{ Bindings: Bindings; Variables: Variables }>()
services.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// CATALOGUE — Arbre complet (catégories + services)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/services/catalogue ───────────────────────────────────────────────
services.get('/services/catalogue', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const arbre = await getCatalogueArbre(c.env.DB, boutiqueId)
  return c.json({ success: true, data: arbre })
})

// ══════════════════════════════════════════════════════════════════════════════
// CATÉGORIES DE SERVICES
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/services/categories ─────────────────────────────────────────────
services.get('/services/categories', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await listCategories(c.env.DB, boutiqueId)
  return c.json({ success: true, data })
})

// ── POST /api/services/categories ────────────────────────────────────────────
services.post('/services/categories', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const error = validateCategorieService(body)
  if (error) return c.json({ success: false, error }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const id = await createCategorie(c.env.DB, { ...body, boutique_id: boutiqueId }, user.sub)
  return c.json({ success: true, id, message: 'Catégorie créée.' }, 201)
})

// ── PUT /api/services/categories/:id ─────────────────────────────────────────
services.put('/services/categories/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  const error = validateCategorieService(body)
  if (error) return c.json({ success: false, error }, 400)

  await updateCategorie(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Catégorie mise à jour.' })
})

// ── DELETE /api/services/categories/:id ──────────────────────────────────────
services.delete('/services/categories/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  await deleteCategorie(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Catégorie désactivée (et ses services).' })
})

// ══════════════════════════════════════════════════════════════════════════════
// SERVICES (PRESTATIONS)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/services ─────────────────────────────────────────────────────────
services.get('/services', async (c) => {
  const user       = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listServices(c.env.DB, boutiqueId, query)
  return c.json({ success: true, ...result })
})

// ── GET /api/services/:id ─────────────────────────────────────────────────────
services.get('/services/:id', async (c) => {
  const id      = parseInt(c.req.param('id'), 10)
  const service = await getService(c.env.DB, id)
  if (!service) return c.json({ success: false, error: 'Service introuvable.' }, 404)
  return c.json({ success: true, data: service })
})

// ── POST /api/services ────────────────────────────────────────────────────────
services.post('/services', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const error = validateService(body)
  if (error) return c.json({ success: false, error }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const id = await createService(c.env.DB, { ...body, boutique_id: boutiqueId }, user.sub)
  return c.json({ success: true, id, message: 'Service créé.' }, 201)
})

// ── PUT /api/services/:id ─────────────────────────────────────────────────────
services.put('/services/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  const error = validateService(body)
  if (error) return c.json({ success: false, error }, 400)

  const existing = await getService(c.env.DB, id)
  if (!existing) return c.json({ success: false, error: 'Service introuvable.' }, 404)

  await updateService(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Service mis à jour.' })
})

// ── DELETE /api/services/:id ──────────────────────────────────────────────────
services.delete('/services/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  const existing = await getService(c.env.DB, id)
  if (!existing) return c.json({ success: false, error: 'Service introuvable.' }, 404)

  await deleteService(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Service désactivé.' })
})

export default services
