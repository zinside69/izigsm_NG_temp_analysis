import { describe, it, expect } from 'vitest'
import { champEnDoublon, messageCodeEnDoublon } from '../src/services/stockService'

/**
 * Doublon de code-barres ou de SKU — lecture de l'erreur SQLite (ticket 01 `vente-lit-catalogue`).
 *
 * Les messages attendus sont ceux que le vrai moteur SQLite produit sur les index de la migration
 * 0048 — mesurés dans `produits-unicite-codes-migration.test.ts`, pas recopiés du code.
 */

describe('champEnDoublon()', () => {
  it('reconnaît un doublon de code-barres', () => {
    const err = new Error('UNIQUE constraint failed: produits.boutique_id, produits.code_barre')
    expect(champEnDoublon(err)).toBe('code_barre')
  })

  it('reconnaît un doublon de SKU', () => {
    const err = new Error('UNIQUE constraint failed: produits.boutique_id, produits.sku')
    expect(champEnDoublon(err)).toBe('sku')
  })

  it('reconnaît le message tel que D1 l\'enveloppe', () => {
    // D1 préfixe le message du moteur : la lecture ne doit pas dépendre du début de la chaîne
    const err = new Error('D1_ERROR: UNIQUE constraint failed: produits.boutique_id, produits.code_barre: SQLITE_CONSTRAINT')
    expect(champEnDoublon(err)).toBe('code_barre')
  })

  it('ne confond pas la contrainte de l\'import fournisseur avec un doublon de code', () => {
    // Index 0046 : même pièce fournisseur deux fois — c'est `deja_importe`, pas un doublon de code
    const err = new Error('UNIQUE constraint failed: produits.boutique_id, produits.fournisseur_id, produits.reference_fournisseur')
    expect(champEnDoublon(err)).toBeNull()
  })

  it('rend null pour toute autre erreur', () => {
    expect(champEnDoublon(new Error('no such column: foo'))).toBeNull()
    expect(champEnDoublon('pas une erreur')).toBeNull()
    expect(champEnDoublon(undefined)).toBeNull()
  })
})

describe('messageCodeEnDoublon()', () => {
  it('nomme le produit qui porte déjà le code-barres', () => {
    expect(messageCodeEnDoublon('code_barre', { id: 12, nom: 'Coque silicone iPhone 12' }))
      .toBe('Ce code-barres est déjà utilisé par « Coque silicone iPhone 12 » (produit n° 12).')
  })

  it('nomme le produit qui porte déjà le SKU', () => {
    expect(messageCodeEnDoublon('sku', { id: 7, nom: 'Verre trempé' }))
      .toBe('Ce SKU est déjà utilisé par « Verre trempé » (produit n° 7).')
  })
})
