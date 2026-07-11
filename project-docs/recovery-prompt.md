# Recovery Prompt — iziGSM — 2026-07-11 (checkpoint 2, fin de session)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Positionnement produit : plateforme façon repairdesk.co/monatelier.net, boutiques indépendantes par défaut, **mais le multi-sites géré (un client = plusieurs boutiques) est une vraie roadmap confirmée**, pas hors scope. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers (via Pages Functions), pattern strict Controller (`routes/`) → Service (`services/`, tout le SQL) → jamais de SQL inline dans une route
- Frontend HTML/CSS/JS vanilla, wrapper `ApiService` centralisé dans `app.js` — aucun `fetch()` direct en dehors de ce fichier
- Isolation multi-tenant par ligne (`boutique_id` sur toutes les tables métier), une seule base D1 partagée
- Auth JWT (access 1h + refresh 7j en KV), `boutique_id` embarqué dans le JWT

## Ce qui s'est passé aujourd'hui (2026-07-11)
1. **Fix slug boutiques libre-service** — `createBoutiqueWithSettings()` ne générait jamais de slug → vitrine/RDV public inaccessible. `slugify()` extrait dans `lib/db.ts`, réutilisé partout. Backfill appliqué en prod (SOTELI, Desk1).
2. **Analyse comparative monatelier.net v1→v3** — d'abord marketing seul (v1), puis centre d'aide lu via navigateur (v2, 9 pages), puis couverture complète (v3, 19/19 pages via le sitemap du menu latéral). Section "💡 À s'inspirer" ajoutée. Nuance importante trouvée : QualiRépar chez monatelier est un simple bouton de remise pré-remplie, pas l'intégration API de tracking suggérée par le marketing.
3. **Chantier prise en charge** (checklist état des lieux + codes de sécurité + signature) — migration `0033`, backend `ticketService.ts`/`routes/tickets.ts`, nouvel onglet "État & Sécurité" dans `tickets.html`/`tickets.js`, affichage fiche détail + fiche imprimable existante.
4. **Bug critique préexistant découvert en testant en navigateur réel** — le bouton "+ Nouvelle prise en charge" plantait systématiquement (`IndexSizeError` sur un canvas 0x0, `isSigEmpty()` appelée avant que l'onglet Signature n'ait jamais été affiché). Corrigé.
5. **Faille XSS trouvée par revue de sécurité automatique** — `signature_client` interpolé sans validation fiable dans `<img src>`. Corrigée côté API et frontend avant tout déploiement.
6. **Bug bloquant création de ticket, corrigé** — `client_id` jamais envoyé + 4 champs mal nommés dans le payload (`marque`/`modele`/`description`/`devis_montant` au lieu de `appareil_marque`/`appareil_modele`/`description_panne`/`prix_estime`) + valeurs de priorité non alignées avec l'enum API. Validé en local sur les deux chemins (client existant / nouveau client créé à la volée).
7. **Déployé en production** le 2026-07-11 (`wrangler pages deploy`), `/api/health` confirmé 200 après déploiement.
8. **Correction QualiRépar** — l'évaluation initiale ("ampleur revue à la baisse, pas d'API") était fausse. L'utilisateur a fourni 3 PDF techniques EcoSystem (`docs/Guide d'utilisation de l'API Partenaire réparateur - V3.0.0.pdf` + 2 autres) confirmant qu'une vraie API partenaire "Fonds Réparation" existe (OpenAPI, kit dev complet), avec preuve terrain d'un remboursement réellement perçu. Erreur méthodologique identifiée : j'avais comparé le marketing à une page d'aide *utilisateur final*, sans chercher de doc technique développeur séparée. `docs/ANALYSE_COMPARATIVE_MONATELIER.md` §2.10 et `decisions.md` corrigés et commités (`0c2cf47`).
9. **Nettoyage final** — les fichiers de référence qui traînaient depuis le début de session (CDC PDF/docx, PDF techniques EcoSystem, preuve de paiement QualiRépar) ont été committés sur demande explicite (`ea6fea3`) après vérification qu'ils étaient légitimes (`CDC_izigsm.pdf` remplaçait un placeholder cassé de 5,5 Ko par la version complète de 314 Ko). Working tree propre en fin de session.

