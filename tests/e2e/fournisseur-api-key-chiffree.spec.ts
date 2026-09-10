/**
 * @file tests/e2e/fournisseur-api-key-chiffree.spec.ts
 * @description Un fournisseur enregistre une clé API (ex. Mobilax), elle n'est jamais
 * renvoyée en clair — ticket 01, chantier `integration-mobilax`.
 *
 * Vérifie l'écran réel, pas seulement le service : la clé saisie dans le formulaire arrive
 * chiffrée en base (via l'API), et le modal d'édition ne la pré-remplit jamais — le
 * serveur ne la renvoie jamais.
 *
 * ⚠ Ne vérifie PAS la ligne dans le tableau de `/fournisseurs` : un bug préexistant, sans
 * rapport avec ce ticket, rend le contenu des 3 onglets de cette page invisible pour tout
 * le monde (`.tab-content` exige la classe `.active` en CSS — `main.css` — que
 * `fournisseurs.js` ne pose jamais ; il ne touche que `.hidden` et `.tab-active`, qui ne
 * correspond à aucune règle). Consigné dans `bugs.md`/`todo.md`, hors périmètre ici.
 * Le modal de création/édition, lui, n'est pas dans `.tab-content` — il fonctionne, et
 * c'est par lui (et par l'API) que ce test observe le comportement réel.
 */
import { test, expect } from '@playwright/test'
import { MANAGER, obtenirToken, seConnecter } from './fixtures/comptes'

test.describe('Fournisseur — clé API chiffrée, jamais renvoyée en clair (ticket 01)', () => {
  test('saisie dans le formulaire, jamais visible en réouvrant, jamais en clair via l\'API', async ({ page, request }) => {
    const nomFournisseur = `Mobilax Test ${Date.now()}`

    await seConnecter(page, MANAGER)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/fournisseurs')

    // Création avec une clé API — le bouton et le modal sont hors `.tab-content`,
    // accessibles quel que soit l'onglet actif.
    await page.click('#btn-new-fournisseur')
    await page.fill('#f-nom', nomFournisseur)
    await page.fill('#f-api-key', 'sk_live_e2e_reconnaissable')
    await page.click('#btn-save-fournisseur')
    await expect(page.locator('#modal-fournisseur')).toBeHidden({ timeout: 15_000 })

    // Le tableau étant invisible (bug préexistant, voir en-tête), on retrouve l'identifiant
    // du fournisseur créé par l'API directement — chemin non affecté par ce bug d'affichage.
    // `limit` est plafonné à 100 côté serveur (parsePagination) — avec 500+ fournisseurs
    // triés par nom, filtrer par recherche plutôt que supposer une page.
    const token = await obtenirToken(request, MANAGER)
    const listRes = await request.get(`/api/fournisseurs?search=${encodeURIComponent(nomFournisseur)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()
    const cree = listBody.data.find((f: any) => f.nom === nomFournisseur)

    expect(cree).toBeDefined()
    expect(cree).not.toHaveProperty('api_key_chiffree')
    expect(JSON.stringify(cree)).not.toContain('sk_live_e2e_reconnaissable')

    // Réouverture du modal d'édition, appelée directement (le bouton de la ligne du
    // tableau est inatteignable — bug d'affichage ci-dessus) : le champ clé API doit
    // être VIDE, jamais pré-rempli, puisque le serveur ne la renvoie jamais.
    // (globalThis as any) : tsconfig n'inclut pas la lib DOM, `window` casse tsc ici
    // (même piège que `document` dans un page.evaluate() — CLAUDE.md § ticket 03).
    await page.evaluate((id) => (globalThis as any).openModalFournisseur(id), cree.id)
    await expect(page.locator('#modal-fournisseur')).toBeVisible()
    await expect(page.locator('#f-api-key')).toHaveValue('')
  })
})
