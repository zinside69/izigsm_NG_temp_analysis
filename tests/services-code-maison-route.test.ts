import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import app from '../src/index'
import { generateTokenPair } from '../src/lib/auth'
import { codeMaison } from '../src/lib/codeMaison'

/**
 * @file tests/services-code-maison-route.test.ts
 * @description `POST /api/services/:id/code-maison` (ticket 05 `vente-lit-catalogue`), vrai
 * routeur + vrai SQLite (migration 0052 appliquée en production le 2026-10-02) — même patron que
 * `tests/produits-code-maison-route.test.ts` côté produits.
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
    `/api/services/${id}/code-maison`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    { DB: base.d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
}

function serviceDirect(p: { nom?: string; code_barre?: string | null; boutique_id?: number; actif?: number }): number {
  const v = { nom: 'Service', code_barre: null, boutique_id: 1, actif: 1, ...p }
  return Number(base.sqlite.prepare(
    'INSERT INTO services (boutique_id, nom, code_barre, actif, prix_ht, tva_taux) VALUES (?, ?, ?, ?, 10, 20)',
  ).run(v.boutique_id, v.nom, v.code_barre, v.actif).lastInsertRowid)
}

describe('POST /api/services/:id/code-maison', () => {
  it('200 : pose un code maison sur un service sans code', async () => {
    const id = serviceDirect({ nom: 'Pose de film' })
    const res = await poserCodeMaison(id, await jeton('manager', 1))
    const corps = await res.json() as any

    expect(res.status).toBe(200)
    expect(corps.success).toBe(true)
    expect(corps.code_barre).toBe(codeMaison(2, id))
    const row = base.sqlite.prepare('SELECT code_barre FROM services WHERE id = ?').get(id) as any
    expect(row.code_barre).toBe(codeMaison(2, id))
  })

  it('409 : refuse un service qui a déjà un code-barres', async () => {
    const id = serviceDirect({ nom: 'Déjà codé', code_barre: '2200000000010' })
    const res = await poserCodeMaison(id, await jeton('manager', 1))

    expect(res.status).toBe(409)
    const corps = await res.json() as any
    expect(corps.success).toBe(false)
    const row = base.sqlite.prepare('SELECT code_barre FROM services WHERE id = ?').get(id) as any
    expect(row.code_barre).toBe('2200000000010') // inchangé
  })

  it('409 : collision avec un autre service porteur du même code calculé, nommant le porteur', async () => {
    const id = serviceDirect({ nom: 'Cible' })
    // Un autre service porte déjà EXACTEMENT le code que « Cible » calculerait.
    serviceDirect({ nom: 'Porteur existant', code_barre: codeMaison(2, id) })

    const res = await poserCodeMaison(id, await jeton('manager', 1))
    const corps = await res.json() as any

    expect(res.status).toBe(409)
    expect(corps.error).toContain('Porteur existant')
    const row = base.sqlite.prepare('SELECT code_barre FROM services WHERE id = ?').get(id) as any
    expect(row.code_barre).toBeNull() // pas posé
  })

  it('404 : service inexistant', async () => {
    const res = await poserCodeMaison(999999, await jeton('manager', 1))
    expect(res.status).toBe(404)
  })

  it('404 : service inactif (désactivé)', async () => {
    const id = serviceDirect({ nom: 'Désactivé', actif: 0 })
    const res = await poserCodeMaison(id, await jeton('manager', 1))
    expect(res.status).toBe(404)
  })

  // Invariant du dépôt (CLAUDE.md § Invariants isolation multi-tenant) : assertBoutiqueOwnership()
  // renvoie 403 pour un non-admin dont la boutique ne correspond pas à la ressource — jamais 404,
  // qui resterait réservé à une ressource réellement introuvable. Même choix et même test que
  // POST /api/produits/:id/code-maison (tests/produits-code-maison-route.test.ts).
  it('403 : manager d\'une autre boutique (assertBoutiqueOwnership)', async () => {
    const id = serviceDirect({ nom: 'Autre boutique', boutique_id: 2 })
    const res = await poserCodeMaison(id, await jeton('manager', 1))
    expect(res.status).toBe(403)
    const row = base.sqlite.prepare('SELECT code_barre FROM services WHERE id = ?').get(id) as any
    expect(row.code_barre).toBeNull()
  })

  it('403 : technicien refusé (requireRole)', async () => {
    const id = serviceDirect({ nom: 'Pour technicien' })
    const res = await poserCodeMaison(id, await jeton('technicien', 1, 2))
    expect(res.status).toBe(403)
    const row = base.sqlite.prepare('SELECT code_barre FROM services WHERE id = ?').get(id) as any
    expect(row.code_barre).toBeNull()
  })
})
