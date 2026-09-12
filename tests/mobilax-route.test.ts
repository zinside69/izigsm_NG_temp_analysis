/**
 * @file tests/mobilax-route.test.ts
 * @description `GET /api/mobilax/produits?q=` — la recherche Mobilax exposée à l'écran
 * (ticket 03, chantier `integration-mobilax`).
 *
 * Contre l'application réelle (`app.request`), base simulée, `fetch` simulé : ce qui est
 * vérifié ici est le contrat HTTP — qui a le droit de chercher, avec la clé de QUELLE
 * boutique, et comment chaque issue du service devient un statut et un corps.
 *
 * Isolation : la boutique vient du jeton de connexion, jamais d'un paramètre. Un
 * `?boutique_id=` est ignoré — même pour un admin de boutique, dont `getBoutiqueId()`
 * honorerait le paramètre (CLAUDE.md § checkpoint 73). Et l'admin plateforme est refusé :
 * il ne doit jamais pouvoir utiliser la clé Mobilax d'une boutique cliente (spec, story 3).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'
import { chiffrer } from '../src/lib/chiffrement'

const SECRET = 'secret-de-test'
const CLE_CHIFFREMENT = 'b'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'

const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

function json(corps: unknown, status = 200, entetes: Record<string, string> = {}) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...entetes } })
}

/** Appel authentifié ; la boutique 1 porte une fiche Mobilax avec clé, sauf `sansFiche`. */
async function chercher(
  compte: { role: string; boutique_id: number | null },
  chemin: string,
  { sansFiche = false }: { sansFiche?: boolean } = {},
) {
  const d1 = createMockD1()
  d1.__setListResponse(SQL_FOURNISSEUR_API, sansFiche ? [] : [{ id: 3, a_cle: 1 }])
  d1.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-boutique-1', CLE_CHIFFREMENT) })
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'x@boutique.fr', prenom: 'X', nom: 'Test', ...compte } as any, SECRET,
  )
  const res = await app.request(
    chemin,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { DB: d1, JWT_SECRET: SECRET, FOURNISSEUR_CRYPTO_KEY: CLE_CHIFFREMENT, MOBILAX_API_BASE: BASE } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return { res, d1 }
}

function mobilaxRepond() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
    return json({ data: { total: 1, products: [{ id: 17, ean13: '3000000000017', name: 'Batterie test', quantity: 10, price: 8.68 }] } })
  })
}

