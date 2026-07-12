/**
 * tests/personnelService.test.ts
 * Sprint 2.30 — Couverture personnelService.ts
 *
 * Fonctions testées :
 *   TRANSITIONS_POINTAGE  (2 tests — constantes)
 *   STATUT_LABELS         (1 test)
 *   listEmployes          (3 tests)
 *   getEmploye            (3 tests)
 *   createEmploye         (4 tests)
 *   updateEmploye         (3 tests)
 *   desactiverEmploye     (2 tests)
 *   pointer               (8 tests)
 *   pointagesAujourdhui   (4 tests)
 *   rapportPointage       (2 tests)
 *   statutsTempsReel      (4 tests)
 *
 * Total : 36 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  TRANSITIONS_POINTAGE,
  STATUT_LABELS,
  listEmployes,
  getEmploye,
  createEmploye,
  updateEmploye,
  desactiverEmploye,
  pointer,
  pointagesAujourdhui,
  rapportPointage,
  statutsTempsReel,
  type StatutPointage,
} from '../src/services/personnelService'

// ─── SQL normalisés ───────────────────────────────────────────────────────────

const SQL_LIST_EMPLOYES = `SELECT e.id, e.prenom, e.nom, e.poste, e.email, e.telephone, e.statut_pointage, e.commission_pct, e.taux_horaire, e.actif, p.horodatage as dernier_pointage, ROUND( (SELECT SUM( (julianday(p2.horodatage) - julianday(p1.horodatage)) * 24 ) FROM pointages p1 JOIN pointages p2 ON p2.employe_id = p1.employe_id AND p2.id = ( SELECT MIN(id) FROM pointages WHERE employe_id = p1.employe_id AND id > p1.id AND DATE(horodatage) = ? ) WHERE p1.employe_id = e.id AND (p1.statut_avant = 'absent' OR p1.statut_avant = 'pause') AND p1.statut_apres = 'en_poste' AND DATE(p1.horodatage) = ? ), 2 ) as heures_aujourd_hui FROM employes e LEFT JOIN pointages p ON p.id = ( SELECT MAX(id) FROM pointages WHERE employe_id = e.id ) WHERE e.boutique_id = ? AND e.actif = 1 ORDER BY e.prenom, e.nom`

const SQL_GET_EMPLOYE = `SELECT * FROM employes WHERE id = ? AND actif = 1`

const SQL_GET_POINTAGES = `SELECT p.*, u.prenom || ' ' || u.nom as valide_par_nom FROM pointages p LEFT JOIN users u ON u.id = p.valide_par WHERE p.employe_id = ? ORDER BY p.horodatage DESC LIMIT 50`

const SQL_INSERT_EMPLOYE = `INSERT INTO employes (boutique_id, user_id, prenom, nom, poste, email, telephone, taux_horaire, commission_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`

const SQL_AUDIT_LOG = `INSERT INTO audit_logs (boutique_id, user_id, action, entite_type, entite_id, donnees_avant, donnees_apres, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

const SQL_UPDATE_EMPLOYE = `UPDATE employes SET prenom = ?, nom = ?, poste = ?, email = ?, telephone = ?, taux_horaire = ?, commission_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

const SQL_DESACTIVER = `UPDATE employes SET actif = 0 WHERE id = ?`

const SQL_GET_EMPLOYE_POINTER = `SELECT id, prenom, nom, statut_pointage, boutique_id FROM employes WHERE id = ? AND actif = 1`

const SQL_INSERT_POINTAGE = `INSERT INTO pointages (employe_id, boutique_id, statut_avant, statut_apres, latitude, longitude, valide_par, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

const SQL_UPDATE_STATUT_EMPLOYE = `UPDATE employes SET statut_pointage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`

const SQL_POINTAGES_AUJOURDHUI = `SELECT p.*, u.prenom || ' ' || u.nom as valide_par_nom FROM pointages p LEFT JOIN users u ON u.id = p.valide_par WHERE p.employe_id = ? AND DATE(p.horodatage) = ? ORDER BY p.horodatage ASC`

const SQL_RAPPORT = `SELECT e.id, e.prenom, e.nom, e.poste, COUNT(DISTINCT DATE(p.horodatage)) as jours_presents, MIN(p.horodatage) as premiere_entree, MAX(p.horodatage) as derniere_sortie FROM employes e LEFT JOIN pointages p ON p.employe_id = e.id AND DATE(p.horodatage) BETWEEN ? AND ? AND p.statut_apres = 'en_poste' WHERE e.boutique_id = ? AND e.actif = 1 GROUP BY e.id ORDER BY e.nom, e.prenom`

const SQL_STATUTS_TEMPS_REEL = `SELECT e.id, e.prenom, e.nom, e.poste, e.statut_pointage, p.horodatage as depuis FROM employes e LEFT JOIN pointages p ON p.id = ( SELECT MAX(id) FROM pointages WHERE employe_id = e.id ) WHERE e.boutique_id = ? AND e.actif = 1 ORDER BY e.prenom`

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EMPLOYE_ROW = {
  id: 3, boutique_id: 1, prenom: 'Jean', nom: 'Tech',
  poste: 'technicien', email: 'jean@boutique.com', telephone: null,
  taux_horaire: 12.5, commission_pct: 5, actif: 1,
  statut_pointage: 'absent' as StatutPointage,
  created_at: '2026-01-01T08:00:00Z', updated_at: '2026-01-01T08:00:00Z',
}

// ─── TRANSITIONS_POINTAGE ─────────────────────────────────────────────────────

describe('TRANSITIONS_POINTAGE', () => {
  it('machine à états correcte : absent → [en_poste]', () => {
    expect(TRANSITIONS_POINTAGE.absent).toEqual(['en_poste'])
    expect(TRANSITIONS_POINTAGE.en_poste).toEqual(['pause', 'termine'])
    expect(TRANSITIONS_POINTAGE.pause).toEqual(['en_poste'])
    expect(TRANSITIONS_POINTAGE.termine).toEqual([])
  })

  it('termine = état terminal (aucune transition)', () => {
    expect(TRANSITIONS_POINTAGE.termine).toHaveLength(0)
  })
})

// ─── STATUT_LABELS ────────────────────────────────────────────────────────────

describe('STATUT_LABELS', () => {
  it('4 labels définis pour les 4 statuts', () => {
    expect(STATUT_LABELS.absent).toBeTruthy()
    expect(STATUT_LABELS.en_poste).toBeTruthy()
    expect(STATUT_LABELS.pause).toBeTruthy()
    expect(STATUT_LABELS.termine).toBeTruthy()
  })
})

// ─── listEmployes ─────────────────────────────────────────────────────────────

describe('listEmployes', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne la liste des employés actifs', async () => {
    db.__setListResponse(SQL_LIST_EMPLOYES, [EMPLOYE_ROW])

    const result = await listEmployes(db, 1)

    expect(result).toHaveLength(1)
    expect(result[0].prenom).toBe('Jean')
  })

  it('retourne tableau vide si aucun employé', async () => {
    db.__setListResponse(SQL_LIST_EMPLOYES, [])

    const result = await listEmployes(db, 1)

    expect(result).toHaveLength(0)
  })

  it('boutique_id transmis comme dernier binding (après les 2 dates du jour)', async () => {
    db.__setListResponse(SQL_LIST_EMPLOYES, [])

    await listEmployes(db, 42)

    const calls = db.__getCalls()
    const listCall = calls.find(c => c.sql.includes('FROM employes e'))
    expect(listCall!.params).toHaveLength(3)
    expect(listCall!.params[2]).toBe(42)
    // Les 2 premiers params sont todayParis() (YYYY-MM-DD), identiques entre eux
    expect(listCall!.params[0]).toBe(listCall!.params[1])
    expect(listCall!.params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ─── getEmploye ───────────────────────────────────────────────────────────────

describe('getEmploye', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne employé + pointages si trouvé', async () => {
    db.__setResponse(SQL_GET_EMPLOYE, EMPLOYE_ROW)
    db.__setListResponse(SQL_GET_POINTAGES, [
      { id: 1, statut_apres: 'en_poste', horodatage: '2026-07-05T08:00:00Z' },
    ])

    const result = await getEmploye(db, 3)

    expect(result).not.toBeNull()
    expect(result!.prenom).toBe('Jean')
    expect(result!.pointages).toHaveLength(1)
  })

  it('retourne null si employé introuvable', async () => {
    db.__setResponse(SQL_GET_EMPLOYE, null)

    const result = await getEmploye(db, 999)

    expect(result).toBeNull()
  })

  it('pointages vide si aucun pointage', async () => {
    db.__setResponse(SQL_GET_EMPLOYE, EMPLOYE_ROW)
    db.__setListResponse(SQL_GET_POINTAGES, [])

    const result = await getEmploye(db, 3)

    expect(result!.pointages).toHaveLength(0)
  })
})

// ─── createEmploye ────────────────────────────────────────────────────────────

describe('createEmploye', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne { id } après INSERT', async () => {
    db.__setResponse(SQL_INSERT_EMPLOYE, { id: 10 })

    const result = await createEmploye(db as any, 1, 5, {
      prenom: 'Paul', nom: 'Dupont', poste: 'technicien',
    })

    expect(result.id).toBe(10)
  })

  it('poste défaut = technicien si non fourni', async () => {
    db.__setResponse(SQL_INSERT_EMPLOYE, { id: 1 })

    await createEmploye(db as any, 1, 5, { prenom: 'A', nom: 'B' })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO employes'))
    // (boutique_id, user_id, prenom, nom, poste, email, tel, taux_horaire, commission_pct)
    expect(insertCall!.params[4]).toBe('technicien')
  })

  it('commission_pct défaut = 0 si non fourni', async () => {
    db.__setResponse(SQL_INSERT_EMPLOYE, { id: 1 })

    await createEmploye(db as any, 1, 5, { prenom: 'A', nom: 'B' })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO employes'))
    expect(insertCall!.params[8]).toBe(0) // commission_pct
  })

  it('audit log INSERT écrit après création', async () => {
    db.__setResponse(SQL_INSERT_EMPLOYE, { id: 10 })

    await createEmploye(db as any, 1, 5, { prenom: 'Paul', nom: 'Dupont' })

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.includes('INSERT INTO audit_logs'))
    expect(auditCall).toBeDefined()
    expect(auditCall!.params[2]).toBe('CREATE_EMPLOYE')
  })
})

// ─── updateEmploye ────────────────────────────────────────────────────────────

describe('updateEmploye', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('SQL UPDATE envoyé avec le bon id en dernier param', async () => {
    await updateEmploye(db, 7, { prenom: 'A', nom: 'B' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE employes SET prenom'))
    expect(updateCall!.params[updateCall!.params.length - 1]).toBe(7)
  })

  it('poste défaut = technicien si non fourni', async () => {
    await updateEmploye(db, 3, { prenom: 'A', nom: 'B' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE employes SET prenom'))
    // (prenom, nom, poste, email, tel, taux_horaire, commission_pct, id)
    expect(updateCall!.params[2]).toBe('technicien')
  })

  it('commission_pct défaut = 0 si non fourni', async () => {
    await updateEmploye(db, 3, { prenom: 'A', nom: 'B' })

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE employes SET prenom'))
    expect(updateCall!.params[6]).toBe(0) // commission_pct
  })
})

// ─── desactiverEmploye ────────────────────────────────────────────────────────

describe('desactiverEmploye', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('SQL UPDATE actif=0 envoyé', async () => {
    await desactiverEmploye(db, 3)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql === SQL_DESACTIVER)
    expect(updateCall).toBeDefined()
    expect(updateCall!.params[0]).toBe(3)
  })

  it('SQL SET actif = 0 WHERE id = ?', async () => {
    await desactiverEmploye(db, 99)

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('SET actif = 0 WHERE id = ?'))
    expect(updateCall!.params[0]).toBe(99)
  })
})

// ─── pointer ──────────────────────────────────────────────────────────────────

describe('pointer', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  function setupEmploye(statut: StatutPointage) {
    db.__setResponse(SQL_GET_EMPLOYE_POINTER, {
      ...EMPLOYE_ROW, statut_pointage: statut,
    })
  }

  it('absent → en_poste : transition automatique', async () => {
    setupEmploye('absent')

    const result = await pointer(db, 3, 5)

    expect(result.statut_avant).toBe('absent')
    expect(result.statut_apres).toBe('en_poste')
  })

  it('en_poste → pause : transition explicite', async () => {
    setupEmploye('en_poste')

    const result = await pointer(db, 3, 5, { statut: 'pause' })

    expect(result.statut_apres).toBe('pause')
  })

  it('en_poste → termine : transition explicite', async () => {
    setupEmploye('en_poste')

    const result = await pointer(db, 3, 5, { statut: 'termine' })

    expect(result.statut_apres).toBe('termine')
  })

  it('termine → aucune transition : lève JOURNEE_TERMINEE', async () => {
    setupEmploye('termine')

    await expect(pointer(db, 3, 5)).rejects.toMatchObject({
      code: 'JOURNEE_TERMINEE',
    })
  })

  it('transition invalide : lève TRANSITION_INVALIDE', async () => {
    setupEmploye('absent')

    await expect(pointer(db, 3, 5, { statut: 'termine' })).rejects.toMatchObject({
      code: 'TRANSITION_INVALIDE',
    })
  })

  it('employé introuvable : lève Error', async () => {
    db.__setResponse(SQL_GET_EMPLOYE_POINTER, null)

    await expect(pointer(db, 999, 5)).rejects.toThrow('Employé introuvable.')
  })

  it('prochaines_transitions = TRANSITIONS_POINTAGE[statut_apres]', async () => {
    setupEmploye('absent')

    const result = await pointer(db, 3, 5)

    expect(result.prochaines_transitions).toEqual(TRANSITIONS_POINTAGE['en_poste'])
  })

  it('INSERT pointage + UPDATE employe écrits', async () => {
    setupEmploye('absent')

    await pointer(db, 3, 5)

    const calls = db.__getCalls()
    expect(calls.find(c => c.sql.includes('INSERT INTO pointages'))).toBeDefined()
    expect(calls.find(c => c.sql.includes('UPDATE employes SET statut_pointage'))).toBeDefined()
  })
})

// ─── pointagesAujourdhui ──────────────────────────────────────────────────────

describe('pointagesAujourdhui', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne tableau vide + heures_travaillees=0 si aucun pointage', async () => {
    db.__setListResponse(SQL_POINTAGES_AUJOURDHUI, [])

    const result = await pointagesAujourdhui(db, 3)

    expect(result.pointages).toHaveLength(0)
    expect(result.heures_travaillees).toBe(0)
  })

  it('calcule heures si en_poste→pause', async () => {
    const debut = new Date('2026-07-05T08:00:00.000Z').toISOString()
    const fin   = new Date('2026-07-05T10:00:00.000Z').toISOString()

    db.__setListResponse(SQL_POINTAGES_AUJOURDHUI, [
      { id: 1, statut_apres: 'en_poste', horodatage: debut },
      { id: 2, statut_apres: 'pause',    horodatage: fin   },
    ])

    const result = await pointagesAujourdhui(db, 3)

    expect(result.heures_travaillees).toBe(2) // 2h exactes
  })

  it('calcule heures pour deux blocs en_poste→pause + pause→en_poste→termine', async () => {
    const t = (h: number) => new Date(Date.UTC(2026, 6, 5, h, 0, 0)).toISOString()

    db.__setListResponse(SQL_POINTAGES_AUJOURDHUI, [
      { statut_apres: 'en_poste', horodatage: t(8) },   // début bloc 1
      { statut_apres: 'pause',    horodatage: t(10) },  // fin bloc 1 → 2h
      { statut_apres: 'en_poste', horodatage: t(11) },  // début bloc 2
      { statut_apres: 'termine',  horodatage: t(13) },  // fin bloc 2 → 2h
    ])

    const result = await pointagesAujourdhui(db, 3)

    expect(result.heures_travaillees).toBe(4) // 2+2
  })

  it('retourne les pointages dans result.pointages', async () => {
    db.__setListResponse(SQL_POINTAGES_AUJOURDHUI, [
      { id: 1, statut_apres: 'en_poste', horodatage: '2026-07-05T08:00:00Z' },
    ])

    const result = await pointagesAujourdhui(db, 3)

    expect(result.pointages).toHaveLength(1)
  })
})

// ─── rapportPointage ──────────────────────────────────────────────────────────

describe('rapportPointage', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne le résultat SQL groupé par employé', async () => {
    db.__setListResponse(SQL_RAPPORT, [
      { id: 3, prenom: 'Jean', nom: 'Tech', jours_presents: 5 },
    ])

    const result = await rapportPointage(db, 1, '2026-07-01', '2026-07-05')

    expect(result).toHaveLength(1)
    expect(result[0].jours_presents).toBe(5)
  })

  it('bindings : dateDebut, dateFin, boutiqueId', async () => {
    db.__setListResponse(SQL_RAPPORT, [])

    await rapportPointage(db, 99, '2026-07-01', '2026-07-31')

    const calls = db.__getCalls()
    const rapportCall = calls.find(c => c.sql.includes('jours_presents'))
    expect(rapportCall!.params[0]).toBe('2026-07-01')
    expect(rapportCall!.params[1]).toBe('2026-07-31')
    expect(rapportCall!.params[2]).toBe(99)
  })
})

// ─── statutsTempsReel ─────────────────────────────────────────────────────────

describe('statutsTempsReel', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne { data, resume, details }', async () => {
    db.__setListResponse(SQL_STATUTS_TEMPS_REEL, [])

    const result = await statutsTempsReel(db, 1)

    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('resume')
    expect(result).toHaveProperty('details')
  })

  it('resume.total = nombre total d\'employés', async () => {
    db.__setListResponse(SQL_STATUTS_TEMPS_REEL, [
      { id: 1, statut_pointage: 'en_poste', prenom: 'A', nom: 'B', poste: 'tech', depuis: null },
      { id: 2, statut_pointage: 'absent',   prenom: 'C', nom: 'D', poste: 'tech', depuis: null },
    ])

    const result = await statutsTempsReel(db, 1)

    expect(result.resume.total).toBe(2)
    expect(result.resume.en_poste).toBe(1)
    expect(result.resume.absent).toBe(1)
  })

  it('details groupé par statut_pointage', async () => {
    db.__setListResponse(SQL_STATUTS_TEMPS_REEL, [
      { id: 1, statut_pointage: 'en_poste', prenom: 'A', nom: 'B', poste: 'tech', depuis: null },
      { id: 2, statut_pointage: 'pause',    prenom: 'C', nom: 'D', poste: 'tech', depuis: null },
    ])

    const result = await statutsTempsReel(db, 1)

    expect(result.details['en_poste']).toHaveLength(1)
    expect(result.details['pause']).toHaveLength(1)
  })

  it('resume.pause/termine = 0 si aucun employé dans ces statuts', async () => {
    db.__setListResponse(SQL_STATUTS_TEMPS_REEL, [
      { id: 1, statut_pointage: 'absent', prenom: 'A', nom: 'B', poste: 'tech', depuis: null },
    ])

    const result = await statutsTempsReel(db, 1)

    expect(result.resume.pause).toBe(0)
    expect(result.resume.termine).toBe(0)
  })
})
