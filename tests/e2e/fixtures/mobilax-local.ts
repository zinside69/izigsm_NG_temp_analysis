/**
 * @file tests/e2e/fixtures/mobilax-local.ts
 * @description Prépare, sur la vraie D1 locale, un produit rattaché à Mobilax — SANS le moindre
 * appel réseau à Mobilax (ticket 05 `integration-mobilax`, amendement du 2026-09-27, point 15).
 *
 * Aucune route n'écrit `produits.mobilax_id` autrement qu'à travers un import Mobilax réel
 * (`POST /api/mobilax/import`, qui appelle la préproduction). Pour prouver le rafraîchissement
 * manuel sans clé ni réseau, ce fixture pose la colonne par SQL local, comme le prescrit le
 * point 15 : « fournisseur `api_plateforme = 'mobilax'` de la boutique, `mobilax_id` posé sur le
 * produit par SQL local (`wrangler d1 execute --local` ou fixture SQL équivalente), sans appel à
 * Mobilax. » Le fournisseur et le produit eux-mêmes viennent des vraies routes (`POST
 * /api/fournisseurs`, `POST /api/produits`) : seule la colonne que Mobilax poserait à l'import
 * est écrite à la main.
 */
import type { APIRequestContext } from '@playwright/test'

/**
 * Exécute une commande SQL sur la D1 locale du serveur E2E — même contrainte tsconfig que
 * `mobilax-recherche-stock.spec.ts` (pas de types Node dans ce dépôt) : pas d'`import 'node:…'`,
 * `process.getBuiltinModule()` (Node ≥ 22.3) charge le module sans import statique.
 */
function executerSqlLocal(sql: string): void {
  const proc = (globalThis as any).process
  const cp = proc.getBuiltinModule('node:child_process') as { execSync: (cmd: string, opts?: object) => unknown }
  cp.execSync(
    `npx wrangler d1 execute DB --local --command=${JSON.stringify(sql)}`,
    { cwd: proc.cwd(), stdio: 'pipe' },
  )
}

export interface ProduitMobilaxLocal {
  produitId:     number
  fournisseurId: number
  mobilaxId:     number
}

/**
 * Crée, dans la boutique du tenant, une fiche fournisseur marquée Mobilax et un produit ordinaire,
 * puis rattache ce produit à un `mobilax_id` par SQL local — la seule étape qu'aucune route
 * n'expose sans appeler Mobilax.
 *
 * @param request      Contexte API Playwright
 * @param headers      En-têtes (jeton du tenant)
 * @param boutiqueId   Boutique du tenant — filtre de la mise à jour SQL, par prudence
 * @param data         Nom, prix d'achat/vente du produit, et identifiant Mobilax à poser
 */
export async function creerProduitMobilaxLocal(
  request: APIRequestContext,
  headers: Record<string, string>,
  boutiqueId: number,
  data: { nom: string; prix_achat_ht: number; prix_vente_ht: number; mobilaxId: number },
): Promise<ProduitMobilaxLocal> {
  const fournisseurRes = await request.post('/api/fournisseurs', {
    headers, data: { nom: `Mobilax ${Date.now()}`, api_plateforme: 'mobilax' },
  })
  if (!fournisseurRes.ok()) throw new Error(`fournisseur: ${fournisseurRes.status()} ${await fournisseurRes.text()}`)
  const fournisseurId = (await fournisseurRes.json()).id as number

  const produitRes = await request.post('/api/produits', {
    headers, data: { nom: data.nom, prix_achat_ht: data.prix_achat_ht, prix_vente_ht: data.prix_vente_ht },
  })
  if (!produitRes.ok()) throw new Error(`produit: ${produitRes.status()} ${await produitRes.text()}`)
  const produitBody = await produitRes.json()
  const produitId = (produitBody.id ?? produitBody.data?.id) as number

  executerSqlLocal(
    `UPDATE produits SET fournisseur_id = ${fournisseurId}, mobilax_id = ${data.mobilaxId} ` +
    `WHERE id = ${produitId} AND boutique_id = ${boutiqueId}`,
  )

  return { produitId, fournisseurId, mobilaxId: data.mobilaxId }
}

/**
 * Crée une fiche fournisseur SANS `api_plateforme` (cas (a) du point 8 : un produit peut porter
 * `mobilax_id` sans être rattaché à une fiche Mobilax — le bouton ne doit alors jamais apparaître).
 */
export async function creerProduitMobilaxIdSansFournisseurMobilax(
  request: APIRequestContext,
  headers: Record<string, string>,
  boutiqueId: number,
  data: { nom: string; prix_achat_ht: number; prix_vente_ht: number; mobilaxId: number },
): Promise<ProduitMobilaxLocal> {
  const fournisseurRes = await request.post('/api/fournisseurs', {
    headers, data: { nom: `Fournisseur ordinaire ${Date.now()}` },
  })
  if (!fournisseurRes.ok()) throw new Error(`fournisseur: ${fournisseurRes.status()} ${await fournisseurRes.text()}`)
  const fournisseurId = (await fournisseurRes.json()).id as number

  const produitRes = await request.post('/api/produits', {
    headers, data: { nom: data.nom, prix_achat_ht: data.prix_achat_ht, prix_vente_ht: data.prix_vente_ht },
  })
  if (!produitRes.ok()) throw new Error(`produit: ${produitRes.status()} ${await produitRes.text()}`)
  const produitBody = await produitRes.json()
  const produitId = (produitBody.id ?? produitBody.data?.id) as number

  executerSqlLocal(
    `UPDATE produits SET fournisseur_id = ${fournisseurId}, mobilax_id = ${data.mobilaxId} ` +
    `WHERE id = ${produitId} AND boutique_id = ${boutiqueId}`,
  )

  return { produitId, fournisseurId, mobilaxId: data.mobilaxId }
}
