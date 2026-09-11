/**
 * @file tests/e2e/fournisseurs-ecran.spec.ts
 * @description `/fournisseurs` — boutons stylés, fenêtres centrées, rappel « à commander »
 * explicite (retour exploitant du 2026-09-11, captures en production).
 *
 * Cause commune : la page emploie un vocabulaire de classes (`modal-backdrop`, `modal-box`,
 * `input-field`, `td-cell`, `badge-*`…) qu'aucune feuille chargée ne définit, et pose
 * `btn-primary` sans la classe de base `btn` qui porte rembourrage et hauteur. Résultat :
 * boutons en texte brut, fenêtre de saisie rendue dans le flux, sous la barre latérale.
 *
 * Géométrie mesurée par `boundingBox()`, et clics réels : Playwright vérifie que la cible
 * du pointeur est bien l'élément visé — un bouton recouvert par la barre échouerait.
 * Les deux endpoints de comptage sont simulés : le sujet est le rendu, pas le stock local.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { MANAGER, obtenirToken, seConnecter } from './fixtures/comptes'

const PRODUIT_SOUS_SEUIL = {
  id: 999_001, nom: 'Connecteur de charge test', marque: 'Apple', fournisseur_nom: null,
  stock_actuel: 2, stock_minimum: 5, quantite_suggere: 4, prix_achat_ht: 12, alerte: 'stock_bas',
}

/** Simule le compteur des KPI et la liste « à commander », puis ouvre la page. */
async function ouvrirAvecCompteur(page: Page, nbACommander: number) {
  await page.route('**/api/fournisseurs/kpis*', route => route.fulfill({
    json: { success: true, data: {
      nb_fournisseurs: 0, nb_commandes_total: 0, nb_en_attente: 0,
      montant_achats_ht: 0, montant_impaye_ttc: 0, nb_produits_a_commander: nbACommander,
    } },
  }))
  await page.route('**/api/fournisseurs/a-commander*', route => route.fulfill({
    json: { success: true, data: nbACommander > 0 ? [PRODUIT_SOUS_SEUIL] : [] },
  }))
  await seConnecter(page, MANAGER)
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/fournisseurs')
}

test.describe('Fournisseurs — écran lisible et utilisable', () => {
  test('le rappel du haut dit ce qu\'il compte, et mène à l\'onglet « À commander »', async ({ page }) => {
    await ouvrirAvecCompteur(page, 3)
    const rappel = page.locator('#btn-a-commander')
    await expect(rappel).toBeVisible()
    await expect(rappel).toContainText('3 produits sous le seuil')
    await rappel.click()
    await expect(page.locator('#tab-a-commander')).toBeVisible()
  })

  test('sans produit sous le seuil, aucun rappel', async ({ page }) => {
    await ouvrirAvecCompteur(page, 0)
    // On attend que les KPI soient rendus avant de conclure à l'absence
    await expect(page.locator('#kpi-nb-fournisseurs')).toHaveText('0')
    await expect(page.locator('#btn-a-commander')).toBeHidden()
  })

  test('les boutons d\'action ont un vrai volume de bouton', async ({ page }) => {
    await ouvrirAvecCompteur(page, 0)
    for (const id of ['#btn-new-bc', '#btn-new-fournisseur']) {
      const boite = await page.locator(id).boundingBox()
      expect(boite, id).not.toBeNull()
      // Texte brut ≈ 24 px ; `.btn-sm` du socle = 38 px
      expect(boite!.height, id).toBeGreaterThanOrEqual(32)
    }
  })

  test('« Créer un bon de commande » depuis la sélection : explicite, puis fenêtre centrée et entière', async ({ page }) => {
    await ouvrirAvecCompteur(page, 1)
    await page.click('.tab-btn[data-tab="a-commander"]')
    await page.locator('.check-acommander').first().check()

    const creer = page.locator('#btn-bc-depuis-selection')
    await expect(creer).toBeVisible()
    await expect(creer).toContainText('Créer un bon de commande')
    const boiteBouton = await creer.boundingBox()
    expect(boiteBouton!.height).toBeGreaterThanOrEqual(32)
    await creer.click()

    const fenetre = page.locator('#modal-bc .modal-box')
    await expect(fenetre).toBeVisible()
    const vue = page.viewportSize()!
    const boite = (await fenetre.boundingBox())!
    // Entière dans la fenêtre du navigateur…
    expect(boite.x).toBeGreaterThanOrEqual(0)
    expect(boite.y).toBeGreaterThanOrEqual(0)
    expect(boite.x + boite.width).toBeLessThanOrEqual(vue.width)
    expect(boite.y + boite.height).toBeLessThanOrEqual(vue.height)
    // …et centrée horizontalement (tolérance de quelques pixels d'arrondi)
    expect(Math.abs(boite.x + boite.width / 2 - vue.width / 2)).toBeLessThanOrEqual(4)

    // Clic réel sur « Annuler » : échouerait si la barre latérale recouvrait le bouton
    await page.click('#modal-bc [data-close="modal-bc"].btn-secondary, #modal-bc .modal-footer [data-close="modal-bc"]')
    await expect(page.locator('#modal-bc')).toBeHidden()
  })
})

