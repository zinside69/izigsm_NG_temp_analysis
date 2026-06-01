/**
 * lib/nf525.ts — Conformité NF525 (Loi anti-fraude TVA France)
 *
 * Article 88 de la LFR 2015 — Obligatoire depuis le 01/01/2018
 * Principe : chaque transaction de caisse est hachée (SHA-256) en
 * chaîne avec la précédente → inaltérabilité vérifiable.
 *
 * La fonction verifyChain() permet à l'administration fiscale (ou
 * à l'exploitant) de vérifier qu'aucune facture n'a été modifiée.
 */

export interface Nf525Entry {
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
  user_id:           number
}

export interface Nf525Input {
  boutique_id:      number
  type_transaction: string   // 'facture' | 'avoir' | 'cloture_journee'
  reference_id:     number
  reference_numero: string
  client_id:        number | null
  montant_ht:       number
  montant_tva:      number
  montant_ttc:      number
  date_transaction: string
  user_id:          number
}

// ─── Hash SHA-256 via Web Crypto ──────────────────────────────────────────────

async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── Calcul du hash d'une transaction ────────────────────────────────────────

/**
 * Construit la chaîne canonique des données à hasher.
 * FORMAT FIXE — ne jamais modifier l'ordre des champs !
 * (modification = rupture de toutes les chaînes existantes)
 */
function buildCanonicalData(input: Nf525Input, previousHash: string): string {
  return [
    input.boutique_id,
    input.type_transaction,
    input.reference_numero,
    input.montant_ht.toFixed(2),
    input.montant_tva.toFixed(2),
    input.montant_ttc.toFixed(2),
    input.date_transaction,
    previousHash,
  ].join('|')
}

// ─── Créer une entrée NF525 ───────────────────────────────────────────────────

/**
 * Génère le hash pour une nouvelle transaction et retourne
 * les données prêtes à insérer dans journal_nf525.
 *
 * @param db            Cloudflare D1 binding
 * @param input         Données de la transaction
 * @returns             Objet prêt pour INSERT
 */
export async function createNf525Entry(
  db: D1Database,
  input: Nf525Input
): Promise<Omit<Nf525Entry, 'id'>> {
  // Récupérer le hash de la dernière entrée pour cette boutique
  const lastEntry = await db
    .prepare(`
      SELECT hash_courant
      FROM   journal_nf525
      WHERE  boutique_id = ?
      ORDER  BY id DESC
      LIMIT  1
    `)
    .bind(input.boutique_id)
    .first<{ hash_courant: string }>()

  const previousHash = lastEntry?.hash_courant ?? ''

  // Construire les données canoniques et calculer le hash
  const canonicalData = buildCanonicalData(input, previousHash)
  const hashCourant   = await sha256(canonicalData)

  return {
    boutique_id:       input.boutique_id,
    type_transaction:  input.type_transaction,
    reference_id:      input.reference_id,
    reference_numero:  input.reference_numero,
    client_id:         input.client_id,
    montant_ht:        input.montant_ht,
    montant_tva:       input.montant_tva,
    montant_ttc:       input.montant_ttc,
    date_transaction:  input.date_transaction,
    hash_precedent:    previousHash,
    donnees_hash:      canonicalData,
    hash_courant:      hashCourant,
    user_id:           input.user_id,
  }
}

/**
 * Insère une entrée NF525 en base.
 * À appeler immédiatement après la création d'une facture.
 */