describe('GET /api/mobilax/produits', () => {
  it('manager : résultats normalisés dans l\'enveloppe du dépôt', async () => {
    mobilaxRepond()
    const { res } = await chercher({ role: 'manager', boutique_id: 1 }, '/api/mobilax/produits?q=batterie')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      data: { total: 1, page: 1, pages: 1, produits: [{ mobilax_id: 17, nom: 'Batterie test', ean13: '3000000000017', prix_achat_ht: 8.68, stock: 10 }] },
    })
  })

  it('la clé utilisée est celle de la boutique du jeton — ?boutique_id= est ignoré', async () => {
    mobilaxRepond()
    const { res, d1 } = await chercher({ role: 'admin', boutique_id: 1 }, '/api/mobilax/produits?q=batterie&boutique_id=99')
    expect(res.status).toBe(200)
    const lecture = d1.__getCalls().find(c => c.sql.includes('api_plateforme = ?'))!
    expect(lecture.params[0]).toBe(1)
  })

  it('admin plateforme : refusé, Mobilax jamais appelé', async () => {
    const { res } = await chercher({ role: 'admin', boutique_id: null }, '/api/mobilax/produits?q=batterie&boutique_id=1')
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('terme absent ou trop court : 400, Mobilax jamais appelé', async () => {
    for (const chemin of ['/api/mobilax/produits', '/api/mobilax/produits?q=a', '/api/mobilax/produits?q=%20%20']) {
      const { res } = await chercher({ role: 'manager', boutique_id: 1 }, chemin)
      expect(res.status, chemin).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('quota Mobilax atteint : 429 avec le code et le délai', async () => {
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' })
      : json({ status: 'RATE_LIMITED' }, 429, { 'ratelimit-reset': '30' }))
    const { res } = await chercher({ role: 'manager', boutique_id: 1 }, '/api/mobilax/produits?q=batterie')
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ success: false, code: 'quota', reessayer_dans_s: 30 })
  })

  it('aucune fiche Mobilax : 422 avec un code, distinct d\'une panne', async () => {
    const { res } = await chercher({ role: 'manager', boutique_id: 1 }, '/api/mobilax/produits?q=batterie', { sansFiche: true })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ success: false, code: 'sans_fournisseur' })
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/mobilax/import — ticket 04 : une pièce trouvée devient un produit du stock
// ════════════════════════════════════════════════════════════════════════════════
//
// L'identifiant Mobilax voyage dans le CORPS, pas dans l'URL : ce n'est pas une ressource
// locale, la garde d'isolation des routes par ID n'a pas à le prendre pour un produit du dépôt.
// Import fermé à l'admin plateforme, y compris après l'ouverture de la recherche en
// supervision (décision du 2026-09-11 : la plateforme ne fait pas de commerce).

const SQL_INSERT_PRODUIT = 'INSERT INTO produits (boutique_id, categorie_id, sku, nom, marque, famille, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum, fournisseur, reference_fournisseur, code_barre, description, fournisseur_id, prix_achat_cump) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
const SQL_DOUBLON = 'SELECT id FROM produits WHERE boutique_id = ? AND fournisseur_id = ? AND reference_fournisseur = ? AND actif = 1 LIMIT 1'

async function importer(
  compte: { role: string; boutique_id: number | null },
  corps: unknown,
  { doublon = false }: { doublon?: boolean } = {},
) {
  const d1 = createMockD1()
  d1.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
  d1.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-boutique-1', CLE_CHIFFREMENT) })
  d1.__setResponse(SQL_INSERT_PRODUIT, { id: 88 })
  if (doublon) d1.__setResponse(SQL_DOUBLON, { id: 41 })
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'x@boutique.fr', prenom: 'X', nom: 'Test', ...compte } as any, SECRET,
  )
  const res = await app.request(
    '/api/mobilax/import',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(corps) },
    { DB: d1, JWT_SECRET: SECRET, FOURNISSEUR_CRYPTO_KEY: CLE_CHIFFREMENT, MOBILAX_API_BASE: BASE } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return { res, d1 }
}

function mobilaxRenvoieLaFiche() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
    if (url === `${BASE}/products/17/full`)
      return json({ status: 'OK', data: { id: 17, reference: 'BATTEST17', ean13: '3000000000017', name: 'Batterie test', price: 8.68 } })
    return json({ status: 'NOT_FOUND' }, 404)
  })
}

describe('POST /api/mobilax/import', () => {
  it('manager : 201 avec l\'identifiant du produit créé dans SA boutique', async () => {
    mobilaxRenvoieLaFiche()
    const { res, d1 } = await importer({ role: 'manager', boutique_id: 1 }, { mobilax_id: 17, boutique_id: 99 })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ success: true, data: { produit_id: 88 } })
    const insert = d1.__getCalls().find(c => c.sql.startsWith('INSERT INTO produits'))!
    expect(insert.params[0]).toBe(1)   // boutique du jeton, jamais le boutique_id du corps
  })

  it('pièce déjà importée : 409 avec le produit existant', async () => {
    mobilaxRenvoieLaFiche()
    const { res } = await importer({ role: 'manager', boutique_id: 1 }, { mobilax_id: 17 }, { doublon: true })
    expect(res.status).toBe(409)
    // Enveloppe du dépôt : la charge utile sous `data`, en échec comme en succès (CLAUDE.md)
    expect(await res.json()).toMatchObject({ success: false, code: 'deja_importe', data: { produit_id: 41 } })
  })

  it('admin plateforme : refusé, rien créé, Mobilax jamais appelé', async () => {
    const { res, d1 } = await importer({ role: 'admin', boutique_id: null }, { mobilax_id: 17 })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(d1.__getCalls().some(c => c.sql.startsWith('INSERT INTO produits'))).toBe(false)
  })

  it('technicien : refusé, comme la création de produit (admin/manager seulement)', async () => {
    const { res } = await importer({ role: 'technicien', boutique_id: 1 }, { mobilax_id: 17 })
    expect(res.status).toBe(403)
  })

  it('identifiant Mobilax absent ou non entier : 400, Mobilax jamais appelé', async () => {
    for (const corps of [{}, { mobilax_id: 'abc' }, { mobilax_id: 1.5 }]) {
      const { res } = await importer({ role: 'manager', boutique_id: 1 }, corps)
      expect(res.status, JSON.stringify(corps)).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
