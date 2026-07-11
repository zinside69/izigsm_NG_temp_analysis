# Analyse Comparative — iziGSM vs monatelier.net

> **Date** : 11 juillet 2026 (v3 — couverture complète des 19 pages du centre d'aide, remplace la v2 qui n'en couvrait que 9)
> **Version iziGSM analysée** : v2.45.0 (référence `docs/GAP_ANALYSIS_ENRICHI.md` v4.3) + tout le code touché ce jour (prise en charge état/sécurité/signature)
> **Sources** : les 19 pages de `monatelier.net/aide/*` lues intégralement via navigateur (sitemap complet extrait du menu latéral, pas seulement des liens précédent/suivant) + `docs/monatelier_observations.md` (compte d'essai authentifié) + pages marketing (signal secondaire). Chaque gap retenu a été recoupé avec le code iziGSM.

---

## Légende

- 🔴 **Gap confirmé** — monatelier l'a (doc officielle ou observation), iziGSM ne l'a pas
- 🟡 **Gap partiel / à vérifier** — signal présent, statut iziGSM incertain ou terminologie différente
- 🟢 **Parité ou avantage iziGSM**
- 💡 **À s'inspirer** — idée concrète, peu coûteuse, à envisager sérieusement pour iziGSM
- ⚪ **Différence de positionnement** — pas un gap, un choix de modèle différent

---

## 1. Couverture du centre d'aide — 19/19 pages lues

| # | Page monatelier | Catégorie | Équivalent iziGSM |
|---|---|---|---|
| 1 | Premiers pas | Onboarding | — (pas de guide interne équivalent) |
| 2 | Tableau de bord | Onboarding | `P01` Dashboard 12 KPIs |
| 3 | Paramètres de l'atelier | Onboarding | `B02` boutique_settings |
| 4 | Importer des données | Onboarding | `C06` import CSV clients |
| 5 | Faire une prise en charge | Prise en charge | `D01-D12` + chantier du jour |
| 6 | Prestations & pièces | Prise en charge | lignes ticket/facture |
| 7 | Devis & Factures | Facturation | `F01-F11`, `G01-G08` |
| 8 | Avoirs & Bons d'achat | Facturation | `F05`, `O05-O06` |
| 9 | Gestion des clients | Clients | `C01-C11` |
| 10 | Statuts de réparation | Prise en charge | `D02-D07` |
| 11 | Agenda (Pro) | Agenda | `J01-J10` |
| 12 | Prise en charge à distance (Pro) | Prise en charge | `N06` ❌ Post-MVP |
| 13 | SAV & Garanties (Pro) | SAV | `H01-H08` |
| 14 | Remises | Facturation | `factureService.ts` `remise_pct` |
| 15 | Catalogue de services | Catalogue | `R01-R10` |
| 16 | Stock & commandes (Pro) | Stock | `E01-E10`, `I01-I08` |
| 17 | Rachat d'occasion (Pro) | Reconditionnement | `Q04`, `O01-O06` |
| 18 | Gestion d'équipe (Pro) | Équipe | `A04-A06`, `M01-M07` |
| 19 | Conformité & Archivage (Pro) | Conformité | `Q01-Q10` |

---

## 2. Gaps confirmés — nouveaux (pages lues cette v3, pas dans la v2)

| # | Fonctionnalité monatelier | Statut iziGSM | Niveau |
|---|---|---|---|
| 2.1 | **SAV Constructeur Agréé** (Apple Authorized Service Provider, Samsung Care+…) — module dédié pour tracer un numéro de dossier constructeur (GSX, Samsung Members), pièces couvertes, statut, décision finale, lié au ticket client sans générer de facturation | **Absent à 100%** — aucune mention dans `CDC_Manus.md`, `GAP_ANALYSIS_ENRICHI.md` ni le code. Nouveau gap, pas identifié en v2. Pertinent seulement si iziGSM cible des ateliers agréés constructeur — à valider avec le positionnement produit avant de le scoper. | 🔴 |
| 2.2 | **Prise en charge à distance** — bien plus détaillée que supposé en v2 : adresse de réception dédiée, statut ticket `EN_TRANSIT` propre, bandeau "colis en transit" sur le Kanban, capture du numéro de suivi retour, notification client automatique à la réexpédition | `N06` ❌ Post-MVP, décrit en v2 comme "formulaire + upload R2" — sous-estimé, c'est un vrai sous-workflow avec ses propres statuts et notifications, pas juste un formulaire de lead. | 🔴 |
| 2.3 | **Badge "Réceptionné par" distinct du technicien assigné** — trace qui a accueilli le client à la différence de qui répare, affiché automatiquement si différent | `D04` n'a qu'un seul `technicien_id` par ticket — pas de distinction accueil/réparation. | 🔴 |
| 2.4 | **Permissions granulaires nommées** : "voir tickets de tous les techs", "réassigner le travail", "voir données financières" (masque montants/marges) — configurables par technicien individuellement | `A05` "Permissions granulaires par action" existe (table `permissions`, `hasPermission()`) mais ces 3 permissions précises ne sont pas confirmées dans le code — à vérifier si elles existent déjà sous d'autres noms ou si c'est un vrai gap de couverture. | 🟡 |
| 2.5 | **Tableau de bord équipe** — par technicien : CA TTC généré, nb factures, **marge HT**, réparations facturées, délai moyen coloré (vert ≤2j / orange 3-5j / rouge >5j), alertes tickets en retard/sans assigné | `P03` "Rapport activité technicien" existe — la marge HT par technicien et le code couleur délai ne sont pas confirmés dans le code, à vérifier. | 🟡 |
| 2.6 | **Import Excel** (.xlsx/.xls) en plus du CSV, pour clients ET stock, avec fichier modèle téléchargeable | `C06`/`E08` iziGSM : CSV uniquement, pas de fichier modèle téléchargeable identifié. | 🔴 |
| 2.7 | **Programme anniversaire client** — détection auto des anniversaires du jour, widget dashboard, email/SMS en un clic depuis la fiche client | Déjà noté en v2 comme gap (`todo.md`). Confirmé avec plus de détail : c'est aussi un widget dashboard, pas juste un envoi automatique en tâche de fond. | 🔴 |
| 2.8 | **8 statuts de réparation nommés différemment** avec 2 statuts d'échec distincts : `Abandonné` et `Réparation impossible` (en plus de restitué/prêt) | iziGSM n'a qu'`annule` comme statut négatif générique (`D02`, 9 statuts). Différence de granularité, pas forcément un manque — à évaluer si distinguer "abandonné par le client" de "réparation techniquement impossible" a de la valeur métier (reporting, stats). | 🟡 |
| 2.9 | **Notification client opt-in par statut**, pas automatique par défaut — case à cocher "Notifier le client" à chaque changement, message pré-rempli éditable avant envoi | Nuance vs la v2 : la doc officielle décrit un mécanisme **manuel/opt-in avec aperçu**, pas du tout automatique comme suggéré par le marketing ("SMS et email partent automatiquement"). iziGSM `L02`/`L08` envoie automatiquement sans étape de confirmation — à l'inverse, iziGSM est plus automatisé que ce que documente réellement monatelier. | ⚪ |
| 2.10 | **QualiRépar — CORRIGÉ le 2026-07-11** : l'API partenaire EcoSystem "Fonds Réparation" existe réellement (doc technique complète fournie par l'utilisateur, standard OpenAPI, kit développeur Postman/SwaggerHub) — authentification, `GET /catalog` (tarifs), création de demande en 3 étapes (`new-claim`→pièces jointes→`confirm-claim`), suivi `GET /reimbursement-claims`/`GET /payments`, extension PIEC (pièces d'économie circulaire, bonus +20%). Le marketing lu en v2 (Soumis→Validé→Remboursé) décrivait fidèlement cette API — ma réévaluation à la baisse (faite plus tôt le 2026-07-11 après lecture de `/aide/remises`, orientée usage produit fini) était une erreur : je comparais une page d'aide *utilisateur final* à une page marketing, sans chercher la doc technique développeur séparée. Preuve terrain fournie par l'utilisateur : remboursement QualiRépar réellement perçu (fichiers de suivi de paiement). | Gap `2.2` reste valide (absence totale côté iziGSM), et l'ampleur initiale (vraie intégration API tierce, pas juste un bouton de remise) est confirmée. Détail technique complet dans les 3 PDF `docs/` (guide API partenaire, RGPD/purge, PIEC). | 🔴 |

---

## 3. 💡 À s'inspirer — idées concrètes et peu coûteuses

Le message du jour demandait explicitement de noter ce qui vaut la peine d'être repris. Ce ne sont pas des gaps béants, mais des idées UX/produit à faible coût d'implémentation et fort impact perçu :

| # | Idée | Pourquoi c'est peu coûteux | Où l'appliquer côté iziGSM |
|---|---|---|---|
| 💡1 | **Fichier modèle téléchargeable** pour l'import CSV clients/stock, avec colonnes obligatoires/recommandées/optionnelles clairement indiquées | Un simple fichier statique + un bouton "télécharger le modèle" — pas de nouvelle logique métier | `C06`, `E08` — réduit la friction d'un import raté |
| 💡2 | **Badge "converti depuis un RDV"** sur les tickets créés depuis l'agenda, avec pré-remplissage complet du client | iziGSM a déjà `J10` (conversion RDV→ticket) — juste ajouter un badge visuel + s'assurer que la checklist état/codes sécurité du jour est bien accessible dès la conversion | `kanban.html`/`tickets.html` |
| 💡3 | **Case à cocher "Notifier le client" avec aperçu du message avant envoi**, au lieu d'un envoi 100% automatique et silencieux | iziGSM envoie déjà les emails automatiquement (`L02`/`L08`) — ajouter un mode "aperçu avant envoi" est une option UX, pas un nouveau système d'emailing | `updateStatutTicket()` côté UI |
| 💡4 | **Colonnes CA/marge/délai moyen coloré par technicien** dans un tableau (pas juste des graphiques) sur `stats.html` | iziGSM a déjà les données nécessaires (`P03`, `getKpisStock`, historique statuts avec `user_id`) — c'est une vue agrégée à ajouter, pas une nouvelle collecte de données | `stats.html`, `statsService.ts` |
| 💡5 | **Bouton "Marquer comme reçu" avec bandeau dédié** pour les envois à distance, une fois `N06` scopé | Anticiper ce pattern UX si/quand le dépôt à distance est développé — évite un aller-retour de conception plus tard | `N06` (à scoper) |
| 💡6 | **Bon d'achat créé directement depuis un dossier SAV** (pas seulement depuis un avoir de facture) | iziGSM a déjà `O05`/`O06` bons d'achat — élargir le point d'entrée depuis le futur module retours client (`H07`) une fois développé | `H07` (à scoper) |
| 💡7 | **PIN à 4 chiffres pour switch technicien rapide** | **iziGSM l'a déjà** (`A06`) — confirmé en avance sur ce point précis, à ne pas retravailler, juste noté pour mémoire que c'est un bon choix déjà fait | — (déjà fait) |

---

## 4. Rappel des gaps déjà identifiés en v2 (toujours valides)

Non repris en détail ici pour éviter la duplication — voir historique du fichier / `todo.md` pour le suivi :
- Signature électronique bon de dépôt — **traité aujourd'hui** (chantier prise en charge)
- Codes de sécurité, état des lieux structuré, multi-appareils par ticket — **traités aujourd'hui** (sauf multi-appareils, encore en décision)
- Signature eIDAS devis (`G08`)
- SMS transactionnels (`L10`)
- Retours client / RMA fournisseurs (`H07`/`H08`)
- Parrainage (`C10`)
- Export FEC (`F11`)
- TVA sur la marge (rachat/reconditionné) — conformité fiscale, pas juste fonctionnel
- Multi-sites géré (`B07`) — roadmap confirmée, hors comparatif direct

---

## 5. Parité confirmée ou avantage iziGSM (mise à jour v3)

| Domaine | Constat |
|---|---|
| **PIN technicien switch rapide** | iziGSM a déjà ça (`A06`) — parité confirmée après lecture de la page Équipe. |
| **Traçabilité technicien par changement de statut** | Parité — `tickets_statuts_historique` enregistre déjà `user_id` à chaque transition, comme monatelier. |
| **Livre de police rachat** | iziGSM (`Q04`, 30 colonnes) est plus détaillé que monatelier (date/vendeur/description/prix seulement). |
| **Agenda / RDV** | Toujours en avance — booking en ligne actif, iCal export, ce que monatelier ne mentionne pas. |
| **Notifications automatiques** | iziGSM envoie déjà automatiquement (sans étape de confirmation manuelle) — plus automatisé que ce que documente réellement monatelier (voir 2.9). |
| **Statuts ticket — granularité** | Toujours plus détaillé côté iziGSM (9 statuts incluant `attente_accord`) que les 8 de monatelier — mais monatelier distingue 2 issues d'échec (`Abandonné`/`Réparation impossible`) qu'iziGSM n'a pas. |

---

## 6. Limites méthodologiques

- **Sitemap complet obtenu via le menu latéral** (`document.querySelectorAll('button')` sur une page authentifiée-side rendue) plutôt que les liens précédent/suivant utilisés en v2, qui ne couvraient qu'un sous-ensemble linéaire. Les 19 pages listées au §1 sont — sauf erreur — la totalité du centre d'aide accessible publiquement à cette date.
- Reste non lu : pages marketing hors `/aide/*` autres que celles déjà croisées en v2 (tarifs, comparatifs concurrents).
- Le §2.10 illustre l'inverse d'une leçon attendue : une page d'aide *utilisateur final* ne contredit pas forcément le marketing sur l'ampleur technique réelle d'une fonctionnalité — elle décrit juste une couche différente (usage produit fini vs API technique sous-jacente). Downgrader un gap confirmé par le marketing sur la seule base d'une doc d'aide utilisateur muette sur le sujet est une erreur si une doc technique développeur séparée n'a pas été cherchée.
- Aucune tarification comparée — hors périmètre d'une analyse *fonctionnelle*.

---

## Sources

**Centre d'aide officiel — 19/19 pages lues intégralement via navigateur** :
`premiers-pas`, `tableau-de-bord`, `parametres`, `importer`, `prise-en-charge`, `prestations`, `devis-factures`, `avoirs`, `clients`, `statuts`, `agenda`, `prise-distance`, `sav`, `remises`, `catalogue`, `stock`, `rachat`, `equipe`, `conformite` (toutes sous `monatelier.net/aide/<slug>`)

**Observation terrain (fiable, secondaire)** : `docs/monatelier_observations.md`

**Contenu marketing (signal seulement, déjà utilisé en v2)** : `/logiciel-reparation-telephone`, `/module-caisse-nf525-reparateur`, `/bonus-reparation-qualirepar`, `/tarifs`, `/alternative-phonilab` / `-sasgestion` / `-laast`

**Documentation technique EcoSystem (fiable, fournie par l'utilisateur le 2026-07-11)** :
- `docs/Guide d'utilisation de l'API Partenaire réparateur - V3.0.0 - 2022-10-10.pdf` — spec complète API Fonds Réparation (OpenAPI)
- `docs/ecosystem - API Fonds Réparation - RGPD et Purge des demandes.pdf` — politique de conservation/anonymisation des données
- `docs/ecosystem - Pièces Issues de l_Economie Circulaire (PIEC).pdf` — extension bonus majoré pièces réemploi

**Référence iziGSM** : `docs/GAP_ANALYSIS_ENRICHI.md` v4.3, `docs/CDC_Manus.md`, `project-docs/todo.md`/`bugs.md`, vérifications directes dans `src/services/*.ts`, `src/routes/*.ts`, `public/*.html`
