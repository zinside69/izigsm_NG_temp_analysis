# Isolation des routes par ID — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer les 13 failles d'isolation multi-tenant sur les routes par ID, et empêcher structurellement l'apparition de la quatorzième.

**Architecture:** Chaque route charge sa ressource puis délègue la décision d'accès à `assertBoutiqueOwnership()` (`src/lib/middleware.ts`), helper déjà en production depuis le 2026-07-31. Un test de conformité analyse statiquement `src/routes/*.ts` et échoue si une route par ID n'a ni garde ni exemption motivée.

**Tech Stack:** Hono (TypeScript) sur Cloudflare Pages · D1 (SQLite) · Vitest (unitaire + conformité) · Playwright (E2E) · Vite

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-07-31-isolation-routes-par-id-design.md`
- Baseline `npx vitest run` : **855/857** — les 2 échecs permanents sont les tests de fuseau d'`agendaService`. Tout autre échec est une régression.
- Baseline `npx tsc --noEmit` : **32 erreurs** préexistantes. Aucune ne doit s'ajouter.
- **`wrangler pages dev` ne recharge PAS `dist/` automatiquement.** Après chaque `npm run build`, tuer le serveur et le relancer, sinon les tests Playwright s'exécutent contre l'ancien bundle et donnent un faux rouge (piège rencontré le 2026-07-31) :
  ```powershell
  Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- Commits en français, format `type: message`. **Jamais de `Co-Authored-By`.**
- Aucun fichier `public/**` n'est touché par ce chantier → **pas de bump `CACHE_VERSION`**.
- Ne jamais déployer : `npm run deploy` est un geste humain explicite.
- Le helper renvoie `404` si la ressource est absente, `403` si elle appartient à une autre boutique, et laisse passer le rôle `admin`.

### Démarrage du serveur local (prérequis de toute tâche avec Playwright)

```bash
npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --file=seed.sql
npm run build
npx wrangler pages dev dist --local --port 3000
```

### Données du seed disponibles (boutique 1)

- `employes` : ids **1, 2, 3**
- `produits` : ids **1 à 9**
- Compte admin plateforme du seed : `admin@izigsm.fr` / `Admin@2026!` (`boutique_id` NULL)
- `fournisseurs`, `bons_commande`, `categories_services` : **aucune donnée** → fixtures via API

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `tests/e2e/isolation-routes.spec.ts` | **Créer** — tests E2E des 16 routes (refus étranger / accès propriétaire / accès admin) |
| `tests/routes-isolation-conformite.test.ts` | **Créer** — test de conformité statique + liste d'exemptions |
| `src/routes/stocks.ts` | Modifier — 3 gardes |
| `src/routes/personnel.ts` | Modifier — 3 gardes |
| `src/routes/tickets.ts` | Modifier — 1 garde |
| `src/routes/fournisseurs.ts` | Modifier — 4 gardes |
| `src/routes/services.ts` | Modifier — 2 gardes + 3 changements de rôle |
| `project-docs/todo.md`, `bugs.md`, `CLAUDE.md` | Modifier — clôture documentaire |

---

### Task 1 : Socle de test + domaine Stock (3 routes)

**Files:**
- Create: `tests/e2e/isolation-routes.spec.ts`
- Modify: `src/routes/stocks.ts:98`, `:173`, `:193`
- Test: `tests/e2e/isolation-routes.spec.ts`

**Interfaces:**
- Consumes : `createTenantAdmin(request)` depuis `tests/e2e/fixtures/tenant.ts` — retourne `{ email, accessToken, boutiqueId }`. Le compte créé est un **`manager`** (`role_id = 2`) avec sa propre boutique.
- Produces : `loginSeedAdmin(request): Promise<string>` et `authHeader(token): { Authorization: string }`, réutilisés par toutes les tâches suivantes.

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

/**
 * Isolation des routes par ID — voir
 * docs/superpowers/specs/2026-07-31-isolation-routes-par-id-design.md
 *
 * Trois cas par domaine : l'etranger est refuse, le proprietaire passe,
 * l'admin plateforme passe (capacite de depannage, garantie par test).
 */

const PRODUIT_BOUTIQUE_1 = 1   // seed.sql : produits ids 1..9, boutique 1

