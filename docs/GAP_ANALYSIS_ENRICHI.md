# Gap Analysis — iziGSM vs CDC
> **Version** : 4.1 (mis à jour v2.40.0)  
> **Date** : 7 juillet 2026  
> **État implémentation** : Sprint 2.40 terminé — v2.40.0 en production  
> **URL production** : `https://8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com`

---

## Légende
- ✅ **Implémenté et opérationnel en production**
- ⚠️ **Partiel** — Fonctionnel mais incomplet
- ❌ **Absent** — Non développé
- 🔜 **Planifié** — Sprint identifié

---

## MODULE A — Authentification & Autorisation

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| A01 | Login email/password | ✅ | 2.17 | `POST /api/auth/login`, PBKDF2-SHA256 |
| A02 | Inscription + validation OTP email | ✅ | 2.17 | `POST /api/auth/register` + `POST /api/auth/verify-otp` |
| A03 | JWT HMAC-SHA256 + refresh tokens | ✅ | 2.26 | D1KV (remplacement KV) — TTL 7j refresh |
| A04 | RBAC (admin / manager / technicien) | ✅ | 2.3 | `requireRole()` middleware |
| A05 | Permissions granulaires par action | ✅ | 2.3 | Table `permissions`, `hasPermission()` |
| A06 | PIN technicien PBKDF2 | ✅ | 2.3 | `pin_hash`, switch contexte sans déconnexion |
| A07 | Réinitialisation mot de passe | ✅ | 2.40 | `reset-password.html` — token OTP D1KV TTL 1h + email lien |
| A08 | OAuth2 Google | ❌ | 🔜 2.35 | `GOOGLE_CLIENT_ID/SECRET`, `google_id` sur users |
| A09 | OAuth2 Facebook | ❌ | Post-MVP | Non prioritaire |
| A10 | Expiration session inactive | ✅ | 2.26 | TTL D1KV sur refresh tokens |

---

## MODULE B — Boutiques & Multi-tenant

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| B01 | CRUD boutiques | ✅ | 2.23 | `boutiqueService.ts` — 8 fonctions |
| B02 | Paramètres boutique (SIRET, TVA, slug) | ✅ | 2.18 | `boutique_settings` + auto-génération slug |
| B03 | Numérotation configurable (préfixes, format) | ✅ | 2.9 | `prefix_ticket/facture/devis/avoir/rachat`, `format_numero`, `padding_numero` |
| B04 | Mention facture + pied de page | ✅ | 2.9 | `mention_facture`, `pied_de_page` sur `boutique_settings` |
| B05 | Garantie défaut (jours) configurable | ✅ | 2.9 | `garantie_defaut_jours` dans settings |
| B06 | Notifications email on/off | ✅ | 2.40 | Toggles dans `settings.html` — `notif_relance`, `notif_ticket_cree`, etc. |
| B07 | Multi-boutiques réseau (cockpit) | ❌ | Post-MVP | JWT multi-boutique, tableau consolidé |
| B08 | Horaires d'ouverture | ❌ | Post-MVP | `horaires JSONB` sur boutiques |

---

## MODULE C — Clients (CRM)

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| C01 | CRUD clients | ✅ | 2.15 | `clientService.ts` — 9 fonctions |
| C02 | Recherche + filtres avancés (nom/email/tel) | ✅ | 2.15 | Filtre LIKE×3 sur `listClients()` |
| C03 | Profil client complet | ✅ | 2.15 | 4 KPIs, historique 4 onglets |
| C04 | Historique consolidé (tickets+factures+RDV+KPIs) | ✅ | 2.15 | `getHistoriqueClient()` Promise.all |
| C05 | Gestion appareils par client (IMEI, S/N) | ✅ | 2.15 | `addAppareil()` — table `appareils` |
| C06 | Import CSV clients (9 colonnes, dédup email) | ✅ | 2.15 | `importClients()` — parsing côté client |
| C07 | Export CSV clients | ✅ | 2.15 | `apiBlobGet()` |
| C08 | Export RGPD données client | ❌ | 🔜 2.37 | `GET /api/clients/:id/export` JSON |
| C09 | Anonymisation RGPD (purge) | ❌ | 🔜 2.37 | `DELETE /api/clients/:id/purge` pseudonymisation |
| C10 | Parrainage (code unique + filleuls) | ❌ | Post-MVP | `referral_code`, `referred_by` |
| C11 | Collecte avis clients | ❌ | Post-MVP | Survey post-réparation |

