/**
 * @file tests/mobilaxPrixVente.test.ts
 * @description Prix de vente marginé d'une pièce Mobilax (ticket 06, chantier
 * `integration-mobilax`) — préremplissage d'une ligne de devis (puis facture/caisse/prise en
 * charge, tickets 07-09, même route).
 *
 * Seam « Service » : `prixVenteMobilax()`. Mêmes frontières simulées que
 * `mobilaxImportEnrichi.test.ts` : `fetch` (API Mobilax), port `Database` (mockDatabase) — SANS
 * binding D1 : cette fonction n'écrit rien, `prixVenteMobilax()` ne prend même pas `d1` en
 * paramètre, structurellement incapable d'appeler `createProduit()`.
 *
 * Seam « Fonction partagée » : `prixDeVente()`, testée directement (arrondi au centime, taux 0).
 * Le cas « taux null » se teste sur chaque appelant (`decisions.md` 2026-09-30, précision « taux
 * null ») : `importerProduitMobilax()` garde son test existant (`prix_vente_ht: 0`,
 * `mobilaxService.test.ts`, ⊥ modifié ici) ; `prixVenteMobilax()` est testée ci-dessous.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { chiffrer } from '../src/lib/chiffrement'
import { prixVenteMobilax, prixDeVente } from '../src/services/mobilaxService'

const CLE_CHIFFREMENT = 'd'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'
const BOUTIQUE = 1

const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'
const SQL_REGLAGES = 'SELECT * FROM boutique_settings WHERE boutique_id = ?'

/** Extrait réduit de l'arbre réel des catégories Mobilax (mêmes identifiants que `mobilaxImportEnrichi.test.ts`). */
const ARBRE = [
  { id: 6,   id_parent: null, name: 'Pièces Détachées' },
  { id: 8,   id_parent: 6,    name: 'Ecrans & Tactiles' },
  { id: 329, id_parent: 8,    name: 'Ecran Tactile Original Refurb (PIEC)' },
  { id: 46,  id_parent: null, name: 'Accessoires test permission' },
  { id: 50,  id_parent: 46,   name: 'Coques' },
  { id: 51,  id_parent: 50,   name: 'Coque Silicone' },
]

const FICHE_PIECE = {
  id: 10242, reference: 'ECRTAREAPPIPHNE12MNO', ean13: '3000000059487',
  name: 'Ecran Tactile Original Refurb (PIEC) Apple iPhone 12 Mini Noir',
  description: '<p>Qualité origine.</p>', price: 44.25,
  categorie: { id: 329, name: 'Ecran Tactile Original Refurb (PIEC)' },
}

const FICHE_ACCESSOIRE = {
  id: 20001, reference: 'COQ-SIL-12', ean13: null,
  name: 'Coque Silicone iPhone 12', description: null, price: 3.5,
  categorie: { id: 51, name: 'Coque Silicone' },
}

function json(corps: unknown, status = 200, entetes: Record<string, string> = {}) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...entetes } })
}

let db: ReturnType<typeof createMockDatabase>
let fetchMock: ReturnType<typeof vi.fn>
const kv = { async get() { return null }, async put() {}, async delete() {} }
const deps = () => ({ db, kv, cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE })

/** Mobilax renvoie `fiche` sur `/full` ; l'arbre des catégories répond normalement. */
function mobilaxRepond(fiche: object) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
    if (url === `${BASE}/products/${(fiche as any).id}/full`) return json({ status: 'OK', data: fiche })
    if (url === `${BASE}/catalog/categories`) return json({ status: 'OK', data: ARBRE })
    return json({ status: 'NOT_FOUND' }, 404)
  })
}

beforeEach(async () => {
  db = createMockDatabase()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
  db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-test', CLE_CHIFFREMENT) })
  db.__setResponse(SQL_REGLAGES, { boutique_id: 1, marge_taux_defaut: 30, marge_taux_piece: null, marge_taux_accessoire: 80 })
})
afterEach(() => vi.unstubAllGlobals())

describe('prixVenteMobilax()', () => {
  it('pièce : taux de la famille « pièce » (ici absent, replie sur le défaut de la boutique)', async () => {
    mobilaxRepond(FICHE_PIECE)
    const r = await prixVenteMobilax(deps(), BOUTIQUE, 10242)
    expect(r).toEqual({
      ok: true, mobilax_id: 10242, nom: FICHE_PIECE.name, prix_achat_ht: 44.25,
      famille: 'piece', taux: 30, prix_vente_ht: 57.53,   // 44,25 × 1,30
    })
  })

  it('accessoire : taux de la famille « accessoire », pas celui des pièces ni le défaut', async () => {
    mobilaxRepond(FICHE_ACCESSOIRE)
    const r = await prixVenteMobilax(deps(), BOUTIQUE, 20001)
    expect(r).toEqual({
      ok: true, mobilax_id: 20001, nom: FICHE_ACCESSOIRE.name, prix_achat_ht: 3.5,
      famille: 'accessoire', taux: 80, prix_vente_ht: 6.3,   // 3,5 × 1,80
    })
  })

  it('taux null (boutique sans aucune marge saisie) : prix de vente = prix d\'achat, jamais un taux inventé', async () => {
    db.__setResponse(SQL_REGLAGES, { boutique_id: 1, marge_taux_defaut: null, marge_taux_piece: null, marge_taux_accessoire: null })
    mobilaxRepond(FICHE_PIECE)
    const r = await prixVenteMobilax(deps(), BOUTIQUE, 10242)
    expect(r).toMatchObject({ ok: true, taux: null, prix_vente_ht: 44.25 })
  })

  it('pièce inconnue chez Mobilax (404) : introuvable', async () => {
    mobilaxRepond(FICHE_PIECE)
    const r = await prixVenteMobilax(deps(), BOUTIQUE, 999999)
    expect(r).toMatchObject({ ok: false, erreur: 'introuvable' })
  })

  it('quota Mobilax atteint : même signal que la recherche', async () => {
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' })
      : json({ status: 'RATE_LIMITED' }, 429, { 'ratelimit-reset': '12' }))
    const r = await prixVenteMobilax(deps(), BOUTIQUE, 10242)
    expect(r).toMatchObject({ ok: false, erreur: 'quota', reessayer_dans_s: 12 })
  })

  it('aucune écriture en base : ni produit, ni catégorie, ni rattachement, ni mouvement', async () => {
    mobilaxRepond(FICHE_ACCESSOIRE)
    await prixVenteMobilax(deps(), BOUTIQUE, 20001)
    const ecritures = db.__getCalls().filter(c => /^(INSERT|UPDATE|DELETE)\b/i.test(c.sql))
    expect(ecritures).toEqual([])
  })
})

describe('prixDeVente() — formule partagée', () => {
  it('arrondit au centime', () => {
    expect(prixDeVente(44.25, 30)).toBe(57.53)
    expect(prixDeVente(3.5, 80)).toBe(6.3)
    expect(prixDeVente(10, 33)).toBe(13.3)
  })

  it('taux 0 : prix de vente = prix d\'achat', () => {
    expect(prixDeVente(44.25, 0)).toBe(44.25)
  })
})
