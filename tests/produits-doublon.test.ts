/**
 * @file tests/produits-doublon.test.ts
 * @description Doublon de code-barres ou de SKU — message qui nomme le produit existant
 * (ticket 01 du chantier `vente-lit-catalogue`, story 36).
 *
 * La migration 0048 fait refuser un doublon par la base. Sans conversion, l'opérateur voyait
 * une erreur SQLite brute (ou un 500). Ici : la création (`POST /api/produits`, contrat HTTP) et
 * la modification (`updateProduit()`) convertissent la violation en un refus qui **nomme** le
 * produit qui porte déjà le code.
 *
 * Base simulée : elle lève, sur l'écriture, le message **exact** que le vrai moteur SQLite
 * produit sur ces index — mesuré dans `produits-unicite-codes-migration.test.ts`, pas inventé.
 * La preuve contre la vraie base locale est portée par l'E2E du même ticket.
 */
import { describe, it, expect } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'
import { updateProduit, ErreurCodeEnDoublon } from '../src/services/stockService'

const SECRET = 'secret-de-test'

const SQL_INSERT_PRODUIT = 'INSERT INTO produits (boutique_id, categorie_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre, description, fournisseur_id, prix_achat_cump) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
const SQL_PORTEUR_CREATION = (champ: string) =>
  `SELECT id, nom FROM produits WHERE boutique_id = ? AND ${champ} = ? AND actif = 1 LIMIT 1`
const SQL_PORTEUR_MODIFICATION = (champ: string) =>
  `SELECT id, nom FROM produits WHERE boutique_id = (SELECT boutique_id FROM produits WHERE id = ?) AND ${champ} = ? AND actif = 1 AND id <> ? LIMIT 1`
const SQL_PRODUIT_ACTIF = 'SELECT id FROM produits WHERE id = ? AND actif = 1'
const SQL_UPDATE_PRODUIT = 'UPDATE produits SET nom = COALESCE(?, nom), sku = COALESCE(?, sku), marque = COALESCE(?, marque), categorie_id = COALESCE(?, categorie_id), famille = COALESCE(?, famille), prix_achat_ht= COALESCE(?, prix_achat_ht), prix_vente_ht= COALESCE(?, prix_vente_ht), tva_taux = COALESCE(?, tva_taux), stock_minimum= COALESCE(?, stock_minimum), fournisseur = COALESCE(?, fournisseur), code_barre = COALESCE(?, code_barre), description = COALESCE(?, description), updated_at = CURRENT_TIMESTAMP WHERE id = ?'

/** Messages du vrai moteur SQLite sur les index de 0048. */
const VIOLATION = {
  code_barre: 'D1_ERROR: UNIQUE constraint failed: produits.boutique_id, produits.code_barre: SQLITE_CONSTRAINT',
  sku:        'D1_ERROR: UNIQUE constraint failed: produits.boutique_id, produits.sku: SQLITE_CONSTRAINT',
}

/** `POST /api/produits` par un manager de la boutique 1. */
async function creer(corps: Record<string, unknown>, d1: ReturnType<typeof createMockD1>) {
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'gerant@boutique.fr', role: 'manager', boutique_id: 1, prenom: 'G', nom: 'Test' } as any,
    SECRET,
  )
  const res = await app.request(
    '/api/produits',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      // Seuil explicite : la création ne lit alors pas les réglages de la boutique
      body:    JSON.stringify({ stock_minimum: 0, ...corps }),
    },
    { DB: d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return res
}

