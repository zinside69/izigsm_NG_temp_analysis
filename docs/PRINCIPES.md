# Skill — Principes Architecturaux Core iziGSM

> Référence immuable. Toute IA ou développeur intervenant sur iziGSM
> **doit consulter et respecter** ce document avant chaque sprint.

---

## Stack technique de référence

```
Frontend  : HTML / CSS / Vanilla JS (CDN)  — servi par Cloudflare Pages CDN
Backend   : Hono (TypeScript) sur Cloudflare Workers
DB        : Cloudflare D1 (SQLite edge)
Sessions  : JWT (accessToken 1h) + KV (refreshToken 7j, PIN session 15min)
Déploiement : wrangler pages dev --d1 --local (dev) / wrangler pages deploy (prod)
```

---

## Principe 1 — Modularité et Indépendance

### Règle
- L'application est composée de modules fonctionnels indépendants.
- Chaque module a son fichier route dédié dans `src/routes/<module>.ts`.
- Les modules communiquent **exclusivement** via des appels de service internes (`src/services/`) ou via API REST.
- **Aucun module ne doit faire de JOIN SQL sur la table d'un autre module.**

### ✅ Conforme dans le code
- Un fichier route par module : `clients.ts`, `tickets.ts`, `stocks.ts`, `facturation.ts`, `rachats.ts`, `users.ts`...

### ❌ Violations existantes à corriger
| Fichier | Violation | Correction |
|---|---|---|
| `routes/clients.ts` l.41 | `LEFT JOIN tickets` — module clients lit directement la table tickets | Créer `ticketService.countByClient(db, clientId)` — Sprint 2.15 |
| ~~`src/index.tsx` `/api/stats`~~ | ✅ **Résolu Sprint 2.13** — déplacé dans `routes/stats.ts` + `services/statsService.ts` | |

> **Note** : `statsService.ts` est le seul service autorisé à agréger plusieurs modules (rôle analytique exclusif, lecture seule). Cette exception est documentée dans le fichier par un bloc `⚠️ EXCEPTION ARCHITECTURE`.

---

## Principe 2 — Découplage Frontend / Backend

### Règle
- Le **frontend** est 100% statique (HTML/CSS/JS). Aucune logique métier.
- Le **backend** Hono expose uniquement des endpoints REST JSON sous `/api/*`.
- Le frontend utilise **exclusivement** le wrapper `ApiService` (`app.js`) pour tous les appels réseau.
- **Aucun `fetch()` direct n'est autorisé** dans les fichiers JS modules (hors `app.js`).

### Wrapper ApiService de référence (dans `public/static/js/app.js`)
```javascript
// Fonctions autorisées dans tous les modules JS :
apiGet(url, params)       // GET avec query string
apiPost(url, body)        // POST JSON
apiPut(url, body)         // PUT JSON
apiPatch(url, body)       // PATCH JSON
apiDelete(url)            // DELETE
// Toutes gèrent : JWT auto-refresh, flash erreur, 401 redirect
```

### ✅ Conforme
- Wrapper centralisé dans `app.js` avec auto-refresh JWT.
- Frontend HTML/JS pur, pas de SSR.

### ❌ Violations existantes à corriger
| Fichier | Ligne | Violation | Correction |
|---|---|---|---|
| ~~`register.js`~~ | ~~185~~ | ✅ **Résolu Fix DP** — `fetch()` direct remplacé par `apiPostPublic()` | |
| ~~`rachats.js`~~ | ~~458~~ | ✅ **Résolu Fix DP** — `fetch()` export CSV remplacé par `apiBlobGet()` | |
| ~~`app.js`~~ | ~~427+442~~ | ✅ **Résolu Fix DP** — doublon `apiPut` supprimé | |

**Helpers centralisés ajoutés dans `app.js` (Sprint correctif DP) :**
- `_money(n, symbol)` — alias formatMoney pour templates print
- `_fmtDate(iso)` — date dd/mm/yyyy fr-FR
- `_fmtDateTime(iso)` — date + heure fr-FR

Tous les fichiers modules (`factures.js`, `tickets.js`, `dashboard.js`) utilisent ces helpers globaux — aucun helper local dupliqué.

---

## Principe 3 — BFF Hono (adapté de PHP BFF)

### Contexte
Le principe original prescrit PHP comme couche BFF (Backend For Frontend).
**PHP est inapplicable sur Cloudflare Workers.** Le principe est adapté : Hono remplace PHP
avec les mêmes responsabilités, une meilleure scalabilité edge.

### Ce que Hono (BFF) doit assurer — et uniquement ça
| Responsabilité | Implémentation |
|---|---|
| Validation d'entrée | `src/lib/validators.ts` — fonctions `validateXxx(body): string \| null` |
| Authentification / Session | `authMiddleware` (JWT) + KV (TTL) — ✅ déjà en place |
| Coordination logique métier | `src/services/<module>Service.ts` — les routes délèguent |
| Accès DB | Uniquement dans `src/services/` — jamais inline dans les routes |

