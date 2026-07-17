# Impression ticket — 3 formats (A4, ticket client thermique, étiquette technicien) Design

## Contexte

`printTicket()`/`_buildTicketHTML()` (`public/static/js/tickets.js`) génèrent aujourd'hui une seule fiche A4 imprimable via `_triggerPrint()` (`window.print()` natif, `public/static/js/app.js`). Deux problèmes/besoins identifiés :

1. **Fuite de confidentialité** : la fiche A4 actuelle affiche `notes_internes` (bloc "Notes internes") — un champ privé, jamais destiné au client qui repart avec ce papier.
2. **Pas de format thermique** : `print.css` contient déjà des classes `.print-ticket*` (format 72mm, police monospace) mais elles ne sont câblées à aucune fonction JS — code mort préparé, jamais terminé.

Demande : ajouter deux nouveaux formats d'impression thermique (ticket client à emporter, étiquette à coller sur l'appareil pour le technicien), avec QR code + code-barre EAN-13, sans dépendance à un agent d'impression externe (QZ Tray écarté — voir Décisions).

## Décisions

| Sujet | Décision | Justification / alternative écartée |
|---|---|---|
| Pilotage imprimante | `window.print()` natif (existant), aucun agent local | QZ Tray envisagé initialement — écarté : l'utilisateur confirme utiliser une imprimante thermique 72mm avec driver universel, déjà reconnue comme imprimante système normale. Le navigateur peut donc l'adresser directement, comme n'importe quelle imprimante — évite l'installation d'un agent + certificat de signature sur chaque poste. |
| Sélection du format | 3 boutons explicites sur la fiche détail ticket ("Fiche A4" / "Ticket client" / "Étiquette technicien"), remplaçant le bouton unique actuel | Pas de préférence par boutique à gérer — chaque impression est un choix explicite. Le navigateur garde la main sur le choix de l'imprimante physique via sa boîte de dialogue native (impossible de la sauter en JS, contrainte navigateur). |
| Notes internes | Retirées des 3 formats imprimés | Fuite de confidentialité confirmée sur l'A4 existant. La panne déclarée (`description_panne`, déjà publique/visible du client) reste affichée — c'est le contenu "public" demandé, pas un nouveau champ à créer. |
| Génération QR/code-barre | 100% client, au moment de l'impression, via 2 libs CDN (`qrcode-generator` + `JsBarcode`) | Cohérent avec le pattern déjà établi dans ce projet (Tailwind/FontAwesome/Chart.js/axios déjà chargés en CDN). Alternative écartée : génération côté Worker (route dédiée + image) — ajoute un aller-retour réseau et une route backend pour un gain nul, casse le pattern 100% frontend de l'impression actuelle. Alternative écartée : lib unique type `bwip-js` — plus lourde (~200 Ko+), overkill pour 2 formats de code simples. |
| Contenu QR | URL complète cliquable/scannable — `/suivi/<token>` (client) ou `tickets.html?open=<token>` (technicien, voir plus bas) | Le format QR peut encoder un texte arbitraire, donc autant qu'il soit directement actionnable (lien cliquable) sans traitement côté lecteur. |
| Contenu code-barre | EAN-13 : ID numérique interne du ticket, zéro-paddé sur 12 chiffres + chiffre de contrôle auto-calculé par `JsBarcode` (format `EAN13`) | Demande explicite : lisible/générable en EAN-13. Ce format est strictement numérique (13 chiffres fixes) — ne peut PAS encoder une URL/token comme initialement prévu pour un CODE128. Le QR garde donc seul le rôle "lien cliquable" ; l'EAN-13 devient un identifiant court pour recherche rapide par douchette dédiée EAN-13 uniquement. |
| Lien technicien (étiquette) | URL interne distincte du lien client — `tickets.html?open=<token>`, ouvre directement la fiche détail en lecture/écriture dans l'app authentifiée | Le lien client (`/suivi/<token>`) est public et lecture seule — inadapté pour reprendre/mettre à jour un ticket. Distinction explicitement demandée par l'utilisateur. |
| Authentification post-scan | Aucune gestion de reconnexion à construire | Scan confirmé fait via douchette USB sur poste boutique déjà connecté à l'app — pas de scénario "téléphone technicien non authentifié" à couvrir dans ce chantier. |
| Recherche interne par scan | Étendre `listTickets()` (`search`) pour reconnaître, en plus du texte libre déjà supporté (numéro/marque/modèle) : un token/URL (32 hex ou contient `/suivi/`) OU un ID numérique pur (EAN-13 décodé) | Un seul champ de recherche existant gère les 3 cas (frappe manuelle, scan QR douchette, scan EAN-13 douchette) — pas de nouveau champ UI à ajouter. |

