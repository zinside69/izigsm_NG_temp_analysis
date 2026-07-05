/**
 * tests/publicService.test.ts
 * Sprint 2.30 — Couverture publicService.ts
 *
 * Fonctions testées :
 *   getTicketPublicByToken   (4 tests)
 *   getBoutiquePublicBySlug  (3 tests)
 *   getStatsBoutiquePublic   (3 tests)
 *   getBoutiqueIdBySlug      (3 tests)
 *   getCategoriesPubliques   (3 tests)
 *   getServicesPublics       (4 tests)
 *
 * Total : 20 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  getTicketPublicByToken,
  getBoutiquePublicBySlug,
  getStatsBoutiquePublic,
  getBoutiqueIdBySlug,
  getCategoriesPubliques,
  getServicesPublics,
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
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne TicketPublic si token valide', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, TICKET_PUBLIC)

    const result = await getTicketPublicByToken(db as any, 'abc123def456abc1')

    expect(result).not.toBeNull()
    expect(result!.numero).toBe('TKT-2026-00001')
    expect(result!.client_prenom).toBe('Alice')
    expect(result!.boutique_nom).toBe('iziGSM Paris')
  })

  it('retourne null si token inconnu ou ticket inactif', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, null)

    const result = await getTicketPublicByToken(db as any, 'INVALID_TOKEN')

    expect(result).toBeNull()
  })

  it('token transmis comme premier binding', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, TICKET_PUBLIC)

    await getTicketPublicByToken(db as any, 'my-tracking-token-xyz')

    const calls = db.__getCalls()
    const tokenCall = calls.find(c => c.sql.includes('t.tracking_token = ?'))
    expect(tokenCall!.params[0]).toBe('my-tracking-token-xyz')
  })

  it('champs clés présents dans TicketPublic', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, TICKET_PUBLIC)

    const result = await getTicketPublicByToken(db as any, 'abc123def456abc1')

    expect(result).toHaveProperty('statut')
    expect(result).toHaveProperty('appareil_marque')
    expect(result).toHaveProperty('date_reception')
    expect(result).toHaveProperty('boutique_telephone')
  })
})

// ─── getBoutiquePublicBySlug ──────────────────────────────────────────────────

describe('getBoutiquePublicBySlug', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne BoutiquePublic si slug valide', async () => {
    db.__setResponse(SQL_BOUTIQUE_SLUG, BOUTIQUE_PUBLIC)

    const result = await getBoutiquePublicBySlug(db as any, 'izigsm-paris')

    expect(result).not.toBeNull()
    expect(result!.nom).toBe('iziGSM Paris')
    expect(result!.slug).toBe('izigsm-paris')
  })

  it('retourne null si slug inconnu ou boutique inactive', async () => {
    db.__setResponse(SQL_BOUTIQUE_SLUG, null)

    const result = await getBoutiquePublicBySlug(db as any, 'boutique-inconnue')

    expect(result).toBeNull()
  })

  it('slug transmis comme premier binding', async () => {
    db.__setResponse(SQL_BOUTIQUE_SLUG, BOUTIQUE_PUBLIC)

    await getBoutiquePublicBySlug(db as any, 'mon-slug-test')

    const calls = db.__getCalls()
    const slugCall = calls.find(c => c.sql.includes('WHERE slug = ?'))
    expect(slugCall!.params[0]).toBe('mon-slug-test')
  })
})

// ─── getStatsBoutiquePublic ───────────────────────────────────────────────────

describe('getStatsBoutiquePublic', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne total_tickets et tickets_done', async () => {
    db.__setResponse(SQL_STATS_BOUTIQUE, { total_tickets: 42, tickets_done: 38 })

    const result = await getStatsBoutiquePublic(db as any, 1)

    expect(result.total_tickets).toBe(42)
    expect(result.tickets_done).toBe(38)
  })

  it('fallback 0 si SQL retourne null', async () => {
    db.__setResponse(SQL_STATS_BOUTIQUE, null)

    const result = await getStatsBoutiquePublic(db as any, 1)

    expect(result.total_tickets).toBe(0)
    expect(result.tickets_done).toBe(0)
  })

  it('boutiqueId transmis comme binding', async () => {
    db.__setResponse(SQL_STATS_BOUTIQUE, { total_tickets: 0, tickets_done: 0 })

    await getStatsBoutiquePublic(db as any, 55)

    const calls = db.__getCalls()
    const statsCall = calls.find(c => c.sql.includes('COUNT(*) AS total_tickets'))
    expect(statsCall!.params[0]).toBe(55)
  })
})

// ─── getBoutiqueIdBySlug ──────────────────────────────────────────────────────

describe('getBoutiqueIdBySlug', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne { id, nom } si slug trouvé', async () => {
    db.__setResponse(SQL_BOUTIQUE_ID_BY_SLUG, { id: 1, nom: 'iziGSM Paris' })

    const result = await getBoutiqueIdBySlug(db as any, 'izigsm-paris')

    expect(result).not.toBeNull()
    expect(result!.id).toBe(1)
    expect(result!.nom).toBe('iziGSM Paris')
  })

  it('retourne null si slug inconnu', async () => {
    db.__setResponse(SQL_BOUTIQUE_ID_BY_SLUG, null)

    const result = await getBoutiqueIdBySlug(db as any, 'slug-inconnu')

    expect(result).toBeNull()
  })

  it('slug transmis comme binding', async () => {
    db.__setResponse(SQL_BOUTIQUE_ID_BY_SLUG, { id: 2, nom: 'Test' })

    await getBoutiqueIdBySlug(db as any, 'mon-slug')

    const calls = db.__getCalls()
    const slugCall = calls.find(c => c.sql.includes('SELECT id, nom FROM boutiques'))
    expect(slugCall!.params[0]).toBe('mon-slug')
  })
})

// ─── getCategoriesPubliques ───────────────────────────────────────────────────

describe('getCategoriesPubliques', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne la liste des catégories actives', async () => {
    db.__setListResponse(SQL_CATEGORIES, [CATEGORIE_ROW])

    const result = await getCategoriesPubliques(db as any, 1)

    expect(result).toHaveLength(1)
    expect(result[0].nom).toBe('Smartphones')
    expect(result[0].couleur).toBe('#3B82F6')
  })

  it('retourne tableau vide si aucune catégorie', async () => {
    db.__setListResponse(SQL_CATEGORIES, [])

    const result = await getCategoriesPubliques(db as any, 1)

    expect(result).toHaveLength(0)
  })

  it('boutiqueId transmis comme premier binding', async () => {
    db.__setListResponse(SQL_CATEGORIES, [])

    await getCategoriesPubliques(db as any, 99)

    const calls = db.__getCalls()
    const catCall = calls.find(c => c.sql.includes('FROM categories_services'))
    expect(catCall!.params[0]).toBe(99)
  })
})

// ─── getServicesPublics ───────────────────────────────────────────────────────

describe('getServicesPublics', () => {
  let db: ReturnType<typeof createMockD1>

  beforeEach(() => {
    db = createMockD1()
  })

  it('retourne la liste des services actifs', async () => {
    db.__setListResponse(SQL_SERVICES, [SERVICE_ROW])

    const result = await getServicesPublics(db as any, 1)

    expect(result).toHaveLength(1)
    expect(result[0].nom).toBe('Remplacement écran iPhone 14')
    expect(result[0].prix_ht).toBe(99)
    expect(result[0].tva_taux).toBe(20)
  })

  it('retourne tableau vide si aucun service', async () => {
    db.__setListResponse(SQL_SERVICES, [])

    const result = await getServicesPublics(db as any, 1)

    expect(result).toHaveLength(0)
  })

  it('boutiqueId transmis comme binding', async () => {
    db.__setListResponse(SQL_SERVICES, [])

    await getServicesPublics(db as any, 77)

    const calls = db.__getCalls()
    const svcCall = calls.find(c => c.sql.includes('FROM services s'))
    expect(svcCall!.params[0]).toBe(77)
  })

  it('service contient tous les champs attendus', async () => {
    db.__setListResponse(SQL_SERVICES, [SERVICE_ROW])

    const result = await getServicesPublics(db as any, 1)

    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('nom')
    expect(result[0]).toHaveProperty('prix_ht')
    expect(result[0]).toHaveProperty('tva_taux')
    expect(result[0]).toHaveProperty('categorie_id')
  })
})
