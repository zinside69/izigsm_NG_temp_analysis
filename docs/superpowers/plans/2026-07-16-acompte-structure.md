# Acompte structuré (sous-projet A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à la boutique de facturer un acompte (montant libre) à la prise en charge ou au devis, déduit automatiquement de la facture finale, avec émission d'un avoir (validité 2 mois) si le dossier est annulé après acompte perçu.

**Architecture:** L'acompte est une vraie facture (`factures.type_facture='acompte'`), émise et verrouillée immédiatement, dans la même séquence de numérotation `FAC-` que les factures normales — réutilise `factureService.ts` (`ajouterPaiement`, `emettreFacture`, `createAvoir`) sans étendre la chaîne NF525. La facture finale déduit l'acompte via une ligne négative dans ses propres lignes, pas via une exclusion de calcul.

**Tech Stack:** Hono/TypeScript (Cloudflare Workers), D1 (SQLite), Vitest (`mockD1`/`mockDatabase`), HTML/JS vanilla frontend.

## Global Constraints

- Spec source de vérité : `docs/superpowers/specs/2026-07-16-acompte-structure-design.md` — toute divergence entre ce plan et le spec doit être résolue en faveur du spec (et signalée).
- Un seul acompte par dossier (ticket ou devis) — pas de cumul.
- Rôles autorisés à créer un acompte : `admin`/`manager` uniquement (pas technicien).
- Aucune extension de la chaîne NF525 (`journal_nf525`, `type_transaction`) — l'acompte utilise le type `'facture'` déjà existant.
- Aucune nouvelle séquence de numérotation — l'acompte partage `FAC-` avec les factures normales (`nextNumero(db, boutiqueId, 'facture')`).
- Toute fonction dépendant d'`auditLog()`/`nextNumero()`/`enregistrerTransaction()` reste sur `D1Database` brut (pas le port `Database`) — cohérent avec `convertirDevis()`/`createAvoir()`/`emettreFacture()` déjà dans ce mode.
- `CACHE_VERSION` dans `public/sw.js` (actuellement `izigsm-v2.57`) doit être incrémentée dans la tâche qui termine les modifications frontend (dernière tâche frontend du plan), pas avant.
- Chaque tâche backend se termine par `npx vitest run` vert avant de passer à la suivante ; chaque tâche frontend par une validation en local live (`wrangler pages dev`) avec de vraies données, pas juste une relecture de code.

---

### Task 1: Migration 0036 — `factures.type_facture` + `avoirs.date_expiration`

**Files:**
- Create: `migrations/0036_acompte_structure.sql`

**Interfaces:**
- Produces: colonne `factures.type_facture` (`TEXT NOT NULL DEFAULT 'normale'`, valeurs `'normale'` | `'acompte'`), colonne `avoirs.date_expiration` (`DATETIME`, nullable) — consommées par les tâches 2 et 3.

- [ ] **Step 1: Écrire la migration**

```sql
-- ============================================================
-- Migration 0036 : Acompte structuré — facture d'acompte + expiration avoir
-- ============================================================

ALTER TABLE factures ADD COLUMN type_facture TEXT NOT NULL DEFAULT 'normale';  -- 'normale' | 'acompte'
ALTER TABLE avoirs    ADD COLUMN date_expiration DATETIME;                      -- NULL = pas d'expiration (comportement actuel)

CREATE INDEX IF NOT EXISTS idx_factures_type_facture ON factures(type_facture);
```

- [ ] **Step 2: Appliquer la migration en local**

Run: `npx wrangler d1 migrations apply izigsm-production --local`
Expected: sortie confirmant l'application de `0036_acompte_structure.sql`, aucune erreur.

- [ ] **Step 3: Vérifier les colonnes**

Run: `npx wrangler d1 execute izigsm-production --local --command "PRAGMA table_info(factures)"`
Expected: la sortie JSON contient une entrée `{"name":"type_facture","type":"TEXT",...,"dflt_value":"'normale'"}`.

Run: `npx wrangler d1 execute izigsm-production --local --command "PRAGMA table_info(avoirs)"`
Expected: la sortie JSON contient une entrée `{"name":"date_expiration","type":"DATETIME","notnull":0}`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0036_acompte_structure.sql
git commit -m "feat(db): migration 0036 — factures.type_facture + avoirs.date_expiration"
```

---

### Task 2: `factureService.ts` — `createFactureAcompte()`

**Files:**
- Modify: `src/services/factureService.ts` (ajouter après `emettreFacture()`, avant la section `// ─── Avoirs ───`)
- Test: `tests/factureService.test.ts`

**Interfaces:**
- Consumes: `nextNumero(db, boutique_id, type)` de `lib/db.ts` (signature déjà existante) ; `calculLignes(lignes)` de `lib/db.ts` ; `ajouterPaiement(db, factureId, userId, input)` et `emettreFacture(db, factureId, userId)` (déjà exportées dans ce fichier, Task 2 les appelle en interne, ne les modifie pas) ; `auditLog(db, params)` de `lib/db.ts`.
- Produces: `export interface CreateFactureAcompteInput { boutique_id: number; client_id: number; ticket_id?: number | null; devis_id?: number | null; montant_ht: number; tva_taux: number; mode_paiement: string; reference?: string }` et `export async function createFactureAcompte(db: D1Database, userId: number, input: CreateFactureAcompteInput): Promise<{ facture_id: number; facture_numero: string }>` — consommées par les Tasks 5 et 6.

- [ ] **Step 1: Écrire les tests (échouent — fonction pas encore écrite)**

Ajouter à la fin de `tests/factureService.test.ts`, avant la dernière accolade fermante du fichier (vérifier avec `tail -5 tests/factureService.test.ts` qu'il n'y a pas de code après le dernier `describe`) :

```typescript
// ─── createFactureAcompte ─────────────────────────────────────────────────────

describe('createFactureAcompte()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_CHECK_ACOMPTE_EXISTANT = n(`SELECT id FROM factures WHERE type_facture = 'acompte' AND (ticket_id = ? OR devis_id = ?)`)
  const SQL_INSERT_FACTURE_ACOMPTE = n(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, devis_id, type_facture, total_ht, total_tva, total_ttc, statut)
    VALUES (?, ?, ?, ?, ?, 'acompte', ?, ?, ?, 'brouillon')
    RETURNING id
  `)
  const SQL_GET_FACTURE_PAIEMENT = n(`SELECT id, total_ttc, montant_paye, boutique_id, locked FROM factures WHERE id = ?`)
  const SQL_GET_FACTURE_EMETTRE  = n(`SELECT * FROM factures WHERE id = ?`)
  const SQL_NF525_LAST_HASH      = n(`SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1`)

  function setupNumeroFacture() {
    db.__setResponse(
      'SELECT prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat, format_numero, padding_numero FROM boutique_settings WHERE boutique_id = ?',
      { prefix_facture: 'FAC', format_numero: 'annee', padding_numero: 5 }
    )
    db.__setResponse(
      'SELECT dernier_num FROM sequences WHERE boutique_id = ? AND type = ? AND annee = ?',
      { dernier_num: 7 }
    )
  }

  function setupCreationComplete(factureId: number) {
    setupNumeroFacture()
    db.__setNotFound(SQL_CHECK_ACOMPTE_EXISTANT)
    db.__setResponseFn(SQL_INSERT_FACTURE_ACOMPTE, () => ({ id: factureId }))
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: factureId, total_ttc: 120, montant_paye: 0, boutique_id: 1, locked: 0,
    })
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, {
      id: factureId, boutique_id: 1, client_id: 3, numero: 'FAC-2026-00007',
      total_ht: 100, total_tva: 20, total_ttc: 120, locked: 0,
    })
    db.__setNotFound(SQL_NF525_LAST_HASH)
  }

  beforeEach(() => { db = createMockD1() })

  const BASE_INPUT: CreateFactureAcompteInput = {
    boutique_id: 1, client_id: 3, ticket_id: 42, devis_id: null,
    montant_ht: 100, tva_taux: 20,
    mode_paiement: 'especes',
  }

  it('lance Error si ni ticket_id ni devis_id', async () => {
    await expect(createFactureAcompte(db, 10, { ...BASE_INPUT, ticket_id: null, devis_id: null }))
      .rejects.toThrow('ticket_id ou devis_id requis.')
  })

  it('lance Error si montant_ht <= 0', async () => {
    await expect(createFactureAcompte(db, 10, { ...BASE_INPUT, montant_ht: 0 }))
      .rejects.toThrow('montant_ht doit être positif.')
  })

  it('lance Error si un acompte existe déjà pour ce dossier', async () => {
    db.__setResponse(SQL_CHECK_ACOMPTE_EXISTANT, { id: 99 })

    await expect(createFactureAcompte(db, 10, BASE_INPUT))
      .rejects.toThrow('Un acompte a déjà été facturé pour ce dossier.')
  })

  it('crée la facture, retourne facture_id + facture_numero', async () => {
    setupCreationComplete(50)

    const result = await createFactureAcompte(db, 10, BASE_INPUT)

    expect(result.facture_id).toBe(50)
    expect(result.facture_numero).toMatch(/^FAC-/)
  })

  it('INSERT facture avec type_facture=acompte et bons montants', async () => {
    setupCreationComplete(50)

    await createFactureAcompte(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_FACTURE_ACOMPTE)
    expect(insertCall).toBeDefined()
    // (boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva, total_ttc)
    expect(insertCall!.params[0]).toBe(1)   // boutique_id
    expect(insertCall!.params[2]).toBe(3)   // client_id
    expect(insertCall!.params[3]).toBe(42)  // ticket_id
    expect(insertCall!.params[4]).toBeNull() // devis_id
    expect(insertCall!.params[5]).toBe(100) // total_ht
    expect(insertCall!.params[6]).toBe(20)  // total_tva
    expect(insertCall!.params[7]).toBe(120) // total_ttc
  })

  it('enregistre le paiement puis émet et verrouille la facture', async () => {
    setupCreationComplete(50)

    await createFactureAcompte(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('INSERT INTO paiements'))).toBe(true)
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(true)
    const lockCall = calls.find(c => c.sql.includes('SET') && c.sql.includes('locked') && c.sql.includes('factures'))
    expect(lockCall).toBeDefined()
  })

  it('appelle auditLog CREATE_FACTURE_ACOMPTE', async () => {
    setupCreationComplete(50)

    await createFactureAcompte(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    const auditCall = calls.find(c => c.sql.includes('INSERT INTO audit_logs') && c.params.includes('CREATE_FACTURE_ACOMPTE'))
    expect(auditCall).toBeDefined()
  })

  it('fonctionne aussi rattaché à un devis (ticket_id null)', async () => {
    setupCreationComplete(51)

    const result = await createFactureAcompte(db, 10, { ...BASE_INPUT, ticket_id: null, devis_id: 7 })

    expect(result.facture_id).toBe(51)
    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_FACTURE_ACOMPTE)
    expect(insertCall!.params[3]).toBeNull() // ticket_id
    expect(insertCall!.params[4]).toBe(7)    // devis_id
  })
})
```

Ajouter `CreateFactureAcompteInput, createFactureAcompte` à l'import existant de `factureService.ts` en haut du fichier de test (chercher la ligne `import { ... } from '../src/services/factureService'` et ajouter les deux identifiants à la liste).

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run tests/factureService.test.ts -t "createFactureAcompte"`
Expected: FAIL — `createFactureAcompte is not a function` ou erreur d'import (le nom n'existe pas encore dans `factureService.ts`).

