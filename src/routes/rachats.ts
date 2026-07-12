/**
 * routes/rachats.ts — Rachats d'occasion & Livre de police (Code pénal art. 321-7)
 * Sprint 2.21 — Architecture P1 MVC : Controller pur — 0 SQL (tout délégué à rachatService).
 *
 * Conformité légale :
 *  - Identification du vendeur obligatoire (nom, prénom, pièce d'identité)
 *  - Registre séquentiel LP-AAAA-XXXXX inaltérable
 *  - Conservation 10 ans minimum
 *
 * @module routes/rachats
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import {
  listRachats, getRachat, createRachat, updateStatutRachat, exportLivrePolice,
  PIECES_VALIDES, ETATS_VALIDES, MODES_PAIEMENT_VALIDES, STATUTS_VALIDES,
  type CreateRachatInput,
} from '../services/rachatService'
import type { Database } from '../ports/database'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
// 'db' : port Database injecté par le middleware global (src/index.tsx) — utilisé
// par listRachats/getRachat/exportLivrePolice, migrées (Ports & Adapters, 2026-07-12).
// createRachat/updateStatutRachat restent sur c.env.DB (dépendent d'auditLog/nextNumero, non migrés).
type Variables = { user: any; db: Database }

const rachats = new Hono<{ Bindings: Bindings; Variables: Variables }>()
rachats.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// LISTE RACHATS (Livre de police)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/rachats
 * Query : page, limit, statut, search, date_debut, date_fin, boutique_id
 */
rachats.get('/rachats', async (c) => {
  const user       = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listRachats(c.get('db'), boutiqueId, query)
  return c.json({ success: true, ...result })
})

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT LIVRE DE POLICE (format CSV réglementaire) — déclaré AVANT /:id pour éviter collision
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/rachats/export
 * Génère un CSV conforme registre police.
 * Query : boutique_id, date_debut?, date_fin?
 *
 * Bug corrigé le 2026-07-12 : cette route était déclarée après `/rachats/:id`,
 * qui capturait `/rachats/export` (id="export") avant d'atteindre celle-ci —
 * l'export CSV était inaccessible (404 "Rachat introuvable") depuis toujours.
 * Découvert en validation live lors de la migration Ports & Adapters.
 */
