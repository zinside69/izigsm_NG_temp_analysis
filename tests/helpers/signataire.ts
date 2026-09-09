/**
 * @file tests/helpers/signataire.ts
 * @description Déclare QUI signe la pièce, pour les tests qui écrivent au registre légal.
 *
 * `assertPeutEcrireAuRegistre()` (`src/lib/nf525.ts`) lit en base l'identité du signataire
 * avant toute écriture au registre NF525, et refuse si la base ne retrouve personne
 * (décision du 2026-09-09). Un test qui appelle `createVente()`, `emettreFacture()`,
 * `createAvoir()`, `enregistrerEncaissement()` ou l'un des deux chemins composites doit
 * donc dire qui signe — comme en production, où c'est l'utilisateur connecté.
 *
 * **Appel explicite, jamais un défaut du mock.** Une réponse pré-enregistrée dans
 * `createMockD1()` ferait passer les tests sans qu'ils fournissent rien : la dépendance des
 * services envers `users`/`roles` deviendrait invisible, et une régression sur cette lecture
 * les laisserait verts. Le test doit refléter ce que le code fait vraiment.
 */

/** La requête exacte de `assertPeutEcrireAuRegistre()`. Une seule définition. */
export const SQL_SIGNATAIRE = `
    SELECT r.nom AS role, u.boutique_id
    FROM   users u JOIN roles r ON r.id = u.role_id
    WHERE  u.id = ?
  `

/** Signataire légitime par défaut : un manager de la boutique 1. */
export interface Signataire { role: string; boutique_id: number | null }

/**
 * Déclare le signataire que la base renverra à ce mock.
 *
 * @param db   mock D1 (`createMockD1()`) ou mock de port (`createMockDatabase()`)
 * @param qui  rôle et boutique — par défaut, un manager de la boutique 1
 */
export function avecSignataire(
  db: { __setResponse: (sql: string, value: unknown) => void },
  qui: Signataire = { role: 'manager', boutique_id: 1 }
): void {
  db.__setResponse(SQL_SIGNATAIRE, qui)
}

/** Déclare que la base ne retrouve AUCUN signataire — l'écriture doit être refusée. */
export function sansSignataire(
  db: { __setNotFound: (sql: string) => void }
): void {
  db.__setNotFound(SQL_SIGNATAIRE)
}