### Ce que PHP faisait que Hono NE fait PAS (et c'est voulu)
| Concept PHP | Raison de l'abandon |
|---|---|
| Rendu HTML serveur | Frontend CDN statique = meilleure perf. Non applicable sur Workers. |
| `$_SESSION` serveur | Remplacé par JWT + KV — sans état, scalable edge globalement. |
| Coordinateur microservices | Pas de microservices séparés à l'échelle actuelle. Un Worker suffit. |

### Architecture cible des routes
```typescript
// ❌ INTERDIT — logique métier + SQL inline dans la route
tickets.post('/', async (c) => {
  if (!client_id) return c.json({ error: '...' }, 400)   // validation inline
  const numero = await nextNumero(...)                     // logique inline
  await c.env.DB.prepare(`INSERT INTO tickets...`).run()  // SQL inline
})

// ✅ CORRECT — route = orchestration uniquement
import { validateTicket } from '../lib/validators'
import { createTicket }   from '../services/ticketService'

tickets.post('/', async (c) => {
  const body  = await c.req.json()
  const error = validateTicket(body)
  if (error) return c.json({ success: false, error }, 400)

  const result = await createTicket(c.env.DB, body)
  return c.json({ success: true, ...result }, 201)
})
```

### Structure cible
```
src/
├── index.tsx              # Gateway — routing uniquement, aucun SQL
├── routes/
│   ├── tickets.ts         # Controller — orchestration uniquement
│   ├── clients.ts
│   └── ...
├── services/              # ← À CRÉER
│   ├── ticketService.ts   # Logique métier + SQL tickets
│   ├── clientService.ts
│   ├── statsService.ts    # Agrégation KPIs
│   └── ...
└── lib/
    ├── validators.ts      # ← À CRÉER — validation centralisée
    ├── middleware.ts      # Auth + RBAC + PIN
    ├── db.ts              # Helpers D1 (nextNumero, pagination, auditLog)
    ├── auth.ts            # JWT + PBKDF2
    └── nf525.ts           # Chaîne NF525
```

---

## Principe 4 — Design Patterns et Lisibilité

### Patterns requis
| Pattern | Rôle | Implémentation iziGSM |
|---|---|---|
| **MVC** | Séparation Model/View/Controller | Routes = Controller, Services = Model, HTML/JS = View |
| **Gateway** | Point d'entrée unique | `index.tsx` — `app.route('/api', ...)` |
| **Middleware chain** | Auth, RBAC, PIN | `authMiddleware` → `requireRole()` → `requirePin()` |
| **Strategy** | Comportement variable | `requireRole(...roles)` — stratégie RBAC paramétrable |
| **Repository** | Accès données abstrait | `src/services/<module>Service.ts` (à implémenter) |

### Règles de lisibilité
- **Commentaires obligatoires** sur chaque fonction publique (format `/** ... */`)
- **Commentaires de section** avec séparateurs `// ── Titre ──────`
- Nommage : fonctions en `camelCase`, types en `PascalCase`, constantes en `UPPER_SNAKE_CASE`
- Pas de logique imbriquée > 3 niveaux
- Chaque fichier route commence par un commentaire expliquant son rôle architectural

### Template commentaire fonction
```typescript
/**
 * Crée un ticket de réparation.
 * Rôle architectural : Controller — délègue la logique à ticketService.
 * @param client_id  - ID du client propriétaire de l'appareil
 * @param boutique_id - Isolation multi-boutique
 * @returns { id, numero } du ticket créé
 */
```

### ❌ Violations existantes
| Fichier | Violation | État |
|---|---|---|
| `routes/tickets.ts` | 1 seul `/** */` pour 200 lignes — fonctions individuelles non documentées | 🟡 Backlog Sprint 2.8 |
| `routes/rachats.ts` | Idem | 🟡 Backlog |
| `routes/users.ts` | Idem | 🟡 Backlog |
| ~~`app.js`~~ | ~~`apiPut` déclarée deux fois (l. 427 et l. 442)~~ | ✅ Résolu Fix DP |
| ~~`factures.js` `dashboard.js`~~ | ~~`_money()` dupliqué localement~~ | ✅ Résolu Sprint correctif DP |
| ~~`tickets.js`~~ | ~~`_fmtDateTk()` dupliqué localement~~ | ✅ Résolu Sprint correctif DP |
| ~~`printFacture()` / `printTicket()`~~ | ~~Fonctions > 150L, imbrication > 3 niveaux~~ | ✅ Résolu — refactorisées en 3 fonctions chacune |
| ~~`statsService.ts` `routes/stats.ts`~~ | ~~JSDoc absent~~ | ✅ Résolu Sprint correctif DP |

