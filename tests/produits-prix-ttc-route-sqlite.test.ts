import { describe, it, expect, beforeEach } from 'vitest'
import app from '../src/index'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { generateTokenPair } from '../src/lib/auth'

/**
 * Prix de vente TTC des pièces par l'API (ticket 01 du chantier prix TTC, décisions de l'exploitant du
 * 2026-10-04) : le prix de vente saisi est un TTC qui fait foi (Q1), le HT s'en déduit au centime ; un
 * HT seul, envoyé par un ancien écran, est converti (transition) ; si les deux arrivent, le TTC
 * l'emporte. Quand le taux de TVA d'une fiche change, le HT est gardé et le TTC recalculé (Q20).
 *
 * Routes jouées contre un vrai SQLite au schéma réel (migrations rejouées, 0062 comprise).
 */

const SECRET = 'secret-de-test'
let base: BaseReelle

async function appeler(methode: string, chemin: string, corps?: unknown) {
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'manager@b1.fr', prenom: 'Man', nom: 'Ager', role: 'manager', boutique_id: 1 } as any,
    SECRET,
  )
  const res = await app.request(
    chemin,
    {
      method:  methode,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
    },
    { DB: base.d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return { res, corps: await res.json() as any }
}

/** Prix de vente stockés d'une fiche, relus en base. */
function prixEnBase(produitId: number): { ht: number; ttc: number; taux: number } {
  const ligne = base.sqlite.prepare('SELECT prix_vente_ht, prix_vente_ttc, tva_taux FROM produits WHERE id = ?').get(produitId)
  return { ht: ligne.prix_vente_ht, ttc: ligne.prix_vente_ttc, taux: ligne.tva_taux }
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`INSERT INTO boutiques (id, nom) VALUES (1, 'B1')`)
  base.sqlite.exec(`INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
    VALUES (7, 'manager@b1.fr', 'x', 'Man', 'Ager', 2, 1, 1)`)
})

describe('POST /api/produits — prix de vente TTC', () => {
  it('TTC saisi : stocké tel quel, HT déduit au centime (9,90 € TTC à 20 % → 8,25 € HT)', async () => {
    const { res, corps } = await appeler('POST', '/api/produits', { nom: 'Écran', prix_vente_ttc: 9.9, tva_taux: 20 })
    expect(res.status, JSON.stringify(corps)).toBe(201)
    expect(prixEnBase(corps.id)).toEqual({ ht: 8.25, ttc: 9.9, taux: 20 })
  })

  it('HT seul (ancien écran) : converti en TTC au centime (16,66 € HT → 19,99 € TTC)', async () => {
    const { corps } = await appeler('POST', '/api/produits', { nom: 'Batterie', prix_vente_ht: 16.66 })
    expect(prixEnBase(corps.id)).toEqual({ ht: 16.66, ttc: 19.99, taux: 20 })
  })

  it('TTC et HT envoyés ensemble : le TTC l\'emporte', async () => {
    const { corps } = await appeler('POST', '/api/produits', { nom: 'Coque', prix_vente_ttc: 12, prix_vente_ht: 5 })
    expect(prixEnBase(corps.id)).toEqual({ ht: 10, ttc: 12, taux: 20 })
  })
})

describe('PUT /api/produits/:id — prix de vente TTC', () => {
  async function creerEcran(): Promise<number> {
    const { corps } = await appeler('POST', '/api/produits', { nom: 'Écran', prix_vente_ttc: 9.9, tva_taux: 20 })
    return corps.id
  }

  it('nouveau TTC : stocké tel quel, HT déduit (19,90 € TTC → 16,58 € HT)', async () => {
    const id = await creerEcran()
    const { res, corps } = await appeler('PUT', `/api/produits/${id}`, { prix_vente_ttc: 19.9 })
    expect(res.status, JSON.stringify(corps)).toBe(200)
    expect(prixEnBase(id)).toEqual({ ht: 16.58, ttc: 19.9, taux: 20 })
  })

  it('taux de TVA changé sans prix : HT gardé, TTC recalculé (8,25 € HT à 10 % → 9,08 € TTC)', async () => {
    const id = await creerEcran()
    await appeler('PUT', `/api/produits/${id}`, { tva_taux: 10 })
    expect(prixEnBase(id)).toEqual({ ht: 8.25, ttc: 9.08, taux: 10 })
  })

  it('taux changé, TTC renvoyé à l\'identique par le formulaire : HT gardé, TTC recalculé (Q20, 2026-10-06)', async () => {
    const id = await creerEcran()   // 9,90 € TTC, HT 8,25
    await appeler('PUT', `/api/produits/${id}`, { prix_vente_ttc: 9.9, tva_taux: 10 })
    expect(prixEnBase(id)).toEqual({ ht: 8.25, ttc: 9.08, taux: 10 })
  })

  it('même taux renvoyé avec la fiche (client qui renvoie tout) : TTC inchangé (9,99 € reste 9,99 €)', async () => {
    const { corps } = await appeler('POST', '/api/produits', { nom: 'Câble', prix_vente_ttc: 9.99, tva_taux: 20 })
    await appeler('PUT', `/api/produits/${corps.id}`, { nom: 'Câble USB-C', tva_taux: 20 })
    expect(prixEnBase(corps.id)).toEqual({ ht: 8.33, ttc: 9.99, taux: 20 })
  })

  it('TTC négatif : refusé (422), comme un prix d\'achat négatif', async () => {
    const { res } = await appeler('POST', '/api/produits', { nom: 'Erreur', prix_vente_ttc: -5 })
    expect(res.status).toBe(422)
  })

  it('les réponses de création et de modification portent le TTC et le HT', async () => {
    const creation = await appeler('POST', '/api/produits', { nom: 'Écran', prix_vente_ttc: 9.9 })
    expect([creation.corps.prix_vente_ttc, creation.corps.prix_vente_ht]).toEqual([9.9, 8.25])
    const modification = await appeler('PUT', `/api/produits/${creation.corps.id}`, { prix_vente_ttc: 19.9 })
    expect([modification.corps.data.prix_vente_ttc, modification.corps.data.prix_vente_ht]).toEqual([19.9, 16.58])
  })

  it('modification sans prix ni taux : prix inchangés', async () => {
    const id = await creerEcran()
    await appeler('PUT', `/api/produits/${id}`, { nom: 'Écran OLED' })
    expect(prixEnBase(id)).toEqual({ ht: 8.25, ttc: 9.9, taux: 20 })
  })

  it('la fiche relue par l\'API porte le TTC et le HT', async () => {
    const id = await creerEcran()
    const { corps } = await appeler('GET', `/api/produits/${id}`)
    expect(corps.data.prix_vente_ttc).toBe(9.9)
    expect(corps.data.prix_vente_ht).toBe(8.25)
  })
})
