/**
 * @module caisseService
 * @description Model P1 : Caisse POS + Journal fiscal NF525.
 *
 * Rôle architectural (P1 MVC) : Model exclusif — tout le SQL est ici.
 * Les routes `src/routes/caisse.ts` délèguent sans aucun `.prepare()`.
 *
 * Architecture NF525 (Loi anti-fraude TVA, art. 88 LFR 2015) :
 *  - Chaque transaction est insérée dans `journal_nf525` avec un hash SHA-256 chaîné.
 *  - **Deux écrivains alimentent cette chaîne, avec deux formats canoniques** :
 *      A — ici même (INSERT direct), types `vente` / `encaissement` :
 *          `SHA-256(type|reference_numero|montant_centimes|date|hash_precedent)`
 *      B — `lib/nf525.enregistrerTransaction()`, types `facture` / `avoir` :
 *          `SHA-256(boutique_id|type|ref|ht|tva|ttc|date|hash_precedent)`
 *    Les deux se chaînent correctement (chacun lit le dernier `hash_courant` de la
 *    boutique) ; seule la genèse diffère — 64 zéros chez A, chaîne vide chez B.
 *    `verifierIntegriteChaine()` aiguille sur `type_transaction` (voir
 *    `rebuildDonneesHash()`). Constaté et corrigé le 2026-09-04, ticket 005 : le
 *    vérificateur ne connaissait que le format A et déclarait donc frauduleuse
 *    **toute** facture émise et **tout** avoir, depuis l'origine du journal.
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

// AVANT (2026-10-05, ticket 02 prix TTC — calculLigne() calcule aussi chaque ligne écrite) :
// import { nextNumero, calculLignes } from '../lib/db'
// AVANT (2026-10-05, revue du ticket 03 — ligneEnTtc() partagé avec factures et avoirs) :
// import { nextNumero, calculLignes, calculLigne } from '../lib/db'
import { nextNumero, calculLignes, calculLigne, ligneEnTtc } from '../lib/db'
import { prixHtDepuisTtc } from '../lib/prixVente'
import { todayParis, currentMonthParis } from '../lib/timezone'
import { buildCanonicalData, assertPeutEcrireAuRegistre } from '../lib/nf525'
import type { Database } from '../ports/database'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Une ligne d'article pour une vente POS (produit ou service). */
export interface LignePOS {
  produit_id?:     number
  service_id?:     number
  designation:     string
  quantite:        number
  // AVANT (2026-10-05, ticket 02 prix TTC — la caisse envoie désormais le prix TTC ; le HT seul reste
  // accepté pour une page de caisse restée en cache) :
  // prix_unitaire_ht: number
  prix_unitaire_ht?:  number
  prix_unitaire_ttc?: number  // prix affiché au client, avant remise — fait foi quand il est présent
  tva_taux:        number
  remise_pct?:     number  // remise en % sur la ligne
}

// ════════════════════════════════════════════════════════════════════════════════
// Ligne de vente remisée — ticket 02 du chantier prix TTC (décisions Q2 et Q11 du 2026-10-04)
// ════════════════════════════════════════════════════════════════════════════════

/** Ligne de vente prête à calculer et à écrire : remise appliquée, mode de calcul connu. */
export interface LigneDeVenteRemisee {
  quantite:           number
  tva_taux:           number
  mode_calcul:        'ttc' | 'ht'
  /** Prix unitaire remisé, celui qui entre dans le calcul (TTC en mode TTC, HT en mode HT). */
  prix_unitaire_ttc?: number
  prix_unitaire_ht?:  number
  /** Prix à écrire sur la ligne, avant remise (inchangé : la ligne a toujours gardé le prix brut). */
  prix_unitaire_ht_avant_remise:  number
  prix_unitaire_ttc_avant_remise: number | null
}

// AVANT (2026-10-05, revue du ticket 03 — une seule définition, `ligneEnTtc()` de lib/db.ts) :
// /** Vrai si la ligne porte un prix TTC exploitable : elle se calcule alors depuis le TTC. */
// function ligneEnvoyeeEnTtc(ligne: LignePOS): boolean {
//   return typeof ligne.prix_unitaire_ttc === 'number' && Number.isFinite(ligne.prix_unitaire_ttc)
// }

/**
 * Applique la remise d'une ligne et dit comment la calculer. Seul point de la remise en caisse :
 * les totaux de la facture et les lignes écrites passent tous deux par ici.
 * - Ligne en TTC : PU TTC remisé = arrondi au centime de PU TTC × (1 − remise %) (Q11), calculé en
 *   centimes entiers (la virgule flottante perdait le demi-centime : 4,35 € − 10 % → 3,91 €).
 * - Remise hors de 0-100 % ou illisible : refusée (erreur), avant tout numéro de facture.
 * - Ligne en HT seul (page restée en cache) : ancien calcul, PU HT × (1 − remise %) sans arrondi.
 */
