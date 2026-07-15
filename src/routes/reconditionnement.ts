/**
 * routes/reconditionnement.ts — Controller : Reconditionnement + Bons d'achat
 * Rôle architectural (P1 MVC) : Controller — 0 SQL, délègue à reconditionnementService.
 * Sprint 2.16 — MOD-05 Reconditionnement + MOD-11 Bons d'achat
 *
 * Ce fichier exporte DEUX routers distincts montés sur des préfixes séparés
 * dans index.tsx. La séparation évite les collisions de routing entre /:id
 * du module ordres et les segments fixes /bons-achat/*.
 *
 *   reconditionnementRoutes → monté sur /api/reconditionnement
 *   bonsAchatRoutes         → monté sur /api/bons-achat
 *
 * Endpoints — Reconditionnement :
 *   GET    /api/reconditionnement              — liste ordres
 *   GET    /api/reconditionnement/kpis         — KPIs dashboard
 *   POST   /api/reconditionnement              — créer un ordre
 *   GET    /api/reconditionnement/:id          — détail ordre
 *   PUT    /api/reconditionnement/:id          — modifier ordre
 *   PATCH  /api/reconditionnement/:id/statut   — changer statut
 *   POST   /api/reconditionnement/:id/terminer — clôturer + créer produit stock
 *
 * Endpoints — Bons d'achat :
 *   GET    /api/bons-achat                     — liste bons
 *   POST   /api/bons-achat                     — émettre un bon
 *   GET    /api/bons-achat/:id                 — détail bon
 *   POST   /api/bons-achat/verifier            — vérifier un code en caisse
 *   POST   /api/bons-achat/:id/consommer       — encaisser le bon
 *   POST   /api/bons-achat/:id/annuler         — annuler le bon
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import type { Database } from '../ports/database'
import {
  listOrdres, getOrdre, createOrdre, updateOrdre,
  updateStatutOrdre, terminerOrdre, getKpisReconditionnement,
  listBonsAchat, getBonAchat, createBonAchat,
  verifierBonAchat, consommerBonAchat, annulerBonAchat,
} from '../services/reconditionnementService'

// ─── Types Hono ───────────────────────────────────────────────────────────────

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any; db: Database }

// ─── Initialisation des routers ───────────────────────────────────────────────
// Deux routers séparés pour éviter les collisions entre /:id et /bons-achat/*

/** Router ordres de reconditionnement — monté sur /api/reconditionnement */
const reconditionnement = new Hono<{ Bindings: Bindings; Variables: Variables }>()
reconditionnement.use('*', authMiddleware)

/** Router bons d'achat — monté sur /api/bons-achat */
const bonsAchat = new Hono<{ Bindings: Bindings; Variables: Variables }>()
bonsAchat.use('*', authMiddleware)

// ─── Helper : extraction du contexte commun ───────────────────────────────────

/**
 * Extrait user, db et le paramètre boutique_id depuis la requête.
 * Pour les routes GET : boutique_id vient du query param.
 * Pour les routes POST/PUT/PATCH : boutique_id doit être lu depuis le body
 * après parsing JSON (le body n'est pas lisible ici car il ne peut l'être qu'une fois).
 *
 * @param c - Contexte Hono
 * @returns { user, db, queryBoutiqueId }
 */