- [ ] **Step 3: Implémenter `createFactureAcompte()`**

Dans `src/services/factureService.ts`, insérer après la fin de `emettreFacture()` (juste avant le commentaire `// ─── Avoirs ───────`) :

```typescript
// ─── Acompte structuré ────────────────────────────────────────────────────────

export interface CreateFactureAcompteInput {
  boutique_id:   number
  client_id:     number
  ticket_id?:    number | null
  devis_id?:     number | null
  montant_ht:    number
  tva_taux:      number
  mode_paiement: string
  reference?:    string
}

/**
 * Crée un acompte encaissé manuellement, sous forme de vraie facture émise
 * immédiatement (voir docs/superpowers/specs/2026-07-16-acompte-structure-design.md).
 * Réutilise la même séquence FAC- que les factures normales (une facture
 * d'acompte est légalement une "facture", pas une catégorie distincte) et
 * enchaîne ajouterPaiement() + emettreFacture() déjà existants — aucune
 * extension de la chaîne NF525.
 *
 * Un seul acompte par dossier (ticket ou devis) : rejette si une facture
 * type_facture='acompte' existe déjà pour ce ticket_id/devis_id.
 *
 * Non migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12) :
 * dépend de `nextNumero()`/`auditLog()`/`ajouterPaiement()`/`emettreFacture()`,
 * tous sur `D1Database` brut.
 *
 * @param db     - Instance D1Database
 * @param userId - ID de l'utilisateur qui encaisse l'acompte
 * @param input  - Montant HT + taux TVA (comme une ligne de devis/facture standard,
 *                 pas un montant TTC — cohérent avec le reste de la saisie de prix
 *                 dans l'app) + rattachement ticket_id et/ou devis_id
 */
export async function createFactureAcompte(
  db:     D1Database,
  userId: number,
  input:  CreateFactureAcompteInput
): Promise<{ facture_id: number; facture_numero: string }> {
  if (!input.ticket_id && !input.devis_id)
    throw new Error('ticket_id ou devis_id requis.')
  if (input.montant_ht <= 0)
    throw new Error('montant_ht doit être positif.')

  const existing = await db.prepare(`
    SELECT id FROM factures WHERE type_facture = 'acompte' AND (ticket_id = ? OR devis_id = ?)
  `).bind(input.ticket_id ?? 0, input.devis_id ?? 0).first<{ id: number }>()
  if (existing) throw new Error('Un acompte a déjà été facturé pour ce dossier.')

  const { total_ht, total_tva, total_ttc } = calculLignes([
    { quantite: 1, prix_unitaire_ht: input.montant_ht, tva_taux: input.tva_taux },
  ])

  const numero = await nextNumero(db, input.boutique_id, 'facture')

  const facture = await db.prepare(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, devis_id, type_facture, total_ht, total_tva, total_ttc, statut)
    VALUES (?, ?, ?, ?, ?, 'acompte', ?, ?, ?, 'brouillon')
    RETURNING id
  `).bind(
    input.boutique_id, numero, input.client_id,
    input.ticket_id ?? null, input.devis_id ?? null,
    total_ht, total_tva, total_ttc,
  ).first<{ id: number }>()

  if (!facture?.id) throw new Error('Erreur lors de la création de la facture d\'acompte.')
  const factureId = facture.id

  await db.prepare(`
    INSERT INTO lignes_document
      (document_type, document_id, ordre, description, quantite,
       prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
    VALUES ('facture', ?, 1, 'Acompte', 1, ?, ?, ?, ?, ?, NULL)
  `).bind(factureId, input.montant_ht, input.tva_taux, total_ht, total_tva, total_ttc).run()

  // Encaissement immédiat (le client a déjà payé au moment de la demande) puis
  // émission — ajouterPaiement() exige locked=0, doit donc précéder emettreFacture().
  await ajouterPaiement(db, factureId, userId, {
    montant:       total_ttc,
    mode_paiement: input.mode_paiement,
    reference:     input.reference,
  })
  await emettreFacture(db, factureId, userId)

  await auditLog(db, {
    boutique_id: input.boutique_id, user_id: userId,
    action: 'CREATE_FACTURE_ACOMPTE', entite_type: 'facture', entite_id: factureId,
    apres: { numero, ticket_id: input.ticket_id ?? null, devis_id: input.devis_id ?? null, total_ttc },
  })

  return { facture_id: factureId, facture_numero: numero }
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx vitest run tests/factureService.test.ts -t "createFactureAcompte"`
Expected: PASS — 9 tests verts.

- [ ] **Step 5: Lancer la suite complète**

Run: `npx vitest run`
Expected: `812/814` (9 nouveaux tests, 803 existants, mêmes 2 échecs pré-existants `computeFin()` sans lien).

- [ ] **Step 6: Commit**

```bash
git add src/services/factureService.ts tests/factureService.test.ts
git commit -m "feat(factures): createFactureAcompte() — acompte = facture émise immédiatement"
```

---

### Task 3: `factureService.ts` — `createAvoir()` accepte `date_expiration`

**Files:**
- Modify: `src/services/factureService.ts:41-47` (interface `CreateAvoirInput`), `src/services/factureService.ts:383-394` (INSERT dans `createAvoir()`)
- Test: `tests/factureService.test.ts`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `CreateAvoirInput.date_expiration?: string` (optionnel, format ISO 8601) — consommé par la Task 8 (annulation ticket avec acompte).

- [ ] **Step 1: Écrire le test (échoue — colonne pas encore acceptée)**

Ajouter dans `tests/factureService.test.ts`, à l'intérieur du `describe('createAvoir()', ...)` existant, juste avant l'accolade fermante de ce bloc :

```typescript
  it('accepte et persiste date_expiration si fourni', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 8 })
    setupNf525(db)

    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Annulation prise en charge #TKT-2026-00017',
      lignes: [LIGNE_AVOIR_INPUT], date_expiration: '2026-09-16T00:00:00.000Z',
    }

    await createAvoir(db, 10, input)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_AVOIR)
    expect(insertCall!.params).toContain('2026-09-16T00:00:00.000Z')
  })

  it('date_expiration reste null si non fourni (comportement existant inchangé)', async () => {
    db.__setResponse(SQL_GET_FACTURE_AVOIR, { ...FACTURE_LOCKED, boutique_id: 1, client_id: 3 })
    db.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
      prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
      prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
    })
    db.__setResponse(SQL_NEXT_AVOIR_COUNT, { cnt: 0 })
    db.__setResponse(SQL_INSERT_AVOIR, { id: 9 })
    setupNf525(db)

    const input: CreateAvoirInput = {
      facture_id: 20, motif: 'Pièce défectueuse', lignes: [LIGNE_AVOIR_INPUT],
    }

    await createAvoir(db, 10, input)

    const calls = db.__getCalls()
    const insertCall = calls.find(c => c.sql === SQL_INSERT_AVOIR)
    expect(insertCall!.params).toContain(null)
  })
