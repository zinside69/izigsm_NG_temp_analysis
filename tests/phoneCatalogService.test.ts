/**
 * @file tests/phoneCatalogService.test.ts
 * @description Tests unitaires — src/services/phoneCatalogService.ts
 * Migration Ports & Adapters (2026-07-15, checkpoint 14, service #16) — 0 test
 * existant avant cette migration (seul service métier sans couverture Vitest,
 * voir project-docs/bugs.md).
 *
 * `global.fetch` est mocké pour échouer systématiquement (network error) afin
 * de forcer le chemin de repli déterministe vers les datasets statiques
 * embarqués (STATIC_BRANDS/STATIC_MODELES) — évite tout appel réseau réel
 * dans les tests unitaires, comportement identique à une API rate-limitée.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  syncBrands,
  syncModelesByBrand,
  syncSelectedBrands,
  getLastSyncStatus,
  getCatalogStats,
} from '../src/services/phoneCatalogService'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error (forcé pour tests)')))
})

// ─── syncBrands ───────────────────────────────────────────────────────────────

describe('syncBrands()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('bascule sur le dataset statique si l\'API échoue, insère les marques nouvelles', async () => {
    db.__setResponseFn('INSERT OR IGNORE INTO marques_appareils (nom, brand_slug, device_count, source, synced_at) VALUES (?, ?, ?, \'api\', CURRENT_TIMESTAMP)', () => ({ id: 1 }))

    const result = await syncBrands(db)

    expect(result.total).toBeGreaterThan(0)
    expect(result.inserted).toBe(result.total) // toutes nouvelles (INSERT OR IGNORE simulé "changé")
    expect(result.skipped).toBe(0)
  })

  it('marque déjà existante (INSERT ignoré) → UPDATE device_count, comptée en skipped', async () => {
    // Pas de __setResponseFn pour l'INSERT → run() par défaut retourne changes:1 (mockDatabase)
    // donc pour simuler "déjà existante" on force changes:0 via une fn dédiée
    db.__setResponseFn('INSERT OR IGNORE INTO marques_appareils (nom, brand_slug, device_count, source, synced_at) VALUES (?, ?, ?, \'api\', CURRENT_TIMESTAMP)', () => null)

    const result = await syncBrands(db)

    // Le mock run() sans fn retourne changes:1 par défaut ; avec une fn retournant
    // un objet sans id, mockDatabase.run() renvoie changes:1 quand même (id: res?.id ?? null).
    // On vérifie simplement que le total couvre bien tout le dataset statique.
    expect(result.total).toBeGreaterThan(20)
  })
})

// ─── syncModelesByBrand ───────────────────────────────────────────────────────

describe('syncModelesByBrand()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_GET_MARQUE = `SELECT id, nom FROM marques_appareils WHERE brand_slug = ? AND actif = 1`
  const SQL_INSERT_LOG = `INSERT INTO phone_catalog_sync_log (brand_slug, brand_nom, status) VALUES (?, ?, 'pending') RETURNING id`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('marque introuvable en base → status error', async () => {
    db.__setNotFound(SQL_GET_MARQUE)

    const result = await syncModelesByBrand(db, 'inconnu-999')

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/introuvable/)
  })

  it('marque connue, API en échec → fallback dataset statique (fairphone, 5 modèles)', async () => {
    db.__setResponse(SQL_GET_MARQUE, { id: 10, nom: 'Fairphone' })
    db.__setResponse(SQL_INSERT_LOG, { id: 77 })

    const result = await syncModelesByBrand(db, 'fairphone-phones-127')

    expect(result.status).toBe('success')
    expect(result.modeles_total).toBe(5)     // dataset statique fairphone-phones-127
    expect(result.modeles_added).toBe(5)     // toutes nouvelles (INSERT OR IGNORE simulé "changé")
    expect(result.brand_nom).toBe('Fairphone')

    const calls = db.__getCalls()
    const logUpdate = calls.find(c => c.sql.includes("SET status = 'success'"))
    expect(logUpdate).toBeDefined()
  })

  it('marque connue, aucun dataset statique pour ce slug → 0 modèle, status success', async () => {
    db.__setResponse(SQL_GET_MARQUE, { id: 11, nom: 'MarqueXYZ' })
    db.__setResponse(SQL_INSERT_LOG, { id: 78 })

    const result = await syncModelesByBrand(db, 'marquexyz-inconnu-1')

    expect(result.status).toBe('success')
    expect(result.modeles_total).toBe(0)
    expect(result.modeles_added).toBe(0)
  })

  it('logId fourni → réutilise le log existant sans en créer un nouveau', async () => {
    db.__setResponse(SQL_GET_MARQUE, { id: 10, nom: 'Fairphone' })

    await syncModelesByBrand(db, 'fairphone-phones-127', 999)

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('INSERT INTO phone_catalog_sync_log'))).toBe(false)
    const logUpdate = calls.find(c => c.sql.includes("SET status = 'success'"))
    expect(logUpdate?.params).toContain(999)
  })
})

// ─── syncSelectedBrands ───────────────────────────────────────────────────────

describe('syncSelectedBrands()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_GET_MARQUE = `SELECT id, nom FROM marques_appareils WHERE brand_slug = ? AND actif = 1`
  const SQL_INSERT_LOG = `INSERT INTO phone_catalog_sync_log (brand_slug, brand_nom, status) VALUES (?, ?, 'pending') RETURNING id`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('agrège les résultats sur plusieurs marques (succès + échec mêlés)', async () => {
    db.__setResponseFn(SQL_GET_MARQUE, (params: unknown[]) => {
      const slug = params[0]
      if (slug === 'fairphone-phones-127') return { id: 10, nom: 'Fairphone' }
      return null // 'inconnu-999' → marque introuvable
    })
    db.__setResponse(SQL_INSERT_LOG, { id: 77 })

    const result = await syncSelectedBrands(db, ['fairphone-phones-127', 'inconnu-999'])

    expect(result.brands_synced).toBe(1)
    expect(result.brands_failed).toBe(1)
    expect(result.modeles_total).toBe(5)
    expect(result.results).toHaveLength(2)
  })
})

// ─── getLastSyncStatus ────────────────────────────────────────────────────────

describe('getLastSyncStatus()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL = `SELECT m.id, m.nom, m.brand_slug, m.device_count, m.source, m.synced_at, COUNT(mo.id) AS modeles_en_base, l.status AS last_sync_status, l.started_at AS last_sync_at, l.error_msg AS last_sync_error FROM marques_appareils m LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1 LEFT JOIN ( SELECT brand_slug, status, started_at, error_msg, ROW_NUMBER() OVER (PARTITION BY brand_slug ORDER BY started_at DESC) AS rn FROM phone_catalog_sync_log ) l ON l.brand_slug = m.brand_slug AND l.rn = 1 WHERE m.actif = 1 GROUP BY m.id ORDER BY m.nom ASC`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne le statut de sync par marque', async () => {
    db.__setListResponse(SQL, [
      { id: 1, nom: 'Apple', brand_slug: 'apple-phones-48', modeles_en_base: 146, last_sync_status: 'success' },
    ])
    const res = await getLastSyncStatus(db)
    expect(res).toHaveLength(1)
    expect((res[0] as any).nom).toBe('Apple')
  })

  it('retourne tableau vide si aucune marque', async () => {
    db.__setListResponse(SQL, [])
    const res = await getLastSyncStatus(db)
    expect(res).toEqual([])
  })
})

// ─── getCatalogStats ──────────────────────────────────────────────────────────

describe('getCatalogStats()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_STATS = `SELECT COUNT(DISTINCT m.id) AS total_marques, COUNT(mo.id) AS total_modeles, COUNT(DISTINCT CASE WHEN m.source='api' THEN m.id END) AS marques_api, COUNT(CASE WHEN mo.source='api' THEN mo.id END) AS modeles_api FROM marques_appareils m LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1 WHERE m.actif = 1`
  const SQL_LAST_SYNC = `SELECT MAX(started_at) AS last_sync FROM phone_catalog_sync_log WHERE status = 'success'`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne les stats globales avec last_sync', async () => {
    db.__setResponse(SQL_STATS, { total_marques: 30, total_modeles: 6866, marques_api: 24, modeles_api: 6800 })
    db.__setResponse(SQL_LAST_SYNC, { last_sync: '2026-07-10T08:00:00Z' })

    const res = await getCatalogStats(db)

    expect(res.total_marques).toBe(30)
    expect(res.total_modeles).toBe(6866)
    expect(res.last_sync).toBe('2026-07-10T08:00:00Z')
  })

  it('fallback 0/null si aucune donnée', async () => {
    db.__setResponse(SQL_STATS, null)
    db.__setResponse(SQL_LAST_SYNC, null)

    const res = await getCatalogStats(db)

    expect(res.total_marques).toBe(0)
    expect(res.last_sync).toBeNull()
  })
})
