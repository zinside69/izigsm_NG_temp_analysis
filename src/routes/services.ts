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
 * Sprint 2.38 — MOD-15 : Référentiel marques/modèles + liaison services suggérés
 *
 * Structure hiérarchique gérée :
 *   Catégorie parente → Sous-catégories → Services (prestations)
 *   Soft delete cascade : supprimer une catégorie désactive ses services.
 *
 * Endpoints :
 *   GET    /api/services/catalogue              → Arbre complet (catégories + services imbriqués)
 *   GET    /api/services/categories             → Liste plate des catégories actives
 *   POST   /api/services/categories             → Créer une catégorie (admin/manager)
 *   PUT    /api/services/categories/:id         → Modifier une catégorie (admin/manager)
 *   DELETE /api/services/categories/:id         → Désactiver une catégorie + ses services (admin/manager)
 *   GET    /api/services                        → Liste services paginée avec filtres
 *   GET    /api/services/:id                    → Détail d'un service
 *   POST   /api/services                        → Créer un service (admin/manager)
 *   PUT    /api/services/:id                    → Modifier un service (admin/manager)
 *   DELETE /api/services/:id                    → Désactiver un service (admin/manager, soft delete)
 *
 *   Sprint 2.38 — Marques / Modèles / Liaisons
 *   GET    /api/services/marques                → Liste marques actives (avec nb_modeles)
 *   POST   /api/services/marques                → Créer une marque (admin uniquement — référentiel global)
 *   PUT    /api/services/marques/:id            → Modifier une marque (admin uniquement — référentiel global)
 *   DELETE /api/services/marques/:id            → Désactiver une marque + modèles (admin uniquement — référentiel global)
 *   GET    /api/services/modeles                → Liste modèles (filtre: marque_id, search, type)
 *   POST   /api/services/modeles                → Créer un modèle (admin uniquement — référentiel global)
 *   PUT    /api/services/modeles/:id            → Modifier un modèle (admin uniquement — référentiel global)
 *   DELETE /api/services/modeles/:id            → Désactiver un modèle (admin uniquement — référentiel global)
 *   GET    /api/services/modeles/:id/services   → Services suggérés pour un modèle
 *                                                 (filtrés sur la boutique de l'appelant)
 *   POST   /api/services/modeles/:id/services   → Lier un service à un modèle (admin/manager)
 *   DELETE /api/services/modeles/:id/services/:sid → Délier un service d'un modèle (admin/manager)
 *
 * Sécurité :
 *   Toutes les routes requièrent `authMiddleware` (appliqué globalement).
 *   Les mutations (POST/PUT/DELETE) requièrent `requireRole('admin', 'manager')`,
 *   sauf TOUTE écriture sur le référentiel global marques/modèles — création
 *   comprise (POST/PUT/DELETE marques et modeles, 6 routes) — réservée à
 *   `requireRole('admin')`.
 *
 * Format de réponse (P5 uniforme) : `{ success, data?, error?, message? }`
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId, assertBoutiqueOwnership } from '../lib/middleware'
import { validateService, validateCategorieService } from '../lib/validators'
import {
  listCategories, createCategorie, updateCategorie, deleteCategorie, getCategorieBoutiqueId,
  listServices, getService, createService, updateService, deleteService,
  getCatalogueArbre,
  listMarques, createMarque, updateMarque, deleteMarque,
  listModeles, createModele, updateModele, deleteModele,
  getServicesByModele, linkServiceModele, unlinkServiceModele, getModeleWithServices,
} from '../services/servicesService'
import {
  syncBrands, syncModelesByBrand, syncSelectedBrands,
  getLastSyncStatus, getCatalogStats,
} from '../services/phoneCatalogService'

import type { Database } from '../ports/database'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any; db: Database }

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

  const arbre = await getCatalogueArbre(c.get('db'), boutiqueId)
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

  const data = await listCategories(c.get('db'), boutiqueId)
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

  // Isolation multi-tenant : ne jamais modifier la catégorie d'une autre boutique
  const categorie = await getCategorieBoutiqueId(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, categorie, 'Catégorie')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

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

  // Isolation multi-tenant : la désactivation cascade sur les services liés,
  // ne jamais désactiver la catégorie d'une autre boutique
  const categorie = await getCategorieBoutiqueId(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, categorie, 'Catégorie')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

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

  const result = await listServices(c.get('db'), boutiqueId, query)
  return c.json({ success: true, ...result })
})

