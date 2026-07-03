/**
 * routes/fournisseurs.ts — Controller pur : Fournisseurs + Bons de commande + CUMP
 * Rôle architectural (P4 MVC) : Controller — 0 SQL, délègue à fournisseursService.
 * Sprint 2.5 — MOD-10 Achats/Approvisionnement
 *
 * Endpoints :
 *   GET    /api/fournisseurs                    — liste fournisseurs
 *   POST   /api/fournisseurs                    — créer fournisseur
 *   GET    /api/fournisseurs/:id                — détail fournisseur
 *   PUT    /api/fournisseurs/:id                — modifier fournisseur
 *   DELETE /api/fournisseurs/:id                — désactiver fournisseur
 *   GET    /api/fournisseurs/kpis               — KPIs achats
 *   GET    /api/fournisseurs/a-commander        — produits stock bas à commander
 *   GET    /api/bons-commande                   — liste bons de commande
 *   POST   /api/bons-commande                   — créer bon de commande
 *   GET    /api/bons-commande/:id               — détail + lignes
 *   PATCH  /api/bons-commande/:id/statut        — changer statut
 *   POST   /api/bons-commande/:id/receptionner  — réceptionner + MAJ stock + CUMP
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { validateFournisseur, validateBonCommande } from '../lib/validators'
import {
  listFournisseurs, getFournisseur, createFournisseur, updateFournisseur, deleteFournisseur,
  listBonsCommande, getBonCommande, createBonCommande, updateStatutBonCommande,
  receptionnerBonCommande, getKpisFournisseurs, getProduitsACommander
} from '../services/fournisseursService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const fournisseurs = new Hono<{ Bindings: Bindings; Variables: Variables }>()
fournisseurs.use('*', authMiddleware)

// ── GET /api/fournisseurs/kpis ────────────────────────────────────────────────
/** KPIs achats : nb fournisseurs, commandes en attente, montants */
fournisseurs.get('/fournisseurs/kpis', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const kpis = await getKpisFournisseurs(c.env.DB, boutiqueId)
  return c.json({ success: true, data: kpis })
})

// ── GET /api/fournisseurs/a-commander ─────────────────────────────────────────
/** Vue "À commander" : produits dont stock_actuel ≤ stock_minimum */
fournisseurs.get('/fournisseurs/a-commander', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await getProduitsACommander(c.env.DB, boutiqueId)
  return c.json({ success: true, data, total: data.length })
})

// ── GET /api/fournisseurs ─────────────────────────────────────────────────────
/** Liste paginée des fournisseurs avec filtres search */
fournisseurs.get('/fournisseurs', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listFournisseurs(c.env.DB, boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

// ── POST /api/fournisseurs ────────────────────────────────────────────────────
/** Créer un nouveau fournisseur */
fournisseurs.post('/fournisseurs', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const error = validateFournisseur(body)
  if (error) return c.json({ success: false, error }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const id = await createFournisseur(c.env.DB, { ...body, boutique_id: boutiqueId }, user.sub)
  return c.json({ success: true, id, message: 'Fournisseur créé.' }, 201)
})

// ── GET /api/fournisseurs/:id ─────────────────────────────────────────────────
/** Détail d'un fournisseur */
fournisseurs.get('/fournisseurs/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getFournisseur(c.env.DB, id)
  if (!data) return c.json({ success: false, error: 'Fournisseur introuvable.' }, 404)
  return c.json({ success: true, data })
})

// ── PUT /api/fournisseurs/:id ─────────────────────────────────────────────────
/** Modifier un fournisseur */
fournisseurs.put('/fournisseurs/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  const error = validateFournisseur(body)
  if (error) return c.json({ success: false, error }, 400)

  await updateFournisseur(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Fournisseur mis à jour.' })
})

// ── DELETE /api/fournisseurs/:id ──────────────────────────────────────────────
/** Désactiver un fournisseur (soft delete) */
fournisseurs.delete('/fournisseurs/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  await deleteFournisseur(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Fournisseur désactivé.' })
})

// ═══ BONS DE COMMANDE ════════════════════════════════════════════════════════

// ── GET /api/bons-commande ────────────────────────────────────────────────────
/** Liste des bons de commande avec filtres (statut, fournisseur, search) */
fournisseurs.get('/bons-commande', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listBonsCommande(c.env.DB, boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

// ── POST /api/bons-commande ───────────────────────────────────────────────────
/** Créer un bon de commande avec ses lignes */
fournisseurs.post('/bons-commande', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const error = validateBonCommande(body)
  if (error) return c.json({ success: false, error }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const id = await createBonCommande(c.env.DB, { ...body, boutique_id: boutiqueId }, user.sub)
    return c.json({ success: true, id, message: 'Bon de commande créé.' }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

// ── GET /api/bons-commande/:id ────────────────────────────────────────────────
/** Détail complet d'un bon de commande avec ses lignes */
fournisseurs.get('/bons-commande/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getBonCommande(c.env.DB, id)
  if (!data) return c.json({ success: false, error: 'Bon de commande introuvable.' }, 404)
  return c.json({ success: true, data })
})

// ── PATCH /api/bons-commande/:id/statut ───────────────────────────────────────
/** Changer le statut d'un bon (draft → awaiting_delivery → cancelled) */
fournisseurs.patch('/bons-commande/:id/statut', requireRole('admin', 'manager'), async (c) => {
  const user   = c.get('user')
  const id     = parseInt(c.req.param('id'), 10)
  const { statut } = await c.req.json()

  if (!statut) return c.json({ success: false, error: 'statut obligatoire.' }, 400)

  // La réception se fait via /receptionner, pas via ce endpoint
  if (statut === 'received') return c.json({ success: false, error: 'Utilisez /receptionner pour réceptionner un bon.' }, 400)

  try {
    await updateStatutBonCommande(c.env.DB, id, statut, user.sub)
    return c.json({ success: true, message: `Statut mis à jour : ${statut}.` })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

// ── POST /api/bons-commande/:id/receptionner ──────────────────────────────────
/** Réceptionner un bon de commande : MAJ stock + calcul CUMP */
fournisseurs.post('/bons-commande/:id/receptionner', requireRole('admin', 'manager'), async (c) => {
  const user  = c.get('user')
  const id    = parseInt(c.req.param('id'), 10)
  const body  = await c.req.json()

  // lignes_recues : [{ ligne_id, quantite_recue }]
  if (!Array.isArray(body.lignes_recues) || body.lignes_recues.length === 0)
    return c.json({ success: false, error: 'lignes_recues obligatoire (tableau non vide).' }, 400)

  try {
    const result = await receptionnerBonCommande(c.env.DB, id, body.lignes_recues, user.sub)
    return c.json({
      success: true,
      ...result,
      message: `Réception enregistrée. ${result.nb_produits_mis_a_jour} produit(s) mis à jour (stock + CUMP).`
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

export default fournisseurs
