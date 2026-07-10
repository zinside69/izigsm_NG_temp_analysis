# Recovery Prompt — iziGSM — 2026-07-10 (checkpoint fin de session)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Positionnement produit : plateforme façon repairdesk.co/monatelier.net, boutiques indépendantes par défaut, **mais le multi-sites géré (un client = plusieurs boutiques) est une vraie roadmap confirmée**, pas hors scope. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers (via Pages Functions), pattern strict Controller (`routes/`) → Service (`services/`, tout le SQL) → jamais de SQL inline dans une route
- Frontend HTML/CSS/JS vanilla, wrapper `ApiService` centralisé dans `app.js` (`apiGet`/`apiPost`/`apiPostPublic`/etc.) — **aucun `fetch()` direct** en dehors de ce fichier n'est autorisé (Principe 2, `docs/ARCHITECTURAL_PRINCIPLES.md` + `docs/PRINCIPES.md`, versionnés en git pour la première fois aujourd'hui)
- Isolation multi-tenant par ligne (`boutique_id` sur toutes les tables métier), une seule base D1 partagée — vérifiée dans le code aujourd'hui, pas juste supposée
- Auth JWT (access 1h + refresh 7j en KV), `boutique_id` embarqué dans le JWT, jamais fait confiance au client pour son propre scope (`getBoutiqueId()`)

## Ce qui s'est passé aujourd'hui (2026-07-10) — session très longue, 24 commits
1. **Migration Cloudflare terminée** (Genspark → Pages/D1/R2 direct, `repairdesk.fr` en prod)
2. **Bug `/register` corrigé** — inscription email/OTP jamais fonctionnelle, réparée + 3 failles de sécu trouvées et corrigées (fuite OTP, énumération de comptes, injection HTML)
3. **OAuth Google** ajouté sur `/login` et `/register`, avec onboarding boutique obligatoire pour les comptes sans boutique (`POST /api/auth/complete-onboarding`)
4. **Recherche entreprise SIRENE** (`recherche-entreprises.api.gouv.fr`, gratuite) — autocomplete à l'inscription, persiste enfin SIRET/adresse (colonnes existaient, jamais remplies)
5. **Isolation multi-tenant vérifiée** dans le code suite à une question de l'utilisateur sur la sécurité/étanchéité des données clients
6. **Backup D1 automatique** quotidien via GitHub Actions (indépendant de Cloudflare), `.github/workflows/d1-backup.yml`
7. **Bug majeur emails transactionnels** — `email_logs` vide depuis toujours, aucun email n'était jamais réellement parti (3 causes cumulées : `waitUntil()` manquant, pas de clé Resend par boutique, `FRONTEND_URL` absente). Corrigé et validé bout-en-bout en prod.
8. **Bugs annexes découverts en testant** (non corrigés, notés dans `todo.md`) : boutiques libre-service sans `slug` (vitrine/RDV inaccessible), table `boutique_creneaux` vide sans UI (RDV en ligne sans créneaux), `www.repairdesk.fr` en 521 (Gandi, pas nous)
9. **Feature "Accord" ticket spécifiée** (pas codée) — double validation boutique→client, réutilise le flow devis existant, email d'abord/SMS différé
10. **3 items produit ajoutés au backlog** : comparatif monatelier.net, rebranding "Mon Atelier"→"MyDesk" (15 occurrences listées), et le point 9 ci-dessus

## Décisions prises aujourd'hui (détail complet dans `decisions.md`)
- Multi-sites géré = vraie roadmap, pas hors scope (corrigé après une supposition erronée de l'agent)
- Fallback email plateforme (`RESEND_API_KEY` globale) quand une boutique n'a pas sa propre clé Resend — évite de forcer chaque atelier à créer un compte Resend avant de pouvoir écrire à ses clients
- Feature "Accord" réutilise `devis.ticket_id`/`devis.statut`/`devis-public.html` plutôt qu'un nouveau système de token
- Plus de `Co-Authored-By: Claude` dans les commits de ce workspace (feedback utilisateur)
- Commenter systématiquement le code + respecter le pattern existant (feedback utilisateur, applique à tous les projets du workspace)

## Fichiers importants
- `wrangler.jsonc` → config Pages/D1/R2 + `vars.FRONTEND_URL` (ajoutée aujourd'hui)
- `docs/ARCHITECTURAL_PRINCIPLES.md` + `docs/PRINCIPES.md` → conventions de code obligatoires, à consulter avant toute modification
- `docs/GAP_ANALYSIS_ENRICHI.md` → comparatif CDC le plus à jour (corrigé aujourd'hui sur A08 OAuth et L01-L09 emails, encore quelques entrées potentiellement stales ailleurs — vérifier dans le code avant de faire confiance à 100%)
- `.github/workflows/d1-backup.yml` → backup D1 quotidien, nécessite le secret GitHub `CLOUDFLARE_API_TOKEN` (déjà configuré et fonctionnel)
- `seed.sql` → compte de test `admin@izigsm.fr` / `Admin@2026!`

## Bugs connus (détail complet dans `bugs.md`)
- Boutiques libre-service sans `slug` → vitrine/RDV publics inaccessibles
- `boutique_creneaux` vide, aucune UI de config → prise de RDV en ligne sans créneaux
- `www.repairdesk.fr` → 521 (Gandi, hors de notre contrôle)
- `/factures/:id/emettre` n'envoie aucun email (jamais implémenté)
- Purge RGPD automatique non implémentée (seul vrai gap de conformité légale restant)
- HTML-injection préexistante sur 5 templates email (`client_prenom` non échappé) — même faille corrigée sur l'email OTP, pas propagée aux autres
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant)

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Respecter `ARCHITECTURAL_PRINCIPLES.md`/`PRINCIPES.md` — aucun `fetch()` direct hors `app.js`, aucun SQL inline dans les routes
- Commenter systématiquement le code ajouté (JSDoc backend, sections frontend)
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits
- Toujours proposer avant modification/suppression de fichier existant

## Prochaines étapes recommandées
1. Purge RGPD automatique (conformité légale, priorité la plus claire)
2. Fix `slug` manquant sur les boutiques libre-service (petit, débloque la vitrine pour toute nouvelle inscription)
3. UI de configuration des créneaux bookables (`boutique_creneaux`) — débloque la prise de RDV en ligne
4. Session de conception dédiée pour le multi-sites géré (chantier d'architecture, pas un ajout incrémental)
5. Implémentation de la feature "Accord" (spec déjà écrite dans `todo.md`)