```

Note : si `SQL_NEXT_AVOIR_COUNT` n'est pas défini dans ce fichier de test (vérifier avec `grep -n "SQL_NEXT_AVOIR_COUNT" tests/factureService.test.ts`), retirer la ligne `db.__setResponse(SQL_NEXT_AVOIR_COUNT, ...)` des deux tests ci-dessus — ce n'est pas une requête réellement exécutée par `nextNumero()` (voir `lib/db.ts:40-92`), seuls `SQL_NEXT_NUMERO_SETTINGS` et la réponse `dernier_num` (déjà couverte par le mock existant du describe block, si présente) sont nécessaires.

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run tests/factureService.test.ts -t "date_expiration"`
Expected: FAIL — `insertCall!.params` ne contient pas `'2026-09-16T00:00:00.000Z'` (la colonne n'est pas encore dans l'INSERT).

- [ ] **Step 3: Modifier `CreateAvoirInput` et l'INSERT**

Dans `src/services/factureService.ts`, modifier l'interface (ligne ~41-47) :

```typescript
export interface CreateAvoirInput {
  facture_id:      number
  type?:           TypeAvoir
  motif:           string
  lignes:          LigneInput[]
  notes?:          string
  date_expiration?: string
}
```

Puis dans `createAvoir()`, remplacer le bloc INSERT (autour de la ligne 383) :

```typescript
  // Insérer l'avoir
  const result = await db.prepare(`
    INSERT INTO avoirs
      (boutique_id, numero, facture_id, client_id, type, motif,
       total_ht, total_tva, total_ttc, notes, date_expiration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId, numero, input.facture_id, facture.client_id,
    type, input.motif,
    total_ht, total_tva, total_ttc,
    input.notes ?? null,
    input.date_expiration ?? null,
  ).first<{ id: number }>()
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx vitest run tests/factureService.test.ts`
Expected: PASS — tous les tests de `createAvoir()` verts, y compris les 2 nouveaux.

- [ ] **Step 5: Lancer la suite complète**

Run: `npx vitest run`
Expected: `814/816`, mêmes 2 échecs pré-existants sans lien.

- [ ] **Step 6: Commit**

```bash
git add src/services/factureService.ts tests/factureService.test.ts
git commit -m "feat(avoirs): createAvoir() accepte date_expiration optionnel"
```

---

### Task 4: Exposer la facture d'acompte liée sur `getTicketById()` et `getDevis()`

**Files:**
- Modify: `src/services/ticketService.ts:369-393` (`getTicketById()`)
- Modify: `src/services/devisService.ts:191-220` (`getDevis()`)
- Test: `tests/ticketService.test.ts`, `tests/devisService.test.ts`

**Interfaces:**
- Consumes: rien de nouveau (extension de requêtes SQL existantes).
- Produces: `getTicketById()` et `getDevis()` retournent désormais `facture_acompte_id: number | null` et `facture_acompte_statut: 'acompte' | null` (présence = un acompte existe) ainsi que `facture_acompte_numero: string | null` et `facture_acompte_montant: number | null` — consommés par les Tasks 5, 6, 7, 8 (l'UI a besoin du numéro et du montant pour l'affichage et la confirmation d'annulation).

- [ ] **Step 1: Écrire le test `ticketService.test.ts` (échoue)**

Dans `tests/ticketService.test.ts`, modifier la constante `SQL_TICKET` du bloc `describe('getTicketById()', ...)` (chercher la ligne exacte, elle a déjà été étendue une fois aujourd'hui pour `devis_id`/`devis_statut`) :

```typescript
  const SQL_TICKET = `SELECT t.*, c.prenom || ' ' || c.nom AS client_nom, c.email AS client_email, c.telephone AS client_telephone, u.prenom || ' ' || u.nom AS technicien_nom, d.id AS devis_id, d.statut AS devis_statut, fa.id AS facture_acompte_id, fa.numero AS facture_acompte_numero, fa.total_ttc AS facture_acompte_montant FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id LEFT JOIN devis d ON d.id = ( SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1 ) LEFT JOIN factures fa ON fa.type_facture = 'acompte' AND (fa.ticket_id = t.id OR fa.devis_id = d.id) WHERE t.id = ? AND t.actif = 1`
```

Ajouter un nouveau test dans `describe('getTicketById()', ...)`, après le test existant `'retourne ticket avec historique et photos'` :

```typescript
  it('expose facture_acompte_* quand un acompte existe', async () => {
    db.__setResponse(SQL_TICKET, {
      ...TICKET_WITH_CLIENT,
      facture_acompte_id: 7, facture_acompte_numero: 'FAC-2026-00007', facture_acompte_montant: 120,
    })
    db.__setListResponse(SQL_HISTO, [])
    db.__setListResponse(SQL_PHOTOS, [])

    const res = await getTicketById(db, 42)

    expect(res.facture_acompte_id).toBe(7)
    expect(res.facture_acompte_numero).toBe('FAC-2026-00007')
    expect(res.facture_acompte_montant).toBe(120)
  })
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run tests/ticketService.test.ts -t "facture_acompte"`
Expected: FAIL — aucune réponse enregistrée ne correspond au SQL réellement exécuté par `getTicketById()` (la requête réelle ne contient pas encore la jointure `factures`).

- [ ] **Step 3: Modifier `getTicketById()`**

Dans `src/services/ticketService.ts`, remplacer la requête (lignes ~377-391, celle qui contient déjà le commentaire `devis_id/devis_statut`) :

```typescript
  // devis_id/devis_statut : devis le plus récent lié à ce ticket (feature "Accord",
  // suivi.html dérive l'état gris/orange/vert de l'étape attente_accord de ce champ,
  // pas seulement du statut ticket). Un ticket peut avoir plusieurs devis dans le
  // temps (ex. refusé puis revu) — on ne considère que le dernier.
  // facture_acompte_* : facture type_facture='acompte' liée directement au ticket
  // OU à son devis le plus récent (un acompte peut avoir été demandé à l'un ou
  // l'autre moment, voir docs/superpowers/specs/2026-07-16-acompte-structure-design.md).
  const ticket = await db.get<any>(`
    SELECT t.*,
           c.prenom || ' ' || c.nom   AS client_nom,
           c.email                    AS client_email,
           c.telephone                AS client_telephone,
           u.prenom || ' ' || u.nom   AS technicien_nom,
           d.id                       AS devis_id,
           d.statut                   AS devis_statut,
           fa.id                      AS facture_acompte_id,
           fa.numero                  AS facture_acompte_numero,
           fa.total_ttc               AS facture_acompte_montant
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = t.technicien_id
    LEFT JOIN devis d ON d.id = (
      SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN factures fa ON fa.type_facture = 'acompte' AND (fa.ticket_id = t.id OR fa.devis_id = d.id)
    WHERE  t.id = ? AND t.actif = 1
  `, [id])
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npx vitest run tests/ticketService.test.ts`
Expected: PASS — tous les tests de `getTicketById()` verts.

- [ ] **Step 5: Écrire le test `devisService.test.ts` (échoue)**

Dans `tests/devisService.test.ts`, modifier la constante `SQL_GET_DEVIS` :

```typescript
const SQL_GET_DEVIS = n(`
  SELECT d.*,
         c.nom       AS client_nom,
         c.prenom    AS client_prenom,
         c.email     AS client_email,
         c.telephone AS client_telephone,
         c.adresse   AS client_adresse,
         b.nom       AS boutique_nom,
         b.siret     AS boutique_siret,
         b.adresse   AS boutique_adresse,
         b.telephone AS boutique_telephone,
         b.email     AS boutique_email,
         b.tva_numero AS boutique_tva,
         fa.id        AS facture_acompte_id,
         fa.numero    AS facture_acompte_numero,
         fa.total_ttc AS facture_acompte_montant
  FROM   devis d
  LEFT   JOIN clients   c ON c.id = d.client_id
  LEFT   JOIN boutiques b ON b.id = d.boutique_id
  LEFT   JOIN factures  fa ON fa.type_facture = 'acompte' AND (fa.devis_id = d.id OR fa.ticket_id = d.ticket_id)
  WHERE  d.id = ?
`)
```

Ajouter un test dans `describe('getDevis()', ...)`, après le test existant `'retourne le devis enrichi avec lignes'` :

```typescript
    it('expose facture_acompte_* quand un acompte existe', async () => {
      db.__setResponse(SQL_GET_DEVIS, {
        ...DEVIS_ENRICHI,
        facture_acompte_id: 7, facture_acompte_numero: 'FAC-2026-00007', facture_acompte_montant: 120,
      })
      db.__setListResponse(SQL_GET_LIGNES, [])

      const result = await getDevis(db as any, 10)

      expect(result.facture_acompte_id).toBe(7)
      expect(result.facture_acompte_numero).toBe('FAC-2026-00007')
    })
