import { describe, it, expect } from 'vitest'
import { cleEan13, estEan13Valide, codeMaison, ERREUR_CODE_MAISON_ID_INVALIDE } from '../src/lib/codeMaison'

/**
 * @file tests/codeMaison.test.ts
 * @description Fonctions pures du code maison (ticket 05 `vente-lit-catalogue`) : clé EAN-13,
 * validation, calcul du code. `4006381333931` est un EAN-13 réel (clé 1), utilisé comme fixture
 * connue plutôt qu'un code inventé.
 */

describe('cleEan13()', () => {
  it('calcule la clé d\'un EAN-13 réel connu', () => {
    expect(cleEan13('400638133393')).toBe(1)
  })

  it('calcule la clé sur un second EAN-13 réel connu (code-barres livre, préfixe 978)', () => {
    // 9782070360024 est un EAN-13 (ISBN-13) réel, clé 4
    expect(cleEan13('978207036002')).toBe(4)
  })

  it('rejette ce qui n\'est pas exactement 12 chiffres', () => {
    expect(() => cleEan13('12345')).toThrow()
    expect(() => cleEan13('1234567890123')).toThrow()
    expect(() => cleEan13('12345678901a')).toThrow()
  })
})

describe('estEan13Valide()', () => {
  it('accepte un EAN-13 réel à clé juste', () => {
    expect(estEan13Valide('4006381333931')).toBe(true)
  })

  it('refuse le même code avec une clé fausse', () => {
    expect(estEan13Valide('4006381333930')).toBe(false)
  })

  it('refuse ce qui n\'a pas exactement 13 chiffres', () => {
    expect(estEan13Valide('400638133393')).toBe(false)   // 12 chiffres
    expect(estEan13Valide('40063813339311')).toBe(false) // 14 chiffres
  })

  it('refuse un SKU libre (lettres)', () => {
    expect(estEan13Valide('ECR-IP12')).toBe(false)
  })

  it('refuse une chaîne vide', () => {
    expect(estEan13Valide('')).toBe(false)
  })
})

describe('codeMaison()', () => {
  it('produit : préfixe 21, 13 chiffres, EAN-13 valide', () => {
    const code = codeMaison(1, 42)
    expect(code).toHaveLength(13)
    expect(code.startsWith('21')).toBe(true)
    expect(code).toBe('210000000042' + cleEan13('210000000042'))
    expect(estEan13Valide(code)).toBe(true)
  })

  it('service : préfixe 22, 13 chiffres, EAN-13 valide', () => {
    const code = codeMaison(2, 42)
    expect(code).toHaveLength(13)
    expect(code.startsWith('22')).toBe(true)
    expect(estEan13Valide(code)).toBe(true)
  })

  it('identifiant complété sur 10 chiffres', () => {
    expect(codeMaison(1, 7)).toBe('210000000007' + cleEan13('210000000007'))
  })

  it('même identifiant, type différent → codes différents', () => {
    expect(codeMaison(1, 42)).not.toBe(codeMaison(2, 42))
  })

  it('identifiant au maximum autorisé (10 chiffres) accepté', () => {
    expect(() => codeMaison(1, 9_999_999_999)).not.toThrow()
    expect(codeMaison(1, 9_999_999_999)).toHaveLength(13)
  })

  it.each([0, -1, -42])('refuse un identifiant ≤ 0 (%s)', (id) => {
    expect(() => codeMaison(1, id)).toThrow(ERREUR_CODE_MAISON_ID_INVALIDE)
  })

  it('refuse un identifiant non entier', () => {
    expect(() => codeMaison(1, 1.5)).toThrow(ERREUR_CODE_MAISON_ID_INVALIDE)
  })

  it('refuse un identifiant de plus de 10 chiffres', () => {
    expect(() => codeMaison(1, 10_000_000_000)).toThrow(ERREUR_CODE_MAISON_ID_INVALIDE)
  })
})
