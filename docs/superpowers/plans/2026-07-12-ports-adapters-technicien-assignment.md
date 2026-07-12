# Ports & Adapters (Database) + Assignation technicien — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduire le port `Database` (abstraction devant D1, préparation portabilité VPS/Postgres — voir `docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md`), prouver le pattern sur un cas réel simple (`userService.listUsers()`), puis livrer la fonctionnalité `populateTechniciens()` déjà en attente (`project-docs/todo.md`) — remplacer les 3 noms en dur du `<select id="t-technician">` par les vrais utilisateurs, et envoyer `technicien_id` (pas un texte libre) à la création de ticket.

**Architecture:** Pattern Ports & Adapters. `src/ports/database.ts` définit l'interface `Database` (`all/get/run`, SQL brut + params — pas l'API query-builder Drizzle, voir note ci-dessous). `src/adapters/cloudflare/d1Database.ts` l'implémente via le binding D1 existant — seule implémentation active, aucun changement de comportement. `userService.listUsers()` est migré en premier (fonction simple, deux branches, sans sous-requêtes corrélées, **zéro test existant à ne pas casser** — candidat plus sûr que `personnelService.ts` cité en exemple dans le spec, dont les requêtes `listEmployes`/`statutsTempsReel` ont des sous-requêtes corrélées complexes à haut risque de régression si migrées en premier).

**Tech Stack:** Hono, TypeScript, Cloudflare D1, Vitest.

**Note d'implémentation (écart mineur au spec, à valider en relecture) :** le spec mentionne Drizzle ORM comme outil recommandé, pour son bénéfice principal — schéma unique généré pour D1 et Postgres. Ce plan garde ce bénéfice pour la phase de migration DB (hors scope ici), mais fait porter le **port `Database`** sur une API SQL brute (`string, params`) plutôt que sur l'API query-builder de Drizzle. Raison : `personnelService.ts` et d'autres services ont des requêtes SQL complexes (sous-requêtes corrélées, `julianday()`) où forcer un passage par le query-builder Drizzle dès maintenant serait un risque de régression inutile pour ce chantier. Le port `all/get/run` permet une migration mécanique et vérifiable service par service ; Drizzle sera introduit comme outil de schéma/migrations au moment de l'écriture de l'adaptateur Postgres (tâche future, hors scope).

## Global Constraints

- Commentaires et commits en français (convention du workspace)
- Jamais de `Co-Authored-By: Claude` dans les commits (règle utilisateur confirmée)
- JSDoc systématique sur toute fonction exportée (convention déjà appliquée dans tout `src/services/*.ts`)
- Aucun changement de contrat API REST/JSON exposé au frontend (hors l'ajout du champ `technicien_id`, déjà accepté par l'API existante — voir `ticketService.ts:88`)
- Chaque tâche doit laisser `npm test` vert avant de passer à la suivante
- Déploiement Cloudflare inchangé (`wrangler pages deploy`) — pas de nouvelle dépendance de déploiement dans ce plan

---

## Limitation connue à noter (pas à corriger dans ce plan)