/** Connexion au compte admin plateforme du seed (boutique_id NULL). */
async function loginSeedAdmin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@izigsm.fr', password: 'Admin@2026!' },
  })
  if (!res.ok()) throw new Error(`login admin seed failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).accessToken
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

test.describe('Isolation — Stock', () => {
  test('un manager d\'une autre boutique ne peut pas lire un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas modifier un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
      data: { nom: 'Renomme par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas supprimer un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.delete(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit le produit de n\'importe quelle boutique', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/produits/${PRODUIT_BOUTIQUE_1}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit et modifie son propre produit', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/produits', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Produit du proprietaire', prix_vente_ht: 10, tva_taux: 20 },
    })
    expect(creation.status()).toBe(201)
    const produitId = (await creation.json()).id

    const lecture = await request.get(`/api/produits/${produitId}`, { headers: authHeader(proprio.accessToken) })
    expect(lecture.status()).toBe(200)

    const modif = await request.put(`/api/produits/${produitId}`, {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Renomme par son proprietaire' },
    })
    expect(modif.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx playwright test tests/e2e/isolation-routes.spec.ts`
Expected: les 3 tests de refus ÉCHOUENT avec `Expected value: 200` / `Received array: [403, 404]`. Les 2 tests d'accès légitime PASSENT déjà.

Si un test de refus passe d'emblée, la garde existe déjà — vérifier avant d'aller plus loin.

- [ ] **Step 3: Ajouter les gardes dans `src/routes/stocks.ts`**

`GET /produits/:id` (ligne 98) :

```typescript
stocks.get('/produits/:id', async (c) => {
  const { dbPort } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  const data = await getProduitById(dbPort, id)

  // Isolation multi-tenant : ne jamais servir le produit d'une autre boutique
  const deny = assertBoutiqueOwnership(c.get('user'), data, 'Produit')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  return c.json({ success: true, data })
})
```

`PUT /produits/:id` (ligne 173) — la garde précède l'appel au service :

```typescript
stocks.put('/produits/:id', requireRole('admin', 'manager'), async (c) => {
  const { user, db, dbPort } = ctx(c)
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  // Isolation multi-tenant : ne jamais modifier le produit d'une autre boutique
  const produit = await getProduitById(dbPort, id)
  const deny = assertBoutiqueOwnership(user, produit, 'Produit')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  try {
    await updateProduit(db, id, user.sub, body)
    return c.json({ success: true, message: 'Produit mis à jour.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})
```

`DELETE /produits/:id` (ligne 193) :

```typescript
stocks.delete('/produits/:id', requireRole('admin', 'manager'), async (c) => {
  const { user, db, dbPort } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : ne jamais désactiver le produit d'une autre boutique
  const produit = await getProduitById(dbPort, id)
  const deny = assertBoutiqueOwnership(user, produit, 'Produit')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await deleteProduit(db, id, user.sub)
  return c.json({ success: true, message: 'Produit désactivé.' })
})
```

Ajouter `assertBoutiqueOwnership` à l'import existant de `../lib/middleware` en haut du fichier. Vérifier que `ctx(c)` expose bien `dbPort` ; sinon utiliser `c.get('db')`.

- [ ] **Step 4: Rebuild, redémarrer le serveur, relancer les tests**

```bash
npm run build
# tuer puis relancer wrangler pages dev (voir Global Constraints)
npx playwright test tests/e2e/isolation-routes.spec.ts
```

Expected: **5/5 PASS**.

- [ ] **Step 5: Vérifier l'absence de régression**

Run: `npx vitest run` → 855/857 · `npx tsc --noEmit` → 32 · `npx playwright test tests/e2e/` → tous verts (18 cas existants inclus).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/isolation-routes.spec.ts src/routes/stocks.ts
git commit -m "fix: isolation boutique_id sur les 3 routes produits par ID"
```

---

### Task 2 : Personnel (3 routes)

**Files:**
- Modify: `tests/e2e/isolation-routes.spec.ts`, `src/routes/personnel.ts:49`, `:80`, `:126`

**Interfaces:**
- Consumes : `loginSeedAdmin`, `authHeader` (Task 1)
- Produces : rien de nouveau

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
const EMPLOYE_BOUTIQUE_1 = 1   // seed.sql : employes ids 1,2,3 — boutique 1

test.describe('Isolation — Personnel', () => {
  test('un manager d\'une autre boutique ne peut pas lire la fiche d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas modifier la fiche d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
      data: { poste: 'modifie par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas lire le pointage d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/pointage/${EMPLOYE_BOUTIQUE_1}/aujourd-hui`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit la fiche employe de n\'importe quelle boutique', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit la fiche de son propre employe', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/employes', {
      headers: authHeader(proprio.accessToken),
      data: { prenom: 'Employe', nom: 'DuProprietaire', poste: 'technicien' },
    })
    expect(creation.status()).toBe(201)
    const employeId = (await creation.json()).id

    const res = await request.get(`/api/employes/${employeId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx playwright test tests/e2e/isolation-routes.spec.ts -g "Personnel"`
Expected: les 3 tests de refus ÉCHOUENT (reçu `200`).

- [ ] **Step 3: Ajouter les gardes dans `src/routes/personnel.ts`**

```typescript
personnel.get('/employes/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getEmploye(c.get('db'), id)

  // Isolation multi-tenant : fiche employé = donnée RH d'une boutique
  const deny = assertBoutiqueOwnership(c.get('user'), data, 'Employé')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  return c.json({ success: true, data })
})
```

```typescript
personnel.put('/employes/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  // Isolation multi-tenant : ne jamais modifier l'employé d'une autre boutique
  const employe = await getEmploye(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, employe, 'Employé')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await updateEmploye(c.get('db'), id, body)
  return c.json({ success: true, message: 'Employé mis à jour.' })
})
```

```typescript
personnel.get('/pointage/:employeId/aujourd-hui', async (c) => {
  const employeId = parseInt(c.req.param('employeId'), 10)

  // Isolation multi-tenant : le pointage suit la boutique de l'employé
  const employe = await getEmploye(c.get('db'), employeId)
  const deny = assertBoutiqueOwnership(c.get('user'), employe, 'Employé')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  const result = await pointagesAujourdhui(c.get('db'), employeId)
  return c.json({ success: true, employe_id: employeId, ...result })
})
```

Ajouter `assertBoutiqueOwnership` à l'import de `../lib/middleware`. Vérifier que `getEmploye()` renvoie bien `boutique_id` ; sinon faire une lecture ciblée `SELECT boutique_id FROM employes WHERE id = ?`.

- [ ] **Step 4: Vérifier que les tests passent**

Run: rebuild + redémarrage serveur, puis `npx playwright test tests/e2e/isolation-routes.spec.ts`
Expected: 10/10 PASS (Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/isolation-routes.spec.ts src/routes/personnel.ts
git commit -m "fix: isolation boutique_id sur les routes employes et pointage"
```

---

### Task 3 : Archivage de ticket (1 route)

**Files:**
- Modify: `tests/e2e/isolation-routes.spec.ts`, `src/routes/tickets.ts:135`

**Interfaces:**
- Consumes : `loginSeedAdmin`, `authHeader` (Task 1)

Cette route est le symptôme central du problème : `tickets.ts` a été audité et corrigé le 2026-07-19 (`GET`, `PUT`, `DELETE /:id`), mais `POST /:id/archiver` est passée à travers.

- [ ] **Step 1: Écrire le test qui échoue**

```typescript
const TICKET_BOUTIQUE_1 = 1   // seed.sql : ticket 1 appartient a la boutique 1

test.describe('Isolation — Tickets', () => {
  test('un manager d\'une autre boutique ne peut pas archiver un ticket qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.post(`/api/tickets/${TICKET_BOUTIQUE_1}/archiver`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme n\'est pas bloque par la garde d\'archivage', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.post(`/api/tickets/${TICKET_BOUTIQUE_1}/archiver`, { headers: authHeader(token) })
    // 200 (archive) ou 409 (deja archive) : les deux prouvent que la garde a laisse
    // passer l'admin. Un 403 signalerait une sur-restriction.
    expect([200, 409]).toContain(res.status())
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx playwright test tests/e2e/isolation-routes.spec.ts -g "archiver"`
Expected: ÉCHOUE avec `200` (ou `409` si le ticket est déjà archivé — dans ce cas, utiliser un autre id de ticket de la boutique 1, le `409` ne prouverait rien).

- [ ] **Step 3: Ajouter la garde dans `src/routes/tickets.ts`**

```typescript
tickets.post('/:id/archiver', requireRole('admin', 'manager'), async (c) => {
  const { user, db } = ctx(c)
  const id = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : ne jamais archiver le ticket d'une autre boutique.
  // Route omise par la campagne de correction du 2026-07-19 sur ce fichier.
  const ticket = await c.get('db').get<{ boutique_id: number }>(
    'SELECT boutique_id FROM tickets WHERE id = ?', [id]
  )
  const deny = assertBoutiqueOwnership(user, ticket, 'Ticket')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  try {
    await archiveTicket(db, id, user.sub)
    return c.json({ success: true, message: `Ticket #${id} archivé.` })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('déjà')        ? 409
                 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})
```

- [ ] **Step 4: Vérifier que le test passe**

Run: rebuild + redémarrage serveur, puis `npx playwright test tests/e2e/`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/isolation-routes.spec.ts src/routes/tickets.ts
git commit -m "fix: isolation boutique_id sur POST /tickets/:id/archiver"
```

---

### Task 4 : Fournisseurs et bons de commande (4 routes)

**Files:**
- Modify: `tests/e2e/isolation-routes.spec.ts`, `src/routes/fournisseurs.ts:88`, `:97`, `:111`, `:162`

**Interfaces:**
- Consumes : `loginSeedAdmin`, `authHeader` (Task 1)
- Produces : `createFournisseurBoutique1(request): Promise<number>` — utilisé aussi par le bon de commande

Aucune donnée de fournisseur dans le seed : les fixtures créent la ressource côté boutique 1 via l'API avec le compte admin. `POST /fournisseurs` exige `{ nom }` (`validateFournisseur`) et un `boutique_id` explicite pour un admin plateforme.

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
/** Cree un fournisseur cote boutique 1 via l'API (aucun fournisseur dans seed.sql). */
async function createFournisseurBoutique1(request: APIRequestContext): Promise<number> {
  const token = await loginSeedAdmin(request)
  const res = await request.post('/api/fournisseurs', {
    headers: authHeader(token),
    data: { nom: 'Fournisseur Boutique 1 (fixture e2e)', boutique_id: 1 },
  })
  if (!res.ok()) throw new Error(`creation fournisseur failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

test.describe('Isolation — Fournisseurs', () => {
  test('un manager d\'une autre boutique ne peut pas lire un fournisseur etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas modifier un fournisseur etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(etranger.accessToken),
      data: { nom: 'Renomme par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas desactiver un fournisseur etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.delete(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas changer le statut d\'un bon de commande etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const token = await loginSeedAdmin(request)
    const creation = await request.post('/api/bons-commande', {
      headers: authHeader(token),
      data: {
        fournisseur_id: fournisseurId,
        boutique_id: 1,
        lignes: [{ designation: 'Ecran de test', quantite_commandee: 2, prix_achat_ht: 30 }],
      },
    })
    if (!creation.ok()) throw new Error(`creation bon failed: ${creation.status()} ${await creation.text()}`)
    const bonId = (await creation.json()).id

    const etranger = await createTenantAdmin(request)
    const res = await request.patch(`/api/bons-commande/${bonId}/statut`, {
      headers: authHeader(etranger.accessToken),
      data: { statut: 'cancelled' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit le fournisseur de n\'importe quelle boutique', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/fournisseurs/${fournisseurId}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit son propre fournisseur', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/fournisseurs', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Fournisseur du proprietaire' },
    })
    expect(creation.status()).toBe(201)
    const fournisseurId = (await creation.json()).id

    const res = await request.get(`/api/fournisseurs/${fournisseurId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx playwright test tests/e2e/isolation-routes.spec.ts -g "Fournisseurs"`
Expected: les 4 tests de refus ÉCHOUENT (reçu `200`).

- [ ] **Step 3: Ajouter les gardes dans `src/routes/fournisseurs.ts`**

```typescript
fournisseurs.get('/fournisseurs/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getFournisseur(c.get('db'), id)

  // Isolation multi-tenant : ne jamais servir le fournisseur d'une autre boutique
  const deny = assertBoutiqueOwnership(c.get('user'), data, 'Fournisseur')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  return c.json({ success: true, data })
})
```

```typescript
fournisseurs.put('/fournisseurs/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  const error = validateFournisseur(body)
  if (error) return c.json({ success: false, error }, 400)

  // Isolation multi-tenant : ne jamais modifier le fournisseur d'une autre boutique
  const fournisseur = await getFournisseur(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, fournisseur, 'Fournisseur')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await updateFournisseur(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Fournisseur mis à jour.' })
})
```

```typescript
fournisseurs.delete('/fournisseurs/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : ne jamais désactiver le fournisseur d'une autre boutique
  const fournisseur = await getFournisseur(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, fournisseur, 'Fournisseur')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await deleteFournisseur(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Fournisseur désactivé.' })
})
```

```typescript
fournisseurs.patch('/bons-commande/:id/statut', requireRole('admin', 'manager'), async (c) => {
  const user   = c.get('user')
  const id     = parseInt(c.req.param('id'), 10)
  const { statut } = await c.req.json()

  if (!statut) return c.json({ success: false, error: 'statut obligatoire.' }, 400)
  if (statut === 'received') return c.json({ success: false, error: 'Utilisez /receptionner pour réceptionner un bon.' }, 400)

  // Isolation multi-tenant : la garde précède le service, qui applique ensuite
  // ses propres règles de transition d'état (ne pas les modifier).
  const bon = await c.get('db').get<{ boutique_id: number }>(
    'SELECT boutique_id FROM bons_commande WHERE id = ?', [id]
  )
  const deny = assertBoutiqueOwnership(user, bon, 'Bon de commande')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  try {
    await updateStatutBonCommande(c.env.DB, id, statut, user.sub)
    return c.json({ success: true, message: `Statut mis à jour : ${statut}.` })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: rebuild + redémarrage serveur, puis `npx playwright test tests/e2e/isolation-routes.spec.ts`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/isolation-routes.spec.ts src/routes/fournisseurs.ts
git commit -m "fix: isolation boutique_id sur fournisseurs et bons de commande"
```

---

### Task 5 : Catégories de services (2 routes)

**Files:**
- Modify: `tests/e2e/isolation-routes.spec.ts`, `src/routes/services.ts:176`, `:199`

**Interfaces:**
- Consumes : `loginSeedAdmin`, `authHeader` (Task 1)

`POST /services/categories` exige `{ nom }` (`validateCategorieService`) et `boutique_id` explicite pour un admin.

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
/** Cree une categorie de services cote boutique 1 (aucune dans seed.sql). */
async function createCategorieBoutique1(request: APIRequestContext): Promise<number> {
  const token = await loginSeedAdmin(request)
  const res = await request.post('/api/services/categories', {
    headers: authHeader(token),
    data: { nom: 'Categorie Boutique 1 (fixture e2e)', boutique_id: 1 },
  })
  if (!res.ok()) throw new Error(`creation categorie failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

test.describe('Isolation — Categories de services', () => {
  test('un manager d\'une autre boutique ne peut pas modifier une categorie etrangere', async ({ request }) => {
    const categorieId = await createCategorieBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/services/categories/${categorieId}`, {
      headers: authHeader(etranger.accessToken),
      data: { nom: 'Renommee par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas desactiver une categorie etrangere', async ({ request }) => {
    const categorieId = await createCategorieBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.delete(`/api/services/categories/${categorieId}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme modifie la categorie de n\'importe quelle boutique', async ({ request }) => {
    const categorieId = await createCategorieBoutique1(request)
    const token = await loginSeedAdmin(request)
    const res = await request.put(`/api/services/categories/${categorieId}`, {
      headers: authHeader(token),
      data: { nom: 'Renommee par l\'admin plateforme' },
    })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime modifie sa propre categorie', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/services/categories', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Categorie du proprietaire' },
    })
    expect(creation.status()).toBe(201)
    const categorieId = (await creation.json()).id

    const res = await request.put(`/api/services/categories/${categorieId}`, {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Renommee par son proprietaire' },
    })
    expect(res.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx playwright test tests/e2e/isolation-routes.spec.ts -g "Categories"`
Expected: les 2 tests de refus ÉCHOUENT (reçu `200`).

- [ ] **Step 3: Ajouter les gardes dans `src/routes/services.ts`**

Une lecture ciblée est nécessaire : il n'existe pas de `getCategorie()` exporté renvoyant `boutique_id`.

```typescript
services.put('/services/categories/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()

  const error = validateCategorieService(body)
  if (error) return c.json({ success: false, error }, 400)

  // Isolation multi-tenant : ne jamais modifier la catégorie d'une autre boutique
  const categorie = await c.get('db').get<{ boutique_id: number }>(
    'SELECT boutique_id FROM categories_services WHERE id = ?', [id]
  )
  const deny = assertBoutiqueOwnership(user, categorie, 'Catégorie')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await updateCategorie(c.env.DB, id, body, user.sub)
  return c.json({ success: true, message: 'Catégorie mise à jour.' })
})
```

```typescript
services.delete('/services/categories/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : la suppression désactive aussi les services liés
  const categorie = await c.get('db').get<{ boutique_id: number }>(
    'SELECT boutique_id FROM categories_services WHERE id = ?', [id]
  )
  const deny = assertBoutiqueOwnership(user, categorie, 'Catégorie')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  await deleteCategorie(c.env.DB, id, user.sub)
  return c.json({ success: true, message: 'Catégorie désactivée (et ses services).' })
})
```

Conserver le message de succès existant à l'identique (`'Catégorie mise à jour.'` — vérifier la formulation réelle dans le fichier avant de la réécrire).

- [ ] **Step 4: Vérifier que les tests passent**

Run: rebuild + redémarrage serveur, puis `npx playwright test tests/e2e/isolation-routes.spec.ts`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/isolation-routes.spec.ts src/routes/services.ts
git commit -m "fix: isolation boutique_id sur les categories de services"
```

---

### Task 6 : Référentiel global — écriture réservée à l'admin plateforme (3 routes)

**Files:**
- Modify: `tests/e2e/isolation-routes.spec.ts`, `src/routes/services.ts:454`, `:494`, `:504`

**Interfaces:**
- Consumes : `loginSeedAdmin`, `authHeader` (Task 1)

Ce n'est **pas** une correction d'isolation : `marques_appareils` et `modeles_appareils` sont volontairement globales depuis la migration `0031` (Sprint 2.39). Le problème est qu'un manager peut modifier un référentiel partagé par toutes les boutiques. La correction est un changement de rôle.

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
test.describe('Referentiel global — ecriture reservee a l\'admin plateforme', () => {
  test('un manager ne peut pas modifier une marque du referentiel partage', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const creation = await request.post('/api/services/marques', {
      headers: authHeader(token),
      data: { nom: 'MarqueTest' },
    })
    if (!creation.ok()) throw new Error(`creation marque failed: ${creation.status()} ${await creation.text()}`)
    const marqueId = (await creation.json()).id

    const manager = await createTenantAdmin(request)
    const res = await request.put(`/api/services/marques/${marqueId}`, {
      headers: authHeader(manager.accessToken),
      data: { nom: 'Renommee par un manager' },
    })
    expect(res.status()).toBe(403)
  })

  test('l\'admin plateforme modifie une marque du referentiel partage', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const creation = await request.post('/api/services/marques', {
      headers: authHeader(token),
      data: { nom: 'MarqueAdmin' },
    })
    const marqueId = (await creation.json()).id

    const res = await request.put(`/api/services/marques/${marqueId}`, {
      headers: authHeader(token),
      data: { nom: 'MarqueAdmin renommee' },
    })
    expect(res.status()).toBe(200)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx playwright test tests/e2e/isolation-routes.spec.ts -g "Referentiel"`
Expected: le test manager ÉCHOUE (reçu `200` au lieu de `403`).

- [ ] **Step 3: Restreindre le rôle**

Dans `src/routes/services.ts`, remplacer `requireRole('admin', 'manager')` par `requireRole('admin')` sur les trois routes, en documentant la raison :

```typescript
// Référentiel marques/modèles GLOBAL (migration 0031, Sprint 2.39) : partagé par
// toutes les boutiques. L'écriture est réservée à l'admin plateforme — sinon un
// manager renomme ou désactive une entrée visible par tous les autres tenants.
services.put('/services/marques/:id', requireRole('admin'), async (c) => {
```

Même traitement sur `services.put('/services/modeles/:id', ...)` et `services.delete('/services/modeles/:id', ...)`.

Ne pas toucher à `GET /services/modeles/:id/services` : lecture d'un référentiel volontairement partagé.

- [ ] **Step 4: Vérifier que les tests passent**

Run: rebuild + redémarrage serveur, puis `npx playwright test tests/e2e/`
Expected: tout vert.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/isolation-routes.spec.ts src/routes/services.ts
git commit -m "fix: ecriture du referentiel marques/modeles reservee a l'admin plateforme"
```

---

### Task 7 : Test de conformité — empêcher la quatorzième route

**Files:**
- Create: `tests/routes-isolation-conformite.test.ts`

**Interfaces:**
- Consumes : rien (analyse statique de `src/routes/*.ts`)
- Produces : la liste `EXEMPTIONS`, à compléter par tout futur contributeur ajoutant une route par ID sans garde

C'est la tâche qui distingue ce chantier des trois campagnes précédentes.

- [ ] **Step 1: Écrire le test**

```typescript
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Conformite d'isolation multi-tenant.
 *
 * Toute route dont le chemin porte un parametre d'identifiant doit soit verifier
 * l'appartenance de la ressource a la boutique appelante, soit figurer dans
 * EXEMPTIONS avec un motif. Trois campagnes de correction (2026-07-19, 07-30,
 * 07-31) ont chacune laisse des routes ouvertes faute d'un tel garde-fou.
 */

const ROUTES_DIR = join(process.cwd(), 'src', 'routes')

/** Routes sans garde d'isolation, volontairement et avec motif. */
const EXEMPTIONS: Record<string, string> = {
  'personnel.ts DELETE /employes/:id':          'admin-only : requireRole(admin) seul, l\'admin plateforme traverse par conception',
  'services.ts GET /services/modeles/:id/services': 'referentiel-global : marques/modeles sans boutique_id depuis la migration 0031',
  'services.ts PUT /services/marques/:id':      'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts PUT /services/modeles/:id':      'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts DELETE /services/modeles/:id':   'referentiel-global : ecriture restreinte a requireRole(admin)',
}

const DECL = /^\s*\w+\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]*)['"`]/

/** Signaux acceptes comme garde d'isolation. */
function aUneGarde(corps: string): boolean {
  return /assertBoutiqueOwnership/.test(corps)
      || /boutique_id\s*!==/.test(corps)
      || /getBoutiqueId/.test(corps)
      || /boutique_id\s*=\s*\?/.test(corps)
      // boutiques.ts s'identifie par `id`, pas par `boutique_id`
      || /user\.boutique_id/.test(corps)
}

function routesParId() {
  const trouvees: Array<{ cle: string; corps: string }> = []
  for (const fichier of readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts'))) {
    const lignes = readFileSync(join(ROUTES_DIR, fichier), 'utf8').split('\n')
    const decls: Array<{ i: number; verbe: string; chemin: string }> = []
    lignes.forEach((l, i) => {
      const m = l.match(DECL)
      if (m) decls.push({ i, verbe: m[1].toUpperCase(), chemin: m[2] })
    })
    decls.forEach((d, k) => {
      if (!/:\w*[iI]d/.test(d.chemin)) return
      const fin = k + 1 < decls.length ? decls[k + 1].i : lignes.length
      trouvees.push({ cle: `${fichier} ${d.verbe} ${d.chemin}`, corps: lignes.slice(d.i, fin).join('\n') })
    })
  }
  return trouvees
}

describe('Conformite isolation multi-tenant', () => {
  it('toute route par ID a une garde d\'isolation ou une exemption motivee', () => {
    const manquantes = routesParId()
      .filter(r => !aUneGarde(r.corps))
      .filter(r => !(r.cle in EXEMPTIONS))
      .map(r => r.cle)

    expect(manquantes,
      `Routes par ID sans garde d'isolation :\n  ${manquantes.join('\n  ')}\n\n` +
      `Ajoutez assertBoutiqueOwnership() dans le handler, ou inscrivez la route ` +
      `dans EXEMPTIONS avec un motif si l'absence de garde est deliberee.`
    ).toEqual([])
  })

  it('chaque exemption porte un motif non vide', () => {
    for (const [cle, motif] of Object.entries(EXEMPTIONS)) {
      expect(motif.trim().length, `Exemption sans motif : ${cle}`).toBeGreaterThan(0)
    }
  })

  it('aucune exemption ne designe une route disparue', () => {
    const existantes = new Set(routesParId().map(r => r.cle))
    const orphelines = Object.keys(EXEMPTIONS).filter(c => !existantes.has(c))
    expect(orphelines, `Exemptions obsoletes a supprimer :\n  ${orphelines.join('\n  ')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer le test**

Run: `npx vitest run tests/routes-isolation-conformite.test.ts`
Expected: PASS — les 13 routes ont désormais leur garde (Tasks 1-5) et les 5 exceptions sont exemptées.

Si des routes inattendues remontent, les examiner une par une : soit elles ont une garde que `aUneGarde()` ne reconnaît pas (élargir la détection), soit ce sont de vraies failles non identifiées par l'audit (les corriger, ne pas les exempter).

- [ ] **Step 3: Vérifier que le garde-fou détecte réellement une régression**

Un garde-fou qu'on n'a jamais vu échouer ne prouve rien. Retirer temporairement la garde de `GET /produits/:id` (`src/routes/stocks.ts`) :

```bash
npx vitest run tests/routes-isolation-conformite.test.ts
```

Expected: **ÉCHEC**, avec `stocks.ts GET /produits/:id` listé dans le message.

Puis restaurer la garde et relancer :

Expected: PASS.

- [ ] **Step 4: Vérifier la suite complète**

Run: `npx vitest run`
Expected: 858/860 — les 3 nouveaux tests s'ajoutent à la baseline de 855/857 (les 2 échecs de fuseau d'`agendaService` demeurent).

- [ ] **Step 5: Commit**

```bash
git add tests/routes-isolation-conformite.test.ts
git commit -m "test: conformite d'isolation - toute route par ID exige une garde ou une exemption motivee"
```

---

### Task 8 : Clôture documentaire et gates finaux

**Files:**
- Modify: `project-docs/todo.md`, `project-docs/bugs.md`, `project-docs/audit-isolation-2026-07-31.md`, `CLAUDE.md`

- [ ] **Step 1: Cocher le backlog**

Dans `project-docs/todo.md`, section `🔴 PRIORITÉ CRITIQUE — 18 routes par ID sans isolation` : cocher les trois cases, remplacer `PAS corrigé` par `CORRIGÉ le 2026-07-31`, et préciser le décompte réel (13 gardes + 3 changements de rôle + 2 exemptions).

- [ ] **Step 2: Documenter dans `bugs.md`**

Ajouter une entrée **en tête** (convention du fichier : le plus récent en haut) :

```markdown
## FAILLE — 13 routes par ID sans isolation `boutique_id` (2026-07-31) — CORRIGÉE

Trouvées par l'audit systématique (`project-docs/audit-isolation-2026-07-31.md`) déclenché
après la correction des 5 endpoints facture/avoir. Domaines : fournisseurs (3), bons de
commande (1), employés et pointage (3), catégories de services (2), produits (3),
archivage de ticket (1).

`POST /tickets/:id/archiver` mérite d'être signalée : elle se trouvait dans un fichier
audité et corrigé le 2026-07-19, et n'avait pas été vue.

Fix : `assertBoutiqueOwnership()` sur les 13 routes. Trois routes du référentiel global
(`PUT /marques/:id`, `PUT /modeles/:id`, `DELETE /modeles/:id`) sont passées à
`requireRole('admin')` — problème de gouvernance d'un référentiel partagé, pas d'isolation.

**Garde-fou** : `tests/routes-isolation-conformite.test.ts` échoue désormais si une route
par ID n'a ni garde ni exemption motivée. C'est la réponse au vrai problème — trois
campagnes successives avaient corrigé « les routes connues » sans empêcher les suivantes.
```

- [ ] **Step 3: Ajouter l'invariant dans `CLAUDE.md`**

Dans la section des invariants, sous `## Architecture` :

```markdown
## Isolation multi-tenant — invariant (depuis 2026-07-31)

Toute route dont le chemin porte un paramètre d'identifiant doit vérifier que la ressource
appartient à la boutique de l'appelant, via `assertBoutiqueOwnership(user, resource, label)`
(`src/lib/middleware.ts`). Ne jamais supposer qu'un filtre en amont suffit.

`tests/routes-isolation-conformite.test.ts` fait échouer la suite si une nouvelle route par
ID n'a ni garde ni exemption motivée dans sa liste `EXEMPTIONS`. Une exemption doit porter
un motif explicite (`admin-only`, `referentiel-global`, `public`) — jamais un contournement
silencieux.

### Nommage — clé primaire de `boutiques`

La table `boutiques` garde une clé primaire nommée `id`, comme 46 des 55 tables du schéma :
la convention est PK = `id`, FK = `<table>_id`, et c'est elle qui rend les 6 585 occurrences
de `boutique_id` immédiatement identifiables comme des clés étrangères.

En contrepartie, **toute requête qui expose cette clé primaire doit l'aliaser** :
`SELECT b.id AS boutique_id FROM boutiques b`. L'ambiguïté de `WHERE id = ?` dans un
contexte multi-tenant est réelle au dépannage ; l'alias la lève là où elle se manifeste,
sans créer d'exception au schéma (décision du 2026-07-31).
```

- [ ] **Step 4: Marquer l'audit comme traité**

Dans `project-docs/audit-isolation-2026-07-31.md`, remplacer la section `## Statut` par le
bilan réel : 13 corrigées, 3 passées en `requireRole('admin')`, 2 exemptées, garde-fou en place.

- [ ] **Step 5: Gates finaux**

```bash
npx vitest run          # attendu : 858/860
npx tsc --noEmit        # attendu : 32 erreurs (baseline)
npm run build
# redémarrer le serveur local
npx playwright test tests/e2e/    # attendu : tout vert
```

- [ ] **Step 6: Commit**

```bash
git add project-docs/ CLAUDE.md
git commit -m "docs: cloture du chantier isolation des routes par ID"
```

---

## Notes d'exécution

**Ne pas déployer.** `npm run deploy` reste un geste humain explicite (`CLAUDE.md`). Deux
commits antérieurs (`c59d59c` `statsService`, `1f99e4a` migration du helper) attendent
également un déploiement au moment où ce plan est écrit.

**Ordre des tâches.** Les tâches 1 à 6 sont indépendantes entre elles, mais la tâche 1
produit `loginSeedAdmin()` et `authHeader()` dont toutes les autres dépendent : elle doit
passer en premier. La tâche 7 exige que les tâches 1 à 6 soient terminées, sans quoi elle
échouera légitimement.

**Sur les faux verts.** Si un test de refus passe dès le premier lancement, ne pas s'en
réjouir : soit la garde existait déjà, soit la fixture n'a pas créé la ressource attendue
et la route répond `404` pour une raison sans rapport avec l'isolation. Vérifier le corps
de la réponse avant de conclure.
