/**
 * @file tests/routes-tickets-imei.test.ts
 * @description IMEI enregistré à la prise en charge (ticket 08a) — ce qui se joue au niveau
 * route : statuts HTTP, et ce que la route a réellement envoyé en base (le mock D1 rend ce
 * qu'on lui configure quelle que soit la requête — la règle SQL de résolution de l'appareil est
 * prouvée contre un vrai SQLite dans tests/ticket-appareil-sqlite.test.ts, CLAUDE.md § Bons de
 * commande).
 *
 * Point notable : `PUT /api/tickets/:id` ignore TOUJOURS un `appareil_id` explicite du corps —
 * seul le champ `imei` (résolu par `resoudreAppareilTicket()`) peut faire bouger
 * `tickets.appareil_id`. Un appelant qui enverrait l'`appareil_id` d'une autre boutique ne doit
 * jamais réussir à le poser sur le ticket (décision du 2026-09-30, précision P15 du socle).
 */
import { describe, it, expect } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

const SECRET = 'secret-de-test'
const IMEI      = '356938035643809'
const IMEI_FAUX = '356938035643800'

const SQL_TICKET = `SELECT t.*, c.prenom || ' ' || c.nom AS client_nom, c.email AS client_email, c.telephone AS client_telephone, c.adresse AS client_adresse, u.prenom || ' ' || u.nom AS technicien_nom, d.id AS devis_id, d.statut AS devis_statut, fa.id AS facture_acompte_id, fa.numero AS facture_acompte_numero, fa.total_ttc AS facture_acompte_montant, fa.total_ht AS facture_acompte_ht, (SELECT tva_taux FROM lignes_document WHERE document_type = 'facture' AND document_id = fa.id LIMIT 1) AS facture_acompte_tva_taux, ap.imei AS appareil_imei, ap.numero_serie AS appareil_numero_serie FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id LEFT JOIN devis d ON d.id = ( SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1 ) LEFT JOIN factures fa ON fa.type_facture = 'acompte' AND (fa.ticket_id = t.id OR fa.devis_id = d.id) LEFT JOIN appareils ap ON ap.id = t.appareil_id WHERE t.id = ? AND t.actif = 1`
const SQL_CLIENT_BOUTIQUE = 'SELECT id FROM clients WHERE id = ? AND boutique_id = ?'

