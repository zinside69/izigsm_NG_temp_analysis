# Observations initiales — Mon Atelier

URL demandée : https://monatelier.net/dashboard

La page du tableau de bord redirige vers `https://monatelier.net/login` lorsqu’aucune session authentifiée n’est active. L’écran visible est une page de connexion intitulée **Connexion | Mon Atelier**.

Éléments fonctionnels visibles :

| Élément | Observation |
|---|---|
| Accès sécurisé | Le site présente l’accès comme un espace atelier sécurisé. |
| Connexion | Connexion par email et mot de passe. |
| Connexion Google | Un bouton “Sign in with Google” est présent. |
| Mot de passe oublié | Un lien/bouton de récupération est disponible. |
| Création de compte | Liens “Créer un compte” et “Créer mon compte d’essai”. |
| Essai gratuit | Le site mentionne un essai gratuit de 14 jours sans carte bancaire. |
| Cookies | Bannière de consentement avec choix “Tout accepter” ou “Continuer sans accepter”. |
| PWA | Bannière d’installation “Installer Mon Atelier”, suggérant une application web installable. |
| Promesse produit | Le site mentionne factures, devis, stock et suivi client accessibles depuis navigateur PC ou tablette. |
| Hébergement | Le site affirme des données hébergées en Europe. |

Point bloquant : les identifiants de connexion ne sont pas disponibles dans le message utilisateur. Une demande d’identifiants est nécessaire pour poursuivre l’analyse du tableau de bord authentifié.

## Section authentifiée — Communication

Après connexion, la session affiche une application de gestion d’atelier avec navigation latérale persistante. L’entreprise connectée est affichée comme **SOTELI**, avec un point de vente ou profil **magasin TELNET**, rôle **Propriétaire**. Le compte est en **période d’essai** avec 14 jours restants.

La navigation principale comprend : Tableau de bord, Prises en charge, Factures, Devis, Rachats, Agenda, Clients, SAV & Garanties, Avoirs & Bons d'achat, Communications, À commander, Caisse, Parrainage, Stock, Achats, Rapports, Paramètres et Mon Profil. Les paramètres exposent des sous-sections : Atelier, Communication, Site vitrine & RDV, Facturation, Caisse & impression, Équipe, Mon réseau / PDVs.

La section **Communication** est structurée autour des canaux d’envoi et des règles d’envoi : email atelier configuré, SMS atelier à configurer, automatisations avec 1 active, et templates avec éditeur complet. Les automatisations couvrent les anniversaires clients, notifications par statut atelier, lien de suivi, alertes trésorerie fournisseurs et envoi des factures au comptable. Les notifications gèrent notamment réception de l’appareil, attente de pièces, appareil prêt, restitution, délai d’envoi et canal email/SMS.

## Tableau de bord

Le tableau de bord sert de parcours d’onboarding pour un nouvel atelier. Il accueille l’utilisateur, propose la création de la première prise en charge et impose deux configurations fondatrices avant l’utilisation documentaire : **format de numérotation** et **types d’appareils réparés**.

La numérotation est paramétrable par type de document avec aperçu temps réel pour factures, acomptes, devis et avoirs. Les paramètres visibles incluent le séparateur, le format de date, le nombre de chiffres du compteur, les préfixes par type de document et les numéros de départ, ce qui répond aux besoins de migration depuis un autre logiciel.

Les types d’appareils sont organisés par catégories : multimédia, loisirs et mobilité, audio et vidéo, électroménager, bureautique et autre. Les types sélectionnés dans l’atelier observé sont téléphone, tablette, ordinateur portable, montre connectée, console, trottinette électrique et autre. Le tableau de bord propose ensuite les réglages essentiels : coordonnées de facturation, identité de l’atelier, catalogue de services, import de clients et notifications automatiques.

## Prises en charge

La section **Prises en charge** constitue le cœur opérationnel de l’atelier. Elle propose deux vues principales, **Liste** et **Kanban**, ainsi qu’un accès aux **Archives** et à la personnalisation des **noms de statuts**. La création peut se faire via deux modes : **+ Rapide** et **+ Complet**, en plus du bouton global “Nouvelle prise en charge”.

La vue observée est un Kanban de workflow avec colonnes : Prise en charge, En diagnostic, À commander, En commande, Pièces reçues, En réparation et Prêt à restituer. Les colonnes relatives aux pièces affichent un raccourci vers la gestion des commandes de pièces. Un filtrage par technicien est disponible, avec option “Les miens” et liste des techniciens. L’interface mentionne le glisser-déposer pour changer le statut, ce qui implique une gestion dynamique du cycle de vie des réparations. Les indicateurs d’ancienneté utilisent des seuils `< 2j`, `3–7j`, `> 7j` et une alerte.

## Factures

