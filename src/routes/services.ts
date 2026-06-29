/**
 * @module routes/services
 * @description Controller Catalogue Services hiérarchique (P1 MVC — 0 SQL ici).
 *
 * Rôle architectural :
 *   Controller pur (P1 Modularité) — orchestration HTTP uniquement.
 *   Toute logique métier et SQL est déléguée à `servicesService.ts` (Model).
 *   Toute validation d'entrée est déléguée à `validators.ts`.
 *
 * Sprint 2.4 — MOD-04 Catalogue Services
 *
 * Structure hiérarchique gérée :
 *   Catégorie parente → Sous-catégories → Services (prestations)
 *   Soft delete cascade : supprimer une catégorie désactive ses services.
 *
 * Endpoints :
 *   GET    /api/services/catalogue        → Arbre complet (catégories + services imbriqués)
 *   GET    /api/services/categories       → Liste plate des catégories actives
 *   POST   /api/services/categories       → Créer une catégorie (admin/manager)
 *   PUT    /api/services/categories/:id   → Modifier une catégorie (admin/manager)
 *   DELETE /api/services/categories/:id   → Désactiver une catégorie + ses services (admin/manager)
 *   GET    /api/services                  → Liste services paginée avec filtres
 *   GET    /api/services/:id              → Détail d'un service
 *   POST   /api/services                  → Créer un service (admin/manager)
 *   PUT    /api/services/:id              → Modifier un service (admin/manager)
 *   DELETE /api/services/:id              → Désactiver un service (admin/manager, soft delete)
 *
 * Sécurité :
 *   Toutes les routes requièrent `authMiddleware` (appliqué globalement).
 *   Les mutations (POST/PUT/DELETE) requièrent `requireRole('admin', 'manager')`.
 *
 * Format de réponse (P5 uniforme) : `{ success, data?, error?, message? }`
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

/**
 * GET /api/services/catalogue
 * Retourne l'arbre hiérarchique complet du catalogue (catégories + services imbriqués).
 *
 * Délègue à `getCatalogueArbre()` qui effectue 2 requêtes D1 en parallèle
 * et construit la structure en mémoire :
 * ```json
 * [
 *   {
 *     "id": 1, "nom": "Réparations",
 *     "enfants": [{ "id": 2, "nom": "Smartphones", "services": [...] }],
 *     "services": [...]
 *   }
 * ]
 * ```
 *
 * Query params :
 *   `boutique_id` (requis admin, ignoré pour autres rôles)
 *
 * @returns 200 `{ success: true, data: CatalogueArbre[] }`
 * @returns 400 si boutique_id manquant
 */
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

/**
 * GET /api/services/categories
 * Retourne la liste plate des catégories actives d'une boutique.
 * Inclut les catégories parentes et sous-catégories (non imbriquées).
 *
 * Query params :
 *   `boutique_id` (requis admin, ignoré pour autres rôles)
 *
 * @returns 200 `{ success: true, data: CategorieService[] }`
 * @returns 400 si boutique_id manquant
 */
services.get('/services/categories', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await listCategories(c.env.DB, boutiqueId)
  return c.json({ success: true, data })
})

/**
 * POST /api/services/categories
 * Crée une nouvelle catégorie de services. Réservé à `admin` et `manager`.
 * Validation déléguée à `validateCategorieService()`.
 *
 * Body JSON :
 * ```json
 * {
 *   "nom":       "Réparations",
 *   "parent_id": null,          // optionnel — null = catégorie racine
 *   "description": "...",       // optionnel
 *   "couleur":   "#FF5733",     // optionnel
 *   "boutique_id": 1            // admin seulement, ignoré sinon
 * }
 * ```
 *
 * @returns 201 `{ success: true, id: number, message: 'Catégorie créée.' }`
 * @returns 400 si validation échouée
 */
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

/**
 * PUT /api/services/categories/:id
 * Modifie une catégorie existante. Réservé à `admin` et `manager`.
 * Validation déléguée à `validateCategorieService()`.
 *
 * Body JSON : même structure que POST.
 *
 * @param id  Identifiant numérique de la catégorie
 * @returns 200 `{ success: true, message: 'Catégorie mise à jour.' }`
 * @returns 400 si validation échouée
 */
