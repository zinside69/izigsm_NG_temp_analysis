/**
 * tests/rachatService.test.ts
 * Couverture src/services/rachatService.ts — livre de police (art. 321-7).
 *
 * Aucune suite n'existait avant la migration Ports & Adapters (2026-07-12) —
 * écrite à cette occasion pour ne pas migrer du code non couvert.
 *
 * Fonctions testées :
 *   listRachats        (migré → mockDatabase)   — 5 tests
 *   getRachat          (migré → mockDatabase)   — 2 tests
 *   createRachat       (non migré → mockD1)     — 4 tests
 *   updateStatutRachat (non migré → mockD1)     — 3 tests
 *   exportLivrePolice  (migré → mockDatabase)   — 3 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { createMockD1 } from './helpers/mockD1'
import {
  listRachats,
  getRachat,
  createRachat,
  updateStatutRachat,
  exportLivrePolice,
  type CreateRachatInput,
} from '../src/services/rachatService'

function n(sql: string) { return sql.replace(/\s+/g, ' ').trim() }

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RACHAT_ROW = {
  id: 1, numero: 'LP-2026-00001', date_rachat: '2026-07-01', statut: 'en_stock',
  vendeur_nom: 'Dupont', vendeur_prenom: 'Jean',
  marque: 'Apple', modele: 'iPhone 12', imei: '123456789012345', etat: 'bon',
  prix_rachat: 150, mode_paiement: 'especes', operateur_nom: 'Alice Martin',
}

const RACHAT_DETAIL = {
  ...RACHAT_ROW, boutique_id: 1, user_id: 1,
  operateur_email: 'alice@izigsm.fr', boutique_nom: 'iziGSM Paris',
  siret: '12345678900012', boutique_adresse: '1 rue Test',
  boutique_cp: '75001', boutique_ville: 'Paris',
}

const INPUT: CreateRachatInput = {
  vendeur_nom: 'Dupont', vendeur_prenom: 'Jean',
  vendeur_piece: 'CNI', vendeur_piece_num: '123456789',
  marque: 'Apple', modele: 'iPhone 12',
  prix_rachat: 150,
}

// ─── listRachats ──────────────────────────────────────────────────────────────

describe('listRachats()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  const SQL_COUNT = n(`SELECT COUNT(*) as cnt FROM rachats r WHERE r.boutique_id = ?`)
  const SQL_LIST  = n(`
    SELECT r.id, r.numero, r.date_rachat, r.statut,
           r.vendeur_nom, r.vendeur_prenom,
           r.marque, r.modele, r.imei, r.etat,
           r.prix_rachat, r.mode_paiement,
           u.prenom || ' ' || u.nom as operateur_nom
    FROM   rachats r
    JOIN   users u ON u.id = r.user_id
    WHERE r.boutique_id = ?
    ORDER  BY r.date_rachat DESC
    LIMIT  ? OFFSET ?
  `)

  it('retourne data + pagination par défaut (page 1, limit 20)', async () => {
    db.__setResponse(SQL_COUNT, { cnt: 1 })
    db.__setListResponse(SQL_LIST, [RACHAT_ROW])

    const result = await listRachats(db, 1)

    expect(result.data).toHaveLength(1)
    expect(result.data[0].numero).toBe('LP-2026-00001')
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, pages: 1 })
  })

  it('retourne un tableau vide si aucun rachat', async () => {
    db.__setResponse(SQL_COUNT, { cnt: 0 })
    db.__setListResponse(SQL_LIST, [])

    const result = await listRachats(db, 1)

    expect(result.data).toEqual([])
    expect(result.pagination.total).toBe(0)
  })

  it('applique le filtre statut', async () => {
    await listRachats(db, 1, { statut: 'vendu' })

    const calls = db.__getCalls()
    const countCall = calls.find(c => c.sql.includes('r.statut = ?'))
    expect(countCall).toBeDefined()
    expect(countCall!.params).toEqual([1, 'vendu'])
  })

  it('applique le filtre search sur 6 colonnes avec LIKE', async () => {
    await listRachats(db, 1, { search: 'iPhone' })

    const calls = db.__getCalls()
    const searchCall = calls.find(c => c.sql.includes('LIKE ?'))
    expect(searchCall).toBeDefined()
    expect(searchCall!.params.filter((p: any) => p === '%iPhone%')).toHaveLength(6)
  })

  it('applique les filtres date_debut/date_fin (date_fin inclut 23:59:59)', async () => {
    await listRachats(db, 1, { date_debut: '2026-01-01', date_fin: '2026-12-31' })

    const calls = db.__getCalls()
    const call = calls.find(c => c.sql.includes('r.date_rachat >= ?'))
    expect(call!.params).toContain('2026-01-01')
    expect(call!.params).toContain('2026-12-31 23:59:59')
  })
})

// ─── getRachat ────────────────────────────────────────────────────────────────

describe('getRachat()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  it('retourne le détail complet si trouvé', async () => {
    db.__setResponseFn(n(`
      SELECT r.*,
             u.prenom || ' ' || u.nom as operateur_nom,
             u.email                  as operateur_email,
             b.nom                    as boutique_nom,
             b.siret,
             b.adresse                as boutique_adresse,
             b.code_postal            as boutique_cp,
             b.ville                  as boutique_ville
      FROM   rachats   r
      JOIN   users     u ON u.id = r.user_id
      JOIN   boutiques b ON b.id = r.boutique_id
      WHERE  r.id = ?
    `), (params) => params[0] === 1 ? RACHAT_DETAIL : null)

    const result = await getRachat(db, 1)

    expect(result).not.toBeNull()
    expect(result.numero).toBe('LP-2026-00001')
    expect(result.boutique_nom).toBe('iziGSM Paris')
  })

  it('retourne null si introuvable', async () => {
    const result = await getRachat(db, 999)
    expect(result).toBeNull()
  })
})

// ─── createRachat (non migré — D1Database, dépend d'auditLog/nextNumero) ─────

describe('createRachat()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_CHECK_IMEI = n(`
    SELECT id, numero FROM rachats
    WHERE imei = ? AND boutique_id = ? AND statut NOT IN ('retourne','litige')
  `)

  const SQL_INSERT_RACHAT = n(`
    INSERT INTO rachats (
      boutique_id, numero,
      vendeur_nom, vendeur_prenom, vendeur_naissance,
      vendeur_adresse, vendeur_cp, vendeur_ville,
      vendeur_piece, vendeur_piece_num, vendeur_telephone,
      marque, modele, imei, imei2, couleur, capacite,
      etat, accessoires, observations,
      prix_rachat, mode_paiement, reference_paiement,
      user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `)

  beforeEach(() => { db = createMockD1() })

  it('crée le rachat et retourne id + numero', async () => {
    db.__setResponseFn(SQL_INSERT_RACHAT, () => ({ id: 42 }))
    // nextNumero() fait un upsert sur `sequences` — laissé au comportement par défaut du mock

    const result = await createRachat(db, 1, 1, INPUT)

    expect(result.id).toBe(42)
    expect(result.numero).toBeDefined()
  })

  it('rejette un IMEI déjà enregistré (doublon, hors retourné/litige)', async () => {
    db.__setResponse(SQL_CHECK_IMEI, { id: 7, numero: 'LP-2026-00007' })

    await expect(
      createRachat(db, 1, 1, { ...INPUT, imei: '123456789012345' })
    ).rejects.toMatchObject({ code: 'DOUBLON_IMEI', doublon_id: 7 })
  })

  it('n\'effectue pas de vérification IMEI si non fourni', async () => {
    db.__setResponseFn(SQL_INSERT_RACHAT, () => ({ id: 1 }))

    await createRachat(db, 1, 1, INPUT)

    const calls = db.__getCalls()
    expect(calls.find(c => c.sql === SQL_CHECK_IMEI)).toBeUndefined()
  })

  it('lève une erreur si l\'insertion échoue', async () => {
    // Pas de réponse enregistrée pour l'INSERT → first() retourne null → id manquant

    await expect(createRachat(db, 1, 1, INPUT)).rejects.toThrow('insertion')
  })
})

// ─── updateStatutRachat (non migré — D1Database, dépend d'auditLog) ──────────

describe('updateStatutRachat()', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => { db = createMockD1() })

  it('met à jour le statut', async () => {
    db.__setResponse(
      n('SELECT id, boutique_id, numero, statut FROM rachats WHERE id = ?'),
      { id: 1, boutique_id: 1, numero: 'LP-2026-00001', statut: 'en_stock' }
    )

    await updateStatutRachat(db, 1, 1, 'vendu')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE rachats'))
    expect(updateCall).toBeDefined()
    expect(updateCall!.params[0]).toBe('vendu')
  })

  it('lève une erreur si le rachat est introuvable', async () => {
    db.__setResponse(n('SELECT id, boutique_id, numero, statut FROM rachats WHERE id = ?'), null)

    await expect(updateStatutRachat(db, 999, 1, 'vendu')).rejects.toThrow('introuvable')
  })

  it('conserve produit_id existant si non fourni (COALESCE)', async () => {
    db.__setResponse(
      n('SELECT id, boutique_id, numero, statut FROM rachats WHERE id = ?'),
      { id: 1, boutique_id: 1, numero: 'LP-2026-00001', statut: 'en_stock' }
    )

    await updateStatutRachat(db, 1, 1, 'vendu')

    const calls = db.__getCalls()
    const updateCall = calls.find(c => c.sql.includes('UPDATE rachats'))
    expect(updateCall!.params[1]).toBeNull() // produitId non fourni
  })
})

// ─── exportLivrePolice ────────────────────────────────────────────────────────

describe('exportLivrePolice()', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  const SQL_EXPORT_BASE = `
    SELECT r.numero, r.date_rachat,
           r.vendeur_nom, r.vendeur_prenom, r.vendeur_naissance,
           r.vendeur_adresse, r.vendeur_cp, r.vendeur_ville,
           r.vendeur_piece, r.vendeur_piece_num,
           r.marque, r.modele, r.imei, r.couleur, r.capacite, r.etat,
           r.prix_rachat, r.mode_paiement,
           r.statut,
           u.prenom || ' ' || u.nom as operateur
    FROM   rachats r
    JOIN   users   u ON u.id = r.user_id
    WHERE r.boutique_id = ?
    ORDER  BY r.date_rachat ASC
  `

  it('retourne les lignes du livre de police', async () => {
    db.__setListResponse(n(SQL_EXPORT_BASE), [RACHAT_ROW])

    const result = await exportLivrePolice(db, 1)

    expect(result).toHaveLength(1)
    expect(result[0].numero).toBe('LP-2026-00001')
  })

  it('retourne un tableau vide si aucune donnée', async () => {
    db.__setListResponse(n(SQL_EXPORT_BASE), [])

    const result = await exportLivrePolice(db, 1)

    expect(result).toEqual([])
  })

  it('applique les filtres date_debut/date_fin', async () => {
    await exportLivrePolice(db, 1, { date_debut: '2026-01-01', date_fin: '2026-12-31' })

    const calls = db.__getCalls()
    const call = calls.find(c => c.sql.includes('r.date_rachat >= ?'))
    expect(call!.params).toEqual([1, '2026-01-01', '2026-12-31 23:59:59'])
  })
})