**Avancée Sprint correctif DP (commit `f915398`) :**
- `dashboard.js` : JSDoc ajouté sur 14 fonctions (`init`, `refresh`, `_setDate`, `_setUser`, `_loadKpis`, `_buildAlerts`, `_loadCaMensuel`, `_loadTicketsStatut`, `_loadTopProduits`, `_loadActivite`, `_loadTechniciens`, `_setText`, `_esc`, `_ago`)
- `factures.js` : `printFacture()` → `_fetchFacturePrintData` + `_buildFactureHTML` + `_triggerPrint`
- `tickets.js` : `printTicket()` → `_fetchTicketPrintData` + `_buildTicketHTML` + appel `_triggerPrint` (défini dans `factures.js`)

---

## Principe 5 — Communication via ApiService

### Règle
- Toutes les opérations CRUD passent par les routes Hono (`/api/*`).
- Côté frontend, **toujours** utiliser les fonctions du wrapper `ApiService` (`app.js`).
- **Jamais de `fetch()` direct** dans un fichier module JS.
- Réponse API toujours au format : `{ success: boolean, data?: any, error?: string, message?: string }`

### Format réponse standard
```typescript
// Succès liste
return c.json({ success: true, data: rows.results, pagination: { page, limit, total, pages } })

// Succès création
return c.json({ success: true, id: result.id, message: 'Ressource créée.' }, 201)

// Succès mise à jour
return c.json({ success: true, message: 'Ressource mise à jour.' })

// Erreur validation
return c.json({ success: false, error: 'Message explicite.' }, 400)

// Erreur auth
return c.json({ success: false, error: 'Token invalide ou expiré.' }, 401)

// Erreur accès
return c.json({ success: false, error: 'Accès refusé.' }, 403)

// Erreur not found
return c.json({ success: false, error: 'Ressource introuvable.' }, 404)
```

### ✅ Conforme
- Wrapper `ApiService` centralisé dans `app.js` avec gestion JWT auto-refresh.
- Format `{ success, data, error, message }` respecté dans tous les modules.

### ❌ Violations existantes à corriger
| Fichier | Violation | État |
|---|---|---|
| ~~`register.js` l.185~~ | ~~`fetch()` direct~~ | ✅ Résolu Fix DP |
| ~~`rachats.js` l.458~~ | ~~`fetch()` direct (export CSV)~~ | ✅ Résolu Fix DP |

---

## Checklist pré-commit (à vérifier avant chaque git commit)

```
□ Aucun `fetch()` direct dans les fichiers JS modules (hors app.js)
□ Aucun SQL inline dans les routes (doit passer par services/)
□ Aucun JOIN cross-module dans les routes
□ Toute nouvelle fonction publique a un commentaire /** */
□ Format réponse { success, data?, error?, message? } respecté
□ getBoutiqueId() utilisé directement (sans ternaire défensif)
□ Routes statiques déclarées AVANT routes /:id dans chaque fichier
□ /api/health déclaré AVANT app.route(...) dans index.tsx
□ apiPut déclaré une seule fois dans app.js
□ Pas de logique métier dans index.tsx (uniquement routing + health)
```

---

## Violations connues à corriger (backlog)

> Mis à jour au 8 juin 2026 — après Sprint 2.13 + Sprint 2.14 + Sprint correctif DP (commit `f915398`).

| Priorité | Fichier | Violation | Sprint cible |
|---|---|---|---|
| ✅ Résolu | ~~`app.js` l.442~~ | ~~`apiPut` dupliqué~~ | Fix DP |
| ✅ Résolu | ~~`register.js` l.185~~ | ~~`fetch()` direct~~ | Fix DP |
| ✅ Résolu | ~~`rachats.js` l.458~~ | ~~`fetch()` direct export~~ | Fix DP |
| ✅ Résolu | ~~`src/index.tsx` `/api/stats`~~ | ~~SQL inline multi-module~~ | Sprint 2.13 |
| ✅ Résolu | ~~`factures.js` `dashboard.js` `tickets.js`~~ | ~~Helpers `_money`/`_fmtDate` dupliqués~~ | Sprint correctif DP |
| ✅ Résolu | ~~`statsService.ts` `routes/stats.ts`~~ | ~~JSDoc absent~~ | Sprint correctif DP |
| ✅ Résolu | ~~`src/`~~ | ~~Pas de couche `services/` ni `validators.ts`~~ | Sprint 2.4+ |
| 🟡 Actif | `routes/clients.ts` l.41 | `JOIN tickets` cross-module (P1) | Sprint 2.15 |
| 🟢 Actif | `routes/tickets.ts` `routes/rachats.ts` `routes/users.ts` | Documentation fonctions insuffisante (P4) | Au fil des sprints |

**État de conformité au 8 juin 2026 :**
- P1 Modularité : ⚠️ 1 violation résiduelle (`routes/clients.ts` — sprint 2.15 planifié)
- P2 Découplage : ✅ Aucune violation active
- P3 BFF Hono : ✅ Aucune violation active
- P4 Lisibilité : ⚠️ Routes anciens modules (tickets, rachats, users) sans JSDoc complet
- P5 Format API : ✅ Aucune violation active
