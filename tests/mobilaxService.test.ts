/**
 * @file tests/mobilaxService.test.ts
 * @description Tests unitaires — src/services/mobilaxService.ts (ticket 03, chantier
 * `integration-mobilax`).
 *
 * Seam : `rechercherProduitsMobilax()`. Frontières simulées, comme `phoneCatalogService` :
 *   - `fetch` global (jamais d'appel réseau réel en suite unitaire) — c'est l'API Mobilax ;
 *   - le port `Database` (mockDatabase) — la fiche fournisseur marquée « Mobilax » ;
 *   - le KV (Map en mémoire) — le jeton gardé entre deux recherches.
 * Le chiffrement, lui, est le vrai (`lib/chiffrement.ts`) : même parti pris que le ticket 01.
 *
 * Formes des réponses Mobilax reprises des mesures réelles du 2026-09-11 en préproduction
 * (`project-docs/recherche-api-mobilax-2026-09-09.md`) : `POST /auth` à plat
 * `{ token, refreshToken, expireIn: "1h" }`, `GET /products` sous `{ data: { total, products } }`,
 * produit `{ id, ean13, name, short_name, quantity, price, updated_at, main_image }`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { chiffrer } from '../src/lib/chiffrement'
import { rechercherProduitsMobilax, importerProduitMobilax } from '../src/services/mobilaxService'
import { createMockD1 } from './helpers/mockD1'

const CLE_CHIFFREMENT = 'a'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'
const BOUTIQUE = 1

/** SQL répliqués : le mock matche sur la requête exacte. */
const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'

/** KV en mémoire, même surface que D1KVNamespace. */
function kvMemoire() {
  const m = new Map<string, string>()
  return {
    async get(k: string) { return m.get(k) ?? null },
    async put(k: string, v: string, _o?: { expirationTtl?: number }) { m.set(k, v) },
    async delete(k: string) { m.delete(k) },
    __contenu: m,
  }
}

/** Réponse JSON avec en-têtes, comme l'API réelle. */
function json(corps: unknown, status = 200, entetes: Record<string, string> = {}) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...entetes } })
}

const PRODUIT_BRUT = {
  id: 10242, ean13: '3000000059487',
  name: 'Ecran Tactile Original Refurb (PIEC) Apple iPhone 12 Mini Noir',
  short_name: 'Ecran iPhone 12 Mini', quantity: 112, price: 44.25,
  updated_at: '2026-08-26T14:11:26.600Z', main_image: { image_id: 1 },
}

let db: ReturnType<typeof createMockDatabase>
let kv: ReturnType<typeof kvMemoire>
let fetchMock: ReturnType<typeof vi.fn>

async function fournisseurMobilaxAvecCle(cle = 'cle-mobilax-test') {
  db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, a_cle: 1 }])
  db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer(cle, CLE_CHIFFREMENT) })
}

const deps = () => ({ db, kv, cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE })

beforeEach(() => {
  db = createMockDatabase()
  kv = kvMemoire()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/** Mobilax répond normalement : auth (durée `expireIn`) puis recherche à un produit. */
function mobilaxRepondNormalement(expireIn: string = '1h') {
  let n = 0
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: `jwt-${++n}`, refreshToken: 'r', expireIn })
    if (url.startsWith(`${BASE}/products?`)) return json({ data: { total: 1, products: [PRODUIT_BRUT] } })
    throw new Error(`URL inattendue : ${url}`)
  })
}
const appelsAuth = () => fetchMock.mock.calls.filter(([u]) => u === `${BASE}/auth`).length

describe('rechercherProduitsMobilax() — jeton', () => {
  it('deux recherches ne coûtent qu\'une connexion (quota /auth : 10/min pour toute la boutique)', async () => {
    await fournisseurMobilaxAvecCle()
    mobilaxRepondNormalement('1h')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'batterie')
    expect(appelsAuth()).toBe(1)
  })

  it('le jeton gardé est chiffré, et vit la durée annoncée par expireIn (marge d\'une minute)', async () => {
    await fournisseurMobilaxAvecCle()
    mobilaxRepondNormalement('1h')
    const put = vi.spyOn(kv, 'put')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(put).toHaveBeenCalledTimes(1)
    const [, valeur, options] = put.mock.calls[0]
    expect(valeur).not.toContain('jwt-1')
    expect(options).toEqual({ expirationTtl: 3540 })
  })

  it('expireIn illisible : aucun jeton gardé, plutôt qu\'une durée inventée', async () => {
    await fournisseurMobilaxAvecCle()
    mobilaxRepondNormalement('bientôt')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'batterie')
    expect(appelsAuth()).toBe(2)
  })

  it('clé API changée entre deux recherches : le jeton de l\'ancienne clé n\'est pas réutilisé', async () => {
    await fournisseurMobilaxAvecCle('ancienne-cle')
    mobilaxRepondNormalement('1h')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    await fournisseurMobilaxAvecCle('nouvelle-cle')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(appelsAuth()).toBe(2)
  })
})

