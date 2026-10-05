import { describe, it, expect } from 'vitest'
import { calculLigne, calculLignes } from '../src/lib/db'

/**
 * Une ligne de document se calcule à partir du TTC (ticket 02 du chantier prix TTC, décision Q2 de
 * l'exploitant du 2026-10-04) : total TTC de la ligne = prix unitaire TTC × quantité, arrondi au
 * centime ; le HT en est extrait (TTC ÷ (1 + taux), au centime) ; la TVA est la différence. Le client
 * paie exactement le prix affiché multiplié par la quantité.
 *
 * Une ligne sans prix TTC (devis, factures, avoirs — ticket 03 ; anciennes pages de caisse) garde le
 * calcul d'avant : HT × quantité, puis TVA sur le HT.
 *
 * Montants attendus calculés à la main.
 */

describe('calculLigne() — ligne calculée depuis le TTC', () => {
  it('19,99 € TTC × 3 à 20 % → 59,97 € TTC (et non 59,98 €), dont 49,98 € HT et 9,99 € de TVA', () => {
    expect(calculLigne({ quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 })).toEqual({ ht: 49.98, tva: 9.99, ttc: 59.97 })
  })

  it('9,90 € TTC × 1 à 20 % → 8,25 € HT, 1,65 € de TVA', () => {
    expect(calculLigne({ quantite: 1, prix_unitaire_ttc: 9.9, tva_taux: 20 })).toEqual({ ht: 8.25, tva: 1.65, ttc: 9.9 })
  })

  it('10,55 € TTC × 2 à 5,5 % → 21,10 € TTC, 20,00 € HT, 1,10 € de TVA', () => {
    expect(calculLigne({ quantite: 2, prix_unitaire_ttc: 10.55, tva_taux: 5.5 })).toEqual({ ht: 20, tva: 1.1, ttc: 21.1 })
  })
})

describe('calculLigne() — ligne sans prix TTC : calcul d\'avant, depuis le HT', () => {
  it('16,66 € HT × 3 à 20 % → 49,98 € HT, 10,00 € de TVA, 59,98 € TTC', () => {
    expect(calculLigne({ quantite: 3, prix_unitaire_ht: 16.66, tva_taux: 20 })).toEqual({ ht: 49.98, tva: 10, ttc: 59.98 })
  })
})

describe('calculLignes() — totaux d\'un document', () => {
  it('lignes TTC à plusieurs taux : somme des lignes', () => {
    expect(calculLignes([
      { quantite: 1, prix_unitaire_ttc: 9.9,   tva_taux: 20 },
      { quantite: 2, prix_unitaire_ttc: 10.55, tva_taux: 5.5 },
    ])).toEqual({ total_ht: 28.25, total_tva: 2.75, total_ttc: 31 })
  })

  it('lignes en HT seules : totaux inchangés (devis, factures, avoirs)', () => {
    expect(calculLignes([
      { quantite: 3, prix_unitaire_ht: 10, tva_taux: 20 },
      { quantite: 1, prix_unitaire_ht: 8.25, tva_taux: 20 },
    ])).toEqual({ total_ht: 38.25, total_tva: 7.65, total_ttc: 45.9 })
  })
})
