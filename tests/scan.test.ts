/**
 * @file tests/scan.test.ts
 * @description Routage d'un scan de douchette par sa longueur (ticket 04 `vente-lit-catalogue`,
 * décision « Recherche et scan » de la spec) : 13 chiffres → code-barres, 15 chiffres → IMEI,
 * toute autre saisie → recherche texte.
 */
import { describe, it, expect } from 'vitest'
// AVANT (2026-09-30, ticket 07 — ajout de luhnValide()) : import { routerScan } from '../src/lib/scan'
import { routerScan, luhnValide } from '../src/lib/scan'

describe('routerScan() — routage d\'un scan par sa longueur', () => {
  it('13 chiffres → code-barres', () => {
    expect(routerScan('3760123456789')).toEqual({ type: 'code_barre', valeur: '3760123456789' })
  })

  it('15 chiffres → IMEI', () => {
    expect(routerScan('356938035643809')).toEqual({ type: 'imei', valeur: '356938035643809' })
  })

  it('12 et 14 chiffres → texte (ni EAN-13 ni IMEI)', () => {
    expect(routerScan('376012345678')).toEqual({ type: 'texte', valeur: '376012345678' })
    expect(routerScan('37601234567890')).toEqual({ type: 'texte', valeur: '37601234567890' })
  })

  it('lettres ou mélange → texte', () => {
    expect(routerScan('ECR-IP12')).toEqual({ type: 'texte', valeur: 'ECR-IP12' })
    expect(routerScan('376012345678A')).toEqual({ type: 'texte', valeur: '376012345678A' })
  })

  it('retire les espaces de bord avant de router (retour chariot compris)', () => {
    expect(routerScan('  3760123456789\r\n')).toEqual({ type: 'code_barre', valeur: '3760123456789' })
  })

  it('chaîne vide ou blanche → texte vide', () => {
    expect(routerScan('   ')).toEqual({ type: 'texte', valeur: '' })
  })
})

/**
 * Clé de Luhn d'un IMEI (ticket 07, réutilisée au scan par le ticket 08b). Valeurs de référence
 * indépendantes du code : IMEI d'exemple publiés (490154203237518, 356938035643809) et le même
 * numéro au dernier chiffre faussé.
 */
describe('luhnValide() — clé de contrôle d\'un IMEI', () => {
  it('accepte des IMEI à clé juste', () => {
    expect(luhnValide('490154203237518')).toBe(true)
    expect(luhnValide('356938035643809')).toBe(true)
  })

  it('refuse une clé fausse', () => {
    expect(luhnValide('490154203237519')).toBe(false)
    expect(luhnValide('356938035643800')).toBe(false)
  })

  it('refuse ce qui n\'a pas exactement 15 chiffres', () => {
    expect(luhnValide('49015420323751')).toBe(false)
    expect(luhnValide('4901542032375180')).toBe(false)
    expect(luhnValide('49015420323751A')).toBe(false)
    expect(luhnValide('')).toBe(false)
  })
})
