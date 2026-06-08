/**
 * routes/boutiques.ts — CRUD Boutiques & Paramètres
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../lib/middleware'
import { verifyChain, clotureJournaliere } from '../lib/nf525'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const boutiques = new Hono<{ Bindings: Bindings; Variables: Variables }>()
boutiques.use('*', authMiddleware)

// ── GET /api/boutiques ────────────────────────────────────────────────────────
boutiques.get('/', async (c) => {
  const user = c.get('user')

  const rows = user.role === 'admin'
    ? await c.env.DB.prepare('SELECT * FROM boutiques WHERE actif = 1 ORDER BY nom').all()
    : await c.env.DB.prepare('SELECT * FROM boutiques WHERE id = ? AND actif = 1').bind(user.boutique_id).all()

  return c.json({ success: true, data: rows.results })
})

// ── GET /api/boutiques/:id ────────────────────────────────────────────────────
boutiques.get('/:id', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const boutique = await c.env.DB.prepare('SELECT * FROM boutiques WHERE id = ? AND actif = 1').bind(id).first()
  if (!boutique) return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

  const settings = await c.env.DB.prepare('SELECT * FROM boutique_settings WHERE boutique_id = ?').bind(id).first()

  return c.json({ success: true, data: { ...boutique, settings } })
})

// ── POST /api/boutiques ───────────────────────────────────────────────────────
boutiques.post('/', requireRole('admin'), async (c) => {
  const { nom, siret, tva_numero, adresse, code_postal, ville, telephone, email } = await c.req.json()
  if (!nom) return c.json({ success: false, error: 'Nom obligatoire.' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO boutiques (nom, siret, tva_numero, adresse, code_postal, ville, telephone, email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(nom, siret ?? null, tva_numero ?? null, adresse ?? null, code_postal ?? null, ville ?? null, telephone ?? null, email ?? null)
    .first<{ id: number }>()

  await c.env.DB.prepare('INSERT INTO boutique_settings (boutique_id) VALUES (?)').bind(result?.id).run()
  return c.json({ success: true, id: result?.id, message: 'Boutique créée.' }, 201)
})

// ── PUT /api/boutiques/:id ────────────────────────────────────────────────────
boutiques.put('/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const { nom, siret, tva_numero, adresse, code_postal, ville, telephone, email,
          site_web, slug, description, facebook_url, instagram_url, google_maps_url } = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE boutiques SET
      nom=COALESCE(?,nom), siret=COALESCE(?,siret), tva_numero=COALESCE(?,tva_numero),
      adresse=COALESCE(?,adresse), code_postal=COALESCE(?,code_postal), ville=COALESCE(?,ville),
      telephone=COALESCE(?,telephone), email=COALESCE(?,email), site_web=COALESCE(?,site_web),
      slug=COALESCE(?,slug), description=COALESCE(?,description),
      facebook_url=COALESCE(?,facebook_url), instagram_url=COALESCE(?,instagram_url),
      google_maps_url=COALESCE(?,google_maps_url),
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(nom ?? null, siret ?? null, tva_numero ?? null,
          adresse ?? null, code_postal ?? null, ville ?? null,
          telephone ?? null, email ?? null, site_web ?? null,
          slug ?? null, description ?? null,
          facebook_url ?? null, instagram_url ?? null, google_maps_url ?? null, id).run()

  return c.json({ success: true, message: 'Boutique mise à jour.' })
})

// ── PUT /api/boutiques/:id/settings ──────────────────────────────────────────
boutiques.put('/:id/settings', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const {
    tva_taux_defaut, horaires, notif_email_actif, notif_sms_actif,
    paiement_especes, paiement_cb, paiement_cheque, paiement_virement,
    // Numérotation configurable (Sprint 2.9)
    prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat,
    format_numero, padding_numero,
    // Paramètres métier
    garantie_defaut_jours, delai_relance_jours, mention_facture, pied_de_page,
  } = await c.req.json()

  // Validations numérotation
  const FORMATS_VALIDES = ['annee', 'simple']
  if (format_numero && !FORMATS_VALIDES.includes(format_numero))
    return c.json({ success: false, error: `format_numero invalide. Valeurs : ${FORMATS_VALIDES.join(', ')}.` }, 422)
  if (padding_numero && (padding_numero < 3 || padding_numero > 8))
    return c.json({ success: false, error: 'padding_numero doit être entre 3 et 8.' }, 422)

  await c.env.DB.prepare(`
    UPDATE boutique_settings SET
      tva_taux_defaut=?, horaires=?, notif_email_actif=?, notif_sms_actif=?,
      paiement_especes=?, paiement_cb=?, paiement_cheque=?, paiement_virement=?,
      prefix_ticket=COALESCE(?,prefix_ticket), prefix_facture=COALESCE(?,prefix_facture),
      prefix_devis=COALESCE(?,prefix_devis),   prefix_avoir=COALESCE(?,prefix_avoir),
      prefix_rachat=COALESCE(?,prefix_rachat),
      format_numero=COALESCE(?,format_numero),  padding_numero=COALESCE(?,padding_numero),
      garantie_defaut_jours=COALESCE(?,garantie_defaut_jours),
      delai_relance_jours=COALESCE(?,delai_relance_jours),
      mention_facture=COALESCE(?,mention_facture),
      pied_de_page=COALESCE(?,pied_de_page),
      updated_at=CURRENT_TIMESTAMP
    WHERE boutique_id=?
  `).bind(
    tva_taux_defaut ?? 20, horaires ? JSON.stringify(horaires) : null,
    notif_email_actif ? 1 : 0, notif_sms_actif ? 1 : 0,
    paiement_especes ? 1 : 0, paiement_cb ? 1 : 0, paiement_cheque ? 1 : 0, paiement_virement ? 1 : 0,
    prefix_ticket  ?? null, prefix_facture ?? null,
    prefix_devis   ?? null, prefix_avoir   ?? null, prefix_rachat  ?? null,
    format_numero  ?? null, padding_numero ?? null,
    garantie_defaut_jours ?? null, delai_relance_jours ?? null,
    mention_facture ?? null, pied_de_page ?? null,
    id
  ).run()

  return c.json({ success: true, message: 'Paramètres mis à jour.' })
})

// ── GET /api/boutiques/:id/stats ──────────────────────────────────────────────
boutiques.get('/:id/stats', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const [clients, tickets, ca_mois, stock_bas] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM clients WHERE boutique_id = ? AND actif = 1').bind(id).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND statut NOT IN ('livre','annule') AND actif = 1").bind(id).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures WHERE boutique_id = ? AND statut='payee' AND strftime('%Y-%m',date_emission) = strftime('%Y-%m','now')").bind(id).first<{ ca: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM produits WHERE boutique_id = ? AND stock_actuel <= stock_minimum AND actif = 1').bind(id).first<{ cnt: number }>(),
  ])

  return c.json({
    success: true,
    data: {
      nb_clients:         clients?.cnt ?? 0,
      tickets_en_cours:   tickets?.cnt ?? 0,
      ca_mois:            ca_mois?.ca  ?? 0,
      produits_stock_bas: stock_bas?.cnt ?? 0,
    }
  })
})

// ── GET /api/boutiques/:id/nf525/verify ───────────────────────────────────────
boutiques.get('/:id/nf525/verify', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const result = await verifyChain(c.env.DB, id)
  return c.json({ success: true, verification: result })
})

// ── POST /api/boutiques/:id/nf525/cloture ─────────────────────────────────────
boutiques.post('/:id/nf525/cloture', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const { date } = await c.req.json().catch(() => ({ date: new Date().toISOString().split('T')[0] }))
  const result = await clotureJournaliere(c.env.DB, id, date, user.sub)
  return c.json({ success: result.success, message: result.message })
})

export default boutiques
