/**
 * @file tests/mobilaxRafraichissement.test.ts
 * @description `rafraichirProduitImporte()` — rafraîchissement manuel du prix d'achat d'une pièce
 * déjà importée (ticket 05 `integration-mobilax`, amendement du 2026-09-27, partie serveur).
 *
 * Seam : `rafraichirProduitImporte()`, frontières simulées comme le reste de `mobilaxService` —
 * `fetch` (API Mobilax) et le port `Database` (mockDatabase, la jointure produit/fournisseur et
 * l'écriture). Les règles portées par le SQL lui-même (isolation, colonnes inchangées,
 * revérification d'identité) sont prouvées séparément contre un vrai SQLite
 * (`tests/rafraichissement-mobilax-sqlite.test.ts`) : ici, seule l'orchestration HTTP est visée.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { chiffrer } from '../src/lib/chiffrement'
import { rafraichirProduitImporte } from '../src/services/mobilaxService'

const CLE_CHIFFREMENT = 'd'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'
const BOUTIQUE = 1
const PRODUIT_ID = 55
const MOBILAX_ID = 17

const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'
// Point 16 : le SELECT porte aussi rafraichissable_par (sqlRafraichissablePar()), la condition
// d'adaptateur unique de stockService.ts — texte exact requis par le matching du mock (normalisé
// espaces/retours à la ligne, cf. tests/helpers/mockDatabase.ts).
const SQL_ADAPTATEUR = `SELECT p.id AS produit_id, f.api_plateforme AS api_plateforme, p.mobilax_id AS mobilax_id,
     CASE WHEN f.api_plateforme = 'mobilax' AND p.mobilax_id IS NOT NULL THEN 'Mobilax' ELSE NULL END AS rafraichissable_par
     FROM produits p
     LEFT JOIN fournisseurs f ON f.id = p.fournisseur_id AND f.boutique_id = p.boutique_id AND f.actif = 1
     WHERE p.id = ? AND p.boutique_id = ? AND p.actif = 1`

const kv = { async get() { return null }, async put() {}, async delete() {} }
let db: ReturnType<typeof createMockDatabase>
let fetchMock: ReturnType<typeof vi.fn>
const deps = () => ({ db, kv, cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE })

function json(corps: unknown, status = 200, entetes: Record<string, string> = {}) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...entetes } })
}

/** Le produit est un produit Mobilax conforme (adaptateur "mobilax", identifiant présent). */
function produitMobilaxConforme() {
  db.__setResponse(SQL_ADAPTATEUR, { produit_id: PRODUIT_ID, api_plateforme: 'mobilax', mobilax_id: MOBILAX_ID })
}

async function fournisseurAvecCle(cle = 'cle-mobilax-test') {
  db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, a_cle: 1 }])
  db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer(cle, CLE_CHIFFREMENT) })
}

/** Mobilax répond sur `/products/:id/full` avec cette fiche (id, price, quantity). */
function mobilaxRepondFiche(fiche: { id: number; price: unknown; quantity?: number }, status = 200) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
    if (url === `${BASE}/products/${MOBILAX_ID}/full`) return json({ status: 'OK', data: fiche }, status)
    return json({ status: 'NOT_FOUND' }, 404)
  })
}

beforeEach(() => {
  db = createMockDatabase()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('rafraichirProduitImporte() — identité et adaptateur (points 1, 5, 8)', () => {
  it('produit introuvable dans cette boutique : null, Mobilax jamais appelé', async () => {
    db.__setNotFound(SQL_ADAPTATEUR)
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('produit non Mobilax portant une référence (fournisseur sans api_plateforme) : refusé, Mobilax jamais appelé', async () => {
    db.__setResponse(SQL_ADAPTATEUR, { produit_id: PRODUIT_ID, api_plateforme: null, mobilax_id: null })
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toMatchObject({ ok: false, erreur: 'non_rattache' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mobilax_id absent malgré un fournisseur Mobilax : refusé, Mobilax jamais appelé', async () => {
    db.__setResponse(SQL_ADAPTATEUR, { produit_id: PRODUIT_ID, api_plateforme: 'mobilax', mobilax_id: null })
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toMatchObject({ ok: false, erreur: 'non_rattache' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('rafraichirProduitImporte() — revalidation Mobilax (points 1 et 6)', () => {
  it('identifiant renvoyé différent de celui du produit : refusé, rien écrit', async () => {
    produitMobilaxConforme()
    await fournisseurAvecCle()
    mobilaxRepondFiche({ id: 999, price: 12.5, quantity: 4 })
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toMatchObject({ ok: false, erreur: 'identifiant_discordant' })
    expect(db.__getCalls().some(c => c.sql.startsWith('UPDATE produits'))).toBe(false)
  })

  it('pièce introuvable chez Mobilax (404) : refusé, rien écrit', async () => {
    produitMobilaxConforme()
    await fournisseurAvecCle()
    mobilaxRepondFiche({ id: MOBILAX_ID, price: 12.5 }, 404)
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toMatchObject({ ok: false, erreur: 'supprime_mobilax' })
    expect(db.__getCalls().some(c => c.sql.startsWith('UPDATE produits'))).toBe(false)
  })

  it.each([
    ['absent', undefined],
    ['non numérique', '44.25'],
    ['nul', 0],
    ['négatif', -5],
  ])('prix %s : refusé, rien écrit', async (_libelle, price) => {
    produitMobilaxConforme()
    await fournisseurAvecCle()
    mobilaxRepondFiche({ id: MOBILAX_ID, price, quantity: 4 })
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toMatchObject({ ok: false, erreur: 'prix_invalide' })
    expect(db.__getCalls().some(c => c.sql.startsWith('UPDATE produits'))).toBe(false)
  })

  it('revalidation réussie : le prix et le stock affichable Mobilax sont rendus, et l\'écriture porte l\'identité vérifiée', async () => {
    produitMobilaxConforme()
    await fournisseurAvecCle()
    mobilaxRepondFiche({ id: MOBILAX_ID, price: 12.9, quantity: 4 })
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toEqual({ ok: true, prix_achat_ht: 12.9, stock: 4 })
    const ecriture = db.__getCalls().find(c => c.sql.startsWith('UPDATE produits'))!
    expect(ecriture.params).toEqual([12.9, PRODUIT_ID, BOUTIQUE, MOBILAX_ID])
  })
})

describe('rafraichirProduitImporte() — pannes réseau, réutilise la plomberie Mobilax existante', () => {
  it('quota atteint : erreur nommée, rien écrit', async () => {
    produitMobilaxConforme()
    await fournisseurAvecCle()
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' })
      : json({ status: 'RATE_LIMITED' }, 429, { 'ratelimit-reset': '30' }))
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toMatchObject({ ok: false, erreur: 'quota', reessayer_dans_s: 30 })
  })

  it('aucune fiche fournisseur Mobilax pour cette boutique : erreur nommée', async () => {
    produitMobilaxConforme()
    db.__setListResponse(SQL_FOURNISSEUR_API, [])
    const r = await rafraichirProduitImporte(deps(), BOUTIQUE, PRODUIT_ID)
    expect(r).toMatchObject({ ok: false, erreur: 'sans_fournisseur' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
