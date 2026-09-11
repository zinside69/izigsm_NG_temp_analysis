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
import { createMockDatabase } from './helpers/mockDatabase'
import {
  listAllBoutiques,
  listBoutiqueForUser,
  getBoutiqueById,
  getBoutiqueSettings,
  createBoutique,
  updateBoutique,
  updateBoutiqueSettings,
  getStatsBoutique,
  resoudreTauxMarge,
  updateTauxMarge,
  type Boutique,
  type BoutiqueAvecComptes,
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
  site_web: null, description: null, logo_url: null, actif: 1,
}

const BOUTIQUE_2: Boutique = {
  id: 2, nom: 'iZiGSM Lyon', slug: 'izigsm-lyon',
  siret: null, tva_numero: null,
  adresse: null, code_postal: null, ville: 'Lyon',
  telephone: null, email: null,
  site_web: null, description: null, logo_url: null, actif: 1,
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
  marge_taux_defaut: null, marge_taux_piece: null, marge_taux_accessoire: null,
  marge_taux_appareil: null, marge_taux_consommable: null,
}

// ─── listAllBoutiques ─────────────────────────────────────────────────────────

// SQL du chemin admin plateforme — enrichi du nombre de comptes rattachés pour
// la console des boutiques (chantier supervision, ticket 01). Répliqué ici car
// le mock Database matche sur la requête exacte (normalisée).
const SQL_LIST_ALL =
  `SELECT b.*,
          b.id AS boutique_id,
          (SELECT COUNT(*) FROM users u WHERE u.boutique_id = b.id) AS nb_comptes
     FROM boutiques b
    WHERE b.actif = 1
    ORDER BY b.nom`

const BOUTIQUE_1_COMPTES: BoutiqueAvecComptes = { ...BOUTIQUE_1, boutique_id: 1, nb_comptes: 3 }
const BOUTIQUE_2_COMPTES: BoutiqueAvecComptes = { ...BOUTIQUE_2, boutique_id: 2, nb_comptes: 0 }

describe('listAllBoutiques', () => {
  it('retourne toutes les boutiques actives triées par nom', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_ALL, [BOUTIQUE_1_COMPTES, BOUTIQUE_2_COMPTES])

    const result = await listAllBoutiques(db)

    expect(result).toHaveLength(2)
    expect(result[0].nom).toBe('iZiGSM Paris')
    expect(result[1].nom).toBe('iZiGSM Lyon')
  })

  it('retourne un tableau vide si aucune boutique active', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_ALL, [])

    const result = await listAllBoutiques(db)

    expect(result).toEqual([])
  })

  it('expose le nombre de comptes et le slug de chaque boutique', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_ALL, [BOUTIQUE_1_COMPTES, BOUTIQUE_2_COMPTES])

    const result = await listAllBoutiques(db)

    expect(result[0].nb_comptes).toBe(3)
    expect(result[0].slug).toBe('izigsm-paris')
    expect(result[1].nb_comptes).toBe(0)
  })

  it('compte les comptes rattachés à chaque boutique (agrégat sur users)', async () => {
    const db = createMockDatabase()

    await listAllBoutiques(db)

    // Le comptage doit être fait par la requête elle-même : sans agrégat SQL,
    // la console afficherait un nombre inventé côté frontend.
    const [call] = db.__getCalls()
    expect(call.sql).toMatch(/COUNT\(\*\).*users/i)
  })
})

// ─── listBoutiqueForUser ──────────────────────────────────────────────────────

describe('listBoutiqueForUser', () => {
  it('retourne uniquement la boutique de l\'utilisateur', async () => {
    const db = createMockDatabase()
    db.__setListResponse('SELECT * FROM boutiques WHERE id = ? AND actif = 1', [BOUTIQUE_1])

    const result = await listBoutiqueForUser(db, 1)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
  })

  it('retourne un tableau vide si boutique_id invalide ou inactive', async () => {
    const db = createMockDatabase()
    db.__setListResponse('SELECT * FROM boutiques WHERE id = ? AND actif = 1', [])

    const result = await listBoutiqueForUser(db, 999)

    expect(result).toEqual([])
  })

  it('transmet le boutique_id en paramètre SQL', async () => {
    const db = createMockDatabase()

    await listBoutiqueForUser(db, 7)

    const calls = db.__getCalls()
    expect(calls[0].params).toContain(7)
  })
})