## Architecture

Extension du pattern existant (`printTicket()` → `_buildTicketHTML()` → `_triggerPrint()`), sans changement de `_triggerPrint()` ni de `_fetchTicketPrintData()` :

```
public/static/js/tickets.js
├── _fetchTicketPrintData(id)        [existant, inchangé]
├── _buildTicketA4HTML(d)            [renommé depuis _buildTicketHTML, notes internes retirées, QR+EAN13 ajoutés]
├── _buildTicketThermiqueHTML(d)     [nouveau — format 72mm, classes .print-ticket* de print.css]
├── _buildEtiquetteTechnicienHTML(d) [nouveau — format 72mm compact]
├── _renderQrCode(url) → <canvas>    [nouveau helper partagé, qrcode-generator]
├── _renderBarcodeEan13(ticketId) → <svg> [nouveau helper partagé, JsBarcode]
└── printTicket(id, format)          [modifié — 'a4' | 'thermique' | 'etiquette', dispatch vers le bon builder]
```

3 boutons sur la fiche détail ticket appellent `printTicket(id, 'a4' | 'thermique' | 'etiquette')`.

## Contenu par format

| Champ | Fiche A4 | Ticket client (thermique) | Étiquette technicien (thermique) |
|---|:---:|:---:|:---:|
| En-tête boutique | Complet (nom, adresse, tél, email) | Compact (nom seul) | Compact (nom seul) |
| N° ticket | ✓ | ✓ | ✓ |
| Client | Nom, tél, email | Nom seul | Nom, tél |
| Appareil | Marque, modèle, IMEI | Marque, modèle | Marque, modèle |
| Panne déclarée | ✓ | — | ✓ |
| État constaté au dépôt | ✓ | — | — |
| Notes internes | **Retiré** | **Retiré** | **Retiré** |
| Technicien assigné | ✓ | — | ✓ |
| Date prise en charge | ✓ | ✓ | ✓ |
| Priorité | ✓ | — | ✓ |
| Prix estimé | ✓ | ✓ | — |
| Signature client/technicien | ✓ | — | — |
| QR code | → lien suivi client | → lien suivi client | → **lien interne technicien** |
| Code-barre EAN-13 | → ID ticket | → ID ticket | → ID ticket |

## QR code et code-barre

**Libs** (chargées en CDN, `<script>` dans les pages `tickets.html`/`devis.html` qui déclenchent l'impression, même pattern que Tailwind/Chart.js) :
- `qrcode-generator` (jsdelivr) — rendu `<canvas>`, taille adaptée par format (plus grand sur A4, compact sur les 2 formats thermiques)
- `JsBarcode` (jsdelivr) — rendu SVG, format `EAN13`

**Génération EAN-13** : `String(ticketId).padStart(12, '0')` → passé à `JsBarcode(elem, code12chiffres, { format: 'EAN13' })`, qui calcule et affiche le 13e chiffre de contrôle automatiquement (comportement natif de la lib, pas de calcul manuel nécessaire).

**Fallback** : si une lib CDN ne charge pas (réseau coupé, CDN indisponible), le bloc QR/code-barre est simplement absent de l'impression — le lien texte `/suivi/<token>` reste affiché en clair (comportement actuel conservé sur l'A4), l'impression n'est jamais bloquée par un échec de génération de code.

## Recherche interne par scan

