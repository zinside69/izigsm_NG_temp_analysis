/**
 * @file src/routes/mobilax.ts
 * @description Routes Mobilax — recherche de pièces chez le grossiste (ticket 03, chantier
 * `integration-mobilax`). Controller seul : 0 SQL, tout passe par `mobilaxService`.
 *
 * Routes :
 *   GET /api/mobilax/produits?q=  — recherche par nom ou EAN13, avec la clé de la boutique
 *
 * Isolation : la boutique est TOUJOURS celle du jeton de connexion — un `?boutique_id=` est
 * ignoré, y compris pour un compte de rôle `admin` rattaché à une boutique (dont
 * `getBoutiqueId()` honorerait le paramètre). L'admin plateforme est refusé : il ne doit jamais utiliser la clé Mobilax
 * d'une boutique cliente (spec, story 3).
 */

import { Hono } from 'hono'
import { authMiddleware, isAdminPlateforme } from '../lib/middleware'
import type { Database } from '../ports/database'
import type { D1KVNamespace } from '../lib/d1kv'
import { rechercherProduitsMobilax, type ErreurMobilax } from '../services/mobilaxService'

// MOBILAX_API_BASE : préproduction ou production (`wrangler.jsonc` › vars), jamais en dur.
type Bindings  = { DB: D1Database; KV: D1KVNamespace; JWT_SECRET: string; FOURNISSEUR_CRYPTO_KEY: string; MOBILAX_API_BASE: string }
type Variables = { user: any; db: Database }

const mobilax = new Hono<{ Bindings: Bindings; Variables: Variables }>()
mobilax.use('*', authMiddleware)

/** Longueur minimale d'un terme : en dessous, la recherche Mobilax brûle du quota pour rien. */
const TERME_MIN = 2

/** Statut HTTP de chaque issue du service — le code, lui, part dans le corps. */
const STATUT_PAR_ERREUR: Record<ErreurMobilax, 422 | 429 | 502> = {
  sans_fournisseur:       422,
  plusieurs_fournisseurs: 422,
  sans_cle:               422,
  cle_illisible:          422,
  cle_refusee:            422,
  quota:                  429,
  indisponible:           502,
}

// ── GET /api/mobilax/produits?q= ──────────────────────────────────────────────
mobilax.get('/mobilax/produits', async (c) => {
  const user = c.get('user')
  // Deux cas visés, nommés comme l'exige CLAUDE.md (§ « !boutique_id ne signifie pas compte
  // incomplet ») : l'admin plateforme (refus voulu, story 3), et tout autre compte sans
  // boutique (onboarding inachevé, données corrompues) — qui n'a aucune clé à utiliser.
  if (isAdminPlateforme(user) || !user.boutique_id)
    return c.json({ success: false, error: 'La recherche Mobilax utilise la clé d\'une boutique : réservée à ses utilisateurs.' }, 403)

  const terme = (c.req.query('q') ?? '').trim()
  if (terme.length < TERME_MIN)
    return c.json({ success: false, error: `Saisissez au moins ${TERME_MIN} caractères.` }, 400)

  const r = await rechercherProduitsMobilax(
    { db: c.get('db'), kv: c.env.KV, cleChiffrement: c.env.FOURNISSEUR_CRYPTO_KEY, baseUrl: c.env.MOBILAX_API_BASE },
    user.boutique_id,
    terme,
  )
  if (r.ok) return c.json({ success: true, data: { total: r.total, produits: r.produits } })
  return c.json({ success: false, error: r.message, code: r.erreur, reessayer_dans_s: r.reessayer_dans_s }, STATUT_PAR_ERREUR[r.erreur])
})

export default mobilax
