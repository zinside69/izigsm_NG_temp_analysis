/**
 * caisseService.ts — Model Caisse POS + Journal NF525 (Sprint 2.12)
 *
 * Architecture NF525 :
 *  - Chaque transaction est insérée dans journal_nf525 avec un hash chaîné SHA-256
 *  - hash_courant = SHA-256(type | reference_numero | montant_ttc | date | hash_precedent)
 *  - La clôture journalière calcule un hash_cloture sur toutes les transactions du jour
 *  - Les tables journal_nf525 et clotures_journalieres existent depuis migration 0008
 *
 * Types de transactions POS :
 *  - 'vente'    → vente directe en caisse (crée facture + lignes_document)
 *  - 'remboursement' → remboursement (lié à un avoir)
 *  - 'encaissement'  → encaissement sur facture existante
 */

import { nextNumero, calculLignes } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LignePOS {
  produit_id?:     number
  service_id?:     number
  designation:     string
  quantite:        number
  prix_unitaire_ht: number
  tva_taux:        number
  remise_pct?:     number  // remise en % sur la ligne
}

export interface VentePOSData {
  client_id?:     number
  lignes:         LignePOS[]
  mode_paiement:  'especes' | 'cb' | 'virement' | 'cheque' | 'mixte'
  montant_especes?: number  // pour calcul rendu monnaie
  montant_cb?:      number
  montant_cheque?:  number
  note?:           string
}

export interface JournalEntry {
  id:                number
  boutique_id:       number
  type_transaction:  string
  reference_id:      number
  reference_numero:  string
  client_id:         number | null
  montant_ht:        number
  montant_tva:       number
  montant_ttc:       number
  date_transaction:  string
  hash_precedent:    string
  donnees_hash:      string
  hash_courant:      string
  est_cloture:       number
  periode_cloture:   string | null
  user_id:           number
  created_at:        string
}

export interface ClotureSummary {
  id:               number
  boutique_id:      number
  date_cloture:     string
  nb_transactions:  number
  total_ht:         number
  total_tva:        number
  total_ttc:        number
  hash_cloture:     string
  hash_precedent:   string
  user_id:          number
  created_at:       string
}

// ─── Hash NF525 (Web Crypto — compatible Cloudflare Workers) ──────────────────

/**
 * Calcule un SHA-256 sur la chaîne fournie.
 * Retourne la représentation hexadécimale lowercase.
 * Utilise l'API Web Crypto (disponible dans Workers, navigateur, Node 18+).
 */
