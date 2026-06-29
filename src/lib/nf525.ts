/**
 * @module nf525
 * @description Conformité NF525 — Loi anti-fraude TVA France.
 *
 * Cadre légal :
 *   Article 88 de la LFR 2015 (Loi de Finances Rectificative)
 *   Obligatoire depuis le 01/01/2018 pour tout logiciel de caisse.
 *
 * Principe cryptographique :
 *   Chaque transaction est hachée en chaîne séquentielle SHA-256 :
 *     hash_courant = SHA-256(boutique_id|type|reference|ht|tva|ttc|date|hash_precedent)
 *   La chaîne est inaltérable : modifier une transaction rompt tous les hashs suivants.
 *
 * Implémentation Web Crypto :
 *   Utilise `crypto.subtle.digest('SHA-256', ...)` — API standard disponible
 *   nativement dans Cloudflare Workers (pas de dépendance Node.js).
 *
 * Fonctions exportées :
 *   - `createNf525Entry()`    : prépare une entrée (hash calculé, non inséré)
 *   - `enregistrerTransaction()` : insère dans journal_nf525
 *   - `verifyChain()`         : vérifie l'intégrité complète de la chaîne
 *   - `clotureJournaliere()`  : scelle la journée avec hash de clôture
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

/**
 * Calcule le hash SHA-256 d'une chaîne via Web Crypto API.
 * Retourne la représentation hexadécimale en minuscules (64 caractères).
 *
 * Note : `crypto.subtle.digest` est natif dans Cloudflare Workers.
 * Ne pas utiliser `require('crypto')` (Node.js — non disponible en Workers).
 *
 * @param data  Chaîne canonique à hasher (encodée UTF-8)
 * @returns     Hash SHA-256 hexadécimal, ex: "a3f2..."
 */
async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── Calcul du hash d'une transaction ────────────────────────────────────────

/**
 * Construit la chaîne canonique des données à hasher pour NF525.
 *
 * FORMAT FIGÉ — ne JAMAIS modifier l'ordre des champs ni le séparateur `|` !
 * Toute modification est une rupture de chaîne sur TOUTES les transactions existantes.
 *
 * Ordre des champs (immuable) :
 *   boutique_id | type_transaction | reference_numero
 *   | montant_ht (2 décimales) | montant_tva (2 décimales) | montant_ttc (2 décimales)
 *   | date_transaction | hash_precedent
 *
 * Les montants sont formatés avec `.toFixed(2)` pour éviter les erreurs
 * de virgule flottante (ex: 10.1 → "10.10", jamais "10.099999...").
 *
 * @param input         Données de la transaction NF525
 * @param previousHash  Hash SHA-256 de la transaction précédente ('' si premiere)
 * @returns             Chaîne canonique prête à passer dans sha256()
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
 * Insère une entrée dans le journal NF525 après calcul du hash.
 *
 * Séquence :
 *   1. Appelle `createNf525Entry()` pour calculer le hash courant
 *   2. Insère la ligne dans `journal_nf525`
 *   3. Retourne le hash courant (utile pour chaîner la transaction suivante)
 *
 * À appeler immédiatement après la création d'une facture ou d'un avoir,
 * dans la même transaction DB pour garantir la cohérence.
 *
 * @param db    Binding D1 Cloudflare
 * @param input Données de la transaction à enregistrer
 * @returns     Hash SHA-256 de la transaction insérée
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
 *
 * Algorithme de vérification (ordre ASC obligatoire) :
 *   Pour chaque entrée du journal :
 *     1. Vérifie que `hash_precedent` == hash calculé de l'entrée précédente
 *     2. Recalcule SHA-256(donnees_hash) et compare avec `hash_courant` stocké
 *   → Toute divergence révèle une modification frauduleuse ou une corruption.
 *
 * Complexité : O(n) — parcourt toutes les entrées de la boutique.
 * À appeler depuis un endpoint admin ou lors d'un audit fiscal.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutique_id Identifiant de la boutique à vérifier
 * @returns           `{ valide, nb_entrees, premiere_erreur? }`
 *                    `premiere_erreur` contient id + hash attendu vs trouvé
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
 * Effectue la clôture journalière NF525 (opération irréversible).
 *
 * Hash de clôture (format figé) :
 *   SHA-256("CLOTURE|boutique_id|date|total_ht|total_ttc|hash_derniere_transaction")
 *
 * Séquence :
 *   1. Vérifie qu'aucune clôture n'existe déjà pour cette date (idempotence impossible)
 *   2. Agrège les transactions `facture` du jour (nb, ht, tva, ttc)
 *   3. Récupère le dernier hash du journal (chaîne continue avec les transactions)
 *   4. Calcule le hash de clôture et insère dans `clotures_journalieres`
 *
 * Important : une clôture déjà effectuée retourne `{ success: false }` sans exception —
 * la route appelante doit tester `result.success` et non capturer une erreur.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutique_id Identifiant de la boutique
 * @param date        Date de clôture au format 'YYYY-MM-DD'
 * @param user_id     Identifiant de l'utilisateur déclenchant la clôture (audit)
 * @returns           `{ success, message }` — jamais d'exception levée
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
