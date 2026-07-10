# iziGSM — TODO (project-docs, distinct de docs/TODO.md qui suit les sprints produit)

## Migration Cloudflare — TERMINÉE le 2026-07-10

Plan complet : `docs/superpowers/plans/2026-07-09-migration-cloudflare.md` (9 tâches).
Spec : `docs/superpowers/specs/2026-07-09-migration-cloudflare-design.md`.

- [x] Task 1 : npm install + vérif tooling
- [x] Task 2 : R2 activé sur le compte Cloudflare
- [x] Task 3 : migrations D1 (déjà appliquées avant cette session — vérifié 48 tables réelles)
- [x] Task 4 : bucket R2 `izigsm-photos` + binding `PHOTOS` (commits `e1b1c58`, `6f26a51`)
- [x] Task 5 : secret `RESEND_API_KEY` posé (sous-domaine `mail.repairdesk.fr` déjà vérifié Resend)
- [x] Task 6 : build + déploiement HEAD (`885cc1e3`, commit `6f26a51`)
- [x] **Task 7 — TERMINÉE (2026-07-10)** : validation fonctionnelle sur `izigsm.pages.dev` (via API, navigateur indisponible)
  - [x] `/api/health` → v2.45.0 ✓
  - [x] `/register`, `/login` se chargent ✓
  - [x] Connexion avec `admin@izigsm.fr` / `Admin@2026!` (contournement — voir bugs.md, `/register` cassé) — `/api/auth/login` 200, JWT émis, `/api/auth/me` confirme role admin
  - [x] Créer un client + un ticket — client id `6`, ticket `TKT-2026-00006` (boutique `iziGSM Paris 11`, id 1)
  - [x] Uploader une photo sur le ticket (valide R2) — 201, `r2_key: tickets/6/photos/a04dbb1e-....jpg`, relue via `/photos/:id/view` (200, contenu identique)
  - [x] Écoute logs pendant le test (`wrangler pages deployment tail 885cc1e3-... --project-name izigsm --format json --status error`) — aucune erreur sur les 6 appels
- [x] **Task 8 — TERMINÉE (2026-07-10)** : `repairdesk.fr` attaché au projet Pages `izigsm`, ancien A record Gandi supprimé (confirmation explicite obtenue), CNAME créé manuellement (`repairdesk.fr → izigsm.pages.dev`, auto-provisioning Cloudflare bloqué), statut `active`, `/api/health` répond en prod
- [x] **Task 9 — TERMINÉE (2026-07-10)** : MX/SPF/DKIM/webmail/www re-vérifiés intacts, docs `current-state.md` + `decisions.md` clôturés

**Migration Cloudflare complète.** `repairdesk.fr` sert l'app en production, plus de dépendance Genspark.

## Dette technique découverte pendant la migration (voir bugs.md pour le détail)
- [x] `/register` cassé — **CORRIGÉ et VALIDÉ le 2026-07-10** (commits `e6b75b9`, `3129836`, déployé `8bcbb1d4`) — flow email OTP réel, testé bout-en-bout par l'utilisateur (inscription → email reçu → code vérifié → dashboard), voir bugs.md
- [ ] `docs/ARCHITECTURE_MODULES.md` §2 obsolète (noms de tables)
- [ ] 3 tests unitaires sensibles au fuseau horaire (non-bloquant)
- [ ] `escapeHtml()` manquant sur `client_prenom` dans 5 templates email (`sendTicketCree`, `sendTicketTermine`, `sendTicketLivre`, `sendSavOuvert`, `sendRelance`, `sendRelanceDevis`) — même faille corrigée sur l'email OTP, préexistante ailleurs

## Dette technique héritée (préexistante, voir bugs.md)
- [ ] `tests/phoneCatalogService.test.ts` à créer
- [ ] Investiguer `/robots.txt` 500 sur Genspark (sans objet une fois Genspark abandonné)
- [ ] `www.repairdesk.fr` → Error 521 (service redirection Gandi injoignable, apex OK)

## Fonctionnalité manquante — recherche entreprise à l'inscription
- [x] **FAIT le 2026-07-10** — `GET /api/public/entreprise-search` (`recherche-entreprises.api.gouv.fr`, gratuite, sans clé) : autocomplete fonctionnel sur `register.html` étape 2 + onboarding post-Google (`register.html`/`login.html`), préremplit nom/SIRET/adresse/CP/ville. `createBoutiqueWithSettings()` persiste enfin ces champs (colonnes existaient déjà en base, jamais remplies avant).

## Conformité légale — purge RGPD automatique (Art. 5.1.e)
Seul vrai gap de conformité restant identifié dans le CDC. `checkAndPurgeExpiredClients()` / `checkAndPurgeExpiredTickets()` n'existent pas — purge sur demande (Art.17) fonctionne, mais pas de purge automatique après expiration des durées légales de conservation. Voir aussi la tension avec le registre anti-recel art. 321-7 (documentée dans `bugs.md`).
- [ ] Scoper et implémenter la purge automatique (batch + 3 états base active/archive légale/destruction)