export async function enregistrerTransaction(
  db: D1Database,
  input: Nf525Input
): Promise<string> {
  const entry = await createNf525Entry(db, input)

  await db.prepare(`
    INSERT INTO journal_nf525
      (boutique_id, type_transaction, reference_id, reference_numero,
       client_id, montant_ht, montant_tva, montant_ttc, date_transaction,
       hash_precedent, donnees_hash, hash_courant, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.boutique_id, entry.type_transaction, entry.reference_id, entry.reference_numero,
    entry.client_id, entry.montant_ht, entry.montant_tva, entry.montant_ttc,
    entry.date_transaction, entry.hash_precedent, entry.donnees_hash,
    entry.hash_courant, entry.user_id
  ).run()

  return entry.hash_courant
}

// ─── Vérification de la chaîne ────────────────────────────────────────────────

export interface VerificationResult {
  valide:        boolean
  nb_entrees:    number
  premiere_erreur?: {
    id:            number
    reference:     string
    hash_attendu:  string
    hash_trouve:   string
  }
}

/**
 * Vérifie l'intégrité complète de la chaîne NF525 pour une boutique.
 * Recalcule chaque hash et compare avec celui stocké.
 * Une rupture indique une modification frauduleuse.
 */
export async function verifyChain(
  db: D1Database,
  boutique_id: number
): Promise<VerificationResult> {
  const entries = await db
    .prepare(`
      SELECT id, reference_numero, donnees_hash, hash_courant, hash_precedent
      FROM   journal_nf525
      WHERE  boutique_id = ?
      ORDER  BY id ASC
    `)
    .bind(boutique_id)
    .all<{ id: number; reference_numero: string; donnees_hash: string; hash_courant: string; hash_precedent: string }>()

  const rows = entries.results
  let previousHash = ''

  for (const row of rows) {
    // Vérifier que hash_precedent correspond bien au hash précédent
    if (row.hash_precedent !== previousHash) {
      return {
        valide: false,
        nb_entrees: rows.length,
        premiere_erreur: {
          id:           row.id,
          reference:    row.reference_numero,
          hash_attendu: previousHash,
          hash_trouve:  row.hash_precedent,
        }
      }
    }

    // Recalculer le hash courant
    const expectedHash = await sha256(row.donnees_hash)
    if (expectedHash !== row.hash_courant) {
      return {
        valide: false,
        nb_entrees: rows.length,
        premiere_erreur: {
          id:           row.id,
          reference:    row.reference_numero,
          hash_attendu: expectedHash,
          hash_trouve:  row.hash_courant,
        }
      }
    }

    previousHash = row.hash_courant
  }

  return { valide: true, nb_entrees: rows.length }
}

// ─── Clôture journalière ──────────────────────────────────────────────────────

/**
 * Effectue la clôture journalière NF525.
 * À appeler en fin de journée (ou automatiquement à minuit).
 */
export async function clotureJournaliere(
  db: D1Database,
  boutique_id: number,
  date: string,  // 'YYYY-MM-DD'
  user_id: number
): Promise<{ success: boolean; message: string }> {
  // Vérifier que la clôture n'existe pas déjà
  const existing = await db
    .prepare('SELECT id FROM clotures_journalieres WHERE boutique_id = ? AND date_cloture = ?')
    .bind(boutique_id, date)
    .first()

  if (existing) {
    return { success: false, message: `Clôture du ${date} déjà effectuée.` }
  }

  // Agréger les transactions du jour
  const stats = await db
    .prepare(`
      SELECT COUNT(*) as nb, SUM(montant_ht) as ht, SUM(montant_tva) as tva, SUM(montant_ttc) as ttc
      FROM   journal_nf525
      WHERE  boutique_id = ? AND DATE(date_transaction) = ?
      AND    type_transaction = 'facture'
    `)
    .bind(boutique_id, date)
    .first<{ nb: number; ht: number; tva: number; ttc: number }>()

  // Récupérer le dernier hash du journal
  const lastHash = await db
    .prepare('SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1')
    .bind(boutique_id)
    .first<{ hash_courant: string }>()

  const previousHash = lastHash?.hash_courant ?? ''
  const clotureData  = `CLOTURE|${boutique_id}|${date}|${(stats?.ht ?? 0).toFixed(2)}|${(stats?.ttc ?? 0).toFixed(2)}|${previousHash}`
  const hashCloture  = await sha256(clotureData)

  await db.prepare(`
    INSERT INTO clotures_journalieres
      (boutique_id, date_cloture, nb_transactions, total_ht, total_tva, total_ttc, hash_cloture, hash_precedent, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    boutique_id, date,
    stats?.nb ?? 0, stats?.ht ?? 0, stats?.tva ?? 0, stats?.ttc ?? 0,
    hashCloture, previousHash, user_id
  ).run()

  return { success: true, message: `Clôture du ${date} effectuée. ${stats?.nb ?? 0} transactions. CA TTC : ${(stats?.ttc ?? 0).toFixed(2)} €` }
}
