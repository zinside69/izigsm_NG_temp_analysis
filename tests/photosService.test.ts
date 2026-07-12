/**
 * tests/photosService.test.ts
 * Sprint 2.41-E — Couverture photosService.ts
 * D09 : photos tickets R2 (upload avant/après, liste, suppression)
 *
 * Fonctions testées :
 *   getTicketForPhoto  (3 tests)
 *   uploadPhoto        (5 tests)
 *   listPhotos         (3 tests)
 *   getPhotoById       (3 tests)
 *   deletePhoto        (4 tests)
 *
 * Total : 18 tests
 *
 * Stratégie mock R2 :
 *   R2Bucket n'est pas disponible hors Workers runtime.
 *   On mocke `r2.put` et `r2.delete` avec vi.fn().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  getTicketForPhoto,
  uploadPhoto,
  listPhotos,
  getPhotoById,
  deletePhoto,
  MIME_AUTORISES,
  TAILLE_MAX,
  type PhotoRow,
} from '../src/services/photosService'

// ─── Mock R2Bucket ────────────────────────────────────────────────────────────

function createMockR2() {
  return {
    put:    vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    get:    vi.fn().mockResolvedValue(null),
    head:   vi.fn().mockResolvedValue(null),
    list:   vi.fn().mockResolvedValue({ objects: [] }),
  } as unknown as R2Bucket
}

// ─── SQL normalisés ───────────────────────────────────────────────────────────

function n(sql: string) { return sql.replace(/\s+/g, ' ').trim() }

const SQL_TICKET_FOR_PHOTO = n(
  `SELECT boutique_id FROM tickets WHERE id = ? AND actif = 1`
)

const SQL_INSERT_PHOTO = n(`
  INSERT INTO ticket_photos (ticket_id, r2_key, nom_fichier, type_photo, mime_type, taille, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const SQL_LIST_PHOTOS = n(`
  SELECT id, ticket_id, r2_key, nom_fichier, type_photo, mime_type, taille, created_at, created_by
  FROM   ticket_photos
  WHERE  ticket_id = ?
  ORDER  BY
    CASE type_photo WHEN 'avant' THEN 1 WHEN 'apres' THEN 2 ELSE 3 END,
    created_at ASC
`)

const SQL_GET_PHOTO = n(`
  SELECT id, ticket_id, r2_key, nom_fichier, type_photo, mime_type, taille, created_at, created_by
  FROM   ticket_photos
  WHERE  id = ?
`)

const SQL_DELETE_PHOTO = n(`DELETE FROM ticket_photos WHERE id = ?`)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PHOTO_ROW: PhotoRow = {
  id: 7,
  ticket_id: 42,
  r2_key: 'tickets/42/photos/abc-123.jpg',
  nom_fichier: 'avant_reparation.jpg',
  type_photo: 'avant',
  mime_type: 'image/jpeg',
  taille: 204800,
  created_at: '2026-07-01T10:00:00Z',
  created_by: 1,
}

const BUFFER_1MB = new ArrayBuffer(1024 * 1024)   // 1 Mo — sous la limite
const BUFFER_6MB = new ArrayBuffer(6 * 1024 * 1024) // 6 Mo — dépasse la limite

// ─── getTicketForPhoto() ──────────────────────────────────────────────────────

describe('getTicketForPhoto()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne { boutique_id } si le ticket existe', async () => {
    db.__setResponse(SQL_TICKET_FOR_PHOTO, { boutique_id: 5 })

    const result = await getTicketForPhoto(db, 42)

    expect(result).toEqual({ boutique_id: 5 })
  })

  it('retourne null si le ticket est introuvable ou inactif', async () => {
    db.__setResponse(SQL_TICKET_FOR_PHOTO, null)

    const result = await getTicketForPhoto(db, 999)

    expect(result).toBeNull()
  })

  it('transmet ticketId en binding SQL', async () => {
    db.__setResponse(SQL_TICKET_FOR_PHOTO, { boutique_id: 1 })

    await getTicketForPhoto(db, 42)

    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_TICKET_FOR_PHOTO)
    expect(call).toBeDefined()
    expect(call!.params[0]).toBe(42)
  })
})

// ─── uploadPhoto() ────────────────────────────────────────────────────────────

describe('uploadPhoto()', () => {
  let db: ReturnType<typeof createMockD1>
  let r2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    db = createMockD1()
    r2 = createMockR2()
  })

  it('lève une erreur si le MIME n\'est pas autorisé', async () => {
    await expect(
      uploadPhoto(r2, db as any, 42, 1, BUFFER_1MB, 'application/pdf', 'doc.pdf', 'avant')
    ).rejects.toThrow('non autorisé')
  })

  it('lève une erreur si le fichier dépasse 5 Mo', async () => {
    await expect(
      uploadPhoto(r2, db as any, 42, 1, BUFFER_6MB, 'image/jpeg', 'gros.jpg', 'avant')
    ).rejects.toThrow('volumineux')
  })

  it('appelle r2.put avec la clé générée et le MIME', async () => {
    db.__setResponse(SQL_INSERT_PHOTO, null) // run() retourne success par défaut

    await uploadPhoto(r2, db as any, 42, 1, BUFFER_1MB, 'image/jpeg', 'photo.jpg', 'avant')

    expect(r2.put).toHaveBeenCalledOnce()
    const [r2Key, , opts] = (r2.put as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(r2Key).toMatch(/^tickets\/42\/photos\/.*\.jpg$/)
    expect(opts.httpMetadata.contentType).toBe('image/jpeg')
  })

  it('insère les métadonnées en D1 avec les bons paramètres', async () => {
    await uploadPhoto(r2, db as any, 42, 1, BUFFER_1MB, 'image/png', 'screen.png', 'apres')

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_PHOTO)
    expect(insertCall).toBeDefined()
    // params : [ticket_id, r2_key, nom_fichier, type_photo, mime_type, taille, created_by]
    expect(insertCall!.params[0]).toBe(42)
    expect(insertCall!.params[3]).toBe('apres')
    expect(insertCall!.params[4]).toBe('image/png')
    expect(insertCall!.params[6]).toBe(1)
  })

  it('retourne une PhotoRow avec les bonnes propriétés', async () => {
    const result = await uploadPhoto(
      r2, db as any, 42, 1, BUFFER_1MB, 'image/jpeg', 'avant.jpg', 'avant'
    )

    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('ticket_id', 42)
    expect(result).toHaveProperty('type_photo', 'avant')
    expect(result).toHaveProperty('mime_type', 'image/jpeg')
    expect(result.taille).toBe(BUFFER_1MB.byteLength)
  })
})

// ─── listPhotos() ─────────────────────────────────────────────────────────────

describe('listPhotos()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne un tableau vide si aucune photo', async () => {
    db.__setListResponse(SQL_LIST_PHOTOS, [])

    const result = await listPhotos(db, 42)

    expect(result).toEqual([])
  })

  it('retourne les photos du ticket triées', async () => {
    const PHOTO_APRES = { ...PHOTO_ROW, id: 8, type_photo: 'apres' } as PhotoRow
    db.__setListResponse(SQL_LIST_PHOTOS, [PHOTO_ROW, PHOTO_APRES])

    const result = await listPhotos(db, 42)

    expect(result).toHaveLength(2)
    expect(result[0].type_photo).toBe('avant')
  })

  it('transmet ticketId en binding SQL', async () => {
    db.__setListResponse(SQL_LIST_PHOTOS, [])

    await listPhotos(db, 99)

    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_LIST_PHOTOS)
    expect(call).toBeDefined()
    expect(call!.params[0]).toBe(99)
  })
})

// ─── getPhotoById() ───────────────────────────────────────────────────────────

describe('getPhotoById()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne la PhotoRow si elle existe', async () => {
    db.__setResponse(SQL_GET_PHOTO, PHOTO_ROW)

    const result = await getPhotoById(db, 7)

    expect(result).toEqual(PHOTO_ROW)
  })

  it('retourne null si la photo est introuvable', async () => {
    db.__setResponse(SQL_GET_PHOTO, null)

    const result = await getPhotoById(db, 999)

    expect(result).toBeNull()
  })

  it('transmet photoId en binding SQL', async () => {
    db.__setResponse(SQL_GET_PHOTO, PHOTO_ROW)

    await getPhotoById(db, 7)

    const calls = db.__getCalls()
    const call = calls.find(c => c.sql === SQL_GET_PHOTO)
    expect(call).toBeDefined()
    expect(call!.params[0]).toBe(7)
  })
})

// ─── deletePhoto() ────────────────────────────────────────────────────────────

describe('deletePhoto()', () => {
  let db: ReturnType<typeof createMockD1>
  let r2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    db = createMockD1()
    r2 = createMockR2()
  })

  it('lève une erreur si la photo est introuvable', async () => {
    db.__setResponse(SQL_GET_PHOTO, null)

    await expect(deletePhoto(r2, db as any, 999, 1)).rejects.toThrow('introuvable')
  })

  it('appelle r2.delete avec la clé R2 de la photo', async () => {
    db.__setResponse(SQL_GET_PHOTO, PHOTO_ROW)

    await deletePhoto(r2, db as any, 7, 1)

    expect(r2.delete).toHaveBeenCalledWith('tickets/42/photos/abc-123.jpg')
  })

  it('supprime la ligne en D1 après R2', async () => {
    db.__setResponse(SQL_GET_PHOTO, PHOTO_ROW)

    await deletePhoto(r2, db as any, 7, 1)

    const calls = db.__getCalls()
    const deleteCall = calls.find(c => c.sql === SQL_DELETE_PHOTO)
    expect(deleteCall).toBeDefined()
    expect(deleteCall!.params[0]).toBe(7)
  })

  it('supprime R2 avant D1 (ordre des opérations)', async () => {
    db.__setResponse(SQL_GET_PHOTO, PHOTO_ROW)

    const ops: string[] = []
    ;(r2.delete as ReturnType<typeof vi.fn>).mockImplementation(() => {
      ops.push('r2.delete')
      return Promise.resolve()
    })
    db.__setResponseFn(SQL_DELETE_PHOTO, () => { ops.push('d1.delete'); return null })

    await deletePhoto(r2, db as any, 7, 1)

    expect(ops[0]).toBe('r2.delete')
    expect(ops[1]).toBe('d1.delete')
  })
})
