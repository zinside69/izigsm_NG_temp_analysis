/**
 * @file tests/e2e/quantite-entiere.spec.ts
 * @description Quantité ENTIÈRE ≥ 1 partout (recette 001 partie B, décision de l'exploitant du
 * 2026-10-02 — la caisse acceptait `0,98`).
 *
 * Prouvé contre la VRAIE D1 locale, boutique neuve à chaque test : chaque point d'entrée d'une
 * ligne refuse une quantité non entière **avant toute écriture** — aucun document créé, et surtout
 * aucun numéro consommé (la pièce suivante, valide, prend le n° 1 de la série).
 *
 * Écran : la caisse refuse d'encaisser une ligne à `0.98` (le serveur n'est même pas appelé).
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

/** Ligne de document au format devis / facture / avoir. */
function ligne(quantite: number) {
  return { description: 'E2E Main d\'œuvre', quantite, prix_unitaire_ht: 10, tva_taux: 20 }
}

/** Ligne de vente au format caisse. */
function ligneVente(quantite: number) {
  return { designation: 'E2E Verre trempé', quantite, prix_unitaire_ht: 10, tva_taux: 20 }
}

/** Crée un client dans la boutique du jeton et rend son identifiant. */
async function creerClient(request: APIRequestContext, headers: Record<string, string>): Promise<number> {
  const res = await request.post('/api/clients', {
    headers, data: { prenom: 'Quantité', nom: `Entiere${Date.now()}`, telephone: '0600000000' },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id
}

/** Nombre total d'éléments d'une liste paginée de la boutique du jeton. */
async function total(request: APIRequestContext, headers: Record<string, string>, chemin: string): Promise<number> {
  const res = await request.get(chemin, { headers })
  expect(res.status(), await res.text()).toBe(200)
  const corps = await res.json()
  return corps.pagination?.total ?? corps.data.length
}

// ═══════════════════════════════════════════════════════════════════════════════
// Serveur
// ═══════════════════════════════════════════════════════════════════════════════

test('caisse : une quantité 0.98 est refusée, aucun numéro de facture consommé', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  for (const q of [0.98, 1.5, 0]) {
    const res = await request.post('/api/caisse/vente', {
      headers, data: { mode_paiement: 'especes', lignes: [ligneVente(q)] },
    })
    expect(res.status(), `quantité ${q}`).toBe(422)
    expect((await res.json()).error).toMatch(/entier/)
  }

  // La première vente valide prend le n° 1 : les refus n'ont rien consommé.
  const ok = await request.post('/api/caisse/vente', {
    headers, data: { mode_paiement: 'especes', lignes: [ligneVente(2)] },
  })
  expect(ok.status(), await ok.text()).toBe(201)
  expect((await ok.json()).data.facture.numero).toMatch(/-0*1$/)
})

test('devis : création et modification refusent une quantité non entière', async ({ request }) => {
  const tenant   = await createTenantAdmin(request)
  const headers  = { Authorization: `Bearer ${tenant.accessToken}` }
  const clientId = await creerClient(request, headers)

  const refus = await request.post('/api/devis', { headers, data: { client_id: clientId, lignes: [ligne(1.5)] } })
  expect(refus.status(), await refus.text()).toBe(400)
  expect((await refus.json()).error).toMatch(/entier/)
  expect(await total(request, headers, '/api/devis')).toBe(0)

  const cree = await request.post('/api/devis', { headers, data: { client_id: clientId, lignes: [ligne(2)] } })
  expect(cree.status(), await cree.text()).toBe(201)
  const devisId = (await cree.json()).id

  const modif = await request.put(`/api/devis/${devisId}`, { headers, data: { lignes: [ligne(0.5)] } })
  expect(modif.status(), await modif.text()).toBe(400)
  expect((await modif.json()).error).toMatch(/entier/)

  // Les lignes du devis sont restées celles d'avant le refus.
  const relu = await (await request.get(`/api/devis/${devisId}`, { headers })).json()
  expect(relu.data.lignes.map((l: { quantite: number }) => l.quantite)).toEqual([2])
})

test('facture : une quantité non entière est refusée, aucune facture créée', async ({ request }) => {
  const tenant   = await createTenantAdmin(request)
  const headers  = { Authorization: `Bearer ${tenant.accessToken}` }
  const clientId = await creerClient(request, headers)

  for (const action of ['brouillon', 'emettre']) {
    const res = await request.post('/api/factures', {
      headers, data: { client_id: clientId, lignes: [ligne(0.98)], action },
    })
    expect(res.status(), `${action} : ${await res.text()}`).toBe(400)
    expect((await res.json()).error).toMatch(/entier/)
  }
  expect(await total(request, headers, '/api/factures')).toBe(0)
})

test('avoir : une quantité non entière est refusée, aucun numéro d\'avoir consommé', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  // Facture support émise d'emblée : une vente en caisse.
  const vente = await request.post('/api/caisse/vente', {
    headers, data: { mode_paiement: 'especes', lignes: [ligneVente(3)] },
  })
  expect(vente.status(), await vente.text()).toBe(201)
  const factureId = (await vente.json()).data.facture.id

  const refus = await request.post('/api/avoirs', {
    headers, data: { facture_id: factureId, motif: 'E2E retour', lignes: [ligne(0.5)] },
  })
  expect(refus.status(), await refus.text()).toBe(400)
  expect((await refus.json()).error).toMatch(/entier/)
  expect(await total(request, headers, '/api/avoirs')).toBe(0)

  // Le premier avoir valide prend le n° 1 : le refus n'a pas brûlé de numéro.
  const ok = await request.post('/api/avoirs', {
    headers, data: { facture_id: factureId, motif: 'E2E retour', lignes: [ligne(1)] },
  })
  expect(ok.status(), await ok.text()).toBe(201)
  expect((await ok.json()).numero).toMatch(/-0*1$/)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Écran
// ═══════════════════════════════════════════════════════════════════════════════

test('caisse, écran : 0.98 en quantité est refusé avant tout envoi, 1 passe', async ({ page, request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  const produit = await request.post('/api/produits', {
    headers, data: { nom: 'E2E Verre trempé A15', code_barre: '3700275472119', prix_vente_ht: 10, tva_taux: 20, stock_actuel: 5, stock_minimum: 0 },
  })
  expect(produit.status(), await produit.text()).toBe(201)

  // Tout envoi de vente est consigné : le refus doit précéder le serveur.
  const envois: string[] = []
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/caisse/vente')) envois.push(r.url()) })

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).toHaveText('0', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')

  // Recette 002 A (2026-10-03) : un refus de la caisse doit se VOIR — le toast n'est pas recouvert
  // par la fenêtre de vente (clic d'essai = Playwright vérifie qu'il reçoit le pointeur). Prouvé ici
  // sur le panier vide : la quantité décimale ne s'écrit plus, elle n'atteint plus ce refus.
  await page.click('#btn-submit-vente')
  await expect(page.locator('#toast-inner')).toContainText('au moins une ligne', { timeout: 5_000 })
  await page.locator('#toast-inner').click({ trial: true, timeout: 2_000 })

  await page.fill('#vente-produit-search', '3700275472119')
  const resultat = page.locator('#vente-produit-results [data-produit-id]').first()
  await expect(resultat).toBeVisible({ timeout: 10_000 })
  await resultat.click()

  const quantite = page.locator('#lignes-container .linha-row [data-field="quantite"]')
  // AVANT (2026-10-03, recette 002 A — « afficher que des entiers ») :
  // // Le refus doit se VOIR : le toast n'est pas recouvert par la fenêtre de vente (clic d'essai =
  // // Playwright vérifie que c'est bien lui qui reçoit le pointeur)
  // await expect(quantite).toHaveAttribute('step', '1')
  // await quantite.fill('0.98')
  // await page.click('#btn-submit-vente')
  // await expect(page.locator('#toast-inner')).toContainText('entier', { timeout: 5_000 })
  // await page.locator('#toast-inner').click({ trial: true, timeout: 2_000 })
  await expect(quantite).toHaveAttribute('data-entier', '')
  await quantite.fill('0.98')
  await expect(quantite, 'virgule et point retirés à la saisie').toHaveValue('98')
  expect(envois, 'aucune vente ne doit partir avec une quantité décimale').toEqual([])

  await quantite.fill('1')
  await page.fill('#montant-remis', '20')
  await page.click('#btn-submit-vente')
  await expect(page.locator('#toast-inner')).toContainText(/enregistrée/i, { timeout: 15_000 })
  expect(envois).toHaveLength(1)
})
