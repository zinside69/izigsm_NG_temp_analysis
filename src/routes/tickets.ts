/**
 * routes/tickets.ts — Controller Tickets de réparation
 * Sprint 2.17 — Refactoring P1 : tout le SQL délégué à ticketService.ts
 *
 * Ce fichier ne contient AUCUN SQL. Il orchestre uniquement :
 *   - Extraction des paramètres de la requête HTTP
 *   - Appel du service approprié
 *   - Formatage de la réponse P5 { success, data?, error?, message? }
 *
 * Hooks cross-services conservés ici (non bloquants) :
 *   - createGarantieFromTicket (savService) au passage en statut 'termine'
 *   - sendTicketCree / sendTicketTermine (emailService) à la création et clôture
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { validateSignatureDataUrl } from '../lib/validators'
import type { Database } from '../ports/database'
import {
  listTickets,
  getKanban,
  getTicketById,
  createTicket,
  updateTicket,
  updateStatutTicket,
  deleteTicket,
  archiveTicket,
  checkAndArchiveTickets,
  getTicketBoutiqueId,
  getTicketAvecClient,
  type StatutTicket,
} from '../services/ticketService'
import { getClientEmailPrenom } from '../services/clientService'
import { signPhotoToken } from '../lib/photoToken'
import { createGarantieFromTicket } from '../services/garantiesService'
import { sendTicketCree, sendTicketTermine, sendTicketLivre } from '../services/emailService'
import {
  uploadPhoto,
  listPhotos,
  getPhotoById,
  deletePhoto,
  getTicketForPhoto,
  type TypePhoto,
  MIME_AUTORISES,
  TAILLE_MAX,
} from '../services/photosService'
import { createFactureAcompte } from '../services/factureService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string; PHOTOS?: R2Bucket; RESEND_API_KEY?: string }
// 'db' : port Database injecté par le middleware global (src/index.tsx) — utilisé
// uniquement par les fonctions déjà migrées (Ports & Adapters, 2026-07-12).
type Variables = { user: any; db: Database }

const tickets = new Hono<{ Bindings: Bindings; Variables: Variables }>()
tickets.use('*', authMiddleware)

// ─── Helper context ───────────────────────────────────────────────────────────

/**
 * Extrait les éléments récurrents du contexte Hono.
 * @param c — Contexte Hono
 * @returns { user, db, queryBoutiqueId }
 */
