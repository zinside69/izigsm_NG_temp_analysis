/**
 * routes/facturation.ts — Devis, Factures, Paiements + NF525
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, nextNumero, calculLignes, auditLog } from '../lib/db'
import { enregistrerTransaction } from '../lib/nf525'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const facturation = new Hono<{ Bindings: Bindings; Variables: Variables }>()
facturation.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// DEVIS
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/devis ────────────────────────────────────────────────────────────
facturation.get('/devis', async (c) => {
  const user   = c.get('user')
  const query  = c.req.query()
  const { limit, offset, page } = parsePagination(query)
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const conditions = ['d.boutique_id = ?']
  const bindings: any[] = [boutiqueId]
  if (query.statut)    { conditions.push('d.statut = ?');   bindings.push(query.statut) }
  if (query.client_id) { conditions.push('d.client_id = ?'); bindings.push(parseInt(query.client_id, 10)) }
  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM devis d ${where}`)
    .bind(...bindings).first<{ cnt: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT d.id, d.numero, d.statut, d.total_ttc, d.date_emission, d.date_validite, d.facture_id,
           c.prenom || ' ' || c.nom as client_nom
    FROM   devis d
    JOIN   clients c ON c.id = d.client_id
    ${where}
    ORDER  BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return c.json({ success: true, data: rows.results, pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) } })
})

// ── POST /api/devis ───────────────────────────────────────────────────────────
facturation.post('/devis', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { client_id, ticket_id, lignes, notes, conditions: conds, date_validite } = body

  if (!client_id || !lignes?.length)
    return c.json({ success: false, error: 'client_id et lignes obligatoires.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const { total_ht, total_tva, total_ttc } = calculLignes(lignes)
  const numero = await nextNumero(c.env.DB, boutiqueId, 'devis')

  const result = await c.env.DB.prepare(`
    INSERT INTO devis (boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc, notes, conditions, date_validite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(boutiqueId, numero, client_id, ticket_id ?? null, total_ht, total_tva, total_ttc, notes ?? null, conds ?? null, date_validite ?? null)
    .first<{ id: number }>()

  // Insérer les lignes
  for (let i = 0; i < lignes.length; i++) {
    const l   = lignes[i]
    const ht  = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100
    const tva = Math.round(ht * (l.tva_taux / 100) * 100) / 100
    await c.env.DB.prepare(`
      INSERT INTO lignes_document (document_type, document_id, ordre, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
      VALUES ('devis', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(result?.id, i + 1, l.description, l.quantite, l.prix_unitaire_ht, l.tva_taux ?? 20, ht, tva, ht + tva, l.produit_id ?? null).run()
  }

  return c.json({ success: true, id: result?.id, numero, message: 'Devis créé.' }, 201)
})

// ── PUT /api/devis/:id/convertir — Devis → Facture ────────────────────────────
facturation.put('/devis/:id/convertir', async (c) => {
  const user    = c.get('user')
  const devisId = parseInt(c.req.param('id'), 10)

  const devis = await c.env.DB.prepare('SELECT * FROM devis WHERE id = ? AND statut != "refuse" AND facture_id IS NULL')
    .bind(devisId).first<any>()
  if (!devis) return c.json({ success: false, error: 'Devis introuvable ou déjà converti.' }, 404)

  const numero = await nextNumero(c.env.DB, devis.boutique_id, 'facture')

  const facture = await c.env.DB.prepare(`
    INSERT INTO factures (boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva, total_ttc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(devis.boutique_id, numero, devis.client_id, devis.ticket_id, devisId,
          devis.total_ht, devis.total_tva, devis.total_ttc).first<{ id: number }>()

  if (!facture?.id) throw new Error('Erreur création facture')

  // Copier les lignes du devis vers la facture
  await c.env.DB.prepare(`
    INSERT INTO lignes_document (document_type, document_id, ordre, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
    SELECT 'facture', ?, ordre, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id
    FROM   lignes_document WHERE document_type = 'devis' AND document_id = ?
  `).bind(facture.id, devisId).run()

  // Marquer le devis comme accepté et lié
  await c.env.DB.prepare('UPDATE devis SET statut = "accepte", facture_id = ? WHERE id = ?').bind(facture.id, devisId).run()

  // ── NF525 : enregistrer la transaction ────────────────────────────────────
  const hashNf525 = await enregistrerTransaction(c.env.DB, {
    boutique_id:      devis.boutique_id,
    type_transaction: 'facture',
    reference_id:     facture.id,
    reference_numero: numero,
    client_id:        devis.client_id,
    montant_ht:       devis.total_ht,
    montant_tva:      devis.total_tva,
    montant_ttc:      devis.total_ttc,
    date_transaction: new Date().toISOString(),
    user_id:          user.sub,
  })

  // Stocker le hash sur la facture
  await c.env.DB.prepare('UPDATE factures SET hash_nf525 = ? WHERE id = ?').bind(hashNf525, facture.id).run()

  await auditLog(c.env.DB, { boutique_id: devis.boutique_id, user_id: user.sub, action: 'CONVERT_DEVIS_FACTURE', entite_type: 'facture', entite_id: facture.id })

  return c.json({ success: true, facture_id: facture.id, facture_numero: numero, hash_nf525: hashNf525, message: 'Devis converti en facture.' })
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

  const facture = await c.env.DB.prepare('SELECT id, total_ttc, montant_paye, boutique_id FROM factures WHERE id = ?')
    .bind(factureId).first<any>()
  if (!facture) return c.json({ success: false, error: 'Facture introuvable.' }, 404)

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

export default facturation
