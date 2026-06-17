/**
 * routes/facturation.ts — Devis, Factures, Paiements + NF525
 * Architecture P1 MVC : Controller pur — 0 SQL pour les devis (délégué à devisService).
 * Les sections Factures/Avoirs conservent leur SQL inline (refactoring Sprint 2.20).
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, nextNumero, calculLignes, auditLog } from '../lib/db'
import { enregistrerTransaction } from '../lib/nf525'
import {
  listDevis, getDevis, createDevis, updateDevis,
  updateStatutDevis, convertirDevis, getStatsDevis,
  expireDevisPerimes, type StatutDevis,
} from '../services/devisService'
import { sendEmail } from '../services/emailService'

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
// FACTURES
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/factures ─────────────────────────────────────────────────────────
facturation.get('/factures', async (c) => {
  const user   = c.get('user')
  const query  = c.req.query()
  const { limit, offset, page } = parsePagination(query)
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const rows = await c.env.DB.prepare(`
    SELECT f.id, f.numero, f.statut, f.total_ttc, f.montant_paye, f.date_emission,
           f.hash_nf525, c.prenom || ' ' || c.nom as client_nom
    FROM   factures f
    JOIN   clients c ON c.id = f.client_id
    WHERE  f.boutique_id = ?
    ORDER  BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(boutiqueId, limit, offset).all()

  return c.json({ success: true, data: rows.results, pagination: { page, limit, total: 0, pages: 1 } })
})

// ── GET /api/factures/:id ─────────────────────────────────────────────────────
facturation.get('/factures/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)

  const facture = await c.env.DB.prepare(`
    SELECT f.*, c.prenom || ' ' || c.nom as client_nom, c.email as client_email,
           c.telephone as client_telephone, c.adresse, c.code_postal, c.ville,
           b.nom as boutique_nom, b.siret, b.tva_numero, b.adresse as boutique_adresse
    FROM   factures f
    JOIN   clients c ON c.id = f.client_id
    JOIN   boutiques b ON b.id = f.boutique_id
    WHERE  f.id = ?
  `).bind(id).first()
  if (!facture) return c.json({ success: false, error: 'Facture introuvable.' }, 404)

  const lignes = await c.env.DB.prepare(
    "SELECT * FROM lignes_document WHERE document_type = 'facture' AND document_id = ? ORDER BY ordre"
  ).bind(id).all()

  const paiements = await c.env.DB.prepare(
    'SELECT * FROM paiements WHERE facture_id = ? ORDER BY created_at'
  ).bind(id).all()

  return c.json({ success: true, data: { ...facture, lignes: lignes.results, paiements: paiements.results } })
})

// ── POST /api/factures/:id/paiement ──────────────────────────────────────────
facturation.post('/factures/:id/paiement', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const factureId = parseInt(c.req.param('id'), 10)
  const { montant, mode_paiement, reference, notes } = await c.req.json()

  if (!montant || !mode_paiement)
    return c.json({ success: false, error: 'montant et mode_paiement obligatoires.' }, 400)

  const facture = await c.env.DB.prepare('SELECT id, total_ttc, montant_paye, boutique_id, locked FROM factures WHERE id = ?')
    .bind(factureId).first<any>()
  if (!facture) return c.json({ success: false, error: 'Facture introuvable.' }, 404)
  if (facture.locked) return c.json({ success: false, error: 'Facture verrouillée — modification interdite (CGI art. 289).' }, 403)

  await c.env.DB.prepare(`
    INSERT INTO paiements (facture_id, boutique_id, montant, mode_paiement, reference, user_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(factureId, facture.boutique_id, montant, mode_paiement, reference ?? null, user.sub, notes ?? null).run()

  // Mettre à jour montant_paye et statut
  const nouveauMontantPaye = facture.montant_paye + montant
  const statut = nouveauMontantPaye >= facture.total_ttc ? 'payee' : 'partiellement_payee'

  await c.env.DB.prepare(`
    UPDATE factures SET montant_paye = ?, statut = ?, date_paiement = CASE WHEN ? >= total_ttc THEN CURRENT_TIMESTAMP ELSE date_paiement END
    WHERE  id = ?
  `).bind(nouveauMontantPaye, statut, nouveauMontantPaye, factureId).run()

  return c.json({ success: true, montant_paye: nouveauMontantPaye, statut, message: 'Paiement enregistré.' })
})

// ══════════════════════════════════════════════════════════════════════════════
// EMISSION FACTURE (CGI art. 289 — verrouillage inaltérable)
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/factures/:id/emettre ────────────────────────────────────────────
facturation.post('/factures/:id/emettre', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const factureId = parseInt(c.req.param('id'), 10)

  const facture = await c.env.DB.prepare('SELECT * FROM factures WHERE id = ?')
    .bind(factureId).first<any>()
  if (!facture) return c.json({ success: false, error: 'Facture introuvable.' }, 404)
  if (facture.locked) return c.json({ success: false, error: 'Facture déjà émise et verrouillée.' }, 400)

  // Générer un tracking_token UUID pour la vitrine client (Sprint 2.7)
  const trackingToken = crypto.randomUUID()

  // Chaîner le hash NF525 (inscription dans le journal)
  const hashNf525 = await enregistrerTransaction(c.env.DB, {
    boutique_id:      facture.boutique_id,
    type_transaction: 'facture',
    reference_id:     facture.id,
    reference_numero: facture.numero,
    client_id:        facture.client_id,
    montant_ht:       facture.total_ht,
    montant_tva:      facture.total_tva,
    montant_ttc:      facture.total_ttc,
    date_transaction: new Date().toISOString(),
    user_id:          user.sub,
  })

  // Verrouiller la facture — CGI art. 289 (inaltérable après émission)
  await c.env.DB.prepare(`
    UPDATE factures
    SET locked = 1, issued_at = CURRENT_TIMESTAMP,
        tracking_token = ?, hash_nf525 = ?,
        statut = CASE WHEN statut = 'brouillon' THEN 'en_attente' ELSE statut END
    WHERE id = ?
  `).bind(trackingToken, hashNf525, factureId).run()

  await auditLog(c.env.DB, {
    boutique_id: facture.boutique_id, user_id: user.sub,
    action: 'EMETTRE_FACTURE', entite_type: 'facture', entite_id: factureId,
    apres: { locked: true, issued_at: new Date().toISOString(), hash_nf525: hashNf525 },
  })

  return c.json({
    success: true,
    facture_id:     factureId,
    facture_numero: facture.numero,
    tracking_token: trackingToken,
    hash_nf525:     hashNf525,
    message:        'Facture émise et verrouillée conformément au CGI art. 289.',
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// AVOIRS (NF525 — chaîne SHA-256 anti-fraude)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/avoirs ───────────────────────────────────────────────────────────
facturation.get('/avoirs', async (c) => {
  const user   = c.get('user')
  const query  = c.req.query()
  const { limit, offset, page } = parsePagination(query)
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const conditions = ['a.boutique_id = ?']
  const bindings: any[] = [boutiqueId]
  if (query.statut)     { conditions.push('a.statut = ?');     bindings.push(query.statut) }
  if (query.facture_id) { conditions.push('a.facture_id = ?'); bindings.push(parseInt(query.facture_id, 10)) }
  if (query.client_id)  { conditions.push('a.client_id = ?');  bindings.push(parseInt(query.client_id, 10)) }
  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM avoirs a ${where}`)
    .bind(...bindings).first<{ cnt: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT a.id, a.numero, a.type, a.motif, a.statut, a.total_ttc,
           a.date_emission, a.facture_id, f.numero as facture_numero,
           c.prenom || ' ' || c.nom as client_nom
    FROM   avoirs a
    JOIN   factures f ON f.id = a.facture_id
    JOIN   clients  c ON c.id = a.client_id
    ${where}
    ORDER  BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return c.json({
    success: true,
    data:       rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) },
  })
})

// ── GET /api/avoirs/:id ───────────────────────────────────────────────────────
facturation.get('/avoirs/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)

  const avoir = await c.env.DB.prepare(`
    SELECT a.*,
           c.prenom || ' ' || c.nom as client_nom, c.email as client_email, c.telephone as client_telephone,
           c.adresse, c.code_postal, c.ville,
           b.nom as boutique_nom, b.siret, b.tva_numero, b.adresse as boutique_adresse,
           f.numero as facture_numero
    FROM   avoirs a
    JOIN   clients   c ON c.id = a.client_id
    JOIN   boutiques b ON b.id = a.boutique_id
    JOIN   factures  f ON f.id = a.facture_id
    WHERE  a.id = ?
  `).bind(id).first()
  if (!avoir) return c.json({ success: false, error: 'Avoir introuvable.' }, 404)

  const lignes = await c.env.DB.prepare(
    'SELECT * FROM lignes_avoir WHERE avoir_id = ? ORDER BY ordre'
  ).bind(id).all()

  return c.json({ success: true, data: { ...avoir, lignes: lignes.results } })
})

// ── POST /api/avoirs ──────────────────────────────────────────────────────────
facturation.post('/avoirs', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { facture_id, type = 'remboursement', motif, lignes, notes } = body

  // ── Validations ──────────────────────────────────────────────────────────
  if (!facture_id) return c.json({ success: false, error: 'facture_id obligatoire.' }, 400)
  if (!motif)      return c.json({ success: false, error: 'motif obligatoire.' }, 400)
  if (!lignes?.length) return c.json({ success: false, error: 'Au moins une ligne obligatoire.' }, 400)

  const typesValides = ['remboursement', 'bon_achat', 'echange']
  if (!typesValides.includes(type))
    return c.json({ success: false, error: `type doit être parmi : ${typesValides.join(', ')}.` }, 400)

  // ── Vérifier que la facture existe ET est verrouillée ─────────────────────
  // Un avoir ne peut être émis que sur une facture officielle (locked=1)
  const facture = await c.env.DB.prepare('SELECT * FROM factures WHERE id = ?')
    .bind(facture_id).first<any>()
  if (!facture) return c.json({ success: false, error: 'Facture introuvable.' }, 404)
  if (!facture.locked)
    return c.json({ success: false, error: 'Impossible d\'émettre un avoir sur une facture non émise.' }, 400)

  const boutiqueId = facture.boutique_id

  // ── Calcul montants ───────────────────────────────────────────────────────
  const { total_ht, total_tva, total_ttc } = calculLignes(lignes)

  // ── Numéro séquentiel AV-AAAA-XXXXX ──────────────────────────────────────
  const numero = await nextNumero(c.env.DB, boutiqueId, 'avoir')

  // ── Insérer l'avoir ───────────────────────────────────────────────────────
  const result = await c.env.DB.prepare(`
    INSERT INTO avoirs (boutique_id, numero, facture_id, client_id, type, motif, total_ht, total_tva, total_ttc, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(boutiqueId, numero, facture_id, facture.client_id, type, motif,
          total_ht, total_tva, total_ttc, notes ?? null).first<{ id: number }>()

  if (!result?.id) throw new Error('Erreur création avoir')
  const avoirId = result.id

  // ── Insérer les lignes ────────────────────────────────────────────────────
  for (let i = 0; i < lignes.length; i++) {
    const l   = lignes[i]
    const ht  = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100
    const tva = Math.round(ht * ((l.tva_taux ?? 20) / 100) * 100) / 100
    await c.env.DB.prepare(`
      INSERT INTO lignes_avoir (avoir_id, ordre, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(avoirId, i + 1, l.description, l.quantite, l.prix_unitaire_ht, l.tva_taux ?? 20,
            ht, tva, ht + tva).run()
  }

  // ── Chaîne NF525 — avoir obligatoirement enregistré dans le journal ───────
  const hashNf525 = await enregistrerTransaction(c.env.DB, {
    boutique_id:      boutiqueId,
    type_transaction: 'avoir',
    reference_id:     avoirId,
    reference_numero: numero,
    client_id:        facture.client_id,
    montant_ht:       total_ht,
    montant_tva:      total_tva,
    montant_ttc:      total_ttc,
    date_transaction: new Date().toISOString(),
    user_id:          user.sub,
  })

  // Stocker le hash sur l'avoir
  await c.env.DB.prepare('UPDATE avoirs SET hash_nf525 = ? WHERE id = ?').bind(hashNf525, avoirId).run()

  await auditLog(c.env.DB, {
    boutique_id: boutiqueId, user_id: user.sub,
    action: 'CREATE_AVOIR', entite_type: 'avoir', entite_id: avoirId,
    apres: { numero, facture_id, type, motif, total_ttc, hash_nf525: hashNf525 },
  })

  return c.json({
    success:    true,
    id:         avoirId,
    numero,
    hash_nf525: hashNf525,
    message:    'Avoir créé et enregistré dans le journal NF525.',
  }, 201)
})

export default facturation
