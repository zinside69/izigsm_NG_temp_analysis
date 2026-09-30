/**
 * @file tests/scan.test.ts
 * @description Routage d'un scan de douchette par sa longueur (ticket 04 `vente-lit-catalogue`,
 * décision « Recherche et scan » de la spec) : 13 chiffres → code-barres, 15 chiffres → IMEI,
 * toute autre saisie → recherche texte.
 */
import { describe, it, expect } from 'vitest'
import { routerScan } from '../src/lib/scan'

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
