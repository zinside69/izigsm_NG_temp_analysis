/**
 * @file tests/e2e/fournisseur-marque-mobilax.spec.ts
 * @description Un fournisseur peut être marqué « Mobilax » — c'est ce marquage qui dit au
 * service de recherche quel fournisseur de la boutique porte la clé à utiliser (ticket 03,
 * chantier `integration-mobilax`, décision du 2026-09-11 : colonne explicite plutôt qu'un
 * nom deviné).
 *
 * Trois états à la mise à jour, tous observables à la relecture :
 *   - champ absent du corps → marquage inchangé (les autres champs se modifient seuls) ;
 *   - `null`               → marquage retiré ;
 *   - `'mobilax'`           → marquage posé.
 * Et une valeur inconnue est refusée : aucun autre grossiste n'est branché.
 *
 * Contre la vraie D1 locale : un aller-retour en base ne se prouve pas avec un mock.
 */
import { test, expect } from '@playwright/test'
import { MANAGER, obtenirToken } from './fixtures/comptes'

test.describe('Fournisseur — marquage « Mobilax »', () => {
  test('posé à la création, conservé si absent, retiré par null, valeur inconnue refusée', async ({ request }) => {
    const headers = { Authorization: `Bearer ${await obtenirToken(request, MANAGER)}` }
    const lire = async (id: number) =>
      (await (await request.get(`/api/fournisseurs/${id}`, { headers })).json()).data

    const cree = await request.post('/api/fournisseurs', {
      headers, data: { nom: `Mobilax marquage ${Date.now()}`, api_plateforme: 'mobilax' },
    })
    expect(cree.status()).toBe(201)
    const id = (await cree.json()).id
    expect((await lire(id)).api_plateforme).toBe('mobilax')

    // Champ absent : seul le téléphone change, le marquage reste
    const partiel = await request.put(`/api/fournisseurs/${id}`, {
      headers, data: { nom: 'Mobilax renommé', telephone: '0102030405' },
    })
    expect(partiel.status()).toBe(200)
    expect((await lire(id)).api_plateforme).toBe('mobilax')

    // null : marquage retiré
    const retire = await request.put(`/api/fournisseurs/${id}`, {
      headers, data: { nom: 'Mobilax renommé', api_plateforme: null },
    })
    expect(retire.status()).toBe(200)
    expect((await lire(id)).api_plateforme).toBeNull()

    // Valeur inconnue : refusée, rien d'écrit
    const inconnu = await request.put(`/api/fournisseurs/${id}`, {
      headers, data: { nom: 'Mobilax renommé', api_plateforme: 'autre-grossiste' },
    })
    expect(inconnu.status()).toBe(400)
    expect((await lire(id)).api_plateforme).toBeNull()
  })
})
