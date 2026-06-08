/**
 * routes/caisse.ts — Controller Caisse POS + Journal NF525 (Sprint 2.12)
 *
 * Endpoints :
 *   GET    /api/caisse/kpis            → KPIs caisse du jour + mois
 *   GET    /api/caisse/journal         → Journal du jour (ou ?date=YYYY-MM-DD)
 *   POST   /api/caisse/vente           → Vente POS directe (crée facture + journal NF525)
 *   POST   /api/caisse/encaissement    → Encaisser une facture existante
 *   GET    /api/caisse/clotures        → Historique des clôtures
 *   POST   /api/caisse/cloture         → Clôture journalière NF525
 *   GET    /api/caisse/integrite       → Vérifier intégrité chaîne de hash
 *
 * Architecture : 0 SQL ici — tout passe par caisseService.ts
 */

import { Hono }          from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import {
  createVente,
  enregistrerEncaissement,
  getCaisseJournal,
  cloturerJournee,
  verifierIntegriteChaine,
  getKpisCaisse,
  listClotures,
} from '../services/caisseService'

// ─── Types ────────────────────────────────────────────────────────────────────

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
const caisse = new Hono<{ Bindings: Bindings }>()

// ─── Helper contexte (même pattern que sav.ts) ────────────────────────────────

function ctx(c: any) {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, new URL(c.req.url).searchParams.get('boutique_id') ?? undefined)
  return { user, boutiqueId }
}

// ─── Auth sur toutes les routes ───────────────────────────────────────────────
caisse.use('*', authMiddleware)

// ─── Validators locaux ────────────────────────────────────────────────────────

function validateVente(body: any): string | null {
  if (!Array.isArray(body.lignes) || body.lignes.length === 0)
    return 'Au moins une ligne de vente obligatoire.'

  const modesValides = ['especes', 'cb', 'virement', 'cheque', 'mixte']
  if (!body.mode_paiement || !modesValides.includes(body.mode_paiement))
    return `mode_paiement obligatoire (${modesValides.join(', ')}).`

  for (const [i, l] of (body.lignes as any[]).entries()) {
    if (!l.designation?.trim())
      return `Ligne ${i + 1} : désignation obligatoire.`
    if (l.quantite === undefined || isNaN(Number(l.quantite)) || Number(l.quantite) <= 0)
      return `Ligne ${i + 1} : quantité invalide (> 0).`
    if (l.prix_unitaire_ht === undefined || isNaN(Number(l.prix_unitaire_ht)) || Number(l.prix_unitaire_ht) < 0)
      return `Ligne ${i + 1} : prix_unitaire_ht invalide (≥ 0).`
    if (l.tva_taux === undefined || isNaN(Number(l.tva_taux)) || ![0, 5.5, 10, 20].includes(Number(l.tva_taux)))
      return `Ligne ${i + 1} : tva_taux invalide (0, 5.5, 10 ou 20).`
  }
  return null
}

// ─── KPIs Caisse ─────────────────────────────────────────────────────────────

caisse.get('/caisse/kpis', async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const kpis = await getKpisCaisse(c.env.DB, boutiqueId)
    return c.json({ success: true, data: kpis })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Journal du jour ──────────────────────────────────────────────────────────

caisse.get('/caisse/journal', async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const date = new URL(c.req.url).searchParams.get('date') ?? undefined
  // Valider format date si fourni
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return c.json({ success: false, error: 'Format date invalide (YYYY-MM-DD).' }, 400)

  try {
    const journal = await getCaisseJournal(c.env.DB, boutiqueId, date)
    return c.json({ success: true, data: journal })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Vente POS ────────────────────────────────────────────────────────────────

caisse.post('/caisse/vente', async (c) => {
  const { user, boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let body: any
  try { body = await c.req.json() }
  catch { return c.json({ success: false, error: 'JSON invalide.' }, 400) }

  const err = validateVente(body)
  if (err) return c.json({ success: false, error: err }, 422)

  try {
    const result = await createVente(c.env.DB, boutiqueId, user.sub, {
      client_id:       body.client_id       ? Number(body.client_id)       : undefined,
      lignes:          body.lignes.map((l: any) => ({
        produit_id:       l.produit_id       ? Number(l.produit_id)       : undefined,
        service_id:       l.service_id       ? Number(l.service_id)       : undefined,
        designation:      String(l.designation),
        quantite:         Number(l.quantite),
        prix_unitaire_ht: Number(l.prix_unitaire_ht),
        tva_taux:         Number(l.tva_taux),
        remise_pct:       l.remise_pct       ? Number(l.remise_pct)        : 0,
      })),
      mode_paiement:   body.mode_paiement,
      montant_especes: body.montant_especes  ? Number(body.montant_especes)  : undefined,
      montant_cb:      body.montant_cb       ? Number(body.montant_cb)       : undefined,
      montant_cheque:  body.montant_cheque   ? Number(body.montant_cheque)   : undefined,
      note:            body.note,
    })
    return c.json({ success: true, data: result }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400)
  }
})

// ─── Encaissement sur facture existante ──────────────────────────────────────

caisse.post('/caisse/encaissement', async (c) => {
  const { user, boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let body: any
  try { body = await c.req.json() }
  catch { return c.json({ success: false, error: 'JSON invalide.' }, 400) }

  if (!body.facture_id || isNaN(Number(body.facture_id)))
    return c.json({ success: false, error: 'facture_id obligatoire.' }, 422)

  const modesValides = ['especes', 'cb', 'virement', 'cheque', 'mixte']
  if (!body.mode_paiement || !modesValides.includes(body.mode_paiement))
    return c.json({ success: false, error: `mode_paiement obligatoire (${modesValides.join(', ')}).` }, 422)

  try {
    const journal = await enregistrerEncaissement(
      c.env.DB,
      boutiqueId,
      user.sub,
      Number(body.facture_id),
      body.mode_paiement
    )
    return c.json({ success: true, data: journal }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400)
  }
})

// ─── Historique clôtures ──────────────────────────────────────────────────────

caisse.get('/caisse/clotures', async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const limitParam = new URL(c.req.url).searchParams.get('limit')
  const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10))) : 30

  try {
    const clotures = await listClotures(c.env.DB, boutiqueId, limit)
    return c.json({ success: true, data: clotures })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Clôture journalière NF525 ────────────────────────────────────────────────

caisse.post('/caisse/cloture', requireRole('admin', 'gerant'), async (c) => {
  const { user, boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let body: any = {}
  try { body = await c.req.json() } catch { /* body vide accepté */ }

  const date = body.date ?? undefined
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return c.json({ success: false, error: 'Format date invalide (YYYY-MM-DD).' }, 400)

  try {
    const cloture = await cloturerJournee(c.env.DB, boutiqueId, user.sub, date)
    return c.json({ success: true, data: cloture }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400)
  }
})

// ─── Vérification intégrité chaîne NF525 ─────────────────────────────────────

caisse.get('/caisse/integrite', requireRole('admin', 'gerant'), async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const sp        = new URL(c.req.url).searchParams
  const dateDebut = sp.get('date_debut') ?? undefined
  const dateFin   = sp.get('date_fin')   ?? undefined

  try {
    const result = await verifierIntegriteChaine(c.env.DB, boutiqueId, dateDebut, dateFin)
    return c.json({ success: true, data: result })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default caisse