export function ligneDeVenteRemisee(ligne: LignePOS): LigneDeVenteRemisee {
  const remisePct = ligne.remise_pct ?? 0
  // Une remise hors de 0-100 % (ou illisible) ferait une ligne négative ou gonflée — voire nulle
  // (NaN) — écrite sur une facture immuable et au journal NF525 : refusée avant tout numéro.
  const remiseLisible = Number.isFinite(remisePct)
  const remiseDansLesBornes = remiseLisible && remisePct >= 0 && remisePct <= 100
  if (!remiseDansLesBornes) {
    throw new Error(`Remise invalide sur « ${ligne.designation} » : un pourcentage entre 0 et 100 est attendu.`)
  }
  const coefficientDeRemise = 1 - remisePct / 100

  // AVANT (2026-10-05, revue du ticket 03) : if (ligneEnvoyeeEnTtc(ligne)) {
  if (ligneEnTtc(ligne)) {
    const prixTtc = ligne.prix_unitaire_ttc!
    // AVANT (2026-10-05, revue du ticket 02 — en virgule flottante, 4,35 € − 10 % donnait 3,91 €) :
    // const prixTtcRemiseEnCentimes = Math.round(prixTtc * coefficientDeRemise * 100)
    // Calcul en centimes entiers : prix en centimes × (100 − remise) ÷ 100, un seul arrondi.
    const prixTtcEnCentimes = Math.round(prixTtc * 100)
    const prixTtcRemiseEnCentimes = Math.round((prixTtcEnCentimes * (100 - remisePct)) / 100)
    return {
      quantite:    ligne.quantite,
      tva_taux:    ligne.tva_taux,
      mode_calcul: 'ttc',
      prix_unitaire_ttc: prixTtcRemiseEnCentimes / 100,
      prix_unitaire_ht_avant_remise:  prixHtDepuisTtc(prixTtc, ligne.tva_taux),
      prix_unitaire_ttc_avant_remise: prixTtc,
    }
  }

  const prixHt = ligne.prix_unitaire_ht ?? 0
  return {
    quantite:    ligne.quantite,
    tva_taux:    ligne.tva_taux,
    mode_calcul: 'ht',
    prix_unitaire_ht: prixHt * coefficientDeRemise,
    prix_unitaire_ht_avant_remise:  prixHt,
    prix_unitaire_ttc_avant_remise: null,
  }
}

/** Données d'entrée pour enregistrer une vente en caisse. */
export interface VentePOSData {
  client_id?:     number
  lignes:         LignePOS[]
  mode_paiement:  'especes' | 'cb' | 'virement' | 'cheque' | 'mixte'
  // AVANT (2026-10-03, recette 002 C — le montant remis est désormais conservé) :
  // montant_especes?: number  // pour calcul rendu monnaie
  // montant_cb?:      number
  // montant_cheque?:  number
  montant_especes?: number  // montant REMIS par le client en espèces (rendu = remis − part en espèces)
  montant_cb?:      number  // ⚠ plus lu depuis la recette 002 B : la ventilation passe par `paiements`
  montant_cheque?:  number  // ⚠ plus lu depuis la recette 002 B : la ventilation passe par `paiements`
  /** Mode « mixte » seulement : les deux parts du paiement (recette 002 B). */
  paiements?:      { mode_paiement: string; montant: number }[]
  note?:           string
}

// ════════════════════════════════════════════════════════════════════════════════
// Ventilation du paiement d'une vente — recette 002 B et C (décisions du 2026-10-03)
// ════════════════════════════════════════════════════════════════════════════════

/** Modes qu'une part de paiement peut prendre. « mixte » n'en est pas un : c'est un assemblage. */
export const MODES_DE_PAIEMENT_SIMPLES = ['especes', 'cb', 'cheque', 'virement'] as const

/** Nombre de parts d'un paiement « mixte » (décision de l'exploitant : deux, pas plus). */
export const NOMBRE_DE_PARTS_MIXTE = 2

/** Une ligne `paiements` à écrire pour une vente. */
export interface PartDePaiement {
  mode_paiement: string
  montant:       number         // somme due pour cette part (jamais le montant remis)
  montant_remis: number | null  // espèces remises par le client — part en espèces seulement
  rendu_monnaie: number | null  // monnaie rendue — part en espèces seulement
}

/** Un montant en euros converti en centimes entiers, pour comparer sans erreur d'arrondi. */
function enCentimes(montantEnEuros: number): number {
  return Math.round(montantEnEuros * 100)
}

/**
 * Décide des lignes `paiements` d'une vente, ou refuse — **avant toute écriture** : un refus ne
 * doit consommer aucun numéro de facture (`createVente()` l'appelle avant `nextNumero()`).
 *
 * Règles :
 *  - paiement simple (espèces, CB, chèque, virement) : une part, du montant total ;
 *  - « mixte » : exactement deux parts, chacune dans un mode simple, modes différents, montants
 *    positifs, somme égale au total au centime près ;
 *  - montant remis (`montant_especes`) : seulement s'il y a une part en espèces, et au moins égal à
 *    cette part. Le rendu est la différence. Les deux sont gardés sur la part en espèces.
 *
 * @param demande   Mode choisi, parts (mixte), montant remis éventuel
 * @param totalTtc  Total TTC de la vente, en euros
 * @returns         Les parts à écrire, dans l'ordre reçu
 * @throws          Error au message lisible par le vendeur si la demande est refusée
 */
