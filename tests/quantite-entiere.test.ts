import { describe, it, expect } from 'vitest'
import { quantiteLigneInvalide } from '../src/lib/validators'

/**
 * Quantité d'une ligne de vente, de devis, de facture ou d'avoir : nombre ENTIER ≥ 1
 * (décision de l'exploitant du 2026-10-02, recette 001 partie B — la caisse acceptait `0,98`).
 *
 * `quantiteLigneInvalide()` est le seul point de cette règle : les routes l'appellent AVANT toute
 * écriture, pour qu'une saisie refusée ne consomme aucun numéro ni aucune ligne du journal NF525.
 * Le refus réel des routes est prouvé contre la vraie D1 locale (`tests/e2e/quantite-entiere.spec.ts`).
 */

describe('quantiteLigneInvalide — entier ≥ 1', () => {
  it.each([1, 2, 37, '3'])('accepte %p', (q) => {
    expect(quantiteLigneInvalide([{ quantite: q }])).toBeNull()
  })

  it.each([0.98, 1.5, 0, -1, '0,98', '1.5', '', 'abc', null, undefined, true, NaN, Infinity])(
    'refuse %p',
    (q) => {
      expect(quantiteLigneInvalide([{ quantite: q }])).toMatch(/entier/)
    },
  )

  it('nomme la ligne fautive (numérotée à partir de 1)', () => {
    expect(quantiteLigneInvalide([{ quantite: 1 }, { quantite: 2 }, { quantite: 0.5 }]))
      .toMatch(/^Ligne 3 /)
  })

  it('aucune ligne → rien à dire (l\'obligation d\'au moins une ligne reste à l\'appelant)', () => {
    expect(quantiteLigneInvalide([])).toBeNull()
    expect(quantiteLigneInvalide(undefined)).toBeNull()
  })
})
