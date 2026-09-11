/**
 * @file tests/e2e/fournisseurs-onglets.spec.ts
 * @description Les trois onglets de `/fournisseurs` affichent réellement leur contenu
 * (🔴 P1 du 2026-09-10, `todo.md` / `bugs.md`).
 *
 * `main.css` masque tout `.tab-content` qui ne porte pas `.active`. `fournisseurs.js`
 * basculait `.hidden` / `tab-active` — aucune règle ne correspond à la seconde, et la
 * première ne rend jamais visible un élément que `.tab-content` masque déjà. Résultat :
 * les trois onglets restaient vides pour tout rôle, y compris l'onglet par défaut.
 *
 * Test de RENDU, pas de mécanisme : on vérifie la visibilité réelle des sections et
 * d'une ligne du tableau (Playwright calcule la visibilité depuis le style appliqué),
 * jamais la présence d'une classe dans le DOM.
 */
import { test, expect } from '@playwright/test'
import { MANAGER, obtenirToken, seConnecter } from './fixtures/comptes'

const ONGLETS = ['bons', 'fournisseurs', 'a-commander'] as const

test.describe('Fournisseurs — les onglets affichent leur contenu', () => {
  test('onglet par défaut visible, chaque clic affiche sa section et masque les autres', async ({ page }) => {
    await seConnecter(page, MANAGER)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/fournisseurs')

    // Au chargement : « Bons de commande » est l'onglet affiché
    await expect(page.locator('#tab-bons')).toBeVisible()
    await expect(page.locator('#tab-fournisseurs')).toBeHidden()
    await expect(page.locator('#tab-a-commander')).toBeHidden()

    for (const onglet of ONGLETS) {
      await page.click(`.tab-btn[data-tab="${onglet}"]`)
      for (const autre of ONGLETS) {
        const section = page.locator(`#tab-${autre}`)
        if (autre === onglet) await expect(section).toBeVisible()
        else await expect(section).toBeHidden()
      }
    }
  })

  test('un fournisseur créé apparaît dans le tableau de l\'onglet Fournisseurs', async ({ page, request }) => {
    const nom = `Fournisseur onglet ${Date.now()}`

    // Création par l'API : le sujet ici est l'affichage, pas le formulaire
    const token = await obtenirToken(request, MANAGER)
    const cree = await request.post('/api/fournisseurs', {
      headers: { Authorization: `Bearer ${token}` },
      data: { nom },
    })
    expect(cree.status()).toBeLessThan(300)

    await seConnecter(page, MANAGER)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/fournisseurs')

    await page.click('.tab-btn[data-tab="fournisseurs"]')
    // Recherche : la boutique de démo accumule des centaines de fournisseurs de test
    await page.fill('#search-f', nom)
    await expect(page.locator('#table-fournisseurs').getByText(nom)).toBeVisible({ timeout: 15_000 })
  })
})