`GET /api/users` (`routes/users.ts:162`) est protégé par `requireRole('admin', 'manager')`. Un utilisateur de rôle `technicien` ouvrant la modale "Nouvelle prise en charge" recevra un 403 sur cet appel — `populateTechniciens()` échouera silencieusement (même style que l'échec silencieux déjà existant dans `populateClients()`, `tickets.js:886` `catch { /* fallback localStorage silencieux */ }`) et le select restera à "Non assigné" uniquement. C'est une amélioration possible (nouvel endpoint accessible à tous les rôles authentifiés, exposant moins de champs) mais **hors scope de ce plan** — à traiter dans un plan dédié si confirmé prioritaire.

---

### Task 1: Port Database (interface)

**Files:**
- Create: `src/ports/database.ts`

**Interfaces:**
- Produces: `interface Database { all<T>(sql: string, params?: unknown[]): Promise<T[]>; get<T>(sql: string, params?: unknown[]): Promise<T | null>; run(sql: string, params?: unknown[]): Promise<{ id: number | null; changes: number }> }`

- [ ] **Step 1: Créer l'interface**

```ts
// src/ports/database.ts

/**
 * Port d'accès base de données — découple les services de l'implémentation
 * concrète (D1 aujourd'hui, Postgres au moment de la bascule VPS).
 * Voir docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md
 */
export interface Database {
  /** SELECT retournant plusieurs lignes (équivalent D1 .all()) */
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  /** SELECT retournant une ligne ou null (équivalent D1 .first()) */
  get<T>(sql: string, params?: unknown[]): Promise<T | null>
  /** INSERT/UPDATE/DELETE sans RETURNING (équivalent D1 .run()) */
  run(sql: string, params?: unknown[]): Promise<{ id: number | null; changes: number }>
}
```

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune erreur (fichier nouveau, non encore consommé)

- [ ] **Step 3: Commit**

```bash
git add src/ports/database.ts
git commit -m "feat: ajoute le port Database (abstraction devant D1)"
```

---

### Task 2: Adaptateur Cloudflare D1

**Files:**
- Create: `src/adapters/cloudflare/d1Database.ts`

**Interfaces:**
- Consumes: `Database` (Task 1, `src/ports/database.ts`)
- Produces: `class D1DatabaseAdapter implements Database`, constructeur `(binding: D1Database)`

- [ ] **Step 1: Créer l'adaptateur**

```ts
// src/adapters/cloudflare/d1Database.ts
import type { Database } from '../../ports/database'

/**
 * Implémentation du port Database pour Cloudflare D1.
 * Seule implémentation active — l'adaptateur Postgres (VPS) sera ajouté
 * au moment de la bascule (hors scope de ce chantier).
 */
export class D1DatabaseAdapter implements Database {
  constructor(private readonly binding: D1Database) {}

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.binding.prepare(sql).bind(...params).all<T>()
    return result.results ?? []
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.binding.prepare(sql).bind(...params).first<T>()
    return result ?? null
  }

  async run(sql: string, params: unknown[] = []): Promise<{ id: number | null; changes: number }> {
    const result = await this.binding.prepare(sql).bind(...params).run()
    return {
      id:      result.meta.last_row_id ?? null,
      changes: result.meta.changes     ?? 0,
    }
  }
}
```

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add src/adapters/cloudflare/d1Database.ts
git commit -m "feat: adaptateur D1 pour le port Database"
```

---

### Task 3: Mock de test pour le port Database

**Files:**
- Create: `tests/helpers/mockDatabase.ts`

**Interfaces:**
- Consumes: `Database` (Task 1)
- Produces: `createMockDatabase(): Database & { __setResponse, __setListResponse, __setResponseFn, __setListFn, __getCalls }`

- [ ] **Step 1: Créer le mock, sur le modèle de `tests/helpers/mockD1.ts` existant**

```ts
// tests/helpers/mockDatabase.ts
/**
 * @file tests/helpers/mockDatabase.ts
 * @description Mock du port Database pour les tests unitaires Vitest.
 * Même style que tests/helpers/mockD1.ts (matching sur SQL normalisé),
 * adapté à l'API plate all()/get()/run() du port Database.
 */
import type { Database } from '../../src/ports/database'

function normalizeSQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

export function createMockDatabase() {
  const singleResponses = new Map<string, any>()
  const listResponses   = new Map<string, any[]>()
  const responseFns     = new Map<string, (params: unknown[]) => any>()
  const listFns         = new Map<string, (params: unknown[]) => any[]>()
  const calls: Array<{ sql: string; params: unknown[] }> = []

  function __setResponse(sql: string, value: any) {
    singleResponses.set(normalizeSQL(sql), value)
  }

  function __setListResponse(sql: string, values: any[]) {
    listResponses.set(normalizeSQL(sql), values)
  }

  function __setResponseFn(sql: string, fn: (params: unknown[]) => any) {
    responseFns.set(normalizeSQL(sql), fn)
  }

  function __setListFn(sql: string, fn: (params: unknown[]) => any[]) {
    listFns.set(normalizeSQL(sql), fn)
  }

  function __getCalls() {
    return [...calls]
  }

  const db: Database = {
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const normalSql = normalizeSQL(sql)
      calls.push({ sql: normalSql, params: [...params] })

      const fn = listFns.get(normalSql)
      if (fn) return fn(params) as T[]

      return (listResponses.get(normalSql) as T[]) ?? []
    },

    async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const normalSql = normalizeSQL(sql)
      calls.push({ sql: normalSql, params: [...params] })

      const fn = responseFns.get(normalSql)
      if (fn) return (fn(params) as T) ?? null

      if (singleResponses.has(normalSql)) {
        return singleResponses.get(normalSql) as T | null
      }
      return null
    },

    async run(sql: string, params: unknown[] = []): Promise<{ id: number | null; changes: number }> {
      const normalSql = normalizeSQL(sql)
      calls.push({ sql: normalSql, params: [...params] })

      const fn = responseFns.get(normalSql)
      if (fn) {
        const res = fn(params)
        return { id: res?.id ?? null, changes: 1 }
      }
      return { id: null, changes: 1 }
    },
  }

  return Object.assign(db, {
    __setResponse,
    __setListResponse,
    __setResponseFn,
    __setListFn,
    __getCalls,
  })
}
```

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/mockDatabase.ts
git commit -m "test: mock du port Database pour les tests unitaires"
```

