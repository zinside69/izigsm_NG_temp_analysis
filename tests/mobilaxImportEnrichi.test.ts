/**
 * @file tests/mobilaxImportEnrichi.test.ts
 * @description Pièce importée — SKU, famille, catégorie, marque et gamme tirés de Mobilax
 * (décisions de l'exploitant du 2026-09-11, retour sur le ticket 04 en production).
 *
 * Seam : `importerProduitMobilax()`. Mêmes frontières simulées que `mobilaxService.test.ts` :
 * `fetch` (API Mobilax), port `Database` (mockDatabase), binding D1 (mockD1, `createProduit()`).
 *
 * Formes reprises des mesures réelles du 2026-09-11 :
 *   - `/products/:id/full` porte `categorie: { id, name }` (catégorie la plus fine), `models`
 *     (objet, ou tableau selon la doc) avec `brand_name`, `mobilax_brand: { name }` (la gamme) ;
 *   - `/catalog/categories` : `{ status, data: [{ id, id_parent, name }] }`, 1 570 entrées,
 *     racines « Pièces Détachées », « Accessoires… » (suffixe « test permission » en préprod),
 *     « Mobile », « Tablette d'écriture », « Informatique »…
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { createMockD1 } from './helpers/mockD1'
import { chiffrer } from '../src/lib/chiffrement'
import { importerProduitMobilax } from '../src/services/mobilaxService'

const CLE_CHIFFREMENT = 'c'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'
const BOUTIQUE = 1

const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'
const SQL_DOUBLON = 'SELECT id FROM produits WHERE boutique_id = ? AND fournisseur_id = ? AND reference_fournisseur = ? AND actif = 1 LIMIT 1'
const SQL_REGLAGES = 'SELECT * FROM boutique_settings WHERE boutique_id = ?'
const SQL_CATEGORIE = 'SELECT id FROM categories WHERE boutique_id = ? AND nom = ? AND actif = 1 LIMIT 1'
const SQL_CREER_CATEGORIE = 'INSERT INTO categories (boutique_id, nom, parent_id) VALUES (?, ?, ?) RETURNING id'
const SQL_INSERT_PRODUIT = 'INSERT INTO produits (boutique_id, categorie_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre, description, fournisseur_id, prix_achat_cump) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'

/** Extrait réduit de l'arbre réel des catégories Mobilax. */
const ARBRE = [
  { id: 6,   id_parent: null, name: 'Pièces Détachées' },
  { id: 8,   id_parent: 6,    name: 'Ecrans & Tactiles' },
  { id: 329, id_parent: 8,    name: 'Ecran Tactile Original Refurb (PIEC)' },
  { id: 46,  id_parent: null, name: 'Accessoires test permission' },
  { id: 50,  id_parent: 46,   name: 'Coques' },
  { id: 51,  id_parent: 50,   name: 'Coque Silicone' },
  { id: 143, id_parent: null, name: 'Mobile' },
  { id: 144, id_parent: 143,  name: 'iPhone reconditionné' },
  { id: 204, id_parent: null, name: 'Informatique' },
  { id: 205, id_parent: 204,  name: 'Câbles' },
]

const FICHE = {
  id: 10242, reference: 'ECRTAREAPPIPHNE12MNO', ean13: '3000000059487',
  name: 'Ecran Tactile Original Refurb (PIEC) Apple iPhone 12 Mini Noir',
  description: '<p>Qualité origine.</p>', price: 44.25,
  categorie: { id: 329, name: 'Ecran Tactile Original Refurb (PIEC)' },
  models: { id_serie: 1060, name: 'iPhone 12 Mini', brand_name: 'Apple' },
  mobilax_brand: { id: 4, name: 'Mobilax Repair', alias: 'repair' },
}

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } })
}

let db: ReturnType<typeof createMockDatabase>
let d1: ReturnType<typeof createMockD1>
let fetchMock: ReturnType<typeof vi.fn>
const kv = { async get() { return null }, async put() {}, async delete() {} }
const deps = () => ({ db, d1, kv, cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE })

/** Mobilax renvoie `fiche` sur `/full` ; l'arbre des catégories répond `arbre` (ou une panne). */
function mobilax(fiche: object, arbre: 'ok' | 'panne' = 'ok') {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
    if (url === `${BASE}/products/10242/full`) return json({ status: 'OK', data: fiche })
    if (url === `${BASE}/catalog/categories`)
      return arbre === 'ok' ? json({ status: 'OK', data: ARBRE }) : new Response('Bad Gateway', { status: 502 })
    return json({ status: 'NOT_FOUND' }, 404)
  })
}

