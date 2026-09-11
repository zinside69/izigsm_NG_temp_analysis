/**
 * @file tests/e2e/bon-commande-reglement.spec.ts
 * @description « Impayés fournisseurs » ne compte que ce qui est dû, et un règlement le
 * fait redescendre (décision exploitant du 2026-09-11, `decisions.md`).
 *
 * Deux défauts de départ : le KPI comptait tout bon non annulé (57,60 € d'impayés sur un
 * brouillon jamais envoyé, constaté en production), et aucune route ne faisait passer un
 * bon à « réglé » — le KPI ne pouvait que grossir.
 *
 * Contre la vraie base D1 locale, pas un mock : les mocks du dépôt renvoient ce qu'on leur
 * donne quelle que soit la requête, ils ne peuvent pas prouver une règle portée par le SQL.
 * Le KPI est lu en différentiel (avant/après) : la boutique de démo porte déjà des bons.
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { MANAGER, obtenirToken } from './fixtures/comptes'

test.describe('Bon de commande — impayés et règlement', () => {
  let token: string
  const entetes = () => ({ Authorization: `Bearer ${token}` })

  async function impayes(request: APIRequestContext): Promise<number> {
    const r = await request.get('/api/fournisseurs/kpis', { headers: entetes() })
    expect(r.status()).toBe(200)
    return Number((await r.json()).data.montant_impaye_ttc ?? 0)
  }

  test.beforeAll(async ({ request }) => {
    token = await obtenirToken(request, MANAGER)
  })

  test('brouillon et envoyé : rien de dû · réceptionné : dû · réglé : plus rien', async ({ request }) => {
    const f = await request.post('/api/fournisseurs', { headers: entetes(), data: { nom: `Règlement ${Date.now()}` } })
    expect(f.status()).toBeLessThan(300)
    const fournisseurId = (await f.json()).id

    const avant = await impayes(request)

    // Brouillon : 1 × 10 € HT, TVA 20 % → 12 € TTC
    const cree = await request.post('/api/bons-commande', {
      headers: entetes(),
      data: { fournisseur_id: fournisseurId, lignes: [{ designation: 'Pièce test', quantite_commandee: 1, prix_achat_ht: 10, tva_taux: 20 }] },
    })
    expect(cree.status()).toBe(201)
    const bcId = (await cree.json()).id
    expect(await impayes(request), 'un brouillon ne doit rien').toBeCloseTo(avant, 2)

    // Régler un brouillon est refusé
    const regleBrouillon = await request.post(`/api/bons-commande/${bcId}/regler`, { headers: entetes() })
    expect(regleBrouillon.status()).toBe(422)

    // Envoyé : toujours rien de dû (la marchandise n'est pas reçue)
    const envoi = await request.patch(`/api/bons-commande/${bcId}/statut`, { headers: entetes(), data: { statut: 'awaiting_delivery' } })
    expect(envoi.status()).toBe(200)
    expect(await impayes(request), 'un bon envoyé non reçu ne doit rien').toBeCloseTo(avant, 2)

    // Réceptionné : 12 € dus
    const detail = await (await request.get(`/api/bons-commande/${bcId}`, { headers: entetes() })).json()
    const ligneId = detail.data.lignes[0].id
    const recep = await request.post(`/api/bons-commande/${bcId}/receptionner`, {
      headers: entetes(), data: { lignes_recues: [{ ligne_id: ligneId, quantite_recue: 1 }] },
    })
    expect(recep.status()).toBe(200)
    expect(await impayes(request), 'réceptionné : 12 € dus').toBeCloseTo(avant + 12, 2)

    // Réglé : plus rien de dû, date de règlement posée
    const regle = await request.post(`/api/bons-commande/${bcId}/regler`, { headers: entetes() })
    expect(regle.status()).toBe(200)
    expect(await impayes(request), 'réglé : plus rien de dû').toBeCloseTo(avant, 2)
    const apres = await (await request.get(`/api/bons-commande/${bcId}`, { headers: entetes() })).json()
    expect(apres.data.bc.statut_paiement).toBe('paid')
    expect(apres.data.bc.date_paiement).toBeTruthy()

    // Un second règlement est refusé : la date d'origine n'est pas réécrite
    const bis = await request.post(`/api/bons-commande/${bcId}/regler`, { headers: entetes() })
    expect(bis.status()).toBe(422)
  })
})
