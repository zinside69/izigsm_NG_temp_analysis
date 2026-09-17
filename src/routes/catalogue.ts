/**
 * routes/catalogue.ts — Controller de la recherche catalogue unifiée (0 SQL ici)
 *
 * Endpoints :
 *   GET /api/catalogue/recherche?q=  → résultats typés de la boutique consultée (ticket 02
 *                                      du chantier `vente-lit-catalogue`)
 *
 * Toute la logique vit dans `catalogueService.ts`.
 */

import { Hono } from 'hono'
import { authMiddleware, getBoutiqueId } from '../lib/middleware'
import type { Database } from '../ports/database'
import { rechercherCatalogue } from '../services/catalogueService'

type Bindings  = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any; db: Database }

const catalogue = new Hono<{ Bindings: Bindings; Variables: Variables }>()
catalogue.use('/catalogue/*', authMiddleware)

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/catalogue/recherche
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Recherche un article du catalogue par nom, SKU ou code-barres.
 * @query q            Texte recherché (obligatoire, non vide)
 * @query boutique_id  Boutique consultée (admin plateforme)
 * @returns 200 `{ success, data: ResultatCatalogue[] }` · 400 si `q` vide ou aucune boutique résolue
 */
catalogue.get('/catalogue/recherche', async (c) => {
  const boutiqueId = getBoutiqueId(c.get('user'), c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const texte = (c.req.query('q') ?? '').trim()
  if (!texte) return c.json({ success: false, error: 'Texte de recherche obligatoire.' }, 400)

  const data = await rechercherCatalogue(c.get('db'), boutiqueId, texte)
  return c.json({ success: true, data })
})

export default catalogue
