/**
 * photosService.ts — Model layer pour les photos de tickets
 * Sprint 2.36 — MOD-01 : upload photos avant/après via Cloudflare R2
 *
 * Architecture :
 *   - Binaire → Cloudflare R2 (clé : `tickets/{ticketId}/photos/{uuid}.{ext}`)
 *   - Métadonnées → D1 table `ticket_photos`
 *   - Accès photo → /api/tickets/:id/photos/:photoId/view (proxy R2 → client)
 *
 * Fonctions exportées :
 *   uploadPhoto(r2, db, ticketId, userId, buffer, mime, nom, type) — Upload R2 + INSERT D1
 *   listPhotos(db, ticketId)                                       — Liste photos d'un ticket
 *   getPhotoById(db, photoId)                                      — Métadonnées d'une photo
 *   deletePhoto(r2, db, photoId, userId)                           — DELETE R2 + soft D1
 *   getTicketForPhoto(db, ticketId)                                — Vérif ticket existant
 */

import { auditLog } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TypePhoto = 'avant' | 'apres' | 'autre'

export const TYPES_PHOTO: TypePhoto[] = ['avant', 'apres', 'autre']

export const MIME_AUTORISES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const TAILLE_MAX = 5 * 1024 * 1024  // 5 Mo

export interface PhotoRow {
  id:          number
  ticket_id:   number
  r2_key:      string
  nom_fichier: string
  type_photo:  TypePhoto
  mime_type:   string
  taille:      number
  created_at:  string
  created_by:  number | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Génère une clé R2 unique pour une photo.
 * Format : `tickets/{ticketId}/photos/{uuid}.{ext}`
 */
function genR2Key(ticketId: number, mime: string): string {
  const ext  = mime === 'image/png' ? 'png'
             : mime === 'image/webp' ? 'webp'
             : mime === 'image/gif'  ? 'gif'
             : 'jpg'
  const uuid = crypto.randomUUID()
  return `tickets/${ticketId}/photos/${uuid}.${ext}`
}

// ─── Fonctions exportées ──────────────────────────────────────────────────────

/**
 * Vérifie qu'un ticket existe et retourne son boutique_id.
 * Utilisé par les routes pour valider les accès multi-tenant.
 */
export async function getTicketForPhoto(
  db: D1Database,
  ticketId: number
): Promise<{ boutique_id: number } | null> {
  const row = await db.prepare(
    `SELECT boutique_id FROM tickets WHERE id = ? AND actif = 1`
  ).bind(ticketId).first<{ boutique_id: number }>()
  return row ?? null
}

/**
 * Upload une photo dans R2 et enregistre les métadonnées dans D1.
 *
 * @param r2       — Binding R2Bucket
 * @param db       — Binding D1Database
 * @param ticketId — ID du ticket parent
 * @param userId   — ID de l'utilisateur qui upload
 * @param buffer   — Contenu binaire de l'image (ArrayBuffer)
 * @param mime     — Type MIME (ex: 'image/jpeg')
 * @param nom      — Nom de fichier original
 * @param type     — 'avant' | 'apres' | 'autre'
 * @returns PhotoRow insérée
 * @throws si MIME non autorisé, taille dépassée, ou erreur R2/D1
 */
export async function uploadPhoto(
  r2:        R2Bucket,
  db:        D1Database,
  ticketId:  number,
  userId:    number,
  buffer:    ArrayBuffer,
  mime:      string,
  nom:       string,
  type:      TypePhoto = 'autre'
): Promise<PhotoRow> {
  // Validations
  if (!MIME_AUTORISES.includes(mime)) {
    throw new Error(`Type de fichier non autorisé : ${mime}. Formats acceptés : JPEG, PNG, WebP, GIF.`)
  }
  if (buffer.byteLength > TAILLE_MAX) {
    throw new Error(`Fichier trop volumineux (${(buffer.byteLength / 1024 / 1024).toFixed(1)} Mo). Maximum : 5 Mo.`)
  }
  if (!TYPES_PHOTO.includes(type)) {
    throw new Error(`Type de photo invalide : ${type}.`)
  }

  // Générer clé R2 unique
  const r2Key = genR2Key(ticketId, mime)

  // Upload vers R2
  await r2.put(r2Key, buffer, {
    httpMetadata: { contentType: mime },
    customMetadata: {
      ticketId:  String(ticketId),
      userId:    String(userId),
      typePhoto: type,
      nomFichier: nom,
    },
  })

  // Insérer métadonnées en D1
  const result = await db.prepare(`
    INSERT INTO ticket_photos (ticket_id, r2_key, nom_fichier, type_photo, mime_type, taille, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(ticketId, r2Key, nom.slice(0, 255), type, mime, buffer.byteLength, userId).run()

  const photoId = result.meta.last_row_id as number

  // Audit non bloquant
  auditLog(db, userId, 'PHOTO_UPLOAD', 'ticket_photos', photoId, null, {
    ticketId, r2Key, mime, taille: buffer.byteLength, type,
  }).catch(() => {})

  return {
    id:          photoId,
    ticket_id:   ticketId,
    r2_key:      r2Key,
    nom_fichier: nom.slice(0, 255),
    type_photo:  type,
    mime_type:   mime,
    taille:      buffer.byteLength,
    created_at:  new Date().toISOString(),
    created_by:  userId,
  }
}

/**
 * Liste toutes les photos d'un ticket, triées par type puis date.
 * @returns PhotoRow[] (sans données binaires)
 */
export async function listPhotos(
  db:       D1Database,
  ticketId: number
): Promise<PhotoRow[]> {
  const rows = await db.prepare(`
    SELECT id, ticket_id, r2_key, nom_fichier, type_photo, mime_type, taille, created_at, created_by
    FROM   ticket_photos
    WHERE  ticket_id = ?
    ORDER  BY
      CASE type_photo WHEN 'avant' THEN 1 WHEN 'apres' THEN 2 ELSE 3 END,
      created_at ASC
  `).bind(ticketId).all<PhotoRow>()
  return rows.results ?? []
}

/**
 * Retourne les métadonnées d'une photo par son ID.
 * @returns PhotoRow ou null si introuvable
 */
export async function getPhotoById(
  db:      D1Database,
  photoId: number
): Promise<PhotoRow | null> {
  const row = await db.prepare(`
    SELECT id, ticket_id, r2_key, nom_fichier, type_photo, mime_type, taille, created_at, created_by
    FROM   ticket_photos
    WHERE  id = ?
  `).bind(photoId).first<PhotoRow>()
  return row ?? null
}

/**
 * Supprime une photo : DELETE dans R2 + DELETE dans D1.
 * @throws si photo introuvable
 */
export async function deletePhoto(
  r2:      R2Bucket,
  db:      D1Database,
  photoId: number,
  userId:  number
): Promise<void> {
  const photo = await getPhotoById(db, photoId)
  if (!photo) throw new Error(`Photo #${photoId} introuvable.`)

  // Supprimer de R2 (non bloquant si clé absente)
  await r2.delete(photo.r2_key)

  // Supprimer de D1
  await db.prepare(`DELETE FROM ticket_photos WHERE id = ?`).bind(photoId).run()

  // Audit
  auditLog(db, userId, 'PHOTO_DELETE', 'ticket_photos', photoId, { r2Key: photo.r2_key }, null).catch(() => {})
}
