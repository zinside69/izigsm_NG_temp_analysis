import { describe, it, expect, beforeEach } from 'vitest'
// @ts-ignore node:sqlite types not available without @types/node — moteur SQLite intégré à Node 24
import { DatabaseSync } from 'node:sqlite'
import type { Database } from '../src/ports/database'
import {
  resoudreAdaptateurProduit, ecrirePrixAchatRevalide,
  listProduits, getProduitById,
} from '../src/services/stockService'

/**
 * Rafraîchissement manuel d'une pièce importée (ticket 05 `integration-mobilax`, amendement du
 * 2026-09-27, points 1, 2, 7, 8 et 9) : la reconnaissance d'un produit Mobilax — jointure
 * `produits` ↔ `fournisseurs` sur LA boutique du produit — et l'écriture qui ne doit toucher QUE
 * `prix_achat_ht` tiennent dans le SQL. Un mock D1 accepterait n'importe quelle requête et ne
 * prouverait ni la jointure d'isolation ni le `WHERE` de l'`UPDATE` (`CLAUDE.md` : une règle
 * portée par le SQL se prouve contre la vraie D1 locale, jamais contre un mock).
 *
 * Testé contre un VRAI moteur SQLite (`node:sqlite`), sur DEUX boutiques — même patron que
 * `tests/stock-import-deja-en-stock.test.ts` (ticket 18).
 */

const SCHEMA = `
  CREATE TABLE fournisseurs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id    INTEGER NOT NULL,
    api_plateforme TEXT,
    actif          INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE categories (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id  INTEGER NOT NULL,
    nom          TEXT    NOT NULL
  );
  CREATE TABLE users (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    prenom  TEXT,
    nom     TEXT
  );
  CREATE TABLE produits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    boutique_id     INTEGER NOT NULL,
    nom             TEXT    NOT NULL,
    categorie_id    INTEGER,
    fournisseur_id  INTEGER,
    mobilax_id      INTEGER,
    prix_achat_ht   REAL    NOT NULL DEFAULT 0,
    prix_achat_cump REAL    NOT NULL DEFAULT 0,
    prix_vente_ht   REAL    NOT NULL DEFAULT 0,
    stock_actuel    INTEGER NOT NULL DEFAULT 0,
    stock_minimum   INTEGER NOT NULL DEFAULT 0,
    actif           INTEGER NOT NULL DEFAULT 1,
    updated_at      DATETIME
  );
  CREATE TABLE mouvements_stock (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    produit_id     INTEGER NOT NULL,
    boutique_id    INTEGER NOT NULL,
    type_mouvement TEXT    NOT NULL,
    quantite       INTEGER NOT NULL,
    stock_avant    INTEGER NOT NULL,
    stock_apres    INTEGER NOT NULL,
    user_id        INTEGER NOT NULL,
    motif          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`

let sqlite: any
let db: Database

/** Port `Database` au-dessus du SQLite réel — même adaptateur que les autres tests SQLite du dépôt. */
function portSur(base: any): Database {
  return {
    async all<T>(sql: string, params: unknown[] = []) { return base.prepare(sql).all(...params) as T[] },
    async get<T>(sql: string, params: unknown[] = []) { return (base.prepare(sql).get(...params) ?? null) as T | null },
    // Port enrichi de batch() le 2026-10-03 (clôture NF525) : ce test ne l'utilise pas
    async batch(): Promise<unknown[][]> { throw new Error('batch() non utilisé par ce test') },
    async run(sql: string, params: unknown[] = []) {
      const r = base.prepare(sql).run(...params)
      return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }
    },
  }
}

function fournisseur(f: Partial<{ boutique_id: number; api_plateforme: string | null; actif: number }> = {}): number {
  const v = { boutique_id: 1, api_plateforme: 'mobilax', actif: 1, ...f }
  return Number(sqlite.prepare(
    'INSERT INTO fournisseurs (boutique_id, api_plateforme, actif) VALUES (?, ?, ?)',
  ).run(v.boutique_id, v.api_plateforme, v.actif).lastInsertRowid)
}

