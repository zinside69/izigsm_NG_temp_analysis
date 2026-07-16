/**
 * tests/creneauxService.test.ts
 * Couverture src/services/creneauxService.ts — planning de créneaux RDV bookables
 * (MOD-14), aucune suite n'existait avant (0 test préexistant, comme
 * phoneCatalogService.ts avant sa migration Ports & Adapters).
 *
 * Fonctions testées :
 *   validateCreneaux  (pure, pas de DB) — 7 tests
 *   listCreneaux      (mockDatabase)    — 2 tests
 *   replaceCreneaux   (mockDatabase)    — 3 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  listCreneaux,
  replaceCreneaux,
  validateCreneaux,
  type CreneauInput,
} from '../src/services/creneauxService'

const CRENEAU_VALIDE: CreneauInput = {
  jour_semaine: 1, heure_debut: '09:00', heure_fin: '18:00', duree_slot: 30,
}

describe('validateCreneaux()', () => {
  it('accepte une liste vide (aucun créneau configuré = pas d\'erreur, juste 0 dispo)', () => {
    expect(validateCreneaux([])).toBeNull()
  })

  it('accepte un créneau valide', () => {
    expect(validateCreneaux([CRENEAU_VALIDE])).toBeNull()
  })

  it('accepte plusieurs créneaux valides sur des jours différents', () => {
    expect(validateCreneaux([
      CRENEAU_VALIDE,
      { jour_semaine: 6, heure_debut: '09:00', heure_fin: '12:30', duree_slot: 45 },
    ])).toBeNull()
  })

  it('rejette jour_semaine hors [1,7]', () => {
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, jour_semaine: 0 }])).toMatch(/jour_semaine/)
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, jour_semaine: 8 }])).toMatch(/jour_semaine/)
  })

  it('rejette un format heure invalide', () => {
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, heure_debut: '9h00' }])).toMatch(/HH:MM/)
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, heure_fin: '25:00' }])).toMatch(/HH:MM/)
  })

  it('rejette heure_debut >= heure_fin', () => {
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, heure_debut: '18:00', heure_fin: '09:00' }])).toMatch(/heure_debut doit précéder/)
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, heure_debut: '09:00', heure_fin: '09:00' }])).toMatch(/heure_debut doit précéder/)
  })

  it('rejette duree_slot hors [5,480]', () => {
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, duree_slot: 2 }])).toMatch(/duree_slot/)
    expect(validateCreneaux([{ ...CRENEAU_VALIDE, duree_slot: 500 }])).toMatch(/duree_slot/)
  })
})

describe('listCreneaux()', () => {
  let db: ReturnType<typeof createMockDatabase>
  beforeEach(() => { db = createMockDatabase() })

  it('retourne les créneaux triés par jour puis heure', async () => {
    db.__setListResponse(`
      SELECT id, boutique_id, jour_semaine, heure_debut, heure_fin, duree_slot, actif
      FROM boutique_creneaux
      WHERE boutique_id = ?
      ORDER BY jour_semaine ASC, heure_debut ASC
    `, [
      { id: 1, boutique_id: 1, jour_semaine: 1, heure_debut: '09:00', heure_fin: '18:00', duree_slot: 30, actif: 1 },
    ])
    const rows = await listCreneaux(db, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0].jour_semaine).toBe(1)
  })

  it('retourne un tableau vide si aucun créneau configuré', async () => {
    db.__setListResponse(`
      SELECT id, boutique_id, jour_semaine, heure_debut, heure_fin, duree_slot, actif
      FROM boutique_creneaux
      WHERE boutique_id = ?
      ORDER BY jour_semaine ASC, heure_debut ASC
    `, [])
    const rows = await listCreneaux(db, 2)
    expect(rows).toEqual([])
  })
})

describe('replaceCreneaux()', () => {
  let db: ReturnType<typeof createMockDatabase>
  beforeEach(() => { db = createMockDatabase() })

  it('supprime le planning existant avant de réinsérer', async () => {
    await replaceCreneaux(db, 1, [CRENEAU_VALIDE])
    const calls = db.__getCalls()
    expect(calls[0].sql).toMatch(/DELETE FROM boutique_creneaux WHERE boutique_id = \?/)
    expect(calls[0].params).toEqual([1])
  })

  it('insère une ligne par créneau fourni', async () => {
    await replaceCreneaux(db, 1, [
      CRENEAU_VALIDE,
      { jour_semaine: 2, heure_debut: '10:00', heure_fin: '12:00', duree_slot: 60 },
    ])
    const inserts = db.__getCalls().filter(c => c.sql.includes('INSERT INTO boutique_creneaux'))
    expect(inserts).toHaveLength(2)
    expect(inserts[1].params).toEqual([1, 2, '10:00', '12:00', 60])
  })

  it('ne réinsère rien si la liste est vide (efface le planning)', async () => {
    await replaceCreneaux(db, 1, [])
    const inserts = db.__getCalls().filter(c => c.sql.includes('INSERT INTO boutique_creneaux'))
    expect(inserts).toHaveLength(0)
  })
})
