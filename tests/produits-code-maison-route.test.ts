import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import app from '../src/index'
import { generateTokenPair } from '../src/lib/auth'
import { codeMaison } from '../src/lib/codeMaison'

/**
 * @file tests/produits-code-maison-route.test.ts
 * @description Routes du code maison produit (ticket 05 `vente-lit-catalogue`), vrai routeur +
 * vrai SQLite (`CLAUDE.md` § Bons de commande — une règle portée par le SQL ne se prouve pas
 * contre un mock qui renvoie ce qu'on lui configure).
 */

const SECRET = 'secret-de-test'

let base: BaseReelle
beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1'), (2, 'Boutique 2');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif) VALUES
      (1, 'manager@b1.fr',    'x', 'M', 'Test', 2, 1, 1),
      (2, 'technicien@b1.fr', 'x', 'T', 'Test', 3, 1, 1);
  `)
})

async function jeton(role: string, boutiqueId: number | null, userId = 1) {
  const { accessToken } = await generateTokenPair(
    { id: userId, email: `${role}@test.fr`, role, boutique_id: boutiqueId, prenom: 'U', nom: 'Test' } as any,
    SECRET,
  )
  return accessToken
}

async function poserCodeMaison(id: number, token: string) {
  return app.request(
    `/api/produits/${id}/code-maison`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    { DB: base.d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
}

async function creerProduit(corps: Record<string, unknown>, token: string, boutiqueId?: number) {
  return app.request(
    `/api/produits${boutiqueId ? `?boutique_id=${boutiqueId}` : ''}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stock_minimum: 0, ...corps }),
    },
    { DB: base.d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
}

function produitDirect(p: { nom?: string; code_barre?: string | null; boutique_id?: number }): number {
  const v = { nom: 'Produit', code_barre: null, boutique_id: 1, ...p }
  return Number(base.sqlite.prepare(
    'INSERT INTO produits (boutique_id, nom, code_barre, prix_vente_ht, tva_taux) VALUES (?, ?, ?, 10, 20)',
  ).run(v.boutique_id, v.nom, v.code_barre).lastInsertRowid)
}

describe('POST /api/produits/:id/code-maison', () => {
  it('200 : pose un code maison sur un produit sans code', async () => {
    const id = produitDirect({ nom: 'Sans code' })
    const res = await poserCodeMaison(id, await jeton('manager', 1))
    const corps = await res.json() as any

    expect(res.status).toBe(200)
    expect(corps.success).toBe(true)
    expect(corps.code_barre).toBe(codeMaison(1, id))
    const row = base.sqlite.prepare('SELECT code_barre FROM produits WHERE id = ?').get(id) as any
    expect(row.code_barre).toBe(codeMaison(1, id))
  })

  it('409 : refuse un produit qui a déjà un code-barres', async () => {
    const id = produitDirect({ nom: 'Déjà codé', code_barre: '3700275472140' })
    const res = await poserCodeMaison(id, await jeton('manager', 1))

    expect(res.status).toBe(409)
    const corps = await res.json() as any
    expect(corps.success).toBe(false)
    const row = base.sqlite.prepare('SELECT code_barre FROM produits WHERE id = ?').get(id) as any
    expect(row.code_barre).toBe('3700275472140') // inchangé
  })

  it('403 : manager d\'une autre boutique (assertBoutiqueOwnership, CLAUDE.md § Invariants isolation)', async () => {
    const id = produitDirect({ nom: 'Autre boutique', boutique_id: 2 })
    const res = await poserCodeMaison(id, await jeton('manager', 1))
    expect(res.status).toBe(403)
  })

  it('404 : produit inexistant', async () => {
    const res = await poserCodeMaison(999999, await jeton('manager', 1))
    expect(res.status).toBe(404)
  })

  it('403 : technicien refusé', async () => {
    const id = produitDirect({ nom: 'Pour technicien' })
    const res = await poserCodeMaison(id, await jeton('technicien', 1, 2))
    expect(res.status).toBe(403)
    const row = base.sqlite.prepare('SELECT code_barre FROM produits WHERE id = ?').get(id) as any
    expect(row.code_barre).toBeNull()
  })

  it('409 : collision avec un autre produit porteur du même code calculé, nommant le porteur', async () => {
    const id = produitDirect({ nom: 'Cible' })
    // Un autre produit porte déjà EXACTEMENT le code que « Cible » calculerait.
    produitDirect({ nom: 'Porteur existant', code_barre: codeMaison(1, id) })

    const res = await poserCodeMaison(id, await jeton('manager', 1))
    const corps = await res.json() as any

    expect(res.status).toBe(409)
    expect(corps.error).toContain('Porteur existant')
  })
})

describe('POST /api/produits — avertissement de pose automatique (collision)', () => {
  it('201 avec avertissement_code_maison nommant le porteur, quand la pose automatique entre en collision', async () => {
    // Le porteur est inséré en premier (id 1) ; le produit créé par la route recevra donc l'id 2 —
    // on lui prépare à l'avance EXACTEMENT le code qu'il calculerait.
    produitDirect({ nom: 'Porteur', code_barre: codeMaison(1, 2) })

    const res = await creerProduit({ nom: 'Nouveau produit sans code' }, await jeton('manager', 1))
    const corps = await res.json() as any

    expect(res.status).toBe(201)
    expect(corps.success).toBe(true)
    expect(corps.avertissement_code_maison).toBeDefined()
    expect(corps.avertissement_code_maison).toContain('Porteur')
    const row = base.sqlite.prepare('SELECT code_barre FROM produits WHERE id = ?').get(corps.id) as any
    expect(row.code_barre).toBeNull()
  })

  it('201 sans la clé avertissement_code_maison quand la pose réussit', async () => {
    const res = await creerProduit({ nom: 'Produit propre' }, await jeton('manager', 1))
    const corps = await res.json() as any

    expect(res.status).toBe(201)
    expect(corps).not.toHaveProperty('avertissement_code_maison')
  })
})

describe('POST /api/produits/import-csv — avertissements de pose automatique', () => {
  it('avertissements de longueur 1, ligne comptée comme importée', async () => {
    // Porteur inséré en premier (id 1) ; la ligne CSV créera le produit n°2.
    produitDirect({ nom: 'Porteur CSV', code_barre: codeMaison(1, 2) })

    const res = await app.request(
      '/api/produits/import-csv',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await jeton('manager', 1)}` },
        body: JSON.stringify({ csvContent: 'nom,sku\nPièce sans code,CSV-001' }),
      },
      { DB: base.d1, JWT_SECRET: SECRET } as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    )
    const corps = await res.json() as any

    expect(res.status).toBe(200)
    expect(corps.imported).toBe(1)
    expect(corps.avertissements).toHaveLength(1)
    expect(corps.avertissements[0]).toContain('Porteur CSV')
  })
})
