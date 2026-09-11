/**
 * @file tests/mobilaxPagination.test.ts
 * @description Recherche Mobilax paginée — 100 résultats par page et navigation (décision de
 * l'exploitant du 2026-09-11 : « on doit avoir accès à tous les articles »).
 *
 * Mesuré le 2026-09-11 : `/products` accepte `limit=100` et renvoie `currentPage`, `totalPage`
 * (au singulier) et `total` ; « iphone 12 » = 5 095 pièces — tout charger d'un coup dépasserait
 * le quota (30/min), d'où une page par appel.
 *
 * Deux seams : le service (`fetch` simulé) et la route (`app.request`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import app from '../src/index'
import { createMockDatabase } from './helpers/mockDatabase'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'
import { chiffrer } from '../src/lib/chiffrement'
import { rechercherProduitsMobilax } from '../src/services/mobilaxService'

const CLE_CHIFFREMENT = 'd'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'
const SECRET = 'secret-de-test'
const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } })
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

/** Mobilax renvoie la page demandée d'un résultat de 5 095 pièces (51 pages de 100). */
function mobilaxPagine() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/auth')) return json({ token: 'jwt-1', expireIn: '1h' })
    const page = Number(new URL(url).searchParams.get('page') ?? 1)
    return json({ data: { currentPage: page, limit: 100, total: 5095, totalPage: 51,
      products: [{ id: 1000 + page, ean13: '3000000000001', name: `Pièce page ${page}`, quantity: 1, price: 9.9 }] } })
  })
}
const urlRecherche = () => String(fetchMock.mock.calls.find(([u]) => String(u).includes('/products?'))![0])

describe('rechercherProduitsMobilax() — pagination', () => {
  let db: ReturnType<typeof createMockDatabase>
  const kv = { async get() { return null }, async put() {}, async delete() {} }

  beforeEach(async () => {
    db = createMockDatabase()
    db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
    db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-test', CLE_CHIFFREMENT) })
  })

  it('demande 100 résultats de la page voulue, et dit combien de pages existent', async () => {
    mobilaxPagine()
    const r = await rechercherProduitsMobilax({ db, kv, cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE }, 1, 'iphone 12', 3)

    const params = new URL(urlRecherche()).searchParams
    expect(params.get('page')).toBe('3')
    expect(params.get('limit')).toBe('100')
    expect(r).toMatchObject({ ok: true, total: 5095, page: 3, pages: 51 })
    expect((r as any).produits[0].nom).toBe('Pièce page 3')
  })

  it('sans page demandée : la première', async () => {
    mobilaxPagine()
    const r = await rechercherProduitsMobilax({ db, kv, cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE }, 1, 'iphone 12')
    expect(new URL(urlRecherche()).searchParams.get('page')).toBe('1')
    expect(r).toMatchObject({ page: 1, pages: 51 })
  })
})

describe('GET /api/mobilax/produits — pagination', () => {
  async function chercher(chemin: string) {
    const d1 = createMockD1()
    d1.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
    d1.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-test', CLE_CHIFFREMENT) })
    const { accessToken } = await generateTokenPair(
      { id: 7, email: 'x@boutique.fr', prenom: 'X', nom: 'Test', role: 'manager', boutique_id: 1 } as any, SECRET)
    return app.request(chemin, { headers: { Authorization: `Bearer ${accessToken}` } },
      { DB: d1, JWT_SECRET: SECRET, FOURNISSEUR_CRYPTO_KEY: CLE_CHIFFREMENT, MOBILAX_API_BASE: BASE } as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any)
  }

  it('?page=2 : la page 2 est demandée à Mobilax, page et pages dans la réponse', async () => {
    mobilaxPagine()
    const res = await chercher('/api/mobilax/produits?q=iphone%2012&page=2')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { total: 5095, page: 2, pages: 51 } })
    expect(new URL(urlRecherche()).searchParams.get('page')).toBe('2')
  })

  it('page invalide : 400, Mobilax jamais appelé', async () => {
    for (const p of ['0', '-1', 'abc', '1.5']) {
      const res = await chercher(`/api/mobilax/produits?q=iphone&page=${p}`)
      expect(res.status, p).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