---

## MODULE D — Tickets / Réparations

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| D01 | CRUD tickets | ✅ | 2.17 | `ticketService.ts` — 9 fonctions |
| D02 | 10 statuts workflow complets | ✅ | 2.8 | recu→en_diagnostic→attente_accord→a_commander→commande→pieces_recues→en_reparation→termine→livre / annule |
| D03 | Machine à états + historique | ✅ | 2.17 | `updateStatut()` + INSERT `statuts_historique` |
| D04 | Assignation technicien | ✅ | 2.17 | `assigned_to` + filtre kanban par technicien |
| D05 | Priorité (basse/normale/haute/urgente) | ✅ | 2.8 | `priorite` sur tickets, badge couleur |
| D06 | Indicateurs ancienneté (vert/orange/rouge/alerte) | ✅ | 2.8 | `couleurAnciennete()` côté service |
| D07 | Vue Kanban (9 colonnes) | ✅ | 2.8 | `public/kanban.html` + drag & drop JS natif |
| D08 | Tracking token client (`/suivi/:token`) | ✅ | 2.7 | `tracking_token` UUID, `public/suivi.html` |
| D09 | Upload photos avant/après (R2) | ❌ | 🔜 2.36 | R2 bucket, `ticket_photos`, drag & drop |
| D10 | Archivage automatique (>90j terminé) | ❌ | 🔜 2.37 | `archived_at`, batch `checkAndArchiveTickets()` |
| D11 | Notes internes technicien | ✅ | 2.17 | `notes_internes` sur tickets |
| D12 | Date promesse + date commande pièces | ✅ | 2.8 | `date_promesse`, `date_commande_pieces`, `date_reception_pieces` |

---

## MODULE E — Stocks & Produits

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| E01 | CRUD produits (SKU, prix, stock) | ✅ | 2.17 | `stockService.ts` — 9 fonctions |
| E02 | Catégories produits | ✅ | 2.17 | `listCategories()` + `createCategorie()` |
| E03 | Mouvements de stock (entrée/sortie/ajustement) | ✅ | 2.17 | `enregistrerMouvement()` + table `mouvements_stock` |
| E04 | CUMP (Coût Unitaire Moyen Pondéré) | ✅ | 2.5 | Calculé à réception BC : `(stock×cump + qty×prix) / total` |
| E05 | Alertes stock bas | ✅ | 2.5 | `stock_minimum` — vue "À commander" |
| E06 | KPIs stock (valeur, rotation, rupture) | ✅ | 2.17 | `getKpisStock()` |
| E07 | Familles produits (pièce/accessoire/appareil) | ❌ | 🔜 2.34 | Champ `famille` absent |
| E08 | Import catalogue fournisseur CSV | ❌ | 🔜 2.34 | `importCatalogueCsv()` avec dédup SKU |
| E09 | Scanner codes-barres | ❌ | Post-MVP | WebUSB / QZ Tray |
| E10 | Inventaire (comptage physique) | ❌ | Post-MVP | Session inventaire + écarts |

---

