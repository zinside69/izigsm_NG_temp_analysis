/**
 * routes/rachats.ts — Rachats d'occasion & Livre de police (Code pénal art. 321-7)
 *
 * Conformité légale :
 *  - Identification du vendeur obligatoire (nom, prénom, adresse, pièce d'identité)
 *  - Registre séquentiel LP-AAAA-XXXXX inaltérable
 *  - Conservation 10 ans minimum
 *  - Signalement possible si suspicion de recel
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { parsePagination, nextNumero, auditLog } from '../lib/db'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const rachats = new Hono<{ Bindings: Bindings; Variables: Variables }>()
rachats.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// LISTE RACHATS (Livre de police)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/rachats ──────────────────────────────────────────────────────────
rachats.get('/rachats', async (c) => {
  const user   = c.get('user')
  const query  = c.req.query()
  const { limit, offset, page } = parsePagination(query)
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const conditions = ['r.boutique_id = ?']
  const bindings: any[] = [boutiqueId]

  if (query.statut)  { conditions.push('r.statut = ?');  bindings.push(query.statut) }
  if (query.search)  {
    conditions.push('(r.vendeur_nom LIKE ? OR r.vendeur_prenom LIKE ? OR r.imei LIKE ? OR r.numero LIKE ? OR r.marque LIKE ? OR r.modele LIKE ?)')
    const s = `%${query.search}%`
    bindings.push(s, s, s, s, s, s)
  }
  if (query.date_debut) { conditions.push('r.date_rachat >= ?'); bindings.push(query.date_debut) }
  if (query.date_fin)   { conditions.push('r.date_rachat <= ?'); bindings.push(query.date_fin + ' 23:59:59') }

  const where = 'WHERE ' + conditions.join(' AND ')

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM rachats r ${where}`)
    .bind(...bindings).first<{ cnt: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT r.id, r.numero, r.date_rachat, r.statut,
           r.vendeur_nom, r.vendeur_prenom,
           r.marque, r.modele, r.imei, r.etat,
           r.prix_rachat, r.mode_paiement,
           u.prenom || ' ' || u.nom as operateur_nom
    FROM   rachats r
    JOIN   users u ON u.id = r.user_id
    ${where}
    ORDER  BY r.date_rachat DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings, limit, offset).all()

  return c.json({
    success: true,
    data:       rows.results,
    pagination: { page, limit, total: total?.cnt ?? 0, pages: Math.ceil((total?.cnt ?? 0) / limit) },
  })
})

// ── GET /api/rachats/:id ──────────────────────────────────────────────────────
rachats.get('/rachats/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)

  const rachat = await c.env.DB.prepare(`
    SELECT r.*,
           u.prenom || ' ' || u.nom as operateur_nom,
           u.email as operateur_email,
           b.nom as boutique_nom, b.siret, b.adresse as boutique_adresse,
           b.code_postal as boutique_cp, b.ville as boutique_ville
    FROM   rachats r
    JOIN   users     u ON u.id = r.user_id
    JOIN   boutiques b ON b.id = r.boutique_id
    WHERE  r.id = ?
  `).bind(id).first()
  if (!rachat) return c.json({ success: false, error: 'Rachat introuvable.' }, 404)

  return c.json({ success: true, data: rachat })
})

// ══════════════════════════════════════════════════════════════════════════════
// CRÉATION RACHAT (entrée livre de police)
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/rachats ─────────────────────────────────────────────────────────
rachats.post('/rachats', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const {
    // Vendeur — obligatoire
    vendeur_nom, vendeur_prenom, vendeur_piece, vendeur_piece_num,
    // Vendeur — recommandé
    vendeur_naissance, vendeur_adresse, vendeur_cp, vendeur_ville, vendeur_telephone,
    // Appareil — obligatoire
    marque, modele, etat = 'bon',
    // Appareil — optionnel
    imei, imei2, couleur, capacite, accessoires, observations,
    // Prix
    prix_rachat, mode_paiement = 'especes', reference_paiement,
    // Boutique
    boutique_id: bodyBoutiqueId,
  } = body

  // ── Validations légales (art. 321-7) ─────────────────────────────────────
  if (!vendeur_nom?.trim())       return c.json({ success: false, error: 'Nom du vendeur obligatoire (art. 321-7).' }, 400)
  if (!vendeur_prenom?.trim())    return c.json({ success: false, error: 'Prénom du vendeur obligatoire (art. 321-7).' }, 400)
  if (!vendeur_piece?.trim())     return c.json({ success: false, error: 'Type de pièce d\'identité obligatoire (art. 321-7).' }, 400)
  if (!vendeur_piece_num?.trim()) return c.json({ success: false, error: 'Numéro de pièce d\'identité obligatoire (art. 321-7).' }, 400)
  if (!marque?.trim())            return c.json({ success: false, error: 'Marque de l\'appareil obligatoire.' }, 400)
  if (!modele?.trim())            return c.json({ success: false, error: 'Modèle de l\'appareil obligatoire.' }, 400)
  if (prix_rachat === undefined || prix_rachat < 0)
    return c.json({ success: false, error: 'Prix de rachat obligatoire (≥ 0).' }, 400)

  const piecesValides = ['CNI', 'PASSEPORT', 'SEJOUR', 'PERMIS']
  if (!piecesValides.includes(vendeur_piece.toUpperCase()))
    return c.json({ success: false, error: `Type de pièce invalide. Valeurs : ${piecesValides.join(', ')}.` }, 400)

  const etatsValides = ['neuf', 'bon', 'correct', 'mauvais', 'hs']
  if (!etatsValides.includes(etat))
    return c.json({ success: false, error: `État invalide. Valeurs : ${etatsValides.join(', ')}.` }, 400)

  const modesValides = ['especes', 'virement', 'cheque']
  if (!modesValides.includes(mode_paiement))
    return c.json({ success: false, error: `Mode de paiement invalide. Valeurs : ${modesValides.join(', ')}.` }, 400)

  const boutiqueId = getBoutiqueId(user, bodyBoutiqueId?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  // ── Vérification IMEI dans le livre de police (doublon actif) ─────────────
  if (imei?.trim()) {
    const existant = await c.env.DB.prepare(`
      SELECT id, numero FROM rachats
      WHERE imei = ? AND boutique_id = ? AND statut NOT IN ('retourne','litige')
    `).bind(imei.trim(), boutiqueId).first<{ id: number; numero: string }>()
    if (existant) {
      return c.json({
        success: false,
        error: `Cet IMEI est déjà enregistré dans le livre de police (${existant.numero}). Vérifiez l'appareil.`,
        doublon_id: existant.id,
      }, 409)
    }
  }

  // ── Numéro séquentiel LP-AAAA-XXXXX ──────────────────────────────────────
  const numero = await nextNumero(c.env.DB, boutiqueId, 'rachat')

  // ── Insertion ─────────────────────────────────────────────────────────────
  const result = await c.env.DB.prepare(`
    INSERT INTO rachats (
      boutique_id, numero,
      vendeur_nom, vendeur_prenom, vendeur_naissance, vendeur_adresse, vendeur_cp, vendeur_ville,
      vendeur_piece, vendeur_piece_num, vendeur_telephone,
      marque, modele, imei, imei2, couleur, capacite, etat, accessoires, observations,
      prix_rachat, mode_paiement, reference_paiement,
      user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId, numero,
    vendeur_nom.trim(), vendeur_prenom.trim(),
    vendeur_naissance  ?? null,
    vendeur_adresse    ?? null, vendeur_cp ?? null, vendeur_ville ?? null,
    vendeur_piece.toUpperCase(), vendeur_piece_num.trim(),
    vendeur_telephone  ?? null,
    marque.trim(), modele.trim(),
    imei?.trim()  ?? null, imei2?.trim() ?? null,
    couleur       ?? null, capacite ?? null,
    etat, accessoires ?? null, observations ?? null,
    parseFloat(prix_rachat), mode_paiement,
    reference_paiement ?? null,
    user.sub,
  ).first<{ id: number }>()

  if (!result?.id) throw new Error('Erreur insertion rachat')

  await auditLog(c.env.DB, {
    boutique_id: boutiqueId, user_id: user.sub,
    action: 'CREATE_RACHAT', entite_type: 'rachat', entite_id: result.id,
    apres: { numero, marque, modele, imei, prix_rachat, vendeur_nom, vendeur_prenom },
  })

  return c.json({
    success: true,
    id:      result.id,
    numero,
    message: `Rachat enregistré dans le livre de police : ${numero}`,
  }, 201)
})

// ══════════════════════════════════════════════════════════════════════════════
// MISE À JOUR STATUT (vendu, retourné, litige)
// ══════════════════════════════════════════════════════════════════════════════

// ── PATCH /api/rachats/:id/statut ─────────────────────────────────────────────
rachats.patch('/rachats/:id/statut', requireRole('admin', 'manager'), async (c) => {
  const user     = c.get('user')
  const id       = parseInt(c.req.param('id'), 10)
  const { statut, produit_id } = await c.req.json()

  const statutsValides = ['en_stock', 'vendu', 'retourne', 'litige']
  if (!statut || !statutsValides.includes(statut))
    return c.json({ success: false, error: `statut invalide. Valeurs : ${statutsValides.join(', ')}.` }, 400)

  const rachat = await c.env.DB.prepare('SELECT id, boutique_id, numero, statut FROM rachats WHERE id = ?')
    .bind(id).first<any>()
  if (!rachat) return c.json({ success: false, error: 'Rachat introuvable.' }, 404)

  await c.env.DB.prepare(`
    UPDATE rachats SET statut = ?, produit_id = COALESCE(?, produit_id), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(statut, produit_id ?? null, id).run()

  await auditLog(c.env.DB, {
    boutique_id: rachat.boutique_id, user_id: user.sub,
    action: 'UPDATE_RACHAT_STATUT', entite_type: 'rachat', entite_id: id,
    avant: { statut: rachat.statut },
    apres: { statut },
  })

  return c.json({ success: true, message: `Statut mis à jour : ${statut}` })
})

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT LIVRE DE POLICE (format texte/CSV pour impression réglementaire)
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/rachats/export ───────────────────────────────────────────────────
rachats.get('/rachats/export', requireRole('admin', 'manager'), async (c) => {
  const user   = c.get('user')
  const query  = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const conditions = ['r.boutique_id = ?']
  const bindings: any[] = [boutiqueId]
  if (query.date_debut) { conditions.push('r.date_rachat >= ?'); bindings.push(query.date_debut) }
  if (query.date_fin)   { conditions.push('r.date_rachat <= ?'); bindings.push(query.date_fin + ' 23:59:59') }
  const where = 'WHERE ' + conditions.join(' AND ')

  const rows = await c.env.DB.prepare(`
    SELECT r.numero, r.date_rachat,
           r.vendeur_nom, r.vendeur_prenom, r.vendeur_naissance,
           r.vendeur_adresse, r.vendeur_cp, r.vendeur_ville,
           r.vendeur_piece, r.vendeur_piece_num,
           r.marque, r.modele, r.imei, r.couleur, r.capacite, r.etat,
           r.prix_rachat, r.mode_paiement,
           r.statut,
           u.prenom || ' ' || u.nom as operateur
    FROM   rachats r
    JOIN   users u ON u.id = r.user_id
    ${where}
    ORDER  BY r.date_rachat ASC
  `).bind(...bindings).all()

  // Format CSV conforme registre police
  const headers = [
    'N° LP', 'Date', 'Vendeur Nom', 'Vendeur Prénom', 'Date Naissance',
    'Adresse', 'CP', 'Ville', 'Pièce', 'N° Pièce',
    'Marque', 'Modèle', 'IMEI', 'Couleur', 'Capacité', 'État',
    'Prix Rachat', 'Mode Paiement', 'Statut', 'Opérateur',
  ]

  const csvLines = [
    headers.join(';'),
    ...rows.results.map((r: any) => [
      r.numero, r.date_rachat,
      r.vendeur_nom, r.vendeur_prenom, r.vendeur_naissance ?? '',
      r.vendeur_adresse ?? '', r.vendeur_cp ?? '', r.vendeur_ville ?? '',
      r.vendeur_piece, r.vendeur_piece_num,
      r.marque, r.modele, r.imei ?? '',
      r.couleur ?? '', r.capacite ?? '', r.etat,
      r.prix_rachat, r.mode_paiement, r.statut, r.operateur,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
  ]

  return new Response(csvLines.join('\n'), {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="livre-police-${boutiqueId}-${new Date().toISOString().slice(0, 10)}.csv"`,
    }
  })
})

export default rachats
