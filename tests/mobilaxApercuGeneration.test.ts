/**
 * @file tests/mobilaxApercuGeneration.test.ts
 * @description Tests unitaires — `apercuGeneration()` (ticket 02, chantier
 * `import-par-generation`) : pour les séries cochées, les articles fournisseur de chacune,
 * dédoublonnés entre séries, et ceux déjà dans le stock de la boutique.
 *
 * Seam : le service Mobilax, fournisseur simulé à sa frontière HTTP (`fetch` global), base
 * simulée (port `Database`). Forme de `GET /products/search?seriesId=` reprise de la mesure
 * réelle du 2026-09-12 (`recherche-api-mobilax-2026-09-09.md` v1.5) : liste sous
 * **`data.products`**, `{ currentPage, limit, total, totalPage }`, articles
 * `{ id, reference, ean13, name, short_name, quantity, price, main_image }` — référence présente,
 * catégorie absente. Une page = un appel au quota `/products` (30/min).
 *
 * « Déjà dans le stock » : même clé que l'anti-doublon de l'import (boutique, fiche fournisseur,
 * référence), lue en base — **aucun appel de fiche** chez Mobilax.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { chiffrer } from '../src/lib/chiffrement'
import { apercuGeneration } from '../src/services/mobilaxService'

const CLE_CHIFFREMENT = 'a'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'
const BOUTIQUE = 1

const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'
const SQL_REFERENCES = 'SELECT reference_fournisseur FROM produits WHERE boutique_id = ? AND fournisseur_id = ? AND actif = 1 AND reference_fournisseur IS NOT NULL'

function kvMemoire() {
  const m = new Map<string, string>()
  return {
    async get(k: string) { return m.get(k) ?? null },
    async put(k: string, v: string) { m.set(k, v) },
    async delete(k: string) { m.delete(k) },
  }
}

function json(corps: unknown, status = 200, entetes: Record<string, string> = {}) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...entetes } })
}

/** Article brut de la recherche par série. */
const article = (id: number, reference: string | null = `REF-${id}`) =>
  ({ id, reference, ean13: `30000000${id}`, name: `Article ${id}`, short_name: `A${id}`, quantity: 3, price: 9.9, main_image: null })

/** Page de la recherche par série, forme mesurée. */
const page = (products: unknown[], currentPage = 1, totalPage = 1) =>
  ({ data: { currentPage, limit: 100, total: products.length, totalPage, products } })

let db: ReturnType<typeof createMockDatabase>
let fetchMock: ReturnType<typeof vi.fn>
const deps = () => ({ db, kv: kvMemoire(), cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE })

beforeEach(async () => {
  db = createMockDatabase()
  db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
  db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-mobilax-test', CLE_CHIFFREMENT) })
  db.__setListResponse(SQL_REFERENCES, [])
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/**
 * Mobilax répond : connexion, puis `pages[seriesId][n-1]` pour la page n de chaque série.
 * Toute autre URL fait échouer le test (aucun appel de fiche attendu).
 */
function mobilaxRepond(pages: Record<number, unknown[]>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
    const m = /\/products\/search\?seriesId=(\d+)&page=(\d+)&limit=100$/.exec(url)
    const reponse = m && pages[Number(m[1])]?.[Number(m[2]) - 1]
    if (reponse) return json(reponse)
    throw new Error(`URL inattendue : ${url}`)
  })
}
const appelsRecherche = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/products/search')).length

