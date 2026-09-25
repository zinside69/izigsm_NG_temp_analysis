/**
 * @file src/routes/mobilax.ts
 * @description Routes Mobilax — recherche de pièces chez le grossiste (ticket 03, chantier
 * `integration-mobilax`). Controller seul : 0 SQL, tout passe par `mobilaxService`.
 *
 * Routes :
 *   GET  /api/mobilax/produits?q=  — recherche par nom ou EAN13, avec la clé de la boutique
 *   GET  /api/mobilax/series?q=    — séries d'une génération (ticket 01 `import-par-generation`)
 *   GET  /api/mobilax/apercu?series= — aperçu des séries cochées (ticket 02)
 *   POST /api/mobilax/import       — importe une pièce dans le stock (`{ mobilax_id }`, ticket 04 ;
 *                                    `quantite_en_rayon?` facultative, ticket 05 réglages de stock)
 *   POST /api/mobilax/produits/:id/ajout-stock — « Ajouter N au stock » d'une pièce déjà en stock
 *                                    (`{ quantite }`, ticket 18 `vente-lit-catalogue`)
 *
 * Isolation : la boutique est TOUJOURS celle du jeton de connexion — un `?boutique_id=` est
 * ignoré, y compris pour un compte de rôle `admin` rattaché à une boutique (dont
 * `getBoutiqueId()` honorerait le paramètre). L'admin plateforme est refusé : il ne doit jamais utiliser la clé Mobilax
 * d'une boutique cliente (spec, story 3).
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, isAdminPlateforme } from '../lib/middleware'
import type { Database } from '../ports/database'
import type { D1KVNamespace } from '../lib/d1kv'
import { rechercherProduitsMobilax, importerProduitMobilax, seriesDeGeneration, apercuGeneration, type ErreurMobilax } from '../services/mobilaxService'
// AVANT (2026-09-25, point 1 : clé d'ajout) : import { ajouterStockPieceImportee } from '../services/stockService'
import { ajouterStockPieceImportee, MOTIF_CLE_AJOUT } from '../services/stockService'

// MOBILAX_API_BASE : préproduction ou production (`wrangler.jsonc` › vars), jamais en dur.
type Bindings  = { DB: D1Database; KV: D1KVNamespace; JWT_SECRET: string; FOURNISSEUR_CRYPTO_KEY: string; MOBILAX_API_BASE: string }
type Variables = { user: any; db: Database }

const mobilax = new Hono<{ Bindings: Bindings; Variables: Variables }>()
mobilax.use('*', authMiddleware)

/** Longueur minimale d'un terme : en dessous, la recherche Mobilax brûle du quota pour rien. */
const TERME_MIN = 2

/** Statut HTTP de chaque issue du service — le code, lui, part dans le corps. */
const STATUT_PAR_ERREUR: Record<ErreurMobilax, 400 | 404 | 409 | 422 | 429 | 502> = {
  quantite_invalide:      400,
  introuvable:            404,
  deja_importe:           409,
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

  // Page demandée (100 résultats par page, décision du 2026-09-11) : entier ≥ 1, sinon 400 —
  // une page fantaisiste ne doit pas brûler un appel du quota Mobilax.
  const pageBrute = c.req.query('page')
  const page = pageBrute === undefined ? 1 : Number(pageBrute)
  if (!Number.isInteger(page) || page < 1)
    return c.json({ success: false, error: 'Numéro de page invalide.' }, 400)

  const r = await rechercherProduitsMobilax(
    { db: c.get('db'), kv: c.env.KV, cleChiffrement: c.env.FOURNISSEUR_CRYPTO_KEY, baseUrl: c.env.MOBILAX_API_BASE },
    user.boutique_id,
    terme,
    page,
  )
  // `fournisseur_id` : lien du bilan de l'import d'une sélection (ticket 02 import-d-une-selection)
  if (r.ok) return c.json({ success: true, data: { fournisseur_id: r.fournisseur_id, total: r.total, page: r.page, pages: r.pages, produits: r.produits } })
  return c.json({ success: false, error: r.message, code: r.erreur, reessayer_dans_s: r.reessayer_dans_s }, STATUT_PAR_ERREUR[r.erreur])
})