services.put('/services/categories/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  const error = validateCategorieService(body)
  if (error) return c.json({ success: false, error }, 400)

  await updateCategorie(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Catégorie mise à jour.' })
})

/**
 * DELETE /api/services/categories/:id
 * Désactive une catégorie (soft delete) et cascade sur tous ses services.
 * Réservé à `admin` et `manager`.
 *
 * Les données sont conservées en base (`actif = 0`).
 * La cascade désactive aussi les sous-catégories et leurs services.
 *
 * @param id  Identifiant numérique de la catégorie à désactiver
 * @returns 200 `{ success: true, message: 'Catégorie désactivée (et ses services).' }`
 */
services.delete('/services/categories/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  await deleteCategorie(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Catégorie désactivée (et ses services).' })
})

// ══════════════════════════════════════════════════════════════════════════════
// SERVICES (PRESTATIONS)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/services
 * Liste les services actifs d'une boutique avec pagination et filtres.
 *
 * Query params :
 *   `boutique_id`   (requis admin, ignoré pour autres rôles)
 *   `categorie_id`  (optionnel, filtre par catégorie)
 *   `page`          (optionnel, défaut 1)
 *   `limit`         (optionnel, défaut 20, max 100)
 *   `search`        (optionnel, recherche dans nom et description)
 *
 * @returns 200 `{ success: true, data: Service[], total, page, limit }`
 * @returns 400 si boutique_id manquant
 */
services.get('/services', async (c) => {
  const user       = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listServices(c.env.DB, boutiqueId, query)
  return c.json({ success: true, ...result })
})

/**
 * GET /api/services/:id
 * Retourne le détail d'un service (avec sa catégorie).
 *
 * @param id  Identifiant numérique du service
 * @returns 200 `{ success: true, data: Service }`
 * @returns 404 si service introuvable ou inactif
 */
services.get('/services/:id', async (c) => {
  const id      = parseInt(c.req.param('id'), 10)
  const service = await getService(c.env.DB, id)
  if (!service) return c.json({ success: false, error: 'Service introuvable.' }, 404)
  return c.json({ success: true, data: service })
})

/**
 * POST /api/services
 * Crée un nouveau service (prestation). Réservé à `admin` et `manager`.
 * Validation déléguée à `validateService()`.
 *
 * Body JSON :
 * ```json
 * {
 *   "nom":          "Remplacement écran iPhone 14",
 *   "categorie_id": 2,
 *   "prix_ht":      80.00,
 *   "tva_taux":     20,         // 0 | 5.5 | 10 | 20
 *   "duree_minutes": 60,        // optionnel
 *   "description":  "...",      // optionnel
 *   "boutique_id":  1           // admin seulement
 * }
 * ```
 *
 * @returns 201 `{ success: true, id: number, message: 'Service créé.' }`
 * @returns 400 si validation échouée
 */
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

/**
 * PUT /api/services/:id
 * Modifie un service existant. Réservé à `admin` et `manager`.
 * Validation déléguée à `validateService()`.
 * Vérifie l'existence du service avant mise à jour (retourne 404 si introuvable).
 *
 * Body JSON : même structure que POST.
 *
 * @param id  Identifiant numérique du service
 * @returns 200 `{ success: true, message: 'Service mis à jour.' }`
 * @returns 400 si validation échouée
 * @returns 404 si service introuvable
 */
services.put('/services/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  const error = validateService(body)
  if (error) return c.json({ success: false, error }, 400)

  // Vérification existence avant tentative de mise à jour
  const existing = await getService(c.env.DB, id)
  if (!existing) return c.json({ success: false, error: 'Service introuvable.' }, 404)

  await updateService(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Service mis à jour.' })
})

/**
 * DELETE /api/services/:id
 * Désactive un service (soft delete — `actif = 0`).
 * Réservé à `admin` et `manager`.
 * Les données sont conservées en base pour l'historique.
 *
 * @param id  Identifiant numérique du service à désactiver
 * @returns 200 `{ success: true, message: 'Service désactivé.' }`
 * @returns 404 si service introuvable
 */
services.delete('/services/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  // Vérification existence avant soft delete
  const existing = await getService(c.env.DB, id)
  if (!existing) return c.json({ success: false, error: 'Service introuvable.' }, 404)

  await deleteService(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Service désactivé.' })
})

export default services