describe('rechercherProduitsMobilax() — jeton gardé mais expiré chez Mobilax', () => {
  const appelsRecherche = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(`${BASE}/products?`)).length

  /** Première recherche : garde jwt-1. Ensuite, Mobilax refuse jwt-1 (401) et accepte les suivants. */
  async function jetonGardePuisExpire(rejeteAussiLeNouveau = false) {
    await fournisseurMobilaxAvecCle()
    mobilaxRepondNormalement('1h')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')   // garde jwt-1
    fetchMock.mockClear()
    let n = 1
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `${BASE}/auth`) return json({ token: `jwt-${++n}`, expireIn: '1h' })
      const jwt = (init!.headers as Record<string, string>).Authorization
      if (jwt === 'Bearer jwt-1' || rejeteAussiLeNouveau)
        return json({ status: 'UNAUTHORIZED', message: 'Token expired' }, 401)
      return json({ data: { total: 1, products: [PRODUIT_BRUT] } })
    })
  }

  it('401 sur la recherche : une reconnexion, une nouvelle recherche, et le résultat', async () => {
    await jetonGardePuisExpire()
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: true, total: 1 })
    expect(appelsAuth()).toBe(1)
    expect(appelsRecherche()).toBe(2)
  })

  it('le nouveau jeton aussi refusé : on s\'arrête là, message sur la clé — pas de boucle', async () => {
    await jetonGardePuisExpire(true)
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'cle_refusee' })
    expect(appelsAuth()).toBe(1)
    expect(appelsRecherche()).toBe(2)
  })
})

describe('rechercherProduitsMobilax() — Mobilax refuse ou tombe', () => {
  const appelsRecherche = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(`${BASE}/products?`)).length

  it('quota de recherche atteint (429) : délai lu dans ratelimit-reset, aucune nouvelle tentative', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
      return json({ status: 'RATE_LIMITED', message: 'Limite atteinte sur /products' }, 429, { 'ratelimit-reset': '42' })
    })
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'quota', reessayer_dans_s: 42 })
    expect((r as any).message).toMatch(/42 s/)
    expect(appelsRecherche()).toBe(1)
  })

  it('quota de connexion atteint (429 sur /auth) : même signal, la recherche n\'est pas tentée', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockImplementation(async () =>
      json({ status: 'RATE_LIMITED', message: 'Limite atteinte sur /auth' }, 429))
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'quota' })
    expect(appelsRecherche()).toBe(0)
  })

  it('clé refusée par Mobilax (401 sur /auth) : message qui pointe la clé, pas une panne', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockImplementation(async () =>
      json({ status: 'UNAUTHORIZED', message: 'Invalid API key' }, 401))
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'cle_refusee' })
    expect((r as any).message).toMatch(/clé/)
  })

  it('Mobilax en panne (5xx) : indisponible', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
      return new Response('Bad Gateway', { status: 502 })
    })
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'indisponible' })
  })

  it('réponse 200 sans liste de produits : indisponible, jamais présentée comme « aucun résultat »', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' })
      : json({ status: 'OK', items: [] }))   // enveloppe inattendue : ni data, ni products
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'indisponible' })
  })

  it('produit sans identifiant exploitable : écarté plutôt que renvoyé avec un id NaN', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' })
      : json({ data: { total: '2', products: [PRODUIT_BRUT, { ...PRODUIT_BRUT, id: 'abc' }] } }))
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: true, total: 2 })
    expect((r as any).produits.map((p: any) => p.mobilax_id)).toEqual([10242])
  })

  it('clé API enregistrée indéchiffrable (secret tourné) : message sur la clé, jamais une exception', async () => {
    db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, a_cle: 1 }])
    db.__setResponse(SQL_CLE_API, { api_key_chiffree: '00:pas-du-chiffre' })
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'cle_illisible' })
    expect((r as any).message).toMatch(/clé/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('jeton gardé indéchiffrable : oublié, une reconnexion, et le résultat — pas une heure de panne', async () => {
    await fournisseurMobilaxAvecCle()
    mobilaxRepondNormalement('1h')
    await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')     // garde un jeton
    for (const k of kv.__contenu.keys()) kv.__contenu.set(k, '00:illisible')
    fetchMock.mockClear()
    mobilaxRepondNormalement('1h')
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: true, total: 1 })
    expect(fetchMock.mock.calls.filter(([u]) => u === `${BASE}/auth`)).toHaveLength(1)
  })

  it('réseau coupé (fetch lève) : indisponible, jamais une exception qui remonte', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'indisponible' })
  })
})

