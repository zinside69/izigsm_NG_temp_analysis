/**
 * @file tests/e2e/mobilax-fenetre-large.spec.ts
 * @description Fenêtre « Chercher une pièce chez Mobilax » lisible pendant un gros import
 * (recette 001 C, 2026-10-02) : à 780 px, chaque entrée du journal (« = Ecran Tactile … — déjà
 * dans votre stock ») passait sur deux lignes et les noms de pièces se lisaient mal.
 *
 * Contrats : fenêtre d'au moins 1 000 px sur un écran de bureau, sans défilement horizontal ;
 * une entrée de journal = une ligne, nom tronqué « … », texte complet au survol (`title`).
 * Réponses d'iziGSM simulées (`page.route()`) : l'écran se prouve sans clé Mobilax.
 * Mesures par `boundingBox()` (pas de `document` dans `evaluate()` : `tsconfig` sans lib `dom`).
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// Plus long que la fenêtre même élargie : sans troncature, l'entrée passerait sur deux lignes
const NOM_LONG = 'Ecran Tactile Hard Oled Apple iPhone 15 Pro Max (Compatible) avec châssis, adhésif et nappe — '
  + 'qualité premium garantie 12 mois, compatible True Tone, vitre renforcée, livré avec outils et film de protection'

test('import : fenêtre large, entrée de journal sur une ligne, nom complet au survol', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/mobilax/series?*', route => route.fulfill({ json: { success: true, data: { series: [{ id: 2358, nom: 'iPhone 15' }] } } }))
  await page.route('**/api/mobilax/apercu?*', route => route.fulfill({ json: { success: true, data: {
    fournisseur_id: 3,
    series:   [{ id: 2358, nb_articles: 1 }],
    articles: [{ mobilax_id: 1, reference: 'R1', nom: NOM_LONG, series: [2358], deja_en_stock: false }],
  } } }))
  await page.route('**/api/mobilax/import*', route => route.fulfill({ status: 409, json: {
    success: false, code: 'deja_importe', error: 'Cette pièce est déjà dans votre stock.', data: { produit_id: 41 },
  } }))

  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.check('#mobilax-mode-generation')
  await page.fill('#mobilax-terme', 'iPhone 15')
  await page.click('#btn-mobilax-chercher')
  await expect(page.locator('#mobilax-apercu')).toContainText('1 à importer')

  // Fenêtre élargie, et rien ne déborde horizontalement
  const fenetre = page.locator('#modal-mobilax .modal')
  await expect(fenetre).toHaveCSS('opacity', '1')
  const boite = await fenetre.boundingBox()
  expect(boite!.width, 'fenêtre d\'au moins 1 000 px sur un écran de bureau').toBeGreaterThanOrEqual(1000)
  expect(await fenetre.evaluate((el: any) => el.scrollWidth - el.clientWidth), 'aucun défilement horizontal').toBe(0)

  await page.click('#btn-generation-importer')
  const entree = page.locator('#mobilax-import-journal > div').first()
  await expect(entree).toContainText('déjà dans votre stock')

  // Une seule ligne : hauteur d'une ligne de texte (≈ 20 px à .82rem), jamais deux
  const hauteur = (await entree.boundingBox())!.height
  expect(hauteur, `entrée de journal sur une ligne (mesuré ${hauteur} px)`).toBeLessThan(26)
  await expect(entree).toHaveAttribute('title', `= ${NOM_LONG} — déjà dans votre stock`)
})

// Recette du 2026-10-04 : l'en-tête « Qté en rayon », aligné à droite d'une colonne qui porte le
// champ ET le bouton « Importer », tombait au-dessus du bouton, pas du champ de saisie.
test('recherche par article : l\'en-tête « Qté en rayon » est au-dessus du champ de saisie', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/mobilax/produits?*', route => route.fulfill({ json: { success: true, data: {
    fournisseur_id: 3, total: 1, page: 1, pages: 1,
    produits: [{ mobilax_id: 17, nom: 'Connecteur de charge Galaxy A53', ean13: '3000000124819', prix_achat_ht: 11.9, stock: 71 }],
  } } }))

  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
  await page.click('#btn-mobilax')
  await page.fill('#mobilax-terme', 'connecteur')
  await page.click('#btn-mobilax-chercher')
  await expect(page.locator('#mobilax-resultats tr')).toHaveCount(1)

  const entete = await page.locator('#modal-mobilax th', { hasText: 'Qté en rayon' }).boundingBox()
  const champ  = await page.locator('#mobilax-resultats input.mobilax-qte').boundingBox()
  const milieuEntete = entete!.x + entete!.width / 2
  const milieuChamp  = champ!.x + champ!.width / 2
  // Le milieu de l'en-tête tombe sur le champ (largeur 64 px) : ni à côté, ni au-dessus du bouton
  expect(Math.abs(milieuEntete - milieuChamp), `écart entre milieux ${milieuEntete} / ${milieuChamp}`)
    .toBeLessThan(champ!.width / 2)
})