// ─── getBoutiqueById ──────────────────────────────────────────────────────────

describe('getBoutiqueById', () => {
  it('retourne la boutique si elle est active', async () => {
    const db = createMockDatabase()
    db.__setResponse('SELECT * FROM boutiques WHERE id = ? AND actif = 1', BOUTIQUE_1)

    const result = await getBoutiqueById(db, 1)

    expect(result).not.toBeNull()
    expect(result?.nom).toBe('iZiGSM Paris')
    expect(result?.slug).toBe('izigsm-paris')
  })

  it('retourne null si boutique inactive ou inexistante', async () => {
    const db = createMockDatabase()
    db.__setNotFound('SELECT * FROM boutiques WHERE id = ? AND actif = 1')

    const result = await getBoutiqueById(db, 99)

    expect(result).toBeNull()
  })
})

// ─── getBoutiqueSettings ──────────────────────────────────────────────────────

describe('getBoutiqueSettings', () => {
  it('retourne les paramètres de la boutique', async () => {
    const db = createMockDatabase()
    db.__setResponse('SELECT * FROM boutique_settings WHERE boutique_id = ?', SETTINGS_1)

    const result = await getBoutiqueSettings(db, 1)

    expect(result).not.toBeNull()
    expect(result?.tva_taux_defaut).toBe(20)
    expect(result?.prefix_ticket).toBe('TK')
    expect(result?.format_numero).toBe('annee')
  })

  it('retourne null si settings non initialisés', async () => {
    const db = createMockDatabase()
    db.__setNotFound('SELECT * FROM boutique_settings WHERE boutique_id = ?')

    const result = await getBoutiqueSettings(db, 99)

    expect(result).toBeNull()
  })
})

// ─── resoudreTauxMarge ────────────────────────────────────────────────────────
// Ticket 02 chantier Mobilax : taux de la famille s'il est défini, sinon taux par
// défaut de la boutique, sinon null (aucune marge inventée — décision 2026-09-10).

describe('resoudreTauxMarge', () => {
  const AUCUN_TAUX = {
    marge_taux_defaut: null, marge_taux_piece: null, marge_taux_accessoire: null,
    marge_taux_appareil: null, marge_taux_consommable: null,
  }

  it('retourne le taux par défaut quand seul celui-ci est fixé', () => {
    const settings = { ...AUCUN_TAUX, marge_taux_defaut: 30 }

    expect(resoudreTauxMarge(settings, 'piece')).toBe(30)
    expect(resoudreTauxMarge(settings, 'accessoire')).toBe(30)
  })

  it('retourne le taux de la famille quand il surcharge le défaut', () => {
    const settings = { ...AUCUN_TAUX, marge_taux_defaut: 30, marge_taux_accessoire: 80 }

    expect(resoudreTauxMarge(settings, 'accessoire')).toBe(80)
  })

  it('retombe sur le défaut pour une famille sans taux propre', () => {
    const settings = { ...AUCUN_TAUX, marge_taux_defaut: 30, marge_taux_accessoire: 80 }

    expect(resoudreTauxMarge(settings, 'piece')).toBe(30)
  })

  it('respecte un taux de famille fixé à 0 % au lieu de retomber sur le défaut', () => {
    const settings = { ...AUCUN_TAUX, marge_taux_defaut: 30, marge_taux_consommable: 0 }

    expect(resoudreTauxMarge(settings, 'consommable')).toBe(0)
  })

  it('retourne null quand la boutique n\'a saisi aucun taux', () => {
    expect(resoudreTauxMarge(AUCUN_TAUX, 'piece')).toBeNull()
  })

  it('retourne null quand la boutique n\'a pas de paramètres', () => {
    expect(resoudreTauxMarge(null, 'appareil')).toBeNull()
  })
})