describe('rechercherProduitsMobilax()', () => {
  it('renvoie les produits trouvés, dans la forme normalisée d\'iziGSM', async () => {
    await fournisseurMobilaxAvecCle()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === `${BASE}/auth`) return json({ token: 'jwt-1', refreshToken: 'r-1', expireIn: '1h' })
      if (url.startsWith(`${BASE}/products?`)) return json({ data: { currentPage: 1, limit: 20, offset: 0, total: 1, totalPage: 1, products: [PRODUIT_BRUT] } })
      throw new Error(`URL inattendue : ${url}`)
    })

    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran iphone 12')

    expect(r).toEqual({
      ok: true, total: 1, page: 1, pages: 1,
      produits: [{ mobilax_id: 10242, nom: 'Ecran Tactile Original Refurb (PIEC) Apple iPhone 12 Mini Noir', ean13: '3000000059487', prix_achat_ht: 44.25, stock: 112 }],
    })
    // La recherche part vers Mobilax avec le terme encodé et le jeton obtenu
    const appelRecherche = fetchMock.mock.calls.find(([u]) => String(u).startsWith(`${BASE}/products?`))!
    expect(appelRecherche[0]).toContain('search=ecran%20iphone%2012')
    expect((appelRecherche[1]!.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
    // La clé envoyée à /auth est la clé déchiffrée de la boutique
    const appelAuth = fetchMock.mock.calls.find(([u]) => u === `${BASE}/auth`)!
    expect(JSON.parse(appelAuth[1]!.body as string)).toEqual({ apiKey: 'cle-mobilax-test' })
  })

  it('aucune fiche marquée Mobilax : message explicite, aucun appel à Mobilax', async () => {
    db.__setListResponse(SQL_FOURNISSEUR_API, [])
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'sans_fournisseur' })
    expect((r as any).message).toMatch(/Mobilax/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fiche marquée sans clé API : message explicite, aucun appel à Mobilax', async () => {
    db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, a_cle: 0 }])
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'sans_cle' })
    expect((r as any).message).toMatch(/clé/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('plusieurs fiches marquées Mobilax : ambigu, signalé plutôt que tranché au hasard', async () => {
    db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, a_cle: 1 }, { id: 8, a_cle: 1 }])
    const r = await rechercherProduitsMobilax(deps(), BOUTIQUE, 'ecran')
    expect(r).toMatchObject({ ok: false, erreur: 'plusieurs_fournisseurs' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// importerProduitMobilax() — ticket 04 : une pièce trouvée devient un produit du stock
// ════════════════════════════════════════════════════════════════════════════════
//
// Formes reprises des mesures réelles du 2026-09-11 : `GET /products/:id/full` répond
// `{ status: 'OK', data: { id, reference, ean13, name, description (HTML), price, quantity, … } }`,
// une pièce inexistante `404 { status: 'NOT_FOUND' }`. La référence n'existe que là.

const SQL_INSERT_PRODUIT = 'INSERT INTO produits (boutique_id, categorie_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre, description, fournisseur_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
const SQL_REGLAGES = 'SELECT * FROM boutique_settings WHERE boutique_id = ?'
const SQL_DOUBLON = 'SELECT id FROM produits WHERE boutique_id = ? AND fournisseur_id = ? AND reference_fournisseur = ? AND actif = 1 LIMIT 1'

const FICHE_COMPLETE = {
  id: 10242, reference: 'ECRTAREAPPIPHNE12MNO', ean13: '3000000059487',
  name: 'Ecran Tactile Original Refurb (PIEC) Apple iPhone 12 Mini Noir',
  description: '<h2><strong>Écran Tactile&nbsp;iPhone 12 Mini</strong></h2><p>Qualit&eacute; origine &amp; test&eacute;.</p>',
  price: 44.25, quantity: 112,
}

/** Colonnes → valeurs de l'INSERT produit, lues dans le SQL : indépendant de l'ordre. */
function insertProduit(d1: ReturnType<typeof createMockD1>): Record<string, unknown> | undefined {
  const appel = d1.__getCalls().find(c => c.sql.startsWith('INSERT INTO produits'))
  if (!appel) return undefined
  const colonnes = /\(([^)]*)\)\s*VALUES/.exec(appel.sql)![1].split(',').map(s => s.trim())
  return Object.fromEntries(colonnes.map((col, i) => [col, appel.params[i]]))
}

describe('importerProduitMobilax()', () => {
  let d1: ReturnType<typeof createMockD1>
  const depsImport = () => ({ ...deps(), d1 })

  beforeEach(async () => {
    d1 = createMockD1()
    d1.__setResponse(SQL_INSERT_PRODUIT, { id: 77 })
    db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
    db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-mobilax-test', CLE_CHIFFREMENT) })
    db.__setNotFound(SQL_DOUBLON)
    db.__setResponse(SQL_REGLAGES, { boutique_id: 1, marge_taux_defaut: 30, marge_taux_piece: null })
  })

  function mobilaxRenvoieLaFiche(fiche: object = FICHE_COMPLETE) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
      if (url === `${BASE}/products/10242/full`) return json({ status: 'OK', data: fiche })
      return json({ status: 'NOT_FOUND', message: 'Produit non trouvé' }, 404)
    })
  }

  it('crée le produit à partir de la fiche relue chez Mobilax, lié à sa source', async () => {
    mobilaxRenvoieLaFiche()
    const r = await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 10242)

    expect(r).toEqual({ ok: true, produit_id: 77 })
    expect(insertProduit(d1)).toMatchObject({
      boutique_id:           BOUTIQUE,
      nom:                   'Ecran Tactile Original Refurb (PIEC) Apple iPhone 12 Mini Noir',
      description:           'Écran Tactile iPhone 12 Mini\nQualité origine & testé.',
      famille:               'piece',
      prix_achat_ht:         44.25,
      prix_vente_ht:         57.53,          // 44,25 × 1,30 (marge par défaut de la boutique)
      stock_actuel:          0,
      stock_minimum:         0,              // aucune alerte « sous le seuil » dès l'import
      fournisseur:           'MOBILAX',
      fournisseur_id:        3,
      reference_fournisseur: 'ECRTAREAPPIPHNE12MNO',
      code_barre:            '3000000059487',
    })
  })
  it('boutique sans aucun taux de marge : prix de vente 0, jamais une marge inventée', async () => {
    db.__setResponse(SQL_REGLAGES, { boutique_id: 1, marge_taux_defaut: null, marge_taux_piece: null })
    mobilaxRenvoieLaFiche()
    await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 10242)
    expect(insertProduit(d1)).toMatchObject({ prix_achat_ht: 44.25, prix_vente_ht: 0 })
  })

  it('taux propre à la famille « pièce » : il l\'emporte sur le défaut de la boutique', async () => {
    db.__setResponse(SQL_REGLAGES, { boutique_id: 1, marge_taux_defaut: 30, marge_taux_piece: 100 })
    mobilaxRenvoieLaFiche()
    await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 10242)
    expect(insertProduit(d1)).toMatchObject({ prix_vente_ht: 88.5 })
  })

  it('pièce déjà importée : refusée avec le produit existant, aucun second produit', async () => {
    db.__setResponse(SQL_DOUBLON, { id: 41 })
    mobilaxRenvoieLaFiche()
    const r = await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 10242)
    expect(r).toMatchObject({ ok: false, erreur: 'deja_importe', produit_id: 41 })
    expect(insertProduit(d1)).toBeUndefined()
    // Le doublon se cherche sur la boutique, la fiche Mobilax et la VRAIE référence
    const recherche = db.__getCalls().find(c => c.sql.startsWith('SELECT id FROM produits'))!
    expect(recherche.params).toEqual([BOUTIQUE, 3, 'ECRTAREAPPIPHNE12MNO'])
  })

  it('pièce inconnue chez Mobilax (404) : introuvable, aucun produit', async () => {
    mobilaxRenvoieLaFiche()
    const r = await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 999999)
    expect(r).toMatchObject({ ok: false, erreur: 'introuvable' })
    expect(insertProduit(d1)).toBeUndefined()
  })

  it('quota Mobilax atteint : même signal que la recherche, aucun produit', async () => {
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' })
      : json({ status: 'RATE_LIMITED' }, 429, { 'ratelimit-reset': '12' }))
    const r = await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 10242)
    expect(r).toMatchObject({ ok: false, erreur: 'quota', reessayer_dans_s: 12 })
    expect(insertProduit(d1)).toBeUndefined()
  })

  it('description piégée : aucune balise ne renaît du décodage des entités, hexadécimales comprises', async () => {
    mobilaxRenvoieLaFiche({ ...FICHE_COMPLETE,
      description: '<p>Écran &lt;img src=x onerror=alert(1)&gt; &#x3C;script&#x3E;x&#x3C;/script&#x3E; fin</p>' })
    await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 10242)
    const description = String(insertProduit(d1)!.description)
    expect(description).not.toMatch(/[<>]/)
    expect(description).toContain('Écran')
    expect(description).toContain('fin')
  })

  it('aucune fiche Mobilax : message explicite, Mobilax jamais appelé', async () => {
    db.__setListResponse(SQL_FOURNISSEUR_API, [])
    const r = await importerProduitMobilax(depsImport(), BOUTIQUE, 5, 10242)
    expect(r).toMatchObject({ ok: false, erreur: 'sans_fournisseur' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
