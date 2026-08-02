/**
 * @file tests/e2e/xss-gabarits.spec.ts
 * @description Les gabarits qui construisent du HTML à partir de données d'API échappent
 * ce qu'un utilisateur a saisi (P3 de `project-docs/todo.md`, suite du checkpoint 75).
 *
 * Le checkpoint 75 a fermé une XSS stockée dans `buildSidebar()` — le nom de boutique est
 * choisi par le client, et il était interpolé brut dans `outerHTML`. L'audit des autres
 * gabarits restait à faire : `kanban.js`, `sav.js` et `agenda.js` interpolaient de la même
 * façon des champs saisis (nom de client, téléphone, marque et modèle d'appareil, panne).
 *
 * Ce que ces tests observent : la charge injectée reste du **texte**. On ne compte pas les
 * occurrences d'un échappeur dans le source — un test qui vérifie qu'une fonction est
 * appelée ne dit pas que la page est sûre ; un `<img src=x>` qui n'existe pas dans le DOM,
 * si.
 */
import { test, expect } from '@playwright/test'
import { seConnecterAdminPlateforme, creerBoutique, choisirBoutique } from './fixtures/console-plateforme'

/** Charge inerte mais concluante : si elle est interprétée, un `<img>` apparaît dans le DOM. */
const CHARGE = '<img src=x class="charge-xss">'

test.describe('Gabarits — les données saisies sont échappées', () => {
  test('kanban : le nom du client et l\'appareil restent du texte', async ({ page, request }) => {
    const { tenant, nomBoutique } = await creerBoutique(request)
    const entetes = { Authorization: `Bearer ${tenant.accessToken}` }

    const client = await request.post('/api/clients', {
      headers: entetes,
      data: { nom: CHARGE, prenom: 'Xss', telephone: '0600000000' },
    })
    expect(client.ok(), await client.text()).toBeTruthy()
    const clientId = (await client.json()).id

    const ticket = await request.post('/api/tickets', {
      headers: entetes,
      data: {
        client_id:         clientId,
        appareil_marque:   CHARGE,
        appareil_modele:   'Modèle test',
        description_panne: CHARGE,
        priorite:          'normale',
      },
    })
    expect(ticket.ok(), await ticket.text()).toBeTruthy()

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await page.goto('/kanban')

    const board = page.locator('#kanban-board')
    await expect(board.locator('.ticket-card').first()).toBeVisible({ timeout: 15_000 })
    await expect(board.locator('img.charge-xss')).toHaveCount(0)
    await expect(board).toContainText(CHARGE)
  })

  test('agenda : le téléphone du client ne s\'échappe pas de son attribut', async ({ page, request }) => {
    // Ici la charge vise l'**attribut** : le téléphone était interpolé dans un
    // `href="tel:…"` autant que dans le texte du lien. Une valeur portant un guillemet
    // ferme l'attribut et en ouvre un autre — pas besoin de balise pour nuire.
    const { tenant, nomBoutique } = await creerBoutique(request)
    const entetes = { Authorization: `Bearer ${tenant.accessToken}` }

    const client = await request.post('/api/clients', {
      headers: entetes,
      data: { nom: 'Durand', prenom: 'Xss', telephone: '06" class="charge-xss' },
    })
    expect(client.ok(), await client.text()).toBeTruthy()
    const clientId = (await client.json()).id

    const debut = new Date(Date.now() + 3_600_000).toISOString().slice(0, 19)
    const rdv = await request.post('/api/agenda', {
      headers: entetes,
      data: {
        boutique_id:     tenant.boutiqueId,
        client_id:       clientId,
        titre:           'RDV test XSS',
        debut,
        duree_minutes:   30,
        type_rdv:        'reparation',
      },
    })
    expect(rdv.ok(), await rdv.text()).toBeTruthy()

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await page.goto('/agenda')

    // Le téléphone n'apparaît que dans le **détail** du rendez-vous : s'arrêter à la vue
    // liste rendrait ce test vert sans avoir jamais atteint le gabarit fautif. On ouvre
    // donc la carte, et on vérifie d'abord qu'elle est bien là.
    await page.click('#btn-vue-liste')
    const carte = page.locator('.rdv-card').first()
    await expect(carte).toBeVisible({ timeout: 15_000 })
    await carte.click()

    const detail = page.locator('a[href^="tel:"]')
    await expect(detail).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.charge-xss')).toHaveCount(0)
    await expect(detail).toHaveText('06" class="charge-xss')
  })
})
