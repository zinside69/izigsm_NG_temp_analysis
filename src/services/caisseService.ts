/**
 * @module caisseService
 * @description Model P1 : Caisse POS + Journal fiscal NF525.
 *
 * Rôle architectural (P1 MVC) : Model exclusif — tout le SQL est ici.
 * Les routes `src/routes/caisse.ts` délèguent sans aucun `.prepare()`.
 *
 * Architecture NF525 (Loi anti-fraude TVA, art. 88 LFR 2015) :
 *  - Chaque transaction est insérée dans `journal_nf525` avec un hash SHA-256 chaîné.
 *  - Formule : `hash_courant = SHA-256(type|reference_numero|montant_centimes|date|hash_precedent)`
 *  - Le montant est stocké en centimes (entier) pour éviter les erreurs de virgule flottante.
 *  - La clôture journalière enchaîne les hash de toutes les transactions du jour
 *    avec le hash de la clôture précédente (chaînage inter-journées).
 *  - L'intégrité de la chaîne est vérifiable via `verifierIntegriteChaine()`.
 *
 * Types de transactions POS :
 *  - `'vente'`        → vente directe en caisse (crée facture + lignes + paiement)
 *  - `'encaissement'` → règlement d'une facture existante via caisse
 *  - `'remboursement'`→ remboursement lié à un avoir
 *
 * Tables concernées : `journal_nf525`, `clotures_journalieres`, `factures`,
 *   `lignes_document`, `paiements`, `mouvements_stock`.
 *
 * Sprint 2.12 — MOD-12 Caisse POS
 */

import { nextNumero, calculLignes } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Une ligne d'article pour une vente POS (produit ou service). */
export interface LignePOS {
  produit_id?:     number
  service_id?:     number
  designation:     string
  quantite:        number
  prix_unitaire_ht: number
  tva_taux:        number
  remise_pct?:     number  // remise en % sur la ligne
}

/** Données d'entrée pour enregistrer une vente en caisse. */
export interface VentePOSData {
  client_id?:     number
  lignes:         LignePOS[]
  mode_paiement:  'especes' | 'cb' | 'virement' | 'cheque' | 'mixte'
  montant_especes?: number  // pour calcul rendu monnaie
  montant_cb?:      number
  montant_cheque?:  number
  note?:           string
}

/** Entrée du journal fiscal NF525 (une ligne par transaction). */
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

/** Résumé d'une clôture journalière NF525. */
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
 * Retourne la représentation hexadécimale lowercase (64 caractères).
 *
 * IMPORTANT : Utilise Web Crypto API — compatible Cloudflare Workers / navigateur.
 * Pas de `require('crypto')` Node.js ici.
 *
 * @param input  Chaîne canonique à hasher
 * @returns      Hash SHA-256 en hex (ex: "a3f9b2c1...")
 */
