# Analyse Comparative CDC — iziGSM v2.28.0

> **Date de mise à jour** : 3 juillet 2026  
> **Version analysée** : v2.28.0 (Sprint 2.28 terminé)  
> **URL production** : `https://8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com`  
> **Référence CDC** : `docs/CDC_Manus.md` + `docs/CDC_izigsm.pdf`

---

## Légende
- ✅ Implémenté et opérationnel
- ⚠️ Partiel — fonctionnel mais incomplet
- ❌ Absent — non développé
- 🔜 Planifié — sprint identifié dans `TODO.md`

---

## MOD-01 — Tickets / Prises en charge ✅ COMPLET

**Priorité CDC : CRITIQUE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD tickets | ✅ | `ticketService.ts` — 9 fonctions |
| 10 statuts workflow complets | ✅ | recu→en_diagnostic→attente_accord→a_commander→commande→pieces_recues→en_reparation→termine→livre / annule |
| Assignation technicien | ✅ | `assigned_to` + filtre kanban |
| Priorité (basse/normale/haute/urgente) | ✅ | Migration 0017 |
| Indicateurs ancienneté (vert/orange/rouge/alerte) | ✅ | `couleurAnciennete()` dans ticketService |
| Vue Kanban (9 colonnes, drag & drop) | ✅ | `kanban.html` + `kanban.js` — JS natif |
| `GET /api/tickets/kanban` | ✅ | `getKanban()` — groupé par statut |
| Lien de suivi client (`/suivi/:token`) | ✅ | `public/suivi.html` + `GET /api/public/ticket/:token` |
| QR code tracking_token | ✅ | Affiché sur fiche ticket |
| Date commande pièces / date réception pièces | ✅ | Migration 0017 + `updateStatut()` |
| Notes internes technicien | ✅ | `notes_internes` sur tickets |
| Upload photos avant/après (R2) | ❌ | 🔜 Sprint 2.36 |
| Archivage automatique (>90j terminé) | ❌ | 🔜 Sprint 2.37 |
| Noms de statuts configurables par tenant | ⚠️ | Configurable via `boutique_settings` partiellement |

**Score v2.28.0 : 11✅ / 1⚠️ / 2❌ — Couverture ~85%**

---

## MOD-02 — Facturation ✅ COMPLET

**Priorité CDC : CRITIQUE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Création factures (brouillon) | ✅ | `factureService.ts` |
| Émission avec verrouillage (`locked=1`) | ✅ | NF525 conforme CGI art. 289 |
| Chaîne SHA-256 NF525 | ✅ | `enregistrerTransaction()` Sprint 2.1 |
| Numérotation séquentielle sans trou | ✅ | `nextNumero()` atomique D1 |
| Numérotation configurable (préfixes + format) | ✅ | `boutique_settings` Sprint 2.9 |
| Enregistrement paiements (multi-modes) | ✅ | Table `paiements` |
| Calcul statut (payee / partiellement / impayee) | ✅ | `ajouterPaiement()` |
| Avoirs (AV-AAAA-XXXXX) dans chaîne NF525 | ✅ | Sprint 2.1 |
| Export PDF factures/tickets | ✅ | `window.print()` + CSS @media print |
| Mention facture configurable | ✅ | `mention_facture` boutique_settings |
| Rapport comptable (TVA + modes paiement) | ❌ | 🔜 Sprint 2.33 |
| Export FEC (format comptable DGFiP) | ❌ | Post-MVP |
| Paiement Stripe en ligne | ❌ | Post-MVP |

**Score v2.28.0 : 10✅ / 0⚠️ / 3❌ — Couverture ~77%**

---

## MOD-03 — Devis ✅ COMPLET

**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD devis | ✅ | `devisService.ts` — 9 fonctions |
| Machine à états (draft→envoye→accepte/refuse/expire/annule) | ✅ | `updateStatutDevis()` transitions validées |
| Envoi email devis au client | ✅ | `sendDevisEmail()` via emailService |
| Page publique client (accepter/refuser en ligne) | ✅ | `devis-public.html` + `POST /api/public/devis/:token/repondre` |
| Signature client (horodatage) | ✅ | `signature_client` = timestamp acceptation |
| Conversion devis → facture NF525 | ✅ | `convertirDevis()` — copie lignes + hash |
| Expiration devis périmés (batch) | ✅ | `expireDevisPerimes()` |
| KPIs devis (taux acceptation, montants) | ✅ | `getStatsDevis()` |
| Relance automatique devis non répondus | ❌ | 🔜 Sprint 2.32 |
| Signature eIDAS certifiée | ❌ | Post-MVP (Yousign/Docusign) |