async function appeler(
  chemin: string,
  { method = 'GET', corps }: { method?: string; corps?: unknown } = {},
  d1 = createMockD1(),
) {
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'manager@boutique.fr', prenom: 'M', nom: 'Test', role: 'manager', boutique_id: 1 } as any,
    SECRET,
  )
  const res = await app.request(
    chemin,
    {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
    },
    { DB: d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return { res, d1 }
}

describe('POST /api/tickets — IMEI (ticket 08a)', () => {
  it('IMEI à clé de Luhn fausse → 400, aucun ticket créé', async () => {
    const d1 = createMockD1()
    d1.__setResponse(SQL_CLIENT_BOUTIQUE, { id: 7 })
    const { res, d1: d1Apres } = await appeler('/api/tickets', {
      method: 'POST',
      corps: {
        client_id: 7, appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
        description_panne: 'Écran cassé', imei: IMEI_FAUX,
      },
    }, d1)

    expect(res.status).toBe(400)
    const corps = await res.json() as any
    expect(corps.success).toBe(false)
    expect(corps.error).toContain('IMEI invalide (clé de contrôle)')
    expect(d1Apres.__getCalls().find(c => c.sql.startsWith('INSERT INTO tickets'))).toBeUndefined()
  })

  it('appareil_id explicite d\'un autre client → 400, aucun ticket créé', async () => {
    const d1 = createMockD1()
    d1.__setResponse(SQL_CLIENT_BOUTIQUE, { id: 7 })
    d1.__setNotFound('SELECT ap.id FROM appareils ap JOIN clients c ON c.id = ap.client_id AND c.boutique_id = ? WHERE ap.id = ? AND ap.client_id = ?')
    const { res, d1: d1Apres } = await appeler('/api/tickets', {
      method: 'POST',
      corps: {
        client_id: 7, appareil_id: 999, appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
        description_panne: 'Écran cassé',
      },
    }, d1)

    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toContain('Appareil introuvable pour ce client')
    expect(d1Apres.__getCalls().find(c => c.sql.startsWith('INSERT INTO tickets'))).toBeUndefined()
  })
})

describe('PUT /api/tickets/:id — IMEI (ticket 08a)', () => {
  it('un appareil_id explicite du corps (d\'une autre boutique) laisse tickets.appareil_id inchangé', async () => {
    const d1 = createMockD1()
    d1.__setResponse(SQL_TICKET, {
      id: 42, boutique_id: 1, client_id: 7,
      appareil_marque: 'Apple', appareil_modele: 'iPhone 14', actif: 1,
    })
    d1.__setResponse('SELECT id, boutique_id FROM tickets WHERE id = ? AND actif = 1', { id: 42, boutique_id: 1 })

    const { res, d1: d1Apres } = await appeler('/api/tickets/42', {
      method: 'PUT',
      // `appareil_id: 999` : id d'un appareil appartenant (hypothétiquement) à une autre
      // boutique — la route ne doit JAMAIS le lire, qu'il existe ou non côté serveur.
      corps: { diagnostic: 'Fusible grillé', appareil_id: 999 },
    }, d1)

    expect(res.status).toBe(200)
    // La route n'a interrogé/écrit aucune ligne autour de l'id 999 : ni vérification
    // d'appartenance, ni (a fortiori) écriture de ce id sur le ticket.
    expect(d1Apres.__getCalls().some(c => (c.params as unknown[]).includes(999))).toBe(false)
    const update = d1Apres.__getCalls().find(c => c.sql.startsWith('UPDATE tickets SET'))
    expect(update).toBeDefined()
    // appareil_id = COALESCE(?, appareil_id) : 9e paramètre bindé (voir ticketService.test.ts) —
    // doit valoir null (inchangé), jamais 999.
    expect(update?.params[8]).toBeNull()
  })

  it('champ imei valide → résout l\'appareil et le transmet à updateTicket() (appareil_id bougé)', async () => {
    const d1 = createMockD1()
    d1.__setResponse(SQL_TICKET, {
      id: 42, boutique_id: 1, client_id: 7,
      appareil_marque: 'Apple', appareil_modele: 'iPhone 14', actif: 1,
    })
    d1.__setResponse('SELECT id, boutique_id FROM tickets WHERE id = ? AND actif = 1', { id: 42, boutique_id: 1 })
    d1.__setResponse(SQL_CLIENT_BOUTIQUE, { id: 7 })
    d1.__setNotFound('SELECT ap.id FROM appareils ap JOIN clients c ON c.id = ap.client_id AND c.boutique_id = ? WHERE ap.client_id = ? AND ap.imei = ? ORDER BY ap.id LIMIT 1')
    d1.__setResponseFn(
      'INSERT INTO appareils (client_id, marque, modele, imei) VALUES (?, ?, ?, ?) RETURNING id',
      () => ({ id: 55 }),
    )

    const { res, d1: d1Apres } = await appeler('/api/tickets/42', {
      method: 'PUT',
      corps: { imei: IMEI },
    }, d1)

    expect(res.status).toBe(200)
    const update = d1Apres.__getCalls().find(c => c.sql.startsWith('UPDATE tickets SET'))
    expect(update?.params[8]).toBe(55)
  })

  it('champ imei absent → appareil_id inchangé', async () => {
    const d1 = createMockD1()
    d1.__setResponse(SQL_TICKET, {
      id: 42, boutique_id: 1, client_id: 7,
      appareil_marque: 'Apple', appareil_modele: 'iPhone 14', actif: 1,
    })
    d1.__setResponse('SELECT id, boutique_id FROM tickets WHERE id = ? AND actif = 1', { id: 42, boutique_id: 1 })

    const { res, d1: d1Apres } = await appeler('/api/tickets/42', {
      method: 'PUT',
      corps: { diagnostic: 'RAS' },
    }, d1)

    expect(res.status).toBe(200)
    const update = d1Apres.__getCalls().find(c => c.sql.startsWith('UPDATE tickets SET'))
    expect(update?.params[8]).toBeNull()
  })

  it('champ imei vide ("") → appareil_id inchangé (même règle que absent)', async () => {
    const d1 = createMockD1()
    d1.__setResponse(SQL_TICKET, {
      id: 42, boutique_id: 1, client_id: 7,
      appareil_marque: 'Apple', appareil_modele: 'iPhone 14', actif: 1,
    })
    d1.__setResponse('SELECT id, boutique_id FROM tickets WHERE id = ? AND actif = 1', { id: 42, boutique_id: 1 })

    const { res, d1: d1Apres } = await appeler('/api/tickets/42', {
      method: 'PUT',
      corps: { imei: '' },
    }, d1)

    expect(res.status).toBe(200)
    const update = d1Apres.__getCalls().find(c => c.sql.startsWith('UPDATE tickets SET'))
    expect(update?.params[8]).toBeNull()
  })
})
