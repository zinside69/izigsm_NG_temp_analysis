import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'

/**
 * Services et prix par modèle en TTC (ticket 04 du chantier prix TTC, décisions Q1 et Q8 de
 * l'exploitant du 2026-10-04) : la migration 0064 ajoute le prix TTC du service et le prix TTC
 * spécifique d'un service pour un modèle, et les reprend une fois pour toutes — TTC = HT × (1 + taux),
 * arrondi au centime, taux du service. Les colonnes HT restent intactes (marche arrière).
 *
 * Avant la migration, une requête compte les prix dont le TTC repris ne sera pas « rond »
 * (centimes ni 00 ni 90), pour remettre la liste à l'exploitant.
 *
 * Contre un vrai SQLite au schéma réel, arrêté juste avant 0064.
 */

// @ts-ignore process types not available without @types/node
const RACINE = process.cwd()
const MIGRATION_0064 = readFileSync(join(RACINE, 'migrations', '0064_services_prix_ttc.sql'), 'utf8')
const REQUETE_NON_RONDS = readFileSync(join(RACINE, 'scripts', 'sql', 'prix-ttc-non-ronds-services.sql'), 'utf8')

let base: BaseReelle

/** Un service de la boutique 1 : identifiant, prix HT, taux de TVA. */
function service(id: number, prixHt: number, tauxTva: number) {
  base.sqlite.prepare(`INSERT INTO services (id, boutique_id, nom, prix_ht, tva_taux) VALUES (?, 1, ?, ?, ?)`)
    .run(id, `Service ${id}`, prixHt, tauxTva)
}

/** Un prix spécifique du service `serviceId` pour le modèle `modeleId` (HT, ou NULL = prix du service). */
function prixParModele(serviceId: number, modeleId: number, prixHtSpecifique: number | null) {
  base.sqlite.prepare(`INSERT INTO service_modeles (service_id, modele_id, prix_ht_specifique) VALUES (?, ?, ?)`)
    .run(serviceId, modeleId, prixHtSpecifique)
}

beforeEach(() => {
  base = baseAuSchemaReel('0064')
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'B1');
    INSERT INTO marques_appareils (id, nom) VALUES (1, 'Apple');
    INSERT INTO modeles_appareils (id, marque_id, nom) VALUES (1, 1, 'iPhone 12'), (2, 1, 'iPhone 13');
  `)
  service(1, 50, 20)        // 60,00 → rond
  service(2, 16.66, 20)     // 19,992 → 19,99, pas rond
  service(3, 10, 5.5)       // 10,55, pas rond
  prixParModele(1, 1, 107.5)  // 129,00 → rond
  prixParModele(1, 2, 99.99)  // 119,988 → 119,99, pas rond
  prixParModele(3, 1, null)   // pas de prix spécifique : reste NULL
})

describe('requête des TTC non ronds (services et prix par modèle) — jouée AVANT la migration', () => {
  it('liste les services et les prix par modèle dont le TTC repris n\'aura ni 00 ni 90 centimes', () => {
    const lignes = base.sqlite.prepare(REQUETE_NON_RONDS).all()
    expect(lignes.map((l: any) => [l.nature, l.service_id, l.modele_id, l.prix_ttc_repris])).toEqual([
      ['service',          2, null, 19.99],
      ['service',          3, null, 10.55],
      ['prix par modèle',  1, 2,    119.99],
    ])
  })
})

describe('migration 0064 — TTC repris au centime, HT intact', () => {
  it('services : prix_ttc = HT × (1 + taux), prix_ht inchangé', () => {
    base.sqlite.exec(MIGRATION_0064)
    const lignes = base.sqlite.prepare('SELECT id, prix_ht, prix_ttc FROM services ORDER BY id').all()
    expect(lignes.map((l: any) => [l.id, l.prix_ht, l.prix_ttc])).toEqual([
      [1, 50, 60],
      [2, 16.66, 19.99],
      [3, 10, 10.55],
    ])
  })

  it('prix par modèle : prix_ttc_specifique au taux du service, NULL laissé NULL, HT inchangé', () => {
    base.sqlite.exec(MIGRATION_0064)
    const lignes = base.sqlite.prepare(
      'SELECT service_id, modele_id, prix_ht_specifique, prix_ttc_specifique FROM service_modeles ORDER BY service_id, modele_id',
    ).all()
    expect(lignes.map((l: any) => [l.service_id, l.modele_id, l.prix_ht_specifique, l.prix_ttc_specifique])).toEqual([
      [1, 1, 107.5, 129],
      [1, 2, 99.99, 119.99],
      [3, 1, null, null],
    ])
  })
})