## Décisions prises aujourd'hui (détail complet dans `decisions.md`)
- v3 de l'analyse comparative suffit — pas besoin de garder les versions intermédiaires en fichiers séparés
- Déployer avant de committer (ordre explicite demandé par l'utilisateur : déploie → checkpoint → commit → push)

## Fichiers importants
- `wrangler.jsonc` → config Pages/D1/R2
- `docs/ANALYSE_COMPARATIVE_MONATELIER.md` → v3, 19/19 pages du centre d'aide monatelier couvertes
- `docs/monatelier_aide_notes.md` → sitemap complet + notes structurelles pour la future doc iziGSM (site + PDF + base vectorielle agent IA)
- `docs/Guide d'utilisation de l'API Partenaire réparateur - V3.0.0 - 2022-10-10.pdf` + `docs/ecosystem - API Fonds Réparation - RGPD et Purge des demandes.pdf` + `docs/ecosystem - Pièces Issues de l_Economie Circulaire (PIEC).pdf` → doc technique complète API QualiRépar EcoSystem, désormais trackées en git — référence si le chantier QualiRépar est scopé
- `docs/260115000258.PDF`/`.CSV` → preuve terrain d'un remboursement QualiRépar réellement perçu, désormais tracké en git
- `docs/CDC_izigsm.pdf` → remplacé par la version complète (314 Ko, l'ancienne version trackée était un placeholder cassé de 5,5 Ko) ; `docs/CDC_izigsm.docx`, `docs/CDC izigsm_sections.docx`, `docs/CDC_izigsm Manus.docx`, `docs/LISTE_FONCTIONNALITES_TECHNIQUES.md` également ajoutés au repo le 2026-07-11
- `docs/GAP_ANALYSIS_ENRICHI.md` → comparatif CDC, pas mis à jour aujourd'hui (à rafraîchir : slug, prise en charge, signature ne sont pas encore reflétés)
- `seed.sql` → compte de test `admin@izigsm.fr` / `Admin@2026!`

## Bugs connus (détail complet dans `bugs.md`)
- `boutique_creneaux` vide, aucune UI de config → prise de RDV en ligne sans créneaux
- `www.repairdesk.fr` → 521 (Gandi, hors de notre contrôle)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant)
- Assignation technicien à la création de ticket non fonctionnelle (noms en dur, `technicien_id` jamais envoyé) — nécessite un vrai `populateTechniciens()`, pas un simple renommage

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Commenter systématiquement le code ajouté (JSDoc backend, sections frontend) — rappelé une 2e fois aujourd'hui, signal que c'est facilement oublié en cours de session
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits
- Toujours proposer avant modification/suppression de fichier existant

## Prochaines étapes recommandées
1. Corriger `populateTechniciens()` (assignation technicien à la création de ticket) — même famille de bug que ce qui vient d'être corrigé, mais une vraie fonctionnalité à construire
2. Décider : multi-appareils par ticket, acompte structuré — deux points en attente de décision produit (analyse comparative §1.4/§1.6)
3. Purge RGPD automatique (conformité légale)
4. UI de configuration des créneaux bookables (`boutique_creneaux`)
5. Rafraîchir `docs/GAP_ANALYSIS_ENRICHI.md` pour refléter les changements du 2026-07-11 (slug, prise en charge, signature)
6. Décider quels items de la section "💡 À s'inspirer" de l'analyse comparative construire (fichier modèle import, badge RDV→ticket, aperçu notification, tableau CA/marge/délai par technicien)
7. QualiRépar : intégration API désormais bien documentée (3 PDF EcoSystem dans `docs/`) — envisager une session de cadrage dédiée si ce chantier devient prioritaire