export function ventilerPaiements(
  demande: { mode_paiement: string; paiements?: { mode_paiement: string; montant: number }[]; montant_especes?: number },
  totalTtc: number,
): PartDePaiement[] {
  const estMixte = demande.mode_paiement === 'mixte'

  // ── 1. Les parts, avant le montant remis ─────────────────────────────────────
  let parts: PartDePaiement[]

  if (!estMixte) {
    // Paiement simple : des parts envoyées n'ont pas de sens, on refuse plutôt que d'en ignorer
    if (demande.paiements !== undefined) {
      throw new Error('Les parts de paiement ne s\'envoient qu\'avec le mode « mixte ».')
    }
    parts = [{ mode_paiement: demande.mode_paiement, montant: totalTtc, montant_remis: null, rendu_monnaie: null }]
  } else {
    const partsDemandees = demande.paiements ?? []
    if (partsDemandees.length !== NOMBRE_DE_PARTS_MIXTE) {
      throw new Error(`Un paiement mixte se fait en ${NOMBRE_DE_PARTS_MIXTE} parts exactement.`)
    }

    const modesDejaVus: string[] = []
    for (const part of partsDemandees) {
      const modeConnu = (MODES_DE_PAIEMENT_SIMPLES as readonly string[]).includes(part.mode_paiement)
      if (!modeConnu) {
        throw new Error(`Mode de paiement inconnu pour une part du mixte : « ${part.mode_paiement} ».`)
      }
      if (modesDejaVus.includes(part.mode_paiement)) {
        throw new Error('Les deux parts d\'un paiement mixte doivent être dans deux modes différents.')
      }
      modesDejaVus.push(part.mode_paiement)

      const montantValide = typeof part.montant === 'number' && Number.isFinite(part.montant) && part.montant > 0
      if (!montantValide) {
        throw new Error('Chaque part d\'un paiement mixte doit être un montant supérieur à 0.')
      }
    }

    // La somme des parts doit être exactement le total, comparée en centimes (0,1 + 0,2 = 0,30)
    let sommeEnCentimes = 0
    for (const part of partsDemandees) sommeEnCentimes += enCentimes(part.montant)
    if (sommeEnCentimes !== enCentimes(totalTtc)) {
      throw new Error(`Les deux parts (${(sommeEnCentimes / 100).toFixed(2)} €) ne font pas le total de la vente (${totalTtc.toFixed(2)} €).`)
    }

    parts = partsDemandees.map(part => ({
      mode_paiement: part.mode_paiement,
      montant:       part.montant,
      montant_remis: null,
      rendu_monnaie: null,
    }))
  }

  // ── 2. Le montant remis et le rendu, sur la part en espèces ──────────────────
  const montantRemis = demande.montant_especes
  const unMontantEstRemis = typeof montantRemis === 'number' && montantRemis > 0
  if (!unMontantEstRemis) return parts

  const partEnEspeces = parts.find(part => part.mode_paiement === 'especes')
  if (!partEnEspeces) {
    throw new Error('Un montant remis n\'a de sens que si une partie est payée en espèces.')
  }
  if (enCentimes(montantRemis) < enCentimes(partEnEspeces.montant)) {
    throw new Error(`Le montant remis (${montantRemis.toFixed(2)} €) est inférieur à la part en espèces (${partEnEspeces.montant.toFixed(2)} €).`)
  }
  partEnEspeces.montant_remis = montantRemis
  partEnEspeces.rendu_monnaie = (enCentimes(montantRemis) - enCentimes(partEnEspeces.montant)) / 100

  return parts
}

/**
 * Ligne vendue alors que le stock affiché ne la couvrait pas (ticket 02 `vente-lit-catalogue`).
 * Le stock a été ramené à 0 ; `ligne` est le rang de la ligne dans la vente, à partir de 1.
 */