/**
 * GET /api/services/marques — Liste des marques actives globales avec nb_modeles
 * GET /api/services/modeles — Liste des modèles (filtrables par marque_id, search, type, limit)
 *
 * Déclarées AVANT /services/:id pour éviter la collision de route Hono
 * (même nombre de segments — /services/marques et /services/modeles seraient
 * sinon capturées par /services/:id avec id="marques"/"modeles", jamais atteintes).
 * Bug préexistant depuis Sprint 2.38, découvert en validation live de la migration
 * Ports & Adapters — même classe que /rachats/export dans routes/rachats.ts.
 */
services.get('/services/marques', async (c) => {
  const data = await listMarques(c.get('db'))
  return c.json({ success: true, data })
})

services.get('/services/modeles', async (c) => {
  const query = c.req.query()
  const data  = await listModeles(c.get('db'), {
    marque_id: query.marque_id ? parseInt(query.marque_id, 10) : undefined,
    search:    query.search,
    type:      query.type,
    limit:     query.limit ? parseInt(query.limit, 10) : undefined,
  })
  return c.json({ success: true, data })
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
  const service = await getService(c.get('db'), id)

  // Isolation multi-tenant : ne jamais servir le service d'une autre boutique
  const deny = assertBoutiqueOwnership(c.get('user'), service, 'Service')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

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

  // Isolation multi-tenant : ne jamais modifier le service d'une autre boutique
  const existing = await getService(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, existing, 'Service')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

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

  // Isolation multi-tenant : ne jamais désactiver le service d'une autre boutique
  const existing = await getService(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, existing, 'Service')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await deleteService(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Service désactivé.' })
})

// ══════════════════════════════════════════════════════════════════════════════
// SYNCHRONISATION PHONE-SPECS-API (Sprint 2.39)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/services/catalog/stats
 * Stats globales du référentiel (nb marques, modèles, dernière sync).
 */
services.get('/services/catalog/stats', async (c) => {
  const stats = await getCatalogStats(c.get('db'))
  return c.json({ success: true, data: stats })
})

/**
 * GET /api/services/catalog/sync-status
 * Statut de sync par marque (dernière sync, nb modèles, erreurs éventuelles).
 * Admin uniquement.
 */
services.get('/services/catalog/sync-status', requireRole('admin'), async (c) => {
  const data = await getLastSyncStatus(c.get('db'))
  return c.json({ success: true, data })
})

/**
 * POST /api/services/catalog/sync-brands
 * Importe toutes les marques depuis phone-specs-api (sans modèles).
 * Idempotent — INSERT OR IGNORE sur brand_slug.
 * Admin uniquement.
 */
services.post('/services/catalog/sync-brands', requireRole('admin'), async (c) => {
  const result = await syncBrands(c.get('db'))
  return c.json({ success: true, data: result, message: `${result.inserted} marques ajoutées, ${result.skipped} existantes.` })
})

/**
 * POST /api/services/catalog/sync-modeles/:slug
 * Synchronise les modèles d'une marque depuis phone-specs-api.
 * Récupère toutes les pages en parallèle (pattern PHP legacy).
 * Admin uniquement.
 *
 * @param slug  brand_slug ex: "apple-phones-48"
 */
services.post('/services/catalog/sync-modeles/:slug', requireRole('admin'), async (c) => {
  const slug   = c.req.param('slug')
  const result = await syncModelesByBrand(c.get('db'), slug)

  if (result.status === 'error') {
    return c.json({ success: false, error: result.error, data: result }, 422)
  }
  return c.json({
    success: true,
    data:    result,
    message: `${result.modeles_added} modèles ajoutés sur ${result.modeles_total} (${result.pages_fetched} pages).`,
  })
})

/**
 * POST /api/services/catalog/sync-selected
 * Synchronise les modèles d'une sélection de marques.
 * Body : { slugs: string[] }
 * Admin uniquement.
 */
services.post('/services/catalog/sync-selected', requireRole('admin'), async (c) => {
  const body = await c.req.json()
  if (!Array.isArray(body.slugs) || body.slugs.length === 0) {
    return c.json({ success: false, error: 'slugs[] requis.' }, 400)
  }
  const result = await syncSelectedBrands(c.get('db'), body.slugs)
  return c.json({ success: true, data: result })
})

// ══════════════════════════════════════════════════════════════════════════════
// MARQUES D'APPAREILS — Référentiel global (Sprint 2.38 + 2.39)
// ══════════════════════════════════════════════════════════════════════════════

// Référentiel marques/modèles GLOBAL (migration 0031, Sprint 2.39) : la création
// aussi est réservée à l'admin plateforme, au même titre que PUT/DELETE.
// Une marque créée par un manager entre dans le namespace partagé de TOUTES les
// boutiques (contrainte UNIQUE sur le nom : un tenant peut préempter un nom), et
// lui seul ne pourra plus la corriger — PUT/DELETE lui répondent 403. Laisser la
// création ouverte produisait donc des entrées globales que personne d'autre que
// l'admin plateforme ne peut réparer.
/** POST /api/services/marques — Créer une marque manuellement (admin uniquement) */
services.post('/services/marques', requireRole('admin'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  if (!body.nom?.trim()) return c.json({ success: false, error: 'Le nom de la marque est requis.' }, 400)

  try {
    const id = await createMarque(c.env.DB, body, user.sub)
    return c.json({ success: true, id, message: 'Marque créée.' }, 201)
  } catch (e: any) {
    if (e?.message?.includes('UNIQUE')) return c.json({ success: false, error: 'Cette marque existe déjà.' }, 409)
    throw e
  }
})

// Référentiel marques/modèles GLOBAL (migration 0031, Sprint 2.39) : partagé par
// toutes les boutiques. L'écriture est réservée à l'admin plateforme — sinon un
// manager renomme ou désactive une entrée visible par tous les autres tenants.
/** PUT /api/services/marques/:id — Modifier une marque */
services.put('/services/marques/:id', requireRole('admin'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  await updateMarque(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Marque mise à jour.' })
})

// Référentiel marques/modèles GLOBAL (migration 0031, Sprint 2.39) : partagé par
// toutes les boutiques. L'écriture est réservée à l'admin plateforme — sinon un
// manager renomme ou désactive une entrée visible par tous les autres tenants.
// Cas le plus dommageable des 4 routes : deleteMarque() cascade sur tous les
// modèles de la marque (UPDATE modeles_appareils SET actif = 0 WHERE marque_id = ?)
// avant de désactiver la marque elle-même — un manager neutraliserait donc une
// marque entière et tous ses modèles, pour toutes les boutiques.
/** DELETE /api/services/marques/:id — Désactiver une marque (+ ses modèles en cascade) */
services.delete('/services/marques/:id', requireRole('admin'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  await deleteMarque(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Marque désactivée (et ses modèles).' })
})

// ══════════════════════════════════════════════════════════════════════════════
// MODÈLES D'APPAREILS — Référentiel global (Sprint 2.38 + 2.39)
// ══════════════════════════════════════════════════════════════════════════════

// Référentiel marques/modèles GLOBAL (migration 0031, Sprint 2.39) : même raison
// que POST /services/marques ci-dessus — création réservée à l'admin plateforme.
// Le catalogue de modèles est par ailleurs alimenté par la synchronisation
// externe (`/services/catalog/sync-*`), elle aussi admin uniquement : la création
// manuelle est un complément, pas le canal d'approvisionnement normal.
/** POST /api/services/modeles — Créer un modèle manuellement (admin uniquement) */
services.post('/services/modeles', requireRole('admin'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  if (!body.nom?.trim()) return c.json({ success: false, error: 'Le nom du modèle est requis.' }, 400)
  if (!body.marque_id)   return c.json({ success: false, error: 'marque_id est requis.' }, 400)

  try {
    const id = await createModele(c.env.DB, body, user.sub)
    return c.json({ success: true, id, message: 'Modèle créé.' }, 201)
  } catch (e: any) {
    if (e?.message?.includes('UNIQUE')) return c.json({ success: false, error: 'Ce modèle existe déjà pour cette marque.' }, 409)
    throw e
  }
})

// Référentiel marques/modèles GLOBAL (migration 0031, Sprint 2.39) : partagé par
// toutes les boutiques. L'écriture est réservée à l'admin plateforme — sinon un
// manager renomme ou désactive une entrée visible par tous les autres tenants.
/** PUT /api/services/modeles/:id — Modifier un modèle */
services.put('/services/modeles/:id', requireRole('admin'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  await updateModele(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Modèle mis à jour.' })
})

// Référentiel marques/modèles GLOBAL (migration 0031, Sprint 2.39) : partagé par
// toutes les boutiques. L'écriture est réservée à l'admin plateforme — sinon un
// manager renomme ou désactive une entrée visible par tous les autres tenants.
/** DELETE /api/services/modeles/:id — Désactiver un modèle */
services.delete('/services/modeles/:id', requireRole('admin'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  await deleteModele(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Modèle désactivé.' })
})

// ── Liaisons service ↔ modèle ─────────────────────────────────────────────────

/**
 * GET /api/services/modeles/:id/services
 * Services suggérés pour un modèle + détail du modèle.
 *
 * Isolation multi-tenant : le modèle est global, mais les services liés appartiennent
 * chacun à une boutique. La liste renvoyée est filtrée sur la boutique de l'appelant —
 * sans ce filtre, n'importe quel technicien lisait les tarifs de ses concurrents
 * (`nom`, `description`, `prix_ht_effectif`, `prix_ttc_effectif`).
 *
 * `boutiqueId` est dérivé du JWT via `getBoutiqueId()`, jamais d'une valeur du corps
 * ou du chemin. L'admin plateforme (`boutique_id` NULL) doit désigner explicitement
 * une boutique via `?boutique_id=N` — même contrat que les autres routes de liste
 * (ex. `GET /api/bons-commande`) : pas de vue « toutes boutiques » par défaut, qui
 * rouvrirait la fuite pour ce rôle.
 */
services.get('/services/modeles/:id/services', async (c) => {
  const id         = parseInt(c.req.param('id'), 10)
  const boutiqueId = getBoutiqueId(c.get('user'), c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await getModeleWithServices(c.get('db'), id, boutiqueId)
  if (!data.modele) return c.json({ success: false, error: 'Modèle introuvable.' }, 404)
  return c.json({ success: true, data })
})

/**
 * POST /api/services/modeles/:id/services
 * Lie un service à un modèle (avec prix override optionnel).
 * Body : `{ service_id: number, prix_ht_specifique?: number }`
 *
 * Isolation multi-tenant : le modèle appartient au référentiel global (pas de
 * boutique_id, migration 0031), mais le service lié appartient bien à une
 * boutique — c'est donc son appartenance qu'il faut vérifier, pas celle du modèle.
 */
services.post('/services/modeles/:id/services', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const modeleId  = parseInt(c.req.param('id'), 10)
  const body      = await c.req.json()

  if (!body.service_id) return c.json({ success: false, error: 'service_id est requis.' }, 400)

  const serviceId = parseInt(body.service_id, 10)
  const service   = await getService(c.get('db'), serviceId)
  const deny      = assertBoutiqueOwnership(user, service, 'Service')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await linkServiceModele(c.env.DB, {
    service_id:          serviceId,
    modele_id:           modeleId,
    prix_ht_specifique:  body.prix_ht_specifique ?? null,
  }, user.sub)
  return c.json({ success: true, message: 'Service lié au modèle.' })
})

/**
 * DELETE /api/services/modeles/:id/services/:sid
 * Dissocie un service d'un modèle (soft delete liaison).
 *
 * Isolation multi-tenant : voir commentaire identique sur POST ci-dessus —
 * la garde porte sur le service (:sid), pas sur le modèle (:id).
 */
services.delete('/services/modeles/:id/services/:sid', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const modeleId  = parseInt(c.req.param('id'), 10)
  const serviceId = parseInt(c.req.param('sid'), 10)

  const service = await getService(c.get('db'), serviceId)
  const deny    = assertBoutiqueOwnership(user, service, 'Service')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await unlinkServiceModele(c.env.DB, { service_id: serviceId, modele_id: modeleId }, user.sub)
  return c.json({ success: true, message: 'Service dissocié du modèle.' })
})

export default services
