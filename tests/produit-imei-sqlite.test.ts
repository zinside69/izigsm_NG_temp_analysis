import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { createProduit, updateProduit, ErreurCodeEnDoublon, ERREUR_IMEI_INVALIDE } from '../src/services/stockService'

/**
 * IMEI du produit (ticket 07 `vente-lit-catalogue`) : un téléphone d'occasion en vente porte son
 * IMEI dans sa fiche. Saisie validée (15 chiffres, clé de Luhn), doublon refusé en nommant la
 * fiche existante (un appareil = une fiche, décision de l'exploitant du 2026-09-30).
 *
 * Contre un vrai SQLite au schéma réel (toutes les migrations) : le refus du doublon vient de
 * l'index de 0054, qu'aucun mock n'applique.
 */

const IMEI = '356938035643809'

let base: BaseReelle
beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec("INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1'), (2, 'Boutique 2')")
})

const imeiDe = (id: number) => base.sqlite.prepare('SELECT imei FROM produits WHERE id = ?').get(id).imei

describe('createProduit() — IMEI', () => {
  it('enregistre un IMEI valide', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'iPhone 12 occasion', imei: IMEI, stock_minimum: 0 })
    expect(imeiDe(id)).toBe(IMEI)
  })

  it('refuse un IMEI à clé de Luhn fausse, rien n\'est créé', async () => {
    await expect(createProduit(base.d1, 1, 1, { nom: 'X', imei: '356938035643800', stock_minimum: 0 }))
      .rejects.toThrow(ERREUR_IMEI_INVALIDE)
    expect(base.sqlite.prepare('SELECT COUNT(*) AS n FROM produits').get().n).toBe(0)
  })

  it('refuse ce qui n\'a pas 15 chiffres', async () => {
    await expect(createProduit(base.d1, 1, 1, { nom: 'X', imei: '12345', stock_minimum: 0 }))
      .rejects.toThrow(ERREUR_IMEI_INVALIDE)
  })

  it('vide ou blanc → NULL', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'Sans IMEI', imei: '  ', stock_minimum: 0 })
    expect(imeiDe(id)).toBeNull()
  })

  it('doublon dans la boutique → ErreurCodeEnDoublon nommant la fiche existante', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'iPhone 12 noir', imei: IMEI, stock_minimum: 0 })
    const refus = await createProduit(base.d1, 1, 1, { nom: 'iPhone 12 bis', imei: IMEI, stock_minimum: 0 }).catch(e => e)
    expect(refus).toBeInstanceOf(ErreurCodeEnDoublon)
    expect(refus.champ).toBe('imei')
    expect(refus.produit).toEqual({ id, nom: 'iPhone 12 noir' })
    expect(refus.message).toMatch(/Cet IMEI est déjà utilisé par « iPhone 12 noir »/)
  })

  it('même IMEI dans une autre boutique → admis', async () => {
    await createProduit(base.d1, 1, 1, { nom: 'A', imei: IMEI, stock_minimum: 0 })
    await expect(createProduit(base.d1, 2, 1, { nom: 'B', imei: IMEI, stock_minimum: 0 })).resolves.toBeTruthy()
  })
})

describe('updateProduit() — IMEI', () => {
  it('pose, puis retire l\'IMEI (vide → NULL) ; absent du corps → inchangé', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'iPhone', stock_minimum: 0 })
    await updateProduit(base.d1, id, 1, { imei: IMEI })
    expect(imeiDe(id)).toBe(IMEI)
    await updateProduit(base.d1, id, 1, { nom: 'iPhone renommé' })
    expect(imeiDe(id)).toBe(IMEI)
    await updateProduit(base.d1, id, 1, { imei: '' })
    expect(imeiDe(id)).toBeNull()
  })

  it('refuse un IMEI invalide', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'iPhone', stock_minimum: 0 })
    await expect(updateProduit(base.d1, id, 1, { imei: '356938035643800' })).rejects.toThrow(ERREUR_IMEI_INVALIDE)
  })

  it('doublon → ErreurCodeEnDoublon nommant l\'autre fiche', async () => {
    const a = await createProduit(base.d1, 1, 1, { nom: 'Porteur', imei: IMEI, stock_minimum: 0 })
    const b = await createProduit(base.d1, 1, 1, { nom: 'Autre', stock_minimum: 0 })
    const refus = await updateProduit(base.d1, b.id, 1, { imei: IMEI }).catch(e => e)
    expect(refus).toBeInstanceOf(ErreurCodeEnDoublon)
    expect(refus.produit).toEqual({ id: a.id, nom: 'Porteur' })
  })
})