/** Colonnes → valeurs de l'INSERT produit, lues dans le SQL. */
function insertProduit(): Record<string, unknown> {
  const appel = d1.__getCalls().find(c => c.sql.startsWith('INSERT INTO produits'))!
  const colonnes = /\(([^)]*)\)\s*VALUES/.exec(appel.sql)![1].split(',').map(s => s.trim())
  return Object.fromEntries(colonnes.map((col, i) => [col, appel.params[i]]))
}

beforeEach(async () => {
  db = createMockDatabase()
  d1 = createMockD1()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
  db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-test', CLE_CHIFFREMENT) })
  db.__setNotFound(SQL_DOUBLON)
  db.__setResponse(SQL_REGLAGES, null)
  db.__setNotFound(SQL_CATEGORIE)
  db.__setResponse(SQL_CREER_CATEGORIE, { id: 55 })
  d1.__setResponse(SQL_INSERT_PRODUIT, { id: 77 })
})
afterEach(() => vi.unstubAllGlobals())

describe('importerProduitMobilax() — fiche enrichie depuis Mobilax', () => {
  it('pièce détachée : SKU = EAN, famille pièce, catégorie existante réutilisée, marque de l\'appareil, gamme en tête des notes', async () => {
    db.__setResponse(SQL_CATEGORIE, { id: 12 })
    mobilax(FICHE)
    const r = await importerProduitMobilax(deps(), BOUTIQUE, 5, 10242)

    expect(r).toEqual({ ok: true, produit_id: 77 })
    const p = insertProduit()
    expect(p).toMatchObject({
      sku: '3000000059487', code_barre: '3000000059487', famille: 'piece',
      categorie_id: 12, marque: 'Apple', reference_fournisseur: 'ECRTAREAPPIPHNE12MNO',
    })
    expect(String(p.description)).toBe('Gamme Mobilax : Mobilax Repair\nQualité origine.')
    // Catégorie déjà présente : cherchée par son nom dans la boutique, pas recréée
    const lecture = db.__getCalls().find(c => c.sql.startsWith('SELECT id FROM categories'))!
    expect(lecture.params).toEqual([BOUTIQUE, 'Ecran Tactile Original Refurb (PIEC)'])
    expect(db.__getCalls().some(c => c.sql.startsWith('INSERT INTO categories'))).toBe(false)
  })

  it('accessoire : famille accessoire (racine « Accessoires… »), catégorie créée dans la boutique', async () => {
    mobilax({ ...FICHE, categorie: { id: 51, name: 'Coque Silicone' }, mobilax_brand: { name: 'Mobilax Protect' } })
    await importerProduitMobilax(deps(), BOUTIQUE, 5, 10242)

    expect(insertProduit()).toMatchObject({ famille: 'accessoire', categorie_id: 55 })
    const creation = db.__getCalls().find(c => c.sql.startsWith('INSERT INTO categories'))!
    expect(creation.params).toEqual([BOUTIQUE, 'Coque Silicone', null])
  })

  it.each([
    [144, 'iPhone reconditionné', 'appareil'],
    [205, 'Câbles', 'consommable'],
  ])('catégorie %i (« %s ») : famille %s', async (id, name, famille) => {
    mobilax({ ...FICHE, categorie: { id, name } })
    await importerProduitMobilax(deps(), BOUTIQUE, 5, 10242)
    expect(insertProduit()).toMatchObject({ famille })
  })

  it('arbre des catégories indisponible : l\'import passe quand même, en famille pièce', async () => {
    mobilax(FICHE, 'panne')
    const r = await importerProduitMobilax(deps(), BOUTIQUE, 5, 10242)
    expect(r).toMatchObject({ ok: true })
    expect(insertProduit()).toMatchObject({ famille: 'piece', marque: 'Apple' })
  })

  it('modèles fournis en tableau : marque du premier appareil compatible', async () => {
    mobilax({ ...FICHE, models: [{ brand_name: 'Samsung' }, { brand_name: 'Apple' }] })
    await importerProduitMobilax(deps(), BOUTIQUE, 5, 10242)
    expect(insertProduit()).toMatchObject({ marque: 'Samsung' })
  })

  it('ni gamme, ni description : notes vides plutôt qu\'une ligne « Gamme Mobilax : undefined »', async () => {
    mobilax({ ...FICHE, description: null, mobilax_brand: null })
    await importerProduitMobilax(deps(), BOUTIQUE, 5, 10242)
    expect(insertProduit().description).toBeNull()
  })
})
