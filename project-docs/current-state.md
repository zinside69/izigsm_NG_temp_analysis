# iziGSM — État courant (MàJ : 2026-07-10, fin de session — checkpoint)

## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Migration Cloudflare **terminée** (Genspark abandonné) — Pages + D1 + R2, domaine actif, DNS mail Gandi intact
- Inscription email/OTP **réelle et fonctionnelle** (corrigée aujourd'hui — était cassée depuis le début)
- OAuth Google **fonctionnel** sur `/login` et `/register`, avec onboarding boutique obligatoire pour les comptes sans boutique
- Recherche entreprise SIRENE (autocomplete gratuit gouv.fr) fonctionnelle à l'inscription + onboarding Google
- Isolation multi-tenant **vérifiée dans le code** (pas supposée) : `getBoutiqueId()` + `WHERE boutique_id = ?` sur 14 fichiers routes
- **Emails transactionnels réellement envoyés** (corrigé aujourd'hui — n'avaient jamais fonctionné depuis la création de la base, `email_logs` vide)
- Backup D1 automatique quotidien (GitHub Actions, indépendant de Cloudflare, `.github/workflows/d1-backup.yml`)
- Vitrine publique + catalogue services : fonctionnels (testés avec `iziGSM Paris 11`, slug `izigsm-paris-11`)
- Page de suivi ticket client : fonctionnelle (timeline "Progression" déjà présente et opérationnelle)

## Bugs connus non corrigés (détail complet dans `bugs.md`)
- Boutiques créées en libre-service (`/register`, onboarding Google) n'ont **pas de `slug`** → leur vitrine/RDV public est inaccessible (`createBoutiqueWithSettings()` ne reprend pas la logique de `boutiques.ts:137`)
- Prise de RDV en ligne : table `boutique_creneaux` vide pour toutes les boutiques, **aucune UI pour la configurer** — le moteur de disponibilité est correct (croise déjà avec les vrais RDV), juste jamais alimenté
- `www.repairdesk.fr` → Error 521 (service redirection Gandi, indépendant de nous)
- `/factures/:id/emettre` n'envoie aucun email (jamais implémenté, contrairement à ce qu'affirmait `GAP_ANALYSIS_ENRICHI.md` avant correction)
- Champ "Rechercher mon entreprise"… (résolu aujourd'hui, ne plus confondre avec le point ci-dessus)
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, connu depuis la migration)

## Chantiers identifiés pour plus tard (voir `todo.md` pour le détail complet)
- Purge RGPD automatique (Art. 5.1.e) — seul vrai gap de conformité légale restant
- Multi-sites géré (MOD-16 CDC) — **confirmé comme vraie roadmap produit** (pas hors scope), à scoper en session dédiée
- Outils marketing boutique : parrainage, avis clients, email anniversaire, dépôt à distance — tous Post-MVP mais identifiés comme proches de "killer features" concurrentes
- Feature "Accord" avec double validation boutique→client (spec précise déjà écrite dans `todo.md` : réutilise le flow devis existant, email d'abord, SMS bloqué en attente choix fournisseur)
- Rebranding : retirer "Mon Atelier"/"monatelier" → "MyDesk" (15 occurrences listées précisément dans `todo.md`)
- Analyse comparative fonctionnalités monatelier.net/aide/ vs repairdesk.fr

## Repo et déploiement
- Repo : `izigsm/webapp/` (racine git), remote `zinside69/izigsm_NG_temp_analysis`, branche `main`
- 24 commits aujourd'hui (2026-07-10) — voir `git log --oneline --since="2026-07-10 00:00"`
- Déploiement : `npm run build && npx wrangler pages deploy dist --project-name izigsm --branch main`
- Secrets Cloudflare Pages configurés : `JWT_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`
- Var non-secrète ajoutée aujourd'hui : `FRONTEND_URL=https://repairdesk.fr` (`wrangler.jsonc`, était absente → liens emails cassés vers localhost)
- `CACHE_VERSION` sw.js à v2.47 (bumpée 2× aujourd'hui — mécanisme de cache-busting du Service Worker était resté figé depuis Sprint 2.17, tout déploiement depuis restait invisible aux navigateurs avec le SW déjà installé)
