/**
 * lib/scan.ts — Routage d'un scan de douchette (chantier `vente-lit-catalogue`, ticket 04)
 *
 * Fonction pure, côté serveur : le navigateur envoie la saisie brute, le serveur décide de ce
 * qu'elle désigne. La caisse l'emploie aujourd'hui ; la page Tickets (parcours IMEI, ticket 08b)
 * passera par la même route.
 *
 * Règle (spec, décision « Recherche et scan ») : **par la longueur**, jamais par un préfixe —
 *   - exactement 13 chiffres → code-barres (EAN-13) ;
 *   - exactement 15 chiffres → IMEI ;
 *   - toute autre saisie     → recherche texte (12 et 14 chiffres compris : ni l'un ni l'autre).
 */

/** Ce qu'un scan désigne, et la valeur nettoyée à chercher. */
export type ScanRoute =
  | { type: 'code_barre'; valeur: string }
  | { type: 'imei';       valeur: string }
  | { type: 'texte';      valeur: string }

/**
 * Route une saisie de douchette (ou de clavier) selon sa longueur.
 *
 * Les espaces de bord sont retirés d'abord : la douchette termine par un retour chariot, et une
 * saisie collée peut porter des espaces.
 *
 * @param saisie Texte brut reçu
 * @returns      Type désigné et valeur nettoyée
 */
/**
 * Vrai si le texte est un IMEI : exactement 15 chiffres **et** clé de Luhn juste (ticket 07 pour la
 * fiche produit ; le ticket 08b la réutilise au scan). Un IMEI mal saisi est refusé avant toute
 * recherche (story 38). ⊥ une seconde implémentation ailleurs.
 *
 * Luhn : en partant de la droite, un chiffre sur deux (le 2ᵉ, le 4ᵉ…) est doublé, 9 retranché si
 * le double dépasse 9 ; la somme de tous les chiffres doit être un multiple de 10.
 *
 * @param texte Saisie à contrôler (non nettoyée : les espaces la rendent invalide)
 */
export function luhnValide(texte: string): boolean {
  if (!/^\d{15}$/.test(texte)) return false
  let somme = 0
  for (let i = 0; i < 15; i++) {
    let chiffre = Number(texte[14 - i])
    if (i % 2 === 1) { chiffre *= 2; if (chiffre > 9) chiffre -= 9 }
    somme += chiffre
  }
  return somme % 10 === 0
}

export function routerScan(saisie: string): ScanRoute {
  const valeur = saisie.trim()
  if (/^\d{13}$/.test(valeur)) return { type: 'code_barre', valeur }
  if (/^\d{15}$/.test(valeur)) return { type: 'imei', valeur }
  return { type: 'texte', valeur }
}
