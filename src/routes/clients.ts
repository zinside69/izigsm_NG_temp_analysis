/**
 * routes/clients.ts — Controller CRUD Clients & Appareils
 * Sprint 2.15 — Refactoring complet : 0 SQL inline, délégation à clientService
 *
 * Rôle architectural : Controller pur (P3 BFF Hono).
 * Toute logique métier et accès DB délégués à src/services/clientService.ts.
 * Violation P1 (JOIN tickets inline) résolue — voir clientService.listClients().
 *
 * Endpoints exposés :
 *   GET    /api/clients                    — Liste paginée + filtres
 *   GET    /api/clients/:id                — Fiche client + appareils
 *   GET    /api/clients/:id/historique     — Historique consolidé CRM ★ nouveau
 *   POST   /api/clients                    — Création client
 *   POST   /api/clients/import-csv         — Import batch CSV ★ nouveau
 *   POST   /api/clients/:id/appareils      — Ajout appareil
 *   PUT    /api/clients/:id                — Mise à jour client
 *   DELETE /api/clients/:id                — Soft delete
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, validateEmail, auditLog }   from '../lib/db'
import {
  listClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  addAppareil,
  getHistoriqueClient,
  importClients,
  exportClientRgpd,
  purgeClient,
} from '../services/clientService'

type Bindings  = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const clients = new Hono<{ Bindings: Bindings; Variables: Variables }>()
clients.use('*', authMiddleware)

// ─── Helpers locaux ───────────────────────────────────────────────────────────

/**
 * Extrait user + db depuis le contexte Hono.
 * boutiqueId est résolu séparément selon la source (query param ou body).
 * @param c - Contexte Hono
 * @returns { user, db, queryBoutiqueId }
 */
function ctx(c: any) {
  const user = c.get('user')
  const queryBoutiqueId = c.req.query('boutique_id') ?? undefined
  return { user, db: c.env.DB as D1Database, queryBoutiqueId }
}

/**
 * Vérifie que le client appartient à la boutique de l'utilisateur.
 * @param user    - Payload JWT (role, boutique_id)
 * @param client  - Ligne client depuis la DB (doit avoir boutique_id)
 * @param boutiqueId - Boutique courante de l'utilisateur
 * @returns true si accès autorisé
 */
function canAccessClient(user: any, client: any, boutiqueId: number | null): boolean {
  if (user.role === 'admin') return true
  return client.boutique_id === boutiqueId
}

// ─── GET /api/clients ─────────────────────────────────────────────────────────

/**
 * Retourne la liste paginée des clients d'une boutique.
 * @query boutique_id - (admin) boutique cible
 * @query search      - Recherche nom / email / téléphone
 * @query page, limit - Pagination
 * @returns { success, data, pagination }
 */
clients.get('/', async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const query = c.req.query()
  const { limit, offset, page } = parsePagination(query)

  const result = await listClients(db, boutiqueId, {
    search: query.search ?? null,
    limit,
    offset,
    page,
  })

  return c.json({
    success: true,
    data: result.data,
    pagination: { page: result.page, limit: result.limit, total: result.total, pages: result.pages },
  })
})

// ─── GET /api/clients/:id ─────────────────────────────────────────────────────

/**
 * Retourne la fiche complète d'un client avec ses appareils.
 * @param id - ID du client
 * @returns { success, data: { client + appareils } }
 */
clients.get('/:id', async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  const id = parseInt(c.req.param('id'), 10)

  const client = await getClientById(db, id)
  if (!client) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  if (!canAccessClient(user, client, boutiqueId))
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  return c.json({ success: true, data: client })
})

// ─── GET /api/clients/:id/historique ─────────────────────────────────────────

/**
 * Retourne l'historique CRM consolidé d'un client :
 * tickets + factures + rachats + rendez-vous + KPIs synthèse.
 *
 * @param id          - ID du client
 * @query boutique_id - Boutique courante
 * @returns { success, data: { tickets, factures, rachats, rendez_vous, kpis } }
 */
clients.get('/:id/historique', async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const id = parseInt(c.req.param('id'), 10)

  // Vérification accès client
  const client = await getClientById(db, id)
  if (!client) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  if (!canAccessClient(user, client, boutiqueId))
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const historique = await getHistoriqueClient(db, id, boutiqueId)
  return c.json({ success: true, data: historique })
})

// ─── POST /api/clients ────────────────────────────────────────────────────────

/**
 * Crée un nouveau client.
 * @body prenom, nom* (obligatoires), email, telephone, adresse, code_postal, ville, pays, notes
 * @returns { success, id, message }
 */
clients.post('/', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()
  const { prenom, nom, email } = body
  // boutique_id peut venir du body (POST) ou du query param
  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  if (!prenom || !nom)
    return c.json({ success: false, error: 'Prénom et nom obligatoires.' }, 400)
  if (email && !validateEmail(email))
    return c.json({ success: false, error: 'Email invalide.' }, 400)

  const result = await createClient(db, boutiqueId, body)
  await auditLog(db, {
    boutique_id: boutiqueId, user_id: user.sub,
    action: 'CREATE_CLIENT', entite_type: 'client', entite_id: result.id, apres: body,
  })

  return c.json({ success: true, id: result.id, message: 'Client créé.' }, 201)
})

// ─── POST /api/clients/import-csv ────────────────────────────────────────────

/**
 * Importe un lot de clients depuis un tableau JSON (parsé côté frontend depuis CSV).
 * Chaque ligne doit avoir au minimum un nom ou un prénom.
 * Les doublons email sont ignorés silencieusement (skipped).
 *
 * @body { rows: ImportClientRow[] }
 * @returns { success, inserted, skipped, errors }
 */