La section **Factures** gère les factures liées aux réparations, ventes et rachats. Elle alerte si la numérotation documentaire n’est pas configurée. Les indicateurs visibles sont : chiffre d’affaires du mois TTC, encaissements du mois, factures à encaisser, factures en retard et factures payées ce mois. La liste peut être filtrée par statut de paiement : tous, non payé, paiement partiel, payé et annulée, ainsi que par technicien. Un export CSV est disponible. L’interface recommande de créer une facture de réparation depuis une prise en charge afin de conserver l’appareil, l’historique, les acomptes et le suivi client.

## Devis

La section **Devis** couvre les devis de réparation et de vente. Elle reprend l’alerte de configuration de numérotation et affiche des indicateurs : en attente, à relancer, acceptés et expirés. Les filtres visibles incluent les statuts tous, brouillon, envoyé, accepté, refusé et expiré, ainsi qu’un filtre par technicien. L’interface recommande de créer un devis de réparation depuis une prise en charge pour préserver le diagnostic, l’appareil, les échanges et le suivi complet. Le bandeau d’actualités indique que les clients peuvent accepter ou refuser les devis en ligne avec signature électronique conforme eIDAS.

## Rachats

La section **Rachats** est présentée comme un **livre de police** pour la gestion des rachats d’appareils d’occasion. Elle permet de créer un nouveau rachat, de rechercher par IMEI, nom, marque, modèle ou numéro de rachat, et de filtrer par statut : tous, en stock ou vendu. Les indicateurs affichés sont le total des rachats, le nombre en stock, le nombre vendu et la valeur en stock. Cette section est directement liée à la traçabilité réglementaire, au stock d’occasion et à la marge de reconditionnement.

## Agenda

La section **Agenda** gère les rendez-vous de dépôt, diagnostic et récupération. Elle affiche des compteurs : aujourd’hui, à venir, effectués et total de la période. Une création de rendez-vous est disponible. La prise de rendez-vous en ligne n’est pas encore configurée dans le compte observé, avec un appel à configurer la page de réservation pour permettre aux clients de prendre rendez-vous directement.

Les vues disponibles sont jour, semaine et mois, avec modes cartes ou tableau. Les filtres portent sur le statut — tous, en attente, prévu, effectué, converti, annulé, non venu — ainsi que sur les réparations planifiées, les rendez-vous de l’utilisateur courant et le technicien. Le calendrier observé est positionné sur la semaine du 01/06 au 07/06/2026.

## Clients

La section **Clients** joue le rôle de base CRM. Elle propose l’import de clients, la création d’un nouveau client, une séparation entre clients actifs et archivés, ainsi qu’un champ de recherche par nom, société, téléphone ou email. Cette base alimente les flux de prises en charge, devis, factures, rendez-vous, SAV et communications.

## SAV & Garanties

La section **SAV & Garanties** suit les garanties actives, retours clients et retours fournisseurs. Les indicateurs visibles sont : garanties actives, garanties expirant sous 30 jours, urgentes sous 7 jours, tickets SAV, retours client et RMA fournisseur. L’interface propose quatre onglets : **Garanties actives**, **Tickets SAV**, **Retours client** et **RMA fournisseurs**.

Le fonctionnement affiché précise que les garanties actives proviennent des factures avec garantie encore en cours. Une ligne de garantie peut ouvrir un dossier SAV, sous forme de réparation ou de retour produit. Les tickets SAV suivent le même workflow que les prises en charge normales. Les retours client permettent de traiter échange, avoir ou refus, tandis que les RMA fournisseurs suivent le retour d’une pièce défectueuse vers un fournisseur, avec suivi du colis, statut et remboursement ou remplacement.

## Avoirs & Bons d’achat

La section **Avoirs & Bons d’achat** centralise les remboursements et bons d’achat. Elle dépend de la configuration de numérotation documentaire, comme les factures et devis. Les indicateurs sont : total, remboursements, bons d’achat, bons actifs, montant remboursé et bons restants. Les filtres permettent de chercher par numéro, client, facture ou motif, de filtrer par type — remboursements ou bons d’achat — et par statut — actif, complété ou expiré. Cette section sert à assurer une traçabilité commerciale et comptable des compensations client.

## À commander

La section **À commander** pilote les besoins d’approvisionnement au quotidien. Elle permet de repérer les pièces manquantes, de voir ce qui doit encore être acheté, de suivre ce qui a déjà été commandé et de marquer rapidement une pièce comme reçue. L’interface distingue cette vue opérationnelle rapide des commandes fournisseurs complètes, qui gèrent la commande, la réception, la facture fournisseur et le règlement.

Le workflow affiché suit quatre états : **besoin détecté**, **commande créée**, **en attente livraison** et **réceptionnée**, avec mise à jour du stock et du CUMP lors de la réception. La page propose des colonnes À commander, Commandé et Reçu, un champ de recherche transversal, des exports CSV et un accès au stock ou aux commandes fournisseurs.

## Stock — Tableau de bord analytique

Le **Dashboard Stock** fournit une vue 