Extension de `listTickets()` (`src/services/ticketService.ts`), paramètre `search` existant. Les critères s'ajoutent en **OR** aux critères actuels (jamais en remplacement exclusif) — une recherche numérique courte (ex. "42") doit continuer à retrouver `TKT-2026-00142` via le LIKE existant, en plus d'un éventuel match exact par ID :

```
conditions = [numero LIKE %search%, marque LIKE %search%, modele LIKE %search%]  -- existant, toujours actif

Si search correspond à /^[0-9a-f]{32}$/ OU contient "/suivi/" :
    extraire le token (32 hex) → ajouter tracking_token = ? aux conditions (OR)

Si search fait exactement 13 chiffres (regex /^\d{13}$/, forme d'un scan EAN-13 complet) :
    retirer le 13e chiffre (contrôle, non signifiant pour la recherche), parseInt sur les 12 restants → ID
    ajouter id = ? aux conditions (OR)
Sinon si search est purement numérique et plus court (frappe manuelle d'un ID, pas un scan) :
    ajouter id = ? aux conditions (OR), sans retrait de chiffre
```

Aucun nouveau champ UI — le champ de recherche existant sur la liste des tickets reçoit indifféremment une frappe manuelle, un scan QR (douchette → texte "tapé" = URL complète) ou un scan EAN-13 (douchette → texte "tapé" = 13 chiffres), sans jamais réduire le comportement de recherche déjà en place.

## Lien interne technicien (deep-link)

Nouveau comportement sur `tickets.html` : au chargement, si l'URL contient `?open=<token>`, résolution du token → ticket (réutilise la logique de recherche par token ci-dessus) puis appel direct à `viewTicket(id)` pour ouvrir la fiche détail. Si le token ne correspond à aucun ticket, message "Ticket introuvable" au lieu d'un écran vide. Aucune gestion de reconnexion (poste déjà authentifié — voir Décisions).

## Gestion d'erreur

- Échec génération QR/code-barre (CDN indisponible) → impression continue sans le bloc code, fallback lien texte conservé, jamais bloquant.
- Token invalide sur `?open=<token>` → message explicite, pas de redirection silencieuse ni d'écran blanc.
- Recherche par scan sans résultat → comportement identique à une recherche texte classique (liste vide).
- `_fetchTicketPrintData()` échoue → inchangé (comportement déjà existant, `showFlash` + impression non déclenchée).

## Tests / validation

Pas de suite de tests automatisés sur `public/static/js/*` dans ce projet — validation en local live (`wrangler pages dev`), comme pour le reste des fonctionnalités frontend de ce projet :
- Impression des 3 formats (aperçu navigateur) sur un ticket réel avec token valide
- QR scanné réellement (téléphone) → atterrit sur la bonne page selon le format (`/suivi/<token>` vs `tickets.html?open=<token>`)
- EAN-13 généré vérifié visuellement + décodage (douchette si disponible, sinon décodeur en ligne) → bon ID ticket, chiffre de contrôle valide
- Recherche par scan testée avec les 3 formes (numéro texte, token/URL, ID numérique EAN-13)
- Deep-link `?open=<token>` testé avec un token valide et un token invalide
- Confirmation visuelle qu'aucune note interne n'apparaît sur aucun des 3 formats
- Fiche A4 existante revérifiée non régressée (contenu inchangé hors retrait notes internes + ajout QR/EAN-13)

## Ce qui ne change PAS

- `_triggerPrint()` (`app.js`) — mécanisme d'impression natif inchangé.
- `_fetchTicketPrintData()` — récupération des données ticket inchangée (ajout éventuel de l'`id` numérique brut si pas déjà présent, pas de changement de logique).
- Aucun nouveau champ en base de données — pas de colonne "commentaire public" créée, la panne déclarée existante suffit.
- Aucune installation d'agent d'impression (QZ Tray ou équivalent) — le navigateur adresse l'imprimante thermique comme une imprimante système standard.
- Aucune gestion de reconnexion post-scan (scénario téléphone technicien non authentifié) — hors périmètre, scan confirmé via douchette sur poste déjà connecté.
- Impression facture/devis (`factures.js`) — hors périmètre, ce chantier ne concerne que l'impression ticket.
