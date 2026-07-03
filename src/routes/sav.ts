/**
 * routes/sav.ts — Controller SAV & Garanties (Sprint 2.10)
 *
 * Endpoints :
 *   GET    /api/garanties            → liste garanties (paginée, filtrable)
 *   POST   /api/garanties            → création manuelle ou depuis ticket_id
 *   POST   /api/garanties/expire     → expirer les garanties périmées (cron-like)
 *   GET    /api/garanties/:id        → détail garantie
 *
 *   GET    /api/sav/kpis             → KPIs SAV & Garanties (AVANT /:id)
 *   GET    /api/sav                  → liste dossiers SAV
 *   POST   /api/sav                  → ouvrir un dossier SAV
 *   GET    /api/sav/:id              → détail dossier SAV
 *   PUT    /api/sav/:id/statut       → changer statut SAV
 *
 * Architecture : 0 SQL ici — tout passe par garantiesService.ts
 */

import { Hono }           from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import {
  createGarantie,
  createGarantieFromTicket,
  getGarantie,
  listGaranties,
  checkAndExpireGaranties,
  createSav,
  listSav,
  getSav,
  updateSavStatut,
  getKpisSav,
} from '../services/garantiesService'
import { validateSav, validateSavStatut, validateGarantie } from '../lib/validators'
import { sendSavOuvert } from '../services/emailService'
import { getClientEmailPrenom } from '../services/clientService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }

const sav = new Hono<{ Bindings: Bindings }>()

// Toutes les routes SAV nécessitent une authentification
sav.use('*', authMiddleware)

// Helper local : récupère user + boutiqueId depuis le contexte Hono
function ctx(c: any) {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, new URL(c.req.url).searchParams.get('boutique_id') ?? undefined)
  return { user, boutiqueId }
}

// ════════════════════════════════════════════════════════════════
// GARANTIES
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/garanties
 * Query params : page, limit, statut, client_id, search, expires_soon=1, boutique_id (admin)
 */
sav.get('/garanties', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const query  = Object.fromEntries(new URL(c.req.url).searchParams)
    const result = await listGaranties(c.env.DB, boutiqueId, query)
    return c.json({ success: true, ...result })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * POST /api/garanties
 * Body : { ticket_id?, client_id?, appareil_marque?, appareil_modele?,
 *           description_reparation?, garantie_jours? }
 */
sav.post('/garanties', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const body = await c.req.json()
    const err  = validateGarantie(body)
    if (err)   return c.json({ success: false, error: err }, 422)

    const garantie = body.ticket_id
      ? await createGarantieFromTicket(c.env.DB, Number(body.ticket_id), boutiqueId)
      : await createGarantie(c.env.DB, boutiqueId, body)

    return c.json({ success: true, data: garantie, message: 'Garantie créée.' }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * POST /api/garanties/expire
 * Expire les garanties périmées de la boutique.
 */
sav.post('/garanties/expire', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const count = await checkAndExpireGaranties(c.env.DB, boutiqueId)
    return c.json({ success: true, data: { expired: count }, message: `${count} garantie(s) expirée(s).` })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * GET /api/garanties/:id
 */
sav.get('/garanties/:id', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ success: false, error: 'ID invalide.' }, 400)

    const garantie = await getGarantie(c.env.DB, id, boutiqueId)
    if (!garantie)  return c.json({ success: false, error: 'Garantie introuvable.' }, 404)
    return c.json({ success: true, data: garantie })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ════════════════════════════════════════════════════════════════
// DOSSIERS SAV
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/sav/kpis
 * ⚠ AVANT GET /api/sav/:id pour éviter que 'kpis' soit capturé comme id
 */
sav.get('/sav/kpis', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const kpis = await getKpisSav(c.env.DB, boutiqueId)
    return c.json({ success: true, data: kpis })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * GET /api/sav
 * Query params : page, limit, statut, client_id, search, boutique_id (admin)
 */
sav.get('/sav', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const query  = Object.fromEntries(new URL(c.req.url).searchParams)
    const result = await listSav(c.env.DB, boutiqueId, query)
    return c.json({ success: true, ...result })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * POST /api/sav
 * Body : { garantie_id?, client_id?, motif, description? }
 */
sav.post('/sav', async (c) => {
  try {
    const { user, boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const userId = user?.sub ?? user?.id ?? 1
    const body   = await c.req.json()
    const err    = validateSav(body)
    if (err)     return c.json({ success: false, error: err }, 422)

    const dossier = await createSav(c.env.DB, boutiqueId, userId, body)

    // Hook Sprint 2.11 : email confirmation SAV ouvert
    try {
      const clientRow = await getClientEmailPrenom(c.env.DB, dossier.client_id)
      if (clientRow?.email) {
        sendSavOuvert(c.env.DB, boutiqueId, {
          id:            dossier.id,
          numero:        dossier.numero,
          client_email:  clientRow.email,
          client_prenom: clientRow.prenom ?? 'Client',
          motif:         dossier.motif,
        }).catch(() => {})
      }
    } catch { /* non bloquant */ }

    return c.json({ success: true, data: dossier, message: `Dossier SAV ${dossier.numero} ouvert.` }, 201)
  } catch (e: any) {
    const status = e.message.includes('Garantie') ? 422 : 500
    return c.json({ success: false, error: e.message }, status)
  }
})

/**
 * GET /api/sav/:id
 */
sav.get('/sav/:id', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ success: false, error: 'ID invalide.' }, 400)

    const dossier = await getSav(c.env.DB, id, boutiqueId)
    if (!dossier)  return c.json({ success: false, error: 'Dossier SAV introuvable.' }, 404)
    return c.json({ success: true, data: dossier })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

/**
 * PUT /api/sav/:id/statut
 * Body : { statut, resolution? }
 */
sav.put('/sav/:id/statut', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ success: false, error: 'ID invalide.' }, 400)

    const body = await c.req.json()
    const err  = validateSavStatut(body)
    if (err)   return c.json({ success: false, error: err }, 422)

    const updated = await updateSavStatut(c.env.DB, id, boutiqueId, body.statut, body.resolution)
    return c.json({ success: true, data: updated, message: `Statut SAV → ${body.statut}.` })
  } catch (e: any) {
    const status = e.message.includes('Transition') || e.message.includes('introuvable') ? 422 : 500
    return c.json({ success: false, error: e.message }, status)
  }
})

export default sav