---

### Task 4: Migrer `userService.listUsers()` vers le port Database

**Files:**
- Modify: `src/services/userService.ts:271-300`
- Create: `tests/userService.test.ts` (n'existait pas — aucun test préexistant pour ce fichier)

**Interfaces:**
- Consumes: `Database` (Task 1)
- Produces: `listUsers(db: Database, adminUser: { role: string; boutique_id?: number | null }, boutiqueId: number): Promise<any[]>` (signature inchangée à part le type du 1er paramètre : `D1Database` → `Database`)

- [ ] **Step 1: Écrire les tests (ils doivent échouer — `listUsers` attend encore un `D1Database`)**

```ts
// tests/userService.test.ts
import { describe, it, expect } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { listUsers } from '../src/services/userService'

const SQL_LIST_ADMIN = `SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif, u.pin_actif, r.nom as role, u.boutique_id, b.nom as boutique_nom, u.created_at FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN boutiques b ON b.id = u.boutique_id ORDER BY u.created_at ASC`

const SQL_LIST_MANAGER = `SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif, u.pin_actif, r.nom as role, u.boutique_id, u.created_at FROM users u JOIN roles r ON r.id = u.role_id WHERE u.boutique_id = ? ORDER BY u.created_at ASC`

describe('listUsers', () => {
  it('admin : retourne tous les utilisateurs toutes boutiques confondues', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_ADMIN, [
      { id: 1, prenom: 'Ana',  nom: 'Admin', role: 'admin' },
      { id: 2, prenom: 'Jean', nom: 'Tech',  role: 'technicien' },
    ])

    const result = await listUsers(db, { role: 'admin' }, 1)

    expect(result).toHaveLength(2)
  })

  it('manager : requête filtrée sur boutique_id (requête différente de admin)', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_MANAGER, [
      { id: 3, prenom: 'Marie', nom: 'Manager', role: 'manager' },
    ])

    const result = await listUsers(db, { role: 'manager' }, 42)

    expect(result).toHaveLength(1)
    const calls = db.__getCalls()
    const managerCall = calls.find(c => c.sql === SQL_LIST_MANAGER)
    expect(managerCall).toBeDefined()
    expect(managerCall!.params[0]).toBe(42)
  })

  it('manager : tableau vide si aucun utilisateur dans la boutique', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_MANAGER, [])

    const result = await listUsers(db, { role: 'manager' }, 99)

    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent (incompatibilité de type / mock ne répond pas)**

Run: `npx vitest run tests/userService.test.ts`
Expected: FAIL — `listUsers` appelle encore `db.prepare(...)` (méthode absente du mock `Database`), erreur runtime `db.prepare is not a function`

- [ ] **Step 3: Migrer `listUsers()` vers le port Database**

Dans `src/services/userService.ts`, ajouter l'import en haut du fichier :

```ts
import type { Database } from '../ports/database'
```

Remplacer les lignes 271-300 (fonction `listUsers`) par :

```ts
export async function listUsers(
  db:          Database,
  adminUser:   { role: string; boutique_id?: number | null },
  boutiqueId:  number
): Promise<any[]> {
  if (adminUser.role === 'admin') {
    return db.all<any>(`
      SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif,
             u.pin_actif, r.nom as role, u.boutique_id,
             b.nom as boutique_nom, u.created_at
      FROM   users u
      JOIN   roles r ON r.id = u.role_id
      LEFT JOIN boutiques b ON b.id = u.boutique_id
      ORDER  BY u.created_at ASC
    `)
  }

  return db.all<any>(`
    SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif,
           u.pin_actif, r.nom as role, u.boutique_id, u.created_at
    FROM   users u
    JOIN   roles r ON r.id = u.role_id
    WHERE  u.boutique_id = ?
    ORDER  BY u.created_at ASC
  `, [boutiqueId])
}
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx vitest run tests/userService.test.ts`
Expected: PASS — 3/3 tests

- [ ] **Step 5: Lancer la suite complète pour vérifier l'absence de régression**

Run: `npm test`
Expected: PASS, même nombre de tests qu'avant +3 (aucun test existant cassé — `listUsers` n'était appelé que depuis `routes/users.ts`, pas testé ailleurs)

- [ ] **Step 6: Commit**

```bash
git add src/services/userService.ts tests/userService.test.ts
git commit -m "refactor: migre userService.listUsers() vers le port Database"
```

---

### Task 5: Injecter l'adaptateur dans le contexte Hono + brancher `routes/users.ts`

**Files:**
- Modify: `src/index.tsx:56-84`
- Modify: `src/routes/users.ts:16-17,168`

**Interfaces:**
- Consumes: `D1DatabaseAdapter` (Task 2), `Database` (Task 1)
- Produces: `c.get('db')` disponible dans tous les routers montés après le middleware d'injection

- [ ] **Step 1: Ajouter l'import et le type `Variables` dans `index.tsx`**

Dans `src/index.tsx`, ajouter l'import après les imports de routes existants (après la ligne `import { getOrCreateIcalToken, generateIcal } from './services/agendaService'`) :

```ts
import { D1DatabaseAdapter } from './adapters/cloudflare/d1Database'
import type { Database } from './ports/database'
```

Remplacer la déclaration du type `Bindings` et de `app` (lignes 56-63) :

```ts
type Bindings = {
  DB:         D1Database
  JWT_SECRET: string
  PHOTOS?:    R2Bucket   // Sprint 2.36 — MOD-01 photos tickets (optionnel : absent en dev sans R2)
  // KV supprimé — remplacé par D1AsKV (createD1KV) pour compatibilité gsk-hosted-deploy
}

type Variables = {
  db: Database
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
```

- [ ] **Step 2: Injecter l'adaptateur dans le middleware global existant**

Remplacer le middleware d'injection D1AsKV (lignes 73-84) par :

```ts
// ─── Middleware global : injection D1AsKV + Database port + nettoyage TTL ────
app.use('*', async (c, next) => {
  ;(c.env as any).KV = createD1KV(c.env.DB)
  c.set('db', new D1DatabaseAdapter(c.env.DB))
  if (Math.random() < 0.01) {
    d1KvCleanup(c.env.DB).catch(() => {}) // non bloquant
  }
  await next()
})
```

- [ ] **Step 3: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 4: Brancher `routes/users.ts` sur le port**

Dans `src/routes/users.ts`, ajouter l'import juste après la ligne 9 (`import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'`) :

```ts
import type { Database } from '../ports/database'
```

Remplacer les lignes 16-17 (déclarations `Bindings`/`Variables`, `const users = new Hono(...)` à la ligne 19 reste inchangée — elle référence déjà `Bindings`/`Variables` génériquement) :

```ts
type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any; db: Database }
```

Remplacer la ligne 168 (`const data = await listUsers(c.env.DB, adminUser, boutiqueId)`) par :

```ts
  const data = await listUsers(c.get('db'), adminUser, boutiqueId)
```

- [ ] **Step 5: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 6: Lancer la suite de tests complète**

Run: `npm test`
Expected: PASS, aucune régression

- [ ] **Step 7: Valider en local avant déploiement**

Run: `npm run build && npx wrangler pages dev dist --local`

Se connecter avec `admin@izigsm.fr` / `Admin@2026!`, ouvrir la page équipe/utilisateurs (ou tester `GET /api/users` directement via le navigateur/curl), vérifier que la liste des utilisateurs s'affiche correctement — comportement identique à avant migration.

- [ ] **Step 8: Déployer et valider en production**

Run: `npm run build && npx wrangler pages deploy dist --project-name izigsm --branch main`

Vérifier `https://repairdesk.fr/api/health` → 200, puis tester `GET /api/users` en session admin réelle sur `repairdesk.fr`.

- [ ] **Step 9: Commit**

```bash
git add src/index.tsx src/routes/users.ts
git commit -m "feat: injecte le port Database dans le contexte Hono, branche routes/users.ts"
```

---

### Task 6: `populateTechniciens()` — remplacer les noms en dur, envoyer `technicien_id`

**Files:**
- Modify: `public/tickets.html:228-236`
- Modify: `public/static/js/tickets.js:18-21,669`

**Interfaces:**
- Consumes: `GET /api/users` (existant, `routes/users.ts`, requiert rôle `admin` ou `manager` — voir limitation connue en tête de plan)

- [ ] **Step 1: Retirer les 3 options en dur dans `tickets.html`**

Remplacer les lignes 228-236 :

```html
            <div class="form-field">
              <label>Technicien</label>
              <select id="t-technician">
                <option value="">Non assigné</option>
              </select>
            </div>
```

- [ ] **Step 2: Ajouter `populateTechniciens()` dans `tickets.js`, sur le modèle de `populateClients()` (ligne 860)**

Ajouter après la fonction `populateClients()` existante (après la ligne 887, avant la section suivante) :

```js
// ======================== TECHNICIEN LIST ========================
async function populateTechniciens() {
  const select = document.getElementById('t-technician');
  if (!select) return;
  try {
    const r = await apiGet('/api/users');
    const techniciens = (r.data?.data || []).map(u => ({
      id:  u.id,
      nom: (u.prenom || '') + ' ' + (u.nom || ''),
    }));
    techniciens.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.nom.trim() || `Utilisateur #${t.id}`;
      select.appendChild(opt);
    });
  } catch {
    // Échec silencieux (ex: rôle technicien sans accès à GET /api/users) —
    // même style que populateClients() ci-dessus. Le select reste sur
    // "Non assigné" uniquement.
  }
}
```

- [ ] **Step 3: Appeler `populateTechniciens()` au chargement, à côté de `populateClients()`**

Dans `tickets.js`, remplacer les lignes 18-21 :

```js
  loadTickets();   // remplace renderTickets() direct
  initSignature();
  populateClients();
  populateTechniciens();
});
```

- [ ] **Step 4: Envoyer `technicien_id` au lieu du texte libre dans `saveTicket()`**

Remplacer la ligne 669 :

```js
    technicien_id: document.getElementById('t-technician')?.value
      ? parseInt(document.getElementById('t-technician').value, 10)
      : null,