## Roadmap confirmée — Multi-sites géré (MOD-16 CDC, ex-B07)
Confirmé le 2026-07-10 : ce n'est PAS hors périmètre produit. Un client possédant plusieurs boutiques doit pouvoir avoir un dashboard consolidé (vue toutes boutiques), naviguer vers chaque site, et transférer stock/personnel entre boutiques de son groupe. Cohabite avec le modèle actuel (boutiques indépendantes par défaut, façon RepairDesk/MonAtelier) — un client peut simplement posséder plusieurs boutiques indépendantes reliées à son compte.
Chantier d'architecture, pas un ajout incrémental — le modèle actuel est strictement 1 user = 1 boutique_id (JWT). Nécessite : notion de groupe propriétaire, utilisateur multi-boutiques, mécanismes de transfert stock/personnel tracés. **À scoper en session dédiée** (conception avant code).
- [ ] Session de conception : modèle de données groupe/multi-accès, impact sur l'isolation multi-tenant actuelle (vérifiée étanche le 2026-07-10), UI dashboard consolidé

## Outils marketing pour les boutiques (2026-07-10, à revisiter)
Déjà en place : vitrine publique, catalogue services public, prise de RDV en ligne, page de suivi réparation client, emails automatiques (statut/facture/devis), relances devis. Manquant, identifié en croisant `CDC_Manus.md` §5.7/5.12/5.14 avec le code réel :
- [ ] **Programme de parrainage** — `referral_code`/`referred_by` prévus dans le modèle CRM (CDC §5.7), jamais implémentés (= item C10 gap analysis, Post-MVP)
- [ ] **Collecte d'avis clients** — sondage post-réparation automatique, jamais construit (= item C11 gap analysis, Post-MVP)
- [ ] **Email anniversaire client** — trigger prévu dans l'"Automation Engine" du CDC (§5.12), aucune trace dans le code, jamais planifié en sprint
- [ ] **Dépôt à distance / devis avec photos** — formulaire public de capture de lead sans déplacement (CDC §5.14 `/pro/:slug/depot` + `/devis`) — item N06 gap analysis, Post-MVP

Impact business (avis de l'agent, à discuter) : dépôt à distance = acquisition, parrainage + avis clients = rétention/confiance — probablement les plus proches de "killer features" chez la concurrence (RepairDesk/MonAtelier).

## Bug — boutiques créées en libre-service sans slug (vitrine/RDV inaccessibles)
Constaté le 2026-07-10 en testant les liens vitrine/RDV. `createBoutiqueWithSettings()` (`authService.ts`, utilisée par `/register` et `/complete-onboarding`) ne génère jamais de `slug`, contrairement à la route admin `POST /api/boutiques` (`boutiques.ts:137`) qui a déjà la logique d'auto-génération. Résultat : toute boutique créée via inscription libre-service (ex. SOTELI, Desk1 créées aujourd'hui) a `slug: NULL` en base → sa page vitrine/RDV publique (`rdv-public.html?slug=...`) est injoignable, aucun client ne peut réserver.
- [ ] Réutiliser la logique de génération de slug de `boutiques.ts:137` dans `createBoutiqueWithSettings()` (authService.ts) — fix ciblé, pas de nouvelle table/migration nécessaire
- [ ] Vérifier s'il faut aussi backfiller le slug des boutiques déjà créées sans (SOTELI id 2, Desk1 id 3)

## Bug — prise de RDV en ligne : aucun créneau disponible (table boutique_creneaux vide)
Constaté le 2026-07-10 en testant `rdv-public.html`. `getDisponibilites()` (`publicService.ts:286`) lit la table `boutique_creneaux` (horaires bookables hebdomadaires par boutique) pour générer les créneaux — **cette table est vide pour toutes les boutiques, sans exception**, et **aucune UI ni route API n'existe pour la configurer** (recherché dans tout `src/` et `public/` — seule la migration `0025_rdv_public.sql` la crée). Le moteur lui-même est correct : il croise déjà les créneaux template avec les vrais RDV existants (table `rendez_vous`, celle de l'agenda interne) pour exclure les créneaux occupés — donc booking public et agenda interne sont déjà connectés au niveau données.
- [ ] Construire l'écran de configuration des horaires bookables (settings.html ou nouvel onglet) + route CRUD `boutique_creneaux`
- [ ] Vérifier besoin exprimé par l'utilisateur : affichage agenda (RDV en cours + disponibilités) directement sur le dashboard technicien (au-delà de la page `/agenda` dédiée déjà existante) — à clarifier en session dédiée

## Bug majeur — emails transactionnels jamais envoyés — CORRIGÉ et VALIDÉ le 2026-07-10
- [x] `waitUntil()` ajouté sur les 5 triggers fire-and-forget (tickets créé/terminé/livré/archivage auto, SAV ouvert, devis envoyé)
- [x] Fallback `RESEND_API_KEY` globale quand la boutique n'a pas sa propre clé (expéditeur forcé `mail.repairdesk.fr`)
- [x] `FRONTEND_URL=https://repairdesk.fr` ajoutée (`wrangler.jsonc`) — les liens emails pointaient vers `localhost:3000` en prod
- [x] Validé bout-en-bout : ticket `TKT-2026-00009`, email reçu par `telnet@bbox.fr`, lien de suivi correct — commit `2968bfa`
- Détail complet dans `bugs.md`. Dette restante notée là-bas : `/factures/:id/emettre` n'envoie toujours aucun email (jamais implémenté, GAP_ANALYSIS_ENRICHI.md corrigé en conséquence).
