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
    const loginRes = await request.post('/api/auth/login', {
      data: { email: 'admin@izigsm.fr', password: 'Admin@2026!' },
    })
    if (!loginRes.ok()) {
      throw new Error(`login admin boutique 1 (seed) failed: ${loginRes.status()} ${await loginRes.text()}`)
    }
    const { accessToken } = await loginRes.json()

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
})