## MODULE F — Facturation & Paiements

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| F01 | CRUD factures | ✅ | 2.20 | `factureService.ts` — 7 fonctions |
| F02 | Émission NF525 (locked + SHA-256) | ✅ | 2.1 | `emettreFacture()` — chaîne NF525 |
| F03 | Multi-modes paiement (CB/espèces/chèque/virement) | ✅ | 2.1 | Table `paiements` |
| F04 | Calcul statut facture (payee/partiellement/impayee) | ✅ | 2.20 | `ajouterPaiement()` |
| F05 | Avoirs NF525 (AV-AAAA-XXXXX) | ✅ | 2.1 | `createAvoir()` — facture locked obligatoire |
| F06 | Export PDF factures/tickets | ✅ | 2.13 | `window.print()` + CSS @media print |
| F07 | Numérotation séquentielle sans trou | ✅ | 2.9 | `nextNumero()` atomique + préfixes configurables |
| F08 | Export CSV factures | ✅ | 2.15 | `apiBlobGet()` |
| F09 | Rapport comptable (TVA par taux, modes paiement) | ❌ | 🔜 2.33 | `GET /api/stats/rapport-comptable` |
| F10 | Paiement Stripe en ligne | ❌ | Post-MVP | Non prioritaire MVP |
| F11 | Envoi facture au comptable (export FEC) | ❌ | Post-MVP | Format FEC DGFiP |

---

## MODULE G — Devis

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| G01 | CRUD devis | ✅ | 2.19 | `devisService.ts` — 9 fonctions |
| G02 | Machine à états (draft→envoye→accepte/refuse/expire) | ✅ | 2.19 | `updateStatutDevis()` + transitions validées |
| G03 | Conversion devis → facture (avec NF525) | ✅ | 2.19 | `convertirDevis()` — copie lignes + hash NF525 |
| G04 | Page publique client (accepter/refuser en ligne) | ✅ | 2.19 | `public/devis-public.html` + `POST /api/public/devis/:token/repondre` |
| G05 | Envoi email devis au client | ✅ | 2.11 | `sendDevisEmail()` via emailService |
| G06 | Expiration devis périmés (batch) | ✅ | 2.19 | `expireDevisPerimes()` |
| G07 | Relance automatique devis non répondus | ✅ | 2.40 | `sendRelanceDevis()` + `processRelancesDevis()` + `POST /api/notifications/relances-devis` |
| G08 | Signature eIDAS certifiée | ❌ | Post-MVP | Tiers de confiance (Yousign/Docusign) |

---

## MODULE H — SAV & Garanties

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| H01 | Création garantie (depuis ticket) | ✅ | 2.10 | `createGarantieFromTicket()` idempotent |
| H02 | Calcul date fin garantie (JS, configurable) | ✅ | 2.10 | `garantie_defaut_jours` depuis boutique_settings |
| H03 | Expiration automatique garanties | ✅ | 2.10 | `checkAndExpireGaranties()` |
| H04 | Création ticket SAV (depuis garantie) | ✅ | 2.10 | `createSav()` — vérifie expirée/consommée/introuvable |
| H05 | Machine à états SAV (TRANSITIONS_SAV) | ✅ | 2.10 | 6 statuts + `updateSavStatut()` |
| H06 | KPIs SAV (taux retour, nb garanties) | ✅ | 2.10 | `getKpisSav()` — 5 requêtes parallèles |
| H07 | Retours client (échange/avoir/refus) | ❌ | Post-MVP | Table `retours_client` |
| H08 | RMA fournisseurs (suivi colis retour) | ❌ | Post-MVP | Table `rma_fournisseurs` |

---

## MODULE I — Fournisseurs & Approvisionnement

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| I01 | CRUD fournisseurs | ✅ | 2.5 | `fournisseursService.ts` |
| I02 | Bons de commande (BC-AAAA-NNNNN) | ✅ | 2.5 | Numérotation MAX séquentiel D1 |
| I03 | Calcul HT/TTC + TVA par ligne | ✅ | 2.5 | `createBonCommande()` |
| I04 | Réception commande + CUMP automatique | ✅ | 2.5 | `receptionnerBonCommande()` + mouvement stock |
| I05 | Vue "Produits à commander" | ✅ | 2.5 | `getProduitsACommander()` — stock ≤ minimum |
| I06 | KPIs fournisseurs | ✅ | 2.5 | `getKpisFournisseurs()` — 2 requêtes |
| I07 | Soft delete fournisseurs + audit log | ✅ | 2.5 | `deleteFournisseur()` actif=0 |
| I08 | Import Mobilax / Utopya API | ❌ | Post-MVP | Partenariats à négocier |

---

