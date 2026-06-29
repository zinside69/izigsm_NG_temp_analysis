/**
 * routes/facturation.ts — Devis, Factures, Paiements + NF525
 * Architecture P1 MVC : Controller pur — 0 SQL (tout délégué aux services).
 * Sprint 2.20 : section Factures/Avoirs migrée vers factureService.
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination } from '../lib/db'
import {
  listDevis, getDevis, createDevis, updateDevis,
  updateStatutDevis, convertirDevis, getStatsDevis,
  expireDevisPerimes, type StatutDevis,
} from '../services/devisService'
import {
  listFactures, getFacture, ajouterPaiement, emettreFacture,
  listAvoirs, getAvoir, createAvoir,
} from '../services/factureService'
import { sendEmail } from '../services/emailService'
import { enregistrerTransaction } from '../lib/nf525'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string; FRONTEND_URL?: string }
type Variables = { user: any }

const facturation = new Hono<{ Bindings: Bindings; Variables: Variables }>()
facturation.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// DEVIS — Controller pur (0 SQL), délègue à devisService
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/devis
 * Query : page, limit, statut, client_id, search, boutique_id
 */
facturation.get('/devis', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listDevis(c.env.DB, boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

/**
 * GET /api/devis/stats
 * Statistiques agrégées des devis d'une boutique.
 */
facturation.get('/devis/stats', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await getStatsDevis(c.env.DB, boutiqueId)
  return c.json({ success: true, data })
})

/**
 * POST /api/devis/expire
 * Expire les devis dont la date_validite est dépassée (cron-like, admin uniquement).
 */
facturation.post('/devis/expire', requireRole('admin'), async (c) => {
  const count = await expireDevisPerimes(c.env.DB)
  return c.json({ success: true, data: { expires: count }, message: `${count} devis expiré(s).` })
})

/**
 * POST /api/devis
 * Crée un devis avec ses lignes. Génère numéro séquentiel + public_token.
 * Body : { boutique_id?, client_id, ticket_id?, lignes[], notes?, conditions?, date_validite? }
 */
facturation.post('/devis', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  if (!body.client_id || !body.lignes?.length)
    return c.json({ success: false, error: 'client_id et lignes obligatoires.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const result = await createDevis(c.env.DB, boutiqueId, user.sub, { ...body, boutique_id: boutiqueId })
    return c.json({ success: true, ...result, message: 'Devis créé.' }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * GET /api/devis/:id
 * Détail complet d'un devis avec lignes, client et boutique.
 */
facturation.get('/devis/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getDevis(c.env.DB, id)
  if (!data) return c.json({ success: false, error: 'Devis introuvable.' }, 404)
  return c.json({ success: true, data })
})

/**
 * PUT /api/devis/:id
 * Modifie un devis (uniquement si statut = draft).
 * Body : { client_id?, lignes?, notes?, conditions?, date_validite? }
 */
facturation.put('/devis/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  try {
    await updateDevis(c.env.DB, id, user.sub, body)
    return c.json({ success: true, message: 'Devis mis à jour.' })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * PUT /api/devis/:id/statut
 * Change le statut d'un devis (machine à états enforced).
 * Body : { statut }  — valeurs : envoye | accepte | refuse | expire | annule
 */
facturation.put('/devis/:id/statut', requireRole('admin', 'manager'), async (c) => {
  const user   = c.get('user')
  const id     = parseInt(c.req.param('id'), 10)
  const { statut } = await c.req.json()
  if (!statut) return c.json({ success: false, error: 'statut obligatoire.' }, 400)

  try {
    const result = await updateStatutDevis(c.env.DB, id, user.sub, statut as StatutDevis)
    return c.json({ success: true, ...result, message: `Statut mis à jour : ${statut}.` })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * POST /api/devis/:id/envoyer
 * Marque le devis comme "envoye" et notifie le client par email.
 * Le lien public_token est inclus dans l'email.
 */
facturation.post('/devis/:id/envoyer', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  const data = await getDevis(c.env.DB, id)
  if (!data) return c.json({ success: false, error: 'Devis introuvable.' }, 404)
  if (!data.client_email) return c.json({ success: false, error: 'Le client n\'a pas d\'email renseigné.' }, 422)

  try {
    await updateStatutDevis(c.env.DB, id, user.sub, 'envoye')
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }

  // Construire lien acceptation
  const baseUrl     = c.env.FRONTEND_URL ?? 'http://localhost:3000'
  const lienPublic  = `${baseUrl}/devis-public?token=${data.public_token}`
  const expiration  = data.date_validite
    ? `<p>Ce devis est valable jusqu'au <strong>${new Date(data.date_validite).toLocaleDateString('fr-FR')}</strong>.</p>`
    : ''

  // Envoi email non bloquant
  sendEmail({
    db:         c.env.DB,
    boutiqueId: data.boutique_id,
    to:         data.client_email,
    sujet:      `Devis ${data.numero} — ${data.boutique_nom}`,
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#6366f1;">📄 Votre devis ${data.numero}</h2>
      <p>Bonjour ${data.client_prenom || data.client_nom},</p>
      <p><strong>${data.boutique_nom}</strong> vous a envoyé un devis de <strong>${data.total_ttc?.toFixed(2)} € TTC</strong>.</p>
      ${expiration}
      <div style="text-align:center;margin:30px 0;">
        <a href="${lienPublic}" style="background:#6366f1;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Consulter et répondre au devis →
        </a>
      </div>
      <p style="color:#888;font-size:12px;">Ou copiez ce lien dans votre navigateur : ${lienPublic}</p>
      <hr><p style="color:#888;font-size:11px;">${data.boutique_nom} — ${data.boutique_telephone ?? ''} — ${data.boutique_email ?? ''}</p>
    </body></html>`,
    type: 'devis',
  }).catch(() => {/* non bloquant */})

  return c.json({
    success:      true,
    lien_public:  lienPublic,
    message:      `Devis ${data.numero} envoyé — email de notification envoyé à ${data.client_email}.`,
  })
})

/**
 * PUT /api/devis/:id/convertir
 * Convertit un devis en facture (avec chaîne NF525).
 */
facturation.put('/devis/:id/convertir', requireRole('admin', 'manager'), async (c) => {
  const user    = c.get('user')
  const devisId = parseInt(c.req.param('id'), 10)

  try {
    const { facture_id, facture_numero } = await convertirDevis(c.env.DB, devisId, user.sub)

    // ── NF525 : récupérer le devis pour l'enregistrement ──────────────────
    const devis = await c.env.DB.prepare('SELECT * FROM devis WHERE id = ?').bind(devisId).first<any>()
    if (devis) {
      const hashNf525 = await enregistrerTransaction(c.env.DB, {
        boutique_id: devis.boutique_id, type_transaction: 'facture',
        reference_id: facture_id, reference_numero: facture_numero,
        client_id: devis.client_id,
        montant_ht: devis.total_ht, montant_tva: devis.total_tva, montant_ttc: devis.total_ttc,
        date_transaction: new Date().toISOString(), user_id: user.sub,
      })
      await c.env.DB.prepare('UPDATE factures SET hash_nf525 = ? WHERE id = ?').bind(hashNf525, facture_id).run()
    }

    return c.json({ success: true, facture_id, facture_numero, message: 'Devis converti en facture.' })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// FACTURES — Controller pur (0 SQL), délègue à factureService
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/factures
 * Liste paginée des factures d'une boutique.
 * Query : page, limit, statut, client_id, boutique_id
 */
facturation.get('/factures', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listFactures(c.env.DB, boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

/**
 * GET /api/factures/:id
 * Détail complet d'une facture (lignes + paiements + infos client/boutique).
 */
facturation.get('/factures/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getFacture(c.env.DB, id)
  if (!data) return c.json({ success: false, error: 'Facture introuvable.' }, 404)
  return c.json({ success: true, data })
})

/**
 * POST /api/factures/:id/paiement
 * Enregistre un paiement et met à jour le statut (payee / partiellement_payee).
 * Body : { montant, mode_paiement, reference?, notes? }
 */
facturation.post('/factures/:id/paiement', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const factureId = parseInt(c.req.param('id'), 10)
  const body      = await c.req.json()

  if (!body.montant || !body.mode_paiement)
    return c.json({ success: false, error: 'montant et mode_paiement obligatoires.' }, 400)

  try {
    const result = await ajouterPaiement(c.env.DB, factureId, user.sub, body)
    return c.json({ success: true, ...result, message: 'Paiement enregistré.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('verrouillée') ? 403 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// EMISSION FACTURE (CGI art. 289 — verrouillage inaltérable)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/factures/:id/emettre
 * Émet la facture : verrouillage NF525 + hash SHA-256 + tracking_token.
 * La facture devient inaltérable (CGI art. 289).
 */
facturation.post('/factures/:id/emettre', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const factureId = parseInt(c.req.param('id'), 10)

  try {
    const result = await emettreFacture(c.env.DB, factureId, user.sub)
    return c.json({
      success:    true,
      facture_id: factureId,
      ...result,
      message:    'Facture émise et verrouillée conformément au CGI art. 289.',
    })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('verrouillée') ? 400 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// AVOIRS (NF525 — chaîne SHA-256 anti-fraude) — Controller pur
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/avoirs
 * Liste paginée des avoirs. Query : page, limit, statut, facture_id, client_id
 */
facturation.get('/avoirs', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listAvoirs(c.env.DB, boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

/**
 * GET /api/avoirs/:id
 * Détail complet d'un avoir (+ lignes).
 */
facturation.get('/avoirs/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getAvoir(c.env.DB, id)
  if (!data) return c.json({ success: false, error: 'Avoir introuvable.' }, 404)
  return c.json({ success: true, data })
})

/**
 * POST /api/avoirs
 * Crée un avoir sur une facture émise (NF525 obligatoire).
 * Body : { facture_id, type?, motif, lignes[], notes? }
 */
facturation.post('/avoirs', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  if (!body.facture_id) return c.json({ success: false, error: 'facture_id obligatoire.' }, 400)
  if (!body.motif)      return c.json({ success: false, error: 'motif obligatoire.' }, 400)
  if (!body.lignes?.length) return c.json({ success: false, error: 'Au moins une ligne obligatoire.' }, 400)

  try {
    const result = await createAvoir(c.env.DB, user.sub, body)
    return c.json({
      success:    true,
      ...result,
      message:    'Avoir créé et enregistré dans le journal NF525.',
    }, 201)
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('non émise')   ? 400 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

export default facturation
