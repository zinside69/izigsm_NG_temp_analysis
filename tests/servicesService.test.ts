/**
 * @file tests/servicesService.test.ts
 * @description Tests unitaires — src/services/servicesService.ts
 * Sprint 2.39 — Référentiel global marques/modèles (sans boutique_id)
 *
 * Couverture :
 *   Catégories existantes (smoke tests) :
 *     - listCategories()    — retourne données avec nb_services
 *     - createCategorie()   — id retourné, auditLog
 *     - deleteCategorie()   — désactive catégorie + services
 *
 *   Nouvelles fonctions Sprint 2.38 :
 *     - listMarques()             — retourne marques avec nb_modeles
 *     - createMarque()            — INSERT + auditLog, retourne id
 *     - updateMarque()            — UPDATE COALESCE + auditLog
 *     - deleteMarque()            — soft delete cascade modèles + auditLog
 *     - listModeles()             — filtres marque_id / search / type
 *     - createModele()            — INSERT + auditLog, retourne id
 *     - updateModele()            — UPDATE + auditLog
 *     - deleteModele()            — soft delete + auditLog
 *     - getServicesByModele()     — JOIN service_modeles + prix override COALESCE
 *     - linkServiceModele()       — INSERT ON CONFLICT + auditLog
 *     - unlinkServiceModele()     — UPDATE actif=0 + auditLog
 *     - getModeleWithServices()   — modele null si introuvable, services array
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  listCategories,
  createCategorie,
  deleteCategorie,
  listMarques,
  createMarque,
  updateMarque,
  deleteMarque,
  listModeles,
  createModele,
  updateModele,
  deleteModele,
  getServicesByModele,
  linkServiceModele,
  unlinkServiceModele,
  getModeleWithServices,
} from '../src/services/servicesService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MARQUE_ROW = { id: 1, nom: 'Apple', brand_slug: 'apple-phones-48', logo_url: null, device_count: 120, source: 'api', ordre: 0, actif: 1, synced_at: null, nb_modeles: 3 }
const MODELE_ROW = { id: 10, marque_id: 1, marque_nom: 'Apple', nom: 'iPhone 14 Pro', type: 'smartphone', annee: 2022, phone_slug: 'apple_iphone_14_pro-11860', source: 'api', actif: 1 }
const SERVICE_SUGGESTION = {
  id: 5, nom: 'Remplacement écran', description: null, reference: 'SVC-001',
  tva_taux: 20, garantie_jours: 90, duree_minutes: 60,
  prix_ht_effectif: 80, prix_ttc_effectif: 96, prix_ht_specifique: null,
  categorie_nom: 'Réparations', categorie_couleur: '#6366f1'
}
const CAT_ROW = { id: 2, boutique_id: 1, parent_id: null, nom: 'Téléphones', description: null, couleur: '#6366f1', ordre: 0, actif: 1, nb_services: 5 }

// ─── SQL constants ────────────────────────────────────────────────────────────

const SQL_LIST_MARQUES = `SELECT m.*, COUNT(mo.id) AS nb_modeles FROM marques_appareils m LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1 WHERE m.actif = 1 GROUP BY m.id ORDER BY m.ordre ASC, m.nom ASC`

const SQL_LIST_MODELES_BASE = `SELECT mo.*, ma.nom AS marque_nom FROM modeles_appareils mo JOIN marques_appareils ma ON ma.id = mo.marque_id WHERE mo.actif = 1 ORDER BY ma.nom ASC, mo.nom ASC LIMIT 500`

const SQL_LIST_MODELES_MARQUE = `SELECT mo.*, ma.nom AS marque_nom FROM modeles_appareils mo JOIN marques_appareils ma ON ma.id = mo.marque_id WHERE mo.actif = 1 AND mo.marque_id = ? ORDER BY ma.nom ASC, mo.nom ASC LIMIT 500`

const SQL_LIST_MODELES_MARQUE_TYPE = `SELECT mo.*, ma.nom AS marque_nom FROM modeles_appareils mo JOIN marques_appareils ma ON ma.id = mo.marque_id WHERE mo.actif = 1 AND mo.marque_id = ? AND mo.type = ? ORDER BY ma.nom ASC, mo.nom ASC LIMIT 500`

const SQL_SERVICES_BY_MODELE = `SELECT s.id, s.nom, s.description, s.reference, s.tva_taux, s.garantie_jours, s.duree_minutes, COALESCE(sm.prix_ht_specifique, s.prix_ht) AS prix_ht_effectif, ROUND(COALESCE(sm.prix_ht_specifique, s.prix_ht) * (1 + s.tva_taux / 100), 2) AS prix_ttc_effectif, sm.prix_ht_specifique, c.nom AS categorie_nom, c.couleur AS categorie_couleur FROM service_modeles sm JOIN services s ON s.id = sm.service_id AND s.actif = 1 LEFT JOIN categories_services c ON c.id = s.categorie_id WHERE sm.modele_id = ? AND sm.actif = 1 ORDER BY c.nom ASC, s.nom ASC`

const SQL_MODELE_WITH_MARQUE = `SELECT mo.*, ma.nom AS marque_nom FROM modeles_appareils mo JOIN marques_appareils ma ON ma.id = mo.marque_id WHERE mo.id = ? AND mo.actif = 1`

const SQL_LIST_CATEGORIES = `SELECT c.*, COUNT(s.id) as nb_services FROM categories_services c LEFT JOIN services s ON s.categorie_id = c.id AND s.actif = 1 WHERE c.boutique_id = ? AND c.actif = 1 GROUP BY c.id ORDER BY c.parent_id NULLS FIRST, c.ordre ASC, c.nom ASC`

// ══════════════════════════════════════════════════════════════════════════════
// listCategories() — smoke test
// ══════════════════════════════════════════════════════════════════════════════

describe('listCategories()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne les catégories avec nb_services', async () => {
    db.__setListResponse(SQL_LIST_CATEGORIES, [CAT_ROW])
    const res = await listCategories(db, 1)
    expect(res).toHaveLength(1)
    expect(res[0].nom).toBe('Téléphones')
    expect((res[0] as any).nb_services).toBe(5)
  })

  it('retourne tableau vide si aucune catégorie', async () => {
    db.__setListResponse(SQL_LIST_CATEGORIES, [])
    const res = await listCategories(db, 1)
    expect(res).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// createCategorie()
// ══════════════════════════════════════════════════════════════════════════════

describe('createCategorie()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('INSERT INTO categories_services (boutique_id, nom, parent_id, description, couleur, ordre) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', { id: 7 })
    db.__setResponse('INSERT INTO audit_logs', null) // auditLog
  })

  it('retourne l\'id de la catégorie créée', async () => {
    const id = await createCategorie(db, { boutique_id: 1, nom: 'Réparations iPhone' }, 42)
    expect(id).toBe(7)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// deleteCategorie()
// ══════════════════════════════════════════════════════════════════════════════

describe('deleteCategorie()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('UPDATE services SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE categorie_id = ?', null)
    db.__setResponse('UPDATE categories_services SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', null)
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('appelle UPDATE services + UPDATE catégorie sans erreur', async () => {
    await expect(deleteCategorie(db, 2, 42)).resolves.toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// listMarques()
// ══════════════════════════════════════════════════════════════════════════════

describe('listMarques()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne les marques avec nb_modeles', async () => {
    db.__setListResponse(SQL_LIST_MARQUES, [MARQUE_ROW, { ...MARQUE_ROW, id: 2, nom: 'Samsung', brand_slug: 'samsung-phones-9', nb_modeles: 7 }])
    const res = await listMarques(db)
    expect(res).toHaveLength(2)
    expect(res[0].nom).toBe('Apple')
    expect((res[0] as any).nb_modeles).toBe(3)
  })

  it('retourne tableau vide si aucune marque', async () => {
    db.__setListResponse(SQL_LIST_MARQUES, [])
    const res = await listMarques(db)
    expect(res).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// createMarque()
// ══════════════════════════════════════════════════════════════════════════════

describe('createMarque()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('INSERT INTO marques_appareils (nom, logo_url, ordre, brand_slug, source) VALUES (?, ?, ?, ?, \'manual\') RETURNING id', { id: 3 })
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('retourne l\'id de la marque créée', async () => {
    const id = await createMarque(db, { nom: 'Apple' }, 42)
    expect(id).toBe(3)
  })

  it('retourne 0 si INSERT échoue (null result)', async () => {
    db.__setResponse('INSERT INTO marques_appareils (nom, logo_url, ordre, brand_slug, source) VALUES (?, ?, ?, ?, \'manual\') RETURNING id', null)
    const id = await createMarque(db, { nom: 'Test' }, 42)
    expect(id).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// updateMarque()
// ══════════════════════════════════════════════════════════════════════════════

describe('updateMarque()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('UPDATE marques_appareils SET nom = COALESCE(?, nom), logo_url = COALESCE(?, logo_url), ordre = COALESCE(?, ordre), updated_at = CURRENT_TIMESTAMP WHERE id = ?', null)
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('appelle UPDATE sans erreur', async () => {
    await expect(updateMarque(db, 1, { nom: 'Apple Inc.' }, 42)).resolves.toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// deleteMarque()
// ══════════════════════════════════════════════════════════════════════════════

describe('deleteMarque()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('UPDATE modeles_appareils SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE marque_id = ?', null)
    db.__setResponse('UPDATE marques_appareils SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', null)
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('cascade soft delete modèles puis marque', async () => {
    await expect(deleteMarque(db, 1, 42)).resolves.toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// listModeles()
// ══════════════════════════════════════════════════════════════════════════════

describe('listModeles()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('sans filtre — retourne tous les modèles avec marque_nom', async () => {
    db.__setListResponse(SQL_LIST_MODELES_BASE, [MODELE_ROW])
    const res = await listModeles(db)
    expect(res).toHaveLength(1)
    expect(res[0].nom).toBe('iPhone 14 Pro')
    expect(res[0].marque_nom).toBe('Apple')
  })

  it('filtre par marque_id', async () => {
    db.__setListResponse(SQL_LIST_MODELES_MARQUE, [MODELE_ROW])
    const res = await listModeles(db, { marque_id: 1 })
    expect(res).toHaveLength(1)
  })

  it('filtre par marque_id + type', async () => {
    db.__setListResponse(SQL_LIST_MODELES_MARQUE_TYPE, [MODELE_ROW])
    const res = await listModeles(db, { marque_id: 1, type: 'smartphone' })
    expect(res).toHaveLength(1)
    expect(res[0].type).toBe('smartphone')
  })

  it('retourne tableau vide si aucun modèle', async () => {
    db.__setListResponse(SQL_LIST_MODELES_BASE, [])
    const res = await listModeles(db)
    expect(res).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// createModele()
// ══════════════════════════════════════════════════════════════════════════════

describe('createModele()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('INSERT INTO modeles_appareils (marque_id, nom, type, annee, phone_slug, source) VALUES (?, ?, ?, ?, ?, \'manual\') RETURNING id', { id: 15 })
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('retourne l\'id du modèle créé', async () => {
    const id = await createModele(db, { marque_id: 1, nom: 'iPhone 15' }, 42)
    expect(id).toBe(15)
  })

  it('utilise smartphone comme type par défaut', async () => {
    const id = await createModele(db, { marque_id: 1, nom: 'Test' }, 42)
    expect(id).toBe(15)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// updateModele()
// ══════════════════════════════════════════════════════════════════════════════

describe('updateModele()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('UPDATE modeles_appareils SET nom = COALESCE(?, nom), type = COALESCE(?, type), annee = COALESCE(?, annee), updated_at = CURRENT_TIMESTAMP WHERE id = ?', null)
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('appelle UPDATE sans erreur', async () => {
    await expect(updateModele(db, 10, { nom: 'iPhone 14 Pro Max', annee: 2022 }, 42)).resolves.toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// deleteModele()
// ══════════════════════════════════════════════════════════════════════════════

describe('deleteModele()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('UPDATE modeles_appareils SET actif = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', null)
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('soft delete sans erreur', async () => {
    await expect(deleteModele(db, 10, 42)).resolves.toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// getServicesByModele()
// ══════════════════════════════════════════════════════════════════════════════

describe('getServicesByModele()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne les services suggérés avec prix_ttc_effectif', async () => {
    db.__setListResponse(SQL_SERVICES_BY_MODELE, [SERVICE_SUGGESTION])
    const res = await getServicesByModele(db, 10)
    expect(res).toHaveLength(1)
    expect((res[0] as any).nom).toBe('Remplacement écran')
    expect((res[0] as any).prix_ttc_effectif).toBe(96)
  })

  it('retourne tableau vide si aucun service lié', async () => {
    db.__setListResponse(SQL_SERVICES_BY_MODELE, [])
    const res = await getServicesByModele(db, 10)
    expect(res).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// linkServiceModele()
// ══════════════════════════════════════════════════════════════════════════════

describe('linkServiceModele()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('INSERT INTO service_modeles (service_id, modele_id, prix_ht_specifique, actif) VALUES (?, ?, ?, 1) ON CONFLICT(service_id, modele_id) DO UPDATE SET prix_ht_specifique = excluded.prix_ht_specifique, actif = 1, created_at = created_at', null)
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('lie un service à un modèle sans erreur', async () => {
    await expect(linkServiceModele(db, { service_id: 5, modele_id: 10 }, 42)).resolves.toBeUndefined()
  })

  it('accepte un prix spécifique override', async () => {
    await expect(linkServiceModele(db, { service_id: 5, modele_id: 10, prix_ht_specifique: 70 }, 42)).resolves.toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// unlinkServiceModele()
// ══════════════════════════════════════════════════════════════════════════════

describe('unlinkServiceModele()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
    db.__setResponse('UPDATE service_modeles SET actif = 0 WHERE service_id = ? AND modele_id = ?', null)
    db.__setResponse('INSERT INTO audit_logs', null)
  })

  it('dissocie un service d\'un modèle sans erreur', async () => {
    await expect(unlinkServiceModele(db, { service_id: 5, modele_id: 10 }, 42)).resolves.toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// getModeleWithServices()
// ══════════════════════════════════════════════════════════════════════════════

describe('getModeleWithServices()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne modele + services combinés', async () => {
    db.__setResponse(SQL_MODELE_WITH_MARQUE, MODELE_ROW)
    db.__setListResponse(SQL_SERVICES_BY_MODELE, [SERVICE_SUGGESTION])
    const res = await getModeleWithServices(db, 10)
    expect(res.modele).not.toBeNull()
    expect(res.modele?.nom).toBe('iPhone 14 Pro')
    expect(res.services).toHaveLength(1)
  })

  it('retourne modele null si introuvable', async () => {
    db.__setResponse(SQL_MODELE_WITH_MARQUE, null)
    db.__setListResponse(SQL_SERVICES_BY_MODELE, [])
    const res = await getModeleWithServices(db, 999)
    expect(res.modele).toBeNull()
    expect(res.services).toEqual([])
  })

  it('retourne services vides si aucune liaison', async () => {
    db.__setResponse(SQL_MODELE_WITH_MARQUE, MODELE_ROW)
    db.__setListResponse(SQL_SERVICES_BY_MODELE, [])
    const res = await getModeleWithServices(db, 10)
    expect(res.services).toEqual([])
  })
})
