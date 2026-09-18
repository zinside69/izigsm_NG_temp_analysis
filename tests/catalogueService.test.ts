/**
 * @file tests/catalogueService.test.ts
 * @description Recherche catalogue unifiée (chantier `vente-lit-catalogue`, ticket 03) :
 * produits, services et dossiers SAV dans une seule liste typée.
 *
 * Base simulée par table lue, pas par texte SQL exact : le contrat testé est la liste rendue,
 * pas la forme des requêtes. Le filtrage réel (LIKE, boutique) se prouve contre la vraie D1
 * locale (`tests/e2e/caisse-catalogue-api.spec.ts`).
 */

import { describe, it, expect } from 'vitest'
import type { Database } from '../src/ports/database'
import { rechercherCatalogue, PLAFOND_RECHERCHE_CATALOGUE } from '../src/services/catalogueService'

type Tables = { produits?: any[]; services?: any[]; sav_dossiers?: any[] }

/** Base simulée : chaque requête rend les lignes de la table qu'elle lit ; les appels sont gardés. */
function fausseBase(tables: Tables) {
  const appels: Array<{ sql: string; params: unknown[] }> = []
  const db: Database = {
    async all<T>(sql: string, params: unknown[] = []) {
      appels.push({ sql, params })
      const table = (['sav_dossiers', 'services', 'produits'] as const).find(t => new RegExp(`FROM\\s+${t}\\b`).test(sql))
      return (table ? tables[table] ?? [] : []) as T[]
    },
    async get() { return null },
    async run() { return { id: null, changes: 0 } },
  }
  return { db, appels }
}

const produit = (id: number, nom = `Coque ${id}`) => ({
  id, nom, sku: `SKU-${id}`, code_barre: null, prix_vente_ht: 10, tva_taux: 20, stock_actuel: 3,
})

describe('rechercherCatalogue() — services', () => {
  it('rend un service typé, avec ce qu\'il faut pour préremplir une ligne', async () => {
    const { db } = fausseBase({
      services: [{ id: 7, nom: 'Pose de film', reference: 'POSE-FILM', prix_ht: 12.5, tva_taux: 20 }],
    })

    const resultats = await rechercherCatalogue(db, 1, 'film')

    expect(resultats).toEqual([
      { type: 'service', id: 7, nom: 'Pose de film', reference: 'POSE-FILM', prix_ht: 12.5, tva_taux: 20 },
    ])
  })

  it('ne lit que la boutique consultée, quel que soit le type', async () => {
    const { db, appels } = fausseBase({})

    await rechercherCatalogue(db, 4, 'film')

    expect(appels.length).toBeGreaterThanOrEqual(3)
    for (const a of appels) expect(a.params[0]).toBe(4)
  })

  it('un service reste visible quand les produits remplissent à eux seuls le plafond', async () => {
    const { db } = fausseBase({
      produits: Array.from({ length: PLAFOND_RECHERCHE_CATALOGUE }, (_, i) => produit(i + 1, `Film ${i + 1}`)),
      services: [{ id: 7, nom: 'Pose de film', reference: null, prix_ht: 12.5, tva_taux: 20 }],
    })

    const resultats = await rechercherCatalogue(db, 1, 'film')

    expect(resultats).toHaveLength(PLAFOND_RECHERCHE_CATALOGUE)
    expect(resultats.some(r => r.type === 'service')).toBe(true)
  })
})

describe('rechercherCatalogue() — dossiers SAV', () => {
  it('rend un dossier SAV typé, avec son numéro, son client et son statut', async () => {
    const { db } = fausseBase({
      sav_dossiers: [{
        id: 3, numero: 'SAV-2026-00003', statut: 'ouvert', motif: 'Écran qui scintille',
        client_prenom: 'Lina', client_nom: 'Martin',
      }],
    })

    const resultats = await rechercherCatalogue(db, 1, 'martin')

    expect(resultats).toEqual([{
      type: 'sav', id: 3, numero: 'SAV-2026-00003', client: 'Lina Martin',
      statut: 'ouvert', motif: 'Écran qui scintille',
    }])
  })

  it('un dossier sans client rend un client nul, jamais « undefined undefined »', async () => {
    const { db } = fausseBase({
      sav_dossiers: [{ id: 4, numero: 'SAV-2026-00004', statut: 'clos', motif: 'Batterie', client_prenom: null, client_nom: null }],
    })

    const [resultat] = await rechercherCatalogue(db, 1, 'SAV-2026')

    expect(resultat).toMatchObject({ type: 'sav', client: null })
  })
})