**Score v2.28.0 : 8✅ / 0⚠️ / 2❌ — Couverture ~80%**

---

## MOD-04 — Stock & Catalogue produits ✅ MAJORITAIREMENT COMPLET

**Priorité CDC : CRITIQUE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD produits (SKU, prix, stock) | ✅ | `stockService.ts` — 9 fonctions |
| Catégories produits | ✅ | `listCategories()` + `createCategorie()` |
| Mouvements de stock (entrée/sortie/ajustement) | ✅ | `enregistrerMouvement()` |
| CUMP (Coût Unitaire Moyen Pondéré) | ✅ | Calculé à réception BC — `(stock×cump + qty×prix) / total` |
| Alertes stock bas (stock_minimum) | ✅ | Vue "À commander" |
| KPIs stock (valeur, rupture, rotation) | ✅ | `getKpisStock()` |
| Liaison stock → tickets (sortie pièces) | ✅ | mouvement type "sortie" depuis ticket |
| Familles produits (pièce/accessoire/appareil/consommable) | ❌ | 🔜 Sprint 2.34 |
| Import catalogue fournisseur CSV | ❌ | 🔜 Sprint 2.34 |
| Scanner codes-barres | ❌ | Post-MVP |
| Inventaire (comptage physique) | ❌ | Post-MVP |

**Score v2.28.0 : 7✅ / 0⚠️ / 4❌ — Couverture ~64%**

---

## MOD-05 — Reconditionnement ✅ COMPLET

**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Ordres de reconditionnement (lié rachats) | ✅ | `reconditionnementService.ts` |
| Suivi coût de revient (pièces + MO) | ✅ | `cout_revient` colonne générée |
| Passage stock occasion (`terminerOrdre`) | ✅ | Crée produit occasion + mouvement |
| Calcul marge reconditionné | ✅ | `cout_revient` vs `prix_vente` |
| Bons d'achat (BA-XXXXXXXX) | ✅ | `createBonAchat()` + machine états |
| Consommation partielle/totale bon d'achat | ✅ | `consommerBonAchat()` |

**Score v2.28.0 : 6✅ / 0⚠️ / 0❌ — Couverture ~100%**

---

## MOD-06 — Rachats (Livre de police) ✅ COMPLET

**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| 30 colonnes réglementaires (art. 321-7) | ✅ | Migration 0011 |
| Numérotation registre LP-AAAA-XXXXX | ✅ | `nextNumero()` |
| Validation doublon IMEI | ✅ | `createRachat()` |
| Machine à états statut | ✅ | TRANSITIONS_STATUTS |
| Export CSV réglementaire | ✅ | `exportLivrePolice()` |
| Constantes métier (PIECES_VALIDES, ETATS_VALIDES) | ✅ | Exportées depuis rachatService |

**Score v2.28.0 : 6✅ / 0⚠️ / 0❌ — Couverture ~100%**

---

## MOD-07 — Clients (CRM) ✅ COMPLET

