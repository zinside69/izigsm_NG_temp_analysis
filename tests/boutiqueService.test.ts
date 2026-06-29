/**
 * @file tests/boutiqueService.test.ts
 * @description Tests unitaires — src/services/boutiqueService.ts
 *
 * Couverture :
 *   - listAllBoutiques()        — admin : toutes boutiques actives
 *   - listBoutiqueForUser()     — non-admin : sa boutique uniquement
 *   - getBoutiqueById()         — détail par id (actif=1)
 *   - getBoutiqueSettings()     — paramètres boutique
 *   - createBoutique()          — INSERT + init settings
 *   - updateBoutique()          — COALESCE 14 champs
 *   - updateBoutiqueSettings()  — 22 paramètres + conversion bool→0/1
 *   - getStatsBoutique()        — 4 KPIs en Promise.all
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockD1 } from './helpers/mockD1'
import {
  listAllBoutiques,
  listBoutiqueForUser,
  getBoutiqueById,
  getBoutiqueSettings,
  createBoutique,
  updateBoutique,
  updateBoutiqueSettings,
  getStatsBoutique,
  type Boutique,
  type BoutiqueSettings,
  type CreateBoutiqueInput,
  type UpdateBoutiqueInput,
  type UpdateSettingsInput,
} from '../src/services/boutiqueService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BOUTIQUE_1: Boutique = {
  id: 1, nom: 'iZiGSM Paris', slug: 'izigsm-paris',
  siret: '12345678900012', tva_numero: 'FR12345678901',
  adresse: '1 rue de la Paix', code_postal: '75001', ville: 'Paris',
  telephone: '0123456789', email: 'contact@izigsm.fr',
  site_web: null, description: null, actif: 1,
}

const BOUTIQUE_2: Boutique = {
  id: 2, nom: 'iZiGSM Lyon', slug: 'izigsm-lyon',
  siret: null, tva_numero: null,
  adresse: null, code_postal: null, ville: 'Lyon',
  telephone: null, email: null,
  site_web: null, description: null, actif: 1,
}

const SETTINGS_1: BoutiqueSettings = {
  boutique_id: 1, tva_taux_defaut: 20,
  paiement_especes: 1, paiement_cb: 1,
  paiement_cheque: 0, paiement_virement: 0,
  prefix_ticket: 'TK', prefix_facture: 'FA', prefix_devis: 'DV',
  prefix_avoir: 'AV', prefix_rachat: 'LP',
  format_numero: 'annee', padding_numero: 5,
  garantie_defaut_jours: 30, delai_relance_jours: 7,
  mention_facture: null, pied_de_page: null,
  email_provider: null, email_from: null,
}

// ─── listAllBoutiques ─────────────────────────────────────────────────────────

describe('listAllBoutiques', () => {
  it('retourne toutes les boutiques actives triées par nom', async () => {
    const db = createMockD1()
    db.__setListResponse('SELECT * FROM boutiques WHERE actif = 1 ORDER BY nom', [BOUTIQUE_1, BOUTIQUE_2])

    const result = await listAllBoutiques(db)

    expect(result).toHaveLength(2)
    expect(result[0].nom).toBe('iZiGSM Paris')
    expect(result[1].nom).toBe('iZiGSM Lyon')
  })

  it('retourne un tableau vide si aucune boutique active', async () => {
    const db = createMockD1()
    db.__setListResponse('SELECT * FROM boutiques WHERE actif = 1 ORDER BY nom', [])

    const result = await listAllBoutiques(db)

    expect(result).toEqual([])
  })
})

// ─── listBoutiqueForUser ──────────────────────────────────────────────────────

describe('listBoutiqueForUser', () => {
  it('retourne uniquement la boutique de l\'utilisateur', async () => {
    const db = createMockD1()
    db.__setListResponse('SELECT * FROM boutiques WHERE id = ? AND actif = 1', [BOUTIQUE_1])

    const result = await listBoutiqueForUser(db, 1)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('retourne un tableau vide si boutique_id invalide ou inactive', async () => {
    const db = createMockD1()
    db.__setListResponse('SELECT * FROM boutiques WHERE id = ? AND actif = 1', [])

    const result = await listBoutiqueForUser(db, 999)

    expect(result).toEqual([])
  })

  it('transmet le boutique_id en paramètre SQL', async () => {
    const db = createMockD1()

    await listBoutiqueForUser(db, 7)

    const calls = db.__getCalls()
    expect(calls[0].params).toContain(7)
  })
})

// ─── getBoutiqueById ──────────────────────────────────────────────────────────

describe('getBoutiqueById', () => {
  it('retourne la boutique si elle est active', async () => {
    const db = createMockD1()
    db.__setResponse('SELECT * FROM boutiques WHERE id = ? AND actif = 1', BOUTIQUE_1)

    const result = await getBoutiqueById(db, 1)

    expect(result).not.toBeNull()
    expect(result?.nom).toBe('iZiGSM Paris')
    expect(result?.slug).toBe('izigsm-paris')
  })

  it('retourne null si boutique inactive ou inexistante', async () => {
    const db = createMockD1()
    db.__setNotFound('SELECT * FROM boutiques WHERE id = ? AND actif = 1')

    const result = await getBoutiqueById(db, 99)

    expect(result).toBeNull()
  })
})

// ─── getBoutiqueSettings ──────────────────────────────────────────────────────

describe('getBoutiqueSettings', () => {
  it('retourne les paramètres de la boutique', async () => {
    const db = createMockD1()
    db.__setResponse('SELECT * FROM boutique_settings WHERE boutique_id = ?', SETTINGS_1)

    const result = await getBoutiqueSettings(db, 1)

    expect(result).not.toBeNull()
    expect(result?.tva_taux_defaut).toBe(20)
    expect(result?.prefix_ticket).toBe('TK')
    expect(result?.format_numero).toBe('annee')
  })

  it('retourne null si settings non initialisés', async () => {
    const db = createMockD1()
    db.__setNotFound('SELECT * FROM boutique_settings WHERE boutique_id = ?')

    const result = await getBoutiqueSettings(db, 99)

    expect(result).toBeNull()
  })
})

// ─── createBoutique ───────────────────────────────────────────────────────────

describe('createBoutique', () => {
  const INPUT: CreateBoutiqueInput = {
    nom: 'Nouvelle Boutique', slug: 'nouvelle-boutique',
    siret: null, tva_numero: null, adresse: null,
    code_postal: null, ville: 'Marseille',
    telephone: null, email: null,
  }

  it('retourne l\'id de la boutique créée', async () => {
    const db = createMockD1()
    db.__setResponseFn(
      'INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      () => ({ id: 3 })
    )

    const id = await createBoutique(db, INPUT)

    expect(id).toBe(3)
  })

  it('exécute INSERT boutiques PUIS INSERT boutique_settings', async () => {
    const db = createMockD1()
    db.__setResponseFn(
      'INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      () => ({ id: 3 })
    )

    await createBoutique(db, INPUT)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].sql).toContain('INSERT INTO boutiques')
    expect(calls[1].sql).toContain('INSERT INTO boutique_settings')
    expect(calls[1].params).toContain(3)  // boutique_id
  })

  it('transmet le slug dans le premier INSERT', async () => {
    const db = createMockD1()
    db.__setResponseFn(
      'INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      () => ({ id: 3 })
    )

    await createBoutique(db, INPUT)

    const calls = db.__getCalls()
    expect(calls[0].params).toContain('nouvelle-boutique')
    expect(calls[0].params).toContain('Nouvelle Boutique')
  })

  it('retourne null si INSERT échoue', async () => {
    const db = createMockD1()
    // Pas de réponse → first() retourne null

    const id = await createBoutique(db, INPUT)

    expect(id).toBeNull()
  })
})

// ─── updateBoutique ───────────────────────────────────────────────────────────

describe('updateBoutique', () => {
  const INPUT: UpdateBoutiqueInput = {
    nom: 'Nouveau Nom', siret: null, tva_numero: null,
    adresse: null, code_postal: null, ville: null,
    telephone: null, email: null, site_web: null,
    slug: null, description: null,
    facebook_url: null, instagram_url: null, google_maps_url: null,
  }

  it('appelle UPDATE boutiques avec l\'id correct', async () => {
    const db = createMockD1()

    await updateBoutique(db, 1, INPUT)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('UPDATE boutiques SET')
    expect(calls[0].sql).toContain('COALESCE')
    expect(calls[0].params).toContain(1)       // id en dernier
    expect(calls[0].params).toContain('Nouveau Nom')
  })

  it('inclut CURRENT_TIMESTAMP dans le SQL (updated_at)', async () => {
    const db = createMockD1()

    await updateBoutique(db, 1, INPUT)

    const calls = db.__getCalls()
    expect(calls[0].sql).toContain('updated_at=CURRENT_TIMESTAMP')
  })

  it('passe null pour les champs non fournis (comportement COALESCE)', async () => {
    const db = createMockD1()

    await updateBoutique(db, 1, INPUT)

    const calls = db.__getCalls()
    // Tous les champs null sauf nom — COALESCE conservera les valeurs existantes
    const nullCount = calls[0].params.filter((p: any) => p === null).length
    expect(nullCount).toBeGreaterThan(10)  // 13 champs null sur 15 paramètres
  })
})

// ─── updateBoutiqueSettings ───────────────────────────────────────────────────

describe('updateBoutiqueSettings', () => {
  const BASE_INPUT: UpdateSettingsInput = {
    tva_taux_defaut: 20, horaires: null,
    notif_email_actif: true, notif_sms_actif: false,
    paiement_especes: true, paiement_cb: true,
    paiement_cheque: false, paiement_virement: false,
    prefix_ticket: null, prefix_facture: null, prefix_devis: null,
    prefix_avoir: null, prefix_rachat: null,
    format_numero: null, padding_numero: null,
    garantie_defaut_jours: null, delai_relance_jours: null,
    mention_facture: null, pied_de_page: null,
    email_provider: null, email_api_key: null, email_from: null,
    email_notif_ticket_cree: null, email_notif_ticket_termine: null,
    email_notif_sav_ouvert: null, email_notif_relance: null,
  }

  it('appelle UPDATE boutique_settings avec le boutique_id', async () => {
    const db = createMockD1()

    await updateBoutiqueSettings(db, 1, BASE_INPUT)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('UPDATE boutique_settings SET')
    expect(calls[0].params).toContain(1)  // boutique_id en dernier
  })

  it('convertit les booléens en 0/1 pour SQLite', async () => {
    const db = createMockD1()

    await updateBoutiqueSettings(db, 1, BASE_INPUT)

    const calls = db.__getCalls()
    const params = calls[0].params
    // notif_email_actif=true → 1, notif_sms_actif=false → 0
    expect(params).toContain(1)  // notif_email_actif
    expect(params).toContain(0)  // notif_sms_actif, paiement_cheque...
  })

  it('sérialise les horaires en JSON string', async () => {
    const db = createMockD1()
    const inputWithHoraires: UpdateSettingsInput = {
      ...BASE_INPUT,
      horaires: { lun: '9h-19h', mar: '9h-19h' }
    }

    await updateBoutiqueSettings(db, 1, inputWithHoraires)

    const calls = db.__getCalls()
    const jsonParam = calls[0].params.find((p: any) => typeof p === 'string' && p.includes('"lun"'))
    expect(jsonParam).toBe('{"lun":"9h-19h","mar":"9h-19h"}')
  })

  it('ne retourne rien (void)', async () => {
    const db = createMockD1()

    const result = await updateBoutiqueSettings(db, 1, BASE_INPUT)

    expect(result).toBeUndefined()
  })
})

// ─── getStatsBoutique ─────────────────────────────────────────────────────────

describe('getStatsBoutique', () => {
  it('retourne les 4 KPIs en parallèle', async () => {
    const db = createMockD1()
    db.__setListResponse('SELECT COUNT(*) as cnt FROM clients WHERE boutique_id = ? AND actif = 1', [])
    db.__setListResponse("SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND statut NOT IN ('livre','annule') AND actif = 1", [])
    db.__setListResponse("SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures WHERE boutique_id = ? AND statut='payee' AND strftime('%Y-%m',date_emission) = strftime('%Y-%m','now')", [])
    db.__setListResponse('SELECT COUNT(*) as cnt FROM produits WHERE boutique_id = ? AND stock_actuel <= stock_minimum AND actif = 1', [])

    // Réponses scalar via __setResponseFn
    db.__setResponseFn(
      'SELECT COUNT(*) as cnt FROM clients WHERE boutique_id = ? AND actif = 1',
      () => ({ cnt: 12 })
    )
    db.__setResponseFn(
      "SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND statut NOT IN ('livre','annule') AND actif = 1",
      () => ({ cnt: 3 })
    )
    db.__setResponseFn(
      "SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures WHERE boutique_id = ? AND statut='payee' AND strftime('%Y-%m',date_emission) = strftime('%Y-%m','now')",
      () => ({ ca: 4250.50 })
    )
    db.__setResponseFn(
      'SELECT COUNT(*) as cnt FROM produits WHERE boutique_id = ? AND stock_actuel <= stock_minimum AND actif = 1',
      () => ({ cnt: 2 })
    )

    const stats = await getStatsBoutique(db, 1)

    expect(stats.nb_clients).toBe(12)
    expect(stats.tickets_en_cours).toBe(3)
    expect(stats.ca_mois).toBe(4250.50)
    expect(stats.produits_stock_bas).toBe(2)
  })

  it('retourne 0 pour tous les KPIs si aucune donnée', async () => {
    const db = createMockD1()
    // Pas de réponses enregistrées → first() retourne null → fallback 0

    const stats = await getStatsBoutique(db, 99)

    expect(stats.nb_clients).toBe(0)
    expect(stats.tickets_en_cours).toBe(0)
    expect(stats.ca_mois).toBe(0)
    expect(stats.produits_stock_bas).toBe(0)
  })

  it('exécute exactement 4 requêtes SQL (Promise.all)', async () => {
    const db = createMockD1()

    await getStatsBoutique(db, 1)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(4)
  })

  it('toutes les requêtes utilisent le boutique_id fourni', async () => {
    const db = createMockD1()

    await getStatsBoutique(db, 7)

    const calls = db.__getCalls()
    expect(calls.every(c => c.params.includes(7))).toBe(true)
  })
})
