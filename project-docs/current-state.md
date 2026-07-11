# iziGSM — État courant (MàJ : 2026-07-11, fin de session — checkpoint 2)

## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Migration Cloudflare terminée (Genspark abandonné) — Pages + D1 + R2, domaine actif, DNS mail Gandi intact
- Inscription email/OTP, OAuth Google, recherche SIRENE, isolation multi-tenant, emails transactionnels, backup D1 quotidien — tout ce qui avait été corrigé le 2026-07-10, toujours opérationnel
- **Slug boutiques libre-service corrigé** — `createBoutiqueWithSettings()` génère désormais un slug (`slugify()` extrait dans `lib/db.ts`, réutilisé par la route admin) ; backfill appliqué en prod pour SOTELI (id 2 → `soteli`) et Desk1 (id 3 → `desk1`)
- **Chantier prise en charge livré** : onglet "État & Sécurité" (checklist état des lieux + codes PIN/SIM), signature client réellement capturée et persistée (avant : booléen fictif, dessin jamais transmis), affichage fiche détail + fiche imprimable existante mise à jour pour montrer l'état constaté et la vraie signature
- **Création de ticket via `/tickets` réellement fonctionnelle** — 3 bugs bloquants corrigés le même jour (voir § Bugs connus), testée en local sur les deux chemins (client existant / nouveau client créé à la volée)
- **Faille XSS corrigée** — `signature_client` validé strictement (data URL PNG/JPEG uniquement) côté API ET frontend avant toute interpolation dans un `<img src>`, trouvée par revue de sécurité automatique avant toute exposition en prod

## Bugs connus non corrigés (détail complet dans `bugs.md`)
- Prise de RDV en ligne : table `boutique_creneaux` vide pour toutes les boutiques, aucune UI pour la configurer
- `www.repairdesk.fr` → Error 521 (service redirection Gandi, indépendant de nous)
- `/factures/:id/emettre` n'envoie aucun email (jamais implémenté)
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, connu depuis la migration)
- **Assignation technicien à la création de ticket non fonctionnelle** — `<select id="t-technician">` contient des noms en dur, jamais les vrais employés ; `technicien_id` jamais envoyé. Nécessite un `populateTechniciens()` sur le modèle de `populateClients()` — fonctionnalité à construire, pas un simple renommage (contrairement aux 3 bugs de création de ticket corrigés aujourd'hui)
- Multi-appareils par ticket non supporté (`appareil_id` singulier en base) — décision à prendre, identifié dans l'analyse comparative monatelier §1.4
- Acompte à la prise en charge : convention informelle en notes libres, pas de champ structuré — décision à prendre, §1.6 de l'analyse comparative

## Chantiers identifiés pour plus tard (voir `todo.md` pour le détail complet)
- Purge RGPD automatique (Art. 5.1.e) — seul vrai gap de conformité légale restant
- Multi-sites géré (MOD-16 CDC) — roadmap confirmée, à scoper en session dédiée
- Outils marketing boutique : parrainage, avis clients, email/SMS anniversaire (widget dashboard chez monatelier), dépôt à distance (plus riche que supposé : statut `EN_TRANSIT` dédié, réexpédition trackée)
- SAV Constructeur Agréé (Apple/Samsung) — nouveau gap identifié dans l'analyse comparative v3, absent à 100%
- QualiRépar — absent à 100% côté iziGSM. **Ampleur confirmée réelle** (corrigé après une évaluation initiale erronée le même jour) : l'API partenaire EcoSystem "Fonds Réparation" existe bel et bien (standard OpenAPI, kit dev complet, 3 PDF techniques fournis par l'utilisateur dans `docs/`), workflow de suivi jusqu'au paiement confirmé par une preuve terrain (remboursement réellement perçu)
- Feature "Accord" avec double validation boutique→client (spec déjà écrite dans `todo.md`)
- Rebranding "Mon Atelier"/"monatelier" → "MyDesk" (15 occurrences listées dans `todo.md`)

## Repo et déploiement
- Repo : `izigsm/webapp/` (racine git), remote `zinside69/izigsm_NG_temp_analysis`, branche `main`
- Déploiement : `npm run build && npx wrangler pages deploy dist --project-name izigsm --branch main` — redéployé le 2026-07-11, `https://repairdesk.fr/api/health` confirmé 200 après déploiement
- Secrets Cloudflare Pages configurés : `JWT_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`
- Migrations `0032` (backfill slug) et `0033` (colonnes prise en charge : `etat_appareil`, `code_deverrouillage`, `code_sim`, `signature_client`, `signature_date`) appliquées en production le 2026-07-11
- Git : tout commité et pushé sur `origin/main` (`92f0db8` chantier prise en charge + `0c2cf47` correction QualiRépar), aucun reste en attente pour cette session
