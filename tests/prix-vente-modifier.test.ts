import { describe, it, expect } from 'vitest'
import { prixDeVenteAModifier } from '../src/lib/prixVente'

/**
 * Prix de vente à la modification d'une fiche (pièce ou service) — décision Q20 de l'exploitant
 * (2026-10-04), précisée le 2026-10-06 (revue du ticket 04) : quand le taux de TVA change et que le
 * formulaire renvoie le **même** TTC qu'avant (prix non touché), ce n'est pas un nouveau prix : le HT
 * reste fixe et le TTC est recalculé au nouveau taux. Un TTC **différent** est un nouveau prix, qui
 * fait foi au nouveau taux.
 */
describe('prixDeVenteAModifier() — taux changé, TTC renvoyé à l\'identique', () => {
  const actuel = { ht: 100, ttc: 120, tauxTva: 20 }

  it('taux 20 → 10 %, TTC 120 renvoyé tel quel : HT 100 gardé, TTC recalculé 110', () => {
    expect(prixDeVenteAModifier(120, undefined, 10, actuel)).toEqual({ ht: 100, ttc: 110 })
  })

  it('taux 20 → 10 %, nouveau TTC 115 : il fait foi au nouveau taux (HT 104,55)', () => {
    expect(prixDeVenteAModifier(115, undefined, 10, actuel)).toEqual({ ht: 104.55, ttc: 115 })
  })

  it('taux inchangé, TTC renvoyé tel quel : rien ne change… sauf le TTC réécrit à l\'identique', () => {
    expect(prixDeVenteAModifier(120, undefined, 20, actuel)).toEqual({ ht: 100, ttc: 120 })
  })

  it('taux 20 → 10 % sans prix envoyé : HT gardé, TTC recalculé (Q20, inchangé)', () => {
    expect(prixDeVenteAModifier(undefined, undefined, 10, actuel)).toEqual({ ht: 100, ttc: 110 })
  })

  it('TTC actuel inconnu (appelant qui ne le fournit pas) : comportement antérieur, le TTC envoyé fait foi', () => {
    expect(prixDeVenteAModifier(120, undefined, 10, { ht: 100, tauxTva: 20 })).toEqual({ ht: 109.09, ttc: 120 })
  })
})
