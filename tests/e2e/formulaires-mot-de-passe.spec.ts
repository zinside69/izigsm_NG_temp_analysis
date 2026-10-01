/**
 * @file tests/e2e/formulaires-mot-de-passe.spec.ts
 * @description Inscription et réinitialisation : le mot de passe ne part jamais dans l'adresse
 * (`todo.md` 🟠 « même risque de fuite dans l'adresse »). Même chemin que la connexion
 * (`connexion-formulaire-post.spec.ts`) : valider avant que le script de la page soit attaché
 * déclencherait la soumission native du navigateur — en GET faute de `method`.
 *
 * Mesure du 2026-09-15, AVANT la mise en conformité des balises — ces tests passaient déjà, ils ne
 * prouvent donc aucun correctif : ils GARDENT deux propriétés qui empêchent aujourd'hui la fuite.
 * - `register.html` `#form-step1` n'a aucun bouton de soumission (« Continuer » est hors du
 *   formulaire) et compte plusieurs champs texte : Entrée n'y soumet rien (soumission implicite
 *   HTML). Un `type="submit"` ajouté dans le formulaire ferait échouer le premier test.
 * - `reset-password.html` `#form-reset` vit dans `#step-reset`, masqué tant que le script de la page
 *   ne l'a pas affiché. L'afficher par défaut ferait échouer le second (NoScript, déjà vécu).
 * La règle de balise elle-même (`method="post"`, `onsubmit="return false"`) est tenue par le test
 * statique `tests/formulaires-mot-de-passe-conformite.test.ts`.
 */
import { test, expect } from '@playwright/test'

test('inscription : valider pendant le chargement de la page ne met jamais le mot de passe dans l\'adresse', async ({ page }) => {
  const SECRET = 'MotDePasseSecret-E2E-43'

  // Toute navigation émise par la page, avec sa méthode et son adresse
  const navigations: { methode: string; url: string }[] = []
  page.on('request', r => { if (r.isNavigationRequest()) navigations.push({ methode: r.method(), url: r.url() }) })

  // app.js retenu : register.js, placé après lui, ne s'exécute pas — le formulaire est déjà affiché
  let libererApp!: () => void
  const appRetenu = new Promise<void>(r => { libererApp = r })
  await page.route('**/static/js/app*.js', async route => { await appRetenu; await route.continue() })

  await page.goto('/register', { waitUntil: 'commit' })
  await page.locator('#first_name').fill('Fuite')
  await page.locator('#last_name').fill('Test')
  await page.locator('#email').fill('fuite@exemple.fr')
  await page.locator('#password').fill(SECRET)
  await page.locator('#password_confirm').fill(SECRET)
  // Les deux gestes d'envoi possibles : Entrée dans un champ, et le bouton « Continuer »
  await page.locator('#password_confirm').press('Enter')
  // Trois « Continuer → » sur la page (un par étape) : celui de l'étape 1, qui envoie ce formulaire
  await page.locator('button[onclick="submitStep1()"]').click()

  // Le chargement se termine ; une éventuelle soumission native a eu lieu entre-temps
  libererApp()
  await page.waitForLoadState('load')

  expect(page.url()).not.toContain(SECRET)
  for (const n of navigations) expect(n.url, `${n.methode} ${n.url}`).not.toContain(SECRET)
  expect(navigations.some(n => n.url.includes('password='))).toBe(false)
})

test.describe('réinitialisation, JavaScript bloqué (NoScript)', () => {
  test.use({ javaScriptEnabled: false })

  test('le formulaire du nouveau mot de passe n\'est jamais proposé : rien ne peut partir en GET', async ({ page }) => {
    // Lien reçu par email : jeton et adresse dans l'URL, comme en vrai
    await page.goto('/reset-password?token=jeton-e2e&email=fuite%40exemple.fr')
    await expect(page.locator('#form-reset')).toBeHidden()
    await expect(page.locator('#new-password')).toBeHidden()
  })

  // Ajouté le 2026-10-01 (`todo.md` 🟡 P3 « #form-request ») : contrairement à `#form-reset`, la
  // demande de lien est VISIBLE sans JavaScript et porte un vrai bouton de soumission — l'envoi
  // natif part. Ce test le prouve, puis garde la correction (`method="post"`) : l'email voyage
  // dans le corps, jamais dans l'adresse (historique, journaux).
  test('demande de lien : l\'email saisi ne part jamais dans l\'adresse', async ({ page }) => {
    const EMAIL = 'fuite-demande@exemple.fr'
    const navigations: { methode: string; url: string }[] = []
    page.on('request', r => { if (r.isNavigationRequest()) navigations.push({ methode: r.method(), url: r.url() }) })

    await page.goto('/reset-password')
    await expect(page.locator('#form-request')).toBeVisible()
    await page.locator('#req-email').fill(EMAIL)
    await page.locator('#form-request button[type="submit"]').click()
    await page.waitForLoadState('load')

    // L'envoi natif a bien eu lieu (sinon ce test ne prouverait rien)
    expect(navigations.length, JSON.stringify(navigations)).toBeGreaterThan(1)
    expect(page.url()).not.toContain('fuite-demande')
    for (const n of navigations) expect(n.url, `${n.methode} ${n.url}`).not.toContain('fuite-demande')
  })
})
