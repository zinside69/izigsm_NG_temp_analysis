import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import {
  createService, updateService, getService, listServices, linkServiceModele, getServicesByModele,
} from '../src/services/servicesService'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'

/**
 * Services et prix par modèle en TTC (ticket 04 du chantier prix TTC, décisions Q1 et Q20 de
 * l'exploitant du 2026-10-04) : le prix TTC fait foi et est stocké ; le HT s'en déduit. Un ancien
 * écran qui n'envoie que le HT est converti (transition). Un prix par modèle se convertit au taux du
 * service. Taux du service changé sans nouveau prix : HT gardé, TTC recalculé — prix par modèle compris.
 *
 * Contre un vrai SQLite au schéma réel (migration 0064 comprise). Montants calculés à la main.
 */

let base: BaseReelle
const port = () => new D1DatabaseAdapter(base.d1)

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'B1');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'manager@b1.fr', 'x', 'Man', 'Ager', 2, 1, 1);
    INSERT INTO marques_appareils (id, nom) VALUES (1, 'Apple');
    INSERT INTO modeles_appareils (id, marque_id, nom) VALUES (1, 1, 'iPhone 12');
  `)
})

const serviceEnBase = (id: number) =>
  base.sqlite.prepare('SELECT prix_ht, prix_ttc, tva_taux FROM services WHERE id = ?').get(id)
const prixModeleEnBase = (serviceId: number) =>
  base.sqlite.prepare('SELECT prix_ht_specifique, prix_ttc_specifique FROM service_modeles WHERE service_id = ? AND modele_id = 1').get(serviceId)

describe('createService() — TTC de référence', () => {
  it('TTC saisi 49,90 € : stocké tel quel, HT déduit 41,58', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Pose de film', prix_ttc: 49.9, tva_taux: 20 } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 41.58, prix_ttc: 49.9, tva_taux: 20 })
  })

  it('HT seul (ancien écran) : converti, 50 € HT → 60 € TTC', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Diagnostic', prix_ht: 50, tva_taux: 20 } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 50, prix_ttc: 60, tva_taux: 20 })
  })

  it('TTC et HT envoyés : le TTC est prioritaire', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Nettoyage', prix_ttc: 30, prix_ht: 99, tva_taux: 20 } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 25, prix_ttc: 30, tva_taux: 20 })
  })
})

describe('updateService() — TTC prioritaire, taux changé → HT gardé', () => {
  it('nouveau TTC 59,90 € : TTC écrit, HT déduit', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Pose', prix_ttc: 49.9, tva_taux: 20 } as any, 1)
    await updateService(base.d1, id, { prix_ttc: 59.9 } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 49.92, prix_ttc: 59.9, tva_taux: 20 })
  })

  it('taux 20 → 10 % sans nouveau prix : HT gardé, TTC recalculé — prix par modèle compris', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Écran', prix_ht: 100, tva_taux: 20 } as any, 1)
    await linkServiceModele(base.d1, { service_id: id, modele_id: 1, prix_ttc_specifique: 129 } as any, 1)
    await updateService(base.d1, id, { tva_taux: 10 } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 100, prix_ttc: 110, tva_taux: 10 })
    // Prix par modèle : HT 107,50 gardé, TTC 107,50 × 1,10 = 118,25
    expect(prixModeleEnBase(id)).toEqual({ prix_ht_specifique: 107.5, prix_ttc_specifique: 118.25 })
  })

  it('formulaire : taux 20 → 10 % avec le TTC renvoyé tel quel → HT gardé, TTC recalculé (Q20, 2026-10-06)', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Écran', prix_ttc: 120, tva_taux: 20 } as any, 1)
    await linkServiceModele(base.d1, { service_id: id, modele_id: 1, prix_ttc_specifique: 150 } as any, 1)
    await updateService(base.d1, id, { nom: 'Écran', prix_ttc: 120, tva_taux: 10 } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 100, prix_ttc: 110, tva_taux: 10 })
    expect(prixModeleEnBase(id)).toEqual({ prix_ht_specifique: 125, prix_ttc_specifique: 137.5 })
  })

  it('taux renvoyé en texte (« 10 ») : traité comme le nombre 10 — jamais concaténé (revue)', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Écran', prix_ttc: 110, tva_taux: '10' } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 100, prix_ttc: 110, tva_taux: 10 })
  })

  it('taux renvoyé à l\'identique avec le reste de la fiche : rien ne bouge (9,99 € reste 9,99 €)', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Coque posée', prix_ttc: 9.99, tva_taux: 20 } as any, 1)
    await updateService(base.d1, id, { nom: 'Coque posée', tva_taux: 20 } as any, 1)
    expect(serviceEnBase(id)).toEqual({ prix_ht: 8.33, prix_ttc: 9.99, tva_taux: 20 })
  })
})

describe('linkServiceModele() — prix par modèle en TTC, au taux du service', () => {
  it('TTC 129 € : stocké tel quel, HT déduit 107,50', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Écran', prix_ttc: 99, tva_taux: 20 } as any, 1)
    await linkServiceModele(base.d1, { service_id: id, modele_id: 1, prix_ttc_specifique: 129 } as any, 1)
    expect(prixModeleEnBase(id)).toEqual({ prix_ht_specifique: 107.5, prix_ttc_specifique: 129 })
  })

  it('HT seul (ancien écran) : converti, 99,99 € HT → 119,99 € TTC', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Écran', prix_ttc: 99, tva_taux: 20 } as any, 1)
    await linkServiceModele(base.d1, { service_id: id, modele_id: 1, prix_ht_specifique: 99.99 } as any, 1)
    expect(prixModeleEnBase(id)).toEqual({ prix_ht_specifique: 99.99, prix_ttc_specifique: 119.99 })
  })

  it('aucun prix : pas de prix spécifique (le prix du service s\'applique)', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Écran', prix_ttc: 99, tva_taux: 20 } as any, 1)
    await linkServiceModele(base.d1, { service_id: id, modele_id: 1 } as any, 1)
    expect(prixModeleEnBase(id)).toEqual({ prix_ht_specifique: null, prix_ttc_specifique: null })
  })
})

describe('lectures — le TTC stocké, jamais recalculé depuis le HT', () => {
  it('getService / listServices rendent le TTC saisi (9,99 €, que HT × 1,2 donnerait à 10,00 €)', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Coque posée', prix_ttc: 9.99, tva_taux: 20 } as any, 1)
    base.sqlite.prepare('UPDATE services SET prix_ht = 8.33 WHERE id = ?').run(id)
    expect((await getService(port(), id))?.prix_ttc).toBe(9.99)
    const liste = await listServices(port(), 1, {})
    expect((liste.data as any[]).find(s => s.id === id).prix_ttc).toBe(9.99)
  })

  it('getServicesByModele : TTC effectif = prix par modèle s\'il existe, sinon celui du service', async () => {
    const avecPrix = await createService(base.d1, { boutique_id: 1, nom: 'Écran', prix_ttc: 99, tva_taux: 20 } as any, 1)
    const sansPrix = await createService(base.d1, { boutique_id: 1, nom: 'Batterie', prix_ttc: 59.9, tva_taux: 20 } as any, 1)
    await linkServiceModele(base.d1, { service_id: avecPrix, modele_id: 1, prix_ttc_specifique: 129 } as any, 1)
    await linkServiceModele(base.d1, { service_id: sansPrix, modele_id: 1 } as any, 1)
    const services = await getServicesByModele(port(), 1, 1) as any[]
    const ttcEffectif = Object.fromEntries(services.map(s => [s.nom, s.prix_ttc_effectif]))
    expect(ttcEffectif).toEqual({ 'Écran': 129, 'Batterie': 59.9 })
  })
})

describe('vitrine publique — le TTC stocké du service', () => {
  it('getServicesPublics rend prix_ttc = 9,99 € (le TTC saisi, que HT × 1,2 donnerait à 10,00 €)', async () => {
    const { getServicesPublics } = await import('../src/services/publicService')
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Coque posée', prix_ttc: 9.99, tva_taux: 20 } as any, 1)
    const services = await getServicesPublics(port(), 1) as any[]
    expect(services.find(s => s.id === id).prix_ttc).toBe(9.99)
  })
})
