/**
 * @file tests/e2e/connexion-formulaire-post.spec.ts
 * @description Le mot de passe ne part jamais dans l'adresse (vécu en production le 2026-09-12,
 *              et déjà le 2026-07-18 — `bugs.md` § « Connexion bloquée juste après un déploiement »).
 *
 * Chemin de la fuite : dans `login.html`, le script qui intercepte l'envoi est placé APRÈS
 * `<script src="app.js">`, qui bloque l'analyse de la page tant qu'il n'est pas téléchargé. Le
 * formulaire, lui, est déjà affiché et utilisable : valider pendant ce temps déclenche la
 * soumission native du navigateur — en GET faute de `method`, `email` et `password` dans l'URL.
 * Il suffit qu'app.js soit lent (service worker qui s'installe juste après un déploiement,
 * réseau lent). Ce test retient app.js, valide pendant le chargement, puis observe les
 * requêtes de navigation réellement émises.
 */
import { test, expect } from '@playwright/test'

test('valider pendant le chargement de la page ne met jamais le mot de passe dans l\'adresse', async ({ page }) => {
  const SECRET = 'MotDePasseSecret-E2E-42'

  // Toute navigation émise par la page, avec sa méthode et son adresse
  const navigations: { methode: string; url: string }[] = []
  page.on('request', r => { if (r.isNavigationRequest()) navigations.push({ methode: r.method(), url: r.url() }) })

  // app.js retenu : la page reste en cours de chargement, le formulaire déjà affiché
  let libererApp!: () => void
  const appRetenu = new Promise<void>(r => { libererApp = r })
  await page.route('**/static/js/app*.js', async route => { await appRetenu; await route.continue() })

  await page.goto('/login', { waitUntil: 'commit' })
  await page.locator('#login-email').fill('fuite@exemple.fr')
  await page.locator('#login-password').fill(SECRET)
  await page.locator('#login-form button[type="submit"]').click()

  // Le chargement se termine ; une éventuelle soumission native a eu lieu entre-temps
  libererApp()
  await page.waitForLoadState('load')

  // Aucune adresse — ni la page affichée, ni une requête émise — ne porte le mot de passe
  expect(page.url()).not.toContain(SECRET)
  for (const n of navigations) expect(n.url, `${n.methode} ${n.url}`).not.toContain(SECRET)
  expect(navigations.some(n => n.url.includes('password='))).toBe(false)
})
