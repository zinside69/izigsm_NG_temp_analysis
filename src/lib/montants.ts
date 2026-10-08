/**
 * @file src/lib/montants.ts
 * @description Conversions d'argent communes. Les comparaisons d'argent se font en centimes entiers,
 * jamais en virgule flottante (59,97 + 0,03 ≠ 60 en flottant).
 *
 * Mis en commun le 2026-10-08 (ticket 01 du chantier avoirs, revue) : `enCentimes()` vivait en copie
 * privée dans `caisseService.ts` et allait être recopiée dans `factureService.ts`.
 */

/** Un montant en euros converti en centimes entiers : 59,97 → 5997. */
export function enCentimes(montantEnEuros: number): number {
  return Math.round(montantEnEuros * 100)
}

/** Un montant en centimes, écrit en euros à la française : 2997 → « 29,97 € ». */
export function formaterCentimesEnEuros(montantEnCentimes: number): string {
  return `${(montantEnCentimes / 100).toFixed(2).replace('.', ',')} €`
}