```

(remplace `technician: document.getElementById('t-technician')?.value || 'Non assigné',`)

- [ ] **Step 5: Validation manuelle en local (pas de suite de tests JS frontend dans ce projet)**

Run: `npm run build && npx wrangler pages dev dist --local`

Dans le navigateur (connecté `admin@izigsm.fr` / `Admin@2026!`) :
1. Ouvrir "Nouvelle prise en charge"
2. Vérifier que le select "Technicien" liste les vrais utilisateurs (pas Jean D./Marie L./Pierre M.)
3. Sélectionner un technicien, créer un ticket
4. Vérifier via `GET /api/tickets/:id` que `technicien_id` est bien l'ID numérique sélectionné, pas un texte
5. Vérifier que la fiche détail affiche le bon nom de technicien (jointure `LEFT JOIN users u ON u.id = t.technicien_id` déjà en place côté `ticketService.ts`)

- [ ] **Step 6: Déployer et valider en production**

Run: `npm run build && npx wrangler pages deploy dist --project-name izigsm --branch main`

Répéter la validation de l'étape 5 sur `https://repairdesk.fr`. Supprimer le ticket de test créé pendant la validation (pas de donnée de test en prod).

- [ ] **Step 7: Commit**

```bash
git add public/tickets.html public/static/js/tickets.js
git commit -m "feat: populateTechniciens() — remplace les noms en dur, envoie technicien_id"
```

---

## Ce qui reste hors scope de ce plan (pour plans futurs)

- Migration des autres fonctions de `userService.ts` (non touchées, restent sur `D1Database` direct)
- Migration de `personnelService.ts` et des 16 autres services vers le port Database
- Ports `Storage` et `Cache` (R2/D1KV → disque local/Redis) — non nécessaires pour ce chantier
- Adaptateur Postgres, migration des données, déploiement Node.js sur VPS
- Nouvel endpoint technicien accessible aux rôles non-admin/manager (limitation notée plus haut)