```

- [ ] **Step 6: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run tests/devisService.test.ts -t "facture_acompte"`
Expected: FAIL.

- [ ] **Step 7: Modifier `getDevis()`**

Dans `src/services/devisService.ts`, remplacer la requête (lignes ~193-216) :

```typescript
export async function getDevis(db: Database, id: number): Promise<any | null> {
  const [devis, lignes] = await Promise.all([
    db.get<any>(`
      SELECT d.*,
             c.nom       AS client_nom,
             c.prenom    AS client_prenom,
             c.email     AS client_email,
             c.telephone AS client_telephone,
             c.adresse   AS client_adresse,
             b.nom       AS boutique_nom,
             b.siret     AS boutique_siret,
             b.adresse   AS boutique_adresse,
             b.telephone AS boutique_telephone,
             b.email     AS boutique_email,
             b.tva_numero AS boutique_tva,
             fa.id        AS facture_acompte_id,
             fa.numero    AS facture_acompte_numero,
             fa.total_ttc AS facture_acompte_montant
      FROM   devis d
      LEFT   JOIN clients   c ON c.id = d.client_id
      LEFT   JOIN boutiques b ON b.id = d.boutique_id
      LEFT   JOIN factures  fa ON fa.type_facture = 'acompte' AND (fa.devis_id = d.id OR fa.ticket_id = d.ticket_id)
      WHERE  d.id = ?
    `, [id]),

    db.all<any>(`
      SELECT * FROM lignes_document
      WHERE  document_type = 'devis' AND document_id = ?
      ORDER  BY ordre ASC
    `, [id]),
```

(le reste de la fonction, à partir de `])` inclus, ne change pas — vérifier avec `grep -n "export async function getDevis\b" -A 30 src/services/devisService.ts` avant d'éditer pour retrouver la fin exacte du bloc `Promise.all`.)

- [ ] **Step 8: Lancer les tests, vérifier qu'ils passent**

Run: `npx vitest run`
Expected: `816/818`, mêmes 2 échecs pré-existants sans lien.

- [ ] **Step 9: Commit**

```bash
git add src/services/ticketService.ts src/services/devisService.ts tests/ticketService.test.ts tests/devisService.test.ts
git commit -m "feat(tickets,devis): exposer la facture d'acompte liée (getTicketById/getDevis)"
```

---

### Task 5: Route `POST /api/tickets/:id/acompte`

**Files:**
- Modify: `src/routes/tickets.ts` (nouvelle section `ACOMPTE`, juste avant `export default tickets` en fin de fichier)

**Interfaces:**
- Consumes: `createFactureAcompte()` (Task 2, importer depuis `../services/factureService`), `getTicketById()` (déjà importé dans ce fichier, étendu Task 4).
- Produces: `POST /api/tickets/:id/acompte` — body `{ montant_ht: number, tva_taux: number, mode_paiement: string, reference?: string }` → `{ success, facture_id, facture_numero, message }` — consommé par la Task 8 (frontend `tickets.js`).

- [ ] **Step 1: Ajouter l'import**

Dans `src/routes/tickets.ts`, sur la ligne d'import de `photosService`/autres services (chercher `import { ... } from '../services/photosService'` ou équivalent en haut du fichier), ajouter une nouvelle ligne d'import juste après les imports de services existants :

```typescript
import { createFactureAcompte } from '../services/factureService'
```

- [ ] **Step 2: Ajouter la route**

Dans `src/routes/tickets.ts`, juste avant `export default tickets` (fin de fichier), insérer :

```typescript
// ══════════════════════════════════════════════════════════════════════════════
// ACOMPTE (sous-projet A — encaissement manuel)
// ══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/tickets/:id/acompte ────────────────────────────────────────────
/**
 * POST /api/tickets/:id/acompte
 * Facture un acompte pour ce ticket — voir
 * docs/superpowers/specs/2026-07-16-acompte-structure-design.md.
 * Réservé admin/manager (gestion financière, cohérent avec le reste de la
 * facturation dans ce projet — pas technicien, contrairement à l'override
 * "Accord" qui est volontairement plus large).
 *
 * @param id  — ID du ticket
 * @body { montant_ht, tva_taux, mode_paiement, reference? }
 * @returns 201 { success, facture_id, facture_numero, message }
 * @returns 409 si un acompte existe déjà pour ce ticket
 */
tickets.post('/:id/acompte', requireRole('admin', 'manager'), async (c) => {
  const { user, db, dbPort } = ctx(c)
  const ticketId = parseInt(c.req.param('id'), 10)

  const ticket = await getTicketById(dbPort, ticketId)
  if (!ticket) return c.json({ success: false, error: 'Ticket introuvable.' }, 404)
  if (user.role !== 'admin' && ticket.boutique_id !== user.boutique_id) {
    return c.json({ success: false, error: 'Accès refusé.' }, 403)
  }

  const { montant_ht, tva_taux, mode_paiement, reference } = await c.req.json().catch(() => ({}))
  if (!montant_ht || montant_ht <= 0)
    return c.json({ success: false, error: 'montant_ht doit être positif.' }, 400)
  if (!mode_paiement)
    return c.json({ success: false, error: 'mode_paiement obligatoire.' }, 400)

  try {
    const result = await createFactureAcompte(db, user.sub, {
      boutique_id: ticket.boutique_id,
      client_id:   ticket.client_id,
      ticket_id:   ticketId,
      devis_id:    ticket.devis_id ?? null,
      montant_ht,
      tva_taux:    tva_taux ?? 20,
      mode_paiement,
      reference,
    })
    return c.json({ success: true, ...result, message: 'Acompte facturé.' }, 201)
  } catch (err: any) {
    const status = err.message.includes('déjà été facturé') ? 409 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

export default tickets
```

Puis supprimer l'ancien `export default tickets` qui existait en toute fin de fichier (il ne doit y en avoir qu'un seul — vérifier avec `grep -n "export default tickets" src/routes/tickets.ts`, qui doit retourner exactement une ligne après cette modification).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "tickets.ts"`
Expected: aucune sortie (pas de nouvelle erreur — comparer avec `git stash && npx tsc --noEmit 2>&1 | grep -i "tickets.ts" ; git stash pop` si une erreur apparaît, pour confirmer qu'elle est pré-existante).

- [ ] **Step 4: Lancer la suite de tests**

Run: `npx vitest run`
Expected: toujours `816/818` (cette tâche n'ajoute pas de nouveau test unitaire — pas de test-route dans ce projet, validation en local live à l'étape suivante).

- [ ] **Step 5: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Dans un autre terminal, se connecter avec un compte manager réel (ou un compte de test créé via `wrangler d1 execute ... --local` avec le même schéma de hash PBKDF2 que documenté dans `bugs.md`), récupérer un `ticketId` existant en boutique 1, puis :

```bash
curl -s -X POST http://127.0.0.1:8788/api/tickets/<ticketId>/acompte \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"montant_ht":100,"tva_taux":20,"mode_paiement":"especes"}'
```

Expected: `{"success":true,"facture_id":...,"facture_numero":"FAC-2026-...","message":"Acompte facturé."}`. Rejouer le même appel une seconde fois : `{"success":false,"error":"Un acompte a déjà été facturé pour ce dossier."}` (409). Vérifier en base que la facture est bien verrouillée : `npx wrangler d1 execute izigsm-production --local --command "SELECT numero, type_facture, locked, statut, montant_paye FROM factures WHERE id = <facture_id>"` — attendu `locked=1`, `statut='payee'`, `montant_paye=120`.

Nettoyer les données de test créées (`DELETE FROM factures WHERE id = <facture_id>`, `DELETE FROM lignes_document WHERE document_type='facture' AND document_id=<facture_id>`, `DELETE FROM paiements WHERE facture_id=<facture_id>`, `DELETE FROM journal_nf525 WHERE reference_id=<facture_id> AND type_transaction='facture'`).

- [ ] **Step 6: Commit**

```bash
git add src/routes/tickets.ts
git commit -m "feat(tickets): route POST /api/tickets/:id/acompte"
```

---

### Task 6: Route `POST /api/devis/:id/acompte`

**Files:**
- Modify: `src/routes/facturation.ts` (nouvelle route, à ajouter juste après le bloc `PUT /devis/:id/convertir` existant)

**Interfaces:**
- Consumes: `createFactureAcompte()` (Task 2, ajouter à l'import existant de `factureService` dans ce fichier), `getDevis()` (déjà importé dans ce fichier, étendu Task 4).
- Produces: `POST /api/devis/:id/acompte` — même contrat body/réponse que la Task 5 — consommé par la Task 8 (frontend `devis.js`).

- [ ] **Step 1: Étendre l'import `factureService`**

Dans `src/routes/facturation.ts`, modifier l'import existant (ligne ~15-18) :

```typescript
import {
  listFactures, getFacture, ajouterPaiement, emettreFacture,
  listAvoirs, getAvoir, createAvoir, createFactureAcompte,
  getDevisPourNf525, updateFactureHash,
} from '../services/factureService'
```

- [ ] **Step 2: Ajouter la route**

Dans `src/routes/facturation.ts`, juste après le bloc `facturation.put('/devis/:id/convertir', ...)` (repérer sa fin avec `grep -n "facturation.put('/devis/:id/convertir'" -A 25 src/routes/facturation.ts` pour trouver l'accolade fermante exacte), insérer :

```typescript
/**
 * POST /api/devis/:id/acompte
 * Facture un acompte pour ce devis — voir
 * docs/superpowers/specs/2026-07-16-acompte-structure-design.md.
 * Réservé admin/manager. Même contrat que POST /api/tickets/:id/acompte.
 *
 * @param id  — ID du devis
 * @body { montant_ht, tva_taux, mode_paiement, reference? }
 * @returns 201 { success, facture_id, facture_numero, message }
 * @returns 409 si un acompte existe déjà pour ce devis
 */
