/**
 * @module phoneCatalogService
 * @description Synchronisation du référentiel global marques/modèles
 *              depuis l'API externe phone-specs-api.vercel.app.
 *
 * Pattern identique au create.php legacy (Sprint 2.39) :
 *   GET /brands              → liste des marques (brand_slug, brand_name, device_count)
 *   GET /brands/{slug}?page=N → modèles paginés (phone_name, slug, image)
 *                               last_page indique le nombre de pages total
 *
 * Stratégie d'import :
 *   - INSERT OR IGNORE sur brand_slug / phone_slug → idempotent, jamais d'écrasement
 *   - Les entrées 'manual' ne sont jamais touchées par la sync
 *   - Un log par marque dans phone_catalog_sync_log
 *
 * Appels Cloudflare Workers : utilise fetch() natif (Web API, pas Node.js)
 *
 * Sprint 2.39 — MOD-15 catalogue complet
 */

const API_BASE = 'https://phone-specs-api.vercel.app'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiBrand {
  brand_id:     number
  brand_name:   string
  brand_slug:   string
  device_count: number
}

export interface ApiPhone {
  brand:      string
  phone_name: string
  slug:       string
  image:      string | null
}

export interface SyncBrandsResult {
  inserted: number
  skipped:  number
  total:    number
  brands:   ApiBrand[]
}

export interface SyncModelesResult {
  brand_slug:     string
  brand_nom:      string
  modeles_added:  number
  modeles_total:  number
  pages_fetched:  number
  status:         'success' | 'error'
  error?:         string
}