function ctx(c: any) {
  return {
    user:            c.get('user'),
    db:              c.env.DB as D1Database,
    dbPort:          c.get('db') as Database,
    queryBoutiqueId: c.req.query('boutique_id') ?? undefined,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSULTATION (Kanban, liste)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/tickets/kanban ── (déclaré AVANT /:id pour éviter collision) ────
/**
 * Vue Kanban : tickets groupés par statut avec indicateurs d'ancienneté.
 * @query boutique_id — obligatoire
 * @returns { success, colonnes, stats }
 */
tickets.get('/kanban', async (c) => {
  const { user, dbPort, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await getKanban(dbPort, boutiqueId)
  return c.json({ success: true, ...result })
})

// ── GET /api/tickets ──────────────────────────────────────────────────────────
/**
 * Liste paginée des tickets avec filtres.
 * @query boutique_id, statut?, technicien?, client_id?, search?, archived?, page?, limit?
 * @query archived=true — retourne les tickets archivés (Sprint 2.37)
 * @returns { success, data, pagination }
 */
tickets.get('/', async (c) => {
  const { user, dbPort, queryBoutiqueId } = ctx(c)
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  // Sprint 2.37 : batch auto-archivage probabiliste (1% des requêtes)
  // waitUntil() obligatoire — voir commentaire sur sendTicketCree plus bas dans ce fichier
  if (Math.random() < 0.01) {
    c.executionCtx.waitUntil(checkAndArchiveTickets(dbPort, boutiqueId, 90).catch(() => {}))
  }

  const result = await listTickets(dbPort, boutiqueId, {
    statut:     query.statut     ?? undefined,
    technicien: query.technicien ? parseInt(query.technicien, 10) : undefined,
    client_id:  query.client_id  ? parseInt(query.client_id,  10) : undefined,
    search:     query.search     ?? undefined,
    archived:   query.archived   === 'true',
    page:       query.page       ? parseInt(query.page,       10) : undefined,
    limit:      query.limit      ? parseInt(query.limit,      10) : undefined,
  })

  return c.json({ success: true, ...result })
})

// ══════════════════════════════════════════════════════════════════════════════
// ARCHIVAGE
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/tickets/:id/archiver (Sprint 2.37) ──────────────────────────────
/**
 * Archive manuellement un ticket terminal (livre ou annule).
 * Réservé admin/manager.
 * @param id — ID du ticket
 * @returns { success, message }
 */
tickets.post('/:id/archiver', requireRole('admin', 'manager'), async (c) => {
  const { user, db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  try {
    await archiveTicket(db, id, user.sub)
    return c.json({ success: true, message: `Ticket #${id} archivé.` })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('déjà')        ? 409
                 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// DÉTAIL & CRÉATION
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/tickets/:id ──────────────────────────────────────────────────────
/**
 * Fiche complète d'un ticket (+ historique statuts + photos).
 * @param id — ID du ticket
 * @returns { success, data }
 */
tickets.get('/:id', async (c) => {
  const { dbPort } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  const data = await getTicketById(dbPort, id)
  if (!data) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

  return c.json({ success: true, data })
})

// ── POST /api/tickets ─────────────────────────────────────────────────────────
/**
 * Crée un nouveau ticket.
 * Hook email non bloquant : envoi confirmation de dépôt au client.
 * @body client_id, appareil_marque, appareil_modele, description_panne (obligatoires)
 * @body boutique_id, technicien_id?, prix_estime?, date_promesse?, notes_internes? (optionnels)
 * @body etat_appareil?, code_deverrouillage?, code_sim?, signature_client?, signature_date? (prise en charge, optionnels)
 * @returns { success, id, numero, tracking_token }
 */
tickets.post('/', async (c) => {
  const { user, db, dbPort, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()
  const { client_id, appareil_id, appareil_marque, appareil_modele,
          description_panne, technicien_id, prix_estime, date_promesse, notes_internes,
          etat_appareil, code_deverrouillage, code_sim, signature_client, signature_date } = body

  if (!client_id || !appareil_marque || !appareil_modele || !description_panne)
    return c.json({ success: false, error: 'Champs obligatoires manquants (client_id, appareil_marque, appareil_modele, description_panne).' }, 400)

  // Signature : n'accepter qu'un data URL image PNG/JPEG en base64 — évite qu'une
  // valeur arbitraire (appel API direct, hors canvas de dessin) finisse interpolée
  // sans échappement fiable dans un <img src="..."> côté frontend (tickets.js).
  if (signature_client) {
    const sigError = validateSignatureDataUrl(signature_client)
    if (sigError) return c.json({ success: false, error: sigError }, 400)
  }

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let created: { id: number; numero: string; tracking_token: string }
  try {
    created = await createTicket(db, boutiqueId, user.sub, {
      client_id, appareil_id, appareil_marque, appareil_modele,
      description_panne, technicien_id, prix_estime, date_promesse, notes_internes,
      etat_appareil, code_deverrouillage, code_sim, signature_client, signature_date,
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }

  // ── Hook email création (non bloquant) ──────────────────────────────────────
  const frontendUrl  = (c.env as any).FRONTEND_URL ?? 'http://localhost:3000'
  const clientRow = await getClientEmailPrenom(dbPort, client_id)

  if (clientRow?.email) {
    // waitUntil() obligatoire : sans lui, Cloudflare Workers tue l'exécution
    // dès la réponse HTTP envoyée, avant que la promesse fire-and-forget
    // n'ait eu le temps d'aboutir — l'email ne partait jamais (bug silencieux
    // découvert le 2026-07-10 : email_logs vide depuis la création de la base).
    c.executionCtx.waitUntil(
      sendTicketCree(dbPort, boutiqueId, {
        id:              created.id,
        numero:          created.numero,
        tracking_token:  created.tracking_token,
        client_email:    clientRow.email,
        client_prenom:   clientRow.prenom ?? 'Client',
        appareil_marque, appareil_modele, description_panne,
      }, frontendUrl, c.env.RESEND_API_KEY).catch(() => {})
    )
  }

  return c.json({
    success:        true,
    id:             created.id,
    numero:         created.numero,
    tracking_token: created.tracking_token,
    message:        'Ticket créé.',
  }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// MISE À JOUR
// ══════════════════════════════════════════════════════════════════════════════

// ── PUT /api/tickets/:id ──────────────────────────────────────────────────────
/**
 * Met à jour les champs éditables d'un ticket (hors statut).
 * @param id — ID du ticket
 * @body description_panne?, diagnostic?, technicien_id?, prix_estime?, prix_final?,
 *       date_promesse?, notes_internes?, priorite?, etat_appareil?, code_deverrouillage?,
 *       code_sim?, signature_client?, signature_date?
 * @returns { success, message }
 */
tickets.put('/:id', async (c) => {
  const { user, db } = ctx(c)
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  // Même contrainte de format qu'à la création — voir POST / ci-dessus.
  if (body.signature_client) {
    const sigError = validateSignatureDataUrl(body.signature_client)
    if (sigError) return c.json({ success: false, error: sigError }, 400)
  }

  try {
    await updateTicket(db, id, user.sub, body)
    return c.json({ success: true, message: 'Ticket mis à jour.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ── PUT /api/tickets/:id/statut — Machine à états ─────────────────────────────
/**
 * Applique une transition de statut sur un ticket.
 * Hook garantie (savService) et email (emailService) au passage en 'termine'.
 * @param id — ID du ticket
 * @body statut (nouveau statut cible), commentaire?
 * @returns { success, message, statut, garantie? }
 */
tickets.put('/:id/statut', async (c) => {
  const { user, db, dbPort } = ctx(c)
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { statut, commentaire } = body

  try {
    const { statut_avant, statut_apres } = await updateStatutTicket(
      db, id, user.sub, statut as StatutTicket, commentaire
    )

    // ── Hooks à la clôture (statut 'termine' ou 'livre') — non bloquants ────
    let garantieCreee: any = null
    if (statut_apres === 'termine' || statut_apres === 'livre') {
      const ticketRow = await getTicketBoutiqueId(dbPort, id)

      if (ticketRow) {
        if (statut_apres === 'termine') {
          // Garantie automatique uniquement à la clôture 'termine'
          try {
            garantieCreee = await createGarantieFromTicket(dbPort, id, ticketRow.boutique_id)
          } catch { /* non bloquant */ }
        }

        // Email notification (termine ou livre)
        try {
          const frontendUrl = (c.env as any).FRONTEND_URL ?? 'http://localhost:3000'
          const tFull = await getTicketAvecClient(dbPort, id)

          if (tFull?.client_email) {
            // waitUntil() obligatoire — voir commentaire équivalent sur sendTicketCree ci-dessus
            if (statut_apres === 'termine') {
              c.executionCtx.waitUntil(sendTicketTermine(dbPort, ticketRow.boutique_id, tFull, garantieCreee, frontendUrl, c.env.RESEND_API_KEY).catch(() => {}))
            } else {
              c.executionCtx.waitUntil(sendTicketLivre(dbPort, ticketRow.boutique_id, tFull, frontendUrl, c.env.RESEND_API_KEY).catch(() => {}))
            }
          }
        } catch { /* non bloquant */ }
      }
    }

    return c.json({
      success: true,
      message: `Statut changé : ${statut_avant} → ${statut_apres}.`,
      statut:  statut_apres,
      ...(garantieCreee
        ? { garantie: { id: garantieCreee.id, date_fin: garantieCreee.date_fin, garantie_jours: garantieCreee.garantie_jours } }
        : {}),
    })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// SUPPRESSION
// ══════════════════════════════════════════════════════════════════════════════

// ── DELETE /api/tickets/:id ───────────────────────────────────────────────────
/**
 * Soft-delete un ticket (actif = 0). Réservé admin/manager.
 * @param id — ID du ticket
 * @returns { success, message }
 */
tickets.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const { user, db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  await deleteTicket(db, id, user.sub)
  return c.json({ success: true, message: 'Ticket supprimé.' })
})

// ══════════════════════════════════════════════════════════════════════════════
// PHOTOS (Sprint 2.36 — MOD-01) — getTicketForPhoto/listPhotos/getPhotoById migrées
// vers le port Database ; uploadPhoto/deletePhoto restent sur D1Database (auditLog)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/tickets/:id/photos ───────────────────────────────────────────────
/**
 * Liste toutes les photos d'un ticket.
 * @param id — ID du ticket
 * @returns { success, data: PhotoRow[] }
 */
tickets.get('/:id/photos', async (c) => {
  const { user, dbPort } = ctx(c)
  const ticketId = parseInt(c.req.param('id'), 10)

  try {
    const ticket = await getTicketForPhoto(dbPort, ticketId)
    if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

    // Isolation multi-tenant (fix 2026-07-16, ajusté le 2026-07-16) : admin (rôle global,
    // souvent sans boutique_id propre) accède à toute boutique sans le préciser en query
    // param — même convention que boutiques.ts (`user.role !== 'admin' && ...`). Non-admin
    // reste strictement limité à sa propre boutique. Avant cet ajustement, getBoutiqueId()
    // renvoyait null pour un admin sans boutique_id et sans query param, le bloquant à tort
    // sur ces 3 endpoints (le frontend n'envoie jamais boutique_id ici) — voir bugs.md.
    if (user.role !== 'admin' && ticket.boutique_id !== user.boutique_id) {
      return c.json({ success: false, error: 'Accès refusé.' }, 403)
    }

    const photos = await listPhotos(dbPort, ticketId)
    return c.json({ success: true, data: photos })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// ── POST /api/tickets/:id/photos ──────────────────────────────────────────────
/**
 * Upload une photo (multipart/form-data ou body binaire).
 * Accepte multipart avec champ `photo` (File) + champ `type` (avant|apres|autre).
 * Fallback : body binaire brut avec header X-Photo-Type et X-Photo-Name.
 *
 * @param id — ID du ticket
 * @body multipart: photo (File), type? (avant|apres|autre)
 * @returns { success, data: PhotoRow }
 */
tickets.post('/:id/photos', async (c) => {
  const { user, db, dbPort } = ctx(c)
  const ticketId = parseInt(c.req.param('id'), 10)

  const r2 = c.env.PHOTOS
  if (!r2) {
    return c.json({ success: false, error: 'Stockage R2 non configuré sur ce déploiement.' }, 503)
  }

  try {
    const ticket = await getTicketForPhoto(dbPort, ticketId)
    if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

    // Isolation multi-tenant : voir commentaire identique sur GET /:id/photos.
    if (user.role !== 'admin' && ticket.boutique_id !== user.boutique_id) {
      return c.json({ success: false, error: 'Accès refusé.' }, 403)
    }

    let buffer: ArrayBuffer
    let mime:   string
    let nom:    string
    let type:   TypePhoto = 'autre'

    const contentType = c.req.header('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      // ── Multipart (cas standard frontend) ────────────────────────────────
      const formData = await c.req.formData()
      const file = formData.get('photo') as File | null
      if (!file) return c.json({ success: false, error: 'Champ "photo" manquant dans le formulaire.' }, 422)

      buffer = await file.arrayBuffer()
      mime   = file.type || 'image/jpeg'
      nom    = file.name || 'photo.jpg'
      const typeParam = (formData.get('type') ?? 'autre') as string
      type   = (['avant', 'apres', 'autre'].includes(typeParam) ? typeParam : 'autre') as TypePhoto
    } else {
      // ── Body binaire brut (fallback curl / tests) ─────────────────────────
      buffer = await c.req.arrayBuffer()
      mime   = contentType.split(';')[0].trim() || 'image/jpeg'
      nom    = c.req.header('x-photo-name') ?? 'photo.jpg'
      const typeHeader = c.req.header('x-photo-type') ?? 'autre'
      type   = (['avant', 'apres', 'autre'].includes(typeHeader) ? typeHeader : 'autre') as TypePhoto
    }

    const photo = await uploadPhoto(r2, db, ticketId, user.sub, buffer, mime, nom, type)
    return c.json({ success: true, data: photo }, 201)
  } catch (err: any) {
    const status = err.message.includes('non autorisé') || err.message.includes('trop volumineux') ? 422 : 500
    return c.json({ success: false, error: err.message }, status)
  }
})

// ── GET /api/tickets/:id/photos/:photoId/view ─────────────────────────────────
/**
 * Proxy R2 → client : retourne le binaire de la photo.
 * Utilisé par les balises <img src="..."> du frontend.
 * @param id      — ID du ticket
 * @param photoId — ID de la photo
 * @returns Binaire de l'image avec Content-Type correct
 */
tickets.get('/:id/photos/:photoId/view', async (c) => {
  const { dbPort } = ctx(c)
  const photoId = parseInt(c.req.param('photoId'), 10)

  const r2 = c.env.PHOTOS
  if (!r2) return c.json({ success: false, error: 'R2 non configuré.' }, 503)

  try {
    const meta = await getPhotoById(dbPort, photoId)
    if (!meta) return c.json({ success: false, error: 'Photo introuvable.' }, 404)

    const obj = await r2.get(meta.r2_key)
    if (!obj) return c.json({ success: false, error: 'Fichier introuvable dans le stockage.' }, 404)

    return new Response(obj.body, {
      headers: {
        'Content-Type':  meta.mime_type,
        'Cache-Control': 'private, max-age=86400',
        'Content-Disposition': `inline; filename="${meta.nom_fichier}"`,
      },
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// ── GET /api/tickets/:id/photos/:photoId/url ──────────────────────────────────
/**
 * Retourne une URL d'accès directe et courte durée (5 min) à une photo, utilisable
 * telle quelle dans `<img src>` — contourne la limitation des balises `<img>` qui
 * ne peuvent jamais porter de header `Authorization` (voir lib/photoToken.ts).
 * @param id      — ID du ticket
 * @param photoId — ID de la photo
 * @returns { success, url, expires_in }
 */
tickets.get('/:id/photos/:photoId/url', async (c) => {
  const { user, dbPort } = ctx(c)
  const ticketId = parseInt(c.req.param('id'), 10)
  const photoId  = parseInt(c.req.param('photoId'), 10)

  try {
    const ticket = await getTicketForPhoto(dbPort, ticketId)
    if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)

    // Isolation multi-tenant : voir commentaire identique sur GET /:id/photos.
    if (user.role !== 'admin' && ticket.boutique_id !== user.boutique_id) {
      return c.json({ success: false, error: 'Accès refusé.' }, 403)
    }

    const meta = await getPhotoById(dbPort, photoId)
    if (!meta || meta.ticket_id !== ticketId) return c.json({ success: false, error: 'Photo introuvable.' }, 404)

    // Jeton scopé à la boutique réelle du ticket (pas celle de l'appelant — un admin
    // global n'a pas de boutique_id propre, mais le jeton doit rester vérifiable contre
    // la boutique effective de la photo pour rester cohérent avec photoToken.ts).
    const token = await signPhotoToken(photoId, ticket.boutique_id, c.env.JWT_SECRET)
    return c.json({ success: true, url: `/api/photo-view/${token}`, expires_in: 300 })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// ── DELETE /api/tickets/:id/photos/:photoId ───────────────────────────────────
/**
 * Supprime une photo (R2 + D1). Réservé admin/manager/technicien.
 * @param id      — ID du ticket
 * @param photoId — ID de la photo à supprimer
 * @returns { success, message }
 */
tickets.delete('/:id/photos/:photoId', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { user, db, dbPort } = ctx(c)
  const ticketId = parseInt(c.req.param('id'), 10)
  const photoId  = parseInt(c.req.param('photoId'), 10)

  const r2 = c.env.PHOTOS
  if (!r2) return c.json({ success: false, error: 'R2 non configuré.' }, 503)

  try {
    const meta = await getPhotoById(dbPort, photoId)
    if (!meta) return c.json({ success: false, error: 'Photo introuvable.' }, 404)
    if (meta.ticket_id !== ticketId) return c.json({ success: false, error: 'Photo non liée à ce ticket.' }, 403)

    await deletePhoto(r2, db, photoId, user.sub)
    return c.json({ success: true, message: 'Photo supprimée.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 500
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// ACOMPTE (sous-projet A — encaissement manuel)
// ══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/tickets/:id/acompte ────────────────────────────────────────────
/**
 * POST /api/tickets/:id/acompte
 * Facture un acompte pour ce ticket — voir
 * docs/superpowers/specs/2026-07-16-acompte-structure-design.md.
 * Réservé admin/manager (gestion financière, cohérent avec le reste de la
 * facturation dans ce projet — pas technicien, contrairement à l'override
 * "Accord" qui est volontairement plus large).
 *
 * @param id  — ID du ticket
 * @body { montant_ht, tva_taux, mode_paiement, reference? }
 * @returns 201 { success, facture_id, facture_numero, message }
 * @returns 409 si un acompte existe déjà pour ce ticket
 */
tickets.post('/:id/acompte', requireRole('admin', 'manager'), async (c) => {
  const { user, db, dbPort } = ctx(c)
  const ticketId = parseInt(c.req.param('id'), 10)

  const ticket = await getTicketById(dbPort, ticketId)
  if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)
  if (user.role !== 'admin' && ticket.boutique_id !== user.boutique_id) {
    return c.json({ success: false, error: 'Accès refusé.' }, 403)
  }

  const { montant_ht, tva_taux, mode_paiement, reference } = await c.req.json().catch(() => ({}))
  // typeof/isNaN, pas juste `<= 0` : une chaîne non numérique (ex. "abc") est truthy et
  // "abc" <= 0 vaut false (comparaison NaN), donc passerait ce garde et produirait des
  // totaux NaN sur une facture verrouillée NF525 — même garde que caisse.ts.
  if (typeof montant_ht !== 'number' || isNaN(montant_ht) || montant_ht <= 0)
    return c.json({ success: false, error: 'montant_ht doit être positif.' }, 400)
  if (!mode_paiement)
    return c.json({ success: false, error: 'mode_paiement obligatoire.' }, 400)

  try {
    const result = await createFactureAcompte(db, user.sub, {
      boutique_id: ticket.boutique_id,
      client_id:   ticket.client_id,
      ticket_id:   ticketId,
      devis_id:    ticket.devis_id ?? null,
      montant_ht,
      tva_taux:    tva_taux ?? 20,
      mode_paiement,
      reference,
    })
    return c.json({ success: true, ...result, message: 'Acompte facturé.' }, 201)
  } catch (err: any) {
    const status = err.message.includes('déjà été facturé') ? 409 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

export default tickets