// ── GET /api/mobilax/series?q= ────────────────────────────────────────────────
// Ticket 01 `import-par-generation` : séries Mobilax d'une génération (« iPhone 17 » → 17,
// 17 Air, 17 Pro, 17 Pro Max). Lecture du catalogue des séries, sans quota. Mêmes gardes que la
// recherche : boutique du jeton seulement, admin plateforme et compte sans boutique refusés.
mobilax.get('/mobilax/series', async (c) => {
  const user = c.get('user')
  if (isAdminPlateforme(user) || !user.boutique_id)
    return c.json({ success: false, error: 'Les séries Mobilax se lisent avec la clé d\'une boutique : réservées à ses utilisateurs.' }, 403)

  const texte = (c.req.query('q') ?? '').trim()
  if (!texte)
    return c.json({ success: false, error: 'Saisissez le nom d\'une génération, ex. « iPhone 17 ».' }, 400)

  const r = await seriesDeGeneration(
    { db: c.get('db'), kv: c.env.KV, cleChiffrement: c.env.FOURNISSEUR_CRYPTO_KEY, baseUrl: c.env.MOBILAX_API_BASE },
    user.boutique_id,
    texte,
  )
  if (r.ok) return c.json({ success: true, data: { series: r.series } })
  return c.json({ success: false, error: r.message, code: r.erreur, reessayer_dans_s: r.reessayer_dans_s }, STATUT_PAR_ERREUR[r.erreur])
})

// ── GET /api/mobilax/apercu?series= ───────────────────────────────────────────
// Ticket 02 `import-par-generation` : aperçu des séries cochées (`?series=2358,2360`). Coûte un
// appel au quota par série et par page : une liste invalide est refusée AVANT tout appel.
// Mêmes gardes que la recherche.
mobilax.get('/mobilax/apercu', async (c) => {
  const user = c.get('user')
  if (isAdminPlateforme(user) || !user.boutique_id)
    return c.json({ success: false, error: 'L\'aperçu Mobilax utilise la clé d\'une boutique : réservé à ses utilisateurs.' }, 403)

  const brut = c.req.query('series') ?? ''
  const seriesIds = brut.split(',').map(Number)
  if (!brut || seriesIds.some(id => !Number.isInteger(id) || id <= 0))
    return c.json({ success: false, error: 'Liste de séries invalide.' }, 400)

  const r = await apercuGeneration(
    { db: c.get('db'), kv: c.env.KV, cleChiffrement: c.env.FOURNISSEUR_CRYPTO_KEY, baseUrl: c.env.MOBILAX_API_BASE },
    user.boutique_id,
    seriesIds,
  )
  if (r.ok) return c.json({ success: true, data: { fournisseur_id: r.fournisseur_id, series: r.series, articles: r.articles } })
  return c.json({ success: false, error: r.message, code: r.erreur, reessayer_dans_s: r.reessayer_dans_s }, STATUT_PAR_ERREUR[r.erreur])
})

