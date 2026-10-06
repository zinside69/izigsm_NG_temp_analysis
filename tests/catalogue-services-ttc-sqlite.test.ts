import { describe, it, expect, beforeEach } from 'vitest'
import { rechercherCatalogue, lireFavorisVente } from '../src/services/catalogueService'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'

/**
 * Service proposé en caisse à son TTC (ticket 04 du chantier prix TTC) : la recherche du catalogue et
 * les favoris rendent le prix TTC **stocké** du service (`prix_ttc`, migration 0064), celui que la caisse
 * propose tel quel — jamais recalculé depuis le HT. La caisse ne connaît pas de modèle d'appareil : le
 * prix par modèle s'applique là où un modèle est choisi (ticket, ticket 05).
 *
 * Contre un vrai SQLite au schéma réel.
 */

let base: BaseReelle
const port = () => new D1DatabaseAdapter(base.d1)

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'B1');
    INSERT INTO clients (id, boutique_id, nom, prenom) VALUES (1, 1, 'Comptoir', 'C');
  `)
})

/** Un service de la boutique 1 : TTC saisi 9,99 € (HT 8,33, que HT × 1,2 donnerait à 10,00 €). */
function servicePoseDeFilm(): number {
  return Number(base.sqlite.prepare(
    `INSERT INTO services (boutique_id, nom, prix_ht, prix_ttc, tva_taux, actif) VALUES (1, 'Pose de film', 8.33, 9.99, 20, 1)`,
  ).run().lastInsertRowid)
}

describe('caisse — un service proposé à son TTC stocké', () => {
  it('recherche du catalogue : prix_ttc = 9,99 € (le TTC saisi)', async () => {
    const id = servicePoseDeFilm()
    const service = (await rechercherCatalogue(port(), 1, 'film')).find(r => r.type === 'service' && r.id === id) as any
    expect(service.prix_ttc).toBe(9.99)
  })

  it('favoris : prix_ttc = 9,99 € (le TTC saisi)', async () => {
    const id = servicePoseDeFilm()
    const facture = Number(base.sqlite.prepare(`
      INSERT INTO factures (boutique_id, client_id, numero, total_ht, total_tva, total_ttc, statut, locked, issued_at)
      VALUES (1, 1, 'F-1', 0, 0, 0, 'payee', 1, datetime('now'))
    `).run().lastInsertRowid)
    base.sqlite.prepare(`
      INSERT INTO lignes_document (document_type, document_id, description, quantite, prix_unitaire_ht, tva_taux, service_id)
      VALUES ('facture', ?, 'ligne', 1, 8.33, 20, ?)
    `).run(facture, id)
    const service = (await lireFavorisVente(port(), 1)).find(r => r.type === 'service' && r.id === id) as any
    expect(service.prix_ttc).toBe(9.99)
  })
})
