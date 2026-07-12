# iziGSM — TODO (project-docs, distinct de docs/TODO.md qui suit les sprints produit)

## Analyse comparative monatelier.net — couverture complète (2026-07-11 v3)

- [x] **FAIT** — Les 19 pages du centre d'aide `monatelier.net/aide/*` lues intégralement (v2 n'en couvrait que 9, via les liens précédent/suivant qui ratent 10 pages non reliées linéairement — sitemap complet retrouvé via le menu latéral). `docs/ANALYSE_COMPARATIVE_MONATELIER.md` v3.
  - Nouveaux gaps trouvés : SAV Constructeur Agréé (Apple/Samsung, absent à 100%), prise en charge à distance plus riche que supposé (statut EN_TRANSIT dédié, réexpédition trackée), badge "Réceptionné par" distinct du technicien assigné, import Excel (pas juste CSV) avec fichier modèle téléchargeable, tableau de bord équipe (CA/marge/délai moyen par technicien)
  - Nuance importante : QualiRépar chez monatelier est un simple bouton de remise pré-remplie par catégorie d'appareil (pas une intégration API de tracking Soumis→Validé→Remboursé comme le suggérait le marketing en v2) — le gap reste réel côté iziGSM mais l'ampleur du travail est revue à la baisse
  - Section "💡 À s'inspirer" ajoutée : 7 idées concrètes à faible coût (fichier modèle import, badge RDV→ticket, aperçu notification avant envoi, tableau CA/marge/délai par technicien, PIN switch déjà fait côté iziGSM)
  - `docs/monatelier_aide_notes.md` mis à jour avec le sitemap complet 19 pages + notes structurelles gestion d'équipe (pertinent pour le futur `populateTechniciens()`)

## Chantier prise en charge — état/sécurité/signature (démarré 2026-07-11)

