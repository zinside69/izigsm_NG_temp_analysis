# Création manuelle de facture — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la création manuelle de facture fonctionnelle en implémentant `POST /api/factures`, supprimer du modal les éléments qui mentent à l'utilisateur, et capturer le socle de données exigé par la réforme française de la facturation électronique.

**Architecture:** Une nouvelle fonction `createFacture()` dans `src/services/factureService.ts` réutilise le socle existant (`nextNumero()`, `calculLignes()`, `ajouterPaiement()`, `emettreFacture()`). La route `POST /api/factures` délègue à `convertirDevis()` quand un `devis_id` est fourni, sinon appelle `createFacture()`. Le frontend passe d'un formulaire à deux boutons muets à trois actions explicites.

**Tech Stack:** Hono (TypeScript) sur Cloudflare Workers/Pages · D1 (SQLite edge) · Vitest (mocks D1 maison) · Playwright (E2E) · frontend HTML/CSS/JS vanilla.

**Spec:** `docs/superpowers/specs/2026-07-30-factures-creation-manuelle-design.md`

## Global Constraints

- `boutique_id` n'est **jamais** lu du body comme valeur de confiance — toujours `getBoutiqueId(user, body.boutique_id?.toString())` (`src/lib/middleware.ts:199`). Ce repo a un historique de failles d'isolation multi-tenant réelles (`project-docs/bugs.md`).
- **0 SQL inline dans les routes** — tout le SQL vit dans `src/services/*.ts` (règle `CLAUDE.md` § Architecture).
- Frontend : toujours `r.data.success` / `r.data.data`, jamais `r.success` / `r.data`. `apiGet`/`apiPost` (`public/static/js/app.js`) retournent `{ ok, status, data, error }`. Classe de bug récurrente sur ce repo.
- Chaque tâche backend se termine par `npx vitest run` vert. Baseline actuelle : **833/835**, les 2 échecs de fuseau horaire sont pré-existants — ne jamais les compter comme une régression.
- Chaque tâche frontend se valide en local live (`wrangler pages dev` + vraies données), jamais par relecture de code seule.
- `CACHE_VERSION` dans `public/sw.js` : v2.79 → v2.80, sur la **dernière** tâche frontend uniquement.
- Taux de TVA autorisés : `0`, `5.5`, `10`, `20`.
- **Aucun texte légal ne s'invente.** Les mentions obligatoires posées par ce plan sont des formulations statutaires citées avec leur article ; elles sont fournies mot pour mot dans la tâche 8 et ne doivent être ni reformulées ni complétées. Toute mention supplémentaire (CGV, CGR) est hors périmètre.
- Commits en français, format `type: message`. **Ne jamais ajouter de `Co-Authored-By`.**
- `npm run deploy` n'est **pas** lancé par ce plan — le déploiement est toujours une décision humaine explicite (`CLAUDE.md` § Déploiement).

## Serveur local (nécessaire pour les tâches 3, 4, 5, 8 et 9)

```bash
npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --file=seed.sql
npm run build
npx wrangler pages dev dist --local --port 3000
```

Ne **jamais** ajouter `--d1=DB` à `wrangler pages dev` (crée une base distincte, symptôme `no such table: users`).
Compte de démo : `admin@izigsm.fr` / `Admin@2026!` (boutique 1).

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `src/services/factureService.ts` | `CreateFactureInput` + `createFacture()` — logique métier et SQL ; snapshot des identités dans `emettreFacture()` | 1, 2, 3 |
| `tests/factureService.test.ts` | Tests unitaires du service (mocks D1) | 1, 2, 3 |
| `migrations/0037_facture_donnees_reglementaires.sql` | Socle facture électronique : date d'exécution + snapshots vendeur/acheteur | 3 |
| `src/routes/facturation.ts` | `POST /factures` (validation du body, isolation, délégation devis) + garde d'isolation sur `PUT /devis/:id/convertir` | 4, 5 |
| `tests/e2e/isolation.spec.ts` | Gate de non-régression isolation — 2 cas ajoutés | 5 |
| `public/factures.html` | Modal : suppression signature/statut/description, ajout TVA + date d'exécution, 3 boutons | 6 |
| `public/static/js/factures.js` | `saveFacture(action)`, suppression du fallback localStorage, TVA, devis en lecture seule ; document imprimé (ventilation TVA, mentions légales, identités figées) | 7, 8 |
| `public/sw.js` | `CACHE_VERSION` | 9 |

---

### Task 1: `createFacture()` — validation et création en brouillon

**Files:**
- Modify: `src/services/factureService.ts` (ajouter après `createFactureAcompte()`, avant la section `// ─── Avoirs ───`)
- Test: `tests/factureService.test.ts` (ajouter une section `describe('createFacture()')` en fin de fichier)

