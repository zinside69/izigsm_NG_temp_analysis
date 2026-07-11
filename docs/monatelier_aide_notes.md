# Notes structurées — Centre d'aide monatelier.net

> **But** : matériau de référence interne pour la future documentation iziGSM (site d'aide en ligne + export PDF) et pour amorcer la base vectorielle qui alimentera l'agent IA de support à venir. Ce ne sont **pas** des textes à publier tels quels — reformulés à partir de `monatelier.net/aide/*` (lu via navigateur le 2026-07-11), ils servent de plan/inspiration structurelle. La doc iziGSM devra être écrite avec son propre wording, sa propre terminologie de statuts, et refléter le comportement réel du produit (pas celui de monatelier).
>
> Voir aussi `docs/ANALYSE_COMPARATIVE_MONATELIER.md` pour l'analyse des écarts fonctionnels associée à cette lecture.

---

## Structure du centre d'aide observée (à adapter, pas à copier)

Sitemap complet extrait du menu latéral (19 pages, pas seulement les liens précédent/suivant utilisés lors d'une première passe partielle) — ordre d'affichage dans le menu :

1. 🚀 Premiers pas — inscription, tour d'interface, répartition des fonctionnalités par plan
2. 📊 Tableau de bord — widgets CA/tickets/stock/anniversaires, sélecteur de période
3. ⚙️ Paramètres de l'atelier — logo/identité, TVA, conditions par type de document, templates communication, config email
4. 📥 Importer des données — clients et stock, CSV + Excel, fichier modèle téléchargeable
5. 📋 Faire une prise en charge — création de ticket, appareil(s), état/problème, sécurité, signature
6. 🔧 Prestations & pièces — lignes de ticket (prestation/produit/remise), statut pièce, réordonnancement
7. 🧾 Devis & Factures — génération depuis un ticket, conversion devis→facture, paiement, acompte, envoi, avoir
8. 💳 Avoirs & Bons d'achat — remboursement vs crédit client
9. 👤 Gestion des clients — fiche, historique, programme anniversaire
10. 🔄 Statuts de réparation — 8 statuts, notification opt-in, lien de suivi, vue Kanban
11. 📅 Agenda (Pro) — RDV, vue calendrier, réservation en ligne, conversion RDV→ticket
12. 📦 Prise en charge à distance (Pro) — réception colis, statut EN_TRANSIT, réexpédition avec suivi
13. 🛡️ SAV & Garanties (Pro) — dossier lié au ticket d'origine, SAV constructeur agréé, résolution 3 voies
14. 🏷️ Remises — par ligne, panel rapide, QualiRépar (montant pré-rempli, pas une API de tracking)
15. 📚 Catalogue de services — services par marque/modèle, liaison service↔pièce (déduction stock auto)
16. 📦 Stock & commandes (Pro) — produits, alertes seuil, page "à commander", fournisseurs, export, dashboard analytique
17. ♻️ Rachat d'occasion (Pro) — livre de police réglementaire
18. 👨‍💼 Gestion d'équipe (Pro) — rôles/permissions granulaires, PIN switch rapide, tableau de bord équipe
19. 🔒 Conformité & Archivage (Pro) — archivage légal, export comptable, RGPD

**Pour la doc iziGSM** : ce découpage en 19 pages plates (pas de sous-catégories visibles dans le menu, juste un ordre logique Onboarding → Prise en charge → Facturation → Clients/Équipe → Agenda → SAV → Stock → Conformité) est un bon patron — plus simple à maintenir qu'une arborescence à tiroirs. iziGSM devra ajouter ses propres pages sans équivalent chez monatelier : Vitrine publique, Personnel/Pointage (au-delà de la gestion d'équipe), Reconditionnement (au-delà du simple rachat), Multi-boutiques (roadmap).

---

## Workflow — Prise en charge (le plus directement réutilisable)

Étapes du formulaire de création observées : **Client → Appareil → État & Problème → Sécurité → Récapitulatif**.

- **Client** : sélection d'un client existant ou création à la volée
- **Appareil** : type, marque, modèle, couleur, IMEI/numéro de série ; possibilité d'ajouter plusieurs appareils au même ticket
- **État & Problème** : cases à cocher pour l'état constaté à l'entrée (rayures, dégâts des eaux, écran fissuré…) + description du problème signalé par le client + notes internes de diagnostic
- **Sécurité** : code PIN / schéma de déverrouillage, code SIM — stockage restreint à l'équipe
- **Récapitulatif** : signature du client à l'écran (doigt/souris), génération du bon de dépôt, impression ou envoi email/SMS

**Ce qui manque aujourd'hui côté iziGSM** (voir analyse comparative pour le détail) : signature, codes de sécurité, checklist d'état structurée, multi-appareils par ticket. Utile de garder cette séquence en tête si l'écran de prise en charge est retravaillé — que la décision soit de la reproduire ou de s'en écarter délibérément.

---

## Vocabulaire / terminologie à comparer (pas à copier)

| Concept | Terme monatelier | Équivalent iziGSM actuel |
|---|---|---|
| Ticket de réparation | "Prise en charge" | "Ticket" |
| Reçu → ... → Prêt | Reçu → Diagnostic → En cours → En attente pièces → Prêt → Remis (marketing) / Prise en charge → En diagnostic → À commander → En commande → Pièces reçues → En réparation → Prêt à restituer (observé, 7 colonnes) | recu → en_diagnostic → attente_accord → a_commander → commande → pieces_recues → en_reparation → termine → livre (9 statuts) |
| Document de dépôt | "Bon de dépôt" | Pas de document équivalent généré aujourd'hui |
| Paiement partiel à l'avance | "Acompte" (champ structuré) | Convention informelle en notes libres |

**Pour la doc iziGSM** : ne pas renommer les statuts iziGSM pour coller à monatelier — iziGSM a une terminologie et un workflow plus détaillé (`attente_accord` explicite, `termine`/`livre` séparés) qui doivent rester la référence pour la doc produit.

---

## Workflow — Gestion d'équipe (nouveau, pertinent pour le futur `populateTechniciens()`)

Observé le 2026-07-11 en couvrant le reste du centre d'aide. Directement utile si le gap "assignation technicien non fonctionnelle" (voir `bugs.md`) est repris :

- Création d'un technicien : prénom/nom, rôle, niveau d'accès, identifiants email/mot de passe **optionnels**, PIN à 4 chiffres **pour switch rapide sans déconnexion** — iziGSM a déjà l'équivalent PIN (`A06`), à réutiliser comme modèle plutôt qu'à réinventer
- Deux rôles : Propriétaire (accès complet) / Technicien (permissions individuelles : voir tickets de tous les techs, réassigner le travail, voir données financières)
- Chaque ticket a une carte "Technicien" toujours visible, avec un badge distinct "Réceptionné par" si la personne à l'accueil diffère de qui répare
- Tableau de bord équipe (réservé au propriétaire) : CA TTC, nb factures, marge HT, réparations facturées, délai moyen coloré (vert/orange/rouge), alertes tickets en retard/sans assigné

## Limites de ces notes

- Reformulées à partir de la lecture du 2026-07-11 (complète, 19/19 pages) — à re-vérifier si monatelier fait évoluer son centre d'aide.
- Couverture désormais complète du centre d'aide public de monatelier à cette date.
- Objectif = plan de travail pour la doc iziGSM, pas une source à citer ou publier.
