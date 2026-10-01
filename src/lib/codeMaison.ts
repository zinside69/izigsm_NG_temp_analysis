/**
 * lib/codeMaison.ts — Fonctions pures du code maison (chantier `vente-lit-catalogue`, ticket 05)
 *
 * Un produit ou un service créé sans code-barres reçoit un code maison : un EAN-13 valide,
 * scannable comme n'importe quel article du commerce. Format : `2` + type (`1` produit,
 * `2` service) + identifiant sur 10 chiffres (complété par des zéros) + clé de contrôle EAN-13.
 * Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 24-29, décision « Codes maison »).
 */

/** `1` pour un produit, `2` pour un service — seul le préfixe du code maison en dépend. */
export type TypeCodeMaison = 1 | 2

/**
 * Chiffre de contrôle EAN-13 des 12 premiers chiffres (algorithme GS1 : poids 1/3 en alternance
 * depuis la gauche, complément à 10 du reste modulo 10).
 *
 * @param douzeChiffres  Exactement 12 chiffres
 * @returns              Le 13ᵉ chiffre (clé), de 0 à 9
 * @throws               Error si `douzeChiffres` n'est pas exactement 12 chiffres
 */
export function cleEan13(douzeChiffres: string): number {
  if (!/^\d{12}$/.test(douzeChiffres))
    throw new Error('cleEan13() attend exactement 12 chiffres.')

  let somme = 0
  for (let i = 0; i < 12; i++) {
    const chiffre = Number(douzeChiffres[i])
    somme += i % 2 === 0 ? chiffre : chiffre * 3
  }
  return (10 - (somme % 10)) % 10
}

/**
 * Vrai si `texte` est un EAN-13 valide : exactement 13 chiffres et clé de contrôle juste.
 *
 * @param texte  Code à contrôler
 */
export function estEan13Valide(texte: string): boolean {
  if (!/^\d{13}$/.test(texte)) return false
  return cleEan13(texte.slice(0, 12)) === Number(texte[12])
}

/** Refus de `codeMaison()` : l'identifiant ne peut pas être encodé sur 10 chiffres. */
export const ERREUR_CODE_MAISON_ID_INVALIDE =
  "codeMaison() : l'identifiant doit être un entier strictement positif d'au plus 10 chiffres."

/**
 * Calcule le code maison d'un produit ou d'un service : `2` + `type` + identifiant sur 10
 * chiffres (complété par des zéros à gauche) + clé de contrôle EAN-13. Toujours 13 chiffres, EAN-13
 * valide par construction.
 *
 * @param type  `1` (produit) ou `2` (service)
 * @param id    Identifiant en base — entier, strictement positif, au plus 10 chiffres
 * @returns     Code maison (13 chiffres)
 * @throws      Error(ERREUR_CODE_MAISON_ID_INVALIDE) si `id` n'est pas un entier > 0 ≤ 10 chiffres
 */
export function codeMaison(type: TypeCodeMaison, id: number): string {
  if (!Number.isInteger(id) || id <= 0 || String(id).length > 10)
    throw new Error(ERREUR_CODE_MAISON_ID_INVALIDE)

  const douzeChiffres = `2${type}${String(id).padStart(10, '0')}`
  return douzeChiffres + String(cleEan13(douzeChiffres))
}
