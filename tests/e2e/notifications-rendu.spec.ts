/**
 * @file tests/e2e/notifications-rendu.spec.ts
 * @description Page Notifications — ce que l'écran affiche réellement des réponses de l'API.
 *
 * Défaut mesuré le 2026-09-16 en production (`bugs.md`) : cinq appels du script inline de
 * `notifications.html` lisaient `data.success` sur l'**enveloppe** `{ ok, status, data, error }`
 * rendue par les helpers du socle, où ce champ vaut toujours `undefined`. Conséquences vues à
 * l'écran : les quatre tuiles restaient sur « — », le journal restait sur « Chargement… », et
 * les trois actions annonçaient « Erreur » alors que le serveur avait abouti.
 *
 * Ce sont des tests de **rendu**, pas de requête : ils vérifient ce qui est écrit dans le DOM,
 * jamais qu'un appel a été émis (`project-docs/modop-tests.md`). Les réponses sont simulées par
 * `page.route()` — le défaut est dans la lecture, pas dans le serveur, et des données réelles
 * feraient dépendre l'assertion du contenu de la base (`serviceWorkers: 'block'` est déjà posé
 * dans `playwright.config.ts`, sans quoi `sw.js` intercepterait `/api/*`).
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Corps de réponse du serveur, forme réelle de `src/routes/notifications.ts`. */
/**
 * @param source  Qui fournit la clé : la boutique, la plateforme (repli), ou personne.
 *                `from` suit la même règle que le serveur — l'expéditeur du domaine
 *                vérifié dès que la boutique n'a pas sa propre clé.
 */
function stats(source: 'boutique' | 'plateforme' | null = 'boutique') {
  return {
    success: true,
    data: {
      envoyes_total: 42,
      envoyes_mois:  7,
      simules_mois:  3,
      erreurs_mois:  1,
      config: {
        api_key_set:    source !== null,
        api_key_source: source,
        from: source === 'boutique'
          ? 'Atelier Test <contact@atelier-test.fr>'
          : 'Atelier Test via iziGSM <noreply@mail.repairdesk.fr>',
        // Saisi par la boutique — nul tant qu'elle n'a rien configuré, même si `from` est rempli
        from_configure: source === 'boutique' ? 'Atelier Test <contact@atelier-test.fr>' : null,
      },
    },
  }
}

const STATS = stats('boutique')

const LOGS = {
  success: true,
  data: [{
    created_at:   '2026-09-16T08:30:00.000Z',
    destinataire: 'client-journal@exemple.fr',
    type:         'ticket_cree',
    statut:       'envoye',
    sujet:        'Votre réparation est enregistrée',
  }],
  pagination: { page: 1, limit: 20, total: 1, pages: 1 },
}