async function sha256(input: string): Promise<string> {
  const encoder  = new TextEncoder()
  const data     = encoder.encode(input)
  const hashBuf  = await crypto.subtle.digest('SHA-256', data)
  const hashArr  = Array.from(new Uint8Array(hashBuf))
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Construit la chaîne à hasher pour une transaction NF525.
 * Format : type_transaction|reference_numero|montant_ttc_centimes|date_iso|hash_precedent
 */
function buildDonneesHash(
  type:             string,
  referenceNumero:  string,
  montantTtc:       number,
  date:             string,
  hashPrecedent:    string
): string {
  const montantCentimes = Math.round(montantTtc * 100)
  return `${type}|${referenceNumero}|${montantCentimes}|${date}|${hashPrecedent}`
}

// ─── Helpers DB ───────────────────────────────────────────────────────────────

/**
 * Récupère le hash de la dernière transaction NF525 enregistrée pour la boutique.
 * Retourne '0' si aucune transaction n'existe (hash genèse).
 */
export async function getHashPrecedent(
  db:         D1Database,
  boutiqueId: number
): Promise<string> {
  const row = await db.prepare(`
    SELECT hash_courant FROM journal_nf525
    WHERE  boutique_id = ?
    ORDER  BY id DESC
    LIMIT  1
  `).bind(boutiqueId).first<{ hash_courant: string }>()

  return row?.hash_courant ?? '0000000000000000000000000000000000000000000000000000000000000000'
}

/**
 * Récupère le hash de la dernière clôture journalière (pour chaînage des clôtures).
 */
async function getHashPrecedentCloture(
  db:         D1Database,
  boutiqueId: number
): Promise<string> {
  const row = await db.prepare(`
    SELECT hash_cloture FROM clotures_journalieres
    WHERE  boutique_id = ?
    ORDER  BY id DESC
    LIMIT  1
  `).bind(boutiqueId).first<{ hash_cloture: string }>()

  return row?.hash_cloture ?? '0000000000000000000000000000000000000000000000000000000000000000'
}

// ─── Vente POS ────────────────────────────────────────────────────────────────

/**
 * Enregistre une vente directe en caisse POS.
 * Crée :
 *  1. Une facture avec ses lignes_document
 *  2. Un paiement associé
 *  3. Une entrée dans journal_nf525 avec hash chaîné
 *
 * Retourne la facture créée + l'entrée journal.
 */
export async function createVente(
  db:         D1Database,
  boutiqueId: number,
  userId:     number,
  data:       VentePOSData
): Promise<{
  facture:      any
  journal:      JournalEntry
  rendu_monnaie?: number
}> {
  if (!data.lignes || data.lignes.length === 0) {
    throw new Error('La vente doit contenir au moins une ligne.')
  }

  // ── 1. Calcul totaux ──────────────────────────────────────────────────────
  // Appliquer remises ligne par ligne
  const lignesCalculees = data.lignes.map(l => ({
    quantite:          l.quantite,
    prix_unitaire_ht:  l.prix_unitaire_ht * (1 - (l.remise_pct ?? 0) / 100),
    tva_taux:          l.tva_taux,
  }))
  const totaux = calculLignes(lignesCalculees)

  // ── 1b. Client par défaut si non fourni (vente comptoir anonyme) ─────────
  let clientId = data.client_id ?? null
  if (!clientId) {
    // Chercher ou créer un client sentinelle "Comptoir" pour les ventes anonymes
    const comptoir = await db.prepare(`
      SELECT id FROM clients WHERE boutique_id = ? AND email = 'comptoir@pos.local' LIMIT 1
    `).bind(boutiqueId).first<{ id: number }>()
    if (comptoir) {
      clientId = comptoir.id
    } else {
      const newComptoir = await db.prepare(`
        INSERT INTO clients (boutique_id, prenom, nom, email, telephone)
        VALUES (?, 'Client', 'Comptoir', 'comptoir@pos.local', '0000000000')
        RETURNING id
      `).bind(boutiqueId).first<{ id: number }>()
      clientId = newComptoir?.id ?? null
    }
  }

  // ── 2. Numéro de facture ──────────────────────────────────────────────────
  const numero = await nextNumero(db, boutiqueId, 'facture')
  const dateEmission = new Date().toISOString()

  // ── 3. Créer la facture ───────────────────────────────────────────────────
  const facture = await db.prepare(`
    INSERT INTO factures
      (boutique_id, client_id, numero, date_emission, date_echeance,
       total_ht, total_tva, total_ttc, statut, notes)
    VALUES (?, ?, ?, ?, date('now', '+30 days'), ?, ?, ?, 'payee', ?)
    RETURNING *
  `).bind(
    boutiqueId,
    clientId,
    numero,
    dateEmission,
    totaux.total_ht,
    totaux.total_tva,
    totaux.total_ttc,
    data.note       ?? null
  ).first<any>()

  if (!facture) throw new Error('Échec création facture POS.')

  // ── 4. Créer les lignes de facture ────────────────────────────────────────
  for (const l of data.lignes) {
    const prixApresRemise = l.prix_unitaire_ht * (1 - (l.remise_pct ?? 0) / 100)
    const ligneHt  = Math.round(l.quantite * prixApresRemise * 100) / 100
    const ligneTva = Math.round(ligneHt * (l.tva_taux / 100) * 100) / 100

    await db.prepare(`
      INSERT INTO lignes_document
        (document_type, document_id, produit_id, description,
         quantite, prix_unitaire_ht, tva_taux,
         total_ht, total_tva, total_ttc)
      VALUES ('facture', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      facture.id,
      l.produit_id  ?? null,
      l.designation,
      l.quantite,
      l.prix_unitaire_ht,
      l.tva_taux,
      ligneHt,
      ligneTva,
      Math.round((ligneHt + ligneTva) * 100) / 100
    ).run()

    // Décrémenter stock si produit
    if (l.produit_id) {
      await db.prepare(`
        UPDATE produits
        SET stock_actuel = MAX(0, stock_actuel - ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND boutique_id = ?
      `).bind(l.quantite, l.produit_id, boutiqueId).run()

      // Mouvement de stock
      await db.prepare(`
        INSERT INTO mouvements_stock
          (boutique_id, produit_id, type_mouvement, quantite, raison, reference_id, user_id)
        VALUES (?, ?, 'sortie', ?, 'Vente POS', ?, ?)
      `).bind(boutiqueId, l.produit_id, l.quantite, facture.id, userId).run()
    }
  }

  // ── 5. Créer le paiement ──────────────────────────────────────────────────
  const modePaiementPrincipal = data.mode_paiement === 'mixte' ? 'mixte' : data.mode_paiement

  await db.prepare(`
    INSERT INTO paiements
      (facture_id, boutique_id, montant, mode_paiement, date_paiement, user_id)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `).bind(
    facture.id,
    boutiqueId,
    totaux.total_ttc,
    modePaiementPrincipal,
    userId
  ).run()

  // ── 6. Calcul rendu monnaie (si espèces) ──────────────────────────────────
  let renduMonnaie: number | undefined
  if (data.montant_especes && data.montant_especes > 0) {
    const montantEspeces = data.montant_especes
    const autresPaiements = (data.montant_cb ?? 0) + (data.montant_cheque ?? 0)
    const resteEnEspeces = totaux.total_ttc - autresPaiements
    if (montantEspeces > resteEnEspeces) {
      renduMonnaie = Math.round((montantEspeces - resteEnEspeces) * 100) / 100
    }
  }

  // ── 7. Entrée Journal NF525 avec hash chaîné ──────────────────────────────
  const hashPrecedent  = await getHashPrecedent(db, boutiqueId)
  const dateTransaction = dateEmission
  const donneesHash    = buildDonneesHash('vente', numero, totaux.total_ttc, dateTransaction, hashPrecedent)
  const hashCourant    = await sha256(donneesHash)

  const journal = await db.prepare(`
    INSERT INTO journal_nf525
      (boutique_id, type_transaction, reference_id, reference_numero,
       client_id, montant_ht, montant_tva, montant_ttc,
       date_transaction, hash_precedent, donnees_hash, hash_courant,
       est_cloture, user_id)
    VALUES (?, 'vente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    RETURNING *
  `).bind(
    boutiqueId,
    facture.id,
    numero,
    data.client_id ?? null,
    totaux.total_ht,
    totaux.total_tva,
    totaux.total_ttc,
    dateTransaction,
    hashPrecedent,
    donneesHash,
    hashCourant,
    userId
  ).first<JournalEntry>()

  if (!journal) throw new Error('Échec enregistrement journal NF525.')

  return { facture, journal, rendu_monnaie: renduMonnaie }
}

// ─── Encaissement sur facture existante ──────────────────────────────────────

/**
 * Enregistre un encaissement sur une facture déjà existante dans le journal NF525.
 * Utilisé quand une facture créée ailleurs est réglée en caisse.
 */
export async function enregistrerEncaissement(
  db:           D1Database,
  boutiqueId:   number,
  userId:       number,
  factureId:    number,
  modePaiement: string
): Promise<JournalEntry> {
  const facture = await db.prepare(`
    SELECT * FROM factures WHERE id = ? AND boutique_id = ? LIMIT 1
  `).bind(factureId, boutiqueId).first<any>()

  if (!facture) throw new Error('Facture introuvable.')
  if (facture.statut === 'payee') throw new Error('Facture déjà payée.')

  // Marquer la facture comme payée
  await db.prepare(`
    UPDATE factures SET statut = 'payee', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(factureId).run()

  // Créer le paiement
  await db.prepare(`
    INSERT INTO paiements
      (facture_id, boutique_id, montant, mode_paiement, date_paiement, user_id)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `).bind(factureId, boutiqueId, facture.total_ttc, modePaiement, userId).run()

  // Entrée Journal NF525
  const hashPrecedent   = await getHashPrecedent(db, boutiqueId)
  const dateTransaction = new Date().toISOString()
  const donneesHash     = buildDonneesHash('encaissement', facture.numero, facture.total_ttc, dateTransaction, hashPrecedent)
  const hashCourant     = await sha256(donneesHash)

  const journal = await db.prepare(`
    INSERT INTO journal_nf525
      (boutique_id, type_transaction, reference_id, reference_numero,
       client_id, montant_ht, montant_tva, montant_ttc,
       date_transaction, hash_precedent, donnees_hash, hash_courant,
       est_cloture, user_id)
    VALUES (?, 'encaissement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    RETURNING *
  `).bind(
    boutiqueId,
    factureId,
    facture.numero,
    facture.client_id   ?? null,
    facture.total_ht,
    facture.total_tva,
    facture.total_ttc,
    dateTransaction,
    hashPrecedent,
    donneesHash,
    hashCourant,
    userId
  ).first<JournalEntry>()

  if (!journal) throw new Error('Échec enregistrement journal NF525.')
  return journal
}

// ─── Journal du jour ──────────────────────────────────────────────────────────

/**
 * Retourne toutes les transactions NF525 pour une date donnée (défaut : aujourd'hui).
 * Inclut les totaux du jour.
 */
export async function getCaisseJournal(
  db:         D1Database,
  boutiqueId: number,
  date?:      string  // format YYYY-MM-DD — défaut : today
): Promise<{
  date:         string
  transactions: JournalEntry[]
  totaux: {
    nb_transactions: number
    total_ht:        number
    total_tva:       number
    total_ttc:       number
  }
  est_cloture:  boolean
  cloture?:     ClotureSummary
}> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10)

  const [rows, cloture] = await Promise.all([
    db.prepare(`
      SELECT j.*, u.prenom || ' ' || u.nom AS caissier_nom
      FROM   journal_nf525 j
      LEFT   JOIN users u ON u.id = j.user_id
      WHERE  j.boutique_id = ?
        AND  DATE(j.date_transaction) = ?
      ORDER  BY j.id ASC
    `).bind(boutiqueId, targetDate).all<any>(),

    db.prepare(`
      SELECT * FROM clotures_journalieres
      WHERE  boutique_id = ? AND date_cloture = ?
      LIMIT  1
    `).bind(boutiqueId, targetDate).first<ClotureSummary>(),
  ])

  const transactions = rows.results ?? []
  const totaux = transactions.reduce(
    (acc, t) => ({
      nb_transactions: acc.nb_transactions + 1,
      total_ht:        Math.round((acc.total_ht  + t.montant_ht)  * 100) / 100,
      total_tva:       Math.round((acc.total_tva + t.montant_tva) * 100) / 100,
      total_ttc:       Math.round((acc.total_ttc + t.montant_ttc) * 100) / 100,
    }),
    { nb_transactions: 0, total_ht: 0, total_tva: 0, total_ttc: 0 }
  )

  return {
    date:         targetDate,
    transactions,
    totaux,
    est_cloture:  !!cloture,
    cloture:      cloture ?? undefined,
  }
}

// ─── Clôture journalière NF525 ────────────────────────────────────────────────

/**
 * Effectue la clôture journalière NF525.
 * - Vérifie qu'il n'y a pas déjà une clôture pour cette date
 * - Calcule un hash de clôture sur l'ensemble des transactions du jour
 * - Marque toutes les transactions du jour comme clôturées
 * - Insère dans clotures_journalieres
 *
 * IMPORTANT : Conforme NF525 — la clôture est irréversible.
 */
export async function cloturerJournee(
  db:         D1Database,
  boutiqueId: number,
  userId:     number,
  date?:      string  // défaut : aujourd'hui
): Promise<ClotureSummary> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10)

  // Vérifier qu'une clôture n'existe pas déjà
  const existante = await db.prepare(`
    SELECT id FROM clotures_journalieres
    WHERE boutique_id = ? AND date_cloture = ?
  `).bind(boutiqueId, targetDate).first()

  if (existante) {
    throw new Error(`Journée du ${targetDate} déjà clôturée.`)
  }

  // Récupérer toutes les transactions non clôturées du jour
  const rows = await db.prepare(`
    SELECT * FROM journal_nf525
    WHERE  boutique_id = ?
      AND  DATE(date_transaction) = ?
      AND  est_cloture = 0
    ORDER  BY id ASC
  `).bind(boutiqueId, targetDate).all<JournalEntry>()

  const transactions = rows.results ?? []

  if (transactions.length === 0) {
    throw new Error(`Aucune transaction à clôturer pour le ${targetDate}.`)
  }

  // Calcul totaux
  const totaux = transactions.reduce(
    (acc, t) => ({
      total_ht:  Math.round((acc.total_ht  + t.montant_ht)  * 100) / 100,
      total_tva: Math.round((acc.total_tva + t.montant_tva) * 100) / 100,
      total_ttc: Math.round((acc.total_ttc + t.montant_ttc) * 100) / 100,
    }),
    { total_ht: 0, total_tva: 0, total_ttc: 0 }
  )

  // Hash de clôture : SHA-256 sur la concaténation de tous les hash_courant du jour
  // + hash de la clôture précédente (chaînage inter-journées)
  const hashPrecedentCloture = await getHashPrecedentCloture(db, boutiqueId)
  const tousLesHash = transactions.map(t => t.hash_courant).join('|')
  const donneesHashCloture = `cloture|${targetDate}|${transactions.length}|${Math.round(totaux.total_ttc * 100)}|${tousLesHash}|${hashPrecedentCloture}`
  const hashCloture = await sha256(donneesHashCloture)

  // Marquer les transactions comme clôturées
  await db.prepare(`
    UPDATE journal_nf525
    SET    est_cloture = 1, periode_cloture = ?
    WHERE  boutique_id = ?
      AND  DATE(date_transaction) = ?
      AND  est_cloture = 0
  `).bind(targetDate, boutiqueId, targetDate).run()

  // Insérer la clôture
  const cloture = await db.prepare(`
    INSERT INTO clotures_journalieres
      (boutique_id, date_cloture, nb_transactions,
       total_ht, total_tva, total_ttc,
       hash_cloture, hash_precedent, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    boutiqueId,
    targetDate,
    transactions.length,
    totaux.total_ht,
    totaux.total_tva,
    totaux.total_ttc,
    hashCloture,
    hashPrecedentCloture,
    userId
  ).first<ClotureSummary>()

  if (!cloture) throw new Error('Échec enregistrement clôture NF525.')
  return cloture
}

// ─── Vérification intégrité chaîne NF525 ─────────────────────────────────────

/**
 * Vérifie l'intégrité de la chaîne de hash NF525 sur une plage de dates.
 * Recalcule chaque hash et compare avec la valeur stockée.
 * Retourne les transactions avec anomalie (liste vide = chaîne intègre).
 */
export async function verifierIntegriteChaine(
  db:          D1Database,
  boutiqueId:  number,
  dateDebut?:  string,
  dateFin?:    string
): Promise<{
  integre:     boolean
  anomalies:   Array<{ id: number; reference_numero: string; details: string }>
}> {
  let query = `
    SELECT * FROM journal_nf525
    WHERE boutique_id = ?
  `
  const params: any[] = [boutiqueId]

  if (dateDebut) { query += ' AND DATE(date_transaction) >= ?'; params.push(dateDebut) }
  if (dateFin)   { query += ' AND DATE(date_transaction) <= ?'; params.push(dateFin)   }
  query += ' ORDER BY id ASC'

  const rows = await db.prepare(query).bind(...params).all<JournalEntry>()
  const transactions = rows.results ?? []

  const anomalies: Array<{ id: number; reference_numero: string; details: string }> = []

  for (const t of transactions) {
    const donneesAttendu = buildDonneesHash(
      t.type_transaction,
      t.reference_numero,
      t.montant_ttc,
      t.date_transaction,
      t.hash_precedent
    )
    const hashAttendu = await sha256(donneesAttendu)

    if (hashAttendu !== t.hash_courant) {
      anomalies.push({
        id:               t.id,
        reference_numero: t.reference_numero,
        details:          `Hash attendu: ${hashAttendu.slice(0, 16)}… ≠ stocké: ${t.hash_courant.slice(0, 16)}…`,
      })
    }
  }

  return {
    integre:   anomalies.length === 0,
    anomalies,
  }
}

// ─── KPIs Caisse ──────────────────────────────────────────────────────────────

/**
 * KPIs caisse du jour + période.
 */
export async function getKpisCaisse(
  db:         D1Database,
  boutiqueId: number
): Promise<{
  today: {
    nb_transactions: number
    total_ttc:       number
    total_ht:        number
    est_cloture:     boolean
  }
  mois: {
    nb_transactions: number
    total_ttc:       number
  }
  derniere_cloture?: string
  nb_clotures_mois:  number
}> {
  const today = new Date().toISOString().slice(0, 10)

  const [kpiDay, kpiMois, clotureMois, derniereClot] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) as nb, COALESCE(SUM(montant_ttc),0) as ttc, COALESCE(SUM(montant_ht),0) as ht
      FROM journal_nf525
      WHERE boutique_id = ? AND DATE(date_transaction) = ?
    `).bind(boutiqueId, today).first<{ nb: number; ttc: number; ht: number }>(),

    db.prepare(`
      SELECT COUNT(*) as nb, COALESCE(SUM(montant_ttc),0) as ttc
      FROM journal_nf525
      WHERE boutique_id = ?
        AND strftime('%Y-%m', date_transaction) = strftime('%Y-%m', 'now')
    `).bind(boutiqueId).first<{ nb: number; ttc: number }>(),

    db.prepare(`
      SELECT COUNT(*) as nb FROM clotures_journalieres
      WHERE boutique_id = ?
        AND strftime('%Y-%m', date_cloture) = strftime('%Y-%m', 'now')
    `).bind(boutiqueId).first<{ nb: number }>(),

    db.prepare(`
      SELECT date_cloture FROM clotures_journalieres
      WHERE boutique_id = ? ORDER BY id DESC LIMIT 1
    `).bind(boutiqueId).first<{ date_cloture: string }>(),

    db.prepare(`
      SELECT id FROM clotures_journalieres WHERE boutique_id = ? AND date_cloture = ? LIMIT 1
    `).bind(boutiqueId, today).first(),
  ])

  // Vérifier si today est clôturé (5ème promesse)
  const clotureToday = await db.prepare(`
    SELECT id FROM clotures_journalieres WHERE boutique_id = ? AND date_cloture = ? LIMIT 1
  `).bind(boutiqueId, today).first()

  return {
    today: {
      nb_transactions: kpiDay?.nb       ?? 0,
      total_ttc:       kpiDay?.ttc      ?? 0,
      total_ht:        kpiDay?.ht       ?? 0,
      est_cloture:     !!clotureToday,
    },
    mois: {
      nb_transactions: kpiMois?.nb      ?? 0,
      total_ttc:       kpiMois?.ttc     ?? 0,
    },
    derniere_cloture:  derniereClot?.date_cloture,
    nb_clotures_mois:  clotureMois?.nb  ?? 0,
  }
}

// ─── Historique des clôtures ──────────────────────────────────────────────────

export async function listClotures(
  db:         D1Database,
  boutiqueId: number,
  limit       = 30
): Promise<ClotureSummary[]> {
  const rows = await db.prepare(`
    SELECT cj.*, u.prenom || ' ' || u.nom AS caissier_nom
    FROM   clotures_journalieres cj
    LEFT   JOIN users u ON u.id = cj.user_id
    WHERE  cj.boutique_id = ?
    ORDER  BY cj.id DESC
    LIMIT  ?
  `).bind(boutiqueId, limit).all<any>()

  return rows.results ?? []
}
