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

const SQL_FOURNISSEUR_API = `SELECT id, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
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
      data: { total: 1, produits: [{ mobilax_id: 17, nom: 'Batterie test', ean13: '3000000000017', prix_achat_ht: 8.68, stock: 10 }] },
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