export interface StockInsuffisant {
  ligne:       number
  produit_id:  number
  designation: string
  stock_avant: number
  quantite:    number
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

/**
 * Types de transaction écrits par `lib/nf525.enregistrerTransaction()` — dits
 * « écrivain B », au format `boutique_id|type|ref|ht|tva|ttc|date|prev`.
 *
 * Tout autre type est écrit ici même, par INSERT direct — « écrivain A », au
 * format `type|ref|centimes|date|prev` (`buildDonneesHash()` ci-dessus).
 *
 * Relevé le 2026-09-04 en lisant les appelants, pas en supposant :
 *   A → 'vente' (`createVente()`), 'encaissement' (`enregistrerEncaissement()`)
 *   B → 'facture' (`factureService.emettreFacture()`), 'avoir' (`creerAvoir()`)
 *
 * `cloturerJournee()` n'écrit PAS dans `journal_nf525` (table
 * `clotures_journalieres`) — ce n'est pas un écrivain de cette chaîne.
 *
 * Le défaut par défaut est le format A : c'est le comportement historique, et un
 * type inconnu doit ressortir en anomalie plutôt que d'être validé au hasard.
 */
export const TYPES_ECRIVAIN_B = new Set(['facture', 'avoir'])

/**
 * Reconstruit la chaîne canonique d'une entrée du journal selon l'écrivain qui
 * l'a produite, déterminé par `type_transaction`.
 *
 * Pourquoi un aiguillage plutôt qu'un format unique (décision du 2026-09-04,
 * ticket 005) : deux écrivains cohabitent depuis l'origine du journal, avec deux
 * formats incompatibles. Aligner le vérificateur sur l'un déclare l'autre
 * frauduleux — le mensonge se déplace au lieu de disparaître. Et réécrire les
 * `hash_courant` déjà émis pour les uniformiser est exactement ce que NF525
 * interdit. L'aiguillage est la seule option qui ne réécrit aucune ligne.
 *
 * ⚠ On reconstruit depuis les CHAMPS de la ligne, jamais depuis la colonne
 * `donnees_hash` stockée : relire cette colonne validerait une ligne dont le
 * montant a été réécrit en base, et le contrôle légal ne prouverait plus rien.
 *
 * @param t  Entrée du journal telle qu'elle est stockée
 * @returns  Chaîne canonique à repasser dans sha256() pour comparaison
 */
function rebuildDonneesHash(t: JournalEntry): string {
  if (TYPES_ECRIVAIN_B.has(t.type_transaction)) {
    return buildCanonicalData(t, t.hash_precedent)
  }
  return buildDonneesHash(
    t.type_transaction,
    t.reference_numero,
    t.montant_ttc,
    t.date_transaction,
    t.hash_precedent
  )
}

// ─── Helpers DB ───────────────────────────────────────────────────────────────

/**
 * Récupère le hash de la dernière transaction NF525 enregistrée pour la boutique.
 * Retourne une chaîne de 64 zéros si aucune transaction n'existe (hash genèse).
 *
 * Ce hash est le `hash_precedent` de la prochaine transaction à insérer.
 *
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * `createVente()` reste sur `D1Database` (dépend de `nextNumero()`, non porté)
 * et duplique cette requête en interne plutôt que d'appeler cette fonction —
 * évite de coupler un appelant non migré à un adaptateur concret.
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Hash hex de 64 caractères ("000..." pour la première transaction)
 */
export async function getHashPrecedent(
  db:         Database,
  boutiqueId: number
): Promise<string> {
  const row = await db.get<{ hash_courant: string }>(`
    SELECT hash_courant FROM journal_nf525
    WHERE  boutique_id = ?
    ORDER  BY id DESC
    LIMIT  1
  `, [boutiqueId])

  return row?.hash_courant ?? '0000000000000000000000000000000000000000000000000000000000000000'
}

/**
 * Récupère le hash de la dernière clôture journalière.
 * Utilisé pour chaîner les clôtures inter-journées (hash_precedent de la clôture).
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Hash hex 64 caractères ("000..." si aucune clôture précédente)
 */
async function getHashPrecedentCloture(
  db:         Database,
  boutiqueId: number
): Promise<string> {
  const row = await db.get<{ hash_cloture: string }>(`
    SELECT hash_cloture FROM clotures_journalieres
    WHERE  boutique_id = ?
    ORDER  BY id DESC
    LIMIT  1
  `, [boutiqueId])

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
 * Non migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12) :
 * dépend de `nextNumero()`, qui prend encore un `D1Database` brut.
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
  stock_insuffisant: StockInsuffisant[]
}> {
  if (!data.lignes || data.lignes.length === 0) {
    throw new Error('La vente doit contenir au moins une ligne.')
  }

  // Un admin plateforme n'inscrit aucune pièce au registre légal d'une boutique
  // (ticket 004, ADR 0002). Contrôlé avant tout calcul : rien ne doit être écrit.
  await assertPeutEcrireAuRegistre(db, userId)

  // Le lien d'une ligne vers le catalogue est écrit sur une facture immuable : un service
  // d'une autre boutique fausserait ses comptes pour toujours. Refusé avant toute écriture.
  // `!== undefined`, jamais `filter(Boolean)` : un NaN est falsy et échapperait au contrôle.
  for (const serviceId of new Set(data.lignes.map(l => l.service_id).filter(id => id !== undefined))) {
    if (!Number.isInteger(serviceId) || serviceId! <= 0) throw new Error('Identifiant de service invalide.')
    const service = await db.prepare(
      'SELECT id FROM services WHERE id = ? AND boutique_id = ?'
    ).bind(serviceId, boutiqueId).first<{ id: number }>()
    if (!service) throw new Error(`Service ${serviceId} introuvable dans cette boutique.`)
  }

  // ── 1. Calcul totaux ──────────────────────────────────────────────────────
  // AVANT (2026-10-05, ticket 02 prix TTC — remise et mode de calcul par ligneDeVenteRemisee(),
  // commune aux totaux et aux lignes écrites à l'étape 4) :
  // // Appliquer remises ligne par ligne
  // const lignesCalculees = data.lignes.map(l => ({
  //   quantite:          l.quantite,
  //   prix_unitaire_ht:  l.prix_unitaire_ht * (1 - (l.remise_pct ?? 0) / 100),
  //   tva_taux:          l.tva_taux,
  // }))
  const lignesRemisees = data.lignes.map(ligneDeVenteRemisee)
  const totaux = calculLignes(lignesRemisees)

  // ── 1a. Ventilation du paiement (recette 002 B et C) ──────────────────────
  // Vérifiée ICI, avant le numéro de facture (étape 2) : une ventilation refusée ne doit
  // consommer aucun numéro de la série ni rien écrire.
  const partsDePaiement = ventilerPaiements(data, totaux.total_ttc)

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
  // Seul appel à `nextNumero()` hors d'`emettreFacture()`, et c'est cohérent avec
  // la règle « le numéro n'est attribué qu'à l'émission » : une vente POS *est*
  // émise dès sa création (numérotée, payée, chaînée NF525 plus bas), elle ne
  // passe jamais par l'état brouillon. Ticket 001 conformité-facturation.
  // Le verrouillage correspondant est posé à l'étape 8, après le journal NF525.
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
  // Lignes dont le stock affiché ne couvrait pas la quantité vendue : la vente passe
  // (écrêtage à 0, jamais de stock négatif) mais l'écran doit pouvoir le dire.
  const stockInsuffisant: StockInsuffisant[] = []

  for (const [index, l] of data.lignes.entries()) {
    // AVANT (2026-10-05, ticket 02 prix TTC — même calcul que les totaux, par ligneDeVenteRemisee()) :
    // const prixApresRemise = l.prix_unitaire_ht * (1 - (l.remise_pct ?? 0) / 100)
    // const ligneHt  = Math.round(l.quantite * prixApresRemise * 100) / 100
    // const ligneTva = Math.round(ligneHt * (l.tva_taux / 100) * 100) / 100
    const ligneRemisee = lignesRemisees[index]
    const montantsDeLaLigne = calculLigne(ligneRemisee)

    // AVANT (2026-10-05, ticket 02 prix TTC — prix TTC et mode de calcul ajoutés en fin de liste) :
    //     (document_type, document_id, produit_id, service_id, description,
    //      quantite, prix_unitaire_ht, tva_taux,
    //      total_ht, total_tva, total_ttc)
    //   VALUES ('facture', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    //   … l.prix_unitaire_ht, l.tva_taux, ligneHt, ligneTva, Math.round((ligneHt + ligneTva) * 100) / 100
    await db.prepare(`
      INSERT INTO lignes_document
        (document_type, document_id, produit_id, service_id, description,
         quantite, prix_unitaire_ht, tva_taux,
         total_ht, total_tva, total_ttc,
         prix_unitaire_ttc, mode_calcul)
      VALUES ('facture', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      facture.id,
      l.produit_id  ?? null,
      l.service_id  ?? null,
      l.designation,
      l.quantite,
      ligneRemisee.prix_unitaire_ht_avant_remise,
      l.tva_taux,
      montantsDeLaLigne.ht,
      montantsDeLaLigne.tva,
      montantsDeLaLigne.ttc,
      ligneRemisee.prix_unitaire_ttc_avant_remise,
      ligneRemisee.mode_calcul
    ).run()

    // Décrémenter stock si produit
    if (l.produit_id) {
      const produit = await db.prepare(
        'SELECT stock_actuel FROM produits WHERE id = ? AND boutique_id = ?'
      ).bind(l.produit_id, boutiqueId).first<{ stock_actuel: number }>()

      // Produit inexistant pour cette boutique — aucun mouvement à tracer (même
      // comportement que l'ancien UPDATE, qui ne touchait aucune ligne dans ce cas)
      if (produit) {
        const stockAvant = produit.stock_actuel
        const stockApres = Math.max(0, stockAvant - l.quantite)
        if (stockAvant < l.quantite) {
          stockInsuffisant.push({
            ligne:       index + 1,
            produit_id:  l.produit_id,
            designation: l.designation,
            stock_avant: stockAvant,
            quantite:    l.quantite,
          })
        }

        await db.prepare(`
          UPDATE produits
          SET stock_actuel = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND boutique_id = ?
        `).bind(stockApres, l.produit_id, boutiqueId).run()

        // Mouvement de stock — colonnes alignées sur le schéma réel de
        // `mouvements_stock` (bug corrigé le 2026-07-12 : `raison`/`reference_id`
        // n'existent pas, `stock_avant`/`stock_apres` NOT NULL jamais fournis —
        // faisait échouer TOUTE vente POS d'un produit suivi en stock, en
        // laissant en plus la facture déjà créée `payee` sans entrée NF525).
        await db.prepare(`
          INSERT INTO mouvements_stock
            (boutique_id, produit_id, type_mouvement, quantite, stock_avant, stock_apres, motif, user_id)
          VALUES (?, ?, 'sortie', ?, ?, ?, 'Vente POS', ?)
        `).bind(boutiqueId, l.produit_id, l.quantite, stockAvant, stockApres, userId).run()
      }
    }
  }

  // ── 5. Créer le paiement ──────────────────────────────────────────────────
  // AVANT (2026-10-03, recette 002 B — un paiement « mixte » perdait sa ventilation) : une seule
  // ligne, du montant total, au mode `mixte` :
  //   const modePaiementPrincipal = data.mode_paiement === 'mixte' ? 'mixte' : data.mode_paiement
  //   INSERT INTO paiements (facture_id, boutique_id, montant, mode_paiement, date_paiement, user_id)
  //   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?) — avec totaux.total_ttc et modePaiementPrincipal
  // Désormais : une ligne PAR PART décidée par `ventilerPaiements()` (étape 1a), chacune dans son
  // mode ; la part en espèces porte le montant remis et le rendu (migration 0061, recette 002 C).
  for (const part of partsDePaiement) {
    await db.prepare(`
      INSERT INTO paiements
        (facture_id, boutique_id, montant, mode_paiement, date_paiement, user_id,
         montant_remis, rendu_monnaie)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `).bind(
      facture.id,
      boutiqueId,
      part.montant,
      part.mode_paiement,
      userId,
      part.montant_remis,
      part.rendu_monnaie,
    ).run()
  }

  // ── 6. Rendu monnaie (si espèces) ─────────────────────────────────────────
  // AVANT (2026-10-03, recette 002 C — le rendu est calculé une seule fois, par la ventilation) :
  //   let renduMonnaie: number | undefined
  //   if (data.montant_especes && data.montant_especes > 0) {
  //     const montantEspeces = data.montant_especes
  //     const autresPaiements = (data.montant_cb ?? 0) + (data.montant_cheque ?? 0)
  //     const resteEnEspeces = totaux.total_ttc - autresPaiements
  //     if (montantEspeces > resteEnEspeces) {
  //       renduMonnaie = Math.round((montantEspeces - resteEnEspeces) * 100) / 100
  //     }
  //   }
  const partEnEspeces = partsDePaiement.find(part => part.mode_paiement === 'especes')
  const renduMonnaie: number | undefined = partEnEspeces?.rendu_monnaie ?? undefined

  // ── 7. Entrée Journal NF525 avec hash chaîné ──────────────────────────────
  // Requête dupliquée de getHashPrecedent() (migrée vers le port Database) —
  // createVente() reste sur D1Database (dépend de nextNumero(), non porté).
  const hashPrecedentRow = await db.prepare(`
    SELECT hash_courant FROM journal_nf525
    WHERE  boutique_id = ?
    ORDER  BY id DESC
    LIMIT  1
  `).bind(boutiqueId).first<{ hash_courant: string }>()
  const hashPrecedent = hashPrecedentRow?.hash_courant ?? '0000000000000000000000000000000000000000000000000000000000000000'
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

  // ── 8. Verrouillage NF525 de la vente ─────────────────────────────────────
  // Une vente POS *est* une facture émise : numérotée, payée, chaînée. Elle doit
  // donc porter les mêmes marques d'émission qu'`emettreFacture()`, faute de quoi
  // `createAvoir()` la refuse (`if (!facture.locked) throw`) et aucune vente
  // encaissée n'est corrigeable — ce qu'interdit NF525, qui impose la correction
  // par document rectificatif et jamais par suppression. Ticket 002.
  //
  // ⚠ ORDRE : le verrou est posé APRÈS l'écriture du journal, comme dans
  // `emettreFacture()`. Le poser dans l'INSERT de l'étape 3 rendrait la facture
  // immuable AVANT que la chaîne NF525 n'existe : un échec ci-dessus laisserait
  // une facture verrouillée sans entrée au journal, donc irréparable.
  //
  // Second site de figeage des identités, assumé : `emettreFacture()` couvre les
  // trois chemins brouillon → émission (manuelle, conversion de devis, acompte),
  // celui-ci couvre la vente POS, qui naît émise et ne passe jamais par eux.
  const vendeur = await db.prepare(`
    SELECT b.nom, b.siret, b.tva_numero, b.adresse, b.code_postal, b.ville,
           b.telephone, b.email,
           s.tva_taux_defaut, s.mention_facture
    FROM   boutiques b
    LEFT   JOIN boutique_settings s ON s.boutique_id = b.id
    WHERE  b.id = ?
  `).bind(boutiqueId).first<any>()

  const acheteur = await db.prepare(`
    SELECT type_client, raison_sociale, prenom, nom, siret, tva_intracom, adresse, code_postal, ville
    FROM clients WHERE id = ?
  `).bind(clientId).first<any>()

  // Identité des appareils vendus (ticket 07 `vente-lit-catalogue`, story 22) : une entrée par
  // ligne dont le produit porte un IMEI — marque, modèle (= nom de la fiche, décision de
  // l'exploitant du 2026-09-30), IMEI —, **relue en base** au moment de la vente, jamais prise
  // dans ce qu'envoie le navigateur. Écrite par CET UPDATE, avec les autres marques du figeage :
  // aucun troisième site, rien avant le journal. Elle n'entre pas dans les données hashées.
  const appareils: { produit_id: number; designation: string; marque: string | null; modele: string; imei: string }[] = []
  for (const l of data.lignes) {
    if (!l.produit_id) continue
    const p = await db.prepare(
      'SELECT nom, marque, imei FROM produits WHERE id = ? AND boutique_id = ?'
    ).bind(l.produit_id, boutiqueId).first<{ nom: string; marque: string | null; imei: string | null }>()
    if (p?.imei) appareils.push({ produit_id: l.produit_id, designation: l.designation, marque: p.marque, modele: p.nom, imei: p.imei })
  }

  // AVANT (2026-09-30, ticket 07 — instantané des appareils ajouté au figeage) : la ligne SQL
  // `acheteur_snapshot = ?` terminait la liste du SET ; elle est suivie de `appareils_snapshot = ?`.
  await db.prepare(`
    UPDATE factures
    SET locked            = 1,
        issued_at         = CURRENT_TIMESTAMP,
        tracking_token    = ?,
        hash_nf525        = ?,
        vendeur_snapshot  = ?,
        acheteur_snapshot = ?,
        appareils_snapshot = ?
    WHERE id = ?
  `).bind(
    crypto.randomUUID(),
    hashCourant,
    JSON.stringify(vendeur  ?? {}),
    JSON.stringify(acheteur ?? {}),
    appareils.length ? JSON.stringify(appareils) : null,
    facture.id,
  ).run()

  return { facture, journal, rendu_monnaie: renduMonnaie, stock_insuffisant: stockInsuffisant }
}

// ─── Encaissement sur facture existante ──────────────────────────────────────

/**
 * Enregistre un encaissement sur une facture existante (créée hors caisse).
 * Marque la facture comme `payee`, crée le paiement et trace dans le journal NF525.
 *
 * Cas d'usage : une facture devis/SAV est réglée physiquement au comptoir.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 *
 * @param db            Port Database
 * @param boutiqueId    Identifiant de la boutique
 * @param userId        Identifiant du caissier
 * @param factureId     Identifiant de la facture à encaisser
 * @param modePaiement  Mode de règlement ('especes', 'cb', 'virement', 'cheque')
 * @returns             Entrée journal NF525 créée
 * @throws              Error si facture introuvable ou déjà payée
 */
export async function enregistrerEncaissement(
  db:           Database,
  boutiqueId:   number,
  userId:       number,
  factureId:    number,
  modePaiement: string
): Promise<JournalEntry> {
  // Un admin plateforme n'inscrit aucune pièce au registre légal (ticket 004, ADR 0002).
  await assertPeutEcrireAuRegistre(db, userId)

  const facture = await db.get<any>(
    'SELECT * FROM factures WHERE id = ? AND boutique_id = ? LIMIT 1', [factureId, boutiqueId]
  )

  if (!facture) throw new Error('Facture introuvable.')
  if (facture.statut === 'payee') throw new Error('Facture déjà payée.')

  // Marquer la facture comme payée
  await db.run(
    "UPDATE factures SET statut = 'payee', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [factureId]
  )

  // Créer le paiement
  await db.run(`
    INSERT INTO paiements
      (facture_id, boutique_id, montant, mode_paiement, date_paiement, user_id)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `, [factureId, boutiqueId, facture.total_ttc, modePaiement, userId])

  // Entrée Journal NF525
  const hashPrecedent   = await getHashPrecedent(db, boutiqueId)
  const dateTransaction = new Date().toISOString()
  const donneesHash     = buildDonneesHash('encaissement', facture.numero, facture.total_ttc, dateTransaction, hashPrecedent)
  const hashCourant     = await sha256(donneesHash)

  const journal = await db.get<JournalEntry>(`
    INSERT INTO journal_nf525
      (boutique_id, type_transaction, reference_id, reference_numero,
       client_id, montant_ht, montant_tva, montant_ttc,
       date_transaction, hash_precedent, donnees_hash, hash_courant,
       est_cloture, user_id)
    VALUES (?, 'encaissement', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    RETURNING *
  `, [
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
  ])

  if (!journal) throw new Error('Échec enregistrement journal NF525.')
  return journal
}

// ─── Journal du jour ──────────────────────────────────────────────────────────

/**
 * Retourne le journal de caisse pour une date donnée (défaut : aujourd'hui).
 * Exécute 2 requêtes en parallèle : transactions du jour + clôture éventuelle.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * "Aujourd'hui" par défaut = `todayParis()` (jour métier français, DST auto)
 * plutôt que l'UTC du serveur — un journal de caisse doit suivre la journée
 * commerciale française, pas la date UTC.
 *
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @param date        Date ciblée au format "YYYY-MM-DD" (défaut : aujourd'hui, heure française)
 * @returns           `{ date, transactions, totaux, est_cloture, cloture? }`
 *                    - `totaux` : agrégat HT/TVA/TTC + nb transactions du jour
 *                    - `est_cloture` : true si une clôture existe pour cette date
 *                    - `cloture` : détail de la clôture si existante
 */
export async function getCaisseJournal(
  db:         Database,
  boutiqueId: number,
  date?:      string  // format YYYY-MM-DD — défaut : today (heure française)
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
  const targetDate = date ?? todayParis()

  const [transactions, cloture] = await Promise.all([
    db.all<any>(`
      SELECT j.*, u.prenom || ' ' || u.nom AS caissier_nom
      FROM   journal_nf525 j
      LEFT   JOIN users u ON u.id = j.user_id
      WHERE  j.boutique_id = ?
        AND  DATE(j.date_transaction) = ?
      ORDER  BY j.id ASC
    `, [boutiqueId, targetDate]),

    db.get<ClotureSummary>(`
      SELECT * FROM clotures_journalieres
      WHERE  boutique_id = ? AND date_cloture = ?
      LIMIT  1
    `, [boutiqueId, targetDate]),
  ])

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
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * "Aujourd'hui" par défaut = `todayParis()` (jour métier français, DST auto) —
 * critique ici : une clôture NF525 doit correspondre à la journée commerciale
 * française, pas à la date UTC du serveur.
 *
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @param userId      Identifiant de l'utilisateur effectuant la clôture
 * @param date        Date à clôturer "YYYY-MM-DD" (défaut : aujourd'hui, heure française)
 * @returns           Résumé de la clôture (`ClotureSummary`)
 * @throws            Error si journée déjà clôturée ou aucune transaction à clôturer
 */
export async function cloturerJournee(
  db:         Database,
  boutiqueId: number,
  userId:     number,
  date?:      string  // défaut : aujourd'hui (heure française)
): Promise<ClotureSummary> {
  const targetDate = date ?? todayParis()

  // Vérifier qu'une clôture n'existe pas déjà
  const existante = await db.get(
    'SELECT id FROM clotures_journalieres WHERE boutique_id = ? AND date_cloture = ?',
    [boutiqueId, targetDate]
  )

  if (existante) {
    throw new Error(`Journée du ${targetDate} déjà clôturée.`)
  }

  // Récupérer toutes les transactions non clôturées du jour
  const transactions = await db.all<JournalEntry>(`
    SELECT * FROM journal_nf525
    WHERE  boutique_id = ?
      AND  DATE(date_transaction) = ?
      AND  est_cloture = 0
    ORDER  BY id ASC
  `, [boutiqueId, targetDate])

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

  // AVANT (2026-10-03 — deux écritures séparées : un échec de la seconde laissait les ventes
  // « clôturées » sans clôture, et la journée ne pouvait plus jamais être clôturée) :
  //   // Marquer les transactions comme clôturées
  //   await db.run(`
  //     UPDATE journal_nf525
  //     SET    est_cloture = 1, periode_cloture = ?
  //     WHERE  boutique_id = ?
  //       AND  DATE(date_transaction) = ?
  //       AND  est_cloture = 0
  //   `, [targetDate, boutiqueId, targetDate])
  //
  //   // Insérer la clôture
  //   const cloture = await db.get<ClotureSummary>(`
  //     INSERT INTO clotures_journalieres
  //       (boutique_id, date_cloture, nb_transactions,
  //        total_ht, total_tva, total_ttc,
  //        hash_cloture, hash_precedent, user_id)
  //     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  //     RETURNING *
  //   `, [
  //     boutiqueId,
  //     targetDate,
  //     transactions.length,
  //     totaux.total_ht,
  //     totaux.total_tva,
  //     totaux.total_ttc,
  //     hashCloture,
  //     hashPrecedentCloture,
  //     userId
  //   ])
  //
  // Désormais les deux écritures partent dans UN SEUL lot `batch()` (transaction D1) : soit le
  // marquage du journal ET la clôture sont enregistrés, soit aucun des deux (décision du 2026-10-03).
  const marquageDuJournal = {
    sql: `
      UPDATE journal_nf525
      SET    est_cloture = 1, periode_cloture = ?
      WHERE  boutique_id = ?
        AND  DATE(date_transaction) = ?
        AND  est_cloture = 0`,
    params: [targetDate, boutiqueId, targetDate],
  }
  const enregistrementDeLaCloture = {
    sql: `
      INSERT INTO clotures_journalieres
        (boutique_id, date_cloture, nb_transactions,
         total_ht, total_tva, total_ttc,
         hash_cloture, hash_precedent, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
    params: [
      boutiqueId,
      targetDate,
      transactions.length,
      totaux.total_ht,
      totaux.total_tva,
      totaux.total_ttc,
      hashCloture,
      hashPrecedentCloture,
      userId,
    ],
  }

  const lignesRenvoyees = await db.batch([marquageDuJournal, enregistrementDeLaCloture])

  // La 2e requête du lot (l'INSERT … RETURNING) rend la ligne de clôture créée
  const lignesDeLaCloture = lignesRenvoyees[1] ?? []
  const cloture = lignesDeLaCloture[0] as ClotureSummary | undefined

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
 * Le format canonique dépend de l'écrivain de la ligne — `rebuildDonneesHash()`
 * aiguille sur `type_transaction` (ticket 005, 2026-09-04). Le recalcul part
 * toujours des **champs** de la ligne, jamais de la colonne `donnees_hash`
 * stockée : sinon une ligne dont le montant a été réécrit en base passerait le
 * contrôle. `lib/nf525.verifyChain()` fait ce raccourci et est donc plus faible
 * sur ce point — mais il vérifie en revanche le **chaînage** (`hash_precedent`
 * contre le `hash_courant` de la ligne précédente), que cette fonction-ci ne
 * teste pas encore : une suppression de ligne au milieu du journal lui échappe.
 *
 * Cette vérification peut être effectuée par l'administration fiscale ou l'exploitant.
 *
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @param dateDebut   (optionnel) Début de plage "YYYY-MM-DD" — défaut : toutes
 * @param dateFin     (optionnel) Fin de plage "YYYY-MM-DD"
 * @returns           `{ integre: boolean, anomalies: Array<{ id, reference_numero, details }> }`
 *                    — `anomalies` est vide si la chaîne est intègre
 */
export async function verifierIntegriteChaine(
  db:          Database,
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

  const transactions = await db.all<JournalEntry>(query, params)

  const anomalies: Array<{ id: number; reference_numero: string; details: string }> = []

  for (const t of transactions) {
    const donneesAttendu = rebuildDonneesHash(t)
    const hashAttendu    = await sha256(donneesAttendu)

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
 * Exécute 4 requêtes en parallèle (aujourd'hui, mois, clôtures, dernière clôture)
 * + 1 requête de vérification de clôture du jour.
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * "Aujourd'hui"/"ce mois" = `todayParis()`/`currentMonthParis()` (heure
 * française, DST auto) plutôt que `DATE('now')`/`strftime(...,'now')` (UTC
 * serveur) — les KPIs caisse doivent suivre le calendrier commercial français.
 *
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @returns           `{ today: { nb_transactions, total_ttc, total_ht, est_cloture }, mois, derniere_cloture?, nb_clotures_mois }`
 */
export async function getKpisCaisse(
  db:         Database,
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
  const today = todayParis()
  const mois  = currentMonthParis()

  const [kpiDay, kpiMois, clotureMois, derniereClot] = await Promise.all([
    db.get<{ nb: number; ttc: number; ht: number }>(`
      SELECT COUNT(*) as nb, COALESCE(SUM(montant_ttc),0) as ttc, COALESCE(SUM(montant_ht),0) as ht
      FROM journal_nf525
      WHERE boutique_id = ? AND DATE(date_transaction) = ?
    `, [boutiqueId, today]),

    db.get<{ nb: number; ttc: number }>(`
      SELECT COUNT(*) as nb, COALESCE(SUM(montant_ttc),0) as ttc
      FROM journal_nf525
      WHERE boutique_id = ?
        AND strftime('%Y-%m', date_transaction) = ?
    `, [boutiqueId, mois]),

    db.get<{ nb: number }>(`
      SELECT COUNT(*) as nb FROM clotures_journalieres
      WHERE boutique_id = ?
        AND strftime('%Y-%m', date_cloture) = ?
    `, [boutiqueId, mois]),

    db.get<{ date_cloture: string }>(`
      SELECT date_cloture FROM clotures_journalieres
      WHERE boutique_id = ? ORDER BY id DESC LIMIT 1
    `, [boutiqueId]),
  ])

  // Vérifier si today est clôturé
  const clotureToday = await db.get(
    'SELECT id FROM clotures_journalieres WHERE boutique_id = ? AND date_cloture = ? LIMIT 1',
    [boutiqueId, today]
  )

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
 * Migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12).
 * @param db          Port Database
 * @param boutiqueId  Identifiant de la boutique
 * @param limit       Nombre maximum de clôtures retournées (défaut : 30)
 * @returns           Liste de `ClotureSummary` enrichis du nom caissier, ordre anti-chronologique
 */
export async function listClotures(
  db:         Database,
  boutiqueId: number,
  limit       = 30
): Promise<ClotureSummary[]> {
  return db.all<any>(`
    SELECT cj.*, u.prenom || ' ' || u.nom AS caissier_nom
    FROM   clotures_journalieres cj
    LEFT   JOIN users u ON u.id = cj.user_id
    WHERE  cj.boutique_id = ?
    ORDER  BY cj.id DESC
    LIMIT  ?
  `, [boutiqueId, limit])
}