rachats.get('/rachats/export', requireRole('admin', 'manager'), async (c) => {
  const user       = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const rows = await exportLivrePolice(c.get('db'), boutiqueId, {
    date_debut: query.date_debut,
    date_fin:   query.date_fin,
  })

  const headers = [
    'N° LP', 'Date', 'Vendeur Nom', 'Vendeur Prénom', 'Date Naissance',
    'Adresse', 'CP', 'Ville', 'Pièce', 'N° Pièce',
    'Marque', 'Modèle', 'IMEI', 'Couleur', 'Capacité', 'État',
    'Prix Rachat', 'Mode Paiement', 'Statut', 'Opérateur',
  ]

  const csvLines = [
    headers.join(';'),
    ...rows.map((r: any) => [
      r.numero, r.date_rachat,
      r.vendeur_nom, r.vendeur_prenom, r.vendeur_naissance ?? '',
      r.vendeur_adresse ?? '', r.vendeur_cp ?? '', r.vendeur_ville ?? '',
      r.vendeur_piece, r.vendeur_piece_num,
      r.marque, r.modele, r.imei ?? '',
      r.couleur ?? '', r.capacite ?? '', r.etat,
      r.prix_rachat, r.mode_paiement, r.statut, r.operateur,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')),
  ]

  return new Response(csvLines.join('\n'), {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="livre-police-${boutiqueId}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
})

/**
 * GET /api/rachats/:id
 * Détail complet d'un rachat (+ opérateur + boutique).
 */
rachats.get('/rachats/:id', async (c) => {
  const id    = parseInt(c.req.param('id'), 10)
  const data  = await getRachat(c.get('db'), id)
  if (!data) return c.json({ success: false, error: 'Rachat introuvable.' }, 404)
  return c.json({ success: true, data })
})

// ══════════════════════════════════════════════════════════════════════════════
// CRÉATION RACHAT (entrée livre de police — art. 321-7)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/rachats
 * Crée une entrée dans le livre de police.
 * Body : { vendeur_nom, vendeur_prenom, vendeur_piece, vendeur_piece_num,
 *          vendeur_naissance?, vendeur_adresse?, vendeur_cp?, vendeur_ville?, vendeur_telephone?,
 *          marque, modele, etat?, imei?, imei2?, couleur?, capacite?, accessoires?, observations?,
 *          prix_rachat, mode_paiement?, reference_paiement?, boutique_id? }
 */
rachats.post('/rachats', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  // ── Validations légales (art. 321-7) ────────────────────────────────────
  if (!body.vendeur_nom?.trim())
    return c.json({ success: false, error: 'Nom du vendeur obligatoire (art. 321-7).' }, 400)
  if (!body.vendeur_prenom?.trim())
    return c.json({ success: false, error: 'Prénom du vendeur obligatoire (art. 321-7).' }, 400)
  if (!body.vendeur_piece?.trim())
    return c.json({ success: false, error: 'Type de pièce d\'identité obligatoire (art. 321-7).' }, 400)
  if (!body.vendeur_piece_num?.trim())
    return c.json({ success: false, error: 'Numéro de pièce d\'identité obligatoire (art. 321-7).' }, 400)
  if (!body.marque?.trim())
    return c.json({ success: false, error: 'Marque de l\'appareil obligatoire.' }, 400)
  if (!body.modele?.trim())
    return c.json({ success: false, error: 'Modèle de l\'appareil obligatoire.' }, 400)
  if (body.prix_rachat === undefined || body.prix_rachat < 0)
    return c.json({ success: false, error: 'Prix de rachat obligatoire (≥ 0).' }, 400)

  if (!PIECES_VALIDES.includes(body.vendeur_piece?.toUpperCase()))
    return c.json({ success: false, error: `Type de pièce invalide. Valeurs : ${PIECES_VALIDES.join(', ')}.` }, 400)
  if (body.etat && !ETATS_VALIDES.includes(body.etat))
    return c.json({ success: false, error: `État invalide. Valeurs : ${ETATS_VALIDES.join(', ')}.` }, 400)
  if (body.mode_paiement && !MODES_PAIEMENT_VALIDES.includes(body.mode_paiement))
    return c.json({ success: false, error: `Mode de paiement invalide. Valeurs : ${MODES_PAIEMENT_VALIDES.join(', ')}.` }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const input: CreateRachatInput = { ...body, boutique_id: boutiqueId }
    const { id, numero } = await createRachat(c.env.DB, boutiqueId, user.sub, input)
    return c.json({
      success: true,
      id,
      numero,
      message: `Rachat enregistré dans le livre de police : ${numero}`,
    }, 201)
  } catch (err: any) {
    if (err.code === 'DOUBLON_IMEI')
      return c.json({ success: false, error: err.message, doublon_id: err.doublon_id }, 409)
    return c.json({ success: false, error: err.message }, 422)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// MISE À JOUR STATUT (vendu, retourné, litige)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/rachats/:id/statut
 * Body : { statut: 'en_stock'|'vendu'|'retourne'|'litige', produit_id? }
 */
rachats.patch('/rachats/:id/statut', requireRole('admin', 'manager'), async (c) => {
  const user   = c.get('user')
  const id     = parseInt(c.req.param('id'), 10)
  const { statut, produit_id } = await c.req.json()

  if (!statut || !STATUTS_VALIDES.includes(statut))
    return c.json({ success: false, error: `statut invalide. Valeurs : ${STATUTS_VALIDES.join(', ')}.` }, 400)

  try {
    await updateStatutRachat(c.env.DB, id, user.sub, statut, produit_id)
    return c.json({ success: true, message: `Statut mis à jour : ${statut}` })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, err.message.includes('introuvable') ? 404 : 422)
  }
})

export default rachats
