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
export function routerScan(saisie: string): ScanRoute {
  const valeur = saisie.trim()
  if (/^\d{13}$/.test(valeur)) return { type: 'code_barre', valeur }
  if (/^\d{15}$/.test(valeur)) return { type: 'imei', valeur }
  return { type: 'texte', valeur }
}