describe('POST /api/produits — doublon de code', () => {
  it('refuse un code-barres déjà porté, en nommant le produit existant', async () => {
    const d1 = createMockD1()
    d1.__setResponseFn(SQL_INSERT_PRODUIT, () => { throw new Error(VIOLATION.code_barre) })
    d1.__setResponse(SQL_PORTEUR_CREATION('code_barre'), { id: 12, nom: 'Coque silicone iPhone 12' })

    const res = await creer({ nom: 'Doublon', code_barre: '3700275472140' }, d1)
    const corps = await res.json() as any

    expect(res.status).toBe(409)
    expect(corps.success).toBe(false)
    expect(corps.error).toBe('Ce code-barres est déjà utilisé par « Coque silicone iPhone 12 » (produit n° 12).')
    expect(corps.produit_id).toBe(12)
    expect(corps.champ).toBe('code_barre')
    // Le porteur est cherché dans la boutique de l'appelant, sur la valeur saisie
    const recherche = d1.__getCalls().find(c => c.sql === SQL_PORTEUR_CREATION('code_barre'))!
    expect(recherche.params).toEqual([1, '3700275472140'])
  })

  it('refuse un SKU déjà porté, en nommant le produit existant', async () => {
    const d1 = createMockD1()
    d1.__setResponseFn(SQL_INSERT_PRODUIT, () => { throw new Error(VIOLATION.sku) })
    d1.__setResponse(SQL_PORTEUR_CREATION('sku'), { id: 7, nom: 'Verre trempé' })

    const res = await creer({ nom: 'Doublon', sku: 'VT-IP12' }, d1)
    const corps = await res.json() as any

    expect(res.status).toBe(409)
    expect(corps.error).toBe('Ce SKU est déjà utilisé par « Verre trempé » (produit n° 7).')
    expect(corps.champ).toBe('sku')
  })

  it('ne transforme pas une autre erreur de la base en doublon', async () => {
    const d1 = createMockD1()
    d1.__setResponseFn(SQL_INSERT_PRODUIT, () => { throw new Error('D1_ERROR: no such column: foo') })

    const res = await creer({ nom: 'Produit', code_barre: '3700275472140' }, d1)

    expect(res.status).toBe(500)
    expect(d1.__getCalls().some(c => c.sql.startsWith('SELECT id, nom FROM produits'))).toBe(false)
  })
})

describe('updateProduit() — doublon de code', () => {
  function baseModification(violation: string, porteur: { id: number; nom: string } | null, champ: string) {
    const d1 = createMockD1()
    d1.__setResponse(SQL_PRODUIT_ACTIF, { id: 5 })
    d1.__setResponseFn(SQL_UPDATE_PRODUIT, () => { throw new Error(violation) })
    d1.__setResponse(SQL_PORTEUR_MODIFICATION(champ), porteur)
    return d1
  }

  it('refuse de donner à un produit le code-barres d\'un autre, en le nommant', async () => {
    const d1 = baseModification(VIOLATION.code_barre, { id: 12, nom: 'Coque silicone iPhone 12' }, 'code_barre')

    const echec = await updateProduit(d1 as any, 5, 7, { code_barre: '3700275472140' }).catch(e => e)

    expect(echec).toBeInstanceOf(ErreurCodeEnDoublon)
    expect(echec.message).toBe('Ce code-barres est déjà utilisé par « Coque silicone iPhone 12 » (produit n° 12).')
    expect(echec.champ).toBe('code_barre')
    expect(echec.produit).toEqual({ id: 12, nom: 'Coque silicone iPhone 12' })
    // Le produit modifié est exclu de la recherche du porteur
    const recherche = d1.__getCalls().find(c => c.sql === SQL_PORTEUR_MODIFICATION('code_barre'))!
    expect(recherche.params).toEqual([5, '3700275472140', 5])
  })

  it('refuse de donner à un produit le SKU d\'un autre', async () => {
    const d1 = baseModification(VIOLATION.sku, { id: 7, nom: 'Verre trempé' }, 'sku')

    const echec = await updateProduit(d1 as any, 5, 7, { sku: 'VT-IP12' }).catch(e => e)

    expect(echec).toBeInstanceOf(ErreurCodeEnDoublon)
    expect(echec.champ).toBe('sku')
  })

  it('relève l\'erreur d\'origine si le porteur n\'est plus trouvé', async () => {
    // Porteur supprimé entre l'écriture et la recherche : rien d'inventé, l'erreur remonte
    const d1 = baseModification(VIOLATION.code_barre, null, 'code_barre')

    const echec = await updateProduit(d1 as any, 5, 7, { code_barre: '3700275472140' }).catch(e => e)

    expect(echec).not.toBeInstanceOf(ErreurCodeEnDoublon)
    expect(echec.message).toBe(VIOLATION.code_barre)
  })
})