**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD clients | ✅ | `clientService.ts` — 9 fonctions |
| Recherche + filtres (nom/email/tel) | ✅ | LIKE×3 |
| Historique consolidé (tickets+factures+RDV+KPIs) | ✅ | `getHistoriqueClient()` Promise.all 4 sources |
| Gestion appareils par client (IMEI, S/N) | ✅ | `addAppareil()` — table `appareils` |
| Import CSV clients (9 colonnes, dédup email) | ✅ | `importClients()` Sprint 2.15 |
| Export CSV clients | ✅ | `apiBlobGet()` |
| KPIs CRM (nb clients, CA moyen) | ✅ | `getKpis()` |
| Export RGPD données client | ❌ | 🔜 Sprint 2.37 |
| Anonymisation RGPD (droit à l'oubli) | ❌ | 🔜 Sprint 2.37 |
| Parrainage (code unique + filleuls) | ❌ | Post-MVP |

**Score v2.28.0 : 7✅ / 0⚠️ / 3❌ — Couverture ~70%**

---

## MOD-08 — Agenda / Rendez-vous ✅ COMPLET

**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD rendez-vous | ✅ | `agendaService.ts` — CRUD + filtres |
| 6 statuts + machine à états | ✅ | PENDING/SCHEDULED/DONE/NO_SHOW/CANCELLED/CONVERTED |
| 5 types de RDV | ✅ | reparation/restitution/devis/diagnostic/autre |
| Vue calendrier semaine (grille horaire) | ✅ | `agenda.html` — grille horaire 7 jours |
| KPIs agenda (taux honoré) | ✅ | `getKpisAgenda()` — 5 requêtes |
| Export iCal RFC 5545 (webcal) | ✅ | `generateIcal()` CRLF, UID stable `rdv-{id}-{token}@izigsm` |
| Token iCal stable par boutique | ✅ | `boutique_ical_tokens` |
| Calcul fin auto (début + durée) | ✅ | `computeFin()` |
| Conversion RDV → Ticket | ✅ | Statut CONVERTED + `ticket_id` |
| Filtres par technicien / type / date / statut | ✅ | 7 filtres dans `listRendezVous()` |
| Prise de RDV en ligne (sans auth) | ❌ | 🔜 Sprint 2.31 |
| Créneaux disponibles par date | ❌ | 🔜 Sprint 2.31 |

**Score v2.28.0 : 10✅ / 0⚠️ / 2❌ — Couverture ~83%**

---

## MOD-09 — SAV & Garanties ✅ COMPLET

**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Création garantie (depuis ticket, idempotente) | ✅ | `createGarantieFromTicket()` |
| Durée garantie configurable (90j défaut) | ✅ | `garantie_defaut_jours` boutique_settings |
| Datefingarantie calculée côté JS (bug D1 binding) | ✅ | Workaround Sprint 2.10 |
| Expiration automatique batch | ✅ | `checkAndExpireGaranties()` |
| Création ticket SAV depuis garantie | ✅ | `createSav()` — 3 guards (introuvable/expirée/consommée) |
| Machine à états SAV (TRANSITIONS_SAV) | ✅ | 6 statuts |
| KPIs SAV (taux retour, nb garanties) | ✅ | `getKpisSav()` — 5 requêtes parallèles |
| Retours client (échange/avoir/refus) | ❌ | Post-MVP |
| RMA fournisseurs (suivi retour fabricant) | ❌ | Post-MVP |

**Score v2.28.0 : 7✅ / 0⚠️ / 2❌ — Couverture ~78%**

---

## MOD-10 — Achats & Approvisionnement ✅ COMPLET

**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD fournisseurs + soft delete | ✅ | `fournisseursService.ts` |
| Bons de commande (BC-AAAA-NNNNN) | ✅ | Numérotation MAX séquentiel D1 |
| Calcul HT/TTC + TVA par ligne | ✅ | `createBonCommande()` |
| Réception + CUMP automatique | ✅ | `receptionnerBonCommande()` |
| Mouvement stock à la réception | ✅ | type "reception_commande" |
| Vue "Produits à commander" | ✅ | `getProduitsACommander()` |
| KPIs fournisseurs | ✅ | `getKpisFournisseurs()` |
| Audit log sur toutes les actions | ✅ | `auditLog()` systématique |
| Import catalogue Mobilax / Utopya | ❌ | Post-MVP |

**Score v2.28.0 : 8✅ / 0⚠️ / 1❌ — Couverture ~89%**

---

## MOD-12 — Notifications & Communications ⚠️ PARTIEL

**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Email transactionnel (Resend API) | ✅ | `emailService.ts` + `RESEND_API_KEY` prod |
| Envoi email statut ticket (manuel) | ✅ | `sendTicketStatus()` fire & forget |
| Envoi email devis | ✅ | `sendDevisEmail()` |
| Envoi email facture | ✅ | `sendFactureEmail()` |
| Batch relances devis | ✅ | `POST /api/notifications/relances` |
| Journal email logs | ✅ | `email_logs` + logs paginés |
| Triggers automatiques statut→email | ❌ | 🔜 Sprint 2.32 |
| Toggle notifications auto par boutique | ❌ | 🔜 Sprint 2.32 |
| SMS Twilio | ❌ | Post-MVP |
| WhatsApp Business | ❌ | Post-MVP |

**Score v2.28.0 : 6✅ / 0⚠️ / 4❌ — Couverture ~60%**

---

## MOD-13 — Caisse POS ✅ COMPLET

**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Ouverture/fermeture session caisse | ✅ | `caisseService.ts` |
| Encaissement multi-modes paiement | ✅ | CB/espèces/chèque/virement |
| Journal NF525 caisse (SHA-256 chaîné) | ✅ | Même pattern que factures |
| Accès protégé PIN (`requirePin`) | ✅ | `acces_caisse` permission |
| KPIs caisse (CA jour, tickets ouverts) | ✅ | `getKpisCaisse()` |
| Impression thermique (QZ Tray) | ❌ | Post-MVP (bridge Java WS:8181) |

**Score v2.28.0 : 5✅ / 0⚠️ / 1❌ — Couverture ~83%**

---

## MOD-14 — Vitrine publique ⚠️ PARTIEL

**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Tracking réparation client (`/suivi/:token`) | ✅ | `public/suivi.html` + timeline statuts colorée |
| Page boutique (`/pro/:slug`) | ✅ | `GET /api/public/boutique/:slug` |
| Catalogue services public | ✅ | `GET /api/public/catalogue/:slug` |
| Stats boutique publiques | ✅ | `getStatsBoutiquePublic()` |
| Prise de RDV en ligne (formulaire public) | ❌ | 🔜 Sprint 2.31 |
| Créneaux disponibles par date | ❌ | 🔜 Sprint 2.31 |
| Dépôt à distance (devis avec photos) | ❌ | Post-MVP |

**Score v2.28.0 : 4✅ / 0⚠️ / 3❌ — Couverture ~57%**

---

## MOD-15 — Catalogue de services ✅ COMPLET

**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Catégories hiérarchiques (parent/enfant) | ✅ | `categories_services` table arbre |
| Services avec prix + durée + couleur | ✅ | `servicesService.ts` |
| Liaison service → ticket (pré-remplissage) | ✅ | `GET /api/services/catalogue` |
| Catalogue public par boutique | ✅ | `GET /api/public/catalogue/:slug` |
| Activation/désactivation service | ✅ | `actif=1/0` |
| Prix de revient (coût interne) | ❌ | Post-MVP |
| Liaison service → modèle appareil | ❌ | Post-MVP (arbre Domaine>Marque>Modèle) |

**Score v2.28.0 : 5✅ / 0⚠️ / 2❌ — Couverture ~71%**

---

## MOD-17 — Rapports & Exports ⚠️ PARTIEL

**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| 12 KPIs dashboard temps réel | ✅ | `statsService.ts` + `GET /api/stats` |
| Graphiques Chart.js (CA, tickets, produits) | ✅ | `stats.html` 4 onglets |
| Rapport activité technicien | ✅ | `GET /api/stats/techniciens` |
| Export PDF (window.print) | ✅ | Factures + tickets |
| Export CSV tickets par période | ❌ | 🔜 Sprint 2.33 |
| Export CSV CA par période | ❌ | 🔜 Sprint 2.33 |
| Rapport comptable (TVA + modes) | ❌ | 🔜 Sprint 2.33 |
| Export Excel (.xlsx) | ❌ | Post-MVP |

**Score v2.28.0 : 4✅ / 0⚠️ / 4❌ — Couverture ~50%**

---

## MOD-18 — Gestion d'équipe ✅ COMPLET

**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD employés | ✅ | `personnelService.ts` — 8 fonctions |
| Pointage (absent→en_poste↔pause→termine) | ✅ | `pointer()` + TRANSITIONS_POINTAGE |
| Calcul heures présence | ✅ | `pointagesAujourdhui()` JS pur |
| Rapport pointage par période | ✅ | `rapportPointage()` |
| Statuts temps réel équipe | ✅ | `statutsTempsReel()` |
| Permissions granulaires (8 actions) | ✅ | `userService.setPermissions()` |
| Réinitialisation mot de passe | ❌ | 🔜 Sprint 2.35 |
| OAuth2 Google | ❌ | 🔜 Sprint 2.35 |
| Calcul commissions/primes | ❌ | Post-MVP |

**Score v2.28.0 : 6✅ / 0⚠️ / 3❌ — Couverture ~67%**

---

## Tableau de synthèse — Scores v2.28.0

| Module | Priorité CDC | ✅ | ⚠️ | ❌ | Score |
|---|---|---|---|---|---|
| MOD-01 Tickets + Kanban | CRITIQUE | 11 | 1 | 2 | **~85%** |
| MOD-02 Facturation NF525 | CRITIQUE | 10 | 0 | 3 | **~77%** |
| MOD-03 Devis + page client | HAUTE | 8 | 0 | 2 | **~80%** |
| MOD-04 Stock + CUMP | CRITIQUE | 7 | 0 | 4 | **~64%** |
| MOD-05 Reconditionnement | MOYENNE | 6 | 0 | 0 | **~100%** |
| MOD-06 Rachats (police) | HAUTE | 6 | 0 | 0 | **~100%** |
| MOD-07 CRM Clients | HAUTE | 7 | 0 | 3 | **~70%** |
| MOD-08 Agenda + iCal | MOYENNE | 10 | 0 | 2 | **~83%** |
| MOD-09 SAV + Garanties | MOYENNE | 7 | 0 | 2 | **~78%** |
| MOD-10 Fournisseurs + BC | HAUTE | 8 | 0 | 1 | **~89%** |
| MOD-12 Notifications email | HAUTE | 6 | 0 | 4 | **~60%** |
| MOD-13 Caisse POS NF525 | MOYENNE | 5 | 0 | 1 | **~83%** |
| MOD-14 Vitrine publique | MOYENNE | 4 | 0 | 3 | **~57%** |
| MOD-15 Catalogue services | HAUTE | 5 | 0 | 2 | **~71%** |
| MOD-17 Rapports/Exports | HAUTE | 4 | 0 | 4 | **~50%** |
| MOD-18 Équipe/Pointage | MOYENNE | 6 | 0 | 3 | **~67%** |

---

## Évolution de la couverture

| Étape | Version | Couverture estimée |
|---|---|---|
| Prototype initial | v1.0 | ~5% |
| Sprint 2.4 (analyse originale) | v2.4.0 | ~11% |
| Sprints 2.5–2.13 | v2.13.0 | ~40% |
| Sprints 2.14–2.20 | v2.20.0 | ~60% |
| Sprints 2.21–2.26 | v2.26.0 | ~72% |
| Sprints 2.27–2.28 | **v2.28.0** | **~76%** |

---

## Prochaines priorités CDC (sprints 2.29→2.37)

| Sprint | Module CDC | Impact | Effort |
|---|---|---|---|
| 2.29–2.30 | Tests Vitest (non CDC) | Qualité | Moyen |
| 2.31 | MOD-14 RDV en ligne | Acquisition client | Faible |
| 2.32 | MOD-12 Triggers email auto | Rétention client | Moyen |
| 2.33 | MOD-17 Exports CSV/rapport comptable | Comptabilité | Moyen |
| 2.34 | MOD-04 Familles + import catalogue | Opérationnel | Moyen |
| 2.35 | MOD-18 Reset mdp + OAuth Google | Conversion | Moyen |
| 2.36 | MOD-01 Photos R2 | Qualité service | Élevé |
| 2.37 | RGPD + archivage | Conformité légale | Faible |

---

## Conformité légale — État

| Obligation | Statut | Détail |
|---|---|---|
| **NF525 anti-fraude TVA** | ✅ | SHA-256 chaîné factures + avoirs + caisse |
| **Livre de police art. 321-7** | ✅ | 30 colonnes + export CSV réglementaire |
| **RGPD mentions légales** | ✅ | `public/legal.html` |
| **RGPD droit d'accès** | ❌ | 🔜 Sprint 2.37 |
| **RGPD droit à l'oubli** | ❌ | 🔜 Sprint 2.37 |
| **eIDAS signature devis** | ❌ | Post-MVP (Yousign) |

---

*Analyse Comparative CDC v2.0 — iziGSM v2.28.0 — 3 juillet 2026*