facturation.post('/devis/:id/acompte', requireRole('admin', 'manager'), async (c) => {
  const user    = c.get('user')
  const devisId = parseInt(c.req.param('id'), 10)

  const devis = await getDevis(c.get('db'), devisId)
  if (!devis) return c.json({ success: false, error: 'Devis introuvable.' }, 404)
  if (user.role !== 'admin' && devis.boutique_id !== user.boutique_id) {
    return c.json({ success: false, error: 'Accès refusé.' }, 403)
  }

  const { montant_ht, tva_taux, mode_paiement, reference } = await c.req.json().catch(() => ({}))
  if (!montant_ht || montant_ht <= 0)
    return c.json({ success: false, error: 'montant_ht doit être positif.' }, 400)
  if (!mode_paiement)
    return c.json({ success: false, error: 'mode_paiement obligatoire.' }, 400)

  try {
    const result = await createFactureAcompte(c.env.DB, user.sub, {
      boutique_id: devis.boutique_id,
      client_id:   devis.client_id,
      ticket_id:   devis.ticket_id ?? null,
      devis_id:    devisId,
      montant_ht,
      tva_taux:    tva_taux ?? 20,
      mode_paiement,
      reference,
    })
    return c.json({ success: true, ...result, message: 'Acompte facturé.' }, 201)
  } catch (err: any) {
    const status = err.message.includes('déjà été facturé') ? 409 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "facturation.ts"`
Expected: seule l'erreur pré-existante `Type '"devis"' is not assignable to type 'EmailType'` (déjà confirmée pré-existante lors des checkpoints précédents), aucune nouvelle erreur.

- [ ] **Step 4: Valider en local live**

Même procédure que Task 5 Step 5, avec `POST /api/devis/<devisId>/acompte` sur un devis existant en boutique 1. Nettoyer les mêmes tables après coup.

- [ ] **Step 5: Commit**

```bash
git add src/routes/facturation.ts
git commit -m "feat(devis): route POST /api/devis/:id/acompte"
```

---

### Task 7: `devisService.ts` — déduire l'acompte à la conversion en facture finale

**Files:**
- Modify: `src/services/devisService.ts:392-442` (`convertirDevis()`)
- Test: `tests/devisService.test.ts`

**Interfaces:**
- Consumes: aucune fonction des tâches précédentes — lit directement la table `factures` (`type_facture='acompte'`) créée par la Task 1/2.
- Produces: aucune nouvelle fonction exportée — modifie le comportement de `convertirDevis()` (déjà exportée) : si un acompte existe pour le devis ou son ticket, la facture finale créée a un `total_ht`/`total_tva`/`total_ttc` réduit du montant de l'acompte, avec une ligne négative explicative dans ses lignes.

- [ ] **Step 1: Écrire le test (échoue)**

Dans `tests/devisService.test.ts`, dans `describe('convertirDevis()', ...)`, repérer les constantes `SQL_SELECT_DEVIS_BY_ID`, `SQL_NEXT_NUMERO_SETTINGS`, `SQL_INSERT_FACTURE` (déjà utilisées par les tests existants de `convertirDevis()`) et ajouter :

```typescript
    const SQL_CHECK_ACOMPTE_CONVERSION = n(`
      SELECT id, numero, total_ht, total_tva, total_ttc FROM factures
      WHERE type_facture = 'acompte' AND (devis_id = ? OR ticket_id = ?)
    `)
    const SQL_MAX_ORDRE_LIGNES = n(`
      SELECT COALESCE(MAX(ordre), 0) as maxOrdre FROM lignes_document WHERE document_type = 'facture' AND document_id = ?
    `)
    const SQL_UPDATE_TOTAUX_FACTURE = n(`UPDATE factures SET total_ht = ?, total_tva = ?, total_ttc = ? WHERE id = ?`)

    it('sans acompte : total facture = total devis (comportement inchangé)', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, {
        ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null,
        client_id: 3, ticket_id: null, total_ht: 100, total_tva: 20, total_ttc: 120,
      })
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 30 })
      dbD1.__setNotFound(SQL_CHECK_ACOMPTE_CONVERSION)

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      expect(calls.find(c => c.sql === SQL_UPDATE_TOTAUX_FACTURE)).toBeUndefined()
    })

    it('avec acompte : ajoute une ligne négative et réduit les totaux de la facture', async () => {
      dbD1.__setResponse(SQL_SELECT_DEVIS_BY_ID, {
        ...DEVIS_ROW, statut: 'envoye', boutique_id: 1, facture_id: null,
        client_id: 3, ticket_id: 42, total_ht: 100, total_tva: 20, total_ttc: 120,
      })
      dbD1.__setResponse(SQL_NEXT_NUMERO_SETTINGS, {
        prefix_ticket: 'TKT', prefix_facture: 'FAC', prefix_devis: 'DEV',
        prefix_avoir: 'AV', prefix_rachat: 'LP', format_numero: 'annee', padding_numero: 5,
      })
      dbD1.__setResponse(SQL_INSERT_FACTURE, { id: 31 })
      dbD1.__setResponse(SQL_CHECK_ACOMPTE_CONVERSION, {
        id: 7, numero: 'FAC-2026-00007', total_ht: 41.67, total_tva: 8.33, total_ttc: 50,
      })
      dbD1.__setResponse(SQL_MAX_ORDRE_LIGNES, { maxOrdre: 2 })

      await convertirDevis(dbD1 as any, 10, 10)

      const calls = dbD1.__getCalls()
      const updateCall = calls.find(c => c.sql === SQL_UPDATE_TOTAUX_FACTURE)
      expect(updateCall).toBeDefined()
      expect(updateCall!.params[0]).toBeCloseTo(58.33) // 100 - 41.67
      expect(updateCall!.params[1]).toBeCloseTo(11.67) // 20 - 8.33
      expect(updateCall!.params[2]).toBeCloseTo(70)    // 120 - 50

      const ligneCall = calls.find(c =>
        c.sql.includes('INSERT INTO lignes_document') && c.params.includes('Acompte déjà facturé (FAC-2026-00007)')
      )
      expect(ligneCall).toBeDefined()
      expect(ligneCall!.params).toContain(3) // ordre = maxOrdre(2) + 1
    })
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run tests/devisService.test.ts -t "acompte"`
Expected: FAIL — `convertirDevis()` n'exécute encore aucune des requêtes attendues (`SQL_CHECK_ACOMPTE_CONVERSION` jamais appelée).

- [ ] **Step 3: Modifier `convertirDevis()`**

Dans `src/services/devisService.ts`, repérer la fin du bloc de copie des lignes (`// Copier les lignes devis → facture`, se terminant par `.bind(facture.id, id).run()`) et insérer juste après, AVANT le bloc `// Marquer le devis accepté + lié à la facture` :