// ── POST /api/mobilax/import ─────────────────────────────────────────────────
// Ticket 04 : une pièce trouvée devient un produit du stock. L'identifiant Mobilax voyage dans
// le corps, pas dans l'URL — ce n'est pas une ressource locale. Rôles de `POST /produits`
// (manager et admin de boutique). Import fermé à l'admin plateforme : la plateforme ne fait pas de commerce
// (décision du 2026-09-11), même quand la recherche lui sera ouverte en supervision.
mobilax.post('/mobilax/import', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  // Même lecture que la recherche : admin plateforme refusé, et tout compte sans boutique
  // (onboarding inachevé, données corrompues) n'a ni clé ni stock où importer.
  if (isAdminPlateforme(user) || !user.boutique_id)
    return c.json({ success: false, error: 'L\'import dans le stock est réservé aux utilisateurs de la boutique.' }, 403)

  const body = await c.req.json().catch(() => ({})) as { mobilax_id?: unknown; quantite_en_rayon?: unknown }
  const mobilaxId = body.mobilax_id
  if (typeof mobilaxId !== 'number' || !Number.isInteger(mobilaxId) || mobilaxId <= 0)
    return c.json({ success: false, error: 'Identifiant de pièce Mobilax manquant ou invalide.' }, 400)

  // « Qté en rayon » (ticket 05) : validée par le service AVANT tout appel à Mobilax — 400
  // `quantite_invalide` sans quota brûlé ; absente → stock initial par défaut de la boutique
  const r = await importerProduitMobilax(
    { db: c.get('db'), d1: c.env.DB, kv: c.env.KV, cleChiffrement: c.env.FOURNISSEUR_CRYPTO_KEY, baseUrl: c.env.MOBILAX_API_BASE },
    user.boutique_id, user.sub, mobilaxId, body.quantite_en_rayon,
  )
  // Famille du produit créé : le bilan de l'import par génération la répartit (ticket 03)
  if (r.ok) return c.json({ success: true, data: { produit_id: r.produit_id, famille: r.famille } }, 201)
  // 409 `deja_importe` : le produit existant sous `data`, comme en succès — enveloppe du dépôt
  return c.json({
    success: false, error: r.message, code: r.erreur, reessayer_dans_s: r.reessayer_dans_s,
    ...(r.produit_id === undefined ? {} : { data: { produit_id: r.produit_id } }),
  }, STATUT_PAR_ERREUR[r.erreur])
})

// ── POST /api/mobilax/produits/:id/ajout-stock ────────────────────────────────
// Ticket 18 `vente-lit-catalogue` : « Ajouter N au stock » sur une pièce déjà en stock — le geste
// explicite que l'import n'accomplit jamais tout seul (règle du 2026-09-12). Une entrée de stock
// tracée, sans aucun appel à Mobilax. Mêmes rôles et mêmes refus que l'import ; le produit doit
// être de la boutique du jeton (filtre porté par la requête du service), sinon 404 — l'existence
// d'un produit d'une autre boutique n'est pas confirmée.
mobilax.post('/mobilax/produits/:id/ajout-stock', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  if (isAdminPlateforme(user) || !user.boutique_id)
    return c.json({ success: false, error: 'L\'ajout au stock est réservé aux utilisateurs de la boutique.' }, 403)

  const produitId = Number(c.req.param('id'))
  if (!Number.isInteger(produitId) || produitId <= 0)
    return c.json({ success: false, error: 'Produit invalide.' }, 400)

  // AVANT (2026-09-25, point 1 de la relecture : clé d'ajout) : const body = await c.req.json().catch(() => ({})) as { quantite?: unknown }
  const body = await c.req.json().catch(() => ({})) as { quantite?: unknown; cle?: unknown }
  if (typeof body.quantite !== 'number' || !Number.isInteger(body.quantite) || body.quantite < 1)
    return c.json({ success: false, error: 'La quantité à ajouter doit être un entier supérieur ou égal à 1.' }, 400)
  // Clé tirée par l'écran pour cette offre : sans elle, un second clic (réponse perdue) ne se
  // reconnaîtrait pas — refus plutôt qu'un ajout à l'aveugle (point 1, migration 0051)
  if (typeof body.cle !== 'string' || !MOTIF_CLE_AJOUT.test(body.cle))
    return c.json({ success: false, error: 'Clé d\'ajout absente ou invalide : rouvrez la fiche depuis l\'import.' }, 400)

  // AVANT (2026-09-25, point 1 : clé d'ajout) : const r = await ajouterStockPieceImportee(c.get('db'), user.boutique_id, user.sub, produitId, body.quantite)
  const r = await ajouterStockPieceImportee(c.get('db'), user.boutique_id, user.sub, produitId, body.quantite, body.cle)
  if (!r) return c.json({ success: false, error: 'Produit introuvable.' }, 404)
  if ('erreur' in r) return c.json({
    success: false, code: r.erreur,
    error: r.erreur === 'cle_en_cours'
      ? 'Cet ajout a été lancé mais son résultat n\'est pas confirmé : vérifiez le stock de la pièce avant tout nouvel ajout.'
      : 'Cette clé d\'ajout a déjà servi pour un autre ajout.',
  }, 409)
  return c.json({ success: true, data: r })
})

export default mobilax
