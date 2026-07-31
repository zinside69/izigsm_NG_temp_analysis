import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

/**
 * Gate de non-régression isolation multi-tenant.
 *
 * Historique : 3 failles d'isolation boutique_id déjà trouvées et corrigées sur ce
 * repo (photos tickets, isolation cross-boutique — voir project-docs/bugs.md), à
 * chaque fois découvertes en test manuel malgré des tests unitaires verts. Ce fichier
 * est le gate automatisé équivalent : un admin d'une boutique ne doit jamais pouvoir
 * lire les données d'une autre boutique via l'API.
 *
 * Le ticket 1 (seed.sql) appartient à la boutique 1 ("iziGSM Paris 11").
 */

const BOUTIQUE_1_TICKET_ID = 1

test.describe('Isolation multi-tenant', () => {
  test('un admin d\'une autre boutique ne peut pas lire un ticket qui ne lui appartient pas', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.get(`/api/tickets/${BOUTIQUE_1_TICKET_ID}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    // Attendu : 403 (ou 404 si l'API choisit de masquer l'existence). Un 200 avec les
    // données du ticket de la boutique 1 est une fuite cross-tenant.
    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas lister les photos d\'un ticket qui ne lui appartient pas', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.get(`/api/tickets/${BOUTIQUE_1_TICKET_ID}/photos`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  // Régression : PUT /:id, PUT /:id/statut, DELETE /:id n'avaient aucune vérification
  // boutique_id (trouvé par l'audit loop-engineering du 2026-07-19, voir bugs.md).
  test('un admin d\'une autre boutique ne peut pas modifier un ticket qui ne lui appartient pas (PUT /:id)', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.put(`/api/tickets/${BOUTIQUE_1_TICKET_ID}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: { notes_internes: 'modifié par un tenant étranger — ne doit jamais passer' },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas changer le statut d\'un ticket qui ne lui appartient pas (PUT /:id/statut)', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.put(`/api/tickets/${BOUTIQUE_1_TICKET_ID}/statut`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: { statut: 'annule' },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas supprimer un ticket qui ne lui appartient pas (DELETE /:id)', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.delete(`/api/tickets/${BOUTIQUE_1_TICKET_ID}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  // Régression : PUT /devis/:id/convertir n'avait aucune vérification boutique_id
  // (trouvé le 2026-07-30 en préparant POST /api/factures, voir bugs.md).
  //
  // Écart au plan (task-5-brief.md) : le brief supposait un devis d'id 1 préchargé
  // par seed.sql, appartenant à la boutique 1 — vérifié le 2026-07-30, faux : seed.sql
  // n'insère aucune ligne dans `devis` (seule la séquence de numérotation 'devis' y
  // est initialisée), donc pas d'ID stable à réutiliser. On crée à la place un devis
  // frais côté boutique 1 via l'API (login admin seed + POST /api/devis) au début de
  // chaque test, plutôt que de dépendre d'un ID fixe non garanti.
  async function createBoutique1Devis(request: APIRequestContext): Promise<number> {
    const accessToken = await loginSeedAdmin(request)

    const devisRes = await request.post('/api/devis', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        boutique_id: 1, // admin@izigsm.fr est admin plateforme (boutique_id NULL en seed) : explicite requis
        client_id: 1,
        lignes: [{ description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 50, tva_taux: 20 }],
      },
    })
    if (!devisRes.ok()) {
      throw new Error(`création devis boutique 1 failed: ${devisRes.status()} ${await devisRes.text()}`)
    }
    const devisBody = await devisRes.json()
    return devisBody.id
  }

  test('un admin d\'une autre boutique ne peut pas convertir un devis qui ne lui appartient pas', async ({ request }) => {
    const boutique1DevisId = await createBoutique1Devis(request)
    const otherTenant = await createTenantAdmin(request)

    const res = await request.put(`/api/devis/${boutique1DevisId}/convertir`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas facturer un devis qui ne lui appartient pas via POST /api/factures', async ({ request }) => {
    const boutique1DevisId = await createBoutique1Devis(request)
    const otherTenant = await createTenantAdmin(request)

    const res = await request.post('/api/factures', {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: { client_id: 1, devis_id: boutique1DevisId, action: 'brouillon' },
    })

    expect([403, 404]).toContain(res.status())
  })

  // ── Régression : 5 endpoints facture/avoir sans aucune vérification boutique_id ──
  //
  // Trouvés par la revue finale du chantier facture le 2026-07-30 (voir todo.md
  // § "Écritures cross-tenant" et bugs.md). Dette antérieure à ce chantier, mais sur
  // des documents réglementaires : POST /factures/:id/emettre verrouille définitivement
  // la facture d'une autre boutique et écrit dans son journal NF525 avec l'user_id de
  // l'appelant — irréversible.
  //
  // Même contrainte que pour le devis ci-dessus : seed.sql n'insère aucune facture ni
  // aucun avoir (seules les séquences de numérotation y sont initialisées), donc pas
  // d'ID stable à réutiliser — chaque test crée ses propres ressources boutique 1.
  //
  // Le tenant créé par createTenantAdmin est un `manager` (role_id 2, migration 0001)
  // avec sa propre boutique : requireRole('admin','manager') le laisse donc entrer
  // jusqu'au code métier, et le patron "l'admin plateforme traverse" ne le couvre pas.
  async function loginSeedAdmin(request: APIRequestContext): Promise<string> {
    const loginRes = await request.post('/api/auth/login', {
      data: { email: 'admin@izigsm.fr', password: 'Admin@2026!' },
    })
    if (!loginRes.ok()) {
      throw new Error(`login admin boutique 1 (seed) failed: ${loginRes.status()} ${await loginRes.text()}`)
    }
    return (await loginRes.json()).accessToken
  }

  async function createBoutique1Facture(
    request: APIRequestContext,
    action: 'brouillon' | 'emettre'
  ): Promise<number> {
    const accessToken = await loginSeedAdmin(request)

    const res = await request.post('/api/factures', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        boutique_id: 1, // admin@izigsm.fr est admin plateforme (boutique_id NULL) : explicite requis
        client_id: 1,
        action,
        lignes: [{ description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 50, tva_taux: 20 }],
      },
    })
    if (!res.ok()) {
      throw new Error(`création facture boutique 1 (${action}) failed: ${res.status()} ${await res.text()}`)
    }
    return (await res.json()).facture_id
  }

  async function createBoutique1Avoir(request: APIRequestContext): Promise<number> {
    // createAvoir() exige une facture émise (verrouillée NF525) comme support.
    const factureId   = await createBoutique1Facture(request, 'emettre')
    const accessToken = await loginSeedAdmin(request)

    const res = await request.post('/api/avoirs', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        facture_id: factureId,
        motif:      'Geste commercial (fixture e2e)',
        lignes:     [{ description: 'Remboursement partiel', quantite: 1, prix_unitaire_ht: 10, tva_taux: 20 }],
      },
    })
    if (!res.ok()) {
      throw new Error(`création avoir boutique 1 failed: ${res.status()} ${await res.text()}`)
    }
    return (await res.json()).id
  }

  test('un admin d\'une autre boutique ne peut pas lire une facture qui ne lui appartient pas (GET /factures/:id)', async ({ request }) => {
    const factureId   = await createBoutique1Facture(request, 'brouillon')
    const otherTenant = await createTenantAdmin(request)

    const res = await request.get(`/api/factures/${factureId}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas encaisser une facture qui ne lui appartient pas (POST /factures/:id/paiement)', async ({ request }) => {
    const factureId   = await createBoutique1Facture(request, 'brouillon')
    const otherTenant = await createTenantAdmin(request)

    const res = await request.post(`/api/factures/${factureId}/paiement`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: { montant: 10, mode_paiement: 'especes' },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas émettre une facture qui ne lui appartient pas (POST /factures/:id/emettre)', async ({ request }) => {
    const factureId   = await createBoutique1Facture(request, 'brouillon')
    const otherTenant = await createTenantAdmin(request)

    const res = await request.post(`/api/factures/${factureId}/emettre`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas lire un avoir qui ne lui appartient pas (GET /avoirs/:id)', async ({ request }) => {
    const avoirId     = await createBoutique1Avoir(request)
    const otherTenant = await createTenantAdmin(request)

    const res = await request.get(`/api/avoirs/${avoirId}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  // Contrepartie indispensable des 5 tests ci-dessus : ils prouvent que l'étranger est
  // refusé, pas que le propriétaire passe encore. Sans ce test, une garde trop stricte
  // (403 sur ses propres factures) serait un gate vert et une régression majeure en prod.
  test('le propriétaire légitime accède bien à sa propre facture et peut l\'émettre', async ({ request }) => {
    const tenant = await createTenantAdmin(request)
    const auth   = { Authorization: `Bearer ${tenant.accessToken}` }

    const clientRes = await request.post('/api/clients', {
      headers: auth,
      data: { prenom: 'E2E', nom: 'Proprietaire' },
    })
    if (!clientRes.ok()) {
      throw new Error(`création client tenant failed: ${clientRes.status()} ${await clientRes.text()}`)
    }
    const clientId = (await clientRes.json()).id

    const factureRes = await request.post('/api/factures', {
      headers: auth,
      data: {
        client_id: clientId, // boutique_id dérivé du JWT : un manager ne peut pas en choisir un autre
        action:    'brouillon',
        lignes:    [{ description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 50, tva_taux: 20 }],
      },
    })
    expect(factureRes.status()).toBe(201)
    const factureId = (await factureRes.json()).facture_id

    const lectureRes = await request.get(`/api/factures/${factureId}`, { headers: auth })
    expect(lectureRes.status()).toBe(200)

    const emissionRes = await request.post(`/api/factures/${factureId}/emettre`, { headers: auth })
    expect(emissionRes.status()).toBe(200)
  })

  test('un admin d\'une autre boutique ne peut pas créer un avoir sur une facture qui ne lui appartient pas (POST /avoirs)', async ({ request }) => {
    const factureId   = await createBoutique1Facture(request, 'emettre')
    const otherTenant = await createTenantAdmin(request)

    const res = await request.post('/api/avoirs', {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: {
        facture_id: factureId,
        motif:      'Avoir émis par un tenant étranger — ne doit jamais passer',
        lignes:     [{ description: 'Remboursement', quantite: 1, prix_unitaire_ht: 10, tva_taux: 20 }],
      },
    })

    expect([403, 404]).toContain(res.status())
  })
})