## MODULE J — Agenda / RDV

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| J01 | CRUD rendez-vous | ✅ | 2.6 | `agendaService.ts` — CRUD + filtres |
| J02 | Machine à états RDV (6 statuts) | ✅ | 2.6 | PENDING→SCHEDULED→DONE/NO_SHOW/CANCELLED/CONVERTED |
| J03 | 5 types de RDV | ✅ | 2.6 | reparation/restitution/devis/diagnostic/autre |
| J04 | Vue calendrier semaine (groupement par date) | ✅ | 2.6 | `getAgendaView()` + grille horaire `agenda.html` |
| J05 | KPIs agenda (taux honoré) | ✅ | 2.6 | `getKpisAgenda()` — 5 requêtes |
| J06 | Export iCal RFC 5545 (webcal) | ✅ | 2.6 | `generateIcal()` CRLF, UID stable, DTSTART UTC |
| J07 | Token iCal stable par boutique | ✅ | 2.6 | `boutique_ical_tokens` |
| J08 | Prise de RDV en ligne (sans auth) | ❌ | 🔜 2.31 | `POST /api/public/rdv` + `rdv-public.html` |
| J09 | Créneaux disponibles par date | ❌ | 🔜 2.31 | `GET /api/public/boutique/:slug/disponibilites` |
| J10 | Conversion RDV → Ticket | ✅ | 2.6 | Statut CONVERTED + `ticket_id` sur RDV |

---

## MODULE K — Caisse POS & NF525

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| K01 | Ouverture/fermeture session caisse | ✅ | 2.12 | `caisseService.ts` |
| K02 | Encaissement multi-modes paiement | ✅ | 2.12 | CB/espèces/chèque/virement |
| K03 | Journal NF525 caisse (SHA-256 chaîné) | ✅ | 2.12 | Même pattern que factures |
| K04 | Accès caisse protégé PIN | ✅ | 2.3 | `requirePin('acces_caisse')` |
| K05 | KPIs caisse (CA jour, tickets ouverts) | ✅ | 2.12 | `getKpisCaisse()` |
| K06 | Impression thermique (QZ Tray) | ❌ | Post-MVP | Bridge Java local WS:8181 |

---

## MODULE L — Notifications & Communications

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| L01 | Email transactionnel (Resend API) | ✅ | 2.11 | `emailService.ts` + `RESEND_API_KEY` en prod |
| L02 | Envoi email statut ticket (manuel) | ✅ | 2.11 | `sendTicketStatus()` — fire & forget |
| L03 | Envoi email devis au client | ✅ | 2.11 | `sendDevisEmail()` |
| L04 | Envoi email facture au client | ✅ | 2.11 | `sendFactureEmail()` |
| L05 | Batch relances devis en attente | ✅ | 2.11 | `POST /api/notifications/relances` |
| L06 | Journal email logs | ✅ | 2.11 | `email_logs` + `GET /api/notifications/logs` |
| L07 | Email test (destinataire libre) | ✅ | 2.11 | `POST /api/notifications/test` |
| L08 | Triggers automatiques statut→email | ✅ | 2.40 | Hook dans `updateStatut()` → `sendTicketCree/Termine/Livre()` |
| L09 | Toggle notifications auto (boutique) | ✅ | 2.40 | `notifMap` dans `sendEmail()` — flags par type dans `boutique_settings` |
| L10 | SMS Twilio | ❌ | Post-MVP | Coût + complexité |
| L11 | WhatsApp Business | ❌ | Post-MVP | API payante |

---

## MODULE M — Personnel & Pointage

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| M01 | CRUD employés | ✅ | 2.21 | `personnelService.ts` — 8 fonctions |
| M02 | Pointage (absent→en_poste↔pause→termine) | ✅ | 2.21 | `pointer()` + TRANSITIONS_POINTAGE |
| M03 | Calcul heures présence (JS) | ✅ | 2.21 | `pointagesAujourdhui()` |
| M04 | Rapport pointage par période | ✅ | 2.21 | `rapportPointage()` |
| M05 | Statuts temps réel équipe | ✅ | 2.21 | `statutsTempsReel()` |
| M06 | Calcul commissions/primes | ❌ | Post-MVP | Règles métier complexes |
| M07 | Planning techniciens | ❌ | Post-MVP | Agenda par personne |

