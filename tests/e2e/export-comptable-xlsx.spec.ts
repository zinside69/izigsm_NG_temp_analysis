/**
 * @file tests/e2e/export-comptable-xlsx.spec.ts
 * @description Export comptable Excel (ticket 001 `export-comptable-mensuel`, 2026-10-02), de bout en
 * bout sur la VRAIE base locale : une vente encaissée en espèces en caisse, puis Statistiques ›
 * Synthèse comptable › « Export comptable (Excel) ». Le fichier téléchargé est ouvert (archive ZIP
 * sans compression, relue ici) : trois onglets, la vente dans la ligne du jour, colonne Espèces, et
 * dans l'onglet Encaissements. Une copie est laissée dans `test-results/` pour relecture `openpyxl`.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

/** Contenu texte des fichiers d'une archive ZIP sans compression (méthode 0). */
function lireZip(octets: Uint8Array): Record<string, string> {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  const fichiers: Record<string, string> = {}
  let i = 0
  while (i + 30 <= octets.length && vue.getUint32(i, true) === 0x04034b50) {
    const taille = vue.getUint32(i + 18, true)
    const lnom   = vue.getUint16(i + 26, true)
    const lext   = vue.getUint16(i + 28, true)
    const nom    = new TextDecoder().decode(octets.subarray(i + 30, i + 30 + lnom))
    const debut  = i + 30 + lnom + lext
    fichiers[nom] = new TextDecoder().decode(octets.subarray(debut, debut + taille))
    i = debut + taille
  }
  return fichiers
}

/** Date du jour à Paris, « JJ/MM/AAAA ». */
const aujourdhuiFr = () => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date())

test('Statistiques › « Export comptable (Excel) » : la vente du jour apparaît, en espèces, dans les 3 onglets attendus', async ({ page, request }) => {
  const tenant  = await createTenantAdmin(request)    // manager d'une boutique neuve
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  const vente = await request.post('/api/caisse/vente', { headers, data: { mode_paiement: 'especes', lignes: [
    { designation: 'Verre trempé E2E', quantite: 1, prix_unitaire_ht: 10, tva_taux: 20 },
  ] } })
  expect(vente.status(), await vente.text()).toBe(201)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stats')
  await expect(page.locator('#btn-export-comptable')).toBeVisible({ timeout: 15_000 })

  const [telechargement] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export-comptable').click(),
  ])
  expect(telechargement.suggestedFilename()).toMatch(/^export-comptable_.*\.xlsx$/)
  const chemin = test.info().outputPath('export-comptable.xlsx')
  await telechargement.saveAs(chemin)

  const fs = (globalThis as any).process.getBuiltinModule('node:fs')
  const fichiers = lireZip(new Uint8Array(fs.readFileSync(chemin)))
  expect(fichiers['xl/workbook.xml']).toContain('name="Mensuel"')
  expect(fichiers['xl/workbook.xml']).toContain('name="Encaissements"')
  expect(fichiers['xl/workbook.xml']).toContain('name="Factures payées"')

  // Mensuel : la ligne du jour porte 12 € (10 HT + 20 %) en Espèces (2e colonne) et au TOTAL TTC
  const mensuel = fichiers['xl/worksheets/sheet1.xml']
  // Cellule « jeu. 02/10/2026 » : le titre de période contient aussi la date du jour, sans le jour de semaine
  const ligneDuJour = mensuel.split('<row ').find(r => new RegExp(`>[a-zé]{3}\\. ${aujourdhuiFr().replace(/\//g, '\\/')}<`).test(r))
  expect(ligneDuJour, `ligne du ${aujourdhuiFr()} absente`).toBeTruthy()
  expect(ligneDuJour).toMatch(/<c r="B\d+"[^>]*><v>12<\/v><\/c>/)
  expect(mensuel).toContain('TOTAL')

  // Encaissements : la vente y est, en espèces, pour 12 €
  const detail = fichiers['xl/worksheets/sheet2.xml']
  expect(detail).toContain('Espèces')
  expect(detail).toMatch(/<v>12<\/v>/)
})
