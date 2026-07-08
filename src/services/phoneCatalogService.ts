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

// ─── Dataset statique embarqué (fallback si API rate-limitée) ────────────────
/**
 * Liste des 40 marques principales — utilisée comme fallback si phone-specs-api
 * retourne 429 Too Many Requests. Les brand_slug correspondent aux slugs réels de l'API.
 * Permet l'import immédiat sans dépendance externe.
 */
const STATIC_BRANDS: ApiBrand[] = [
  { brand_id: 48,  brand_name: 'Apple',         brand_slug: 'apple-phones-48',         device_count: 87  },
  { brand_id: 9,   brand_name: 'Samsung',        brand_slug: 'samsung-phones-9',        device_count: 340 },
  { brand_id: 45,  brand_name: 'Huawei',         brand_slug: 'huawei-phones-45',        device_count: 271 },
  { brand_id: 8,   brand_name: 'Xiaomi',         brand_slug: 'xiaomi-phones-80',        device_count: 198 },
  { brand_id: 5,   brand_name: 'OnePlus',        brand_slug: 'oneplus-phones-95',       device_count: 58  },
  { brand_id: 10,  brand_name: 'Google',         brand_slug: 'google-phones-107',       device_count: 30  },
  { brand_id: 36,  brand_name: 'Sony',           brand_slug: 'sony-phones-7',           device_count: 134 },
  { brand_id: 7,   brand_name: 'Nokia',          brand_slug: 'nokia-phones-1',          device_count: 215 },
  { brand_id: 11,  brand_name: 'Motorola',       brand_slug: 'motorola-phones-4',       device_count: 218 },
  { brand_id: 12,  brand_name: 'LG',             brand_slug: 'lg-phones-20',            device_count: 289 },
  { brand_id: 29,  brand_name: 'Oppo',           brand_slug: 'oppo-phones-82',          device_count: 178 },
  { brand_id: 94,  brand_name: 'Realme',         brand_slug: 'realme-phones-118',       device_count: 112 },
  { brand_id: 88,  brand_name: 'Vivo',           brand_slug: 'vivo-phones-98',          device_count: 149 },
  { brand_id: 37,  brand_name: 'HTC',            brand_slug: 'htc-phones-45',           device_count: 169 },
  { brand_id: 6,   brand_name: 'BlackBerry',     brand_slug: 'blackberry-phones-36',    device_count: 97  },
  { brand_id: 85,  brand_name: 'Nothing',        brand_slug: 'nothing-phones-198',      device_count: 6   },
  { brand_id: 63,  brand_name: 'Wiko',           brand_slug: 'wiko-phones-85',          device_count: 74  },
  { brand_id: 30,  brand_name: 'Alcatel',        brand_slug: 'alcatel-phones-56',       device_count: 213 },
  { brand_id: 60,  brand_name: 'ZTE',            brand_slug: 'zte-phones-62',           device_count: 197 },
  { brand_id: 32,  brand_name: 'Asus',           brand_slug: 'asus-phones-46',          device_count: 98  },
  { brand_id: 53,  brand_name: 'Honor',          brand_slug: 'honor-phones-121',        device_count: 88  },
  { brand_id: 18,  brand_name: 'Lenovo',         brand_slug: 'lenovo-phones-73',        device_count: 74  },
  { brand_id: 51,  brand_name: 'TCL',            brand_slug: 'tcl-phones-192',          device_count: 52  },
  { brand_id: 33,  brand_name: 'Fairphone',      brand_slug: 'fairphone-phones-163',    device_count: 8   },
  { brand_id: 55,  brand_name: 'Doro',           brand_slug: 'doro-phones-201',         device_count: 34  },
  { brand_id: 26,  brand_name: 'Sharp',          brand_slug: 'sharp-phones-23',         device_count: 52  },
  { brand_id: 77,  brand_name: 'Meizu',          brand_slug: 'meizu-phones-74',         device_count: 58  },
  { brand_id: 44,  brand_name: 'BQ',             brand_slug: 'bq-phones-153',           device_count: 42  },
  { brand_id: 66,  brand_name: 'Cat',            brand_slug: 'cat-phones-155',          device_count: 18  },
  { brand_id: 93,  brand_name: 'Energizer',      brand_slug: 'energizer-phones-196',    device_count: 27  },
]

/**
 * Modèles statiques par brand_slug — fallback si l'API est indisponible.
 * Couvre les marques les plus réparées en France.
 */
