/**
 * routes/notifications.ts — Controller notifications email (Sprint 2.11 → 2.40)
 *
 * Endpoints :
 *   GET  /api/notifications/stats             → stats emails du mois
 *   GET  /api/notifications/logs              → journal des emails (paginé)
 *   POST /api/notifications/test              → email de test (destinataire libre)
 *   POST /api/notifications/relances          → batch relances tickets en attente
 *   POST /api/notifications/relances-devis    → batch relances devis sans réponse (G07)
 *   PUT  /api/boutiques/:id/settings (déjà géré dans boutiques.ts) → config email
 *
 * Architecture : 0 SQL ici — tout passe par emailService.ts
 *
 * Sprint 2.40 — G07 : relances automatiques devis non répondus
 */

import { Hono }              from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination }   from '../lib/db'
import {
  sendEmail,
  getEmailStats,
  listEmailLogs,
  getBoutiqueNomById,
  processRelances,
  processRelancesDevis,
  getEmailConfig,
} from '../services/emailService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string; FRONTEND_URL?: string; RESEND_API_KEY?: string }
const notifications = new Hono<{ Bindings: Bindings }>()

notifications.use('*', authMiddleware)

function ctx(c: any) {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, new URL(c.req.url).searchParams.get('boutique_id') ?? undefined)
  return { user, boutiqueId }
}

// ─── Stats emails ─────────────────────────────────────────────────────────────

/**
 * GET /api/notifications/stats
 */
notifications.get('/notifications/stats', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)

    const [stats, config] = await Promise.all([
      getEmailStats(c.env.DB, boutiqueId),
      getEmailConfig(c.env.DB, boutiqueId),
    ])

    return c.json({
      success: true,
      data: {
        ...stats,
        config: {
          provider:     config.provider,
          from:         config.from,
          api_key_set:  !!config.api_key,    // ne jamais retourner la clé
          notifs:       {
            ticket_cree:    config.notif_ticket_cree,
            ticket_termine: config.notif_ticket_termine,
            sav_ouvert:     config.notif_sav_ouvert,
            relance:        config.notif_relance,
          },
        },
      },
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Journal emails ───────────────────────────────────────────────────────────

/**
 * GET /api/notifications/logs
 * Query params : page, limit, type, statut
 */
notifications.get('/notifications/logs', async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)

    const query  = new URL(c.req.url).searchParams
    const { page, limit, offset } = parsePagination(Object.fromEntries(query))
    const type   = query.get('type')   ?? null
    const statut = query.get('statut') ?? null

    const { rows, total } = await listEmailLogs(c.env.DB, boutiqueId, { page, limit, offset, type, statut })

    return c.json({
      success: true,
      data: rows,
      pagination: {
        page, limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Email de test ────────────────────────────────────────────────────────────

/**
 * POST /api/notifications/test
 * Body : { to, message? }
 * Envoie un email de test pour vérifier la config.
 */
notifications.post('/notifications/test', requireRole('admin', 'manager'), async (c) => {
  try {
    const { user, boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)

    const body = await c.req.json()
    if (!body.to?.trim()) return c.json({ success: false, error: 'Adresse email destinataire obligatoire.' }, 422)

    const nomB = (await getBoutiqueNomById(c.env.DB, boutiqueId)) ?? 'iziGSM'

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;">
      <h2>✅ Configuration email opérationnelle</h2>
      <p>Cet email de test a été envoyé depuis <strong>${nomB}</strong> via iziGSM.</p>
      <p>Si vous recevez ce message, votre configuration email est correcte.</p>
      <hr><p style="color:#888;font-size:12px;">iziGSM — ${new Date().toLocaleString('fr-FR')}</p>
    </body></html>`

    const result = await sendEmail({
      db:         c.env.DB,
      boutiqueId,
      to:         body.to,
      sujet:      `[Test] Configuration email iziGSM — ${nomB}`,
      html,
      type:       'autre',
    })

    return c.json({
      success:   result.success,
      simulated: result.simulated,
      message:   result.simulated
        ? 'Mode simulé (aucune clé API configurée) — email non envoyé réellement.'
        : result.success
          ? 'Email de test envoyé avec succès.'
          : 'Échec d\'envoi — vérifiez la clé API.',
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Batch relances ───────────────────────────────────────────────────────────

/**
 * POST /api/notifications/relances
 * Lance manuellement le batch de relances clients.
 * En production, ce endpoint sera appelé via un Cron Trigger Cloudflare.
 */
notifications.post('/notifications/relances', requireRole('admin', 'manager'), async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)

    const frontendUrl = c.env.FRONTEND_URL ?? 'http://localhost:3000'
    const count       = await processRelances(c.env.DB, boutiqueId, frontendUrl, c.env.RESEND_API_KEY)

    return c.json({
      success: true,
      data:    { relances_envoyees: count },
      message: `${count} relance(s) envoyée(s).`,
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Batch relances devis ────────────────────────────────────────────────────

/**
 * POST /api/notifications/relances-devis
 * Lance manuellement le batch de relances pour les devis envoyés sans réponse.
 * Critères : statut=envoye, envoye_le > delai_relance_jours, non expiré, pas de relance récente.
 * En production, à appeler via Cron Trigger Cloudflare (même pattern que /relances).
 */
notifications.post('/notifications/relances-devis', requireRole('admin', 'manager'), async (c) => {
  try {
    const { boutiqueId } = ctx(c)
    if (!boutiqueId) return c.json({ success: false, error: 'boutique_id manquant.' }, 400)

    const frontendUrl = c.env.FRONTEND_URL ?? 'http://localhost:3000'
    const count       = await processRelancesDevis(c.env.DB, boutiqueId, frontendUrl, c.env.RESEND_API_KEY)

    return c.json({
      success: true,
      data:    { relances_envoyees: count },
      message: `${count} relance(s) devis envoyée(s).`,
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default notifications