describe('apercuGeneration() — articles des séries', () => {
  it('lit toutes les pages d\'une série (100 par page) — une page = un appel', async () => {
    mobilaxRepond({ 2358: [page([article(1), article(2)], 1, 2), page([article(3)], 2, 2)] })
    const r = await apercuGeneration(deps(), BOUTIQUE, [2358])
    expect(r).toMatchObject({ ok: true, series: [{ id: 2358, nb_articles: 3 }] })
    if (!r.ok) return
    expect(r.articles.map(a => a.mobilax_id)).toEqual([1, 2, 3])
    expect(appelsRecherche()).toBe(2)
  })

  it('article commun à deux séries : compté dans chacune, présent une seule fois au global', async () => {
    mobilaxRepond({
      2358: [page([article(1), article(2)])],
      2360: [page([article(2), article(4)])],
    })
    const r = await apercuGeneration(deps(), BOUTIQUE, [2358, 2360])
    expect(r).toMatchObject({ ok: true, series: [{ id: 2358, nb_articles: 2 }, { id: 2360, nb_articles: 2 }] })
    if (!r.ok) return
    expect(r.articles).toHaveLength(3)
    expect(r.articles.find(a => a.mobilax_id === 2)).toMatchObject({ series: [2358, 2360] })
  })

  it('sortie normalisée : identifiant, référence, nom, séries, déjà dans le stock', async () => {
    mobilaxRepond({ 2358: [page([article(1)])] })
    const r = await apercuGeneration(deps(), BOUTIQUE, [2358])
    expect(r).toEqual({
      ok: true,
      // Fiche fournisseur de la boutique : le bilan de l'import y renvoie (ticket 03)
      fournisseur_id: 3,
      series: [{ id: 2358, nb_articles: 1 }],
      articles: [{ mobilax_id: 1, reference: 'REF-1', nom: 'Article 1', series: [2358], deja_en_stock: false }],
    })
  })

  it('série demandée deux fois : lue une seule fois', async () => {
    mobilaxRepond({ 2358: [page([article(1)])] })
    const r = await apercuGeneration(deps(), BOUTIQUE, [2358, 2358])
    expect(r).toMatchObject({ ok: true, series: [{ id: 2358, nb_articles: 1 }] })
    expect(appelsRecherche()).toBe(1)
  })

  it('aucune série demandée : aperçu vide, Mobilax jamais appelé', async () => {
    expect(await apercuGeneration(deps(), BOUTIQUE, [])).toEqual({ ok: true, fournisseur_id: 3, series: [], articles: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('apercuGeneration() — déjà dans le stock', () => {
  it('référence déjà portée par un produit actif de la fiche Mobilax de la boutique', async () => {
    db.__setListResponse(SQL_REFERENCES, [{ reference_fournisseur: 'REF-2' }])
    mobilaxRepond({ 2358: [page([article(1), article(2)])] })
    const r = await apercuGeneration(deps(), BOUTIQUE, [2358])
    if (!r.ok) throw new Error('aperçu attendu')
    expect(r.articles.map(a => [a.mobilax_id, a.deja_en_stock])).toEqual([[1, false], [2, true]])
    // Clé de l'anti-doublon : CETTE boutique, CETTE fiche fournisseur
    const lecture = db.__getCalls().find(c => c.sql.includes('reference_fournisseur IS NOT NULL'))!
    expect(lecture.params).toEqual([BOUTIQUE, 3])
  })

  it('référence absente de la liste : l\'identifiant la remplace, comme à l\'import', async () => {
    db.__setListResponse(SQL_REFERENCES, [{ reference_fournisseur: '7' }])
    mobilaxRepond({ 2358: [page([article(7, null)])] })
    const r = await apercuGeneration(deps(), BOUTIQUE, [2358])
    expect(r).toMatchObject({ ok: true, articles: [{ mobilax_id: 7, reference: '7', deja_en_stock: true }] })
  })

  it('aucun appel de fiche : seules la connexion et les recherches par série partent', async () => {
    mobilaxRepond({ 2358: [page([article(1)])] })
    await apercuGeneration(deps(), BOUTIQUE, [2358])
    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls.every(u => u === `${BASE}/auth` || u.includes('/products/search?seriesId='))).toBe(true)
  })
})

describe('apercuGeneration() — fournisseur', () => {
  it('quota atteint en cours de lecture : signal quota avec le délai annoncé, aucun aperçu partiel', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
      if (url.includes('page=1')) return json(page([article(1)], 1, 2))
      return json({ status: 'RATE_LIMITED' }, 429, { 'ratelimit-reset': '42' })
    })
    expect(await apercuGeneration(deps(), BOUTIQUE, [2358]))
      .toMatchObject({ ok: false, erreur: 'quota', reessayer_dans_s: 42 })
  })

  it('liste rangée ailleurs que sous data.products : indisponible, jamais « aucun article »', async () => {
    mobilaxRepond({ 2358: [{ data: [article(1)] }] })
    expect(await apercuGeneration(deps(), BOUTIQUE, [2358])).toMatchObject({ ok: false, erreur: 'indisponible' })
  })

  it('Mobilax en panne (5xx) : indisponible', async () => {
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' }) : json({}, 503))
    expect(await apercuGeneration(deps(), BOUTIQUE, [2358])).toMatchObject({ ok: false, erreur: 'indisponible' })
  })

  it('aucun fournisseur connecté : échec nommé, Mobilax jamais appelé', async () => {
    db.__setListResponse(SQL_FOURNISSEUR_API, [])
    expect(await apercuGeneration(deps(), BOUTIQUE, [2358])).toMatchObject({ ok: false, erreur: 'sans_fournisseur' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
