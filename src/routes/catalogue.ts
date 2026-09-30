/**
 * routes/catalogue.ts — Controller de la recherche catalogue unifiée (0 SQL ici)
 *
 * Endpoints :
 *   GET /api/catalogue/recherche?q=  → résultats typés de la boutique consultée (ticket 02
 *                                      du chantier `vente-lit-catalogue`)
 *   GET /api/catalogue/recherche?scan= → scan de douchette routé par `routerScan()` (ticket 04) :
 *                                      `{ type_scan, resultats }`
 *
 * Toute la logique vit dans `catalogueService.ts`.
 */

import { Hono } from 'hono'
import { authMiddleware, getBoutiqueId } from '../lib/middleware'
import type { Database } from '../ports/database'
// AVANT (2026-09-30, ticket 04 `vente-lit-catalogue` — ajout de la recherche par code scanné) : import { rechercherCatalogue } from '../services/catalogueService'
import { rechercherCatalogue, rechercherParCode } from '../services/catalogueService'
import { routerScan } from '../lib/scan'

type Bindings  = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any; db: Database }

const catalogue = new Hono<{ Bindings: Bindings; Variables: Variables }>()
catalogue.use('/catalogue/*', authMiddleware)

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/catalogue/recherche
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Recherche un article du catalogue par nom, SKU ou code-barres.
 * @query q            Texte recherché (obligatoire, non vide) — ou :
 * @query scan         Saisie brute de la douchette : 13 chiffres → égalité code-barres/SKU,
 *                     15 chiffres → IMEI, sinon recherche texte. Exclusif de `q`.
 * @query boutique_id  Boutique consultée (admin plateforme)
 * @returns 200 `{ success, data: ResultatCatalogue[] }` (q) ou `{ success, data: { type_scan,
 *          resultats } }` (scan) · 400 si saisie vide, `q` et `scan` ensemble, ou aucune boutique
 */
catalogue.get('/catalogue/recherche', async (c) => {
  const boutiqueId = getBoutiqueId(c.get('user'), c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  // Scan de douchette (ticket 04) : le serveur route la saisie brute par sa longueur
  const scan = c.req.query('scan')
  if (scan !== undefined) {
    if (c.req.query('q') !== undefined)
      return c.json({ success: false, error: 'Utiliser scan ou q, pas les deux.' }, 400)
    const route = routerScan(scan)
    if (!route.valeur) return c.json({ success: false, error: 'Scan vide.' }, 400)

    const db = c.get('db')
    const resultats =
      route.type === 'code_barre' ? await rechercherParCode(db, boutiqueId, route.valeur)
      // IMEI : aucune colonne IMEI sur les produits avant le ticket 07 — liste vide, aucune requête
      : route.type === 'imei'     ? []
      :                             await rechercherCatalogue(db, boutiqueId, route.valeur)
    return c.json({ success: true, data: { type_scan: route.type, resultats } })
  }

  const texte = (c.req.query('q') ?? '').trim()
  if (!texte) return c.json({ success: false, error: 'Texte de recherche obligatoire.' }, 400)

  const data = await rechercherCatalogue(c.get('db'), boutiqueId, texte)
  return c.json({ success: true, data })
})

export default catalogue
