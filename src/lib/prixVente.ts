/**
 * @file src/lib/prixVente.ts
 * @description Prix de vente d'une pièce : TTC de référence et HT déduit (chantier prix TTC, ticket 01,
 * décisions de l'exploitant du 2026-10-04).
 *
 * - Le prix de vente TTC fait foi (Q1) : le HT s'en déduit, arrondi au centime.
 * - Un HT seul (ancien écran, ancien fichier) est encore accepté et converti en TTC (transition).
 * - Si TTC et HT arrivent ensemble, le TTC l'emporte.
 * - Quand le taux de TVA d'une fiche change sans nouveau prix, le HT est gardé et le TTC recalculé (Q20).
 *
 * Tous les calculs passent par les centimes (entiers) pour éviter les écarts de la virgule flottante —
 * même formule que la reprise de la migration 0062. Fonctions pures, sans base ni réseau.
 */

/** Taux de TVA d'une fiche créée sans taux (même valeur que le `DEFAULT` de la colonne `tva_taux`). */
export const TAUX_TVA_PAR_DEFAUT = 20

/** Message du refus d'un prix de vente TTC négatif (même forme que celui du prix d'achat). */
export const ERREUR_PRIX_VENTE_NEGATIF = 'Le prix de vente ne peut pas être négatif.'

/** Prix de vente d'une fiche : le TTC de référence et le HT qui en est déduit. */
export interface PrixDeVente {
  ttc: number
  ht:  number
}

/** TTC depuis un HT : HT × (1 + taux / 100), arrondi au centime. */
export function prixTtcDepuisHt(prixHt: number, tauxTva: number): number {
  return Math.round(prixHt * (100 + tauxTva)) / 100
}

/** HT depuis un TTC : TTC ÷ (1 + taux / 100), arrondi au centime. */
export function prixHtDepuisTtc(prixTtc: number, tauxTva: number): number {
  return Math.round((prixTtc * 10000) / (100 + tauxTva)) / 100
}

/** Vrai si la valeur est un nombre fini (ni `null`, ni absent, ni une chaîne) — un prix ou un taux. */
// AVANT (2026-10-06, revue du ticket 04 — exportée : seul test « prix lisible » du serveur) :
// function estUnNombreFini(valeur: unknown): valeur is number {
export function estUnNombreFini(valeur: unknown): valeur is number {
  return typeof valeur === 'number' && Number.isFinite(valeur)
}

/** Vrai si un prix de vente TTC est envoyé et négatif : à refuser avant toute écriture. */
export function prixVenteTtcNegatif(prixTtcEnvoye: unknown): boolean {
  return estUnNombreFini(prixTtcEnvoye) && prixTtcEnvoye < 0
}

/**
 * Prix de vente à écrire à la création d'une fiche.
 * @param prixTtcEnvoye TTC envoyé par l'appelant (prioritaire), ou absent
 * @param prixHtEnvoye  HT envoyé par un ancien écran ou fichier, ou absent
 * @param tauxTva       taux de TVA de la fiche
 * @returns le TTC et le HT ; 0 et 0 si aucun prix n'est envoyé (prix à saisir plus tard)
 */
export function prixDeVenteACreer(prixTtcEnvoye: unknown, prixHtEnvoye: unknown, tauxTva: number): PrixDeVente {
  if (estUnNombreFini(prixTtcEnvoye)) {
    return { ttc: prixTtcEnvoye, ht: prixHtDepuisTtc(prixTtcEnvoye, tauxTva) }
  }
  if (estUnNombreFini(prixHtEnvoye)) {
    return { ttc: prixTtcDepuisHt(prixHtEnvoye, tauxTva), ht: prixHtEnvoye }
  }
  return { ttc: 0, ht: 0 }
}

/**
 * Prix de vente à écrire à la modification d'une fiche, ou `null` s'il ne change pas.
 * @param prixTtcEnvoye  TTC envoyé (prioritaire), ou absent
 * @param prixHtEnvoye   HT envoyé par un ancien écran, ou absent
 * @param tauxEnvoye     taux de TVA envoyé, ou absent
 * @param prixActuel     prix et taux actuels de la fiche (relus en base) ; `ttc` facultatif — fourni, il
 *                       permet de reconnaître un TTC renvoyé à l'identique (précision de Q20, 2026-10-06)
 */
// AVANT (2026-10-06, revue du ticket 04 — TTC actuel accepté, voir « TTC renvoyé à l'identique ») :
//   prixActuel: { ht: number; tauxTva: number },
export function prixDeVenteAModifier(
  prixTtcEnvoye: unknown,
  prixHtEnvoye: unknown,
  tauxEnvoye: unknown,
  prixActuel: { ht: number; tauxTva: number; ttc?: number },
): PrixDeVente | null {
  // Un taux renvoyé à l'identique (client qui renvoie toute la fiche) n'est pas un changement :
  // sinon le TTC serait recalculé depuis le HT déduit, et 9,99 € deviendrait 10,00 €
  const tauxChange = estUnNombreFini(tauxEnvoye) && tauxEnvoye !== prixActuel.tauxTva
  const tauxFinal  = tauxChange ? (tauxEnvoye as number) : prixActuel.tauxTva

  // Q20 au formulaire (décision de l'exploitant du 2026-10-06, revue du ticket 04) : un formulaire renvoie
  // toujours le TTC affiché. Taux changé et TTC renvoyé à l'identique = prix non touché, pas un nouveau
  // prix : le HT reste fixe, le TTC est recalculé au nouveau taux (branche « seul le taux change »).
  const ttcActuelConnu = estUnNombreFini(prixActuel.ttc)
  const ttcRenvoyeALIdentique = ttcActuelConnu && estUnNombreFini(prixTtcEnvoye) && prixTtcEnvoye === prixActuel.ttc
  const aucunHtEnvoye = !estUnNombreFini(prixHtEnvoye)
  if (tauxChange && ttcRenvoyeALIdentique && aucunHtEnvoye) {
    return { ttc: prixTtcDepuisHt(prixActuel.ht, tauxFinal), ht: prixActuel.ht }
  }

  // Un prix est envoyé : même règle qu'à la création, avec le taux final de la fiche
  const unPrixEstEnvoye = estUnNombreFini(prixTtcEnvoye) || estUnNombreFini(prixHtEnvoye)
  if (unPrixEstEnvoye) {
    return prixDeVenteACreer(prixTtcEnvoye, prixHtEnvoye, tauxFinal)
  }
  // Seul le taux change : le HT est gardé, le TTC recalculé (Q20)
  if (tauxChange) {
    return { ttc: prixTtcDepuisHt(prixActuel.ht, tauxFinal), ht: prixActuel.ht }
  }
  // Ni prix ni taux changé : rien ne change
  return null
}
