/**
 * @file tests/e2e/facture-numerotation.spec.ts
 * @description Le numéro de facture n'est attribué qu'à l'émission — ticket 001 du
 * chantier `.scratch/conformite-facturation/`.
 *
 * Ce qui ne peut se prouver QUE contre la vraie base (les tests unitaires mockent D1) :
 *   - `factures.numero` accepte plusieurs `NULL` pour une même boutique, malgré
 *     `UNIQUE(boutique_id, numero)` (migration 0040) ;
 *   - la série d'une boutique neuve part à 1 et n'a aucun trou, quel que soit le
 *     nombre de brouillons créés puis abandonnés ;
 *   - une émission refusée ne fait pas avancer le compteur.
 *
 * Chaque test crée son propre tenant (`createTenantAdmin`) : la séquence part donc
 * de zéro et les numéros attendus sont déterministes, sans dépendre du seed ni de
 * l'ordre d'exécution.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

/** Séquence par (boutique, type, année) — l'année du numéro est celle du serveur. */
const ANNEE = new Date().getFullYear()
const numeroAttendu = (n: number) => `FAC-${ANNEE}-${String(n).padStart(5, '0')}`

const LIGNES = [
  { description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
]

test.describe('numérotation des factures — attribution à l\'émission', () => {
  test('plusieurs brouillons coexistent sans numéro, et n\'entament pas la série', async ({ request }) => {
    const admin = await createTenantAdmin(request)
    const auth  = { Authorization: `Bearer ${admin.accessToken}` }

    const client = await request.post('/api/clients', {
      headers: auth,
      data: { prenom: 'Marie', nom: 'Dupont', boutique_id: admin.boutiqueId },
    })
    expect(client.status()).toBe(201)
    const clientId = (await client.json()).id

    const creerBrouillon = async () => {
      const res = await request.post('/api/factures', {
        headers: auth,
        data: {
          client_id: clientId, boutique_id: admin.boutiqueId,
          lignes: LIGNES, action: 'brouillon',
        },
      })
      expect(res.status()).toBe(201)
      return res.json()
    }

    // Deux brouillons dans la même boutique : c'est ici que l'ancien schéma
    // (`numero TEXT NOT NULL`) aurait refusé la seconde insertion.
    const b1 = await creerBrouillon()
    const b2 = await creerBrouillon()

    expect(b1.facture_numero).toBeNull()
    expect(b2.facture_numero).toBeNull()
    expect(b1.statut).toBe('brouillon')

    // La série n'a rien consommé : la première ÉMISSION prend le numéro 1, même si
    // c'est le second brouillon créé qui est émis en premier.
    const emis = await request.post(`/api/factures/${b2.facture_id}/emettre`, { headers: auth })
    expect(emis.status()).toBe(200)
    expect((await emis.json()).facture_numero).toBe(numeroAttendu(1))

    // Le brouillon resté en attente prend le numéro suivant, sans trou.
    const emis2 = await request.post(`/api/factures/${b1.facture_id}/emettre`, { headers: auth })
    expect(emis2.status()).toBe(200)
    expect((await emis2.json()).facture_numero).toBe(numeroAttendu(2))
  })

  test('une émission refusée ne consomme aucun numéro', async ({ request }) => {
    const admin = await createTenantAdmin(request)
    const auth  = { Authorization: `Bearer ${admin.accessToken}` }

    const client = await request.post('/api/clients', {
      headers: auth,
      data: { prenom: 'Paul', nom: 'Martin', boutique_id: admin.boutiqueId },
    })
    const clientId = (await client.json()).id

    const creer = async (action: string) => {
      const res = await request.post('/api/factures', {
        headers: auth,
        data: { client_id: clientId, boutique_id: admin.boutiqueId, lignes: LIGNES, action },
      })
      expect(res.status()).toBe(201)
      return res.json()
    }

    const premiere = await creer('emettre')
    expect(premiere.facture_numero).toBe(numeroAttendu(1))

    // Réémettre une facture déjà verrouillée : refusée. Le compteur ne doit pas
    // bouger — c'est précisément le geste qui creusait un trou avant le ticket 001.
    const refus = await request.post(`/api/factures/${premiere.facture_id}/emettre`, { headers: auth })
    expect(refus.status()).toBe(400)

    const seconde = await creer('emettre')
    expect(seconde.facture_numero).toBe(numeroAttendu(2))
  })
})