function ctx(c: any) {
  return {
    user:            c.get('user'),
    db:              c.env.DB as D1Database,
    dbPort:          c.get('db') as Database,
    queryBoutiqueId: c.req.query('boutique_id') ?? undefined,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ORDRES DE RECONDITIONNEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/reconditionnement/kpis ───────────────────────────────────────────
// Déclaré AVANT /:id pour éviter que "kpis" soit capturé comme un paramètre id.
/** KPIs du module reconditionnement pour le dashboard */
reconditionnement.get('/kpis', async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const kpis = await getKpisReconditionnement(dbPort, boutiqueId)
  return c.json({ success: true, data: kpis })
})

// ── GET /api/reconditionnement ────────────────────────────────────────────────
/** Liste paginée des ordres (filtres : statut, grade, search) */
reconditionnement.get('/', async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listOrdres(dbPort, boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

// ── POST /api/reconditionnement ───────────────────────────────────────────────
/** Créer un nouvel ordre (rachat_id optionnel — pré-remplit l'appareil) */
reconditionnement.post('/', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const ordre = await createOrdre(db, boutiqueId, body)
    return c.json({ success: true, data: ordre }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

// ── GET /api/reconditionnement/:id ────────────────────────────────────────────
/** Détail d'un ordre avec rachat source et produit créé */
reconditionnement.get('/:id', async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const id         = Number(c.req.param('id'))
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const ordre = await getOrdre(dbPort, id, boutiqueId)
  if (!ordre) return c.json({ success: false, error: 'Ordre introuvable.' }, 404)

  return c.json({ success: true, data: ordre })
})

// ── PUT /api/reconditionnement/:id ────────────────────────────────────────────
/** Modifier les informations d'un ordre (statuts brouillon ou en_cours uniquement) */
reconditionnement.put('/:id', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const id   = Number(c.req.param('id'))
  const body = await c.req.json()

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const ok = await updateOrdre(dbPort, id, boutiqueId, body)
    if (!ok) return c.json({ success: false, error: 'Ordre introuvable ou non modifié.' }, 404)
    return c.json({ success: true, message: 'Ordre mis à jour.' })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

// ── PATCH /api/reconditionnement/:id/statut ───────────────────────────────────
/** Changer le statut d'un ordre (transitions : brouillon→en_cours, en_cours→abandonne…) */
reconditionnement.patch('/:id/statut', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const id   = Number(c.req.param('id'))
  const body = await c.req.json()

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const { statut } = body
  if (!statut) return c.json({ success: false, error: 'Champ statut requis.' }, 400)

  try {
    const updated = await updateStatutOrdre(dbPort, id, boutiqueId, statut)
    return c.json({ success: true, data: updated })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

// ── POST /api/reconditionnement/:id/terminer ──────────────────────────────────
/** Clôturer un ordre : valide la transition, crée/MAJ le produit en stock */
reconditionnement.post('/:id/terminer', requireRole('admin', 'manager'), async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const id   = Number(c.req.param('id'))
  const body = await c.req.json()

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const { prix_revente_ht, grade, description_travaux, produit_id_existant } = body

  if (prix_revente_ht === undefined || prix_revente_ht === null) {
    return c.json({ success: false, error: 'prix_revente_ht requis pour terminer un ordre.' }, 400)
  }
  if (!grade || !['A', 'B', 'C', 'D'].includes(grade)) {
    return c.json({ success: false, error: 'grade requis (A, B, C ou D).' }, 400)
  }

  try {
    const ordre = await terminerOrdre(dbPort, id, boutiqueId, {
      prix_revente_ht,
      grade,
      description_travaux,
      produit_id_existant,
    })
    return c.json({
      success: true,
      data:    ordre,
      message: `Ordre ${ordre.numero} terminé. Produit occasion créé (id: ${ordre.produit_id}).`,
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — BONS D'ACHAT (router bonsAchat — monté sur /api/bons-achat)
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /api/bons-achat/verifier ─────────────────────────────────────────────
// Déclaré AVANT /:id — le segment "verifier" doit prendre priorité sur le paramètre.
/** Vérifie un code bon d'achat avant encaissement (sans le consommer) */
bonsAchat.post('/verifier', async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const { code } = body
  if (!code) return c.json({ success: false, error: 'Champ code requis.' }, 400)

  const result = await verifierBonAchat(dbPort, code, boutiqueId)
  return c.json({ success: true, data: result })
})

// ── GET /api/bons-achat ───────────────────────────────────────────────────────
/** Liste paginée des bons d'achat (filtres : statut, client_id, search) */
bonsAchat.get('/', async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listBonsAchat(dbPort, boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

// ── POST /api/bons-achat ──────────────────────────────────────────────────────
/** Émettre un nouveau bon d'achat (admin et manager uniquement) */
bonsAchat.post('/', requireRole('admin', 'manager'), async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  if (!body.montant || body.montant <= 0) {
    return c.json({ success: false, error: 'Champ montant requis et doit être positif.' }, 400)
  }

  try {
    const bon = await createBonAchat(dbPort, boutiqueId, body)
    return c.json({ success: true, data: bon }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

// ── GET /api/bons-achat/:id ───────────────────────────────────────────────────
/** Détail d'un bon d'achat avec client + facture d'utilisation */
bonsAchat.get('/:id', async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const id         = Number(c.req.param('id'))
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const bon = await getBonAchat(dbPort, id, boutiqueId)
  if (!bon) return c.json({ success: false, error: 'Bon d\'achat introuvable.' }, 404)

  return c.json({ success: true, data: bon })
})

// ── POST /api/bons-achat/:id/consommer ────────────────────────────────────────
/** Encaisser un bon d'achat sur une facture (consommation totale ou partielle) */
bonsAchat.post('/:id/consommer', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const id   = Number(c.req.param('id'))
  const body = await c.req.json()

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const { code, facture_id, montant_utilise } = body
  if (!code)           return c.json({ success: false, error: 'Champ code requis.' }, 400)
  if (!facture_id)     return c.json({ success: false, error: 'Champ facture_id requis.' }, 400)
  if (!montant_utilise || montant_utilise <= 0) {
    return c.json({ success: false, error: 'Champ montant_utilise requis et positif.' }, 400)
  }

  try {
    const bon = await consommerBonAchat(dbPort, code, boutiqueId, facture_id, montant_utilise)
    return c.json({
      success: true,
      data:    bon,
      message: `Bon ${bon.code} consommé : ${montant_utilise} € déduits.`,
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

// ── POST /api/bons-achat/:id/annuler ─────────────────────────────────────────
/** Annuler un bon non encore consommé */
bonsAchat.post('/:id/annuler', requireRole('admin', 'manager'), async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const id   = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))

  const boutiqueId = getBoutiqueId(user, body?.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    await annulerBonAchat(dbPort, id, boutiqueId)
    return c.json({ success: true, message: 'Bon d\'achat annulé.' })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400)
  }
})

export { reconditionnement as reconditionnementRoutes, bonsAchat as bonsAchatRoutes }