/** Connexion d'un tenant neuf, stubs posés avant tout chargement de la page. */
async function ouvrirNotifications(
  page: Page,
  request: Parameters<typeof createTenantAdmin>[0],
  corpsStats: unknown = STATS,
) {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, tenant)
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

  await page.route('**/api/notifications/stats*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpsStats) }))
  await page.route('**/api/notifications/logs*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LOGS) }))

  await page.goto('/notifications')
}

test.describe('Page Notifications — l\'écran rend ce que l\'API renvoie', () => {
  test('les statistiques remplissent les quatre tuiles et le statut de connexion', async ({ page, request }) => {
    await ouvrirNotifications(page, request)

    await expect(page.locator('#kpi-total')).toHaveText('42')
    await expect(page.locator('#kpi-mois')).toHaveText('7')
    await expect(page.locator('#kpi-simules')).toHaveText('3')
    await expect(page.locator('#kpi-erreurs')).toHaveText('1')
    await expect(page.locator('#status-label')).toContainText('Clé API configurée')
  })

  test('la clé de la plateforme est annoncée comme un envoi actif, pas comme un mode simulé', async ({ page, request }) => {
    // Défaut du 2026-09-16, vu en production : « Mode simulé — aucune clé API » affiché
    // pendant qu'un email de test arrivait réellement (`bugs.md`).
    await ouvrirNotifications(page, request, stats('plateforme'))

    await expect(page.locator('#status-label')).toHaveText('Envois actifs via iziGSM')
    await expect(page.locator('#status-label')).not.toContainText('simulé')
    // L'exploitant doit lire l'expéditeur que verront ses clients
    await expect(page.locator('#status-detail')).toContainText('noreply@mail.repairdesk.fr')
    await expect(page.locator('#status-detail')).toContainText('votre domaine')
  })

  // GARDE, jamais vu rouge — et c'est mesuré : avant le correctif, ce cas s'affichait déjà
  // correctement (c'est le seul que l'ancien code décrivait juste). Une mutation qui rend
  // `#status-detail` visible dans cette branche ne le fait pas rougir non plus : le détail
  // y est vidé de son texte, donc de hauteur nulle, donc « masqué » pour Playwright. Ce test
  // verrouille que le correctif n'a pas déplacé le mensonge dans l'autre sens — il ne
  // contraint pas la visibilité du détail.
  test('sans aucune clé, le mode simulé est annoncé — et lui seul', async ({ page, request }) => {
    await ouvrirNotifications(page, request, stats(null))

    await expect(page.locator('#status-label')).toContainText('Mode simulé')
    await expect(page.locator('#status-label')).not.toContainText('actifs')
    await expect(page.locator('#status-dot')).toHaveClass(/bg-yellow-400/)
    // Aucun expéditeur annoncé : rien ne part, il n'y en a pas
    await expect(page.locator('#status-detail')).not.toContainText('Expéditeur')
  })

  test('le champ Expéditeur reste vide tant que la boutique n\'a rien saisi', async ({ page, request }) => {
    // Sinon un simple « Enregistrer » — pour poser sa clé, par exemple — écrirait l'adresse
    // de la plateforme dans `email_from` de la boutique, qui enverrait ensuite depuis un
    // domaine qu'elle ne possède pas (`bugs.md`, 2026-09-16).
    await ouvrirNotifications(page, request, stats('plateforme'))

    await expect(page.locator('#cfg-from')).toHaveValue('')
    // …alors que cette même adresse est bien annoncée comme expéditeur employé
    await expect(page.locator('#status-detail')).toContainText('noreply@mail.repairdesk.fr')
  })

  // GARDE, jamais vu rouge : dans cet état, `from` et `from_configure` portent la même
  // valeur, donc l'ancien code le passait déjà. Il verrouille que le correctif n'a pas vidé
  // le champ des boutiques qui, elles, ont bien configuré un expéditeur.
  test('le champ Expéditeur porte ce que la boutique a saisi, quand elle a saisi', async ({ page, request }) => {
    await ouvrirNotifications(page, request, stats('boutique'))

    await expect(page.locator('#cfg-from')).toHaveValue('Atelier Test <contact@atelier-test.fr>')
  })

  test('le journal des envois affiche ses lignes et son compteur', async ({ page, request }) => {
    await ouvrirNotifications(page, request)

    await expect(page.locator('#logs-tbody')).toContainText('client-journal@exemple.fr')
    // Le défaut laissait « Chargement… » : ni ligne, ni message de journal vide
    await expect(page.locator('#logs-tbody')).not.toContainText('Chargement')
    await expect(page.locator('#logs-info')).toHaveText('1 entrée — page 1/1')
  })

  test('les relances tickets annoncent leur nombre, pas une erreur', async ({ page, request }) => {
    await ouvrirNotifications(page, request)
    await page.route('**/api/notifications/relances?*', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { relances_envoyees: 3 }, message: '3 relance(s) envoyée(s).' }),
      }))

    await page.click('button:has-text("Relances tickets")')
    await expect(page.locator('#toast-inner')).toHaveText('3 relance(s) tickets envoyée(s)')
  })

  test('les relances devis annoncent leur nombre, pas une erreur', async ({ page, request }) => {
    await ouvrirNotifications(page, request)
    await page.route('**/api/notifications/relances-devis*', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { relances_envoyees: 2 }, message: '2 relance(s) envoyée(s).' }),
      }))

    await page.click('button:has-text("Relances devis")')
    await expect(page.locator('#toast-inner')).toHaveText('2 relance(s) devis envoyée(s)')
  })

  test('l\'email de test annonce le succès du serveur, avec son message', async ({ page, request }) => {
    await ouvrirNotifications(page, request)
    await page.route('**/api/notifications/test*', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, simulated: false, message: 'Email de test envoyé avec succès.' }),
      }))

    await page.click('button:has-text("Email de test")')
    await page.fill('#test-to', 'controle@exemple.fr')
    await page.click('#btn-send-test')

    const resultat = page.locator('#test-result')
    await expect(resultat).toHaveText('Email de test envoyé avec succès.')
    await expect(resultat).toHaveClass(/text-green-700/)
  })

  test('un envoi simulé est annoncé comme tel, en jaune', async ({ page, request }) => {
    await ouvrirNotifications(page, request)
    await page.route('**/api/notifications/test*', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true, simulated: true,
          message: 'Mode simulé (aucune clé API configurée) — email non envoyé réellement.',
        }),
      }))

    await page.click('button:has-text("Email de test")')
    await page.fill('#test-to', 'controle@exemple.fr')
    await page.click('#btn-send-test')

    const resultat = page.locator('#test-result')
    await expect(resultat).toContainText('Mode simulé')
    await expect(resultat).toHaveClass(/text-yellow-700/)
  })
})