clients.post('/import-csv', requireRole('admin', 'manager'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const body = await c.req.json()
  const rows = body.rows
  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  if (!Array.isArray(rows) || rows.length === 0)
    return c.json({ success: false, error: 'Tableau rows vide ou invalide.' }, 400)
  if (rows.length > 500)
    return c.json({ success: false, error: 'Import limité à 500 lignes par lot.' }, 400)

  const result = await importClients(db, boutiqueId, rows)

  await auditLog(db, {
    boutique_id: boutiqueId, user_id: user.sub,
    action: 'IMPORT_CLIENTS_CSV', entite_type: 'client', entite_id: null,
    apres: { nb_lignes: rows.length, ...result },
  })

  return c.json({
    success: true,
    message: `${result.inserted} client(s) importé(s), ${result.skipped} ignoré(s).`,
    ...result,
  })
})

// ─── PUT /api/clients/:id ─────────────────────────────────────────────────────

/**
 * Met à jour les informations d'un client.
 * @param id - ID du client
 * @body prenom, nom* (obligatoires), + champs optionnels
 * @returns { success, message }
 */
clients.put('/:id', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString() ?? queryBoutiqueId)
  const { prenom, nom, email } = body

  if (!prenom || !nom)
    return c.json({ success: false, error: 'Prénom et nom obligatoires.' }, 400)
  if (email && !validateEmail(email))
    return c.json({ success: false, error: 'Email invalide.' }, 400)

  const existing = await getClientById(db, id)
  if (!existing) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  if (!canAccessClient(user, existing, boutiqueId))
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  await updateClient(db, id, body)
  await auditLog(db, {
    boutique_id: existing.boutique_id, user_id: user.sub,
    action: 'UPDATE_CLIENT', entite_type: 'client', entite_id: id, apres: body,
  })

  return c.json({ success: true, message: 'Client mis à jour.' })
})

// ─── DELETE /api/clients/:id ──────────────────────────────────────────────────

/**
 * Désactive un client (soft delete).
 * @param id - ID du client
 * @returns { success, message }
 */
clients.delete('/:id', requireRole('admin', 'manager'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  const id = parseInt(c.req.param('id'), 10)

  const existing = await getClientById(db, id)
  if (!existing) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  if (!canAccessClient(user, existing, boutiqueId))
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  await deleteClient(db, id)
  await auditLog(db, {
    boutique_id: existing.boutique_id, user_id: user.sub,
    action: 'DELETE_CLIENT', entite_type: 'client', entite_id: id,
  })

  return c.json({ success: true, message: 'Client supprimé.' })
})

// ─── POST /api/clients/:id/appareils ──────────────────────────────────────────

/**
 * Ajoute un appareil à un client.
 * @param id  - ID du client propriétaire
 * @body marque*, modele*, type, imei, numero_serie, couleur, notes
 * @returns { success, id, message }
 */
clients.post('/:id/appareils', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const { db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { marque, modele } = body

  if (!marque || !modele)
    return c.json({ success: false, error: 'Marque et modèle obligatoires.' }, 400)

  const client = await getClientById(db, id)
  if (!client) return c.json({ success: false, error: 'Client introuvable.' }, 404)

  const result = await addAppareil(db, id, body)
  return c.json({ success: true, id: result.id, message: 'Appareil ajouté.' }, 201)
})

// ─── RGPD (Sprint 2.37) ───────────────────────────────────────────────────────

// ── GET /api/clients/:id/export-rgpd ─────────────────────────────────────────
/**
 * Export RGPD complet des données d'un client (Art. 15 — droit d'accès).
 * Retourne un JSON téléchargeable : données personnelles + tickets + factures + RDV + appareils.
 * Réservé admin/manager.
 *
 * @param id — ID du client
 * @returns JSON complet avec Content-Disposition attachment
 */
clients.get('/:id/export-rgpd', requireRole('admin', 'manager'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  const id = parseInt(c.req.param('id'), 10)

  const existing = await getClientById(db, id)
  if (!existing) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  if (!canAccessClient(user, existing, boutiqueId))
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const data = await exportClientRgpd(db, id)
  if (!data) return c.json({ success: false, error: 'Client introuvable.' }, 404)

  const filename = `rgpd_client_${id}_${new Date().toISOString().slice(0, 10)}.json`
  const json     = JSON.stringify(data, null, 2)

  return new Response(json, {
    headers: {
      'Content-Type':        'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

// ── DELETE /api/clients/:id/purge ─────────────────────────────────────────────
/**
 * Purge RGPD d'un client (Art. 17 — droit à l'effacement).
 * Pseudonymise les données personnelles. Conserve l'historique comptable.
 * Réservé admin uniquement — action irréversible.
 *
 * @param id — ID du client
 * @body confirm: true (obligatoire pour éviter les purges accidentelles)
 * @returns { success, message }
 */
clients.delete('/:id/purge', requireRole('admin'), async (c) => {
  const { user, db, queryBoutiqueId } = ctx(c)
  const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
  const id = parseInt(c.req.param('id'), 10)

  // Double confirmation obligatoire
  let body: any = {}
  try { body = await c.req.json() } catch { /* body optionnel */ }
  if (body.confirm !== true) {
    return c.json({
      success: false,
      error:   'Confirmation requise. Envoyez { "confirm": true } pour procéder à la purge RGPD.',
    }, 422)
  }

  const existing = await getClientById(db, id)
  if (!existing) return c.json({ success: false, error: 'Client introuvable.' }, 404)
  if (!canAccessClient(user, existing, boutiqueId))
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  try {
    await purgeClient(db, id, user.sub)
    return c.json({ success: true, message: `Client #${id} anonymisé (RGPD Art. 17).` })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('déjà')        ? 409
                 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

export default clients