export interface SyncAllResult {
  brands_synced:  number
  brands_failed:  number
  modeles_added:  number
  modeles_total:  number
  results:        SyncModelesResult[]
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function apiFetch(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    // Cloudflare Workers : cf cache pour réduire les appels répétés
    cf: { cacheTtl: 3600, cacheEverything: true } as any,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`)
  return resp.json()
}

// ─── syncBrands ───────────────────────────────────────────────────────────────

/**
 * Récupère toutes les marques depuis l'API et les insère dans `marques_appareils`.
 * INSERT OR IGNORE sur brand_slug → idempotent.
 * Met à jour device_count et synced_at si la marque existe déjà (source API).
 *
 * @returns SyncBrandsResult — nb insérées, ignorées, total, liste brute
 */
export async function syncBrands(db: D1Database): Promise<SyncBrandsResult> {
  const data = await apiFetch(`${API_BASE}/brands`)
  if (!data.status || !Array.isArray(data.data)) {
    throw new Error('Réponse API /brands invalide.')
  }

  const brands: ApiBrand[] = data.data
  let inserted = 0
  let skipped  = 0

  for (const b of brands) {
    // INSERT si slug inconnu
    const res = await db.prepare(`
      INSERT OR IGNORE INTO marques_appareils (nom, brand_slug, device_count, source, synced_at)
      VALUES (?, ?, ?, 'api', CURRENT_TIMESTAMP)
    `).bind(b.brand_name.trim(), b.brand_slug, b.device_count).run()

    if (res.meta.changes === 0) {
      // Déjà existante — mise à jour device_count si source API
      await db.prepare(`
        UPDATE marques_appareils
        SET device_count = ?, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE brand_slug = ? AND source = 'api'
      `).bind(b.device_count, b.brand_slug).run()
      skipped++
    } else {
      inserted++
    }
  }

  return { inserted, skipped, total: brands.length, brands }
}

// ─── syncModelesByBrand ───────────────────────────────────────────────────────

/**
 * Synchronise tous les modèles d'une marque depuis l'API.
 * Pattern identique au create.php PHP legacy :
 *   1. Fetch page 1 → récupère last_page
 *   2. Promise.all pages 2..last_page en parallèle
 *   3. INSERT OR IGNORE sur phone_slug (idempotent)
 *
 * Cloudflare Workers : max 50 requêtes fetch() simultanées recommandé.
 * On chunk les pages par lots de 10 pour éviter les timeouts.
 *
 * @param db        D1 binding
 * @param brandSlug slug API ex: "apple-phones-48"
 * @param logId     optionnel — id du log existant à mettre à jour
 */
export async function syncModelesByBrand(
  db: D1Database,
  brandSlug: string,
  logId?: number
): Promise<SyncModelesResult> {
  // Récupérer l'id de la marque en base
  const marque = await db.prepare(`
    SELECT id, nom FROM marques_appareils WHERE brand_slug = ? AND actif = 1
  `).bind(brandSlug).first<{ id: number; nom: string }>()

  if (!marque) {
    return { brand_slug: brandSlug, brand_nom: '', modeles_added: 0, modeles_total: 0, pages_fetched: 0, status: 'error', error: `Marque introuvable en base pour slug: ${brandSlug}` }
  }

  // Log démarrage
  const logRow = logId
    ? { id: logId }
    : await db.prepare(`
        INSERT INTO phone_catalog_sync_log (brand_slug, brand_nom, status)
        VALUES (?, ?, 'pending')
        RETURNING id
      `).bind(brandSlug, marque.nom).first<{ id: number }>()

  try {
    // Page 1
    const firstPage = await apiFetch(`${API_BASE}/brands/${brandSlug}?page=1`)
    if (!firstPage.status || !firstPage.data) {
      throw new Error(`API /brands/${brandSlug} : réponse invalide`)
    }

    const lastPage: number = firstPage.data.last_page ?? 1
    let allPhones: ApiPhone[] = [...(firstPage.data.phones ?? [])]

    // Pages suivantes par chunks de 10 (évite saturation CF Workers)
    if (lastPage > 1) {
      const pageNums = Array.from({ length: lastPage - 1 }, (_, i) => i + 2)
      const CHUNK_SIZE = 10
      for (let i = 0; i < pageNums.length; i += CHUNK_SIZE) {
        const chunk = pageNums.slice(i, i + CHUNK_SIZE)
        const results = await Promise.all(
          chunk.map(p => apiFetch(`${API_BASE}/brands/${brandSlug}?page=${p}`))
        )
        for (const res of results) {
          if (res.status && res.data?.phones) {
            allPhones = allPhones.concat(res.data.phones)
          }
        }
      }
    }

    // Déduplication sur phone_slug (l'API peut parfois dupliquer)
    const seen  = new Set<string>()
    const uniq  = allPhones.filter(p => {
      if (!p.slug || seen.has(p.slug)) return false
      seen.add(p.slug)
      return true
    })

    // Détection du type depuis le nom (heuristique simple)
    function guessType(name: string): string {
      const n = name.toLowerCase()
      if (n.includes('ipad') || n.includes('tab') || n.includes('tablet')) return 'tablette'
      if (n.includes('watch') || n.includes('gear') || n.includes('band')) return 'montre'
      if (n.includes('book') || n.includes('laptop') || n.includes('chromebook') || n.includes('macbook')) return 'pc'
      return 'smartphone'
    }

    // INSERT en batch D1 (une requête par modèle — D1 ne supporte pas les INSERT multi-lignes via bind)
    let modeles_added = 0
    for (const phone of uniq) {
      const res = await db.prepare(`
        INSERT OR IGNORE INTO modeles_appareils (marque_id, nom, phone_slug, type, image_url, source)
        VALUES (?, ?, ?, ?, ?, 'api')
      `).bind(
        marque.id,
        phone.phone_name.trim(),
        phone.slug,
        guessType(phone.phone_name),
        phone.image ?? null
      ).run()
      if (res.meta.changes > 0) modeles_added++
    }

    // Mettre à jour synced_at sur la marque
    await db.prepare(`
      UPDATE marques_appareils SET synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(marque.id).run()

    // Mettre à jour le log
    if (logRow?.id) {
      await db.prepare(`
        UPDATE phone_catalog_sync_log
        SET status = 'success', modeles_added = ?, modeles_total = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(modeles_added, uniq.length, logRow.id).run()
    }

    return {
      brand_slug:    brandSlug,
      brand_nom:     marque.nom,
      modeles_added,
      modeles_total: uniq.length,
      pages_fetched: lastPage,
      status:        'success',
    }

  } catch (err: any) {
    if (logRow?.id) {
      await db.prepare(`
        UPDATE phone_catalog_sync_log
        SET status = 'error', error_msg = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(err.message ?? 'Erreur inconnue', logRow.id).run()
    }
    return {
      brand_slug:    brandSlug,
      brand_nom:     marque.nom,
      modeles_added: 0,
      modeles_total: 0,
      pages_fetched: 0,
      status:        'error',
      error:         err.message ?? 'Erreur inconnue',
    }
  }
}

// ─── syncAllBrands ────────────────────────────────────────────────────────────

/**
 * Synchronise toutes les marques puis leurs modèles depuis l'API.
 * Appelé depuis la route POST /api/services/sync-all.
 *
 * ATTENTION : opération longue (~7000 modèles × N requêtes HTTP).
 * Cloudflare Workers CPU limit = 30ms (paid) — cette fonction dépasse la limite
 * si appelée directement. Elle est conçue pour être utilisée en mode
 * "sync par marque" individuelle (syncModelesByBrand) depuis l'UI.
 *
 * Pour un sync complet, l'UI déclenche syncBrands() puis itère marque par marque.
 *
 * @param db          D1 binding
 * @param brandSlugs  liste de slugs à synchroniser (subset, pas toutes les 126)
 */
export async function syncSelectedBrands(
  db: D1Database,
  brandSlugs: string[]
): Promise<SyncAllResult> {
  let brands_synced  = 0
  let brands_failed  = 0
  let modeles_added  = 0
  let modeles_total  = 0
  const results: SyncModelesResult[] = []

  for (const slug of brandSlugs) {
    const res = await syncModelesByBrand(db, slug)
    results.push(res)
    if (res.status === 'success') {
      brands_synced++
      modeles_added += res.modeles_added
      modeles_total += res.modeles_total
    } else {
      brands_failed++
    }
  }

  return { brands_synced, brands_failed, modeles_added, modeles_total, results }
}

// ─── getLastSyncStatus ────────────────────────────────────────────────────────

/**
 * Retourne le statut de la dernière synchronisation par marque.
 * Utilisé par l'UI pour afficher l'état du référentiel.
 */
export async function getLastSyncStatus(db: D1Database): Promise<object[]> {
  const rows = await db.prepare(`
    SELECT
      m.id, m.nom, m.brand_slug, m.device_count, m.source, m.synced_at,
      COUNT(mo.id) AS modeles_en_base,
      l.status     AS last_sync_status,
      l.started_at AS last_sync_at,
      l.error_msg  AS last_sync_error
    FROM marques_appareils m
    LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1
    LEFT JOIN (
      SELECT brand_slug, status, started_at, error_msg,
             ROW_NUMBER() OVER (PARTITION BY brand_slug ORDER BY started_at DESC) AS rn
      FROM phone_catalog_sync_log
    ) l ON l.brand_slug = m.brand_slug AND l.rn = 1
    WHERE m.actif = 1
    GROUP BY m.id
    ORDER BY m.nom ASC
  `).all()
  return rows.results
}

/**
 * Retourne les stats globales du catalogue.
 */
export async function getCatalogStats(db: D1Database): Promise<{
  total_marques: number
  total_modeles: number
  marques_api:   number
  modeles_api:   number
  last_sync:     string | null
}> {
  const [stats, lastSync] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(DISTINCT m.id)                                   AS total_marques,
        COUNT(mo.id)                                           AS total_modeles,
        COUNT(DISTINCT CASE WHEN m.source='api' THEN m.id END) AS marques_api,
        COUNT(CASE WHEN mo.source='api' THEN mo.id END)        AS modeles_api
      FROM marques_appareils m
      LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1
      WHERE m.actif = 1
    `).first<any>(),
    db.prepare(`
      SELECT MAX(started_at) AS last_sync FROM phone_catalog_sync_log WHERE status = 'success'
    `).first<{ last_sync: string | null }>(),
  ])

  return {
    total_marques: stats?.total_marques ?? 0,
    total_modeles: stats?.total_modeles ?? 0,
    marques_api:   stats?.marques_api   ?? 0,
    modeles_api:   stats?.modeles_api   ?? 0,
    last_sync:     lastSync?.last_sync  ?? null,
  }
}