async function sha256(input: string): Promise<string> {
  const encoder  = new TextEncoder()
  const data     = encoder.encode(input)
  const hashBuf  = await crypto.subtle.digest('SHA-256', data)
  const hashArr  = Array.from(new Uint8Array(hashBuf))
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Construit la chaîne canonique à hasher pour une transaction NF525.
 *
 * FORMAT FIGÉ — ne jamais modifier l'ordre ou le séparateur !
 * Toute modification rompt la chaîne de hash de toutes les transactions existantes.
 *
 * Format : `type_transaction|reference_numero|montant_centimes|date_iso|hash_precedent`
 * Le montant est en centimes entiers (×100, arrondi) pour éviter les flottants.
 *
 * @param type             Type de transaction ('vente', 'encaissement', etc.)
 * @param referenceNumero  Numéro de la facture / avoir référencé
 * @param montantTtc       Montant TTC en euros (converti en centimes pour le hash)
 * @param date             Date ISO de la transaction
 * @param hashPrecedent    Hash SHA-256 de la transaction précédente (ou "000..." si genèse)
 * @returns                Chaîne canonique prête à passer dans sha256()
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
 * Retourne une chaîne de 64 zéros si aucune transaction n'existe (hash genèse).
 *
 * Ce hash est le `hash_precedent` de la prochaine transaction à insérer.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Hash hex de 64 caractères ("000..." pour la première transaction)
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
 * Récupère le hash de la dernière clôture journalière.
 * Utilisé pour chaîner les clôtures inter-journées (hash_precedent de la clôture).
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Hash hex 64 caractères ("000..." si aucune clôture précédente)
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
 *
 * Séquence d'opérations (non transactionnelle — D1 ne supporte pas les transactions multi-requêtes) :
 *  1. Calcul des totaux HT/TVA/TTC ligne par ligne avec remises
 *  2. Résolution du client (création d'un client sentinelle "Comptoir" si absent)
 *  3. Génération du numéro de facture via `nextNumero()`
 *  4. Insertion de la facture (statut `payee` immédiatement)
 *  5. Insertion des lignes + décrémentation du stock produit + mouvement de stock
 *  6. Insertion du paiement
 *  7. Calcul du rendu monnaie si paiement en espèces
 *  8. Insertion dans `journal_nf525` avec hash SHA-256 chaîné
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param userId      Identifiant du caissier (tracé dans journal + mouvements)
 * @param data        Données de la vente : lignes, mode paiement, client optionnel
 * @returns           `{ facture, journal, rendu_monnaie? }`
 * @throws            Error si aucune ligne, si création facture/journal échoue
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
 * Enregistre un encaissement sur une facture existante (créée hors caisse).
 * Marque la facture comme `payee`, crée le paiement et trace dans le journal NF525.
 *
 * Cas d'usage : une facture devis/SAV est réglée physiquement au comptoir.
 *
 * @param db            Binding D1 Cloudflare
 * @param boutiqueId    Identifiant de la boutique
 * @param userId        Identifiant du caissier
 * @param factureId     Identifiant de la facture à encaisser
 * @param modePaiement  Mode de règlement ('especes', 'cb', 'virement', 'cheque')
 * @returns             Entrée journal NF525 créée
 * @throws              Error si facture introuvable ou déjà payée
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
 * Retourne le journal de caisse pour une date donnée (défaut : aujourd'hui).
 * Exécute 2 requêtes en parallèle : transactions du jour + clôture éventuelle.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param date        Date ciblée au format "YYYY-MM-DD" (défaut : aujourd'hui)
 * @returns           `{ date, transactions, totaux, est_cloture, cloture? }`
 *                    - `totaux` : agrégat HT/TVA/TTC + nb transactions du jour
 *                    - `est_cloture` : true si une clôture existe pour cette date
 *                    - `cloture` : détail de la clôture si existante
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
 * Effectue la clôture journalière NF525 (opération irréversible).
 *
 * Algorithme :
 *  1. Vérifie l'absence de clôture existante pour cette date (idempotence)
 *  2. Récupère toutes les transactions non-clôturées du jour
 *  3. Calcule les totaux HT/TVA/TTC
 *  4. Construit le hash de clôture :
 *     `SHA-256("cloture|date|nb_tx|montant_centimes|hash_tx1|hash_tx2|...|hash_clot_precedente")`
 *  5. Marque les transactions comme `est_cloture = 1`
 *  6. Insère dans `clotures_journalieres`
 *
 * IMPORTANT : Conforme NF525 (CGI art. 289) — opération irréversible.
 * Une clôture ne peut pas être annulée ni modifiée.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param userId      Identifiant de l'utilisateur effectuant la clôture
 * @param date        Date à clôturer "YYYY-MM-DD" (défaut : aujourd'hui)
 * @returns           Résumé de la clôture (`ClotureSummary`)
 * @throws            Error si journée déjà clôturée ou aucune transaction à clôturer
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
 *
 * Pour chaque transaction, recalcule le hash attendu et le compare au hash stocké.
 * Toute divergence indique une modification frauduleuse d'une transaction passée.
 *
 * Cette vérification peut être effectuée par l'administration fiscale ou l'exploitant.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param dateDebut   (optionnel) Début de plage "YYYY-MM-DD" — défaut : toutes
 * @param dateFin     (optionnel) Fin de plage "YYYY-MM-DD"
 * @returns           `{ integre: boolean, anomalies: Array<{ id, reference_numero, details }> }`
 *                    — `anomalies` est vide si la chaîne est intègre
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
 * Retourne les KPIs caisse pour le tableau de bord.
 * Exécute 4 requêtes en parallèle (aujourd'hui, mois, clôtures, dernière clôture).
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           `{ today: { nb_transactions, total_ttc, total_ht, est_cloture }, mois, derniere_cloture?, nb_clotures_mois }`
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

/**
 * Retourne l'historique des clôtures journalières NF525.
 * Inclut le nom du caissier ayant effectué chaque clôture.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param limit       Nombre maximum de clôtures retournées (défaut : 30)
 * @returns           Liste de `ClotureSummary` enrichis du nom caissier, ordre anti-chronologique
 */
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