```typescript
  // Déduction acompte structuré (2026-07-16) : si une facture d'acompte a été
  // émise pour ce devis ou son ticket, ajouter une ligne négative et réduire les
  // totaux de la facture finale d'autant — la facture finale ne demande alors que
  // le solde restant, voir docs/superpowers/specs/2026-07-16-acompte-structure-design.md.
  const acompte = await db.prepare(`
    SELECT id, numero, total_ht, total_tva, total_ttc FROM factures
    WHERE type_facture = 'acompte' AND (devis_id = ? OR ticket_id = ?)
  `).bind(id, devis.ticket_id ?? 0).first<{
    id: number; numero: string; total_ht: number; total_tva: number; total_ttc: number
  }>()

  if (acompte) {
    const maxOrdre = await db.prepare(`
      SELECT COALESCE(MAX(ordre), 0) as maxOrdre FROM lignes_document WHERE document_type = 'facture' AND document_id = ?
    `).bind(facture.id).first<{ maxOrdre: number }>()

    const tvaTauxAffiche = acompte.total_ht > 0
      ? Math.round((acompte.total_tva / acompte.total_ht) * 10000) / 100
      : 20

    await db.prepare(`
      INSERT INTO lignes_document
        (document_type, document_id, ordre, description, quantite,
         prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
      VALUES ('facture', ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)
    `).bind(
      facture.id, (maxOrdre?.maxOrdre ?? 0) + 1,
      `Acompte déjà facturé (${acompte.numero})`,
      -acompte.total_ht, tvaTauxAffiche,
      -acompte.total_ht, -acompte.total_tva, -acompte.total_ttc,
    ).run()

    const totalHt  = Math.round((devis.total_ht  - acompte.total_ht)  * 100) / 100
    const totalTva = Math.round((devis.total_tva - acompte.total_tva) * 100) / 100
    const totalTtc = Math.round((devis.total_ttc - acompte.total_ttc) * 100) / 100

    await db.prepare(`
      UPDATE factures SET total_ht = ?, total_tva = ?, total_ttc = ? WHERE id = ?
    `).bind(totalHt, totalTva, totalTtc, facture.id).run()
  }
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx vitest run tests/devisService.test.ts`
Expected: PASS — tous les tests de `convertirDevis()` verts, y compris les 2 nouveaux.

- [ ] **Step 5: Lancer la suite complète**

Run: `npx vitest run`
Expected: `818/820` (2 nouveaux tests dans cette tâche, 816 existants après Task 4, mêmes 2 échecs pré-existants sans lien).

- [ ] **Step 6: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Créer un devis de test lié à un ticket, facturer un acompte dessus via `POST /api/devis/:id/acompte` (Task 6), puis convertir le devis en facture via `PUT /api/devis/:id/convertir`. Vérifier en base :

```bash
npx wrangler d1 execute izigsm-production --local --command "SELECT total_ht, total_tva, total_ttc FROM factures WHERE id = <facture_finale_id>"
```

Expected : les totaux sont réduits du montant de l'acompte. Vérifier aussi la ligne négative :

```bash
npx wrangler d1 execute izigsm-production --local --command "SELECT description, total_ttc FROM lignes_document WHERE document_type='facture' AND document_id = <facture_finale_id> ORDER BY ordre"
```

Expected : une ligne `"Acompte déjà facturé (FAC-...)"` avec un `total_ttc` négatif. Nettoyer les données de test après coup.

- [ ] **Step 7: Commit**

```bash
git add src/services/devisService.ts tests/devisService.test.ts
git commit -m "feat(devis): convertirDevis() déduit l'acompte déjà facturé de la facture finale"
```

---

### Task 8: Frontend `tickets.js` — bouton acompte + affichage + annulation avec avoir

**Files:**
- Modify: `public/static/js/tickets.js` (fonction `viewTicket()`, nouveau bloc `detail-acompte` sur le modèle du bloc `detail-accord` du checkpoint 25 ; fonction `changeStatus()` existante, à localiser avec `grep -n "^async function changeStatus" public/static/js/tickets.js`)

**Interfaces:**
- Consumes: `POST /api/tickets/:id/acompte` (Task 5), `POST /api/factures/:id/avoir` (déjà existant, vérifier le chemin exact avec `grep -n "avoir" src/routes/facturation.ts | grep post`).
- Produces: rien consommé par une tâche suivante (dernier maillon UI côté staff pour les tickets).

- [ ] **Step 1: Localiser le point d'insertion du bloc d'affichage**

Run: `grep -n "detail-accord" public/static/js/tickets.js`
Expected: deux occurrences — la ligne HTML `<div id="detail-accord"></div>` dans le template de `viewTicket()`, et l'appel `renderAccordDetail(t)` dans la promesse `apiGet('/api/tickets/' + id).then(...)`.

- [ ] **Step 2: Ajouter le placeholder HTML**

Dans `public/static/js/tickets.js`, fonction `viewTicket()`, juste après la ligne `<div id="detail-accord"></div>` (repérée à l'étape précédente), ajouter :

```javascript
    <div id="detail-acompte"></div>
```

- [ ] **Step 3: Appeler le rendu depuis le fetch existant**

Toujours dans `viewTicket()`, repérer le bloc :

```javascript
  if (ticketsUseApi) {
    apiGet('/api/tickets/' + id)
      .then(result => {
        if (!result.ok) return;
        const t = result.data?.data || result.data;
        renderEtatSecuriteDetail(t);
        renderAccordDetail(t);
      })
      .catch(() => {});
  }
```

Le modifier pour ajouter l'appel :

```javascript
  if (ticketsUseApi) {
    apiGet('/api/tickets/' + id)
      .then(result => {
        if (!result.ok) return;
        const t = result.data?.data || result.data;
        renderEtatSecuriteDetail(t);
        renderAccordDetail(t);
        renderAcompteDetail(t, 'ticket');
      })
      .catch(() => {});
  }
```

- [ ] **Step 4: Écrire `renderAcompteDetail()` et `demanderAcompte()`**

Ajouter dans `public/static/js/tickets.js`, juste après la fonction `renderAccordDetail()` existante (repérer sa fin avec `grep -n "^function renderAccordDetail" -A 30 public/static/js/tickets.js`) :

```javascript
/**
 * Affiche le statut de l'acompte (facture d'acompte liée) dans la fiche détail,
 * avec un bouton de demande si aucun acompte n'existe encore — feature acompte
 * structuré (sous-projet A, voir docs/superpowers/specs/2026-07-16-acompte-structure-design.md).
 * @param t          Détail complet du ticket (ou devis) renvoyé par l'API
 * @param contextType 'ticket' ou 'devis' — détermine l'endpoint appelé
 */
function renderAcompteDetail(t, contextType) {
  const el = document.getElementById('detail-acompte');
  if (!el || !t) return;

  const entityId = t.id;

  if (!t.facture_acompte_id) {
    el.innerHTML = `
      <div style="margin-top:16px;">
        <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Acompte</label>
        <button class="btn btn-sm btn-ghost" onclick="demanderAcompte(${entityId}, '${contextType}')">
          💰 Demander un acompte
        </button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-top:16px;">
      <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Acompte</label>
      <span class="status-badge status-done">
        💰 Acompte facturé : ${formatMoney(t.facture_acompte_montant)} (${esc(t.facture_acompte_numero)})
      </span>
    </div>`;
}

/**
 * Ouvre un mini-formulaire (prompt) pour demander un acompte — montant HT libre,
 * TVA par défaut 20%, mode de paiement. POST /api/tickets/:id/acompte ou
 * /api/devis/:id/acompte selon contextType.
 */
async function demanderAcompte(entityId, contextType) {
  const montantStr = prompt('Montant HT de l\'acompte (€) :');
  if (!montantStr) return;
  const montant_ht = parseFloat(montantStr.replace(',', '.'));
  if (!montant_ht || montant_ht <= 0) {
    showToast('❌ Montant invalide.', 'error');
    return;
  }
  const modePaiement = prompt('Mode de paiement (especes, cb, cheque, virement) :', 'especes');
  if (!modePaiement) return;

  const endpoint = contextType === 'devis'
    ? `/api/devis/${entityId}/acompte`
    : `/api/tickets/${entityId}/acompte`;

  try {
    const r = await apiPost(endpoint, { montant_ht, tva_taux: 20, mode_paiement: modePaiement });
    if (r.data?.success) {
      showToast(`✅ Acompte facturé : ${r.data.facture_numero}`);
      if (contextType === 'ticket' && window._currentTicketId) viewTicket(window._currentTicketId);
    } else {
      showToast('❌ ' + (r.error || r.data?.error || 'Échec de la facturation.'), 'error');
    }
  } catch (e) {
    showToast('❌ Erreur réseau.', 'error');
  }
}
```

**Note pour l'implémenteur** : `prompt()` est un choix volontairement minimal pour ce MVP (le spec ne demande pas de formulaire dédié). Si l'application a déjà un pattern de mini-modal standard ailleurs pour ce genre de saisie courte, l'utiliser à la place de `prompt()` pour la cohérence visuelle — vérifier `grep -n "function openQuickModal\|function promptModal" public/static/js/*.js` avant d'implémenter ; si rien de tel n'existe, `prompt()` reste le choix par défaut.

- [ ] **Step 5: Hook sur l'annulation — confirmation avec avoir si acompte existe**

Localiser la fonction `changeStatus()` :

Run: `grep -n "^async function changeStatus" -A 15 public/static/js/tickets.js`

Elle ressemble probablement à un appel direct `PUT /api/tickets/:id/statut`. Insérer une vérification AVANT l'appel API, uniquement pour le cas `statut === 'annule'` avec un acompte facturé. Remplacer l'implémentation existante par :

```javascript
async function changeStatus(id, statut) {
  if (statut === 'annule') {
    const ticket = allTicketsCache.find(t => t.id === id);
    // facture_acompte_id n'est pas dans le cache liste (allTicketsCache) — recharger
    // le détail complet pour savoir s'il y a un acompte avant de confirmer.
    let factureAcompte = null;
    try {
      const r = await apiGet('/api/tickets/' + id);
      if (r.ok) factureAcompte = (r.data?.data || r.data)?.facture_acompte_id ? (r.data?.data || r.data) : null;
    } catch (_) { /* si le fetch échoue, on retombe sur la confirmation générique ci-dessous */ }

    if (factureAcompte) {
      const montant = factureAcompte.facture_acompte_montant;
      const confirmMsg = `Ce ticket a un acompte facturé de ${montant}€ — annuler générera un avoir de ${montant}€ valable 2 mois.`;
      if (!confirm(confirmMsg)) return;

      try {
        const rAvoir = await apiPost(`/api/factures/${factureAcompte.facture_acompte_id}/avoir`, {
          motif: `Annulation de la prise en charge #${id}`,
          lignes: [{ description: 'Acompte annulé', quantite: 1, prix_unitaire_ht: montant / 1.2, tva_taux: 20 }],
          date_expiration: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (!rAvoir.data?.success) {
          showToast('❌ Échec de la création de l\'avoir : ' + (rAvoir.error || rAvoir.data?.error), 'error');
          return;
        }
      } catch (e) {
        showToast('❌ Erreur réseau lors de la création de l\'avoir.', 'error');
        return;
      }
    } else {
      if (!confirm('Annuler cette prise en charge ?')) return;
    }
  }

  try {
    const r = await apiPut(`/api/tickets/${id}/statut`, { statut });
    if (r.data?.success) {
      showToast('✅ Statut mis à jour.');
      if (window._currentTicketId === id) viewTicket(id);
      if (typeof loadTickets === 'function') loadTickets();
    } else {
      showToast('❌ ' + (r.error || r.data?.error || 'Échec.'), 'error');
    }
  } catch (e) {
    showToast('❌ Erreur réseau.', 'error');
  }
}
```

**Avertissement pour l'implémenteur** : cette étape REMPLACE la fonction `changeStatus()` existante. Avant de coller ce code, lire l'implémentation actuelle en entier (`grep -n "^async function changeStatus" -A 20 public/static/js/tickets.js`) et adapter le bloc final (l'appel `PUT /api/tickets/${id}/statut` + gestion du résultat) pour qu'il corresponde exactement au comportement déjà en place (noms de fonctions de rafraîchissement de liste, format des messages de toast) — ne pas perdre de comportement existant en copiant ce squelette tel quel. Le calcul `montant / 1.2` suppose une TVA à 20% sur l'acompte ; si le taux réel de l'acompte diffère, `t.facture_acompte_montant` est un TTC et il faudrait idéalement recevoir aussi le HT/taux depuis l'API plutôt que deviner — accepter cette approximation pour le MVP (documentée ici, pas cachée) ou étendre `getTicketById()`/Task 4 pour exposer `facture_acompte_ht`/`facture_acompte_tva_taux` si la précision s'avère nécessaire en test.

- [ ] **Step 6: Vérifier le endpoint avoir existant**

Run: `grep -n "post.*avoir\|/avoir'" src/routes/facturation.ts`
Expected: confirmer le chemin exact (probablement `POST /api/factures/:id/avoir`) et le nom des champs body attendus (`facture_id` est-il dans l'URL ou le body ?) — ajuster l'appel `apiPost` de l'étape 5 en conséquence si le chemin ou le contrat diffère de l'hypothèse `POST /api/factures/${factureAcompte.facture_acompte_id}/avoir`.

- [ ] **Step 7: Bump `CACHE_VERSION`**

Dans `public/sw.js`, incrémenter `CACHE_VERSION` de `izigsm-v2.57` à `izigsm-v2.58` — Task 8 est la première tâche modifiant du frontend dans ce plan, suivie par les Tasks 9/10 (frontend aussi) ; si Tasks 9/10 sont faites dans la même session, ne bumper qu'une seule fois à la toute fin (voir note dans Task 10 Step finale).

- [ ] **Step 8: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Se connecter avec un compte manager réel (créer un utilisateur de test via `wrangler d1 execute ... --local` si besoin, en suivant le même schéma de hash PBKDF2 documenté dans les checkpoints précédents de `bugs.md`), ouvrir un ticket, cliquer "💰 Demander un acompte", saisir un montant, confirmer le mode de paiement, vérifier que le badge "Acompte facturé" apparaît après rechargement de la fiche. Tenter d'annuler ce ticket depuis "Changer le statut" → "Annulé", vérifier le message de confirmation mentionne le bon montant, confirmer, vérifier en base qu'un avoir a été créé (`SELECT numero, date_expiration FROM avoirs ORDER BY id DESC LIMIT 1`) avec `date_expiration` ≈ aujourd'hui + 60 jours. Nettoyer les données de test créées (facture d'acompte, avoir, ticket si créé pour le test).

- [ ] **Step 9: Commit**

```bash
git add public/static/js/tickets.js public/sw.js
git commit -m "feat(tickets): UI acompte — demande, affichage, annulation avec avoir"
```

---

### Task 9: Frontend `devis.js` — bouton acompte + affichage

**Files:**
- Modify: `public/static/js/devis.js` (fonction `openDevisDetail()`, corrigée aujourd'hui — voir `bugs.md` § devis.js)

**Interfaces:**
- Consumes: `POST /api/devis/:id/acompte` (Task 6), `renderAcompteDetail()`/`demanderAcompte()` (Task 8, définies dans `tickets.js` mais chargées globalement — vérifier que `devis.html` inclut bien `<script src="/static/js/tickets.js">` avant `devis.js`, sinon dupliquer les deux fonctions dans `devis.js` avec le même contenu).

- [ ] **Step 1: Vérifier si `tickets.js` est chargé sur `devis.html`**

Run: `grep -n 'static/js/tickets.js\|static/js/devis.js' public/devis.html`

- [ ] **Step 2a: Si `tickets.js` N'EST PAS chargé sur `devis.html`**

Copier `renderAcompteDetail()` et `demanderAcompte()` telles qu'écrites à la Task 8 Step 4 directement dans `public/static/js/devis.js` (fin du fichier), sans modification.

- [ ] **Step 2b: Si `tickets.js` EST déjà chargé sur `devis.html`**

Aucune duplication nécessaire — passer directement à l'étape suivante.

- [ ] **Step 3: Ajouter le placeholder et l'appel dans `openDevisDetail()`**

Dans `public/static/js/devis.js`, fonction `openDevisDetail()` (corrigée aujourd'hui pour utiliser `result.data?.data`), repérer la fin du bloc `body.innerHTML = \`...\`;` (après le bloc notes, juste avant `// Boutons footer selon statut`) et ajouter un placeholder :

