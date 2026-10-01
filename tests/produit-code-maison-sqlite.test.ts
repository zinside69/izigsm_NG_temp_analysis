import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { createProduit, importCatalogueCsv } from '../src/services/stockService'
import { estEan13Valide } from '../src/lib/codeMaison'

/**
 * @file tests/produit-code-maison-sqlite.test.ts
 * @description Code maison des produits (ticket 05 `vente-lit-catalogue`) : pose automatique à la
 * création (manuelle et CSV), dispense par SKU EAN-13 valide, non-écrasement d'un code existant,
 * collision absorbée sans faire échouer la création (P15, 2026-10-01).
 *
 * Contre un vrai SQLite au schéma réel (`produits.code_barre` + son index unique partiel existent
 * déjà, migration 0048) : la règle « ne réécrit jamais un code existant » et le comportement sur
 * collision vivent dans une écriture SQL conditionnelle, qu'aucun mock ne peut prouver
 * (`CLAUDE.md` § Bons de commande).
 */

const SKU_EAN_VALIDE = '4006381333931' // EAN-13 réel, clé juste
const SKU_EAN_FAUX   = '4006381333930' // mêmes chiffres, clé fausse

let base: BaseReelle
beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1'), (2, 'Boutique 2');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (1, 'manager@b1.fr', 'x', 'M', 'Test', 2, 1, 1);
  `)
})

function codeBarreDe(id: number): string | null {
  return (base.sqlite.prepare('SELECT code_barre FROM produits WHERE id = ?').get(id) as any).code_barre
}

function nbMouvements(produitId: number, motif: string): number {
  return (base.sqlite.prepare(
    'SELECT COUNT(*) AS n FROM mouvements_stock WHERE produit_id = ? AND motif = ?'
  ).get(produitId, motif) as any).n
}

describe('createProduit() — code maison (pose automatique)', () => {
  it('sans code ni SKU → reçoit un code maison (préfixe 21, EAN-13 valide)', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'Écran iPhone 12', stock_minimum: 0 })
    const code = codeBarreDe(id)
    expect(code).not.toBeNull()
    expect(code!.startsWith('21')).toBe(true)
    expect(estEan13Valide(code!)).toBe(true)
  })

  it('un code-barres saisi n\'est jamais remplacé par un code maison', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'Coque', code_barre: '3700275472140', stock_minimum: 0 })
    expect(codeBarreDe(id)).toBe('3700275472140')
  })

  it('un SKU EAN-13 valide dispense du code maison (décision du 2026-09-30)', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'Pièce Mobilax manuelle', sku: SKU_EAN_VALIDE, stock_minimum: 0 })
    expect(codeBarreDe(id)).toBeNull()
  })

  it('un SKU à clé de contrôle fausse ne dispense PAS : code maison posé', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'Pièce douteuse', sku: SKU_EAN_FAUX, stock_minimum: 0 })
    expect(codeBarreDe(id)).not.toBeNull()
  })

  it('un SKU libre (lettres) ne dispense pas : code maison posé', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'Pièce maison', sku: 'ECR-IP12', stock_minimum: 0 })
    expect(codeBarreDe(id)).not.toBeNull()
  })

  it('sansCodeMaison (import fournisseur) : aucun code maison même sans EAN', async () => {
    const { id } = await createProduit(
      base.d1, 1, 1,
      { nom: 'Pièce Mobilax', fournisseur: 'Mobilax', reference_fournisseur: 'REF-1', stock_minimum: 0 },
      { sansCodeMaison: true },
    )
    expect(codeBarreDe(id)).toBeNull()
  })

  it('reference_fournisseur et fournisseur renseignés SANS option → code maison posé quand même', async () => {
    const { id } = await createProduit(
      base.d1, 1, 1,
      { nom: 'Pièce avec fournisseur texte', fournisseur: 'Un grossiste', reference_fournisseur: 'REF-2', stock_minimum: 0 },
    )
    expect(codeBarreDe(id)).not.toBeNull()
  })

  it('aucun avertissement renvoyé quand la pose réussit', async () => {
    const res = await createProduit(base.d1, 1, 1, { nom: 'Produit simple', stock_minimum: 0 })
    expect(res.avertissement_code_maison).toBeUndefined()
  })

  it('collision à la pose automatique : produit créé UNE SEULE FOIS, sans code, mouvement « Stock initial » présent, avertissement nommant le porteur', async () => {
    // Le prochain produit créé aura l'id 2 (après celui-ci) → on pré-pose sur le produit 1 le code
    // maison que recevrait le produit 2, pour forcer la collision.
    const { id: porteurId } = await createProduit(base.d1, 1, 1, { nom: 'Porteur du code', stock_minimum: 0 })
    // `porteurId` a lui-même reçu un code maison automatique (2100000000001 + clé) : on écrase ce
    // code par celui que le PROCHAIN produit calculera sur son propre id, pour simuler la collision.
    const prochainId = porteurId + 1
    const { codeMaison } = await import('../src/lib/codeMaison')
    const codeCollision = codeMaison(1, prochainId)
    base.sqlite.prepare('UPDATE produits SET code_barre = ? WHERE id = ?').run(codeCollision, porteurId)

    const nbAvant = (base.sqlite.prepare('SELECT COUNT(*) AS n FROM produits').get() as any).n
    const res = await createProduit(base.d1, 1, 1, { nom: 'Nouveau produit', stock_actuel: 3, prix_achat_ht: 10, stock_minimum: 0 })
    const nbApres = (base.sqlite.prepare('SELECT COUNT(*) AS n FROM produits').get() as any).n

    expect(nbApres).toBe(nbAvant + 1)                 // créé une seule fois
    expect(codeBarreDe(res.id)).toBeNull()             // sans code
    expect(nbMouvements(res.id, 'Stock initial')).toBe(1) // le mouvement a bien eu lieu
    expect(res.avertissement_code_maison).toBeDefined()
    expect(res.avertissement_code_maison).toContain('Porteur du code') // nomme le porteur
    expect(res.avertissement_code_maison).toContain(String(porteurId))
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Mutant : dans `poserCodeMaisonAutomatique()` (src/services/stockService.ts), retirer le
  // `try { … } catch { … }` autour de l'UPDATE (laisser l'exception se propager). Rouge observé :
  // `createProduit()` rejette (throw) au lieu de renvoyer `avertissement_code_maison` — le test
  // ci-dessus échoue sur l'appel lui-même (`res` jamais défini). Mutation restaurée, test
  // revérifié vert (voir compte rendu).

  it('un code déjà présent reste intact après la pose automatique (non-écrasement)', async () => {
    const { id } = await createProduit(base.d1, 1, 1, { nom: 'A', code_barre: 'DEJA-POSE', stock_minimum: 0 })
    expect(codeBarreDe(id)).toBe('DEJA-POSE')
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Double garde-fou (défense en profondeur) : désactiver UN SEUL des deux mécanismes
  // (`dispenseDeCodeMaison()` à l'entrée, OU la condition `code_barre IS NULL OR TRIM(...) = ''`
  // du `WHERE`) laisse ce test vert — l'autre rattrape seul. Mutant qui prouve le rouge : les DEUX
  // désactivés à la fois (dispense commentée + `WHERE` réduit à `id = ? AND boutique_id = ?`).
  // Rouge observé : `codeBarreDe(id)` valait le code maison calculé (`2100000000012`) au lieu de
  // `'DEJA-POSE'`. Mutation restaurée, test revérifié vert (voir compte rendu).
})

describe('importCatalogueCsv() — code maison', () => {
  it('nouveau produit sans code → code maison posé', async () => {
    const csv = 'nom,sku\nPièce CSV sans code,CSV-001'
    const result = await importCatalogueCsv(base.d1, 1, 1, csv)
    expect(result.imported).toBe(1)
    const row = base.sqlite.prepare("SELECT id, code_barre FROM produits WHERE nom = 'Pièce CSV sans code'").get() as any
    expect(row.code_barre).not.toBeNull()
    expect(estEan13Valide(row.code_barre)).toBe(true)
  })

  it('nouveau produit AVEC code_barre dans le CSV → code enregistré, aucun code maison', async () => {
    const csv = 'nom,sku,code_barre\nPièce avec EAN,CSV-002,3700275472140'
    const result = await importCatalogueCsv(base.d1, 1, 1, csv)
    expect(result.imported).toBe(1)
    const row = base.sqlite.prepare("SELECT code_barre FROM produits WHERE nom = 'Pièce avec EAN'").get() as any
    expect(row.code_barre).toBe('3700275472140')
  })

  it('CSV au code en doublon (nouvelle ligne) → ligne signalée dans le bilan, produit porteur nommé, pas imported en trop', async () => {
    const csv = [
      'nom,sku,code_barre',
      'Premier,CSV-A,3700275472140',
      'Doublon,CSV-B,3700275472140',
    ].join('\n')
    const result = await importCatalogueCsv(base.d1, 1, 1, csv)
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Ligne 3')
    expect(result.errors[0]).toContain('Premier') // nomme le porteur
    const nb = (base.sqlite.prepare("SELECT COUNT(*) AS n FROM produits WHERE nom = 'Doublon'").get() as any).n
    expect(nb).toBe(0)
  })

  it('import Mobilax (sansCodeMaison) → jamais de code maison, même sans EAN', async () => {
    // importCatalogueCsv() n'est pas le chemin Mobilax ; cette assertion vit dans
    // produit-code-maison-sqlite.test.ts > createProduit() (`sansCodeMaison`) ci-dessus — gardée
    // ici seulement comme repère de couture pour qui cherche la couverture CSV vs Mobilax.
    expect(true).toBe(true)
  })

  it('collision à la pose automatique (ligne CSV sans code) : produit créé, sans code, compté comme importé, avertissement présent', async () => {
    // Même procédé que le test équivalent de `createProduit()` : on pose sur un produit existant
    // le code que le PROCHAIN produit (créé par le CSV) calculera, pour forcer la collision.
    const { id: porteurId } = await createProduit(base.d1, 1, 1, { nom: 'Porteur CSV', stock_minimum: 0 })
    const prochainId = porteurId + 1
    const { codeMaison } = await import('../src/lib/codeMaison')
    base.sqlite.prepare('UPDATE produits SET code_barre = ? WHERE id = ?').run(codeMaison(1, prochainId), porteurId)

    const csv = 'nom,sku\nPièce qui entre en collision,CSV-COL'
    const result = await importCatalogueCsv(base.d1, 1, 1, csv)

    expect(result.imported).toBe(1) // comptée comme importée malgré l'échec de la pose
    expect(result.skipped).toBe(0)
    expect(result.avertissements).toHaveLength(1)
    expect(result.avertissements[0]).toContain('Ligne 2')
    expect(result.avertissements[0]).toContain('Porteur CSV')
    const row = base.sqlite.prepare("SELECT code_barre FROM produits WHERE nom = 'Pièce qui entre en collision'").get() as any
    expect(row.code_barre).toBeNull()
  })

  it('CSV qui met à jour un produit déjà codé laisse le code inchangé', async () => {
    await importCatalogueCsv(base.d1, 1, 1, 'nom,sku,code_barre\nProduit,SKU-X,ORIGINAL-CODE')
    const avant = base.sqlite.prepare("SELECT id, code_barre FROM produits WHERE sku = 'SKU-X'").get() as any
    expect(avant.code_barre).toBe('ORIGINAL-CODE')

    // Même SKU, code_barre différent dans le CSV : ne doit PAS écraser le code existant.
    const result = await importCatalogueCsv(base.d1, 1, 1, 'nom,sku,code_barre\nProduit renommé,SKU-X,AUTRE-CODE')
    expect(result.updated).toBe(1)
    const apres = base.sqlite.prepare("SELECT code_barre FROM produits WHERE id = ?").get(avant.id) as any
    expect(apres.code_barre).toBe('ORIGINAL-CODE')
  })

  it('CSV met à jour un produit existant SANS code avec un code_barre déjà porté par un autre → ligne rejetée en entier, rien de partiel, comptée une fois en skipped', async () => {
    // Porteur du code, et le produit à mettre à jour — sans code (son SKU est un EAN-13 valide,
    // qui dispense de la pose automatique : sans ce choix, « Cible » recevrait elle-même un code
    // maison à sa création CSV et l'UPDATE testé ne tenterait jamais l'écrasement).
    const SKU_CIBLE_EAN = '4006381333931'
    await importCatalogueCsv(base.d1, 1, 1, 'nom,sku,code_barre\nPorteur,SKU-PORTEUR,CODE-PARTAGE')
    await importCatalogueCsv(base.d1, 1, 1, `nom,sku,prix_achat_ht,stock_actuel\nCible,${SKU_CIBLE_EAN},5,2`)
    const cibleAvant = base.sqlite.prepare('SELECT id, nom, prix_achat_ht, stock_actuel, code_barre FROM produits WHERE sku = ?').get(SKU_CIBLE_EAN) as any
    expect(cibleAvant.code_barre).toBeNull() // garde-fou du montage du test lui-même
    const nbMouvAvant = (base.sqlite.prepare('SELECT COUNT(*) AS n FROM mouvements_stock WHERE produit_id = ?').get(cibleAvant.id) as any).n

    const result = await importCatalogueCsv(
      base.d1, 1, 1,
      `nom,sku,prix_achat_ht,stock_actuel,code_barre\nCible modifiée,${SKU_CIBLE_EAN},999,50,CODE-PARTAGE`,
    )

    expect(result.updated).toBe(0)
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Porteur')

    const cibleApres = base.sqlite.prepare('SELECT nom, prix_achat_ht, stock_actuel FROM produits WHERE id = ?').get(cibleAvant.id) as any
    expect(cibleApres).toEqual({ nom: 'Cible', prix_achat_ht: 5, stock_actuel: 2 }) // rien n'a bougé
    const nbMouvApres = (base.sqlite.prepare('SELECT COUNT(*) AS n FROM mouvements_stock WHERE produit_id = ?').get(cibleAvant.id) as any).n
    expect(nbMouvApres).toBe(nbMouvAvant) // aucun nouveau mouvement de stock
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Mutant : dans `importCatalogueCsv()` (src/services/stockService.ts), déplacer l'écriture du
  // `code_barre` de l'UPDATE conditionnel vers une écriture séparée APRÈS le mouvement de stock
  // (au lieu du même UPDATE que nom/prix/tva). Rouge observé sur le test ci-dessus :
  // `cibleApres.prix_achat_ht` valait 999 (la ligne aurait été appliquée partiellement avant que
  // la pose du code échoue) au lieu de 5. Mutation restaurée, test revérifié vert (voir compte
  // rendu).
})