// ─── Fenêtre de détail d'un bon (remplace une alert() brute, statut « draft ») ──────────

/**
 * Crée par l'API un bon chez un fournisseur au nom unique, amené jusqu'au statut voulu.
 * Le nom unique sert de filtre dans la liste : la boutique de démo porte des centaines de bons.
 */
async function creerBon(request: APIRequestContext, statut: 'draft' | 'received') {
  const token = await obtenirToken(request, MANAGER)
  const headers = { Authorization: `Bearer ${token}` }
  const nomFournisseur = `Détail BC ${Date.now()}`
  const f = await request.post('/api/fournisseurs', { headers, data: { nom: nomFournisseur } })
  const cree = await request.post('/api/bons-commande', {
    headers,
    data: { fournisseur_id: (await f.json()).id, lignes: [{ designation: 'Écran détail test', reference: 'REF-DET', quantite_commandee: 2, prix_achat_ht: 10, tva_taux: 20 }] },
  })
  const id = (await cree.json()).id
  if (statut === 'received') {
    await request.patch(`/api/bons-commande/${id}/statut`, { headers, data: { statut: 'awaiting_delivery' } })
    const ligneId = (await (await request.get(`/api/bons-commande/${id}`, { headers })).json()).data.lignes[0].id
    await request.post(`/api/bons-commande/${id}/receptionner`, { headers, data: { lignes_recues: [{ ligne_id: ligneId, quantite_recue: 2 }] } })
  }
  return { id, nomFournisseur, headers }
}

/** Ouvre la page, filtre sur le fournisseur, et clique la ligne du bon. */
async function ouvrirDetail(page: Page, nomFournisseur: string) {
  await seConnecter(page, MANAGER)
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/fournisseurs')
  await page.fill('#search-bc', nomFournisseur)
  await page.locator('#table-bons tr', { hasText: nomFournisseur }).first().click()
}

test.describe('Fournisseurs — fenêtre de détail d\'un bon', () => {
  test('brouillon : statut en clair, lignes, totaux, actions du brouillon — aucune alerte native', async ({ page, request }) => {
    const { nomFournisseur } = await creerBon(request, 'draft')
    let alerteNative = ''
    page.on('dialog', d => { alerteNative = d.message(); d.dismiss() })

    await ouvrirDetail(page, nomFournisseur)
    const fenetre = page.locator('#modal-detail-bc')
    await expect(fenetre).toBeVisible()
    expect(alerteNative, 'plus aucune alert() à l\'ouverture').toBe('')

    await expect(fenetre).toContainText('Brouillon')
    await expect(fenetre).not.toContainText('draft')
    await expect(fenetre).toContainText('Écran détail test')
    await expect(fenetre).toContainText('REF-DET')
    await expect(fenetre).toContainText('20,00')   // total HT : 2 × 10 €
    await expect(fenetre).toContainText('24,00')   // total TTC
    await expect(fenetre.getByRole('button', { name: /Passer en attente de livraison/ })).toBeVisible()
    await expect(fenetre.getByRole('button', { name: /Marquer réglé/ })).toHaveCount(0)
  })

  test('réceptionné : « Marquer réglé » règle le bon et l\'affiche réglé', async ({ page, request }) => {
    const { id, nomFournisseur, headers } = await creerBon(request, 'received')
    page.on('dialog', d => d.accept())

    await ouvrirDetail(page, nomFournisseur)
    const fenetre = page.locator('#modal-detail-bc')
    await expect(fenetre).toContainText('Réceptionné')
    await fenetre.getByRole('button', { name: /Marquer réglé/ }).click()
    await expect(fenetre).toBeHidden()

    const bc = (await (await request.get(`/api/bons-commande/${id}`, { headers })).json()).data.bc
    expect(bc.statut_paiement).toBe('paid')

    // Réouverture : réglé, avec sa date, et plus de bouton de règlement
    await page.locator('#table-bons tr', { hasText: nomFournisseur }).first().click()
    await expect(fenetre).toContainText('Réglé le')
    await expect(fenetre.getByRole('button', { name: /Marquer réglé/ })).toHaveCount(0)
  })
})