function produit(p: Partial<{
  boutique_id: number; fournisseur_id: number | null; mobilax_id: number | null
  prix_achat_ht: number; prix_achat_cump: number; prix_vente_ht: number; stock_actuel: number; actif: number
}> = {}): number {
  const v = {
    boutique_id: 1, fournisseur_id: null, mobilax_id: null,
    prix_achat_ht: 10, prix_achat_cump: 8, prix_vente_ht: 25, stock_actuel: 3, actif: 1, ...p,
  }
  return Number(sqlite.prepare(
    `INSERT INTO produits (boutique_id, nom, fournisseur_id, mobilax_id, prix_achat_ht, prix_achat_cump, prix_vente_ht, stock_actuel, actif)
     VALUES (?, 'Écran', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(v.boutique_id, v.fournisseur_id, v.mobilax_id, v.prix_achat_ht, v.prix_achat_cump, v.prix_vente_ht, v.stock_actuel, v.actif).lastInsertRowid)
}

const ligne = (id: number): any => sqlite.prepare('SELECT * FROM produits WHERE id = ?').get(id)
const nbMouvements = (): number => sqlite.prepare('SELECT COUNT(*) AS n FROM mouvements_stock').get().n

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(SCHEMA)
  db = portSur(sqlite)
})

describe('resoudreAdaptateurProduit() — identité Mobilax (points 1 et 8 de l\'amendement)', () => {
  it('(d) produit Mobilax conforme : adaptateur "mobilax" rendu avec son identifiant', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17 })
    expect(await resoudreAdaptateurProduit(db, 1, id)).toEqual({ produit_id: id, api_plateforme: 'mobilax', mobilax_id: 17, rafraichissable_par: 'Mobilax' })
  })

  it('(a) mobilax_id posé mais fiche fournisseur non Mobilax : aucun adaptateur', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: null })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17 })
    expect(await resoudreAdaptateurProduit(db, 1, id)).toEqual({ produit_id: id, api_plateforme: null, mobilax_id: 17, rafraichissable_par: null })
  })

  it('(b) produit de la boutique B demandé par la boutique A : rien', async () => {
    const f = fournisseur({ boutique_id: 2, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 2, fournisseur_id: f, mobilax_id: 17 })
    expect(await resoudreAdaptateurProduit(db, 1, id)).toBeNull()
  })

  it('(c) fiche Mobilax d\'une autre boutique : aucun adaptateur, bien que le produit soit trouvé dans SA boutique', async () => {
    // Donnée volontairement anormale : le produit de la boutique 1 pointe un fournisseur de la boutique 2
    const fAutreBoutique = fournisseur({ boutique_id: 2, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: fAutreBoutique, mobilax_id: 17 })
    expect(await resoudreAdaptateurProduit(db, 1, id)).toEqual({ produit_id: id, api_plateforme: null, mobilax_id: 17, rafraichissable_par: null })
  })

  it('produit inexistant : rien', async () => {
    expect(await resoudreAdaptateurProduit(db, 1, 999)).toBeNull()
  })

  it('produit désactivé : rien, comme un produit inexistant', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17, actif: 0 })
    expect(await resoudreAdaptateurProduit(db, 1, id)).toBeNull()
  })

  it('produit sans fournisseur lié : aucun adaptateur', async () => {
    const id = produit({ boutique_id: 1, fournisseur_id: null, mobilax_id: null })
    expect(await resoudreAdaptateurProduit(db, 1, id)).toEqual({ produit_id: id, api_plateforme: null, mobilax_id: null, rafraichissable_par: null })
  })
})

describe('ecrirePrixAchatRevalide() — écriture conditionnée (points 2, 7 et 9 de l\'amendement)', () => {
  it('écrit seulement prix_achat_ht ; prix de vente, CUMP et stock inchangés ; aucun mouvement créé', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17, prix_achat_ht: 10, prix_achat_cump: 8, prix_vente_ht: 25, stock_actuel: 3 })
    expect(await ecrirePrixAchatRevalide(db, 1, id, 17, 12.5)).toBe(true)
    expect(ligne(id)).toMatchObject({ prix_achat_ht: 12.5, prix_achat_cump: 8, prix_vente_ht: 25, stock_actuel: 3 })
    expect(nbMouvements()).toBe(0)
  })

  it('identifiant Mobilax différent de celui vérifié (point 9) : 0 ligne modifiée, prix inchangé', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17, prix_achat_ht: 10 })
    expect(await ecrirePrixAchatRevalide(db, 1, id, 99, 12.5)).toBe(false)
    expect(ligne(id).prix_achat_ht).toBe(10)
  })

  it('produit d\'une autre boutique : refusé (filtre boutique_id, point 2)', async () => {
    const f = fournisseur({ boutique_id: 2, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 2, fournisseur_id: f, mobilax_id: 17, prix_achat_ht: 10 })
    expect(await ecrirePrixAchatRevalide(db, 1, id, 17, 12.5)).toBe(false)
    expect(ligne(id).prix_achat_ht).toBe(10)
  })

  it('deux boutiques distinctes, même identifiant Mobilax : chacune ne modifie que son propre produit', async () => {
    const f1 = fournisseur({ boutique_id: 1, api_plateforme: 'mobilax' })
    const f2 = fournisseur({ boutique_id: 2, api_plateforme: 'mobilax' })
    const id1 = produit({ boutique_id: 1, fournisseur_id: f1, mobilax_id: 17, prix_achat_ht: 10 })
    const id2 = produit({ boutique_id: 2, fournisseur_id: f2, mobilax_id: 17, prix_achat_ht: 20 })
    expect(await ecrirePrixAchatRevalide(db, 1, id1, 17, 11)).toBe(true)
    expect(await ecrirePrixAchatRevalide(db, 2, id2, 17, 22)).toBe(true)
    expect(ligne(id1).prix_achat_ht).toBe(11)
    expect(ligne(id2).prix_achat_ht).toBe(22)
  })

  it('produit désactivé : refusé', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17, prix_achat_ht: 10, actif: 0 })
    expect(await ecrirePrixAchatRevalide(db, 1, id, 17, 12.5)).toBe(false)
    expect(ligne(id).prix_achat_ht).toBe(10)
  })
})

describe('rafraichissable_par — même jointure que resoudreAdaptateurProduit() (points 11 et 16)', () => {
  /**
   * `listProduits()` et `getProduitById()` doivent rendre exactement le même `rafraichissable_par`
   * que celui déjà porté par `resoudreAdaptateurProduit()` — un seul fragment SQL
   * (`sqlJointureFournisseurProduit()` + `sqlRafraichissablePar()`, exportés de `stockService.ts`),
   * jamais une seconde règle réécrite en TypeScript ici ou chez un appelant (point 16) :
   * `attendu()` se contente donc de LIRE le champ `rafraichissable_par` que
   * `resoudreAdaptateurProduit()` calcule déjà par ce même fragment, sans reconstruire la condition
   * (`api_plateforme === 'mobilax' && mobilax_id !== null`) à côté. Les quatre cas sont ceux du
   * point 8 : (a) mobilax_id posé mais fiche non Mobilax, (b) produit d'une autre boutique, (c)
   * fiche Mobilax d'une autre boutique, (d) produit Mobilax conforme.
   */
  async function attendu(boutiqueId: number, produitId: number): Promise<string | null> {
    return (await resoudreAdaptateurProduit(db, boutiqueId, produitId))?.rafraichissable_par ?? null
  }

  it('(a) mobilax_id posé mais fiche fournisseur non Mobilax : rafraichissable_par = null, sur les trois fonctions', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: null })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17 })

    expect(await attendu(1, id)).toBeNull()
    expect((await getProduitById(db, id)).rafraichissable_par).toBeNull()
    const { data } = await listProduits(db, 1)
    expect(data.find((p: any) => p.id === id).rafraichissable_par).toBeNull()
  })

  it('(b) produit de la boutique B demandé par la boutique A : rien via resoudreAdaptateurProduit ni listProduits(A) ; getProduitById ne filtre pas par boutique — isolation portée par la route', async () => {
    const f = fournisseur({ boutique_id: 2, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 2, fournisseur_id: f, mobilax_id: 17 })

    // La boutique A (1) ne voit RIEN de ce produit de B via resoudreAdaptateurProduit : la
    // jointure filtre sur p.boutique_id = ? (le WHERE), pas seulement sur f.boutique_id = p.boutique_id
    expect(await resoudreAdaptateurProduit(db, 1, id)).toBeNull()
    // Ni via listProduits(A) — filtré par boutique_id
    const { data: dataA } = await listProduits(db, 1)
    expect(dataA.find((p: any) => p.id === id)).toBeUndefined()

    // Dans SA boutique (B), le produit est bien rafraîchissable — sur les trois fonctions
    expect(await attendu(2, id)).toBe('Mobilax')
    const { data: dataB } = await listProduits(db, 2)
    expect(dataB.find((p: any) => p.id === id)?.rafraichissable_par).toBe('Mobilax')
    // getProduitById() ne prend pas de boutique_id : appelée « côté A » (sans garde), elle rend
    // quand même la ligne de B — c'est la route (assertBoutiqueOwnership) qui isole, pas cette
    // fonction. Documenté ici pour ne pas être pris pour un défaut d'isolation de la fonction elle-même.
    expect((await getProduitById(db, id)).rafraichissable_par).toBe('Mobilax')
  })

  it('(c) fiche Mobilax d\'une autre boutique : rafraichissable_par = null, sur les trois fonctions', async () => {
    const fAutreBoutique = fournisseur({ boutique_id: 2, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: fAutreBoutique, mobilax_id: 17 })

    expect(await attendu(1, id)).toBeNull()
    expect((await getProduitById(db, id)).rafraichissable_par).toBeNull()
    const { data } = await listProduits(db, 1)
    expect(data.find((p: any) => p.id === id).rafraichissable_par).toBeNull()
  })

  it('(d) produit Mobilax conforme : rafraichissable_par = "Mobilax", sur les trois fonctions', async () => {
    const f = fournisseur({ boutique_id: 1, api_plateforme: 'mobilax' })
    const id = produit({ boutique_id: 1, fournisseur_id: f, mobilax_id: 17 })

    expect(await attendu(1, id)).toBe('Mobilax')
    expect((await getProduitById(db, id)).rafraichissable_par).toBe('Mobilax')
    const { data } = await listProduits(db, 1)
    expect(data.find((p: any) => p.id === id).rafraichissable_par).toBe('Mobilax')
  })

  it('produit sans fournisseur lié : rafraichissable_par = null', async () => {
    const id = produit({ boutique_id: 1, fournisseur_id: null, mobilax_id: null })

    expect(await attendu(1, id)).toBeNull()
    expect((await getProduitById(db, id)).rafraichissable_par).toBeNull()
    const { data } = await listProduits(db, 1)
    expect(data.find((p: any) => p.id === id).rafraichissable_par).toBeNull()
  })
})