```javascript
      ${d.notes ? `<div style="margin-top:14px;padding:12px 14px;background:#f1f5f9;border-radius:8px;font-size:0.88rem;color:var(--text);">
        <strong>Notes :</strong> ${esc(d.notes)}
      </div>` : ''}

      <div id="detail-acompte-devis"></div>
    `;

    renderAcompteDetail(d, 'devis');
```

**Note** : `renderAcompteDetail()` cible `document.getElementById('detail-acompte')` (Task 8) — il faut soit renommer l'ID dans le HTML ci-dessus en `detail-acompte` (pas `detail-acompte-devis`) pour réutiliser exactement la même fonction sans la modifier, soit dupliquer `renderAcompteDetail()` sous un autre nom qui cible `detail-acompte-devis`. **Choix recommandé** : utiliser `detail-acompte` (le même id que Task 8) — les deux modals (`modal-ticket-detail` et `modal-devis-detail`) ne sont jamais ouverts simultanément, donc pas de collision d'id réelle dans le DOM à un instant donné. Ajuster le bloc ci-dessus en conséquence (`<div id="detail-acompte"></div>`).

- [ ] **Step 4: Typecheck / lint visuel**

Aucun test automatisé pour ce fichier (frontend JS sans suite de tests dans ce projet, cohérent avec le reste de `public/static/js/`). Passer directement à la validation en local live.

- [ ] **Step 5: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Se connecter avec un compte manager réel, ouvrir la page Devis, créer un devis de test (ou utiliser un devis existant), ouvrir sa fiche détail, cliquer "💰 Demander un acompte", vérifier le badge apparaît après confirmation. Nettoyer les données de test (devis, facture d'acompte associée) après validation.

- [ ] **Step 6: Commit**

```bash
git add public/static/js/devis.js
git commit -m "feat(devis): UI acompte — bouton demande + affichage dans la fiche détail"
```

---

### Task 10: Frontend `suivi.html` — afficher acompte versé / solde restant

**Files:**
- Modify: `src/routes/public.ts` (route `GET /ticket/:token`, déjà modifiée au checkpoint 25 pour `devis_statut`)
- Modify: `src/services/publicService.ts` (`getTicketPublicByToken()`, `TicketPublic` interface)
- Modify: `public/suivi.html` (fonction `renderTicket()`)
- Test: `tests/publicService.test.ts`

**Interfaces:**
- Consumes: `factures` table directement (nouvelle jointure dans `getTicketPublicByToken()`).
- Produces: `TicketPublic.acompte_montant: number | null` et `TicketPublic.acompte_numero: string | null`, exposés dans la réponse JSON de `GET /api/public/ticket/:token` — dernier maillon du plan, rien ne consomme cette sortie.

- [ ] **Step 1: Écrire le test (échoue)**

Dans `tests/publicService.test.ts`, modifier la constante `SQL_TICKET_TOKEN` (déjà étendue au checkpoint 25 pour `devis_statut`) :

```typescript
const SQL_TICKET_TOKEN = `SELECT t.id, t.numero, t.tracking_token, t.statut, t.appareil_marque, t.appareil_modele, t.description_panne, t.diagnostic, t.prix_estime, t.prix_final, t.date_reception, t.date_promesse, t.date_livraison, c.prenom AS client_prenom, c.nom AS client_nom, b.nom AS boutique_nom, b.telephone AS boutique_telephone, b.email AS boutique_email, b.adresse AS boutique_adresse, b.ville AS boutique_ville, b.slug AS boutique_slug, d.statut AS devis_statut, fa.total_ttc AS acompte_montant, fa.numero AS acompte_numero FROM tickets t JOIN clients c ON c.id = t.client_id JOIN boutiques b ON b.id = t.boutique_id LEFT JOIN devis d ON d.id = ( SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1 ) LEFT JOIN factures fa ON fa.type_facture = 'acompte' AND (fa.ticket_id = t.id OR fa.devis_id = d.id) WHERE t.tracking_token = ? AND t.actif = 1`
```

Mettre à jour la fixture `TICKET_PUBLIC` (ajouter les deux nouveaux champs, cohérent avec `TicketPublic` étendu à l'étape suivante) :

```typescript
const TICKET_PUBLIC: TicketPublic = {
  id: 1, numero: 'TKT-2026-00001', tracking_token: 'abc123def456abc1',
  statut: 'en_reparation', appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
  description_panne: 'Écran fissuré', diagnostic: null,
  prix_estime: 120, prix_final: null,
  date_reception: '2026-07-01T10:00:00Z', date_promesse: '2026-07-05T18:00:00Z',
  date_livraison: null,
  client_prenom: 'Alice', client_nom: 'Dupont',
  boutique_nom: 'iziGSM Paris', boutique_telephone: '0140000000',
  boutique_email: 'contact@izigsm.fr', boutique_adresse: '1 rue Test',
  boutique_ville: 'Paris', boutique_slug: 'izigsm-paris',
  devis_statut: null, acompte_montant: null, acompte_numero: null,
}
```

Ajouter un test dans `describe('getTicketPublicByToken', ...)` :

```typescript
  it('expose acompte_montant/acompte_numero quand un acompte existe', async () => {
    db.__setResponse(SQL_TICKET_TOKEN, {
      ...TICKET_PUBLIC, acompte_montant: 120, acompte_numero: 'FAC-2026-00007',
    })

    const result = await getTicketPublicByToken(db, 'abc123def456abc1')

    expect(result.acompte_montant).toBe(120)
    expect(result.acompte_numero).toBe('FAC-2026-00007')
  })
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npx vitest run tests/publicService.test.ts -t "acompte"`
Expected: FAIL.

- [ ] **Step 3: Modifier `TicketPublic` et `getTicketPublicByToken()`**

Dans `src/services/publicService.ts`, étendre l'interface :

```typescript
export interface TicketPublic {
  id:                number
  numero:            string
  tracking_token:    string
  statut:            string
  appareil_marque:   string
  appareil_modele:   string
  description_panne: string
  diagnostic:        string | null
  prix_estime:       number | null
  prix_final:        number | null
  date_reception:    string
  date_promesse:     string | null
  date_livraison:    string | null
  client_prenom:     string
  client_nom:        string
  boutique_nom:      string
  boutique_telephone:string | null
  boutique_email:    string | null
  boutique_adresse:  string | null
  boutique_ville:    string | null
  boutique_slug:     string | null
  devis_statut:      string | null
  /** Montant TTC de la facture d'acompte liée, ou null si aucun acompte. */
  acompte_montant:   number | null
  /** Numéro de la facture d'acompte liée, ou null si aucun acompte. */
  acompte_numero:    string | null
}
```

Puis la requête :

```typescript
  return db.get<TicketPublic>(`
    SELECT
      t.id,
      t.numero,
      t.tracking_token,
      t.statut,
      t.appareil_marque,
      t.appareil_modele,
      t.description_panne,
      t.diagnostic,
      t.prix_estime,
      t.prix_final,
      t.date_reception,
      t.date_promesse,
      t.date_livraison,
      c.prenom   AS client_prenom,
      c.nom      AS client_nom,
      b.nom      AS boutique_nom,
      b.telephone AS boutique_telephone,
      b.email    AS boutique_email,
      b.adresse  AS boutique_adresse,
      b.ville    AS boutique_ville,
      b.slug     AS boutique_slug,
      d.statut   AS devis_statut,
      fa.total_ttc AS acompte_montant,
      fa.numero    AS acompte_numero
    FROM   tickets t
    JOIN   clients  c ON c.id = t.client_id
    JOIN   boutiques b ON b.id = t.boutique_id
    LEFT JOIN devis d ON d.id = (
      SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN factures fa ON fa.type_facture = 'acompte' AND (fa.ticket_id = t.id OR fa.devis_id = d.id)
    WHERE  t.tracking_token = ? AND t.actif = 1
  `, [token])
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npx vitest run tests/publicService.test.ts`
Expected: PASS.

- [ ] **Step 5: Exposer les champs dans la route publique**

Dans `src/routes/public.ts`, route `GET /ticket/:token`, ajouter les deux champs à l'objet `data` retourné (juste après la ligne `devis_statut: ticket.devis_statut,` ajoutée au checkpoint 25) :

```typescript
        devis_statut:  ticket.devis_statut,
        acompte_montant: ticket.acompte_montant,
        acompte_numero:  ticket.acompte_numero,