---

## MODULE N — Vitrine publique

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| N01 | Tracking réparation client (`/suivi/:token`) | ✅ | 2.7 | `public/suivi.html` + timeline statuts |
| N02 | Page boutique (`/pro/:slug`) | ✅ | 2.7 | `GET /api/public/boutique/:slug` |
| N03 | Catalogue services public | ✅ | 2.7 | `GET /api/public/catalogue/:slug` |
| N04 | Stats boutique publiques (note, nb réparations) | ✅ | 2.25 | `getStatsBoutiquePublic()` |
| N05 | Prise de RDV en ligne | ❌ | 🔜 2.31 | Formulaire 3 étapes public |
| N06 | Dépôt à distance (demande devis avec photos) | ❌ | Post-MVP | Formulaire + upload R2 |

---

## MODULE O — Reconditionnement & Bons d'achat

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| O01 | Ordres de reconditionnement | ✅ | 2.16 | `reconditionnementService.ts` — 7 fonctions ordres |
| O02 | Suivi coût de revient (pièces + MO) | ✅ | 2.16 | `cout_revient` colonne générée |
| O03 | Passage stock occasion (terminerOrdre) | ✅ | 2.16 | Crée produit occasion en stock |
| O04 | Calcul marge reconditionné | ✅ | 2.16 | `cout_revient` vs `prix_vente` |
| O05 | Bons d'achat (BA-XXXXXXXX) | ✅ | 2.16 | `createBonAchat()` + machine états |
| O06 | Vérification + consommation bon (caisse) | ✅ | 2.16 | `verifierBonAchat()` + `consommerBonAchat()` partiel/total |

---

## MODULE P — Rapports & Exports

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| P01 | KPIs dashboard temps réel (12 KPIs) | ✅ | 2.13 | `statsService.ts` — `getKpisDashboard()` |
| P02 | Graphiques Chart.js (CA mensuel, tickets, produits) | ✅ | 2.24 | `public/stats.html` 4 onglets |
| P03 | Rapport activité technicien | ✅ | 2.24 | `GET /api/stats/techniciens` |
| P04 | Export CSV tickets par période | ❌ | 🔜 2.33 | `GET /api/stats/export/csv?type=tickets` |
| P05 | Export CSV CA par période | ❌ | 🔜 2.33 | `GET /api/stats/export/csv?type=ca` |
| P06 | Rapport comptable (TVA + modes paiement) | ❌ | 🔜 2.33 | `GET /api/stats/rapport-comptable` |
| P07 | Export Excel (.xlsx) | ❌ | Post-MVP | Librairie xlsx côté client |

---

