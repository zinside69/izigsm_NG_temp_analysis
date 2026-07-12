/**
 * tests/publicService.test.ts
 * Sprint 2.30 — Couverture publicService.ts
 * Sprint 2.41 — +10 tests : getDisponibilites / createRdvPublic (J08/J09/N05)
 *
 * Fonctions testées :
 *   getTicketPublicByToken   (4 tests)
 *   getBoutiquePublicBySlug  (3 tests)
 *   getStatsBoutiquePublic   (3 tests)
 *   getBoutiqueIdBySlug      (3 tests)
 *   getCategoriesPubliques   (3 tests)
 *   getServicesPublics       (4 tests)
 *   getDisponibilites        (5 tests)
 *   createRdvPublic          (5 tests)
 *
 * Total : 30 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  getTicketPublicByToken,
  getBoutiquePublicBySlug,
  getStatsBoutiquePublic,
  getBoutiqueIdBySlug,
  getCategoriesPubliques,
  getServicesPublics,
  getDisponibilites,
  createRdvPublic,
  type TicketPublic,
  type BoutiquePublic,
} from '../src/services/publicService'

// ─── SQL normalisés ───────────────────────────────────────────────────────────

const SQL_TICKET_TOKEN = `SELECT t.id, t.numero, t.tracking_token, t.statut, t.appareil_marque, t.appareil_modele, t.description_panne, t.diagnostic, t.prix_estime, t.prix_final, t.date_reception, t.date_promesse, t.date_livraison, c.prenom AS client_prenom, c.nom AS client_nom, b.nom AS boutique_nom, b.telephone AS boutique_telephone, b.email AS boutique_email, b.adresse AS boutique_adresse, b.ville AS boutique_ville, b.slug AS boutique_slug FROM tickets t JOIN clients c ON c.id = t.client_id JOIN boutiques b ON b.id = t.boutique_id WHERE t.tracking_token = ? AND t.actif = 1`

const SQL_BOUTIQUE_SLUG = `SELECT id, nom, siret, adresse, code_postal, ville, telephone, email, site_web, logo_url, description, horaires, slug, facebook_url, instagram_url, google_maps_url FROM boutiques WHERE slug = ? AND actif = 1`

const SQL_STATS_BOUTIQUE = `SELECT COUNT(*) AS total_tickets, SUM(CASE WHEN statut = 'DELIVERED' THEN 1 ELSE 0 END) AS tickets_done FROM tickets WHERE boutique_id = ? AND actif = 1`

const SQL_BOUTIQUE_ID_BY_SLUG = `SELECT id, nom FROM boutiques WHERE slug = ? AND actif = 1`

const SQL_CATEGORIES = `SELECT id, nom, description, couleur, ordre FROM categories_services WHERE boutique_id = ? AND actif = 1 AND parent_id IS NULL ORDER BY ordre ASC, nom ASC`

const SQL_SERVICES = `SELECT s.id, s.nom, s.description, s.prix_ht, s.tva_taux, s.duree_minutes, s.categorie_id FROM services s WHERE s.boutique_id = ? AND s.actif = 1 ORDER BY s.categorie_id ASC, s.nom ASC`

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TICKET_PUBLIC: TicketPublic = {
  id: 1, numero: 'TKT-2026-00001', tracking_token: 'abc123def456abc1',
  statut: 'en_reparation', appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
  description_panne: 'Écran fissuré', diagnostic: null,
  prix_estime: 120, prix_final: null,
  date_reception: '2026-07-01T10:00:00Z', date_promesse: '2026-07-05T18:00:00Z',
  date_livraison: null,
  client_prenom: 'Alice', client_nom: 'Dupont',
  boutique_nom: 'iziGSM Paris', boutique_telephone: '0140000000',
  boutique_email: 'contact@izigsm.fr', boutique_adresse: '1 rue Test',
  boutique_ville: 'Paris',
}

const BOUTIQUE_PUBLIC: BoutiquePublic = {
  id: 1, nom: 'iziGSM Paris', siret: '12345678901234',
  adresse: '1 rue Test', code_postal: '75001', ville: 'Paris',
  telephone: '0140000000', email: 'contact@izigsm.fr',
  site_web: 'https://izigsm.fr', logo_url: null,
  description: 'Réparation smartphones', horaires: 'Lun–Sam 9h–19h',
  slug: 'izigsm-paris', facebook_url: null, instagram_url: null, google_maps_url: null,
}

const CATEGORIE_ROW = {
  id: 1, nom: 'Smartphones', description: 'Réparations smartphones', couleur: '#3B82F6', ordre: 1,
}

const SERVICE_ROW = {
  id: 10, nom: 'Remplacement écran iPhone 14', description: null,
  prix_ht: 99, tva_taux: 20, duree_minutes: 30, categorie_id: 1,
}

// ─── getTicketPublicByToken ───────────────────────────────────────────────────

describe('getTicketPublicByToken', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne TicketPublic si token valide', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, TICKET_PUBLIC)

    const result = await getTicketPublicByToken(db, 'abc123def456abc1')

    expect(result).not.toBeNull()
    expect(result!.numero).toBe('TKT-2026-00001')
    expect(result!.client_prenom).toBe('Alice')
    expect(result!.boutique_nom).toBe('iziGSM Paris')
  })

  it('retourne null si token inconnu ou ticket inactif', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, null)

    const result = await getTicketPublicByToken(db, 'INVALID_TOKEN')

    expect(result).toBeNull()
  })

  it('token transmis comme premier binding', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, TICKET_PUBLIC)

    await getTicketPublicByToken(db, 'my-tracking-token-xyz')

    const calls = db.__getCalls()
    const tokenCall = calls.find(c => c.sql.includes('t.tracking_token = ?'))
    expect(tokenCall!.params[0]).toBe('my-tracking-token-xyz')
  })

  it('champs clés présents dans TicketPublic', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, TICKET_PUBLIC)

    const result = await getTicketPublicByToken(db, 'abc123def456abc1')

    expect(result).toHaveProperty('statut')
    expect(result).toHaveProperty('appareil_marque')
    expect(result).toHaveProperty('date_reception')
    expect(result).toHaveProperty('boutique_telephone')
  })
})

// ─── getBoutiquePublicBySlug ──────────────────────────────────────────────────

describe('getBoutiquePublicBySlug', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne BoutiquePublic si slug valide', async () => {
    db.__setResponse(SQL_BOUTIQUE_SLUG, BOUTIQUE_PUBLIC)

    const result = await getBoutiquePublicBySlug(db, 'izigsm-paris')

    expect(result).not.toBeNull()
    expect(result!.nom).toBe('iziGSM Paris')
    expect(result!.slug).toBe('izigsm-paris')
  })

  it('retourne null si slug inconnu ou boutique inactive', async () => {
    db.__setResponse(SQL_BOUTIQUE_SLUG, null)

    const result = await getBoutiquePublicBySlug(db, 'boutique-inconnue')

    expect(result).toBeNull()
  })

  it('slug transmis comme premier binding', async () => {
    db.__setResponse(SQL_BOUTIQUE_SLUG, BOUTIQUE_PUBLIC)

    await getBoutiquePublicBySlug(db, 'mon-slug-test')

    const calls = db.__getCalls()
    const slugCall = calls.find(c => c.sql.includes('WHERE slug = ?'))
    expect(slugCall!.params[0]).toBe('mon-slug-test')
  })
})

// ─── getStatsBoutiquePublic ───────────────────────────────────────────────────

describe('getStatsBoutiquePublic', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne total_tickets et tickets_done', async () => {
    db.__setResponse(SQL_STATS_BOUTIQUE, { total_tickets: 42, tickets_done: 38 })

    const result = await getStatsBoutiquePublic(db, 1)

    expect(result.total_tickets).toBe(42)
    expect(result.tickets_done).toBe(38)
  })

  it('fallback 0 si SQL retourne null', async () => {
    db.__setResponse(SQL_STATS_BOUTIQUE, null)

    const result = await getStatsBoutiquePublic(db, 1)

    expect(result.total_tickets).toBe(0)
    expect(result.tickets_done).toBe(0)
  })

  it('boutiqueId transmis comme binding', async () => {
    db.__setResponse(SQL_STATS_BOUTIQUE, { total_tickets: 0, tickets_done: 0 })

    await getStatsBoutiquePublic(db, 55)

    const calls = db.__getCalls()
    const statsCall = calls.find(c => c.sql.includes('COUNT(*) AS total_tickets'))
    expect(statsCall!.params[0]).toBe(55)
  })
})

// ─── getBoutiqueIdBySlug ──────────────────────────────────────────────────────

describe('getBoutiqueIdBySlug', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne { id, nom } si slug trouvé', async () => {
    db.__setResponse(SQL_BOUTIQUE_ID_BY_SLUG, { id: 1, nom: 'iziGSM Paris' })

    const result = await getBoutiqueIdBySlug(db, 'izigsm-paris')

    expect(result).not.toBeNull()
    expect(result!.id).toBe(1)
    expect(result!.nom).toBe('iziGSM Paris')
  })

  it('retourne null si slug inconnu', async () => {
    db.__setResponse(SQL_BOUTIQUE_ID_BY_SLUG, null)

    const result = await getBoutiqueIdBySlug(db, 'slug-inconnu')

    expect(result).toBeNull()
  })

  it('slug transmis comme binding', async () => {
    db.__setResponse(SQL_BOUTIQUE_ID_BY_SLUG, { id: 2, nom: 'Test' })

    await getBoutiqueIdBySlug(db, 'mon-slug')

    const calls = db.__getCalls()
    const slugCall = calls.find(c => c.sql.includes('SELECT id, nom FROM boutiques'))
    expect(slugCall!.params[0]).toBe('mon-slug')
  })
})

// ─── getCategoriesPubliques ───────────────────────────────────────────────────

describe('getCategoriesPubliques', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne la liste des catégories actives', async () => {
    db.__setListResponse(SQL_CATEGORIES, [CATEGORIE_ROW])

    const result = await getCategoriesPubliques(db, 1)

    expect(result).toHaveLength(1)
    expect(result[0].nom).toBe('Smartphones')
    expect(result[0].couleur).toBe('#3B82F6')
  })

  it('retourne tableau vide si aucune catégorie', async () => {
    db.__setListResponse(SQL_CATEGORIES, [])

    const result = await getCategoriesPubliques(db, 1)

    expect(result).toHaveLength(0)
  })

  it('boutiqueId transmis comme premier binding', async () => {
    db.__setListResponse(SQL_CATEGORIES, [])

    await getCategoriesPubliques(db, 99)

    const calls = db.__getCalls()
    const catCall = calls.find(c => c.sql.includes('FROM categories_services'))
    expect(catCall!.params[0]).toBe(99)
  })
})

// ─── getServicesPublics ───────────────────────────────────────────────────────

describe('getServicesPublics', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne la liste des services actifs', async () => {
    db.__setListResponse(SQL_SERVICES, [SERVICE_ROW])

    const result = await getServicesPublics(db, 1)

    expect(result).toHaveLength(1)
    expect(result[0].nom).toBe('Remplacement écran iPhone 14')
    expect(result[0].prix_ht).toBe(99)
    expect(result[0].tva_taux).toBe(20)
  })

  it('retourne tableau vide si aucun service', async () => {
    db.__setListResponse(SQL_SERVICES, [])

    const result = await getServicesPublics(db, 1)

    expect(result).toHaveLength(0)
  })

  it('boutiqueId transmis comme binding', async () => {
    db.__setListResponse(SQL_SERVICES, [])

    await getServicesPublics(db, 77)

    const calls = db.__getCalls()
    const svcCall = calls.find(c => c.sql.includes('FROM services s'))
    expect(svcCall!.params[0]).toBe(77)
  })

  it('service contient tous les champs attendus', async () => {
    db.__setListResponse(SQL_SERVICES, [SERVICE_ROW])

    const result = await getServicesPublics(db, 1)

    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('nom')
    expect(result[0]).toHaveProperty('prix_ht')
    expect(result[0]).toHaveProperty('tva_taux')
    expect(result[0]).toHaveProperty('categorie_id')
  })
})

// ─── getDisponibilites ────────────────────────────────────────────────────────

describe('getDisponibilites()', () => {
  let db: ReturnType<typeof createMockDatabase>

  // SQL normalisés — espaces collapsés pour correspondre au mock (normalizeSQL())
  const SQL_CRENEAUX = `SELECT heure_debut, heure_fin, duree_slot FROM boutique_creneaux WHERE boutique_id = ? AND jour_semaine = ? AND actif = 1 ORDER BY heure_debut ASC`
  const SQL_RDV_DATE = `SELECT debut, fin FROM rendez_vous WHERE boutique_id = ? AND actif = 1 AND DATE(debut) = ? AND statut NOT IN ('CANCELLED') ORDER BY debut ASC`

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('retourne tableau vide si aucune plage horaire configurée', async () => {
    db.__setListResponse(SQL_CRENEAUX, [])

    const result = await getDisponibilites(db, 1, '2099-12-15')

    expect(result).toHaveLength(0)
    // Pas de 2ème requête si aucune plage
    const calls = db.__getCalls()
    expect(calls.find(c => c.sql.includes('rendez_vous'))).toBeUndefined()
  })

  it('génère les créneaux à partir des plages et filtre les occupés', async () => {
    // Plage 09:00–10:00 de 30min → 2 slots : 09:00 et 09:30
    db.__setListResponse(SQL_CRENEAUX, [
      { heure_debut: '09:00', heure_fin: '10:00', duree_slot: 30 },
    ])
    // RDV existant qui occupe 09:00–09:30
    db.__setListResponse(SQL_RDV_DATE, [
      { debut: '2099-12-15 09:00', fin: '2099-12-15 09:30' },
    ])

    const result = await getDisponibilites(db, 1, '2099-12-15')

    // Le slot 09:00 est occupé, seul 09:30 reste
    expect(result).toHaveLength(1)
    expect(result[0].debut).toContain('09:30')
    expect(result[0].duree_minutes).toBe(30)
  })

  it('retourne tous les slots si aucun RDV existant', async () => {
    // Plage 14:00–15:30 de 30min → 3 slots
    db.__setListResponse(SQL_CRENEAUX, [
      { heure_debut: '14:00', heure_fin: '15:30', duree_slot: 30 },
    ])
    db.__setListResponse(SQL_RDV_DATE, [])

    const result = await getDisponibilites(db, 1, '2099-12-15')

    expect(result).toHaveLength(3)
    expect(result[0].debut).toContain('14:00')
    expect(result[1].debut).toContain('14:30')
    expect(result[2].debut).toContain('15:00')
  })

  it('transmet boutiqueId et dayOfWeek comme bindings à SQL_CRENEAUX', async () => {
    db.__setListResponse(SQL_CRENEAUX, [])

    // 2099-12-15 = mardi → dayOfWeek = 2
    await getDisponibilites(db, 42, '2099-12-15')

    const calls = db.__getCalls()
    const creneauxCall = calls.find(c => c.sql.includes('boutique_creneaux'))
    expect(creneauxCall!.params[0]).toBe(42)    // boutiqueId
    expect(creneauxCall!.params[1]).toBe(2)     // mardi = 2
  })

  it('chaque créneau a debut, fin et duree_minutes', async () => {
    db.__setListResponse(SQL_CRENEAUX, [
      { heure_debut: '10:00', heure_fin: '11:00', duree_slot: 60 },
    ])
    db.__setListResponse(SQL_RDV_DATE, [])

    const result = await getDisponibilites(db, 1, '2099-12-15')

    expect(result).toHaveLength(1)
    expect(result[0]).toHaveProperty('debut')
    expect(result[0]).toHaveProperty('fin')
    expect(result[0]).toHaveProperty('duree_minutes')
    expect(result[0].duree_minutes).toBe(60)
  })
})

// ─── createRdvPublic ──────────────────────────────────────────────────────────

describe('createRdvPublic()', () => {
  let db: ReturnType<typeof createMockDatabase>

  const SQL_INSERT_RDV = `INSERT INTO rendez_vous (boutique_id, client_id, ticket_id, user_id, titre, description, debut, fin, duree_minutes, statut, type_rdv, nom_client, telephone_client, rappel_minutes, ical_token, couleur, notes) VALUES (?,NULL,NULL,NULL,?,?,?,?,?,'PENDING',?,?,?,60,?,'#F59E0B',?) RETURNING id, ical_token, debut, fin, titre`

  // debut bien dans le futur
  const DEBUT_FUTUR = '2099-12-15 10:00'

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('crée un RDV public et retourne id + titre', async () => {
    db.__setResponse(SQL_INSERT_RDV, {
      id: 55, ical_token: 'tok123', debut: DEBUT_FUTUR,
      fin: '2099-12-15 10:30', titre: 'RDV en ligne',
    })

    const result = await createRdvPublic(db, 1, {
      debut:            DEBUT_FUTUR,
      nom_client:       'Jean Dupont',
      telephone_client: '0601020304',
    })

    expect(result.id).toBe(55)
    expect(result.titre).toBe('RDV en ligne')
  })

  it('utilise service_nom comme titre si fourni', async () => {
    db.__setResponse(SQL_INSERT_RDV, {
      id: 56, ical_token: 'tok456', debut: DEBUT_FUTUR,
      fin: '2099-12-15 10:30', titre: 'Remplacement écran',
    })

    const result = await createRdvPublic(db, 1, {
      debut:      DEBUT_FUTUR,
      nom_client: 'Marie Martin',
      service_nom: 'Remplacement écran',
    })

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql.includes('INSERT INTO rendez_vous'))
    // params[1] = titre
    expect(insertCall!.params[1]).toBe('Remplacement écran')
    expect(result.id).toBe(56)
  })

  it('lève une erreur si debut absent', async () => {
    await expect(
      createRdvPublic(db, 1, { nom_client: 'Test' })
    ).rejects.toThrow('requise')
  })

  it('lève une erreur si nom_client et telephone_client absents', async () => {
    await expect(
      createRdvPublic(db, 1, { debut: DEBUT_FUTUR })
    ).rejects.toThrow('requis')
  })

  it('lève une erreur si debut dans le passé', async () => {
    await expect(
      createRdvPublic(db, 1, {
        debut:      '2020-01-01 10:00',
        nom_client: 'Test',
      })
    ).rejects.toThrow('futur')
  })
})