```

- [ ] **Step 6: Lancer la suite complète**

Run: `npx vitest run`
Expected: `819/821` (1 nouveau test dans cette tâche, 818 existants après Task 7, mêmes 2 échecs pré-existants sans lien).

- [ ] **Step 7: Modifier `suivi.html`**

Dans `public/suivi.html`, fonction `renderTicket()`, repérer le bloc `// Prix` (celui qui affiche `prix-section`) et ajouter juste après :

```javascript
  // Acompte
  if (t.acompte_montant) {
    const soldeRestant = (t.prix_final ?? t.prix_estime ?? 0) - t.acompte_montant;
    document.getElementById('prix-section').classList.remove('hidden');
    const rows = document.getElementById('prix-body').innerHTML;
    document.getElementById('prix-body').innerHTML = rows +
      prixRow('Acompte versé', -t.acompte_montant) +
      prixRow('Solde restant', Math.max(soldeRestant, 0), true);
  }
```

**Note pour l'implémenteur** : `prixRow(label, montant, final)` formate déjà `montant.toFixed(2)` — vérifier que `prixRow()` accepte un montant négatif proprement (affichage `-120.00 €` attendu pour la ligne "Acompte versé") ; si le style CSS existant ne gère pas bien les négatifs (couleur, signe), ajuster `prixRow()` ou passer `Math.abs(t.acompte_montant)` avec un label `"− Acompte versé"` à la place — détail visuel à trancher à l'implémentation, pas bloquant pour la fonction.

- [ ] **Step 8: Bump `CACHE_VERSION` (dernière fois pour ce plan)**

Dans `public/sw.js`, incrémenter `CACHE_VERSION` — si Task 8 l'a déjà fait (`v2.58`), passer à `v2.59` ici ; si Task 8 a été sautée dans cette session, partir de `izigsm-v2.57` → `izigsm-v2.58`. Vérifier la valeur actuelle avec `grep -n "CACHE_VERSION  =" public/sw.js` avant d'incrémenter, pour ne jamais dupliquer un bump déjà fait.

- [ ] **Step 9: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Reprendre un ticket avec acompte facturé (créé aux étapes précédentes ou refait pour ce test), ouvrir `http://127.0.0.1:8788/suivi/<tracking_token>`, vérifier que le bloc "Devis / Tarif" affiche bien "Acompte versé" (négatif) et "Solde restant" (le bon montant). Nettoyer les données de test.

- [ ] **Step 10: Commit**

```bash
git add src/services/publicService.ts src/routes/public.ts public/suivi.html public/sw.js tests/publicService.test.ts
git commit -m "feat(suivi): afficher acompte versé / solde restant sur la page de suivi client"
```

---

## Après le plan

- [ ] Mettre à jour `project-docs/todo.md` (marquer "Chantier futur — acompte structuré" comme implémenté, avec les commits) et `project-docs/bugs.md` si des écarts avec le spec ont été découverts pendant l'implémentation.
- [ ] Build + `wrangler pages deploy` + vérification `repairdesk.fr/api/health` + `sw.js` version, comme pour chaque checkpoint précédent de ce projet.
- [ ] Sous-projet (B) — paiement en ligne Stripe — reste explicitement hors scope de ce plan, session future dédiée.