Point de départ : `docs/ANALYSE_COMPARATIVE_MONATELIER.md` §1 (gaps liés à l'écran de prise en charge).

- [x] Migration `migrations/0033_ticket_prise_en_charge.sql` — colonnes `etat_appareil` (JSON), `code_deverrouillage`, `code_sim`, `signature_client`, `signature_date` sur `tickets`. **Appliquée en production.**
- [x] Backend `ticketService.ts`/`routes/tickets.ts` — champs optionnels sur create/update, exclus de `listTickets()`/`getKanban()` (uniquement dans `getTicketById()`)
- [x] Frontend `tickets.html`/`tickets.js` — nouvel onglet "État & Sécurité" (checklist + codes), signature réellement capturée et envoyée (avant : booléen seulement, dessin jamais transmis)
- [x] Affichage fiche détail (checklist + codes + image signature) et fiche imprimable existante (`printTicket()`) mise à jour pour montrer l'état constaté + la vraie signature si capturée
- [x] Tests `ticketService.test.ts` mis à jour, suite complète 704/707 (3 échecs = tests fuseau horaire déjà connus, sans lien)
- [x] Validé en local (navigateur réel, D1 local) — checklist, codes, signature dessinée à la main, persistance confirmée, absence des champs sensibles en liste
- [x] **Faille XSS corrigée le 2026-07-11** — `signature_client` validé strictement (data URL PNG/JPEG base64 uniquement) côté API ET frontend avant toute interpolation dans `<img src>`, trouvée par revue de sécurité automatique. Détail dans `bugs.md`.
- [x] **Bug bloquant création de ticket corrigé le 2026-07-11** — `client_id` jamais envoyé + 4 champs mal nommés (`marque`/`modele`/`description`/`devis_montant` → `appareil_marque`/`appareil_modele`/`description_panne`/`prix_estime`) + valeurs de priorité non alignées avec l'enum API. Validé en local sur les deux chemins (client existant / nouveau client créé à la volée). Détail complet dans `bugs.md`. **Ce chantier est maintenant réellement utilisable de bout en bout.**
- [ ] Non corrigé, hors scope (fonctionnalité à construire, pas un renommage) : assignation technicien à la création — `<select id="t-technician">` contient des noms en dur, jamais les vrais employés, `technicien_id` jamais envoyé. Nécessite un `populateTechniciens()` sur le modèle de `populateClients()`.
- [ ] Décision à prendre : multi-appareils par ticket (`appareil_id` est singulier en base aujourd'hui) — identifié dans l'analyse comparative §1.4, pas encore scopé
- [ ] Décision à prendre : acompte structuré à la prise en charge (§1.6 de l'analyse) — actuellement une convention informelle en notes libres

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

## Analyse comparative — monatelier.net vs repairdesk.fr (demandé 2026-07-10)
- [x] **FAIT le 2026-07-11 (v2)** — Analyse comparative complète : `docs/ANALYSE_COMPARATIVE_MONATELIER.md`. v1 basée sur du marketing seul (pages `/aide/*` = SPA inaccessibles au fetch simple) ; v2 relit `/aide/*` intégralement via navigateur (Claude in Chrome) — 9 pages, dont `/aide/premiers-pas` (répartition officielle Solo/Pro, source la plus fiable trouvée). Chaque gap recoupé avec le code iziGSM (`Grep src/`), pas seulement avec `GAP_ANALYSIS_ENRICHI.md`.
  - Gaps prioritaires liés au chantier prise en charge en cours : signature électronique bon de dépôt (dès plan Solo monatelier), codes de sécurité appareil (PIN/schéma déverrouillage — absent à 100% côté iziGSM), état des lieux structuré (checklist rayures/dégâts — absent, iziGSM n'a que des notes libres), multi-appareils par ticket (`appareil_id` est singulier en base, à corriger si retenu), acompte structuré (actuellement une convention informelle en notes libres, pas un champ dédié)
  - Autres gaps confirmés : signature eIDAS devis (`G08`, déjà connu), QualiRépar (absent à 100%, jamais scopé), TVA sur la marge pour le rachat/reconditionné (nouveau — vrai sujet de conformité fiscale, à vérifier sérieusement), SMS transactionnels (`L10`), Retours client/RMA fournisseurs (`H07`/`H08`), parrainage (`C10`), export FEC (`F11`), éditeur de templates email/SMS, widget anniversaires
  - **Corrections vs v1** : vente directe en caisse et remises par ligne sont en fait déjà implémentées côté iziGSM (`caisseService.ts`, `factureService.ts` `remise_pct`) — v1 les avait citées comme gaps par erreur ; inventaire temps réel retiré (la doc officielle monatelier ne décrit qu'un dashboard, pas un comptage physique) ; logo boutique sur documents probablement déjà en place (`boutiques.logo_url` existe et est utilisé)
  - Parité ou avantage iziGSM confirmé : Agenda/RDV (iziGSM en avance — booking en ligne déjà actif), livre de police 321-7, SAV garanties/tickets, à-commander/CUMP, vitrine publique, rapports/KPIs, caisse NF525, granularité des statuts ticket (9 statuts iziGSM vs 7 colonnes monatelier), avoirs & bons d'achat

## Rebranding — retirer "Mon Atelier" / "monatelier", remplacer par "MyDesk" (demandé 2026-07-10)
"Mon Atelier" est utilisé comme nom de boutique par défaut/placeholder à plusieurs endroits du code — à remplacer par "MyDesk" pour ne pas rappeler la marque du concurrent monatelier.net. Occurrences trouvées (recherche `mon atelier|monatelier`, insensible à la casse) :
- [ ] `public/static/js/app.js:27,385,386` — fallback `session.company`/`user.boutique_name` dans le wrapper ApiService partagé (impacte tout le dashboard)
- [ ] `public/static/js/register.js:230,231` — fallback session après inscription email/OTP
- [ ] `public/login.html:81,156,157,267,268` — placeholder input onboarding Google + fallback session (×2 occurrences : handleGoogleCredential et submitOnboarding)
- [ ] `public/register.html:158,201,326,447,448` — placeholder `company_name`, lien "🇧🇪 Mon atelier est en Belgique" (formulation générique, à reformuler aussi), placeholder onboarding Google, fallback session
- [ ] `src/routes/auth.ts:659` — exemple dans un commentaire JSDoc (`workshopName: "Mon Atelier"`) — cosmétique, à corriger pour cohérence
- Vérifier aussi les autres pages internes (`dashboard.html`, `settings.html`, etc.) non auditées ici — recherche limitée à `src/` et `public/` en surface

## Page de suivi ticket — étape "Accord" avec double validation boutique→client (spécifié 2026-07-10)
La timeline "Progression" existe déjà (`suivi.html:93-94`, `renderTimeline()` L276-303) avec une étape `attente_accord` / label "Accord" / icône `fa-handshake` (`STEPS`, `suivi.html:151`) — mais son état est aujourd'hui purement dérivé du statut linéaire du ticket (fait/actif/à venir), sans notion d'approbation client réelle.

**Comportement demandé** : quand la boutique valide un diagnostic/devis (passe le ticket en `attente_accord`), un lien d'approbation est envoyé au client. Dès que le client clique et accepte, l'étape passe au vert (preuve d'acceptation). États chronologiques de l'étape "Accord" :
- **Gris** : ticket pas encore arrivé à cette étape
- **Orange** : boutique a validé / lien envoyé, en attente de réponse client
- **Vert** : client a cliqué et accepté

**Décisions de conception validées avec l'utilisateur (2026-07-10)** :
1. **Email d'abord, SMS bloqué** : le lien part par email (Resend, même mécanisme que le reste — déjà fiable depuis le fix du jour). Le SMS reste explicitement hors scope tant qu'un fournisseur SMS (Twilio ou autre) n'est pas choisi — c'était Post-MVP partout ailleurs dans le projet, pas de raison de le sortir du lot ici sans décision dédiée.
2. **Réutiliser le flow devis existant**, ne pas dupliquer un système de token : `devis.ticket_id` (FK optionnelle, `migrations/0006_facturation.sql:10`) et `devis.statut` (`envoye`/`accepte`/`refuse`) couvrent déjà exactement ce besoin. `devis-public.html` + `POST /api/public/devis/:token/repondre` gèrent déjà la page cliquable + l'action d'acceptation.

**Reste à faire pour implémenter** :
- [ ] Dans `renderTimeline()` (`suivi.html`), calculer l'état de l'étape "Accord" à partir du devis lié au ticket (si `devis.ticket_id = t.id` existe : `envoye`→orange, `accepte`→vert, `refuse`→état à définir) plutôt que du statut ticket seul
- [ ] `GET /api/public/ticket/:token` (`publicService.ts`) doit exposer les infos du devis lié (statut au minimum) pour que le frontend puisse calculer cet état
- [ ] Vérifier que l'envoi du devis (`POST /devis/:id/envoyer`, déjà fonctionnel depuis le fix du jour) est bien le déclencheur naturel de l'état "orange"
- [ ] SMS : décision fournisseur à prendre séparément (Twilio le plus documenté dans le projet) avant d'ajouter ce canal

## Chantier Ports & Adapters + assignation technicien (2026-07-12)

Spec : `docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md`. Plan : `docs/superpowers/plans/2026-07-12-ports-adapters-technicien-assignment.md`. Objectif long terme : sortir de Cloudflare (VPS + Postgres), sans changer le CDC fonctionnel.

- [x] Port `Database` (`src/ports/database.ts`) + adaptateur D1 (`src/adapters/cloudflare/d1Database.ts`) + mock de test (`tests/helpers/mockDatabase.ts`)
- [x] Premier service migré : `userService.listUsers()` (candidat plus sûr que `personnelService.ts` cité en exemple dans le spec — zéro test préexistant à risquer)
- [x] Injection du port dans le contexte Hono (`index.tsx`) + branchement `routes/users.ts`
- [x] `populateTechniciens()` — remplace les 3 noms en dur du select technicien par les vrais utilisateurs (`GET /api/users`), `saveTicket()` envoie `technicien_id` numérique
- [x] **Corrigé le 2026-07-12** (revue finale de branche) : `technicien_id` validé contre `boutique_id` du ticket (isolation multi-tenant) — détail dans `bugs.md`
- [x] **Corrigé le 2026-07-12** : `editTicket()` présélectionne à nouveau le technicien assigné — détail dans `bugs.md`
- [ ] Migrer les 17 autres services vers le port `Database` (rollout service par service, hors scope de ce chantier initial)
- [ ] Ports `Storage`/`Cache` (R2/D1KV → disque local/Redis) — pas nécessaires tant que la bascule VPS n'est pas engagée
- [ ] `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas seulement les techniciens — fonctionnel mais sémantiquement flou, envisager un filtre par rôle
- [ ] Pas de test dédié pour `D1DatabaseAdapter` (seuls le service migré et le mock sont couverts) — validé en live, à ajouter quand pertinent
- [ ] `GET /api/users` réservé aux rôles admin/manager — un technicien ouvrant "Nouvelle prise en charge" ne voit pas la liste se remplir (échec silencieux). Envisager un endpoint dédié accessible à tous les rôles authentifiés si ça devient gênant en usage réel
- [ ] Adaptateur Postgres, migration des données, déploiement Node.js sur VPS — hors scope tant que non engagé

## Bug prod critique — numérotation documents non isolée par boutique — CORRIGÉ le 2026-07-12

Détail complet dans `bugs.md`. Root cause : `numero` avait une contrainte `UNIQUE` globale (`tickets`, `factures`, `devis`, `avoirs`, `rachats`) alors que les compteurs (`sequences`) sont calculés indépendamment par boutique.

- [x] Migration `migrations/0034_numero_unique_par_boutique.sql` : `UNIQUE(boutique_id, numero)` sur les 5 tables, testée en local puis appliquée en prod
- [x] Validé en local : même numero accepté sur 2 boutiques différentes, toujours rejeté sur la même boutique, AUTOINCREMENT/FK intacts
- [x] Validé en prod : création de ticket Desk1 (boutique_id=3) → 201 (échouait en 500 avant), ticket/client de test nettoyés