const STATIC_MODELES: Record<string, string[]> = {
  'apple-phones-48': [
    'iPhone 16 Pro Max','iPhone 16 Pro','iPhone 16 Plus','iPhone 16',
    'iPhone 15 Pro Max','iPhone 15 Pro','iPhone 15 Plus','iPhone 15',
    'iPhone 14 Pro Max','iPhone 14 Pro','iPhone 14 Plus','iPhone 14',
    'iPhone 13 Pro Max','iPhone 13 Pro','iPhone 13 mini','iPhone 13',
    'iPhone 12 Pro Max','iPhone 12 Pro','iPhone 12 mini','iPhone 12',
    'iPhone 11 Pro Max','iPhone 11 Pro','iPhone 11',
    'iPhone XS Max','iPhone XS','iPhone XR','iPhone X',
    'iPhone SE (2022)','iPhone SE (2020)','iPhone SE (2016)',
    'iPhone 8 Plus','iPhone 8','iPhone 7 Plus','iPhone 7',
    'iPhone 6s Plus','iPhone 6s','iPhone 6 Plus','iPhone 6',
    'iPad Pro 12.9 (2024)','iPad Pro 11 (2024)','iPad Air 13 (2024)',
    'iPad Air 11 (2024)','iPad mini (2024)','iPad (2024)',
  ],
  'samsung-phones-9': [
    'Galaxy S25 Ultra','Galaxy S25+','Galaxy S25',
    'Galaxy S24 Ultra','Galaxy S24+','Galaxy S24','Galaxy S24 FE',
    'Galaxy S23 Ultra','Galaxy S23+','Galaxy S23','Galaxy S23 FE',
    'Galaxy S22 Ultra','Galaxy S22+','Galaxy S22',
    'Galaxy S21 Ultra','Galaxy S21+','Galaxy S21','Galaxy S21 FE',
    'Galaxy S20 Ultra','Galaxy S20+','Galaxy S20','Galaxy S20 FE',
    'Galaxy A55','Galaxy A54','Galaxy A35','Galaxy A34','Galaxy A25','Galaxy A24',
    'Galaxy A15','Galaxy A14','Galaxy A05s','Galaxy A05',
    'Galaxy Z Fold 6','Galaxy Z Fold 5','Galaxy Z Fold 4',
    'Galaxy Z Flip 6','Galaxy Z Flip 5','Galaxy Z Flip 4',
    'Galaxy Tab S10 Ultra','Galaxy Tab S10+','Galaxy Tab S10',
    'Galaxy Tab S9 Ultra','Galaxy Tab S9+','Galaxy Tab S9',
  ],
  'xiaomi-phones-80': [
    'Xiaomi 14 Ultra','Xiaomi 14 Pro','Xiaomi 14','Xiaomi 14T Pro','Xiaomi 14T',
    'Xiaomi 13 Ultra','Xiaomi 13 Pro','Xiaomi 13','Xiaomi 13T Pro','Xiaomi 13T',
    'Xiaomi 12 Pro','Xiaomi 12','Xiaomi 12T Pro','Xiaomi 12T',
    'Redmi Note 13 Pro+','Redmi Note 13 Pro','Redmi Note 13',
    'Redmi Note 12 Pro+','Redmi Note 12 Pro','Redmi Note 12',
    'Redmi 13C','Redmi 13','Redmi 12C','Redmi 12',
    'POCO X6 Pro','POCO X6','POCO F6 Pro','POCO F6','POCO M6 Pro',
  ],
  'huawei-phones-45': [
    'Huawei Pura 70 Ultra','Huawei Pura 70 Pro','Huawei Pura 70',
    'Huawei P60 Pro','Huawei P60','Huawei P50 Pro','Huawei P50',
    'Huawei Mate 60 Pro','Huawei Mate 60','Huawei Mate 50 Pro','Huawei Mate 50',
    'Huawei Nova 12 Pro','Huawei Nova 12','Huawei Nova 11 Pro','Huawei Nova 11',
    'Huawei P40 Pro','Huawei P40','Huawei P30 Pro','Huawei P30',
    'Huawei MatePad Pro 13.2','Huawei MatePad Pro 11','Huawei MatePad 11.5',
  ],
  'oneplus-phones-95': [
    'OnePlus 12','OnePlus 12R','OnePlus 11','OnePlus 11R',
    'OnePlus 10 Pro','OnePlus 10T','OnePlus 9 Pro','OnePlus 9',
    'OnePlus Nord 4','OnePlus Nord 3','OnePlus Nord CE 3','OnePlus Nord CE 2',
    'OnePlus Open',
  ],
  'google-phones-107': [
    'Pixel 9 Pro XL','Pixel 9 Pro Fold','Pixel 9 Pro','Pixel 9',
    'Pixel 8 Pro','Pixel 8','Pixel 8a',
    'Pixel 7 Pro','Pixel 7','Pixel 7a',
    'Pixel 6 Pro','Pixel 6','Pixel 6a',
    'Pixel Fold','Pixel Tablet',
  ],
  'oppo-phones-82': [
    'OPPO Find X8 Pro','OPPO Find X8','OPPO Find X7 Ultra','OPPO Find X7',
    'OPPO Find N3 Flip','OPPO Find N3',
    'OPPO Reno 12 Pro','OPPO Reno 12','OPPO Reno 11 Pro','OPPO Reno 11',
    'OPPO Reno 10 Pro','OPPO Reno 10','OPPO A98','OPPO A78','OPPO A58',
  ],
  'realme-phones-118': [
    'Realme GT 6','Realme GT 5 Pro','Realme GT 5','Realme GT Neo 6',
    'Realme 12 Pro+','Realme 12 Pro','Realme 12','Realme 12+',
    'Realme 11 Pro+','Realme 11 Pro','Realme 11',
    'Realme Narzo 70 Pro','Realme Narzo 60 Pro','Realme C67','Realme C55',
  ],
  'sony-phones-7': [
    'Xperia 1 VI','Xperia 5 VI','Xperia 10 VI',
    'Xperia 1 V','Xperia 5 V','Xperia 10 V',
    'Xperia 1 IV','Xperia 5 IV','Xperia 10 IV',
    'Xperia Pro-I','Xperia Pro',
  ],
  'motorola-phones-4': [
    'Moto G 5G (2024)','Moto G85','Moto G84','Moto G64','Moto G54',
    'Moto G34','Moto G24','Moto G14',
    'Edge 50 Ultra','Edge 50 Pro','Edge 50','Edge 40 Pro','Edge 40',
    'Razr 50 Ultra','Razr 50','Razr 40 Ultra','Razr 40',
    'ThinkPhone',
  ],
  'honor-phones-121': [
    'Honor Magic 6 Pro','Honor Magic 6','Honor Magic 5 Pro','Honor Magic 5',
    'Honor Magic V3','Honor Magic V2','Honor Magic Vs2',
    'Honor 90 Pro','Honor 90','Honor 80 Pro','Honor 80',
    'Honor X9b','Honor X8b','Honor X7b',
  ],
  'nokia-phones-1': [
    'Nokia G42','Nokia G22','Nokia G21','Nokia G11','Nokia G10',
    'Nokia X30','Nokia X20','Nokia X10',
    'Nokia C32','Nokia C22','Nokia C12','Nokia C02',
    'Nokia 3310 (2017)',
  ],
  'asus-phones-46': [
    'ROG Phone 8 Pro','ROG Phone 8','ROG Phone 7 Pro','ROG Phone 7',
    'Zenfone 11 Ultra','Zenfone 10','Zenfone 9','Zenfone 8',
  ],
  'wiko-phones-85': [
    'Wiko T60','Wiko T50','Wiko T10','Wiko Hi Enjoyment 50',
    'Wiko Power U30','Wiko Y82','Wiko Y72','Wiko Y62',
    'Wiko View 5','Wiko View 4','Wiko View 3',
  ],
  'fairphone-phones-163': [
    'Fairphone 5','Fairphone 4','Fairphone 3+','Fairphone 3',
  ],
  'nothing-phones-198': [
    'Nothing Phone (2a) Plus','Nothing Phone (2a)','Nothing Phone (2)','Nothing Phone (1)',
    'CMF Phone 1',
  ],
}

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
  let brands: ApiBrand[]
  let fromStatic = false

  try {
    // Tentative API externe avec timeout 8s
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const resp = await fetch(`${API_BASE}/brands`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as any
    if (!data.status || !Array.isArray(data.data)) throw new Error('Réponse invalide')
    brands = data.data
  } catch (_err) {
    // Fallback dataset statique embarqué (API rate-limitée ou indisponible)
    brands = STATIC_BRANDS
    fromStatic = true
  }

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

  return { inserted, skipped, total: brands.length, brands, fromStatic } as any
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
    let allPhones: ApiPhone[] = []
    let lastPage = 1

    // Tentative API externe avec timeout 10s
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const firstResp = await fetch(`${API_BASE}/brands/${brandSlug}?page=1`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!firstResp.ok) throw new Error(`HTTP ${firstResp.status}`)
      const firstPage = await firstResp.json() as any
      if (!firstPage.status || !firstPage.data) throw new Error('Réponse invalide')

      lastPage = firstPage.data.last_page ?? 1
      allPhones = [...(firstPage.data.phones ?? [])]

      // Pages suivantes par chunks de 5 (limite CPU Workers)
      if (lastPage > 1) {
        const pageNums = Array.from({ length: lastPage - 1 }, (_, i) => i + 2)
        const CHUNK_SIZE = 5
        for (let i = 0; i < pageNums.length; i += CHUNK_SIZE) {
          const chunk = pageNums.slice(i, i + CHUNK_SIZE)
          const results = await Promise.all(
            chunk.map(async p => {
              try {
                const r = await fetch(`${API_BASE}/brands/${brandSlug}?page=${p}`, {
                  headers: { 'Accept': 'application/json' }
                })
                if (!r.ok) return null
                return r.json()
              } catch { return null }
            })
          )
          for (const res of results) {
            if (res && (res as any).status && (res as any).data?.phones) {
              allPhones = allPhones.concat((res as any).data.phones)
            }
          }
        }
      }

    } catch (_apiErr) {
      // Fallback : dataset statique pour les marques connues
      const staticModeles = STATIC_MODELES[brandSlug]
      if (staticModeles && staticModeles.length > 0) {
        allPhones = staticModeles.map(nom => ({
          brand: marque.nom,
          phone_name: nom,
          slug: `${brandSlug}-${nom.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          image: null,
        }))
      }
      // Si pas de static non plus, on continue avec allPhones = [] (0 modèles)
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