// ─── updateTauxMarge ──────────────────────────────────────────────────────────
// Écriture dédiée, distincte d'updateBoutiqueSettings() : les 5 taux sont assignés
// tels quels (null = retour au repli), sans COALESCE — et aucun autre paramètre
// n'est touché, pour qu'un onglet ne puisse pas écraser l'autre.

describe('updateTauxMarge', () => {
  const MARGES = {
    marge_taux_defaut: 30, marge_taux_piece: null, marge_taux_accessoire: 80,
    marge_taux_appareil: null, marge_taux_consommable: 0,
  }

  it('écrit les cinq taux sur la boutique visée, et elle seule', async () => {
    const db = createMockDatabase()

    await updateTauxMarge(db, 7, MARGES)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('UPDATE boutique_settings SET')
    expect(calls[0].sql).toContain('WHERE boutique_id = ?')
    expect(calls[0].params).toEqual([30, null, 80, null, 0, 7])
  })

  it('efface un taux de famille par un null explicite, sans le conserver', async () => {
    const db = createMockDatabase()

    await updateTauxMarge(db, 1, MARGES)

    expect(db.__getCalls()[0].sql).not.toContain('COALESCE')
  })

  it('ne touche aucun autre paramètre de la boutique', async () => {
    const db = createMockDatabase()

    await updateTauxMarge(db, 1, MARGES)

    const sql = db.__getCalls()[0].sql
    expect(sql).not.toMatch(/tva_taux_defaut|paiement_|notif_|prefix_|email_/)
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
    const db = createMockDatabase()
    db.__setResponseFn(
      'INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      () => ({ id: 3 })
    )

    const id = await createBoutique(db, INPUT)

    expect(id).toBe(3)
  })

  it('exécute INSERT boutiques PUIS INSERT boutique_settings', async () => {
    const db = createMockDatabase()
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
    const db = createMockDatabase()
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
    const db = createMockDatabase()
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
    const db = createMockDatabase()

    await updateBoutique(db, 1, INPUT)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('UPDATE boutiques SET')
    expect(calls[0].sql).toContain('COALESCE')
    expect(calls[0].params).toContain(1)       // id en dernier
    expect(calls[0].params).toContain('Nouveau Nom')
  })

  it('inclut CURRENT_TIMESTAMP dans le SQL (updated_at)', async () => {
    const db = createMockDatabase()

    await updateBoutique(db, 1, INPUT)

    const calls = db.__getCalls()
    expect(calls[0].sql).toContain('updated_at=CURRENT_TIMESTAMP')
  })

  it('passe null pour les champs non fournis (comportement COALESCE)', async () => {
    const db = createMockDatabase()

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
    const db = createMockDatabase()

    await updateBoutiqueSettings(db, 1, BASE_INPUT)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('UPDATE boutique_settings SET')
    expect(calls[0].params).toContain(1)  // boutique_id en dernier
  })

  it('convertit les booléens en 0/1 pour SQLite', async () => {
    const db = createMockDatabase()

    await updateBoutiqueSettings(db, 1, BASE_INPUT)

    const calls = db.__getCalls()
    const params = calls[0].params
    // notif_email_actif=true → 1, notif_sms_actif=false → 0
    expect(params).toContain(1)  // notif_email_actif
    expect(params).toContain(0)  // notif_sms_actif, paiement_cheque...
  })

  it('sérialise les horaires en JSON string', async () => {
    const db = createMockDatabase()
    const inputWithHoraires: UpdateSettingsInput = {
      ...BASE_INPUT,
      horaires: { lun: '9h-19h', mar: '9h-19h' }
    }

    await updateBoutiqueSettings(db, 1, inputWithHoraires)

    const calls = db.__getCalls()
    const jsonParam = calls[0].params.find((p: any) => typeof p === 'string' && p.includes('"lun"'))
    expect(jsonParam).toBe('{"lun":"9h-19h","mar":"9h-19h"}')
  })

  // ─── P1 du 2026-09-10 : chaque onglet des Réglages envoie un corps PARTIEL ──────
  // Un champ absent doit être conservé, jamais remplacé par 20 % ou « décoché ».

  /** Corps de l'onglet Numérotation : ni TVA, ni paiements, ni notifications, ni horaires. */
  const CORPS_NUMEROTATION: UpdateSettingsInput = {
    ...BASE_INPUT,
    tva_taux_defaut: null, horaires: null,
    notif_email_actif: null, notif_sms_actif: null,
    paiement_especes: null, paiement_cb: null, paiement_cheque: null, paiement_virement: null,
    prefix_ticket: 'TK', format_numero: 'annee', padding_numero: 5,
  }

  /** Colonnes que la requête commune écrasait faute de COALESCE. */
  const COLONNES_A_CONSERVER = [
    'tva_taux_defaut', 'horaires', 'notif_email_actif', 'notif_sms_actif',
    'paiement_especes', 'paiement_cb', 'paiement_cheque', 'paiement_virement',
  ]

  it('conserve TVA, paiements, notifications et horaires absents du corps', async () => {
    const db = createMockDatabase()

    await updateBoutiqueSettings(db, 1, CORPS_NUMEROTATION)

    const { sql, params } = db.__getCalls()[0]
    // Les 8 premiers paramètres sont ces colonnes, dans cet ordre : absents → null…
    expect(params.slice(0, 8), 'un champ absent ne doit pas devenir 20 % ni 0').toEqual(Array(8).fill(null))
    // … et le SQL doit conserver la valeur en place quand il reçoit null.
    for (const colonne of COLONNES_A_CONSERVER) {
      expect(sql, `${colonne} doit être sous COALESCE`).toContain(`${colonne}=COALESCE(?,${colonne})`)
    }
  })

  it('écrit 0 pour un moyen de paiement explicitement décoché', async () => {
    // Garde-fou du correctif : conserver l'absent ne doit pas rendre le décochage impossible.
    const db = createMockDatabase()

    await updateBoutiqueSettings(db, 1, { ...CORPS_NUMEROTATION, paiement_cheque: false, paiement_cb: true })

    const params = db.__getCalls()[0].params
    expect(params[5], 'paiement_cb coché').toBe(1)
    expect(params[6], 'paiement_cheque décoché').toBe(0)
  })

  it('ne retourne rien (void)', async () => {
    const db = createMockDatabase()

    const result = await updateBoutiqueSettings(db, 1, BASE_INPUT)

    expect(result).toBeUndefined()
  })
})

// ─── getStatsBoutique ─────────────────────────────────────────────────────────

describe('getStatsBoutique', () => {
  it('retourne les 4 KPIs en parallèle', async () => {
    const db = createMockDatabase()
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
    const db = createMockDatabase()
    // Pas de réponses enregistrées → first() retourne null → fallback 0

    const stats = await getStatsBoutique(db, 99)

    expect(stats.nb_clients).toBe(0)
    expect(stats.tickets_en_cours).toBe(0)
    expect(stats.ca_mois).toBe(0)
    expect(stats.produits_stock_bas).toBe(0)
  })

  it('exécute exactement 4 requêtes SQL (Promise.all)', async () => {
    const db = createMockDatabase()

    await getStatsBoutique(db, 1)

    const calls = db.__getCalls()
    expect(calls).toHaveLength(4)
  })

  it('toutes les requêtes utilisent le boutique_id fourni', async () => {
    const db = createMockDatabase()

    await getStatsBoutique(db, 7)

    const calls = db.__getCalls()
    expect(calls.every(c => c.params.includes(7))).toBe(true)
  })
})