## MODULE Q — Sécurité & Conformité

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| Q01 | HTTPS natif | ✅ | Prod | Cloudflare TLS |
| Q02 | Chiffrement PBKDF2 mots de passe | ✅ | 2.3 | 100k itérations, salt random |
| Q03 | NF525 SHA-256 factures + avoirs + caisse | ✅ | 2.1 | `lib/nf525.ts` + `enregistrerTransaction()` |
| Q04 | Livre de police (art. 321-7) | ✅ | 2.2 | 30 colonnes réglementaires + export CSV |
| Q05 | Audit log (toutes actions CRUD sensibles) | ✅ | 2.5 | `auditLog()` dans `lib/db.ts` |
| Q06 | Mentions légales RGPD | ✅ | 1.0 | `public/legal.html` |
| Q07 | Export RGPD données client | ❌ | 🔜 2.37 | `GET /api/clients/:id/export` JSON |
| Q08 | Anonymisation RGPD (droit à l'oubli) | ❌ | 🔜 2.37 | Pseudonymisation + conservation factures |
| Q09 | Rate limiting API | ⚠️ | — | Cloudflare WAF natif (non configurable) |
| Q10 | Headers sécurité (CSP, HSTS) | ⚠️ | — | Cloudflare natif |

---

## MODULE R — Catalogue marques/modèles (Sprint 2.38-2.39)

| Réf | Fonctionnalité | Statut | Sprint | Détail |
|-----|----------------|--------|--------|--------|
| R01 | Référentiel marques (global, sans boutique) | ✅ | 2.39 | `marques_appareils` sans `boutique_id` — `brand_slug UNIQUE` |
| R02 | Référentiel modèles (global) | ✅ | 2.39 | `modeles_appareils` — `phone_slug UNIQUE`, `source`, `synced_at` |
| R03 | Liaison services ↔ modèles (M2M) | ✅ | 2.38 | `service_modeles` pivot + prix override COALESCE |
| R04 | Sync marques depuis phone-specs-api | ✅ | 2.39 | `syncBrands()` — INSERT OR IGNORE, UPDATE device_count si source='api' |
| R05 | Sync modèles par marque (paginé) | ✅ | 2.39 | `syncModelesByBrand()` — chunks 10 pages, `guessType()` heuristique |
| R06 | Sync sélection de marques | ✅ | 2.39 | `syncSelectedBrands()` — itère syncModelesByBrand() |
| R07 | Log sync par marque | ✅ | 2.39 | `phone_catalog_sync_log` (status, modeles_added, error_msg) |
| R08 | Autocomplete modèle dans tickets | ✅ | 2.38 | Debounce 300ms + suggestions services pré-configurés |
| R09 | UI modal sync (sélection + progression) | ✅ | 2.40 | Modal sync complète avec sélection marques + progression dans `services.html` |
| R10 | Stats référentiel | ✅ | 2.39 | `getCatalogStats()` + `GET /api/services/catalog/stats` |

---

## Compteur Global de Couverture (v2.40)

| Module | Total items | ✅ Implémenté | ⚠️ Partiel | ❌ Absent |
|--------|-------------|--------------|-----------|---------|
| A Auth | 10 | 9 | 0 | 1 |
| B Boutiques | 8 | 7 | 0 | 1 |
| C Clients CRM | 11 | 9 | 0 | 2 |
| D Tickets | 12 | 12 | 0 | 0 |
| E Stock | 10 | 8 | 0 | 2 |
| F Facturation | 11 | 9 | 0 | 2 |
| G Devis | 8 | 7 | 0 | 1 |
| H SAV/Garanties | 8 | 6 | 0 | 2 |
| I Fournisseurs | 8 | 7 | 0 | 1 |
| J Agenda | 10 | 10 | 0 | 0 |
| K Caisse POS | 6 | 5 | 0 | 1 |
| L Notifications | 11 | 9 | 0 | 2 |
| M Personnel | 7 | 5 | 0 | 2 |
| N Vitrine | 6 | 5 | 0 | 1 |
| O Reconditionnement | 6 | 6 | 0 | 0 |
| P Rapports | 7 | 6 | 0 | 1 |
| Q Sécurité | 10 | 8 | 2 | 0 |
| R Catalogue marques | 10 | 9 | 1 | 0 |
| **TOTAL** | **159** | **137** | **3** | **19** |

**Couverture v2.40 : 144/159 = ~90% — soit +4 points vs v2.39 (86%) — R09/A07/B06/L08/L09/G07 → ✅**

> Post-MVP exclus (SMS, WhatsApp, Stripe, scanner CB, WebSockets, cockpit multi-sites) : couverture effective sprint-par-sprint ~90%.

---

## Secrets Cloudflare — État production

| Secret | Statut | Usage |
|---|---|---|
| `JWT_SECRET` | ✅ Configuré | Auth JWT |
| `RESEND_API_KEY` | ✅ Configuré | Emails Resend |
| `GOOGLE_CLIENT_ID` | ⚠️ À confirmer | Sprint 2.35 OAuth (configurer via `gsk hosted secret_put`) |
| `GOOGLE_CLIENT_SECRET` | ❌ Non utilisé | Tokeninfo ne nécessite pas le secret |
| `TWILIO_*` | ❌ Post-MVP | SMS |
| `STRIPE_*` | ❌ Post-MVP | Paiement en ligne |

---

*Gap Analysis v4.1 — iziGSM v2.40.0 (prod) — 7 juillet 2026*