**Interfaces:**
- Consumes: `nextNumero(db, boutiqueId, 'facture')` (`src/lib/db.ts:40`), `calculLignes(lignes)` (`src/lib/db.ts:210`), `auditLog(db, params)` (`src/lib/db.ts`), `StatutFacture` (déjà exporté).
- Produces: `CreateFactureInput` (interface exportée) et `createFacture(db: D1Database, userId: number, input: CreateFactureInput): Promise<{ facture_id: number; facture_numero: string; statut: StatutFacture }>` — consommés par la tâche 2 (qui ajoute les actions d'émission), la tâche 3 (socle réglementaire) et la tâche 4 (route).

Cette tâche n'implémente que `action: 'brouillon'`. Les deux autres actions sont ajoutées en tâche 2 : elles ont leur propre cycle de test et un reviewer peut légitimement accepter celle-ci et refuser celle-là.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter en fin de `tests/factureService.test.ts`. Le helper `n()` et `createMockD1` sont déjà en haut du fichier. Ajouter `createFacture` et `type CreateFactureInput` à l'import existant depuis `../src/services/factureService`.

```ts
// ─── createFacture ────────────────────────────────────────────────────────────

describe('createFacture()', () => {
  let db: ReturnType<typeof createMockD1>

  const SQL_CHECK_CLIENT = n(`SELECT id FROM clients WHERE id = ? AND boutique_id = ?`)
  const SQL_CHECK_TICKET = n(`SELECT id FROM tickets WHERE id = ? AND boutique_id = ?`)
  const SQL_INSERT_FACTURE = n(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc, notes, conditions, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon')
    RETURNING id
  `)

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

  function setupBrouillon(factureId: number) {
    setupNumeroFacture()
    db.__setResponse(SQL_CHECK_CLIENT, { id: 3 })
    db.__setResponse(SQL_CHECK_TICKET, { id: 42 })
    db.__setResponseFn(SQL_INSERT_FACTURE, () => ({ id: factureId }))
  }

  beforeEach(() => { db = createMockD1() })

  const BASE_INPUT: CreateFactureInput = {
    boutique_id: 1,
    client_id:   3,
    ticket_id:   null,
    lignes: [
      { description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
    ],
    action: 'brouillon',
  }

  it('lance Error si aucune ligne', async () => {
    await expect(createFacture(db, 10, { ...BASE_INPUT, lignes: [] }))
      .rejects.toThrow('La facture doit contenir au moins une ligne.')
  })

  it('lance Error si une quantité est nulle ou négative', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'X', quantite: 0, prix_unitaire_ht: 100, tva_taux: 20 }],
    })).rejects.toThrow('quantite doit être positive.')
  })

  it('lance Error si un prix unitaire est négatif', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'X', quantite: 1, prix_unitaire_ht: -5, tva_taux: 20 }],
    })).rejects.toThrow('prix_unitaire_ht ne peut pas être négatif.')
  })

  it('lance Error si un taux de TVA n\'est pas autorisé', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'X', quantite: 1, prix_unitaire_ht: 100, tva_taux: 7 }],
    })).rejects.toThrow('tva_taux invalide')
  })

  it('lance Error si le total TTC est nul', async () => {
    await expect(createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [{ description: 'Geste commercial', quantite: 1, prix_unitaire_ht: 0, tva_taux: 20 }],
    })).rejects.toThrow('Le total de la facture ne peut pas être nul.')
  })

  it('lance Error si le client appartient à une autre boutique', async () => {
    setupNumeroFacture()
    db.__setNotFound(SQL_CHECK_CLIENT)

    await expect(createFacture(db, 10, BASE_INPUT))
      .rejects.toThrow('Client introuvable dans cette boutique.')
  })

  it('lance Error si le ticket appartient à une autre boutique', async () => {
    setupNumeroFacture()
    db.__setResponse(SQL_CHECK_CLIENT, { id: 3 })
    db.__setNotFound(SQL_CHECK_TICKET)

    await expect(createFacture(db, 10, { ...BASE_INPUT, ticket_id: 42 }))
      .rejects.toThrow('Ticket introuvable dans cette boutique.')
  })

  it('ne consomme aucun numéro de facture quand la validation échoue', async () => {
    setupBrouillon(60)

    await expect(createFacture(db, 10, { ...BASE_INPUT, lignes: [] })).rejects.toThrow()

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('sequences'))).toBe(false)
  })

  it('crée la facture en brouillon et retourne id + numéro + statut', async () => {
    setupBrouillon(60)

    const result = await createFacture(db, 10, BASE_INPUT)

    expect(result.facture_id).toBe(60)
    expect(result.facture_numero).toMatch(/^FAC-/)
    expect(result.statut).toBe('brouillon')
  })

  it('INSERT la facture avec les totaux calculés et les champs texte', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, {
      ...BASE_INPUT,
      ticket_id: 42,
      notes: 'Merci de votre visite',
      conditions: 'Paiement à réception',
    })

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall).toBeDefined()
    // (boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc, notes, conditions)
    expect(insertCall!.params[0]).toBe(1)                      // boutique_id
    expect(insertCall!.params[2]).toBe(3)                      // client_id
    expect(insertCall!.params[3]).toBe(42)                     // ticket_id
    expect(insertCall!.params[4]).toBe(100)                    // total_ht
    expect(insertCall!.params[5]).toBe(20)                     // total_tva
    expect(insertCall!.params[6]).toBe(120)                    // total_ttc
    expect(insertCall!.params[7]).toBe('Merci de votre visite') // notes
    expect(insertCall!.params[8]).toBe('Paiement à réception')  // conditions
  })

  // Les lignes sont écrites via db.batch(), que createMockD1 stube en no-op sans
  // enregistrer les statements (tests/helpers/mockD1.ts:192) — __getCalls() ne les
  // voit donc pas. Même limite que createAvoir(), qui utilise déjà db.batch(). On
  // vérifie ici le nombre de statements ; l'exactitude des totaux par ligne est
  // couverte par les tests de calculLignes() et par la vérification en base réelle
  // de la tâche 9 (SELECT sur lignes_document).
  it('écrit une ligne par ligne saisie, en un seul batch', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [
        { description: 'Écran',         quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
        { description: 'Main d\'œuvre', quantite: 2, prix_unitaire_ht: 25,  tva_taux: 10 },
      ],
    })

    expect(db.batch).toHaveBeenCalledTimes(1)
    expect((db.batch as any).mock.calls[0][0]).toHaveLength(2)
  })

  it('calcule les totaux du document à partir de tous les taux de TVA', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, {
      ...BASE_INPUT,
      lignes: [
        { description: 'Écran',         quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
        { description: 'Main d\'œuvre', quantite: 2, prix_unitaire_ht: 25,  tva_taux: 10 },
      ],
    })

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall!.params[4]).toBe(150)  // total_ht  = 100 + 50
    expect(insertCall!.params[5]).toBe(25)   // total_tva = 20 + 5
    expect(insertCall!.params[6]).toBe(175)  // total_ttc
  })

  it('n\'émet ni n\'encaisse rien en action brouillon', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, BASE_INPUT)

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('INSERT INTO paiements'))).toBe(false)
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(false)
  })

  it('appelle auditLog CREATE_FACTURE', async () => {
    setupBrouillon(60)

    await createFacture(db, 10, BASE_INPUT)

    const auditCall = db.__getCalls().find(
      c => c.sql.includes('INSERT INTO audit_logs') && c.params.includes('CREATE_FACTURE')
    )
    expect(auditCall).toBeDefined()
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/factureService.test.ts -t "createFacture()"`
Expected: FAIL — `createFacture is not a function` (l'import n'existe pas encore).

- [ ] **Step 3: Écrire l'implémentation minimale**

Dans `src/services/factureService.ts`, ajouter l'interface juste après `CreateFactureAcompteInput` :

```ts
/** Taux de TVA autorisés sur une ligne de facture (France, 2026). */
const TVA_TAUX_AUTORISES = [0, 5.5, 10, 20]

export interface CreateFactureInput {
  boutique_id: number
  client_id:   number
  /** Rattachement optionnel à un ticket de réparation. */
  ticket_id?:  number | null
  lignes: Array<{
    description:      string
    quantite:         number
    prix_unitaire_ht: number
    tva_taux:         number
  }>
  notes?:      string
  conditions?: string
  /**
   * 'brouillon'         → facture éditable, non verrouillée
   * 'emettre'           → + verrouillage NF525 (irréversible)
   * 'emettre_encaisser' → + encaissement immédiat du TTC, puis verrouillage
   */
  action: 'brouillon' | 'emettre' | 'emettre_encaisser'
  /** Requis si action = 'emettre_encaisser'. */
  mode_paiement?: string
  /** Référence libre du paiement (n° de chèque, transaction CB…). */
  reference?: string
}
```

Puis la fonction, après `createFactureAcompte()` :

```ts
/**
 * Crée une facture manuelle avec ses lignes, sans passer par un devis.
 * Voir docs/superpowers/specs/2026-07-30-factures-creation-manuelle-design.md.
 *
 * Toute la validation précède `nextNumero()` : un numéro séquentiel de boutique
 * ne doit jamais être consommé par une saisie invalide (il ne peut pas être rendu).
 *
 * Non migré vers le port `Database` (chantier Ports & Adapters, 2026-07-12) :
 * dépend de `nextNumero()`/`auditLog()`/`db.batch()`, tous sur `D1Database` brut.
 *
 * @param db     - Instance D1Database
 * @param userId - ID de l'utilisateur créateur
 * @param input  - Client, lignes (prix HT) et action souhaitée
 */
export async function createFacture(
  db:     D1Database,
  userId: number,
  input:  CreateFactureInput
): Promise<{ facture_id: number; facture_numero: string; statut: StatutFacture }> {
  // ── Validation (avant toute écriture et avant nextNumero) ────────────────
  if (!input.lignes || input.lignes.length === 0)
    throw new Error('La facture doit contenir au moins une ligne.')

  for (const l of input.lignes) {
    if (typeof l.quantite !== 'number' || isNaN(l.quantite) || l.quantite <= 0)
      throw new Error('quantite doit être positive.')
    if (typeof l.prix_unitaire_ht !== 'number' || isNaN(l.prix_unitaire_ht) || l.prix_unitaire_ht < 0)
      throw new Error('prix_unitaire_ht ne peut pas être négatif.')
    if (!TVA_TAUX_AUTORISES.includes(l.tva_taux))
      throw new Error(`tva_taux invalide : ${l.tva_taux} (autorisés : ${TVA_TAUX_AUTORISES.join(', ')}).`)
  }

  const totaux = calculLignes(input.lignes)
  if (totaux.total_ttc <= 0)
    throw new Error('Le total de la facture ne peut pas être nul.')

  // ── Isolation à l'écriture : le client et le ticket doivent appartenir à
  //    la boutique appelante. Ne jamais supposer qu'un filtre en amont suffit
  //    (historique de failles multi-tenant, voir project-docs/bugs.md).
  const client = await db.prepare('SELECT id FROM clients WHERE id = ? AND boutique_id = ?')
    .bind(input.client_id, input.boutique_id).first<{ id: number }>()
  if (!client) throw new Error('Client introuvable dans cette boutique.')

  if (input.ticket_id) {
    const ticket = await db.prepare('SELECT id FROM tickets WHERE id = ? AND boutique_id = ?')
      .bind(input.ticket_id, input.boutique_id).first<{ id: number }>()
    if (!ticket) throw new Error('Ticket introuvable dans cette boutique.')
  }

  // ── Création ─────────────────────────────────────────────────────────────
  const numero = await nextNumero(db, input.boutique_id, 'facture')

  // statut='brouillon' à la création : ajouterPaiement() et emettreFacture()
  // exigent toutes deux locked=0, la facture doit donc démarrer éditable.
  const facture = await db.prepare(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc, notes, conditions, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon')
    RETURNING id
  `).bind(
    input.boutique_id, numero, input.client_id, input.ticket_id ?? null,
    totaux.total_ht, totaux.total_tva, totaux.total_ttc,
    input.notes ?? null, input.conditions ?? null,
  ).first<{ id: number }>()

  if (!facture?.id) throw new Error('Erreur lors de la création de la facture.')
  const factureId = facture.id

  // Totaux par ligne calculés avec calculLignes() sur une ligne isolée : même
  // arrondi comptable que les totaux du document, pas de seconde formule.
  await db.batch(input.lignes.map((l, i) => {
    const t = calculLignes([l])
    return db.prepare(`
      INSERT INTO lignes_document
        (document_type, document_id, ordre, description, quantite,
         prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc, produit_id)
      VALUES ('facture', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).bind(
      factureId, i + 1, l.description, l.quantite,
      l.prix_unitaire_ht, l.tva_taux, t.total_ht, t.total_tva, t.total_ttc,
    )
  }))

  await auditLog(db, {
    boutique_id: input.boutique_id, user_id: userId,
    action: 'CREATE_FACTURE', entite_type: 'facture', entite_id: factureId,
    apres: { numero, total_ttc: totaux.total_ttc, action: input.action },
  })

  return { facture_id: factureId, facture_numero: numero, statut: 'brouillon' }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run tests/factureService.test.ts -t "createFacture()"`
Expected: PASS — 12 tests verts.

- [ ] **Step 5: Lancer la suite complète**

Run: `npx vitest run`
Expected: 845/847 (833/835 + 12 nouveaux). Les 2 seuls échecs sont ceux de fuseau horaire pré-existants.

- [ ] **Step 6: Commit**

```bash
git add src/services/factureService.ts tests/factureService.test.ts
git commit -m "feat: createFacture() - validation + creation en brouillon"
```

---

### Task 2: `createFacture()` — actions `emettre` et `emettre_encaisser`

**Files:**
- Modify: `src/services/factureService.ts` (fin de `createFacture()`, avant le `return`)
- Test: `tests/factureService.test.ts` (compléter `describe('createFacture()')`)

**Interfaces:**
- Consumes: `createFacture()` de la tâche 1 · `ajouterPaiement(db, factureId, userId, input: PaiementInput)` (`factureService.ts:152`) · `emettreFacture(db, factureId, userId)` (`factureService.ts:209`).
- Produces: `createFacture()` retourne désormais `statut` valant `'brouillon'`, `'en_attente'` ou `'payee'` selon `input.action` — consommé par la route en tâche 4.

Ordre imposé : `ajouterPaiement()` **avant** `emettreFacture()`, parce que le paiement exige `locked = 0`. C'est exactement la séquence de `createFactureAcompte()` (`factureService.ts:346-352`).

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter dans le `describe('createFacture()')` existant, après les tests de la tâche 1 :

```ts
  const SQL_GET_FACTURE_PAIEMENT = n(`SELECT id, total_ttc, montant_paye, boutique_id, locked FROM factures WHERE id = ?`)
  const SQL_GET_FACTURE_EMETTRE  = n(`SELECT * FROM factures WHERE id = ?`)
  const SQL_NF525_LAST_HASH      = n(`SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1`)

  function setupEmission(factureId: number) {
    setupBrouillon(factureId)
    db.__setResponse(SQL_GET_FACTURE_PAIEMENT, {
      id: factureId, total_ttc: 120, montant_paye: 0, boutique_id: 1, locked: 0,
    })
    db.__setResponse(SQL_GET_FACTURE_EMETTRE, {
      id: factureId, boutique_id: 1, client_id: 3, numero: 'FAC-2026-00008',
      total_ht: 100, total_tva: 20, total_ttc: 120, locked: 0,
    })
    db.__setNotFound(SQL_NF525_LAST_HASH)
  }

  it('lance Error si action=emettre_encaisser sans mode_paiement', async () => {
    await expect(createFacture(db, 10, { ...BASE_INPUT, action: 'emettre_encaisser' }))
      .rejects.toThrow('mode_paiement obligatoire pour encaisser.')
  })

  it('action=emettre : verrouille la facture sans encaisser', async () => {
    setupEmission(61)

    const result = await createFacture(db, 10, { ...BASE_INPUT, action: 'emettre' })

    const calls = db.__getCalls()
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(true)
    expect(calls.some(c => c.sql.includes('INSERT INTO paiements'))).toBe(false)
    expect(result.statut).toBe('en_attente')
  })

  it('action=emettre_encaisser : encaisse le TTC puis verrouille', async () => {
    setupEmission(62)

    const result = await createFacture(db, 10, {
      ...BASE_INPUT, action: 'emettre_encaisser', mode_paiement: 'especes',
    })

    const calls = db.__getCalls()
    const paiement = calls.find(c => c.sql.includes('INSERT INTO paiements'))
    expect(paiement).toBeDefined()
    // (facture_id, boutique_id, montant, mode_paiement, reference, user_id, notes)
    expect(paiement!.params[2]).toBe(120)        // montant = total TTC
    expect(paiement!.params[3]).toBe('especes')  // mode_paiement
    expect(calls.some(c => c.sql.includes('INSERT INTO journal_nf525'))).toBe(true)
    expect(result.statut).toBe('payee')
  })

  it('encaisse avant d\'émettre (ajouterPaiement exige locked=0)', async () => {
    setupEmission(63)

    await createFacture(db, 10, {
      ...BASE_INPUT, action: 'emettre_encaisser', mode_paiement: 'carte',
    })

    const calls = db.__getCalls()
    const idxPaiement = calls.findIndex(c => c.sql.includes('INSERT INTO paiements'))
    const idxNf525    = calls.findIndex(c => c.sql.includes('INSERT INTO journal_nf525'))
    expect(idxPaiement).toBeGreaterThan(-1)
    expect(idxNf525).toBeGreaterThan(idxPaiement)
  })

  it('transmet la référence de paiement quand elle est fournie', async () => {
    setupEmission(64)

    await createFacture(db, 10, {
      ...BASE_INPUT, action: 'emettre_encaisser', mode_paiement: 'cheque', reference: 'CHQ-4412',
    })

    const paiement = db.__getCalls().find(c => c.sql.includes('INSERT INTO paiements'))
    expect(paiement!.params[4]).toBe('CHQ-4412')
  })
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/factureService.test.ts -t "createFacture()"`
Expected: FAIL — le test `mode_paiement obligatoire` ne lève rien, et les tests d'émission trouvent `statut: 'brouillon'` au lieu de `'en_attente'` / `'payee'`.

- [ ] **Step 3: Écrire l'implémentation**

Dans `createFacture()`, ajouter cette validation à la fin du bloc de validation (juste après la boucle `for` sur les lignes, avant `calculLignes`) :

```ts
  if (input.action === 'emettre_encaisser' && !input.mode_paiement)
    throw new Error('mode_paiement obligatoire pour encaisser.')
```

Puis remplacer la fin de la fonction — le bloc `auditLog` + `return` — par :

```ts
  // ── Encaissement puis émission ───────────────────────────────────────────
  // Ordre imposé : ajouterPaiement() exige locked=0, emettreFacture() pose
  // locked=1. Même séquence que createFactureAcompte().
  let statut: StatutFacture = 'brouillon'

  if (input.action === 'emettre_encaisser') {
    const paiement = await ajouterPaiement(db, factureId, userId, {
      montant:       totaux.total_ttc,
      mode_paiement: input.mode_paiement!,
      reference:     input.reference,
    })
    statut = paiement.statut
  }

  if (input.action !== 'brouillon') {
    await emettreFacture(db, factureId, userId)
    // emettreFacture() ne repasse en 'en_attente' que depuis 'brouillon' :
    // un encaissement préalable ('payee') est préservé.
    if (statut === 'brouillon') statut = 'en_attente'
  }

  await auditLog(db, {
    boutique_id: input.boutique_id, user_id: userId,
    action: 'CREATE_FACTURE', entite_type: 'facture', entite_id: factureId,
    apres: { numero, total_ttc: totaux.total_ttc, action: input.action, statut },
  })

  return { facture_id: factureId, facture_numero: numero, statut }
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run tests/factureService.test.ts -t "createFacture()"`
Expected: PASS — 17 tests verts.

- [ ] **Step 5: Vérifier les types et la suite complète**

Run: `npx tsc --noEmit` puis `npx vitest run`
Expected: aucune **nouvelle** erreur `tsc` sur `src/services/factureService.ts` (des erreurs pré-existantes subsistent sur d'anciens fichiers de test — ne pas les confondre avec une régression). Vitest : 850/852.

- [ ] **Step 6: Commit**

```bash
git add src/services/factureService.ts tests/factureService.test.ts
git commit -m "feat: createFacture() - actions emettre et emettre_encaisser"
```

---

### Task 3: Socle facture électronique — migration, date d'exécution, snapshot des identités

**Files:**
- Create: `migrations/0037_facture_donnees_reglementaires.sql`
- Modify: `src/services/factureService.ts` (`CreateFactureInput`, l'INSERT de `createFacture()`, et `emettreFacture()`)
- Test: `tests/factureService.test.ts`

**Interfaces:**
- Consumes: `createFacture()` et `emettreFacture()` (tâches 1-2) · `todayParis()` (`src/lib/timezone.ts`).
- Produces: `CreateFactureInput.date_execution?: string` (date ISO `YYYY-MM-DD`) — envoyé par la route en tâche 4 et par le formulaire en tâches 6-7. Colonnes `factures.date_execution`, `factures.vendeur_snapshot`, `factures.acheteur_snapshot` (JSON) — lues par le document imprimé en tâche 8. Le snapshot vendeur embarque `tva_taux_defaut` et `mention_facture` repris de `boutique_settings`.

Contexte : voir la spec § « Amendement 2026-07-30 — socle de données de la facture électronique ». Le snapshot est posé dans `emettreFacture()` et non dans `createFacture()` : c'est le moment où la facture devient inaltérable (`locked = 1`) et c'est le point de passage unique des trois chemins de création (manuelle, conversion de devis, acompte), qui en héritent donc tous sans duplication.

- [ ] **Step 1: Écrire la migration**

Créer `migrations/0037_facture_donnees_reglementaires.sql` :

```sql
-- Migration 0037 — Socle de données de la facture électronique (réforme française 2026)
-- Voir docs/superpowers/specs/2026-07-30-factures-creation-manuelle-design.md
--     § Amendement 2026-07-30.
--
-- Les identités vendeur/acheteur sont figées à l'émission : une facture verrouillée
-- (locked=1, CGI art. 289) ne doit plus dépendre des fiches clients/boutiques vivantes,
-- sinon modifier une adresse client réécrit rétroactivement un document déjà émis.

ALTER TABLE factures ADD COLUMN date_execution    TEXT;  -- date de livraison ou d'exécution (socle du 01/09/2026)
ALTER TABLE factures ADD COLUMN vendeur_snapshot  TEXT;  -- JSON figé par emettreFacture()
ALTER TABLE factures ADD COLUMN acheteur_snapshot TEXT;  -- JSON figé par emettreFacture()
```

**Aucune colonne de régime de TVA n'est créée** (décision utilisateur 2026-07-30) : le paramétrage existe déjà et est déjà multi-tenant — `boutique_settings.tva_taux_defaut` (migration `0002`, réglé dans `settings.html`) vaut `0` pour une boutique en franchise (auto-entrepreneur / micro-entreprise), et `boutique_settings.mention_facture` (migration `0018`) porte le texte libre de la mention. Les deux sont repris dans le snapshot vendeur ci-dessous.

- [ ] **Step 2: Appliquer la migration en local et vérifier**

```bash
npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --command "SELECT date_execution, vendeur_snapshot, acheteur_snapshot FROM factures LIMIT 1"
npx wrangler d1 execute DB --local --command "SELECT boutique_id, tva_taux_defaut, mention_facture FROM boutique_settings LIMIT 1"
```

Expected: la première requête s'exécute sans erreur (colonnes vides). La seconde confirme que le paramétrage TVA existant est bien lisible — c'est la source du régime de franchise, aucune colonne n'est ajoutée pour ça.

- [ ] **Step 3: Écrire les tests qui échouent**

Ajouter dans le `describe('createFacture()')` existant :

```ts
  it('enregistre la date d\'exécution fournie', async () => {
    setupBrouillon(65)

    await createFacture(db, 10, { ...BASE_INPUT, date_execution: '2026-07-15' })

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall!.params[9]).toBe('2026-07-15')
  })

  it('retombe sur la date du jour si aucune date d\'exécution n\'est fournie', async () => {
    setupBrouillon(66)

    await createFacture(db, 10, BASE_INPUT)

    const insertCall = db.__getCalls().find(c => c.sql === SQL_INSERT_FACTURE)
    expect(insertCall!.params[9]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
```

Et un nouveau bloc dans le `describe('emettreFacture()')` existant :

```ts
  it('fige les identités vendeur et acheteur au moment de l\'émission', async () => {
    db.__setResponse(n('SELECT * FROM factures WHERE id = ?'), {
      id: 20, boutique_id: 1, client_id: 3, numero: 'FAC-2026-00001',
      total_ht: 100, total_tva: 20, total_ttc: 120, locked: 0,
    })
    db.__setNotFound(n('SELECT hash_courant FROM journal_nf525 WHERE boutique_id = ? ORDER BY id DESC LIMIT 1'))
    db.__setResponse(
      n(`SELECT b.nom, b.siret, b.tva_numero, b.adresse, b.code_postal, b.ville, s.tva_taux_defaut, s.mention_facture FROM boutiques b LEFT JOIN boutique_settings s ON s.boutique_id = b.id WHERE b.id = ?`),
      { nom: 'iziGSM Paris 11', siret: '12345678901234', tva_numero: 'FR12345678901',
        adresse: '5 avenue Montaigne', code_postal: '75011', ville: 'Paris',
        tva_taux_defaut: 20, mention_facture: null }
    )
    db.__setResponse(
      n(`SELECT type_client, raison_sociale, prenom, nom, siret, tva_intracom, adresse, code_postal, ville FROM clients WHERE id = ?`),
      { type_client: 'professionnel', raison_sociale: 'SOTELI', prenom: 'Marie', nom: 'Dupont',
        siret: '98765432101234', tva_intracom: 'FR98987654321',
        adresse: '10 rue de la Paix', code_postal: '75001', ville: 'Paris' }
    )

    await emettreFacture(db, 20, 10)

    const lockCall = db.__getCalls().find(c => c.sql.includes('SET') && c.sql.includes('locked') && c.sql.includes('factures'))
    expect(lockCall).toBeDefined()
    const snapshots = lockCall!.params.filter(p => typeof p === 'string' && p.startsWith('{'))
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toContain('12345678901234')  // SIRET vendeur
    expect(snapshots[1]).toContain('98765432101234')  // SIRET acheteur
  })
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/factureService.test.ts -t "createFacture()"` puis `npx vitest run tests/factureService.test.ts -t "emettreFacture()"`
Expected: FAIL — `params[9]` est `undefined` (la colonne n'est pas encore dans l'INSERT) et aucun snapshot JSON n'est présent dans l'UPDATE de verrouillage.

- [ ] **Step 5: Ajouter `date_execution` à `createFacture()`**

Dans `CreateFactureInput`, après `conditions?: string` :

```ts
  /**
   * Date de livraison ou d'exécution de la prestation (ISO `YYYY-MM-DD`).
   * Donnée du socle réglementaire de la facture électronique (01/09/2026).
   * Absente = date du jour.
   */
  date_execution?: string
```

Importer `todayParis` en haut de `factureService.ts` s'il ne l'est pas déjà :

```ts
import { todayParis } from '../lib/timezone'
```

Puis remplacer l'INSERT de `createFacture()` par :

```ts
  const facture = await db.prepare(`
    INSERT INTO factures
      (boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc, notes, conditions, date_execution, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon')
    RETURNING id
  `).bind(
    input.boutique_id, numero, input.client_id, input.ticket_id ?? null,
    totaux.total_ht, totaux.total_tva, totaux.total_ttc,
    input.notes ?? null, input.conditions ?? null,
    input.date_execution ?? todayParis(),
  ).first<{ id: number }>()
```

Mettre à jour la constante `SQL_INSERT_FACTURE` du fichier de test pour refléter le nouveau SQL.

- [ ] **Step 6: Figer les identités dans `emettreFacture()`**

Dans `emettreFacture()`, juste après le calcul de `hashNf525` et avant l'UPDATE de verrouillage :

```ts
  // Socle facture électronique : figer les identités au moment exact où le document
  // devient inaltérable. Passé ce point, plus aucune jointure vivante ne doit pouvoir
  // réécrire une facture émise (voir la spec § Amendement 2026-07-30).
  // Le LEFT JOIN sur boutique_settings fige aussi le régime de TVA (tva_taux_defaut = 0
  // ⇒ franchise en base, art. 293 B) et la mention paramétrée par la boutique : ces deux
  // valeurs conditionnent le pied de facture et doivent suivre le document, pas la config
  // du jour où on le réimprime. LEFT JOIN car la ligne de settings peut ne pas exister.
  const vendeur = await db.prepare(`
    SELECT b.nom, b.siret, b.tva_numero, b.adresse, b.code_postal, b.ville,
           s.tva_taux_defaut, s.mention_facture
    FROM   boutiques b
    LEFT   JOIN boutique_settings s ON s.boutique_id = b.id
    WHERE  b.id = ?
  `).bind(facture.boutique_id).first<any>()

  const acheteur = await db.prepare(`
    SELECT type_client, raison_sociale, prenom, nom, siret, tva_intracom, adresse, code_postal, ville
    FROM clients WHERE id = ?
  `).bind(facture.client_id).first<any>()
```

Puis remplacer l'UPDATE de verrouillage par :

```ts
  await db.prepare(`
    UPDATE factures
    SET locked            = 1,
        issued_at         = CURRENT_TIMESTAMP,
        tracking_token    = ?,
        hash_nf525        = ?,
        vendeur_snapshot  = ?,
        acheteur_snapshot = ?,
        statut            = CASE WHEN statut = 'brouillon' THEN 'en_attente' ELSE statut END
    WHERE id = ?
  `).bind(
    trackingToken, hashNf525,
    JSON.stringify(vendeur ?? {}), JSON.stringify(acheteur ?? {}),
    factureId,
  ).run()
```

- [ ] **Step 7: Lancer les tests**

Run: `npx vitest run tests/factureService.test.ts`
Expected: PASS — les nouveaux tests verts, et **tous les tests pré-existants d'`emettreFacture()`, `createFactureAcompte()` et `createAvoir()` toujours verts** (le changement est additif ; s'ils cassent, c'est une régression réelle à corriger, pas les tests à ajuster).

- [ ] **Step 8: Suite complète et types**

Run: `npx vitest run` puis `npx tsc --noEmit`
Expected: aucune nouvelle erreur, seuls les 2 échecs de fuseau horaire pré-existants.

- [ ] **Step 9: Commit**

```bash
git add migrations/0037_facture_donnees_reglementaires.sql src/services/factureService.ts tests/factureService.test.ts
git commit -m "feat: socle facture electronique - date d'execution + snapshot identites a l'emission"
```

---

### Task 4: Route `POST /api/factures`

**Files:**
- Modify: `src/routes/facturation.ts` (section `// ─── FACTURES ───`, juste avant `GET /factures`)

**Interfaces:**
- Consumes: `createFacture()` + `CreateFactureInput` (tâches 1-2) · `convertirDevis(db, id, userId)` (`src/services/devisService.ts:400`) · `getDevis(db, id)` (déjà importé dans ce fichier, utilisé par `POST /devis/:id/acompte`) · `getBoutiqueId(user, paramBoutiqueId?)` · `ajouterPaiement()` · `emettreFacture()`.
- Produces: endpoint `POST /api/factures` — consommé par le frontend en tâche 7.

**Décision NF525 sur le chemin devis, à respecter telle quelle :** avec `action: 'brouillon'`, la route appelle `convertirDevis()` **et rien d'autre** — aucune entrée `journal_nf525` n'est créée, elle le sera à l'émission par `emettreFacture()`. C'est le comportement correct (NF525 = facture émise inaltérable) et cela évite une double entrée dans un journal à hachage chaîné. La route legacy `PUT /devis/:id/convertir` enregistre elle immédiatement — **ne pas la modifier sur ce point**, c'est hors périmètre et risqué.

- [ ] **Step 1: Écrire la route**

Ajouter dans `src/routes/facturation.ts`, section FACTURES, avant `facturation.get('/factures', …)`. Compléter les imports : `createFacture`, `type CreateFactureInput` depuis `../services/factureService` et `convertirDevis` depuis `../services/devisService` (déjà importé pour la route `/convertir`).

```ts
/**
 * POST /api/factures
 * Crée une facture manuelle (modal "Nouvelle facture" de factures.html).
 * Voir docs/superpowers/specs/2026-07-30-factures-creation-manuelle-design.md.
 *
 * Si `devis_id` est fourni, délègue à convertirDevis() — chemin existant qui
 * porte déjà ses garanties (refus si devis refusé/annulé/déjà converti,
 * déduction d'un acompte antérieur) — et les lignes du body sont ignorées.
 *
 * @body { client_id, ticket_id?, devis_id?, lignes[], notes?, conditions?, date_execution?,
 *         action: 'brouillon'|'emettre'|'emettre_encaisser', mode_paiement?, reference? }
 * `date_execution` (date de livraison/exécution, socle réglementaire de la facture
 * électronique) transite tel quel vers createFacture() par le spread du body ; absent,
 * le service retombe sur la date du jour.
 * @returns 201 { success, facture_id, facture_numero, statut }
 */
facturation.post('/factures', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({} as any))

  const ACTIONS = ['brouillon', 'emettre', 'emettre_encaisser']

  if (!body.client_id)
    return c.json({ success: false, error: 'client_id obligatoire.' }, 400)
  if (!ACTIONS.includes(body.action))
    return c.json({ success: false, error: `action invalide (${ACTIONS.join(' | ')}).` }, 400)
  if (!body.devis_id && !body.lignes?.length)
    return c.json({ success: false, error: 'lignes obligatoires sans devis source.' }, 400)
  if (body.action === 'emettre_encaisser' && !body.mode_paiement)
    return c.json({ success: false, error: 'mode_paiement obligatoire pour encaisser.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    // ── Chemin devis : délégation, jamais de seconde implémentation ────────
    if (body.devis_id) {
      const devis = await getDevis(c.get('db'), body.devis_id)
      if (!devis) return c.json({ success: false, error: 'Devis introuvable.' }, 404)
      if (devis.boutique_id !== boutiqueId)
        return c.json({ success: false, error: 'Accès refusé.' }, 403)

      const { facture_id, facture_numero } = await convertirDevis(c.env.DB, body.devis_id, user.sub)

      let statut = 'brouillon'
      if (body.action === 'emettre_encaisser') {
        // Le montant à encaisser n'est PAS `devis.total_ttc` : convertirDevis() déduit
        // une facture d'acompte antérieure et crée donc une facture au solde restant
        // (devisService.ts:437-483). Encaisser le total du devis ferait payer deux fois
        // l'acompte au client et laisserait `montant_paye` au-dessus du `total_ttc` réel.
        // On relit la facture créée plutôt que de recopier ici la règle de déduction —
        // si celle-ci évolue, l'encaissement suit sans modification.
        const factureCreee = await getFacture(c.get('db'), facture_id)
        const paiement = await ajouterPaiement(c.env.DB, facture_id, user.sub, {
          montant:       factureCreee?.total_ttc ?? devis.total_ttc,
          mode_paiement: body.mode_paiement,
          reference:     body.reference,
        })
        statut = paiement.statut
      }
      if (body.action !== 'brouillon') {
        await emettreFacture(c.env.DB, facture_id, user.sub)
        if (statut === 'brouillon') statut = 'en_attente'
      }

      return c.json({ success: true, facture_id, facture_numero, statut }, 201)
    }

    // ── Chemin manuel ──────────────────────────────────────────────────────
    const input: CreateFactureInput = { ...body, boutique_id: boutiqueId }
    const result = await createFacture(c.env.DB, user.sub, input)
    return c.json({ success: true, ...result }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})
```

- [ ] **Step 2: Vérifier les types**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur sur `src/routes/facturation.ts`.

- [ ] **Step 3: Vérifier la suite unitaire**

Run: `npx vitest run`
Expected: inchangé par rapport à la tâche 3 (aucun test unitaire n'est ajouté par cette tâche).

- [ ] **Step 4: Vérifier l'endpoint contre le serveur local**

Démarrer le serveur local (voir en tête de plan), puis :

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@izigsm.fr","password":"Admin@2026!"}' | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

curl -s -X POST http://localhost:3000/api/factures \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"client_id":1,"action":"brouillon","lignes":[{"description":"Test","quantite":1,"prix_unitaire_ht":100,"tva_taux":20}]}'
```

Expected: `201` avec `{"success":true,"facture_id":…,"facture_numero":"FAC-…","statut":"brouillon"}`.

Puis vérifier en base :

```bash
npx wrangler d1 execute DB --local --command "SELECT id, numero, statut, locked, total_ttc FROM factures ORDER BY id DESC LIMIT 1"
npx wrangler d1 execute DB --local --command "SELECT document_type, ordre, description, total_ttc FROM lignes_document WHERE document_type='facture' ORDER BY id DESC LIMIT 3"
```

Expected: la facture existe avec `locked = 0`, `total_ttc = 120`, et une ligne `document_type = 'facture'`.

Rejouer avec `"action":"emettre_encaisser","mode_paiement":"especes"` et vérifier `locked = 1`, `statut = 'payee'`, `hash_nf525` non nul, et une ligne dans `paiements`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/facturation.ts
git commit -m "feat: POST /api/factures - creation manuelle + delegation devis"
```

---

### Task 5: Refermer la faille d'isolation sur la conversion de devis

**Files:**
- Modify: `src/routes/facturation.ts:248` (`PUT /devis/:id/convertir`)
- Test: `tests/e2e/isolation.spec.ts`

**Interfaces:**
- Consumes: `getDevis(db, id)` · `createTenantAdmin(request)` (`tests/e2e/fixtures/tenant.ts`).
- Produces: rien de consommé par les tâches suivantes.

`PUT /api/devis/:id/convertir` n'a **aucune** vérification `boutique_id` : un manager de la boutique B peut convertir en facture un devis de la boutique A. Même classe que les 3 failles déjà corrigées sur ce repo (`project-docs/bugs.md`). La route `POST /devis/:id/acompte` juste en dessous applique le bon patron — on l'aligne. La tâche 4 a déjà posé cette garde sur le nouvel endpoint ; il reste à la poser sur la route legacy et à verrouiller les deux par un test.

- [ ] **Step 1: Écrire les tests E2E qui échouent**

Ajouter dans `tests/e2e/isolation.spec.ts`, à l'intérieur du `test.describe('Isolation multi-tenant', …)`. Le devis 1 du seed appartient à la boutique 1.

```ts
  // Régression : PUT /devis/:id/convertir n'avait aucune vérification boutique_id
  // (trouvé le 2026-07-30 en préparant POST /api/factures, voir bugs.md).
  const BOUTIQUE_1_DEVIS_ID = 1

  test('un admin d\'une autre boutique ne peut pas convertir un devis qui ne lui appartient pas', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.put(`/api/devis/${BOUTIQUE_1_DEVIS_ID}/convertir`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas facturer un devis qui ne lui appartient pas via POST /api/factures', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.post('/api/factures', {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: { client_id: 1, devis_id: BOUTIQUE_1_DEVIS_ID, action: 'brouillon' },
    })

    expect([403, 404]).toContain(res.status())
  })
```

- [ ] **Step 2: Lancer les tests pour vérifier que le premier échoue**

Serveur local démarré, puis Run: `npm run test:e2e -- isolation.spec.ts`
Expected: le test `POST /api/factures` PASSE déjà (garde posée en tâche 4), le test `PUT /devis/:id/convertir` ÉCHOUE avec un `200` — c'est la faille.

- [ ] **Step 3: Poser la garde sur la route legacy**

Dans `src/routes/facturation.ts`, route `PUT /devis/:id/convertir`, insérer juste après `const devisId = parseInt(c.req.param('id'), 10)` :

```ts
  // Isolation multi-tenant : ne jamais convertir le devis d'une autre boutique.
  // Même patron que POST /devis/:id/acompte ci-dessous (faille trouvée le 2026-07-30).
  const devisAControler = await getDevis(c.get('db'), devisId)
  if (!devisAControler) return c.json({ success: false, error: 'Devis introuvable.' }, 404)
  if (user.role !== 'admin' && devisAControler.boutique_id !== user.boutique_id)
    return c.json({ success: false, error: 'Accès refusé.' }, 403)
```

Note : la condition est copiée littéralement de `POST /devis/:id/acompte` (`facturation.ts:289`) — un admin plateforme reste autorisé, un manager est borné à sa boutique.

- [ ] **Step 4: Relancer les tests E2E**

Run: `npm run test:e2e -- isolation.spec.ts`
Expected: PASS — tous les tests du fichier, dont les 2 nouveaux.

- [ ] **Step 5: Vérifier la non-régression unitaire**

Run: `npx vitest run`
Expected: 850/852, inchangé.

- [ ] **Step 6: Documenter la faille**

Ajouter en haut de `project-docs/bugs.md` (le fichier s'accumule, nouvelle entrée en haut, jamais d'écrasement) :

```markdown
## FAILLE — `PUT /devis/:id/convertir` sans isolation `boutique_id` (2026-07-30) — CORRIGÉE

Trouvée en préparant `POST /api/factures` : la route ne vérifiait pas que le devis
appartenait à la boutique de l'appelant. Un manager de la boutique B pouvait convertir
un devis de la boutique A en facture — création d'un document comptable dans une
boutique tierce, consommation d'un numéro de séquence, entrée NF525 associée.
Même classe que les failles `GET /tickets/:id` et `PUT/DELETE /tickets/:id`
(2026-07-19). La route voisine `POST /devis/:id/acompte` faisait le contrôle
correctement depuis le départ.

Fix : `getDevis()` + comparaison `boutique_id` + `403`, patron identique à la route
acompte. Gate de non-régression ajoutée dans `tests/e2e/isolation.spec.ts`.
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/facturation.ts tests/e2e/isolation.spec.ts project-docs/bugs.md
git commit -m "fix: isolation boutique_id sur PUT /devis/:id/convertir (faille multi-tenant)"
```

---

### Task 6: Modal facture — nettoyage HTML et TVA

**Files:**
- Modify: `public/factures.html:106-201` (modal `modal-facture`)

**Interfaces:**
- Consumes: rien.
- Produces: les identifiants DOM `f-tva-defaut` (nouveau select), `fl-tva-<lid>` (nouvelle colonne par ligne), et les handlers `saveFacture('brouillon')` / `saveFacture('emettre')` / `saveFacture('emettre_encaisser')` — implémentés en tâche 7. Le nouveau champ `f-date-execution`. Les identifiants supprimés : `f-description`, `f-status`, `f-sig-area`, `f-sig-canvas`, `f-sig-placeholder`.

Cette tâche laisse volontairement le JS cassé entre elle et la tâche 7 (les handlers n'existent pas encore avec cette signature) : les deux tâches se valident ensemble en tâche 9. Ne pas déployer entre les deux.

- [ ] **Step 1: Supprimer le champ Description**

Supprimer ce bloc (`public/factures.html`, dans le premier `form-grid`) :

```html
          <div class="form-field full">
            <label>Description *</label>
            <textarea id="f-description" rows="2" placeholder="Description de la prestation facturée"></textarea>
          </div>
```

Raison : doublon des lignes de facture ; il était concaténé dans `notes`, ce qui salissait les notes.

- [ ] **Step 2: Ajouter la colonne TVA à l'en-tête du tableau des lignes**

Dans le `<thead>` du tableau des lignes, insérer entre la colonne « Prix unit. HT » et « Total HT » :

```html
                  <th style="text-align:right;padding:10px 12px;font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);width:90px;">TVA</th>
```

- [ ] **Step 3: Remplacer le bloc Mode de paiement / Statut**

Remplacer le `form-grid` qui contient `f-payment` et `f-status` par :

```html
        <div class="form-grid" style="margin-top:16px;">
          <div class="form-field">
            <label>Date d'exécution</label>
            <input type="date" id="f-date-execution">
            <small style="color:var(--muted);font-size:0.78rem;">Date de livraison ou de fin de prestation — donnée obligatoire de la facture électronique. Vide = date du jour.</small>
          </div>
          <div class="form-field">
            <label>TVA par défaut</label>
            <select id="f-tva-defaut" onchange="onTvaDefautChange()">
              <option value="20">20 % — taux normal</option>
              <option value="10">10 %</option>
              <option value="5.5">5,5 %</option>
              <option value="0">0 % — exonéré</option>
            </select>
          </div>
          <div class="form-field">
            <label>Mode de paiement</label>
            <select id="f-payment">
              <option>Virement bancaire</option>
              <option>Carte bancaire</option>
              <option>Espèces</option>
              <option>Chèque</option>
            </select>
            <small style="color:var(--muted);font-size:0.78rem;">Utilisé uniquement par « Émettre &amp; encaisser ».</small>
          </div>
          <div class="form-field full">
            <label>Notes / Conditions</label>
            <textarea id="f-notes" rows="2" placeholder="Conditions de paiement, mentions légales..."></textarea>
          </div>
        </div>
```

- [ ] **Step 4: Supprimer le bloc Signature**

Supprimer intégralement le bloc `<!-- Signature -->` (le `div` contenant `f-sig-area`, `f-sig-placeholder`, `f-sig-canvas` et le bouton `clearSig(...)`).

Raison : endpoint inexistant, canvas jamais lu, colonne `factures.signature_client` inexistante. Une facture est opposable par son hash NF525 ; c'est le devis qui porte l'accord signé.

- [ ] **Step 5: Remplacer le footer par les trois actions**

```html
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('modal-facture')">Annuler</button>
        <button class="btn btn-ghost"   onclick="saveFacture('brouillon')">💾 Brouillon</button>
        <button class="btn btn-ghost"   onclick="saveFacture('emettre')">📄 Émettre</button>
        <button class="btn btn-primary" onclick="saveFacture('emettre_encaisser')">💶 Émettre &amp; encaisser</button>
      </div>
```

- [ ] **Step 6: Mettre à jour le texte d'aide du panneau d'info**

Remplacer le contenu du `info-panel` du modal par :

```html
          <span>Créez une facture libre, ou reprenez un devis accepté — ses lignes seront alors reprises telles quelles. « Émettre » verrouille définitivement la facture (obligation NF525).</span>
```

- [ ] **Step 7: Vérifier qu'aucune référence morte ne subsiste dans le HTML**

Run: `grep -n "f-description\|f-status\|f-sig-" public/factures.html`
Expected: aucune sortie.

- [ ] **Step 8: Commit**

```bash
git add public/factures.html
git commit -m "refactor: modal facture - retrait signature/statut/description, ajout TVA + 3 actions"
```

---

### Task 7: `factures.js` — actions réelles, TVA, suppression du fallback

**Files:**
- Modify: `public/static/js/factures.js` — `checkFromDevis()` (l.362), `openNewFacture()` (l.406), `saveFacture()` (l.428), `saveFactureFallback()` (l.498, supprimée), `addFactureLine()` (l.1156), `updateFactureLineTotals()` (l.1200), `updateFactureTotals()` (l.1209), `initSigPad()`/`clearSig()` (l.1225-1264)
- Modify: `public/factures.html` — trois retouches ponctuelles décrites dans les étapes ci-dessous : le libellé statique `TVA (20%)` des totaux, le bandeau `f-devis-banner`, et l'attribut `onchange` du select `f-devis`. Le gros du modal a été posé par la tâche 6 ; il ne s'agit ici que de ce qui accompagne le JS.

**Interfaces:**
- Consumes: identifiants DOM de la tâche 6 (`f-tva-defaut`, `fl-tva-<lid>`, `f-date-execution`) · `apiPost(url, body)` → `{ ok, status, data, error }` (`app.js`) · `POST /api/factures` (tâche 4).
- Produces: `saveFacture(action)`, `onTvaDefautChange()`, `setFactureLinesReadOnly(bool)`, `loadTvaDefautBoutique()` — les trois premiers appelés depuis `factures.html`.

- [ ] **Step 1: Réécrire `saveFacture()`**

Remplacer intégralement `saveFacture(statusLabel)` (l.428-496) par :

```js
// ─── Sauvegarde facture (POST /api/factures) ──────────────────────────────────
/**
 * @param {'brouillon'|'emettre'|'emettre_encaisser'} action
 * Émettre verrouille la facture définitivement (NF525, CGI art. 289) — d'où la
 * confirmation explicite avant les deux actions non réversibles.
 */
async function saveFacture(action) {
  const clientId = parseInt(document.getElementById('f-client')?.value, 10) || null;
  const devisId  = parseInt(document.getElementById('f-devis')?.value,  10) || null;
  const notes    = document.getElementById('f-notes')?.value.trim() || '';
  const modeLabel = document.getElementById('f-payment')?.value || 'Virement bancaire';
  // Donnée du socle réglementaire ; vide = le backend retombe sur la date du jour.
  const dateExec = document.getElementById('f-date-execution')?.value || '';

  if (!clientId) {
    showFlash('⚠️ Veuillez sélectionner un client.', 'error');
    return;
  }

  const lignes = factureLines.map(lid => ({
    description:      document.getElementById('fl-desc-'  + lid)?.value || '',
    quantite:         parseFloat(document.getElementById('fl-qty-'   + lid)?.value) || 1,
    prix_unitaire_ht: parseFloat(document.getElementById('fl-price-' + lid)?.value) || 0,
    tva_taux:         parseFloat(document.getElementById('fl-tva-'   + lid)?.value) || 0,
  })).filter(l => l.description || l.prix_unitaire_ht > 0);

  if (!devisId && !lignes.length) {
    showFlash('⚠️ Ajoutez au moins une ligne à la facture.', 'error');
    return;
  }

  if (action !== 'brouillon') {
    const label = action === 'emettre_encaisser'
      ? 'Émettre cette facture et enregistrer le paiement ?'
      : 'Émettre cette facture ?';
    if (!confirm(`${label}\n\nUne facture émise est définitivement verrouillée et ne peut plus être modifiée (obligation NF525).`)) return;
  }

  const payload = {
    client_id: clientId,
    devis_id:  devisId,
    lignes,
    notes:     notes || undefined,
    date_execution: dateExec || undefined,
    action,
  };
  if (action === 'emettre_encaisser') payload.mode_paiement = modeLabel;

  const res = await apiPost('/api/factures', payload);

  if (!res.ok || !res.data?.success) {
    // Aucun repli local : une facture porte un numéro séquentiel de boutique et un
    // hash NF525, en fabriquer un côté client produirait un document faux. On garde
    // la saisie à l'écran pour que l'utilisateur puisse réessayer.
    const msg = res.data?.error || res.error || 'Erreur lors de la création de la facture.';
    showFlash(`⚠️ ${msg}`, 'error');
    return;
  }

  const numero = res.data.facture_numero || res.data.facture_id;
  closeModal('modal-facture');
  showFlash(`✓ Facture ${numero} ${action === 'brouillon' ? 'enregistrée en brouillon' : 'émise'}`, 'success');
  await loadFactures();
}
```

- [ ] **Step 2: Supprimer le fallback localStorage**

Supprimer intégralement la fonction `saveFactureFallback()` (l.498-544 avant modification), ainsi que la constante `STATUT_LABEL_TO_API` si elle n'est plus référencée nulle part.

Run: `grep -n "saveFactureFallback\|STATUT_LABEL_TO_API" public/static/js/factures.js`
Expected: aucune sortie.

- [ ] **Step 3: Ajouter la colonne TVA dans `addFactureLine()`**

Dans le `tr.innerHTML` de `addFactureLine()`, insérer entre la cellule `fl-price-` et la cellule `fl-total-` :

```js
    <td style="padding:6px 8px;">
      <select id="fl-tva-${lid}"
        style="width:80px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;"
        onchange="updateFactureLineTotals(${lid})">
        <option value="20">20 %</option>
        <option value="10">10 %</option>
        <option value="5.5">5,5 %</option>
        <option value="0">0 %</option>
      </select>
    </td>
```

Puis, à la fin de `addFactureLine()` (après l'insertion de la ligne dans le tbody), appliquer le taux par défaut du document à la nouvelle ligne :

```js
  const tauxDefaut = document.getElementById('f-tva-defaut')?.value || '20';
  const tvaEl = document.getElementById('fl-tva-' + lid);
  if (tvaEl) tvaEl.value = tauxDefaut;
```

- [ ] **Step 4: Recalculer les totaux par ligne avec la TVA réelle**

Remplacer `updateFactureLineTotals()` et `updateFactureTotals()` par :

```js
function updateFactureLineTotals(lid) {
  const qty   = parseFloat(document.getElementById('fl-qty-'   + lid)?.value) || 0;
  const price = parseFloat(document.getElementById('fl-price-' + lid)?.value) || 0;
  const el    = document.getElementById('fl-total-' + lid);
  if (el) el.textContent = formatMoney(qty * price);
  updateFactureTotals();
}

function updateFactureTotals() {
  // Même arrondi comptable que calculLignes() côté backend : chaque ligne est
  // arrondie avant d'être sommée, sinon l'aperçu diffère de la facture émise.
  const round2 = v => Math.round(v * 100) / 100;

  let totalHT = 0, totalTVA = 0;
  factureLines.forEach(lid => {
    const qty   = parseFloat(document.getElementById('fl-qty-'   + lid)?.value) || 0;
    const price = parseFloat(document.getElementById('fl-price-' + lid)?.value) || 0;
    const taux  = parseFloat(document.getElementById('fl-tva-'   + lid)?.value) || 0;
    const ht    = round2(qty * price);
    totalHT  = round2(totalHT + ht);
    totalTVA = round2(totalTVA + round2(ht * taux / 100));
  });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = formatMoney(val); };
  set('f-subtotal-ht', totalHT);
  set('f-total-tva',   totalTVA);
  set('f-total-ttc',   round2(totalHT + totalTVA));
}

/** Applique le taux par défaut à toutes les lignes existantes. */
function onTvaDefautChange() {
  const taux = document.getElementById('f-tva-defaut')?.value || '20';
  factureLines.forEach(lid => {
    const el = document.getElementById('fl-tva-' + lid);
    if (el) el.value = taux;
  });
  updateFactureTotals();
}
```

Mettre à jour le libellé statique `TVA (20%)` dans `public/factures.html` en `TVA` (l'affichage n'est plus mono-taux) — `<div style="font-size:0.9rem;color:var(--muted);">TVA : <strong id="f-total-tva">0,00 €</strong></div>`.

- [ ] **Step 5: Lignes en lecture seule quand un devis est sélectionné**

Ajouter cette fonction près de `checkFromDevis()` :

```js
/**
 * Quand un devis source est choisi, le backend reprend les lignes du devis et
 * ignore celles du formulaire — les afficher éditables mentirait à l'utilisateur.
 */
function setFactureLinesReadOnly(readOnly) {
  factureLines.forEach(lid => {
    ['fl-desc-', 'fl-qty-', 'fl-price-', 'fl-tva-'].forEach(prefix => {
      const el = document.getElementById(prefix + lid);
      if (!el) return;
      el.disabled = readOnly;
      el.style.background = readOnly ? '#f3f4f6' : '';
    });
  });
  const banner = document.getElementById('f-devis-banner');
  if (banner) banner.style.display = readOnly ? 'block' : 'none';
}
```

Ajouter le bandeau dans `public/factures.html`, juste au-dessus du tableau des lignes :

```html
          <div id="f-devis-banner" style="display:none;margin-bottom:10px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:0.85rem;color:#1e40af;">
            Lignes reprises du devis sélectionné — non modifiables ici.
          </div>
```

Brancher le select devis (`public/factures.html`) :

```html
            <select id="f-devis" onchange="setFactureLinesReadOnly(!!this.value)"><option value="">Créer sans devis</option></select>
```

- [ ] **Step 5b: Pré-sélectionner le taux de TVA de la boutique**

Le select « TVA par défaut » ne doit pas être figé sur 20 % : chaque boutique règle son taux dans `settings.html` (`boutique_settings.tva_taux_defaut`), et une boutique en franchise le met à 0. Ajouter :

```js
/**
 * Pré-sélectionne le taux de TVA paramétré par la boutique (multi-tenant).
 * `GET /api/boutiques/:id` retourne `{ ...boutique, settings }` (routes/boutiques.ts:114).
 * Non bloquant : en cas d'échec, le select garde sa valeur par défaut du HTML.
 */
async function loadTvaDefautBoutique() {
  const boutiqueId = getBoutiqueId();
  if (!boutiqueId) return;
  const r = await apiGet(`/api/boutiques/${boutiqueId}`);
  const taux = r.data?.data?.settings?.tva_taux_defaut;
  const el = document.getElementById('f-tva-defaut');
  if (el && taux != null) el.value = String(taux);
}
```

Le taux reste modifiable, globalement et ligne par ligne : une réparation facture couramment une pièce à 20 % et une prestation à 10 %.

- [ ] **Step 6: Nettoyer `openNewFacture()` et la signature**

Dans `openNewFacture()`, remplacer la boucle de réinitialisation et le bloc statut :

```js
  ['f-notes', 'f-date-execution'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const devisEl = document.getElementById('f-devis');
  if (devisEl) devisEl.value = '';
  setFactureLinesReadOnly(false);
```

(supprimer les lignes qui touchent `f-description` et `f-status`).

`openNewFacture()` devient `async` et appelle `await loadTvaDefautBoutique();` **avant** `addFactureLine()` — l'ordre compte : `addFactureLine()` lit `f-tva-defaut` pour initialiser la ligne créée.

Dans `checkFromDevis()`, supprimer le bloc `// Description` qui écrit dans `f-description`, et ajouter `setFactureLinesReadOnly(true);` à la fin du `setTimeout` puisqu'un devis est justement sélectionné.

Supprimer `initSigPad()` et `clearSig()` s'ils ne sont référencés nulle part ailleurs.

Run: `grep -rn "initSigPad\|clearSig\|f-description\|f-status" public/factures.html public/static/js/factures.js`
Expected: aucune sortie. (Si `clearSig` est utilisé par une autre page, le laisser dans le fichier concerné — vérifier avec `grep -rn "clearSig" public/`.)

- [ ] **Step 7: Commit**

```bash
git add public/factures.html public/static/js/factures.js
git commit -m "feat: modal facture branche sur POST /api/factures, TVA par ligne, suppression du fallback local"
```

---

### Task 8: Document imprimé — ventilation TVA, mentions légales, identités figées

**Files:**
- Modify: `public/static/js/factures.js` — `_fetchFacturePrintData()` (l.972) et `_buildFactureHTML()` (l.1033)

**Interfaces:**
- Consumes: colonnes `date_execution`, `vendeur_snapshot`, `acheteur_snapshot` (tâche 3), exposées telles quelles par `GET /api/factures/:id` (`getFacture()` fait `SELECT f.*`, aucun changement backend nécessaire).
- Produces: rien de consommé par une tâche suivante.

**Le texte des mentions légales ci-dessous est statutaire** (articles cités, non rédigé librement) **et a été validé par l'utilisateur le 2026-07-30**. Le reformuler, le compléter ou en ajouter d'autres est hors périmètre — le workspace interdit d'inventer un texte légal.

- [ ] **Step 1: Exposer les nouvelles données dans `_fetchFacturePrintData()`**

Dans le `return { … }` de `_fetchFacturePrintData()`, ajouter après `hash_nf525` :

```js
    dateExec:     raw.date_execution || '',
    // Identités : le snapshot figé à l'émission fait foi. Une facture émise ne doit
    // jamais être re-rendue depuis les fiches vivantes (elle est inaltérable, NF525).
    // Un brouillon n'a pas de snapshot et retombe donc sur la jointure vivante.
    vendeurFige:  _parseSnapshot(raw.vendeur_snapshot),
    acheteurFige: _parseSnapshot(raw.acheteur_snapshot),
    ventilation:  _ventilationTVA(lignes),
```

Puis ajouter ces deux helpers juste au-dessus de `_fetchFacturePrintData()` :

```js
/** Lit une colonne snapshot JSON. Retourne null si absente ou illisible (brouillon). */
function _parseSnapshot(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return (o && Object.keys(o).length) ? o : null;
  } catch { return null; }
}

/**
 * Ventile le total HT et la TVA par taux — donnée du socle réglementaire de la
 * facture électronique ("montant total HT par taux de TVA").
 * @returns {Array<{taux:number, ht:number, tva:number}>} trié par taux décroissant
 */
function _ventilationTVA(lignes) {
  const round2 = v => Math.round(v * 100) / 100;
  const parTaux = new Map();
  (lignes || []).forEach(l => {
    const taux = parseFloat(l.tva_taux) || 0;
    const ht   = parseFloat(l.total_ht)  || 0;
    const tva  = parseFloat(l.total_tva) || 0;
    const acc  = parTaux.get(taux) || { taux, ht: 0, tva: 0 };
    acc.ht  = round2(acc.ht  + ht);
    acc.tva = round2(acc.tva + tva);
    parTaux.set(taux, acc);
  });
  return [...parTaux.values()].sort((a, b) => b.taux - a.taux);
}
```

- [ ] **Step 2: Afficher les identités figées et la date d'exécution**

Dans `_buildFactureHTML()`, là où le bloc client est construit, préférer le snapshot quand il existe. Ajouter en tête de la fonction :

```js
  // Identités affichées : snapshot figé si la facture est émise, sinon jointure vivante.
  const ach = d.acheteurFige;
  const clientNomAffiche = ach
    ? (ach.raison_sociale || [ach.prenom, ach.nom].filter(Boolean).join(' '))
    : d.clientNom;
  const clientIdent = ach && ach.siret
    ? `SIRET ${esc(ach.siret)}${ach.tva_intracom ? ' · TVA ' + esc(ach.tva_intracom) : ''}`
    : '';
  const clientAdresseAffichee = ach
    ? [ach.adresse, [ach.code_postal, ach.ville].filter(Boolean).join(' ')].filter(Boolean).join('<br>')
    : esc(d.clientAdresse || '');
```

Utiliser `clientNomAffiche`, `clientIdent` et `clientAdresseAffichee` dans le bloc client du document à la place des valeurs vivantes actuelles (`d.clientNom`, `d.clientAdresse`).

Ajouter la date d'exécution à côté de la date d'émission, dans le bloc des dates :

```js
        ${d.dateExec ? `<div>Date d'exécution : <strong>${esc(d.dateExec)}</strong></div>` : ''}
```

- [ ] **Step 3: Ajouter la ventilation de TVA sous les totaux**

Insérer, juste après le bloc des totaux (sous-total HT / TVA / TTC) et avant le pied de page :

```js
      ${d.ventilation && d.ventilation.length ? `
      <table class="print-tva-table" style="width:auto;margin-left:auto;margin-top:10px;border-collapse:collapse;font-size:0.82rem;">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 10px;border-bottom:1px solid #d1d5db;">Taux TVA</th>
            <th style="text-align:right;padding:4px 10px;border-bottom:1px solid #d1d5db;">Base HT</th>
            <th style="text-align:right;padding:4px 10px;border-bottom:1px solid #d1d5db;">Montant TVA</th>
          </tr>
        </thead>
        <tbody>
          ${d.ventilation.map(v => `
          <tr>
            <td style="padding:4px 10px;">${v.taux.toString().replace('.', ',')} %</td>
            <td style="padding:4px 10px;text-align:right;">${formatMoney(v.ht)}</td>
            <td style="padding:4px 10px;text-align:right;">${formatMoney(v.tva)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
```

- [ ] **Step 4: Ajouter les mentions légales obligatoires**

Insérer dans le pied de page du document, avant la mention du hash NF525 :

```js
      <div class="print-mentions" style="margin-top:14px;font-size:0.72rem;color:#6b7280;line-height:1.5;">
        ${d.mentionBoutique ? `<div>${esc(d.mentionBoutique)}</div>` : ''}
        <div>En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera exigible (art. L441-10 du code de commerce), ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 € (art. D441-5 du code de commerce).</div>
        <div>Pas d'escompte pour paiement anticipé.</div>
      </div>
```

`mentionBoutique` est calculée à l'étape 1. Règle, décidée avec l'utilisateur le 2026-07-30 :

- Si la boutique a saisi une `mention_facture`, c'est **son** texte qui s'affiche — jamais réécrit.
- Sinon, et seulement si la boutique est en franchise (`tva_taux_defaut === 0`, cas des auto-entrepreneurs et micro-entreprises), on affiche la mention statutaire « TVA non applicable, article 293 B du CGI. »
- Sinon, rien.

Les pénalités de retard et l'absence d'escompte sont **toujours** affichées, à titre informatif, en pied de facture — elles ne dépendent d'aucun paramétrage.

Ajouter ce calcul au `return` de `_fetchFacturePrintData()`, à la suite des champs de l'étape 1 :

```js
    mentionBoutique: (() => {
      const v = _parseSnapshot(raw.vendeur_snapshot);
      // Facture émise : la mention suit le snapshot. Brouillon : paramétrage vivant.
      const mention = v ? v.mention_facture : (boutique.mention_facture || null);
      if (mention) return mention;
      const taux = v ? v.tva_taux_defaut : boutique.tva_taux_defaut;
      return Number(taux) === 0 ? 'TVA non applicable, article 293 B du CGI.' : null;
    })(),
```

Et compléter la lecture du profil boutique de `_fetchFacturePrintData()` (le bloc `apiGet('/api/boutiques')`, qui alimente `boutique`) pour récupérer aussi le paramétrage — `GET /api/boutiques/:id` retourne `{ ...boutique, settings }` (`src/routes/boutiques.ts:114`) :

```js
      tva_taux_defaut: b.settings?.tva_taux_defaut ?? 20,
      mention_facture: b.settings?.mention_facture  ?? null,
```

- [ ] **Step 5: Valider le rendu en local live**

Serveur local démarré, se connecter, ouvrir une facture **émise** (créée en tâche 4 ou 9) et lancer l'impression (Ctrl+P, aperçu uniquement — ne pas imprimer réellement).

Vérifier :
1. La ventilation TVA apparaît avec une ligne par taux réellement présent sur la facture (créer une facture à deux taux pour ce test).
2. Les trois mentions légales sont présentes et lisibles.
3. L'identité du client affiche le SIRET quand le client est professionnel.
4. La date d'exécution s'affiche.
5. Le document tient toujours **sur une seule page A4** — le garde-fou `.print-compact` de `_triggerPrint()` doit absorber le contenu ajouté (`CLAUDE.md` § Documents imprimables). Si le contenu déborde malgré le garde-fou, le signaler comme DONE_WITH_CONCERNS plutôt que de contourner le mécanisme.
6. Ouvrir ensuite une facture **en brouillon** : elle n'a pas de snapshot et doit continuer à afficher les identités vivantes sans rien casser.

- [ ] **Step 6: Commit**

```bash
git add public/static/js/factures.js
git commit -m "feat: document facture - ventilation TVA, mentions legales, identites figees"
```

---

### Task 9: Validation live et cache

**Files:**
- Modify: `public/sw.js` (`CACHE_VERSION`)
- Modify: `project-docs/todo.md` (cocher l'item `factures.html`)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien.

- [ ] **Step 1: Bumper `CACHE_VERSION`**

Dans `public/sw.js`, passer `CACHE_VERSION` de `v2.79` à `v2.80`. Obligatoire dès que `public/static/js/*` ou `public/*.html` change (règle `CLAUDE.md`).

- [ ] **Step 2: Rebuild et démarrer le serveur local**

```bash
npm run build
npx wrangler pages dev dist --local --port 3000
```

- [ ] **Step 3: Valider les trois actions dans le navigateur**

Se connecter (`admin@izigsm.fr` / `Admin@2026!`), aller sur `/factures`, ouvrir « Nouvelle facture » et vérifier, **console navigateur ouverte, zéro erreur** :

1. **Brouillon** — client + 2 lignes à taux différents (20 % et 10 %) → les totaux affichés correspondent aux totaux calculés par le backend, la facture apparaît dans la liste au statut Brouillon.
2. **Émettre** — la confirmation s'affiche ; après validation, la facture passe en attente.
3. **Émettre & encaisser** — mode de paiement « Espèces » → facture payée.
4. **Devis source** — sélectionner un devis : les lignes passent en grisé non modifiables et le bandeau bleu s'affiche.
5. **Cas d'erreur** — soumettre sans client : message d'erreur, modal **toujours ouvert**, saisie intacte.

- [ ] **Step 4: Vérifier la persistance réelle en base**

```bash
npx wrangler d1 execute DB --local --command "SELECT id, numero, statut, locked, total_ht, total_tva, total_ttc, hash_nf525, date_execution FROM factures ORDER BY id DESC LIMIT 3"
npx wrangler d1 execute DB --local --command "SELECT id, statut, locked, vendeur_snapshot, acheteur_snapshot FROM factures ORDER BY id DESC LIMIT 3"
npx wrangler d1 execute DB --local --command "SELECT document_id, ordre, description, tva_taux, total_ttc FROM lignes_document WHERE document_type='facture' ORDER BY id DESC LIMIT 6"
npx wrangler d1 execute DB --local --command "SELECT facture_id, montant, mode_paiement FROM paiements ORDER BY id DESC LIMIT 2"
```

Expected: les 3 factures avec les bons statuts (`brouillon` / `en_attente` / `payee`), `locked` à 0 puis 1 puis 1, `hash_nf525` non nul pour les deux émises, les lignes avec leurs taux respectifs, un paiement au montant TTC exact. `date_execution` renseignée sur les trois. **Snapshots** : `vendeur_snapshot` et `acheteur_snapshot` renseignés (JSON contenant le SIRET) sur les deux factures émises, et **nuls sur le brouillon** — c'est le comportement voulu, une facture non verrouillée continue de lire les fiches vivantes.

Vérifier enfin l'invariant d'immuabilité : modifier l'adresse du client dans `/clients`, réimprimer la facture émise, et confirmer que le document affiche toujours **l'ancienne** adresse (celle figée à l'émission).

- [ ] **Step 5: Suite complète**

Run: `npx vitest run` puis `npm run test:e2e`
Expected: 850/852 (les 2 échecs de fuseau pré-existants) et E2E entièrement verts.

- [ ] **Step 6: Cocher le backlog**

Dans `project-docs/todo.md`, § « 🔴 P1 — Audit persistance des champs », remplacer l'item `factures.html` par :

```markdown
- [x] `factures.html` — corrigé 2026-07-30 : `POST /api/factures` implémenté (`createFacture()` + délégation `convertirDevis()`), 3 actions explicites (brouillon / émettre / émettre & encaisser), TVA par ligne, signature morte retirée du modal, fallback localStorage supprimé. Socle de la facture électronique ajouté au passage (migration `0037` : date d'exécution, snapshot vendeur/acheteur figé à l'émission, régime de franchise TVA ; ventilation TVA et mentions légales sur le document imprimé) — le format structuré UBL/CII et le raccordement PDP restent un chantier dédié. Faille d'isolation trouvée et corrigée sur `PUT /devis/:id/convertir` (voir `bugs.md`). Validé en local live + gates vitest/Playwright.
```

- [ ] **Step 7: Commit**

```bash
git add public/sw.js project-docs/todo.md
git commit -m "chore: bump CACHE_VERSION v2.80 + todo factures.html coche"
```

---

## Non couvert par ce plan

Volontairement hors périmètre (voir la spec § Hors périmètre) : email de facture au client, workflow de facturation automatique ticket terminé → brouillon, configuration HT/TTC par boutique, et les quatre fichiers restants au pattern `r.success` / `r.data` (`reconditionnement.js`, `fournisseurs.js`, `caisse.js`, `services.js`).

**Facturation électronique — format et transmission** : génération UBL 2.1 / CII D22B (ou Factur-X), raccordement à une plateforme agréée (PDP), statuts normalisés du cycle de vie, e-reporting. Chantier dédié, à cadrer par son propre `superpowers:brainstorming`. Ce plan se limite à capturer et figer les données que ce format exigera — c'est la partie qu'il serait coûteux de rattraper après coup, les factures émises étant verrouillées.

Aucun nouveau champ de paramétrage n'est ajouté à `settings.html` : le régime de TVA se déduit de `boutique_settings.tva_taux_defaut` et la mention de `boutique_settings.mention_facture`, tous deux déjà saisissables. Les templates **devis** et **avoir** n'affichent pas non plus `mention_facture` — l'y étendre est un item de suivi, hors de ce plan.

Le déploiement en production n'est pas dans ce plan : il reste une décision humaine explicite.
