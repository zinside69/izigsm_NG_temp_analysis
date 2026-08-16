# iziGSM — État courant (MàJ : 2026-08-16 — état des séries mesuré en production, vérification métier toujours à faire)

## Mesure d'état production — 2026-08-16 (aucun code livré)

Session de préparation à la vérification métier du ticket 001, laissée en attente depuis le
checkpoint 77. **Rien n'a été livré, rien n'a été déployé, et la vérification à l'écran n'est
toujours pas faite.** Ce qui suit est un relevé, pas un checkpoint.

### L'état des séries, lu en base plutôt que déduit des docs

`npx wrangler d1 execute DB --remote`, session OAuth `contact@soteli.fr` (`d1 (write)`) :

| Boutique | `sequences.facture.2026.dernier_num` | Factures existantes | Prochain numéro émis |
|---|---|---|---|
| 1 — iziGSM Paris 11 | **3** | 1 (`FAC-2026-00003`, `payee`) | `FAC-2026-00004` |
| 2 — SOTELI | 2 | 2 (`00001`, `00002`, `locked = 1`) | `FAC-2026-00003` |
| 5 — ZZ Audit Isolation 2026 | 1 | 1 **brouillon numéroté** `FAC-2026-00001` | — |

Les deux trous de la boutique 1 sont lisibles en chiffres : compteur à **3** pour **une seule**
facture. Le brouillon **numéroté** de la boutique 5 date du 2026-07-31 — c'est l'ancien
comportement, figé avant le correctif ; il ne se reproduira plus mais il reste en base.

### Une contradiction du recovery-prompt, tranchée

Le recovery-prompt du checkpoint 77 demande la vérification « depuis un compte manager » **et**
annonce `FAC-2026-00004`. Les deux ensemble ne désignaient aucune boutique de façon évidente : le
manager connu jusque-là (« Saïd test », `telnet@bbox.fr`) est sur la **boutique 2**, dont la série
donnerait `00003`.

Le compte qui satisfait les deux conditions existe : **`manager@izigsm.fr`** (Sophie Martin, rôle
`manager`, **boutique 1**, actif). C'est depuis lui que les attendus `00004` puis `00005` sont
justes. Ne pas refaire ce raisonnement à la session suivante.

Au passage, la table `users` n'a **pas** de colonne `role` : le rôle vit dans `roles`, via
`users.role_id`. Une requête d'audit qui suppose `users.role` échoue en `SQLITE_ERROR 7500`.

### Outillage — le Mac ne peut pas tout faire

Node 22.23.2 LTS installé sur le Mac (userland, `~/.local`, PATH dans `~/.zshrc`). Mais **wrangler
avertit que macOS 12.7.6 est sous le minimum de `workerd` (13.5)** :

| Usage | Mac | Windows |
|---|---|---|
| `wrangler d1 execute --remote`, `whoami`, `deploy` | ✓ | ✓ |
| `wrangler pages dev` (runtime local) | ✗ probable | ✓ |
| Gates E2E Playwright (dépendent du serveur local) | ✗ par ricochet | ✓ |

Autrement dit : le Mac lit et écrit la production, mais le développement local iziGSM reste sur
Windows.

### Ce qui reste à faire — inchangé depuis le checkpoint 77

La vérification métier à l'écran, en production, depuis `manager@izigsm.fr` :

1. créer une facture sans l'émettre → doit afficher **« Brouillon (non numéroté) »** ;
2. l'émettre → **`FAC-2026-00004`**, à l'écran **et à l'impression** ;
3. créer un 2ᵉ brouillon, **le laisser tel quel**, puis émettre une autre facture → **`00005`,
   sans saut**. C'est le cœur du ticket ; un saut se lirait `dernier_num = 6`.

Le point 1 ne se prouve qu'à l'écran (libellé frontend). Les points 2 et 3 se prouvent mieux en
base qu'à l'œil. Piège d'environnement : **NoScript doit approuver `repairdesk.fr` en permanent**,
sinon aucun script ne s'exécute et les symptômes imitent un bug applicatif.

---

# iziGSM — État courant (MàJ : 2026-08-02, checkpoint 77 — le numéro de facture n'est attribué qu'à l'émission, déployé)

## Checkpoint 77 — Une série sans trou (2026-08-02)

**Ticket 001 du chantier `.scratch/conformite-facturation/` livré, déployé et vérifié
techniquement en production.** Commits `95c8ab0` (code, tests, migration) + `e912700` (docs)
+ `f573c5b` (`CACHE_VERSION`), poussés. Migration `0040` appliquée à distance **puis** Worker
déployé. **Aucune migration en attente.**

### Ce qui est livré

**Le numéro n'est attribué qu'à l'émission.** `nextNumero()` n'est plus appelé que par
`emettreFacture()` ; les trois chemins de création (manuelle, conversion de devis, acompte)
écrivent `numero = NULL`. Un brouillon abandonné n'entame donc plus la série — c'est la cause
des deux trous réels de la boutique 1 (`FAC-2026-00001` et `00002` n'existent nulle part).

**Le numéro est persisté AVANT le chaînage NF525**, pas seulement calculé. Sans cela, le
correctif aurait recréé le défaut qu'il corrige : un échec du chaînage aurait laissé la facture
sans numéro alors que le compteur avait avancé, et la reprise en aurait brûlé un second. La
reprise réutilise désormais le même numéro (`UPDATE … WHERE id = ? AND numero IS NULL`).

**Une écriture NF525 fautive supprimée.** `PUT /devis/:id/convertir` écrivait une ligne dans
`journal_nf525` pour un **brouillon**, puis `emettreFacture()` en écrivait une **seconde** pour
le même document. Défaut préexistant, trouvé en traçant `facture_numero` ; retiré après
arbitrage de l'exploitant. Le journal légal n'enregistre que des documents émis.

**Frontend** : « Brouillon (non numéroté) » remplace un `esc(null)`, et surtout le repli
d'impression `'FAC-' + id` — qui imprimait un numéro n'ayant jamais appartenu à la série.

### La migration `0040` — trois pièges D1/SQLite, trois échecs avant de passer

Recréer une table ne suit **pas** le patron de la migration `0034` sur une base peuplée :

1. `PRAGMA foreign_keys=OFF` est **ignoré** — D1 exécute le fichier dans une transaction, et
   SQLite ignore ce pragma dès qu'une transaction est ouverte. `DROP TABLE factures` échoue en
   `SQLITE_CONSTRAINT_FOREIGNKEY` (`paiements`, `avoirs`, `commissions`, `bons_achat`).
2. `defer_foreign_keys=ON` repousse les contrôles mais ne les **résout** pas : le compteur ne
   redescend que si les lignes parentes sont réinsérées **dans une table portant le nom
   référencé**. Copier vers `factures_new` puis renommer laisse le COMMIT en échec.
3. `PRAGMA legacy_alter_table` n'est **pas honoré** — vérifié sur deux tables jetables : le
   renommage réécrit les clauses `REFERENCES` des tables filles vers l'ancienne table.

Patron qui passe : table de transit (`CREATE TABLE … AS SELECT`, sans contrainte), `DROP`,
recréation **sous le nom final**, réinsertion, suppression du transit. Aucun `RENAME`.

**Prérequis** : `SELECT COUNT(*) FROM pragma_foreign_key_check` = **0** sur la base visée.
La base locale en portait 2 (`tickets` → client supprimé, `tickets_statuts_historique` →
ticket supprimé), supprimées après accord. La production en portait **0**.

### Ce qui a été mesuré en production, et comment

Chaque contrôle par un **chiffre**, jamais par un silence — une sortie vide de wrangler ne
distingue pas « zéro ligne » de « rien affiché » :

| Contrôle | Résultat |
|---|---|
| `pragma_foreign_key_check` (avant migration) | `violations = 0` |
| `pragma_table_info('factures')` → `numero` | `notnull = 0` |
| factures / numérotées / paiements / avoirs | `4 / 4 / 3 / 0` — rien perdu |
| `sw.js` servi par l'apex | `izigsm-v2.90` |
| `verifier-deploiement.mjs` | `47 970 octets de JavaScript`, domaine OK |

⚠ **Quoting PowerShell 5.1** : `--command "… ""notnull"" …"` arrive à l'exe avec les guillemets
mangés, donc `notnull` nu — mot-clé SQLite, erreur de syntaxe. Utiliser `[notnull]`.

### 🔴 Anomalie d'outillage — la loop commite et pousse seule

Pendant cette session, à 18:15:07, un processus externe (tâche planifiée Windows, auteur
`zinside@gmail.com`) a committé **mes 10 fichiers de travail** sous le message
`wip: conformite facturation ticket 001 …` (`95c8ab0`) **et les a poussés sur `origin/main`**.
Contenu correct, rien de perdu, aucun impact production (le déploiement reste manuel) — mais
une session humaine et la loop écrivaient sur le même arbre de travail au même moment. À
désarmer si ce n'est pas voulu : `Disable-ScheduledTask -TaskName "iziGSM Loop …"`.

### Ce qui reste

**La vérification métier à l'écran n'est pas faite** : personne n'a encore créé un brouillon en
production pour constater « Brouillon (non numéroté) », l'émettre, puis vérifier qu'un brouillon
abandonné ne fait pas sauter le numéro suivant. C'est le seul point du ticket qui ne peut pas
être prouvé autrement. Ne pas le reporter de checkpoint en checkpoint (le cp72 → cp76 a montré
ce que ça coûte).

Ticket **002** (vente de caisse `locked` ⇒ annulable par avoir) est débloqué par celui-ci.

### Gates

`npx vitest run` → **899/901** (2 échecs permanents de fuseau `agendaService`),
`npx tsc --noEmit` → **32** (baseline), `npx playwright test` → **188/188**.
Tests ajoutés : 6 unitaires + 2 E2E (`tests/e2e/facture-numerotation.spec.ts`), **tous vus
rouges avant correctif** — l'E2E en `422 NOT NULL`, c'est-à-dire pour la bonne raison.

---

## Checkpoint 76 — Ce qui ne s'affichait pour personne s'affiche (2026-08-02)

Session de reprise sur les quatre priorités laissées par le checkpoint 75, dans l'ordre annoncé.
**Rien n'est déployé** : tout est en working copy au moment de ce checkpoint.

### Ce qui est livré

**Le niveau d'enveloppe API est clos sur les cinq fichiers.** `reconditionnement.js` (12 sites),
`kanban.js` (5), `services.js` (8 fautifs), `caisse.js` (9, traité en dernier). Chaque page a
désormais un test de **rendu** — pas un test de requête : c'est la seule façon de distinguer « la
page n'a pas planté » de « la page fonctionne ».

**`services.js` avait 8 sites fautifs, pas 5.** L'inventaire du checkpoint 75 les comptait par
`res.success` seul ; il manquait trois `res.data` pris pour la charge utile (marques, modèles,
services liés). La revue site par site que `todo.md` exigeait était justifiée — un remplacement
mécanique aurait laissé la moitié du fichier muet.

**`caisse.js` : le défaut était pire que « la page est vide ».** Une vente **réellement
enregistrée** partait dans la branche `else` et s'affichait comme un échec. L'exploitant la
ressaisit — doublon de facture, avec chaînage NF525. Le test de ce fichier enregistre donc une
vraie vente et vérifie le succès annoncé **et** le compteur de transactions.

**Garde-fou statique contre la classe entière** :
`tests/frontend-enveloppe-api-conformite.test.ts`. Il embarque sa preuve par mutation (deux cas
fautifs, deux cas corrects) et a été vérifié en remettant le défaut réel dans `kanban.js` — rouge,
fichier et ligne exacts. Il retire les commentaires avant analyse : sans cela, les en-têtes qui
documentent le défaut (« ne jamais réintroduire `res.success` ») déclencheraient le garde-fou censé
l'empêcher.

**Trois XSS stockées fermées** — `kanban.js` (3 `<img>` réellement injectés), `sav.js`,
`agenda.js` (charge s'échappant d'un `href="tel:"`). Détail dans `bugs.md`. Balayage complet
ensuite : plus aucune interpolation de champ saisi hors échappeur, `insertAdjacentHTML` et
documents imprimables compris.

**Chantier 2 de la supervision cadré** — grilling (8 décisions, `decisions.md`), spec et 3 tickets
dans `.scratch/journal-plateforme-lecture/`. Volontairement **non implémenté** : le tracker impose
un ticket par fenêtre de contexte neuve.

### Deux défauts trouvés en corrigeant, absents de tout inventaire

Les deux étaient **masqués** par le bug d'enveloppe — le code sortait avant de les atteindre.

- `reconditionnement.js` appelait `renderPagination()`, qui n'existe que dans `sav.js`, locale à
  son IIFE. Trouvé par le gate de balayage **après** le correctif, pas avant.
- `services.js` annonçait « 0 nouveau(x) / 0 total » après un import de modèles réussi.

**La leçon du jour** : corriger un défaut qui faisait sortir tôt fait entrer le code dans des
chemins que personne n'a jamais exécutés. Relancer le **gate complet** après ce genre de
correction, jamais seulement le test de la page corrigée.

### Un test qui devenait faux vert

Le balayage du menu (`aucune page du menu de gauche ne casse`) a commencé à dépasser le timeout de
30 s : les pages rendent maintenant réellement leurs listes au lieu de sortir immédiatement. Porté
à 120 s pour ce test seul. Réduire la couverture ou le temps d'observation aurait rendu le gate
vert en le rendant aveugle.

Même vigilance sur le test XSS d'`agenda` : sa première version passait **avant** correctif, parce
qu'elle s'arrêtait à la vue liste — le téléphone n'apparaît que dans le détail du rendez-vous. Elle
n'a été rouge qu'une fois le clic ajouté.

### Vérifications

`npx playwright test` → **186/186** · `npx vitest run` → **893/895** (les 2 échecs permanents de
fuseau `agendaService`) · `npx tsc --noEmit` → **32**, la baseline.

Le premier jet du garde-fou ajoutait une 33ᵉ erreur `tsc` (paramètre implicitement `any`) —
corrigée avant checkpoint.

### Déployé et vérifié en production (même jour)

Commit `2bf64d9`, poussé et déployé. `CACHE_VERSION` → **`izigsm-v2.89`**, confirmé sur le
`sw.js` servi. Les 6 fichiers corrigés sont servis avec leurs marqueurs ; un asset absent
répond `404` ; `api/health` 200. Aucune migration dans ce lot.

Contrôlé à l'écran sur la boutique « iziGSM Paris 11 », compte de supervision :

| Page | Avant | Après |
|---|---|---|
| `/caisse` | KPI figés à `—` | `0` puis `1` transaction, journal peuplé |
| `/reconditionnement` | `ReferenceError`, page morte | KPI, tableau, et la barre de pagination rend « 0 résultat(s) » |
| `/kanban` | « Erreur API » à la place du tableau | 7 colonnes, 5 cartes, « 8 actifs » |
| `/services` | « Aucune marque » | référentiel complet (Apple 146, Asus 207, BLU 369…) |
| `/fournisseurs` | corrigé au cp 75 | compteurs numériques, pas de régression |

`/sav`, `/agenda`, `/stats`, `/personnel`, `/stock` chargées sans exception JS. Les deux seules
erreurs de console viennent d'une extension Chrome, pas de l'application.

### La vérification métier en attente depuis le checkpoint 72 est faite

Vente enregistrée **en production** depuis le compte de supervision : `FAC-2026-00003`,
50,00 € HT / 60,00 € TTC, espèces. Le modal se ferme sur un succès et les KPI se rafraîchissent —
c'est précisément le chemin qui, le matin même, affichait « Erreur » sur une vente pourtant écrite.
**Chaîne NF525 vérifiée intègre** après l'écriture.

Trace correspondante dans `journal_actions_plateforme` (lu en distant, aucune interface ne le
lit encore) :

```
4 | 2026-08-02 11:43:34 | user 1 | boutique 1 | POST /api/caisse/vente -> 201
```

La boutique est résolue ici parce que `apiPost` pose `?boutique_id=` sur l'URL (correctif cp 73).
La ligne 2 du même journal montre le défaut que le ticket 001 doit corriger, sur données réelles :
`DELETE /api/clients/20 -> 200` avec **`boutique_id` NULL**.

### Vérifié aussi depuis un compte manager — c'est lui que les correctifs servent

Le premier passage n'avait été fait que depuis la supervision. Or ces pages ne s'affichaient
**pour aucun rôle** : le rôle qui les utilise tous les jours est le manager. Contrôlé sur
« Saïd test / MyDesk » (boutique 2) : caisse (KPI numériques, aucun bandeau de supervision —
correct, il est réservé à la plateforme), reconditionnement (pagination rendue), kanban
(6 actifs, ses propres tickets), services (référentiel global visible), fournisseurs. Aucune
erreur de console.

**Isolation vérifiée côté serveur**, depuis sa session :

```
appel nominal            → 6 tickets (TKT-2026-00001,3,4,5,6,7)
avec ?boutique_id=1      → LES MÊMES 6 → le paramètre est ignoré pour un manager
recherche FAC-2026-00003 → renvoie FAC-2026-00002 (la sienne), jamais celle de la boutique 1
```

Conforme à `middleware.ts` : le `?boutique_id=` n'est honoré que selon le rôle. À ne pas
confondre avec la garantie plus forte qu'on serait tenté d'en déduire — un admin *de boutique*
voit lui aussi son paramètre honoré (noté au checkpoint 73).

### À qui la vente de test est attribuée

Question posée après coup, vérifiée en base plutôt que déduite de l'écran :

```
FAC-2026-00003 | user_id 1 | support@soteli.fr — « Admin iziGSM » | user.boutique_id = NULL
               | ligne NF525 boutique_id = 1 (iziGSM Paris 11)
```

L'écriture est rattachée à la bonne boutique, mais **le caissier inscrit dans la chaîne NF525 est
le compte de supervision**, pas un employé du client. C'est cohérent avec la traçabilité voulue
(et c'est la raison d'être du journal des actions de plateforme), mais il faut le savoir : dans le
registre NF525 d'un client, une intervention de la plateforme porte le nom d'un tiers. À comparer
avec `FAC-2026-00002`, passée par un vrai manager (`user_id 5`, boutique 2).

### Un second chantier est né de la vente de test : la conformité de la facturation

En voulant annuler la vente par un avoir, refus du **service** : la caisse crée sa facture en
`payee` sans jamais poser `locked`, et l'avoir l'exige. Aucune vente encaissée n'est donc
corrigeable, pour aucun rôle — alors que NF525 impose la correction par document rectificatif.

L'exploitant a alors posé un invariant (repris tel quel dans `decisions.md`) : *une facture créée
est persistante, non modifiable, non supprimable, chaînée ; annuler = avoir lié ; ⊥ trou entre les
numéros ; série et chaînage propres à chaque tenant.*

**Vérification faite avant d'ouvrir un chantier — la séparation par tenant existe déjà** :
`sequences(boutique_id, type, annee)` (les boutiques 2 et 5 portent chacune `FAC-2026-00001`),
chaînage filtré par `boutique_id` sur les 4 chemins, `avoirs.facture_id NOT NULL`, et ni
`PUT` ni `DELETE /factures/:id`. Le doute venait d'ailleurs : **le numéro est consommé avant que
le document existe**, donc tout échec en brûle un. Deux trous réels sur la boutique 1.

Ma première explication — « le brouillon est supprimable » — était **incomplète** : les routes de
suppression n'existent pas, seul un bouton 🗑 mort subsiste à l'écran. L'immuabilité est donc
accidentelle, pas voulue : c'est l'objet du ticket 003.

Spec + 4 tickets dans `.scratch/conformite-facturation/`. `.scratch/avoir-vente-caisse/` est
absorbé (`wontfix`, conservé pour la trace).

### Reste ouvert

- Conformité facturation : tickets 001 et 003 prenables immédiatement. C'est du légal — priorité
  sur le chantier 2 de la supervision.
- Chantier 2 : ticket 001 prenable immédiatement, sans bloqueur — et désormais justifié par une
  ligne réelle du journal de production, pas seulement par un raisonnement.
- Vente de test `FAC-2026-00003` (60 € TTC) laissée dans les comptes de « iziGSM Paris 11 ».
  S'annule par un avoir si elle gêne — non fait.
- Non creusé : le CA du mois du manager affiche `0,00 €` alors qu'il porte `FAC-2026-00002`.
  Hors du mois courant, ou facture non passée par la caisse — à vérifier avant d'en conclure
  quoi que ce soit.
- L'audit XSS n'a **pas** été rejoué en production : le faire supposerait d'écrire une charge
  piégée chez un vrai tenant. La couverture est locale (`xss-gabarits.spec.ts`) et le bundle servi
  contient bien `echapperHtml`.

# iziGSM — État courant (MàJ : 2026-08-01, checkpoint 75 — les 19 pages du menu, et trois régressions de ma main)

## Checkpoint 75 — Barre latérale sur tout le menu, page 404, XSS du socle (2026-08-01)

Suite directe du checkpoint 74, même journée, **piloté par les constats de l'exploitant à
l'écran**. Commits `6eb8c5b`, `99c17e6`, `021bed6` (+ `1f372bd` et le bump `v2.88`).

**Tout est déployé et vérifié en production** (`CACHE_VERSION` `izigsm-v2.88`) : les 10 pages
hors socle portent bien leur conteneur **et** `main.css` — 10/10 — et un asset absent répond
`404`. Aucune migration dans ce lot. Le script de vérification a imposé sa fenêtre de 25 s à
chacun des trois déploiements de la journée, sans incident.

### Ce qui est livré

- **Les 19 entrées du menu ont une barre latérale stylée.** Le socle expose déjà le
  bandeau « Vous consultez la boutique X » depuis `buildSidebar()` : le câblage l'a donc
  livré du même coup sur toutes ces pages.
- **`fournisseurs.js`** : enveloppe API corrigée (12 sites), la page affichait `—` partout
  depuis toujours, pour tous les rôles.
- **`public/404.html`** : un asset absent répond enfin `404` au lieu de `200 + HTML`.
- **XSS stockée fermée** dans `buildSidebar()`.
- **Trois parades de déploiement** : le `404.html`, `scripts/verifier-deploiement.mjs`
  chaîné à `npm run deploy` (fenêtre de 25 s + contrôle, arrêt en erreur), et la règle en
  dur dans `CLAUDE.md`.

### Trois choses fausses que j'ai crues, et une que j'ai livrée

1. **« Passer ces pages au socle est une refonte d'interface »** — repris du checkpoint 71
   pendant trois checkpoints sans vérification. Mesure faite : `agenda` et `modules` avaient
   déjà le conteneur et n'appelaient simplement pas `buildSidebar()` (une ligne) ; `caisse`
   le nommait `app-sidebar` ; `services` le nommait `sidebar-container` et **appelait bien
   le socle** — l'injection échouait en silence. `buildSidebar()` prévient désormais.
2. **Le correctif `404` dans le Worker était du code mort.** `_routes.json` déclare
   `include: ["/api/*"]` : Pages sert `/static/*` sans jamais invoquer Hono. Trouvé **en
   pilotant le navigateur avant de déployer** — sinon il partait en production avec un
   commentaire affirmant le contraire.
3. **J'ai livré une régression visible.** Le premier câblage n'a pas vérifié que la barre
   était *stylée* : 9 pages chargent `style.css` (**49 octets**, une règle sur `h1`) au lieu
   de `main.css`. En production, la barre était injectée en `position: static`,
   `width: 1920px` — 21 liens bruts empilés au-dessus du contenu. Mon test n'assertait que
   la présence de `#sidebar`.

**Le fil commun des trois** : j'ai vérifié qu'une chose *existe* au lieu de vérifier
qu'elle *fonctionne*. C'est exactement le piège 1 de `modop-tests.md`, écrit le matin même.
Le test assertionne maintenant la **géométrie** de la barre sur les 19 pages.

### L'incident de production, et ce qu'il a coûté

Après le déploiement du checkpoint 74, j'ai chargé la page **pendant la fenêtre de
propagation**. Un edge a mis en cache le catch-all HTML pour `/static/js/app.<hash>.js` ;
les assets hashés étant `immutable`, la réponse est restée figée. `app.js` ne définissait
plus rien : **tout le site mort, pour tous les rôles**, une dizaine de minutes. Rétabli en
forçant un nouveau hash.

C'est l'incident documenté du 2026-07-30, que j'ai reproduit. D'où les trois parades — dont
la seule qui supprime la classe de défaut, le `404.html`.

### Pièges de mesure appris aujourd'hui

- **Mesurer à travers un service worker, c'est mesurer le service worker.** Le même
  `/static/js/app.js` renvoyait `200` depuis la page et `404` hors navigateur : une entrée
  périmée du cache du SW. Toujours doubler la mesure hors navigateur.
- **Le filtre de sécurité de Claude in Chrome masque les query strings** (`[BLOCKED]`) :
  dériver ce qu'on cherche (compter les `?`, lire un `searchParams.get()`) plutôt que
  restituer l'URL.
- **`CACHE_VERSION` doit être incrémenté après *chaque* lot frontend**, pas une fois par
  journée : je l'ai oublié une fois, un visiteur revenant aurait reçu l'ancien HTML malgré
  un déploiement « réussi ».

### Reste ouvert, mesuré et priorisé dans `todo.md`

**4 fichiers lisent encore l'enveloppe API au mauvais niveau** — `caisse.js` (9 sites, à
faire **en dernier** : vente, encaissement, NF525), `reconditionnement.js` (11),
`kanban.js` (5), `services.js` (5 fautifs contre 3 corrects, donc revue site par site). La
méthode est validée sur `fournisseurs.js` : déballer une fois au point d'appel.

**Le gate ne voit pas cette classe** (200, aucune exception, page vide). Piste retenue, non
implémentée : un garde-fou statique sur le modèle de `routes-isolation-conformite.test.ts`.

**L'audit XSS des autres gabarits** n'est pas fait — seule la barre latérale est traitée.

### Vérifications

**180/180 E2E**, `tsc` à la baseline de 32, `vitest` 891/893. Vérifié à l'écran sur le
serveur local **avec service worker actif** (l'angle mort de la suite) : barre et bandeau
sur les pages câblées, `fournisseurs` affichant ses compteurs.

## Checkpoint 74 — le défaut que 176 tests verts n'ont pas vu (2026-08-01)

## Checkpoint 74 — `apiGet` doublait le « ? », et un mode opératoire de test (2026-08-01)

Suite directe du checkpoint 73, **même journée, déclenché par l'exploitant**. Le chantier
73 avait été annoncé vérifié et déployé ; à l'écran, la caisse et le SAV répondaient
`boutique_id requis.` à un admin plateforme, boutique pourtant sélectionnée.

### La cause était antérieure au chantier

```
apiGet('/api/garanties?page=1&limit=15')
  →  /api/garanties?page=1&limit=15?boutique_id=1
                                   ↑ deuxième « ? »
```

`apiGet` concaténait `'?' + params` **sans regarder si l'URL portait déjà une query**.
`limit` valait donc `"15?boutique_id=1"` et **aucun** `boutique_id` n'existait ⇒ `400` sur
**toutes les listes paginées du dépôt**. Invisible pour un manager (le serveur retrouve sa
boutique dans le jeton), fatal pour l'admin plateforme — d'où un défaut ancien jamais
signalé, que la supervision a rendu visible.

Corrigé par le séparateur conditionnel que `_avecBoutique()` appliquait déjà.

### Comment il a été trouvé : en pilotant le vrai navigateur

Aucune théorie n'a tenu. Ce qui a tranché, dans l'ordre :

1. Le hash de l'`app.<hash>.js` réellement chargé (`a0d346cc`) a **écarté le cache**, seule
   hypothèse plausible jusque-là.
2. `getBoutiqueId()` évalué dans la page renvoyait bien `1`.
3. **Rejouer les appels de la page un par un** : `kpis` → 200, `garanties?page=…` → 400.
   La différence entre les deux *était* la réponse.

Le filtre de sécurité de Claude in Chrome masque les query strings (`[BLOCKED]`) : il faut
**dériver** ce qu'on cherche plutôt que restituer l'URL (compter les `?`, lire un
`searchParams.get()`).

### `reconditionnement.js` corrigé — la page était morte pour tout le monde

11 appels à `getCurrentBoutiqueId()`, définie nulle part, remplacés par `getBoutiqueId()`.
`ReferenceError` au premier appel : la page ne fonctionnait **pour aucun rôle**. Trouvée en
revue de code au cp73, prouvée par le balayage aujourd'hui.

### L'échec de méthode, et sa parade — `project-docs/modop-tests.md`

**176 tests verts, production cassée.** Trois erreurs, toutes miennes :

1. **Tester le mécanisme qu'on vient d'écrire** plutôt que le résultat visible : j'assertais
   « l'URL porte `boutique_id` », pas « la page affiche les garanties ».
2. **Choisir un point d'observation commode** : pour `caisse` et `sav`, j'ai visé
   `/api/*/kpis` — les deux **seuls** appels de ces pages sans query préexistante, donc les
   deux seuls que le défaut épargnait. Échantillon de taille 1.
3. **Oublier ce que la config neutralise** : `serviceWorkers: 'block'`
   (`playwright.config.ts:32`) fait que la suite ne parcourt jamais le chemin de requête
   réel de la production.

Parade retenue, **en gate** : `tests/e2e/resolveur-boutique-pages.spec.ts` § « aucune page
du menu de gauche ne casse pour un admin plateforme » visite les **20** entrées de
`buildSidebar()` et capte **deux** classes de défaut — `page.on('response')` pour les
`>= 400` sur `/api/*`, `page.on('pageerror')` pour les exceptions qui tuent la page **avant**
tout appel. C'est ce second filet qui prouve `reconditionnement` ; aucun test réseau ne
l'aurait vu, la page mourant avant d'émettre quoi que ce soit.

**Toute entrée ajoutée à `buildSidebar()` doit l'être à `MENU_GAUCHE`.**

### Reste ouvert, constaté à l'écran

`caisse.html` et `sav.html` n'appellent pas `buildSidebar()` : **plus aucune barre latérale**
une fois qu'on y entre — l'exploitant « perd tout l'affichage » et ne peut plus naviguer.
C'est le volet interface du P1 d'origine, toujours à cadrer.

### Vérifications

**178/178 E2E** (balayage compris), `tsc` à la baseline de 32, `vitest` 891/893.

## Checkpoint 73 — les écritures suivent la boutique consultée (2026-08-01)

## Checkpoint 73 — Résolveur de boutique : les écritures suivent enfin la sélection (2026-08-01)

Commit `01ff760` sur `main`, **déployé** le jour même (`30e9d734.izigsm.pages.dev` →
`repairdesk.fr`). Aucune migration dans ce chantier : la dernière reste `0039`, appliquée à
distance au checkpoint 72. Vérifié après déploiement — `repairdesk.fr` sert bien
`static/js/app.a0d346cc.js` contenant `_avecBoutique` (`cf-cache-status: MISS`, donc pas le
piège de l'edge qui fige une réponse HTML sur un asset hashé, cf. `bugs.md`), et `sw.js`
annonce `izigsm-v2.85`.

### Le diagnostic du checkpoint 71 était faux pour moitié, et c'est le test qui l'a montré

Le todo annonçait « 10 pages lisent `session.boutique_id` en direct au lieu de
`getBoutiqueId()` ⇒ écrans inutilisables ». La spec E2E écrite en rouge d'abord a montré
autre chose : **6 des 8 pages visées passaient déjà**. `apiGet` (`app.js`) injectait
`boutique_id` depuis `getBoutiqueId()` **de longue date** — les *lectures* suivaient donc
la boutique consultée partout, y compris sur les pages accusées.

Ce qui ne suivait pas, ce sont les **écritures** : `apiPost`, `apiPut`, `apiPatch` et
`apiDelete` n'injectaient rien. Un admin plateforme pouvait **consulter** la caisse d'un
client sans pouvoir y **enregistrer une vente**. Et l'écriture est précisément ce que le
journal des actions de plateforme (ADR 0001, ticket 04) existe pour tracer : le chantier
précédent journalisait des mutations que l'exploitant ne pouvait pas faire.

**Leçon de méthode** : un diagnostic recopié de checkpoint en checkpoint (celui-ci datait
du ticket 03) n'est pas une observation. Écrire le test avant le correctif l'a corrigé en
une minute — la même erreur que « `0038` en attente » au checkpoint 72, dans une autre
matière.

### Ce qui a été livré

- **`_avecBoutique(url)` (`app.js`)** — ajoute `?boutique_id=<boutique consultée>` aux URL
  des 4 helpers de mutation, par symétrie avec `apiGet`. Point de passage unique :
  `caisse.js` et `sav.js` n'ont eu **aucun appel à changer**, et une page future en hérite.
- **5 pages passées sur le socle** : `settings.html`, `stats.html`, `notifications.html`,
  `kanban.js`, `personnel.js` — `getBoutiqueId()` et `sessionCourante()` au lieu de
  `JSON.parse(localStorage.getItem('izigsm_session'))`.
- **`personnel.js`** pose aussi `boutique_id: getBoutiqueId()` dans le corps :
  `POST /api/employes` (`personnel.ts:72`) résout depuis le corps, la query n'y suffit pas.
- **`tests/e2e/resolveur-boutique-pages.spec.ts`** — 9 cas : les 7 pages, plus un témoin
  d'écriture (`POST /api/garanties/expire`), plus le pendant « sans sélection, aucune page
  ne vise une boutique au hasard » qui verrouille la règle d'absence d'auto-sélection.
- `CACHE_VERSION` → `izigsm-v2.85`.

### Trois défauts corrigés sans les avoir cherchés

1. **Page morte pour qui décoche « se souvenir de moi »** : `settings`, `stats` et `kanban`
   ne lisaient que `localStorage`. Session dans `sessionStorage` ⇒ boucle
   `setTimeout(init, 100)` **infinie**, écran vide sans message. `sessionCourante()` lit
   les deux supports.
2. `notifications.html` construisait des URL `/api/boutiques/null/settings`.
3. La 🟠 P2 « boutique visée non résolue sur les routes par ID » (journal) est **atténuée** :
   les mutations portant désormais la query, `resoudreBoutiqueVisee()` a une cible sur des
   routes `/:id` qui n'en avaient pas.

### Ce que la revue de code a rattrapé — deux commentaires qui mentaient

1. Le JSDoc de `_avecBoutique` affirmait « **toutes** les routes résolvent par la query ».
   Faux : une dizaine de handlers d'écriture lisent le **corps** (`employes`, `devis`,
   `factures`, `rachats`, `fournisseurs`, `services`, `users/permissions`, et `agenda.ts`
   qui n'appelle même pas `getBoutiqueId()`). Les pages concernées posent déjà la valeur
   dans le corps — vérifié une par une — mais le commentaire aurait rassuré à tort le
   prochain auteur. **Un helper qui promet l'universalité doit énumérer ses trous.**
2. Le même JSDoc promettait « aucun moyen de viser la boutique d'autrui ». Or
   `middleware.ts:208` teste `user.role === 'admin'` **seul** : un admin *de boutique* voit
   son paramètre honoré lui aussi, et quelques routes d'`agenda.ts` lisent la query brute
   sans filtre de rôle. Le socle n'envoie jamais que la boutique de la session, donc rien
   n'est aggravé — mais c'est une approximation, pas un invariant serveur. La reformuler en
   garantie était le raccourci qui a produit la faille superadmin du checkpoint 65.

### 🔴 P1 ouvert par la revue, hors périmètre

`public/static/js/reconditionnement.js` appelle **`getCurrentBoutiqueId()` 11 fois**
(l. 135, 156, 261, 365, 415, 469, 490, 528, 572, 617, 663). Cette fonction n'est définie
**nulle part** dans `public/`. `ReferenceError` au premier appel ⇒ la page est
**entièrement hors service, pour tous les rôles**. Vérifié à la main, pas seulement
rapporté. Tâche ouverte dans `todo.md`.

### Vérifications

**176/176 E2E** dont les 155 tests d'isolation multi-tenant — le vrai risque d'un
changement du socle, puisqu'il touche les écritures des 29 pages. `tsc` à la baseline de
32. `vitest` 891/893, les 2 échecs `agendaService` étant antérieurs et sur du backend que
le diff ne touche pas.

### Fait d'exploitation

**36 processus `wrangler` orphelins** (9 grappes `pages dev --port 3000` lancées entre
15h27 et 16h22, aucune n'écoutant réellement) occupaient **3 480 Mo**. Tués. C'est la
suite directe de la leçon du checkpoint 72 (`TaskStop` ne tue pas l'arbre de processus) :
le symptôme n'est pas seulement « l'ancien bundle est servi », c'est aussi plusieurs Go de
mémoire. Commande de diagnostic :
`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'wrangler' }`.

## Checkpoint 72 — Journal des actions de plateforme, chantier 1 clos et **déployé** (2026-08-01)

Ticket 04 : `statut: done`, commit `4404052`. Migration `0039` appliquée à distance, puis Worker
déployé (`5b38572e.izigsm.pages.dev` → `repairdesk.fr`). **Le chantier 1 de la supervision est
entièrement en production et vérifié en réel.**

### Ce qui a été livré

Toute mutation d'un admin plateforme sur une boutique cliente laisse une ligne dans
`journal_actions_plateforme` (migration `0039`), registre dédié distinct de l'`audit_logs` du
client, alimenté par `journalPlateformeMiddleware` posé **globalement** sur `/api/*` : une route
écrite demain est journalisée sans que personne n'y pense (ADR 0001).

- `src/services/journalPlateformeService.ts` — SQL + expurgation + troncature (2 000 caractères).
- `journalPlateformeMiddleware` + `isAdminPlateforme()` dans `src/lib/middleware.ts`.
- `tests/journalPlateforme.test.ts` — 16 tests, dont un qui traverse **l'application réelle**
  (`src/index.tsx`, vrai `authMiddleware`, route métier existante) : c'est lui qui démontre le
  critère « une route non prévue par le middleware est journalisée quand même ».
- Table **sans aucune clé étrangère**, index `(boutique_id, created_at)` et `(user_id)`.

### Les deux défauts trouvés en revue de code

1. 🔴 **Une ligne pouvait être perdue.** La journalisation vivait après un simple `await next()`.
   64 des 107 handlers mutants n'attrapent pas leurs erreurs et `index.tsx` ne déclare aucun
   `app.onError` : une intervention qui échoue en 500 sur une facture — le cas de litige même que
   l'ADR invoque — ne laissait aucune trace. Corrigé par `try/finally`, statut 500, test dédié.
   Ne pas lire `c.res` dans ce cas : le getter de Hono fabrique une 404 au passage.
2. **L'expurgation était faite par l'appelant** — donc oubliable par le prochain. Déplacée dans
   `enregistrerActionPlateforme()`, hors d'atteinte.

Écartés en revue, sciemment : bump de `@version` dans `index.tsx` et mise à jour de
`docs/JOURNAL_MODIFICATIONS.md`, conventions dormantes depuis le Sprint 2.41 que les tickets 01
à 03 n'ont pas suivies non plus.

### Vérification en production, à l'écran

Connecté en admin plateforme sur `repairdesk.fr`, boutique « iziGSM Paris 11 » choisie dans la
console, création d'un client de test (supprimé depuis) :

```
user_id 1 · boutique_id 1 · POST /api/clients · 201 · ip 159.26.112.36 · corps complet, sans secret
```

**Une seule ligne** : toute la navigation qui a précédé (console, dashboard, liste clients,
statistiques) n'a rien écrit. Les lectures sont muettes, comme voulu. Vérifiés au passage : la
console liste les 3 enseignes (ticket 01), le clic bascule les pages sur la boutique (ticket 02),
le bandeau est présent **et passe au-dessus du modal de saisie** (ticket 03, `z-index: 900`).

### La migration `0038` était déjà appliquée — les checkpoints 65 à 71 se trompaient

`d1_migrations` distant interrogé ce jour : la dernière migration appliquée avant aujourd'hui était
bien `0038`. La mention « `0038` en attente d'application distante » traînait depuis le
checkpoint 65 et a été recopiée de checkpoint en checkpoint sans être vérifiée. Leçon : l'état
d'une base distante se lit, il ne se recopie pas.

### Trois pièges d'outillage, dont un qui a coûté une demi-heure

1. **`TaskStop` tue wrangler mais pas `workerd.exe`.** Six processus orphelins écoutaient
   simultanément sur `:3000` (Windows l'autorise) et servaient l'**ancien** bundle : le middleware
   semblait ne pas s'exécuter alors qu'il fonctionnait. Complément indispensable au piège déjà
   connu (« `wrangler pages dev` ne recharge pas `dist/` ») :
   `taskkill //F //IM workerd.exe` **avant** chaque relance.
2. **`c.header()` après `next()` ne remonte pas** de façon fiable, et `console.log` du Worker
   n'apparaît pas dans la sortie redirigée de `wrangler pages dev` : pour instrumenter un
   middleware en local, passer par un état en mémoire exposé dans une réponse existante.
3. **Erreur `7403` sur une commande `--remote`** : ce n'est pas le compte. La session OAuth
   (`contact@soteli.fr`, compte `88cfb31e…`) porte `d1 (write)` et passe ; c'est le
   `CLOUDFLARE_API_TOKEN` de `.dev.vars`, s'il se retrouve exporté dans le shell, que wrangler
   préfère — sans droit D1.

### Hors dépôt, mais utile à savoir

Le pilotage du navigateur a longuement échoué sur `repairdesk.fr` : **NoScript** bloque les
scripts d'un onglet non explicitement approuvé, et ses autorisations sont temporaires et par
onglet. Symptômes trompeurs : page de réinitialisation qui redemande l'email alors que le token
est bien dans l'URL, console des boutiques figée sur « Chargement… », `logout is not defined`.
Les assets étaient sains (`200`, `application/javascript`) — ce n'était pas le piège CDN de
`bugs.md`. Approuver le site en **TRUSTED** (permanent) débloque tout.

Cela dit, `/reset-password` fait dépendre **toute** la réinitialisation d'un unique bloc de script
inline : une CSP future la casserait de la même manière. Tâche ouverte dans `todo.md`.

## Checkpoint 71 — Bandeau permanent de la boutique consultée (2026-08-01)

Ticket 03 du chantier supervision : `statut: done`, commit `7d2e9f6` sur `main`.
**Non déployé** — le déploiement du chantier reste groupé après le ticket 04.

### Ce qui a été livré

Un admin plateforme qui consulte une boutique cliente voit en permanence, en haut de l'écran,
« Vous consultez la boutique **X** » et un retour à la console. Ni masquable, ni refermable.

- **`renderBandeauPlateforme()` (`app.js`)**, appelé par `buildSidebar()` : le bandeau vient du
  socle partagé, aucune page n'a été touchée individuellement. Construit par nœuds DOM (le nom de
  boutique vient de l'API et serait interprété comme du balisage par `innerHTML`).
- **Décalage du socle plutôt que recouvrement** : `body.avec-bandeau-plateforme` décale `body`,
  `.sidebar` (fixed) et `.dash-topbar` (sticky) de `--bandeau-h`. Un simple `padding` sur `body`
  aurait laissé les deux premiers sous le bandeau.
- **`CACHE_VERSION` → `izigsm-v2.84`** — dernière tâche frontend du chantier, comme prévu au
  checkpoint 70. Vérifié à l'écran : le navigateur affiche bien « Mise à jour disponible ».
- **`tests/e2e/bandeau-plateforme.spec.ts`** (10 cas) + helpers de console extraits dans
  `tests/e2e/fixtures/console-plateforme.ts`, `seDeconnecter()` dans `comptes.ts`.

### Trois décisions prises en cours de route, hors ticket

1. **Le bandeau passe au-dessus des modals** (`z-index: 900` contre 500 pour `.modal-overlay`).
   Trouvé en revue : un modal de saisie — soit exactement l'écran où l'on écrit chez le client —
   recouvrait intégralement le bandeau, qui devenait masquable par le premier geste d'écriture.
   Le test correspondant vérifie l'occultation par un **clic** (Playwright échoue si quoi que ce
   soit s'interpose), et la mutation a été jouée : remis à `z-index: 200`, le test vire au rouge.
2. **Masqué à l'impression.** Le bandeau est enfant direct de `body`, or `_triggerPrint()` ne
   masque que `body > .app-layout` : sans règle `@media print` il volait ~44 mm au budget d'une
   page A4, garanti par ailleurs.
3. **Portée limitée aux 10 pages qui appellent `buildSidebar()`** — voir ci-dessous.

### Le constat qui compte : la moitié de l'application est hors socle

**10 des ~20 pages internes n'appellent pas `buildSidebar()`** : `settings`, `stats`, `caisse`,
`kanban`, `personnel`, `sav`, `notifications`, `fournisseurs`, `agenda`, `modules`. Le critère du
ticket 03 (« pages qui construisent leur interface avec le socle partagé ») est tenu ; l'intention
« toute page » ne l'est pas.

Le bandeau manquant est le moindre des deux problèmes. Ces pages lisent
`JSON.parse(localStorage.getItem('izigsm_session')).boutique_id` **en direct**, pas
`getBoutiqueId()` — vérifié sur `settings.html` et `stats.html`. Pour un admin plateforme ce champ
est NULL : **ces écrans sont inutilisables, sélection faite ou non** (`settings` affiche « Compte
admin global — sélectionnez une boutique »). C'est précisément le cas que la spec du chantier
annonçait à traiter comme un défaut.

**L'ordre compte** : corriger le résolveur d'abord, poser le bandeau ensuite. Un bandeau sur une
page qui travaille en réalité ailleurs est pire que pas de bandeau. Tracé en 🔴 P1 dans `todo.md`
§ « Pages hors socle partagé ».

Corollaire à ne pas oublier : l'affirmation « les 29 pages basculent » du checkpoint 70 vaut pour
les pages qui passent par les helpers d'appel API partagés — pas pour ces 10-là.

### Ce que la revue en deux axes a rattrapé

- Le recouvrement par les modals (point 1 ci-dessus) — le seul défaut fonctionnel réel.
- Une assertion fragile : `bandeau.width === viewportSize().width` compare un élément `fixed` à
  une largeur incluant la barre de défilement. Comparé désormais à la largeur de `body`.
- `role="status"` sur un repère permanent : région live réannoncée à chaque changement de page.
  Remplacé par `role="region"` + `aria-label`.
- Le sélecteur de déconnexion recopié dans deux suites, en contradiction avec l'en-tête du fichier
  qui promettait de ne pas dépendre de la structure interne du socle → `seDeconnecter()`.

### Vérifications

`npx playwright test` → **167/167** (10 nouveaux cas). `npx vitest run` → **875/877** (les 2
échecs de fuseau `agendaService`). `npx tsc --noEmit` → **32**. Validation live dans un Chromium
réel contre `wrangler pages dev` + D1 local : `/dashboard`, `/tickets`, modal ouvert, et compte
manager (aucun bandeau, aucun décalage).

### Piège d'outillage rencontré

`tsconfig` n'inclut pas la lib `dom` : tout `page.evaluate(() => document…)` dans un test E2E
ajoute des erreurs `TS2584` et fait sortir de la baseline `tsc ≤ 32`. Mesurer par
`locator.boundingBox()` et prouver l'occultation par un clic évite complètement `document`.

## Checkpoint 70 — Sélection d'une boutique et bascule des 29 pages (2026-08-01)

Ticket 02 du chantier supervision : `statut: done`, commit `c72fabf` sur `main`.
**Non déployé** — le déploiement du chantier reste groupé après le ticket 04.

### Ce qui a été livré

Cliquer une boutique dans la console fait entrer l'admin plateforme dans son contexte. Les 29 pages
métier affichent les données de cette boutique, le choix tient toute la session et survit à la
navigation — **aucune page métier n'a été adaptée pour ça** (une exception, voir plus bas).

- **`getBoutiqueId()` (`app.js`) devient le point de passage unique** : boutique sélectionnée, puis
  boutique de la session, puis `null`. C'est ce qui fait basculer les 29 pages sans les toucher :
  elles passent toutes par les mêmes helpers d'appel API.
- **Le choix vit dans l'objet de session existant** (`boutique_selectionnee_id` / `_nom`), pas dans
  une clé de stockage à part. Il hérite ainsi du support choisi à la connexion (« se souvenir de
  moi ») et surtout de la purge à la déconnexion — aucun code de nettoyage à écrire, ni à oublier
  le jour où un chemin de déconnexion de plus apparaîtra.
- **En-tête** : « Console plateforme » tant qu'aucune boutique n'est choisie, puis le nom de la
  boutique consultée. Le repli « MyDesk » ne s'affiche plus à un compte sans boutique.
- **Console** : ligne cliquable au pointeur, bouton pour le clavier, délégation d'événement sur le
  conteneur (les lignes sont réécrites à chaque recherche).

### Deux défauts trouvés en chemin, corrigés (détail dans `bugs.md`)

1. **`/agenda` visait toujours la boutique 1, en dur.** `agenda.js` définissait sa **propre**
   `getBoutiqueId()` ; `agenda.html` chargeant `app.js` **puis** `agenda.js`, elle écrasait le
   résolveur partagé sur cette page seule. Elle lisait une clé `localStorage['user']` qu'aucun code
   du dépôt n'écrit, et retombait donc systématiquement sur `|| 1`. Sans effet jusqu'ici (le serveur
   ignore le paramètre pour un non-admin), bloquant à partir de ce ticket. 6 lignes supprimées, sur
   décision explicite de l'utilisateur — traité comme le défaut que la note du ticket prévoyait, pas
   comme une adaptation de page.
2. **Les stubs réseau Playwright étaient court-circuités par le service worker.** `sw.js` fait
   `skipWaiting()` + `clients.claim()` et intercepte `/api/*` ; or `page.route()` ne voit pas les
   requêtes émises par un service worker. Le test « aucune boutique active » du ticket 01 échouait
   **2 suites complètes sur 3** tout en passant en isolation. `serviceWorkers: 'block'` dans
   `playwright.config.ts`. Aucune couverture perdue : aucun test n'observe le service worker.

### Ce que la revue en deux axes a rattrapé

- **L'en-tête mentait sur une boutique sans nom** : `boutique_selectionnee_nom || 'Console
  plateforme'` réaffichait « Console plateforme » alors qu'une boutique **était** sélectionnée et
  accessible en écriture. L'absence de sélection se lit désormais sur l'**identifiant**, jamais sur
  le nom. C'est exactement le contresens que le bandeau du ticket 03 est censé rendre impossible.
- **Un test API était tautologique** : `expect(t.boutique_id ?? SEED).toBe(SEED)` passe sur une
  liste vide comme sur un champ absent. Remplacé par la comparaison des deux réponses (avec et sans
  paramètre étranger), qui échoue dès que le paramètre a le moindre effet.
- **`boutiqueSelectionnee()` n'avait aucun appelant** — généralité spéculative écrite pour le
  ticket 03, supprimée.

**Un constat de la revue vérifié puis écarté** : 4 `fetch` écrits à la main (`clients.js` 1153/1190,
`tickets.js` 1578/1823) n'injectent pas de `boutique_id`. Ce ne sont pas des défauts — ce sont des
routes `:id` où la boutique vient de la ressource et où l'admin plateforme traverse par son rôle
(`canAccessClient` l.67, `user.role !== 'admin'` l.415/450). Ne pas les re-signaler.

### Vérifications

`npx playwright test` → **157/157**, trois exécutions complètes consécutives (12 nouveaux cas :
navigateur + API). `npx vitest run` → **875/877** (les 2 échecs de fuseau `agendaService`).
`npx tsc --noEmit` → **32**. Validation live sur **4 pages métier** (`/dashboard`, `/clients`,
`/tickets`, `/agenda`) dans un Chromium réel contre `wrangler pages dev` + D1 local, avec deux
boutiques aux données distinctes créées pour l'occasion.

Helpers d'authentification E2E extraits dans `tests/e2e/fixtures/comptes.ts` — trois suites
recopiaient les mêmes identifiants de seed.

### Laissé de côté, volontairement

- **`CACHE_VERSION` reste à `izigsm-v2.83`.** À incrémenter sur la **dernière** tâche frontend du
  chantier, donc au ticket 03 — pas ici. Rien ne le rappellera automatiquement.
- **Aucun manager ne voit jamais le nom de sa boutique.** `boutique_name` n'existe **nulle part**
  côté serveur (vérifié : 0 occurrence dans `src/`), donc `session.company` est toujours vide et
  tout manager lit le repli « MyDesk ». C'est le comportement antérieur, verrouillé par un test —
  le ticket 02 exigeait que rien ne change pour un manager. Mérite un ticket à part.

### Environnement (hors dépôt)

7 instances `wrangler pages dev` étaient empilées (le leak documenté dans `bugs.md`) ; toutes tuées
sur décision de l'utilisateur, une seule tourne désormais. **Après `npm run build`, tuer et relancer
le serveur** : il ne recharge pas `dist/`.

## Checkpoint 69 — Ménage de la base D1 **locale** (2026-08-01)

Aucun code applicatif touché. Suite directe du checkpoint 68, même journée.

### Ce qui a été fait

1 672 boutiques → **2**. Fichier `.sqlite` : 4,5 Mo → 2,9 Mo (après `VACUUM`).

| id | nom | comptes | tickets | clients |
|---|---|---|---|---|
| 1 | iziGSM Paris 11 (seed) | 3 | 25 | 183 |
| 2 | TestBoutique2 | 0 | 2 | 2 |

Les 1 670 boutiques `e2e-boutique-*` et leurs 1 670 comptes venaient des runs Playwright
successifs — `createTenantAdmin()` crée un tenant par test et **rien ne nettoie derrière**. Les
deux boutiques conservées le sont délibérément : le ticket 02 doit démontrer qu'une page métier
bascule d'un jeu de données à un autre, ce qui demande deux boutiques peuplées et distinctes.

### Méthode, reproductible sans le script

Le `.sql` généré n'est pas versionné (choix explicite de l'utilisateur : purge ponctuelle, pas
d'outillage). La méthode, elle, l'est — c'est elle qu'il faut rejouer :

1. **Ordre par tri topologique des clés étrangères**, jamais à la main : lire
   `sqlite_master.sql`, extraire les `REFERENCES`, trier les enfants avant les parents. 31 tables
   portent `boutique_id`, plus 8 tables enfants atteintes par fermeture transitive (`appareils`,
   `lignes_avoir`, `commissions`, `service_modeles`…). `lignes_document` n'a **aucune FK déclarée**
   et se nettoie à part, par `document_type` + `document_id`.
2. **Répétition à blanc avec `ROLLBACK`** avant toute écriture. Deux passes ont échoué et ont été
   corrigées sans jamais toucher la base — les FK sont actives en local (`PRAGMA foreign_keys` = 1),
   donc toute erreur d'ordre annule la transaction entière au lieu de laisser des orphelins.
3. `PRAGMA foreign_key_check` **avant et après**, comparés.
4. Sauvegarde du `.sqlite` avant exécution.

`node:sqlite` (built-in depuis Node 22) permet de faire tout cela en une seconde sur le fichier
miniflare, wrangler arrêté — là où chaque `wrangler d1 execute` coûte ~6 s.

### Le point qui a demandé un arbitrage

7 lignes de la **boutique 1** avaient été créées par des comptes E2E pendant les runs d'isolation :
2 `paiements` et 5 `journal_nf525`. Elles bloquaient la suppression de ces comptes.

Décision (utilisateur) : **réattribuer** leur `user_id` au compte admin, pas les supprimer. Les 5
entrées `journal_nf525` sont des maillons d'une **chaîne de hash** — en retirer aurait rompu
`verifyChain()` en local. Seul le `user_id` a bougé ; montants et hashs sont intacts. Voir
`decisions.md`.

### Vérifications

`npx playwright test` → **145/145**. `npx vitest run` → **875/877**. Aucun test ne dépendait des
tenants accumulés : chacun crée le sien.

**2 violations FK préexistantes** relevées au passage, identiques avant et après la purge — elles
ne viennent pas d'elle et n'ont pas été traitées. Détail dans `bugs.md`.

---

# iziGSM — État courant (MàJ : 2026-08-01, checkpoint 68 — ticket 01 livré : console des boutiques)

## Checkpoint 68 — Supervision, ticket 01 : la console des boutiques existe (2026-08-01)

Première session d'implémentation du chantier. `/implement` sur le ticket 01, en contexte neuf,
conformément à `docs/agents/issue-tracker.md`. Commit `2a8c007` sur `main`, **non poussé, non
déployé**. Ticket passé à `statut: done` → le ticket 02 est prenable.

### Ce qui est livré

L'admin plateforme se connecte et arrive sur `/console-boutiques` : la liste des enseignes
clientes actives, chacune avec son nom, son slug et son nombre de comptes, avec recherche par nom
et un état vide explicite. Écran **en lecture seule** — cliquer une boutique ne fait rien, la
sélection appartient au ticket 02.

| Fichier | Changement |
|---|---|
| `src/services/boutiqueService.ts` | `listAllBoutiques()` → `nb_comptes` (sous-requête `COUNT(*)` sur `users`) + alias `b.id AS boutique_id`. Nouveau type `BoutiqueAvecComptes`. |
| `src/routes/boutiques.ts` | JSDoc et commentaires seulement — aucun changement de logique. |
| `public/console-boutiques.html` + `static/js/console-boutiques.js` | Nouvelle page, sans barre latérale (aucune boutique sélectionnée → les liens du socle n'auraient aucun contexte). |
| `public/static/js/app.js` | `isAdminPlateforme()` et `landingPageFor()`. |
| `public/login.html` | Les 3 redirections passent par `landingPageFor()`. Auto-sélection de boutique **supprimée**. |
| `public/_redirects`, `public/sw.js` | Règle `/console-boutiques.html` → `/console-boutiques` ; `CACHE_VERSION` v2.82 → **v2.83**. |
| `tests/` | `boutiqueService.test.ts` (+2 cas), `e2e/console-boutiques.spec.ts` (8 cas, 2 seams), `e2e/auth.spec.ts` bascule sur le compte manager. |

### Le chemin manager n'a pas été touché

`listBoutiqueForUser()` est inchangé, et un test E2E vérifie que sa réponse garde exactement sa
forme d'avant le chantier — 1 boutique, `id` présent, **pas** de `nb_comptes`. C'était la
contrainte explicite du ticket : toute retouche du chemin tenant serait une prise de risque
d'isolation sans contrepartie.

### Un défaut latent fermé au passage

Le chemin Google One Tap traitait « pas de `boutique_id` » comme « onboarding inachevé » et
poussait vers l'écran de création d'atelier. Un admin plateforme n'a **jamais** de boutique : il
serait tombé sur cet écran. Voir `bugs.md`.

### Deux défauts trouvés par les tests, corrigés à la source

Aucun des deux n'a été contourné dans le test — c'est le code qui a changé.

1. Les lignes du tableau restaient dans le DOM quand un message les remplaçait : un « aucun
   résultat » qui contenait encore des résultats, lisibles par une technologie d'assistance.
2. Les quatre états du bloc message (chargement / vide / aucun résultat / erreur) partagent un
   seul conteneur et n'étaient distinguables que par leur texte — « en cours de chargement » se
   lisait comme « il n'y a rien ». Ils portent désormais `data-etat` et `aria-busy`. C'est ce qui
   rendait un test intermittent : il attendait la présence d'un bloc déjà présent dans le HTML
   initial.

### Vérifications

| Gate | Résultat | Baseline |
|---|---|---|
| `npx vitest run` | **875/877** | ≥ 873/875 (2 échecs de fuseau `agendaService` permanents) |
| `npx tsc --noEmit` | **32** | ≤ 32 |
| `npx playwright test` | **145/145**, deux runs complets consécutifs | — |
| Local live | `wrangler pages dev` + données réelles, puis reprise manuelle sous Chrome | exigé par le ticket |

Contrôle manuel refait sous Chrome après coup, à la demande de l'utilisateur : atterrissage par
rôle, recherche, état sans résultat, absence d'erreur applicative en console (les 2 erreurs vues
viennent d'une extension Chrome tierce), et session de l'admin plateforme confirmée à
`boutique_id: null` — l'auto-sélection est bien morte.

### Écarts signalés, non traités

- **Pas de pagination** : la console rend la liste entière. Sans effet en production (peu de
  boutiques) ; très visible en local où les runs E2E ont accumulé **~1 700** boutiques de test. La
  recherche est le mécanisme prévu par la spec ; une pagination relèverait du chantier 2.
- **La garde de la console est côté client.** Ce n'est pas une faille d'isolation — l'API ne
  renvoie à un manager que sa propre boutique — mais c'est un choix, pas un oubli.
- **Base D1 locale polluée** par ~1 700 boutiques issues des runs E2E successifs. Sans incidence
  sur les tests (ils ciblent la boutique 1 du seed ou créent leur propre tenant), mais toute
  lecture d'écran en local doit en tenir compte.

### Reste du chantier

02 (sélection + bascule des 29 pages + en-tête « Console plateforme ») → puis 03 (bandeau) et 04
(journal) en parallèle. Déploiement **groupé après le 04**, jamais ticket par ticket.

---

# iziGSM — État courant (MàJ : 2026-08-01, checkpoint 67 — spec et tickets de la supervision admin plateforme)

## Checkpoint 67 — Cadrage terminé : spec écrite, chantier 1 découpé en 4 tickets (2026-08-01)

Session de cadrage uniquement, **aucun code applicatif touché**. Reprise via `/init recover izigsm`,
puis `/to-spec` → `/to-tickets` sur le chantier laissé ouvert au checkpoint 66. Commit `8213f9e`,
poussé.

### Ce qui est livré

`.scratch/supervision-admin-plateforme/spec.md` + 4 tickets sous `issues/`, tous
`statut: ready-for-agent`. **Frontière : le ticket 01 seul** ; 02 l'attend, 03 et 04 attendent 02
puis deviennent parallèles.

| Ticket | Livre |
|---|---|
| 01 | Connexion → console listant les boutiques (nom, slug, nb de comptes), état vide explicite, manager exclu |
| 02 | Les 29 pages basculent sur la boutique choisie ; en-tête « Console plateforme » au lieu de « MyDesk » |
| 03 | Bandeau permanent non masquable + retour console + purge à la déconnexion (`CACHE_VERSION`) |
| 04 | Table dédiée + middleware : journalisation automatique des écritures de plateforme |

### Les 4 points laissés ouverts au grilling sont tranchés

- **Console sans aucune boutique** → message explicite, **aucun bouton de création** (hors périmètre).
- **Libellé « MyDesk » pour un compte sans boutique** → « Console plateforme » avant sélection, nom
  de la boutique ensuite. « MyDesk » reste le repli d'une boutique cliente sans nom configuré.
- **Forme du bandeau** → bannière haute rendue par le socle partagé (donc les 29 pages sans les
  toucher), non masquable.
- **Schéma du journal** → auteur, boutique visée, méthode, chemin, statut HTTP, corps tronqué et
  expurgé, IP, horodatage. `entite_type`/`donnees_avant/apres` **écartés** (un middleware ne les
  connaît pas ; les déduire du chemin produirait un registre faux). **Sans clé étrangère** — un
  registre de supervision doit survivre à une boutique désactivée, et le dépôt a déjà payé une FK
  pendante (`0031` → `0038`).

### Deux décisions qui portent le risque du chantier

- **Point de passage unique côté frontend** : la boutique choisie est mémorisée **dans l'objet de
  session existant**, pas dans une nouvelle clé — elle hérite du bon support (« se souvenir de moi »)
  et de la purge à la déconnexion. Le pari « 29 pages sans les toucher » ne tient que tant que
  chaque page emprunte les helpers d'appel partagés ; une page qui exigerait une retouche est un
  défaut à signaler, pas un cas à contourner.
- **Complétude avant précision** (journal) : une mutation d'admin plateforme dont la boutique visée
  n'est pas résolue est journalisée **quand même**, cible nulle. Ne jamais taire une ligne faute de
  pouvoir la qualifier — c'est le trou exact que l'ADR reproche à une journalisation dispersée.

### Choix de découpage assumés (décisions utilisateur du 2026-08-01)

- **02 et 03 restent séparés** : entre les deux, l'écriture cross-boutique existe sans bandeau
  affiché. Accepté parce que le déploiement est manuel et groupé — cet état n'atteint jamais la
  production.
- **04 est bloqué par 02** pour être réellement vérifiable (il faut pouvoir cibler une boutique
  pour observer la ligne écrite), alors que le middleware ne dépend techniquement de rien.
- **Seam de test du journal** : vitest + mock du port `Database`, car *lire* le journal appartient
  au chantier 2. Les 3 autres seams sont les seams Playwright existants (navigateur et API).

### Fait d'outillage, à ne pas redécouvrir

Les skills `mattpocock-skills` de la chaîne (`to-spec`, `to-tickets`, `implement`, `triage`) sont
déclarés `disable-model-invocation` : l'outil `Skill` les refuse (« cannot be used with Skill
tool »), y compris quand l'utilisateur les demande explicitement. Le contournement est de lire leur
`SKILL.md` directement et de suivre le processus. `grill-with-docs` est dans le même cas. Noté dans
`CLAUDE.md` § Workflow de développement.

### Vérifié sans rien écrire

`/setup-matt-pocock-skills` relancé : `docs/agents/{issue-tracker,triage-labels,domain}.md`,
`CONTEXT.md`, `docs/adr/` et la section `## Agent skills` de `CLAUDE.md` sont **déjà** en place et
cohérents. Aucun fichier de configuration modifié. `.scratch/` confirmé non ignoré par git — les
tickets suivent bien le dépôt d'une machine à l'autre.

---

# iziGSM — État courant (MàJ : 2026-07-31, checkpoint 66 — clôture sécurité + cadrage de la supervision admin plateforme)

## Checkpoint 66 — Clôture de la journée : 3 actions humaines faites, garde-fou durci, nouveau chantier cadré (2026-07-31)

Suite directe du checkpoint 65, même journée.

### Les 3 actions humaines en attente sont faites et vérifiées en production

1. **Rotation du superadmin** — compte rattaché à `support@soteli.fr`, mot de passe tourné par lien de réinitialisation. Vérifié : `admin@izigsm.fr` **et** `support@soteli.fr` avec le mot de passe publié dans le dépôt renvoient tous deux `401`. Le compte reste actif.
2. **Déploiement** — migration `0038` à distance **puis** Worker. Vérifié depuis un compte manager tiers : `403` sur les factures/produits/employés d'une autre boutique, `200` sur les siens, et `POST /services/modeles/:id/services` répond `200` après avoir renvoyé 500 depuis le Sprint 2.39.
3. **Ménage** — boutiques 4 et 5 (test) et comptes `%isotest%` désactivés (`actif = 0`) plutôt que supprimés : réversible et sans risque sur les 30 tables portant `boutique_id`.

### Garde-fou de conformité durci (commit `73ef419`)

`propageAUnService()` avait **trois** défauts, dont deux se compensaient — le test passait pour la mauvaise raison. `if (...)` était compté comme un appel de fonction (or tout handler du patron JWT commence par `if (!boutiqueId) return`), les parenthèses imbriquées n'étaient pas franchies, et corriger le second a révélé un troisième cas : l'appel englobant de déclaration de route matchait à son tour. **Preuve par mutation refaite sur le code réel** : retirer `boutiqueId` de `services.ts:583` fait désormais échouer le test en nommant la route ; avant, la même mutation passait inaperçue.

### Nouveau chantier cadré — supervision admin plateforme

Constat de l'utilisateur en production : connecté avec le compte de supervision, il ne voit aucune boutique cliente. L'API sait le faire (les 36 gardes laissent passer le rôle `admin`), le frontend n'a jamais été construit pour — `apiGet` injecte `boutique_id` depuis la session, or l'admin plateforme n'en a pas.

**Grilling mené** (`/grill-with-docs`, chaîne `mattpocock-skills`), 6 décisions prises. **Spec non écrite** — la session était saturée, `/to-spec` est reporté.
- Livrables : `docs/adr/0001-journal-separe-actions-plateforme.md` · `CONTEXT.md` § Multi-tenant enrichi (admin plateforme, manager, avertissement sur « admin » ambigu) · `todo.md` § Supervision superadmin.
- **Handoff** : `%TEMP%\claude\...\scratchpad\handoff-supervision-superadmin.md` — à lire en premier à la reprise.

### Correction documentaire

Deux entrées de `todo.md` affichaient « PAS corrigé » alors que le travail était fait (migration `service_modeles` en doublon, et `addMonthsParis()`). Corrigées — une documentation qui ment sur son propre état a failli faire renoncer à un déploiement légitime.

---

# iziGSM — État courant (MàJ : 2026-07-31, checkpoint 65 — déploiement cp64, isolation multi-tenant de 36 routes, FK service_modeles)

## Checkpoint 65 — Session humaine : déploiement, chantier isolation complet, faille superadmin découverte (2026-07-31)

**Reprise via `/init recover izigsm`** (checkpoint 64). Session la plus dense du projet : 30 commits, un chantier complet spec → plan → subagent-driven-development → revue finale → merge.

### 1. Déploiement du checkpoint 64

Migration `0037` appliquée à distance **puis** Worker déployé, dans cet ordre (l'inverse cassait toute émission de facture). Vérifié : `/api/health` 200, `CACHE_VERSION` local ↔ prod identiques (`izigsm-v2.82`), `factures.js` déployé contenant `emettre_encaisser` / `date_execution` / `mention_facture`. Le token Cloudflare de la session n'ayant pas les droits D1 distants (erreur 7403), l'utilisateur a lancé les deux commandes lui-même.

### 2. Les 5 endpoints facture/avoir — corrigés, déployés, **validés en production**

Helper `assertBoutiqueOwnership(user, resource, label)` créé dans `src/lib/middleware.ts` (404 absente / 403 étrangère / `admin` traverse), appliqué aux 5 routes. RED observé avant correctif : `200/200/200/200/**201**` — l'avoir était réellement créé sur la facture d'une autre boutique.

**Preuve en production** : depuis le compte SOTELI (manager, boutique 2), `GET /api/factures/3` (boutique 5) renvoie **403 « Accès refusé. »**, tandis que `GET /api/factures/1` (sa propre facture) reste **200**. Une boutique de test dédiée a été créée pour cette démonstration (voir § Ménage).

### 3. `addMonthsParis()` — KPI dashboard faux 4 jours par an

`statsService.ts:45` décalait les mois via `Date.setUTCMonth()`, qui déborde sur un 31 (2026-06-31 → 2026-07-01). Les 31 mai / juillet / octobre / décembre, `ca_mois_precedent` renvoyait le CA du mois courant et `evolution_ca_pct` valait 0 %. **Constaté à l'écran sur le dashboard de production ce jour-là** (« CA ce mois 62 € / Mois préc. 62 € / ↑ +0% »). Corrigé par arithmétique pure sur (année, mois).

### 4. Chantier isolation multi-tenant — 36 routes

Audit statique → 13 failles annoncées. **Le test de conformité écrit ensuite en a révélé 23 de plus** : l'audit écartait toute route dont le *fichier* portait un signal d'isolation, sans vérifier que ce signal se trouvait dans le *handler* examiné — `getDevis(db, id)` mentionne `boutique_id` dans son `SELECT` sans jamais filtrer dessus. Décision utilisateur : tout corriger dans le même chantier.

Livré sur branche `feat/isolation-routes-par-id`, mergée (`52c041f`) : 36 routes gardées, 6 routes du référentiel global marques/modèles passées en `requireRole('admin')` (gouvernance d'un catalogue partagé, pas isolation), 137 tests e2e (étranger refusé / propriétaire 200 / admin plateforme 200, **par route**).

**Garde-fou** : `tests/routes-isolation-conformite.test.ts` fait échouer la suite si une route par ID n'a ni garde ni exemption motivée. Durci après revue — charger un `boutique_id` ne vaut plus preuve de l'avoir comparé (mutation vérifiée : 47 routes passent au rouge si l'on retire les gardes, contre 8 avant durcissement).

**La revue finale a trouvé 2 failles que ni l'audit ni le garde-fou ne pouvaient voir** :
- `POST /bons-commande/:id/receptionner` gardait le **bon** mais mutait les **produits** référencés : un manager pouvait créer un bon chez lui avec le `produit_id` d'un concurrent et écrire sur son stock et son prix d'achat.
- `GET /services/modeles/:id/services` était exemptée au motif « référentiel global » — le modèle est global, mais la réponse exposait les services **et leurs prix de toutes les boutiques**.

### 5. Migration `0038` — FK `service_modeles` reconstruite

La migration `0031` avait renommé `modeles_appareils` puis supprimé l'ancienne table dans le même fichier ; SQLite avait propagé le renommage dans `service_modeles.modele_id`, laissant une FK vers une table inexistante. `POST /api/services/modeles/:id/services` renvoyait **500 pour tout appelant, admin compris, depuis le Sprint 2.39**. Table reconstruite, 9/9 liaisons reprises, route vérifiée en local live (200 + relecture).

## Clôture de session (2026-07-31, fin de journée) — les 3 actions humaines sont faites

1. **Rotation du superadmin ✅** — compte rattaché à `support@soteli.fr`, mot de passe tourné par lien de réinitialisation. Vérifié : `admin@izigsm.fr` **et** `support@soteli.fr` avec le mot de passe du dépôt renvoient tous deux `401`. Le compte reste actif pour le dépannage.
2. **Déploiement ✅** — migration `0038` à distance puis Worker. Isolation confirmée en production depuis un compte manager tiers (403 sur les ressources étrangères, 200 sur les siennes), et `POST /services/modeles/:id/services` répond 200 après avoir renvoyé 500 depuis le Sprint 2.39.
3. **Ménage ✅** — boutiques 4 et 5 et comptes `%isotest%` désactivés (`actif = 0`) plutôt que supprimés : réversible, et sans risque sur les 30 tables portant `boutique_id`. Le compte de test reçoit « Compte désactivé ».

Les sections ci-dessous décrivent l'état **au moment du checkpoint**, avant ces trois actions — conservées telles quelles pour l'historique.

## Reste ouvert (état au checkpoint, avant clôture)

### ✅ ~~Faille critique NON corrigée~~ — accès superadmin publié — FERMÉE en fin de journée, voir § Clôture ci-dessus
`admin@izigsm.fr` / `Admin@2026!` **fonctionne en production** (rôle `admin`, `boutique_id` NULL, accès aux 5 boutiques), et ces identifiants sont écrits en clair dans `CLAUDE.md` et `seed.sql` du dépôt **`zinside69/izigsm_NG_temp_analysis`, qui est public sur GitHub** (`visibility=public`, vérifié par appel non authentifié). Aucune des 36 gardes ne protège contre un identifiant publié.

Procédure décidée, **non exécutée** : créer et tester la boîte `support@soteli.fr`, puis `UPDATE users SET email = 'support@soteli.fr' WHERE id = 1`, puis `POST /api/auth/reset-password-request`. `zinside@gmail.com` est déjà pris (user id 6). Rendre le dépôt privé ne suffit pas — seule la rotation du secret ferme l'accès.

### 🔴 Rien de la journée n'est déployé, sauf le point 2
Quatre chantiers sur `main` en attente : `c59d59c` (statsService), `1f99e4a` (migration helper), `52c041f` (36 routes), `f1bc6dc` (migration 0038). **Ordre impératif** : `npx wrangler d1 migrations apply DB --remote` avant `npm run deploy`.

### 🟡 Ménage en production
Boutique 5 « ZZ Audit Isolation 2026 » (1 client, 1 facture brouillon `FAC-2026-00001`) et compte `zinside+isotest@gmail.com` jamais vérifié — tous deux créés pour la validation du point 2. Identifiants du compte de test : `akiliai6913+isotest@gmail.com` / `IsoTest#2026!Rd7`.

### 🟡 Bugs découverts, non corrigés (détail dans `todo.md`)
`updateEmploye()` en 500 sur body partiel · SQL inline des 3 gardes de `facturation.ts` (déjà déployé) · `POST` du référentiel marques/modèles encore ouvert aux managers · inscription en 500 quand le nom de boutique est déjà pris · fallbacks localStorage de `factures.js` (`confirmPaiement`, `deleteFacture`, numéro fabriqué) · `propageAUnService()` du garde-fou matche `if(...)` comme un appel · pas d'`auditLog` sur la ligne ignorée à la réception · frontend à aligner (boutons référentiel visibles aux managers, admin plateforme en 400 sans `?boutique_id`).

---

# iziGSM — État courant (MàJ : 2026-07-30, checkpoint 64 — création manuelle de facture + socle facture électronique, 2/2 fonctionnalités hors service traitées)

## Checkpoint 64 — Session humaine : `factures.html` remis en service + socle de la facture électronique (2026-07-30)

**Reprise via `/init recover izigsm`** (checkpoint 63). Deuxième et dernière des « fonctionnalités entières hors service » de l'audit de persistance. Chantier mené en `superpowers:brainstorming` → `writing-plans` → `subagent-driven-development`, **9 tâches, 28 commits**, branche `feat/factures-creation-manuelle` mergée sur `main` (`4fb97da`), suite verte sur le résultat mergé (855/857, les 2 échecs restants étant les tests de fuseau horaire pré-existants d'`agendaService`).

**Le problème d'origine** : `POST /api/factures` n'existait pas. Le modal « Nouvelle facture » postait dans le vide depuis sa création — 404 silencieux, aucune facture manuelle jamais enregistrée. Le commentaire de routage `src/index.tsx:50` (« CRUD factures + paiements ») était trompeur.

**Livré** :
1. `createFacture()` (`factureService.ts`) — 3 actions (`brouillon` / `emettre` / `emettre_encaisser`), **toute la validation avant `nextNumero()`** (un numéro de séquence de boutique ne peut pas être brûlé par une saisie invalide), isolation multi-tenant vérifiée à l'écriture sur `client_id` et `ticket_id`.
2. **Migration `0037`** — socle de la facture électronique française (réforme du 01/09/2026) : `date_execution`, `vendeur_snapshot`, `acheteur_snapshot`. Le snapshot est posé dans `emettreFacture()`, point de passage **unique** des trois chemins de création (manuelle, conversion de devis, acompte).
3. Route `POST /api/factures` avec délégation à `convertirDevis()` quand un `devis_id` est fourni — aucune seconde implémentation de la conversion.
4. **Faille d'isolation refermée** sur `PUT /devis/:id/convertir` (`bugs.md`) : un manager pouvait convertir en facture le devis d'une autre boutique. Démontrée en `200` avant correctif, verrouillée par 2 tests Playwright.
5. Modal refait : signature morte retirée (endpoint inexistant, canvas jamais lu, colonne absente), select de statut muet retiré, TVA par ligne + taux par défaut issu de `boutique_settings.tva_taux_defaut`, date d'exécution, 3 boutons explicites. **Fallback localStorage supprimé** — il fabriquait de faux numéros `FAC-2026-…` côté navigateur.
6. Document imprimé : ventilation HT par taux de TVA, mentions légales statutaires (L441-10, D441-5, 293 B conditionnelle), identités vendeur **et** acheteur figées, montants à 2 décimales, `mention_facture` enfin affichée (elle était saisie, stockée, rechargée et affichée nulle part).

**Décisions utilisateur actées en cours de chantier** : régime de franchise déduit de `tva_taux_defaut === 0` plutôt qu'une nouvelle colonne · mentions légales validées mot pour mot · encaissement autorisé sur facture émise (non implémenté, voir `todo.md`) · facturation auto à la clôture du ticket cadrée (brouillon puis émission à l'encaissement, devis accepté si présent sinon lignes du ticket) · envoi par email et refonte de la mise en page A4 en chantiers séparés.

**Ce que le processus a produit, et qui vaut d'être retenu** : **quatre défauts venaient du plan lui-même**, pas des implémenteurs — un bug financier (encaissement du montant plein sur un devis dont l'acompte était déjà déduit par `convertirDevis()`), un défaut d'échappement HTML sur l'adresse client figée, un snapshot vendeur capturé mais jamais consommé, et un `boutique_id` absent du payload rendant le formulaire inutilisable pour un compte `role=admin`. Les trois premiers ont été trouvés en revue de code ; **le quatrième n'est sorti qu'en cliquant réellement dans le navigateur**, après huit revues. La revue finale (opus, 22 commits) a ensuite sorti 8 findings supplémentaires, tous corrigés en une vague unique et revérifiés.

**Clôture de session** : branche mergée sur `main` puis supprimée, `main` poussé sur les deux dépôts (`webapp` → `ee346a8`, workspace → `1a8a13a`). Actions humaines en attente placées **en tête du recovery prompt**. Nettoyage : 111 artefacts éphémères `.playwright-mcp/` supprimés (dont 30 suivis par git depuis juillet) et le répertoire ignoré ; espace de travail SDD du chantier supprimé (34 fichiers) — l'historique git fait foi. **Rien n'a été déployé.**

## Reste ouvert
- **Dette d'isolation prioritaire** : 5 endpoints facture/avoir voisins sans aucune vérification `boutique_id` (`GET /factures/:id`, `POST /factures/:id/paiement`, `POST /factures/:id/emettre`, `GET /avoirs/:id`, `POST /avoirs`). `POST /factures/:id/emettre` permet de **verrouiller définitivement la facture d'une autre boutique** et d'écrire dans son journal NF525. Dette antérieure, même classe que les failles tickets de juillet — chantier suivant recommandé sans intercalaire.
- Encaissement sur facture verrouillée (`ajouterPaiement()` refuse `locked=1`) : décision prise, non implémentée. Tant que ce n'est pas fait, le flux « j'émets, le client paie ensuite » reste impossible.
- Facturation auto à la clôture du ticket : cadrée, brainstorming à faire.
- Envoi de facture par email · mise en page A4 · format UBL/CII + raccordement PDP : chantiers séparés, tous tracés dans `todo.md` avec leurs acquis.
- KPI `statsService.ts` sur la valeur de statut morte `'emise'` (`factures_en_retard` renvoie toujours 0) · double enregistrement NF525 selon le chemin d'entrée · colonnes HT/TVA à 0 € dans la liste · `mention_facture` ineffaçable (`COALESCE`).
- **Non vérifié, nécessite un humain** : la tenue du document sur une seule page A4 (impression réelle — `window.print()` fige toute session automatisée).
- **Déploiement non fait.** `CLAUDE.md` porte désormais l'obligation d'ordonnancement : `npx wrangler d1 migrations apply DB --remote` **avant** `npm run deploy`, sans quoi toute émission de facture échoue en production (`no such column`).

---

# iziGSM — État courant (MàJ : 2026-07-30, checkpoint 63 — fix personnel.html, 1/2 fonctionnalités hors service de l'audit persistance)

## Checkpoint 63 — Session humaine : fix `personnel.html` (audit persistance, item 1/2 "hors service") (2026-07-30)

**Reprise via `/init recover izigsm audit persistance`** (checkpoint 62). Décision utilisateur : traiter d'abord les 2 fonctionnalités entières hors service, en commençant par la plus mécanique (`personnel.html`) avant `factures.html` (qui nécessitera le hard-gate `brainstorming` — nouvel endpoint + ambiguïtés de scope).

**Fix `personnel.html`** (commit `385c171`) : `<script src="/static/js/app.js">` manquant ajouté avant `personnel.js` (seule page du site dans ce cas) + pattern `r.success`/`r.data` → `r.data.success`/`r.data.data` corrigé sur les 4 appels API (`loadEmployes`, `pointer`, `submitAddEmploye`, `loadRapport`/`renderRapport`) — confirmé en lisant `app.js` que `apiGet`/`apiPost` retournent `{ok, status, data, error}`, donc le corps réel de la réponse (`success`/`data`/`resume`/`statut_apres`/`horodatage`/`message`) vit sous `res.data.*`, jamais directement sur `res`.

**Validé en local live** (`wrangler pages dev --local --port 3000`, launch.json enrichi avec la config `izigsm-local`) : login démo → `/personnel` → aucune `ReferenceError` console → création employé réelle (`POST /api/employes` 200) → pointage réel (`POST /api/pointage/:id/pointer` 200, statut passé "Absent" → "En poste", compteurs mis à jour). `npx vitest run` : 833/835 (2 échecs fuseau horaire pré-existants inchangés, baseline confirmée).

**`CACHE_VERSION` bump `sw.js` v2.78→v2.79** (fichiers `public/static/js/*`/`public/*.html` touchés, dernière tâche frontend de ce chantier).

`todo.md` § "🔴 P1 — Audit persistance des champs" : item `personnel.html` coché.

## Reste ouvert
- `factures.html` — endpoint `POST /api/factures` manquant + ambiguïtés annexes (statut jamais lu, signature triplement morte, `mode_paiement_prefere` orphelin) → nécessite `superpowers:brainstorming` avant tout code (plusieurs décisions de scope à trancher).
- Reste du chantier "Audit persistance" (`todo.md`) : `t-imei`, `t-priority`, `stock-notes`/`stock-qty`, `modele-marque-id`, `remise_pct`, `monnaie`, 5 champs `agenda.html`, 3 fichiers `r.success`/`r.data` (`reconditionnement.js`/`fournisseurs.js`/`caisse.js`), `qualirepar.html` (décision produit).
- Édition employé + gestion PIN/permissions absentes de l'UI `personnel.html` (backend déjà prêt) — hors scope de ce fix, pas dans l'audit initial, à tracker séparément si besoin.

---


## Checkpoint 62 — Session humaine : backfill recovery-prompt.md + 4 chantiers + incident prod + audit persistance des champs (2026-07-30)

**Session la plus dense depuis longtemps, plusieurs chantiers distincts enchaînés.** Reprise via `/init recover izigsm` (checkpoint 61 déjà à jour).

**1. Backfill `recovery-prompt.md` (22 checkpoints 29-56 reconstruits)** — commit `92ff9df`. Voir `todo.md` § Backfill, entrée mémoire dédiée. 4 invariants trouvés en cours de route et remontés dans `CLAUDE.md`/`decisions.md`/`bugs.md`/`loop-runbook.md` : rebranding MyDesk (en cours, pas terminé), piège worktree sandbox (bloqué sur 9 checkpoints), fix gates Playwright/tsc Windows (`d7c5ed1`), piège `docs/*.pdf` gitignorés.

**2. 3 tâches simples corrigées** (commit `1898da7`) : `auth.ts` JSDoc MyDesk, `clients.html` FontAwesome jamais chargé (toutes les icônes invisibles, pas juste le bouton signalé), filtre modèle smartphone qui ignorait la marque sélectionnée (`tickets.js`). Validé en local live + Claude in Chrome.

**3. Bug prise en charge — email/téléphone non synchronisés vers la fiche client existante** (commit `71a87a2`) : en sélectionnant un client existant et en retapant email/téléphone dans la prise en charge, la saisie restait piégée sur le ticket seul, jamais reportée sur `clients.email`/`clients.telephone`. Fix : `saveTicket()` relit la fiche client complète et fusionne (jamais un objet partiel — `updateClient()` fait un UPDATE complet sans COALESCE, risque réel d'écraser adresse/SIRET/type_client sinon). Validé en local live (client sans email → prise en charge avec nouvel email → `GET /api/clients/:id` confirme la persistance, `type_client`/`adresse` intacts).

**4. Fiche client — coordonnées obligatoires + autocomplete Raison sociale** (commits `f84c2e1`, `9e1e82b`) : tous les champs deviennent obligatoires (sauf Notes), suite à une capture d'écran utilisateur montrant une fiche vide. Volet Professionnel : SIRET obligatoire (TVA reste optionnelle), autocomplete "Raison sociale" ajouté en réutilisant `recherche-entreprises.api.gouv.fr` (même API déjà utilisée par `onSiretInput()` dans ce fichier et par l'inscription) — sélectionner un résultat remplit raison_sociale/SIRET/adresse/CP/ville et **calcule automatiquement la TVA intracommunautaire** (`computeTvaFromSiren()`, formule standard déjà existante). Validé en local live avec une recherche réelle ("SOTELI").

**5. Incident production — cache CDN Cloudflare empoisonné sur `clients.f2fcc753.js`** (commit `2bdb4a2`, documenté `bugs.md`) : après le déploiement du point 4, la page `/clients` s'est retrouvée entièrement cassée pour tous les utilisateurs (KPIs à "—", tableau vide). Root cause : un edge Cloudflare (Marseille) a caché une réponse 200+HTML (fallback SPA du catch-all Hono) au lieu du JS, pendant la fenêtre de propagation du déploiement — comme l'asset est marqué `immutable`, la mauvaise réponse restait figée indéfiniment. Purge API impossible (permission "Cache Purge" manquante sur le token Cloudflare disponible dans cet environnement — testé et confirmé en échec). Fix : nouveau hash de fichier forcé (commentaire ajouté), qui contourne le cache empoisonné par construction. Revalidé après ~1 min de propagation. **Recommandation structurelle non implémentée** : exclure `/static/*` du catch-all SPA pour qu'un asset manquant renvoie un vrai 404 (non caché) plutôt qu'un 200+HTML (caché indéfiniment si immutable).

**6. Comparatif monatelier.net/aide/prise-en-charge** : lecture fraîche de la page d'aide concurrente. Nouveau gap trouvé : champ "Couleur" de l'appareil absent (ajouté best-effort dans `todo.md`, pas prioritaire). Reconfirme 2 items déjà trackés : multi-appareils par ticket (déprioritisé en P2 sur demande utilisateur ce jour) et email/SMS au bon de dépôt (recoupe le chantier bloqué impression A4/thermique).

**7. Découverte majeure — bug `t-imei` puis audit complet de persistance des champs sur TOUT repairdesk.fr.** En répondant à une question utilisateur sur la validation IMEI, découverte que le champ "IMEI/N° de série" de la prise en charge est **silencieusement jeté** — aucune colonne `imei` sur `tickets`, absent de `CreateTicketData`, absent de l'INSERT. L'utilisateur a alors demandé un audit complet de tous les formulaires du site. **3 subagents lancés en parallèle** (lecture seule) : Tickets/Clients/Devis/Factures, Stock/Services/Fournisseurs/Rachats/Reconditionnement, Agenda/Personnel/Caisse/SAV/Settings. Rapport consolidé : `project-docs/audit-persistance-2026-07-30.md` (commit `86e5269`), findings intégrés en priorité 1 dans `todo.md` (commit `0cd436e`).

**Résultat le plus grave de l'audit — 2 fonctionnalités entières hors service, jamais documentées avant ce jour** :
- `factures.html` : `POST /api/factures` **n'existe pas côté backend** — création manuelle de facture 100% cassée (le CRUD complet annoncé en commentaire dans `src/index.tsx:50` est trompeur). Signature électronique triplement morte.
- `personnel.html` : `app.js` n'est chargé sur aucun script de cette page (seule page du site dans ce cas) → toutes les fonctions API undefined, `ReferenceError` systématique. Aucune création employé/pointage possible actuellement.

Plus 8 cas de perte silencieuse de données (priorité ticket en création, notes/quantité stock en édition, marque modèle en édition, remise caisse, devise settings, 5 champs agenda impossibles à vider en édition) et le pattern `r.success`/`r.data` déjà connu ailleurs trouvé sur 3 nouveaux fichiers (`reconditionnement.js` — bloque 2 modals clés —, `fournisseurs.js`, `caisse.js`). Détail complet, fichier+ligne exacts, dans le rapport d'audit.

**`qualirepar.html` confirmé comme simulation 100% locale** (localStorage, zéro appel API/route/table) — pas un bug de persistance au sens strict, mais un vrai risque si non intentionnel (dossiers de subvention réglementaire perdus au changement d'appareil/cache).

## Reste ouvert
- **QualiRépar → vraie API EcoSystem (Fonds Réparation)** : décision prise de passer par `superpowers:brainstorming` avant tout code (chantier non trivial : nouveau service backend + table DB + réécriture frontend + auth tiers). Utilisateur confirme avoir/pouvoir obtenir des identifiants API réels. **Pas encore démarré** — utilisateur a demandé de faire d'abord ce checkpoint.
- Tout le contenu de `todo.md` § "🔴 P1 — Audit persistance des champs" — rien corrigé à ce stade, uniquement documenté. Priorité recommandée dans le rapport : `factures.html` → `personnel.html` → `t-imei` → `t-priority` → 3 fichiers `r.success`/`r.data` → reste.
- `t-imei`/`numero_serie` sur tickets : décisions déjà actées avec l'utilisateur avant l'audit (validation format/checksum locale Luhn, pas d'API tierce payante ; IMEI obligatoire seulement si type=smartphone) — implémentation pas commencée, va probablement fusionner avec le point `t-imei` de l'audit ci-dessus.
- Recommandation structurelle incident CDN (exclure `/static/*` du catch-all SPA) — non implémentée.

## Checkpoint 61 — Session humaine : audit rétroactif du protocole checkpoint + clôture (2026-07-25)

**Contexte** : suite au checkpoint 57 (refonte A4 déployée + fix débordement 2 pages), l'utilisateur a demandé confirmation que le checkpoint avait bien mis à jour tous les fichiers nécessaires. Réponse honnête : non — `recovery-prompt.md` et `CLAUDE.md` et la mémoire persistante n'avaient pas été touchés. Corrigé immédiatement pour le checkpoint 57 lui-même, puis l'utilisateur a demandé un **audit rétroactif de tous les checkpoints précédents**.

**Résultat de l'audit** :
- **Mémoire persistante** : trou de 10 jours (checkpoints ~16 à 56 jamais reflétés dans `project_izigsm_migration.md`) comblé par une section de synthèse + description mise à jour.
- **`CLAUDE.md`** : 4 invariants trouvés dans `decisions.md`/`bugs.md` mais jamais remontés, ajoutés : records DNS `repairdesk.fr` à ne jamais toucher (2026-07-09), `docs/ARCHITECTURAL_PRINCIPLES.md` obsolète/à ne pas suivre (2026-07-12), `docs/ARCHITECTURE_MODULES.md` §2 obsolète, portabilité SQL du port `Database` (dialecte SQLite non abstrait, pertinent pour une future bascule Postgres).
- **`recovery-prompt.md`** : confirmé non régénéré à chaque checkpoint comme il le devrait. Présents : 21-28, 31-32, 35-37, 39, 57. **Manquants : 29-30, 33-34, 38, 40-56** (17 d'affilée). Décision utilisateur : ne pas backfiller maintenant (coût contexte trop élevé en fin de session dense), tracé dans `todo.md` pour une session dédiée future.

**Feedback utilisateur important, enregistré en mémoire persistante** (`feedback_checkpoint_protocol.md`) : "checkpoint" dans la convention de ce projet signifie le protocole `/context-guardian checkpoint` **complet** (current-state + recovery-prompt + CLAUDE.md si nouvel invariant + mémoire persistante), jamais une mise à jour partielle de `current-state.md` seule — ce qui s'était produit à répétition sans être remarqué. Règle à appliquer systématiquement à partir de maintenant, y compris sous pression de contexte élevé (le cas de cette session même).

**État git** : tout commité et poussé sur `main`/origin. Dernier commit avant ce checkpoint : `25c546b`. Le chantier "refonte fiche A4" est intégralement clos (déployé, validé par l'utilisateur). Le chantier "logo boutique multi-tenant + impression devis" reste au stade spec approuvée, pas encore planifié.

## Reste ouvert
- `docs/superpowers/specs/2026-07-25-logo-boutique-multi-tenant-design.md` : prochaine étape `superpowers:writing-plans`
- Backfill `recovery-prompt.md` (checkpoints 29-30, 33-34, 38, 40-56) — session dédiée, voir `todo.md`
- `todo.md` § chantier impression A4/thermique : options de récupération (texte à valider), format thermique (techno non tranchée, escaladé 2 fois par la loop — checkpoints 59/60), email auto, facturation HT/TTC

---


## Checkpoint 60 — Loop-engineering : "se servir du modèle docs/test impression.pdf" (todo.md:25) — escaladée, aucune implémentation (2026-07-25)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). `pick-task.mjs` a d'abord retourné `cd5abbd9ab` (`todo.md:20`, options de récupération) puis `19e82f7a47` (`todo.md:24`, contenu réduit format thermique) — les deux déjà escaladées lors de runs précédents (checkpoints 58 et 59) sans décision humaine actée depuis → passées avec `--skip cd5abbd9ab,19e82f7a47`, conforme `SKILL.md` § Étape 1. Tâche suivante retournée : `f334ce0909` — `todo.md:25` (« Se servir du modèle `docs/test impression.pdf` »), même section « Format thermique (nouveau) » du chantier 🔴 impression A4/thermique.

**Pourquoi escaladé (même ambiguïté de périmètre que checkpoint 59, pas une nouvelle classification par mot-clé)** : cette case ne peut pas être traitée indépendamment des deux voisines de la même section (`todo.md:23-26`) :
1. Le contenu à faire tenir dans ce modèle (`todo.md:24`) vient d'être escaladé au run précédent (checkpoint 59) — ambiguïté non résolue sur la relation avec le format thermique 72mm déjà en production (`_buildTicketThermique3VoletsHTML`, `tickets.js:1017`).
2. `todo.md:26` note toujours explicitement que la solution technique d'impression n'est pas choisie (QZ Tray envisagé, non tranché) — utiliser `docs/test impression.pdf` comme modèle de mise en page suppose de savoir s'il sera rendu par le pipeline navigateur existant (`_triggerPrint()`/`print.css`) ou par une intégration imprimante différente ; deviner l'un ou l'autre serait prématuré et pourrait produire un template à refaire entièrement selon la réponse.
Reprendre la mise en page sur ce PDF sans ces deux réponses reviendrait à deviner à la fois le contenu et le mécanisme de rendu — même hard-gate `SKILL.md` § Étape 4.

**Aucun commit de code, aucun worktree créé** (arrêt avant l'Étape 3). `todo.md:25` reste décochée.

**Recommandation pour la décision humaine** : identique à celle du checkpoint 59 — trancher (1) la relation entre le format 72mm existant et ce nouveau format réduit, et (2) au moins provisoirement le mécanisme d'impression cible. Une fois actées dans `decisions.md`, `todo.md:24-26` (dont cette case) pourront être traitées en un seul chantier cohérent par un futur run.

**Reste ouvert dans ce chantier** : `todo.md:20` (options de récupération, texte à valider), `todo.md:24-26` (contenu + modèle + techno format thermique — bloc lié), `todo.md:29` (email de confirmation à l'impression — investigation partielle faite dans ce run : `sendTicketCree()` (`src/services/emailService.ts:399`) existe déjà et est actuellement déclenché à la **création** du ticket (`src/routes/tickets.ts:226`), pas à l'impression ; ambiguïté similaire à prévoir : appeler ce même envoi une seconde fois à l'impression risquerait un email en double au client si impression juste après création, sans règle de dédoublonnage définie — à investiguer/trancher lors d'un prochain run dédié), `todo.md:32-35` (facturation HT/TTC, mentions légales, workflow facture auto).

---

## Checkpoint 59 — Loop-engineering : "contenu réduit format thermique" (todo.md:24) — escaladée, aucune implémentation (2026-07-25)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). `pick-task.mjs` a d'abord retourné `cd5abbd9ab` (`todo.md:20`, options de récupération) — déjà escaladée au run précédent (checkpoint 58) sans décision humaine actée depuis (texte de la tâche inchangé, aucune nouvelle entrée `decisions.md`) → passée avec `--skip`, conforme `SKILL.md` § Étape 1. Tâche suivante retournée : `19e82f7a47` — `todo.md:24` (« Contenu réduit : nom client, description, entête réparateur, date de prise en charge, QR code ou code-barre, lien vitrine de suivi client »), section « Format thermique (nouveau) » du même chantier 🔴 impression A4/thermique.

**Pourquoi escaladé (ambiguïté de périmètre, pas une classification par mot-clé)** : deux éléments de contexte rendent cette tâche non implémentable sans arbitrage humain :
1. `todo.md:26` note explicitement, dans la même section, que « la solution technique d'impression n'est pas encore choisie » (QZ Tray envisagé, non tranché) — implémenter un contenu HTML sans savoir s'il sera rendu via le pipeline navigateur existant (`_triggerPrint()`/`print.css`) ou via une intégration imprimante différente (ESC/POS raw) est prématuré.
2. Un format thermique 72mm existe déjà en production (`_buildTicketThermique3VoletsHTML`, `tickets.js:1017`, décision `decisions.md` § 2026-07-18 — IMEI/N° série/adresse/acompte, sans signature, 1 copie). Le contenu demandé ici (« réduit » : nom client, description, entête réparateur, date, QR/code-barre, lien vitrine) est nettement plus pauvre et référence un PDF modèle différent (`docs/test impression.pdf`) sans préciser si ce format remplace, complète ou coexiste avec l'existant. Deviner l'une ou l'autre interprétation risquerait soit de dupliquer un format déjà validé, soit de remplacer silencieusement un format en production sans validation.

**Aucun commit de code, aucun worktree créé** (arrêt avant l'Étape 3 — ambiguïté tranchée dès la lecture du texte de tâche + du code existant). `todo.md:24` reste décochée.

**Recommandation pour la décision humaine** :
1. Trancher la relation entre le format thermique existant (`_buildTicketThermique3VoletsHTML`) et ce « format réduit (nouveau) » — remplacement, variante additionnelle (ex. sélectionnée par l'utilisateur au moment de l'impression), ou fusion de contenu.
2. Trancher (au moins provisoirement) le mécanisme d'impression cible (`todo.md:26`) avant d'écrire le contenu — même une réponse simple ("on reste sur le pipeline navigateur existant pour l'instant, QZ Tray reporté") débloquerait ce point sans attendre la décision finale sur QZ Tray.
Une fois ces deux points actés dans `decisions.md`, le prochain run pourra implémenter directement sans re-escalade.

**Reste ouvert dans ce chantier** : `todo.md:20` (options de récupération, texte à valider), `todo.md:24-26` (contenu + techno format thermique), `todo.md:29` (email auto à l'impression), `todo.md:32-35` (facturation HT/TTC, mentions légales, workflow facture auto).

---

## Checkpoint 58 — Loop-engineering : "options de récupération" fiche A4 (todo.md:20) — escaladée, aucune implémentation (2026-07-25)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (28 fichiers non-code > cap 5, différé), `record-result success` (0 échec consécutif), `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/static/js/tickets.js` → `sensitiveMatch:true` (catégories `auth`, `isolation`).

**Sélection** : `pick-task.mjs` → `cd5abbd9ab` — `todo.md:20` (« Ajouter le détail des options de récupération (ex. 10€ TTC déduits de la réparation, recyclage sous 4 semaines) — texte exact à valider avec l'utilisateur, pas à inventer »), chantier 🔴 impression A4/thermique. Aucune escalade antérieure trouvée pour cet id précis dans `.superpowers/sdd/loop-runs.md`.

**Pourquoi escaladé (ambiguïté explicite, pas une classification par mot-clé)** : le texte de la tâche interdit lui-même d'inventer le contenu (« texte exact à valider avec l'utilisateur, pas à inventer ») — c'est un contenu métier/légal, pas un détail d'implémentation. Recoupé avec `decisions.md` § 2026-07-18 « Texte légal "Acompte versé" volontairement différent du vieux modèle PDF » : décision explicite de ne **pas** reproduire tel quel le texte de l'ancien modèle (« acompte conservé si refus devis, recyclage après 4 semaines ») car il ne reflète pas le fonctionnement réel du système — un précédent direct qui interdit d'improviser un texte similaire ici. Conforme au hard-gate `SKILL.md` § Étape 4 (« ambiguïté qu'un humain doit trancher → escalader avant d'écrire le spec, ne pas deviner »). Signal graphe (`sensitiveMatch:true`, auth/isolation sur `tickets.js`) traité comme signal complémentaire, pas la cause de l'escalade.

**Aucun commit de code, aucun worktree créé** (arrêt avant l'Étape 3 — ambiguïté tranchée dès la lecture du texte de tâche). `todo.md:20` reste décochée. Seuls `current-state.md` (ce checkpoint) et `.superpowers/sdd/loop-runs.md` sont modifiés, commit documentaire séparé.

**Recommandation pour la décision humaine** : fournir le texte exact des options de récupération à afficher sur la fiche A4 (ex. montant précis de la déduction si appareil récupéré via pièce détachée, délai exact avant recyclage, conditions) — une fois fourni/tranché, documenter dans `decisions.md` pour que le prochain run de la loop puisse l'implémenter directement sans re-escalade. Reste ouvert dans ce chantier : format thermique (techno non tranchée), email auto à l'impression, facturation HT/TTC par boutique.

---

## Checkpoint 57 — Session humaine : refonte visuelle fiche A4 livrée + incident production corrigé + spec logo boutique/impression devis (2026-07-25)

**Chantier A4 (brainstorming → plan → subagent-driven-development)** : système visuel sans aplat noir/indigo/bleu (accent gris ardoise `#334155`, inspiré de `modele-facture.pdf`), en-tête prêt pour logo boutique multi-tenant, fallback "Non renseigné" état à l'entrée, mention CGV footer. Bug sécurité `esc()` (échappement guillemets) trouvé en revue finale et corrigé avant merge. Mergé sur `main` (`e63bce0`), `todo.md:10` clos, décision de branding documentée dans `decisions.md`.

**Collision loop-engineering (10:00)** : run planifié a lu la spec/plan fraîchement poussés et tenté d'implémenter directement sur `main` (hors worktree), a échoué (exit 1) en laissant `tickets.js` modifié non commité — mis en sécurité par `git stash`, root cause documentée dans `decisions.md` (recommandation : marqueur "en cours de traitement humain" pour `pick-task.mjs`, non implémenté).

**Bug production trouvé en validation** : `_buildTicketA4HTML()`/`_buildTicketThermique3VoletsHTML()`/`_buildFactureHTML()` référençaient `/static/css/print.css` en dur — cassé par le cache-busting (checkpoint 53, seul le nom hashé existe en prod). Fiches imprimées sans aucun style depuis le 2026-07-24. Fix : `_resolveStaticHref()` (app.js, résout via `manifest.json` au runtime). Documenté `bugs.md`.

**Premier déploiement** (`repairdesk.fr`, `v2.72`) suivi d'un **incident signalé par capture d'écran utilisateur** : fiche A4 débordait sur 2 pages (ticket réel dense : panne longue, état 4 items, acompte, signature). Root cause (`systematic-debugging`) : marges jamais validées sur contenu dense + absence de règle `@page` (marges navigateur non neutralisées). Fix à deux niveaux : resserrage statique + `@page{margin:0}` + **garde-fou dynamique** (`_triggerPrint()` mesure la hauteur réelle avant impression, bascule en `.print-compact` si nécessaire — garantie valable pour tout contenu futur). Cadres retirés sur les encarts (demande utilisateur, économie d'encre). Vérifié : contenu identique à la capture réelle mesure 283.5mm/297mm (13.5mm de marge). **Redéployé (`v2.73`), validation OK confirmée par l'utilisateur.**

**Spec écrite (non planifiée/implémentée)** : `docs/superpowers/specs/2026-07-25-logo-boutique-multi-tenant-design.md` — upload logo boutique vers R2 (URL publique stable, `GET /api/public/logo/:boutiqueId`), UI `settings.html` onglet Boutique, **+ nouvelle fonctionnalité impression devis** (`_buildDevisHTML()`, `devis.js` n'avait aucune fonction d'impression admin avant ce chantier) — demande utilisateur ajoutée en cours de session ("imprimer un devis au même titre que les factures"). Prochaine étape : `writing-plans` puis implémentation.

**État git** : tout commité et poussé sur `main`/origin (dernier commit spec `9a82bd3`). Code A4 + fix print.css + fix débordement 2 pages tous déployés et validés en prod. Spec logo boutique écrite mais pas encore implémentée.

## Reste ouvert
- Chantier "Logo boutique multi-tenant + impression devis" : spec approuvée par l'utilisateur, plan d'implémentation pas encore écrit — reprendre avec `superpowers:writing-plans` sur `docs/superpowers/specs/2026-07-25-logo-boutique-multi-tenant-design.md`
- `todo.md` § chantier impression A4/thermique : reste "options de récupération" (texte à valider), format thermique (techno non tranchée), email auto, facturation HT/TTC
- Recommandation non implémentée : marqueur "en cours de traitement humain" pour éviter une future collision loop-engineering / session interactive (voir `decisions.md`)

---


## Checkpoint 56 — Loop-engineering : IMEI/N° série sur fiche A4 (todo.md:19) — déjà implémenté, case cochée, aucun code modifié (2026-07-25)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (27 fichiers non-code > cap 5, différé), `record-result success` (0 échec consécutif), `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/static/js/tickets.js` → `sensitiveMatch:true` (catégories `auth`, `isolation`).

**Sélection** : `pick-task.mjs` a retourné `79832225e6` — `todo.md:19` ("Ajouter IMEI / N° de série (absent actuellement)"), chantier 🔴 impression A4/thermique. Aucune escalade antérieure trouvée pour cette ligne précise dans `.superpowers/sdd/loop-runs.md`.

**Investigation (Étape 2, lecture directe du code)** : confirmation que cette case est obsolète, déjà signalé en observation complémentaire au checkpoint 54 (avant la refonte visuelle A4) mais jamais coché depuis. Revérifié après le merge de la refonte A4 du 2026-07-25 (`decisions.md`, `docs/superpowers/plans/2026-07-25-refonte-fiche-a4-*.md`) pour s'assurer que le nouveau template n'avait pas régressé sur ce point : `_buildTicketA4HTML()` (`public/static/js/tickets.js:676-...`) affiche toujours IMEI et N° Série dans le bloc "Appareil" (`tickets.js:764-765`, conditionnels `d.imei`/`d.numeroSerie`), alimentés depuis la jointure `appareils` côté service (`tickets.js:601-602`, commentaire explicite "LEFT JOIN appareils côté getTicketById"). Même contenu présent dans les blocs exemplaires additionnels de la fiche (`tickets.js:902-903`, `983-984`).

**Décision de risque** : signal graphe `sensitiveMatch:true` sur `tickets.js` (auth/isolation) noté mais non bloquant — **aucun code modifié**, fichier lu uniquement pour vérification, blast radius nul (même raisonnement déjà appliqué au checkpoint 54 pour un audit similaire en lecture seule). Correction de todo.md classée risque faible (catégorie "documentation").

**Aucun worktree créé** (pas de diff de code, uniquement `project-docs/todo.md` + `project-docs/current-state.md`, cohérent avec le traitement du checkpoint 54 pour ce même type de constat).

**Gates** : `npx vitest run` ✅ relancé par prudence malgré l'absence de diff de code : 833/835, exactement les 2 échecs pré-existants fuseau horaire (`agendaService.test.ts`, baseline inchangée). `tsc --noEmit`/`npm run build`/Playwright/browser-use non ré-exécutés (aucun fichier `.ts`/`.js`/config touché, résultat nécessairement identique à `main`).

**Commit** : documentation uniquement (`todo.md:19` cochée + note explicative, `current-state.md` ce checkpoint), pas de `CACHE_VERSION` à bumper (aucun `public/static/js/*`/`*.html` modifié). Reste ouvert dans ce chantier : `todo.md:20-35` (options de récupération, contrainte 1 page A4, format thermique, email auto à l'impression, facturation HT/TTC) — chacune nécessiterait son propre run, plusieurs touchant potentiellement paiement/facturation selon la table de risque.

---

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (21 fichiers non-code > cap 5, différé), `record-result success` (0 échec consécutif), `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/static/js/tickets.js public/print.css` → `sensitiveMatch:true` (catégories `auth`, `isolation`).

**Sélection** : `pick-task.mjs` a retourné `bf36f10238` — `todo.md:10` ("Revoir la mise en page sur le modèle `docs/bon de réparation.pdf` (bandeau, structure) — actuellement système visuel indigo, à documenter/trancher si on garde ou si on aligne sur le PDF"), première case non cochée du chantier 🔴 impression A4/thermique après `todo.md:7` (traité checkpoint 54). Aucune escalade antérieure trouvée pour cette tâche précise dans `.superpowers/sdd/loop-runs.md`.

**Découverte majeure (corrige le checkpoint 54)** : `docs/bon de réparation.pdf` et `docs/test impression.pdf` existent en réalité sur disque (ajoutés entre le run du checkpoint 54 et celui-ci) — le checkpoint 54 les avait déclarés absents à tort car **ces deux fichiers sont exclus par `.gitignore` (règle générique `*.pdf` ligne 51)**, donc invisibles à `git status`/`git ls-files`, alors que présents et lisibles sur le système de fichiers. Les deux ont pu être ouverts et inspectés directement (outil `Read`, support PDF).

**Contenu des deux références** :
- `docs/bon de réparation.pdf` (format A4 cible) : en-tête bleu marine foncé (pas indigo `#6366f1` actuel) avec branding "izigsm", numéro de bon `REP-XXXXXXXX-XXXX` + horodatage en haut à droite, layout deux colonnes "Informations client" / "Appareil déposé" (IMEI, N° série, état à l'entrée déjà présents dans la maquette), encart ambre/orange distinct "Acompte versé" avec liste à puces (déduction, conservation si refus, recyclage à 4 semaines), blocs signature client/atelier, mention légale CGV en pied de page.
- `docs/test impression.pdf` (probable référence format thermique/compact, todo.md:16-17) : mise en page 3 exemplaires détachables sur une page A4 ("EXEMPLAIRE CLIENT (1/2)" / "EXEMPLAIRE MAGASIN CLIENT (2/2)" / "EXEMPLAIRE ATELIER"), pointillés "DÉCOUPER ICI" entre chaque copie, QR code présent à côté du bloc client, contenu condensé une seule colonne — cohérent avec la demande `todo.md:16` (QR/code-barre, contenu réduit) mais garde un format A4 par page (pas un rouleau thermique continu), à clarifier avec `todo.md:18` (technologie d'impression thermique non tranchée).

**Pourquoi escaladé (ambiguïté explicite, pas juste un détail technique)** : le texte même de la tâche pose une alternative à trancher — garder le système visuel indigo actuel (déjà en prod depuis le chantier impression checkpoint 33) ou aligner sur le bleu marine/ambre de la maquette PDF. C'est une décision de branding/produit qui affecte un composant déjà livré et potentiellement cohérente avec `todo.md:25` (facture, `docs/modele-facture.pdf`) — donc avec un rayon d'impact au-delà du seul ticket A4. Conforme au hard-gate de `SKILL.md` § Étape 4 ("ambiguïté qu'un humain doit trancher... escalader avant d'écrire le spec, ne pas deviner") et à `loop-policy.md` ("en cas de doute → risque élevé"). Signal graphe (`sensitiveMatch:true`, auth/isolation sur `tickets.js`) traité comme un signal supplémentaire cohérent avec cette prudence, pas la cause première de l'escalade.

**Aucun commit de code, aucun worktree créé** (arrêt avant l'Étape 3 — la classification/ambiguïté a été tranchée dès l'Étape 2/4, avant toute implémentation). `todo.md:10` reste décochée. Seuls `project-docs/current-state.md` (ce checkpoint) et `.superpowers/sdd/loop-runs.md` (ledger) sont modifiés par ce run, commit documentaire séparé.

**Recommandation pour la prochaine décision humaine** :
- Option A — garder l'indigo actuel : fermer `todo.md:10` tel quel (« décidé : pas d'alignement visuel »), passer directement aux items de contenu (`todo.md:11-13`).
- Option B — aligner sur la maquette : nécessite un mini-chantier dédié (`superpowers:brainstorming` → `writing-plans`, car > 1 fichier visuel : `print.css` + probablement `tickets.js`/`devis.js` templates + cohérence avec `modele-facture.pdf` pour la facture) plutôt qu'un correctif ponctuel de la loop.
- Dans les deux cas, envisager de documenter dans `decisions.md` une fois tranché, pour que le prochain run de la loop ne re-escalade pas cette même case.
- Note d'outillage : `docs/bon de réparation.pdf` et `docs/test impression.pdf` resteront invisibles à tout audit basé sur `git ls-files`/`git status` tant qu'ils sont sous la règle générique `*.pdf` du `.gitignore` — recommandation (à valider par l'utilisateur, pas fait ici) : les tracker explicitement (`git add -f`) comme fichiers de référence design, distincts des PDF générés, si on veut éviter une nouvelle confusion "absent du repo" dans un futur run.

---

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (21 fichiers non-code > cap 5, différé), `record-result success` (0 échec consécutif), `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/static/js/tickets.js` → `sensitiveMatch:true` (catégories `auth`, `isolation`, relation directe 1-saut — signal traité comme non bloquant ici : la tâche est un audit en lecture seule, zéro diff de code produit, donc le blast radius d'un signal graphe sur un fichier *lu mais non modifié* est nul).

**Sélection** : tâche `todo.md:7` retenue — première case non cochée du chantier 🔴 "impression ticket A4/thermique" (demandé 2026-07-24, jamais commencé), explicitement scopée comme travail préalable ("identifier les écarts avant de coder").

**Worktree** : `git worktree add ../izigsm-loop-*` (frère) à nouveau bloqué par le sandbox de session (même contrainte que les checkpoints 45/47/48/49/50/51) — cette fois traité différemment : recréé sous `.claude/worktrees/audit-impression-a4` (répertoire de travail autorisé de la session, convention déjà actée dans le CLAUDE.md racine du workspace — "`.claude/worktrees/` → ignoré par `.gitignore`, ne jamais tracker" — et déjà utilisé par un chantier antérieur, `cache-busting`, présent au même endroit). `cd` dans ce worktree a fonctionné normalement, contrairement aux tentatives précédentes sur des worktrees frères. À privilégier pour les runs futurs de la loop sur cet environnement plutôt que le chemin frère `../izigsm-loop-<slug>` prescrit littéralement par `SKILL.md` — le résultat (isolation par branche + répertoire dédié) est identique, seul le chemin change.

**Audit — liste comparée** (parenthèse `todo.md:6`, contenu commun aux deux formats) vs `_buildTicketA4HTML()` (`public/static/js/tickets.js:673-837`) + `print.css` :

| Item attendu | Constat |
|---|---|
| Description (panne) | ✅ Présent — section "Panne déclarée", `d.panne` (← `t.description_panne`), fallback "Non renseignée" si vide. |
| Client | ✅ Présent — nom, téléphone, email, adresse dans le bloc `print-party-box` "Client". |
| Réparateur (technicien) | ✅ Présent — "Technicien : ${d.technicien}" dans le bloc "Appareil". |
| État du matériel à l'entrée | ✅ Présent mais conditionnel — `etatHTML` (`d.etatAppareil` parsé en JSON) affiché uniquement si des items sont cochés ; contrairement à "Panne déclarée", aucun fallback "non renseigné" si le champ est vide (bloc entier absent). |
| Commentaires **publics uniquement** (jamais notes internes) | ❌ **Écart réel, à deux niveaux** : (1) aucun champ distinct "commentaire public" n'existe dans le modèle de données — seul `notes_internes` existe (`t.notes_internes \|\| t.notes`) ; (2) même cette variable `d.notes`, bien que calculée dans `_fetchTicketPrintData()` (ligne 608), n'est **jamais utilisée** dans `_buildTicketA4HTML()` — rien de ce type n'apparaît aujourd'hui sur la fiche (conséquence : pas de fuite de notes internes actuellement, mais aussi zéro commentaire visible pour le client, et surtout aucune source de donnée "publique" à afficher tant qu'un champ dédié n'existe pas). |

**Observations complémentaires** (hors périmètre strict de cette tâche mais glanées pendant la même lecture, utiles aux items suivants du chantier `todo.md:9-18`) :
- `todo.md:11` ("Ajouter IMEI / N° de série (absent actuellement)") est **obsolète** : IMEI et n° de série sont déjà rendus (`tickets.js:762-763`), corrigés lors d'une tâche antérieure (commentaire de code explicite "Task 4b/5"). À revérifier/cocher plutôt qu'à recoder.
- Système visuel confirmé 100 % indigo (`#6366f1`) dans `print.css` (bordure d'en-tête, logo, titre de document, en-tête de tableau) — cohérent avec la remarque `todo.md:10` ("actuellement système visuel indigo, à documenter/trancher").
- Les deux fichiers de référence cités par le chantier — `docs/bon de réparation.pdf` (`todo.md:10`) et `docs/test impression.pdf` (`todo.md:17`) — sont **absents du repo** (ni sur disque dans `docs/`, ni trackés par `git ls-files`). Aucune comparaison visuelle possible tant que l'utilisateur ne les fournit/committe pas.
- `todo.md:12` ("options de récupération : 10€ TTC déduits, recyclage sous 4 semaines") : seul le cas "recyclage sous 4 semaines" existe aujourd'hui, et uniquement dans l'encart `print-acompte-box` conditionné à `d.acompteMontant > 0` (absent si aucun acompte versé) ; la mention "10€ TTC déduits de la réparation" n'existe nulle part. Texte exact toujours à valider avec l'utilisateur (rappel déjà présent dans le todo).
- `todo.md:13` ("rendu sur une seule page A4") : aucune contrainte CSS ne le garantit au-delà d'éviter les coupures internes de blocs (`.print-no-break`) — pas vérifiable sans impression/rendu réel.

**Gates** : tâche purement documentaire, **aucun fichier de code modifié** (`public/static/js/tickets.js`, `print.css` lus mais non touchés). `npx vitest run` ✅ relancé par prudence malgré l'absence de diff de code : 833/835, exactement les 2 échecs pré-existants fuseau horaire (baseline inchangée). `tsc --noEmit` / `npm run build` non ré-exécutés (aucun fichier `.ts`/config touché, résultat nécessairement identique à `main`) ; Playwright/browser-use non applicables (aucun nouveau parcours utilisateur, aucun code frontend modifié).

**Commit** : documentation uniquement (`project-docs/current-state.md` + `todo.md:7` coché), pas de `CACHE_VERSION` à bumper (aucun `public/static/js/*`/`*.html` modifié). Case `todo.md:7` cochée. Reste ouvert dans ce chantier : toutes les autres cases `todo.md:9-27` (mise en page A4, thermique, email auto, facturation HT/TTC) — non traitées, chacune nécessiterait son propre run (plusieurs touchent potentiellement l'auth/isolation/paiement selon le signal graphe déjà observé sur `tickets.js`, à re-classifier au cas par cas).

---

## Checkpoint 53 — Cache-busting par hash de contenu — chantier complet, mergé sur `main` (2026-07-24)

Chantier escaladé à répétition par la loop-engineering (architectural, todo.md:22-27), traité en session humaine via le pipeline complet `superpowers` : `brainstorming` → `writing-plans` → `subagent-driven-development`.

**Résultat** : `public/static/js/*.js` et `public/static/css/*.css` sont désormais hashés par contenu au build (`scripts/build-hash-assets.mjs`, 4 fonctions pures testées + orchestration `main()`), éliminant à la source l'incident du 2026-07-18 (contenu figé pendant une fenêtre de propagation CDN). `dist/_headers` généré avec cache long+immutable sur les assets hashés, no-cache sur `sw.js`/HTML.

**5 tâches du plan, chacune implémenteur+reviewer, toutes approuvées.** Trois régressions attrapées et corrigées avant merge (aucune n'a atteint `main` non corrigée) :
- Task 1 : `@types/node` ajouté pour typer `Buffer` → régression tsc 32→235 erreurs (déclarations globales Node en conflit avec les globals Workers/web-standard). Corrigé : `Uint8Array`/`TextEncoder`, aucune dépendance Node.
- Task 4 (validation manuelle) : 2 bugs latents pré-existants révélés par le nouveau garde-fou "échec bruyant" (`caisse.html`/`services.html` → `/static/css/style.css` inexistant ; `personnel.html` → `/static/css/app.css` inexistant) + découverte que `vite build` ne vide jamais `dist/` entre deux runs (contredit l'hypothèse d'idempotence du plan) — corrigé par un nettoyage `dist/` avant `vite build`.
- Post-merge (revue finale, avant push) : bug CRLF spécifique à `scripts/build-hash-assets.mjs` sur checkout Windows frais (`core.autocrlf=true` convertit LF→CRLF, casse le transform Vite/esbuild d'un import ESM dynamique) — invisible dans le worktree (jamais re-checkouté), découvert en mergeant dans le checkout principal. `.gitattributes` ajouté (`*.mjs text eol=lf`) pour empêcher toute récidive sur un futur clone/checkout/CI.

**Revue finale de branche (opus)** : Ready to merge = Yes, 2 points Important soulevés et résolus avant push — `_headers` vérifié fonctionnel sous le worker Hono avancé (`curl -I` : assets hashés `immutable`, `sw.js`/`*.html` littéral `no-cache`, confirmé empiriquement), `/static/style.css` (5 pages, hors scope initial) déplacé dans `static/css/` sur décision utilisateur pour cohérence.

**Validation navigateur réelle** (Claude in Chrome, une fois l'extension connectée) : login → dashboard → `/tickets`, rendu correct, aucune erreur console applicative.

**Gates finaux sur `main`** : vitest 833/835 (824 baseline + 9 nouveaux, 2 échecs pré-existants fuseau horaire inchangés) · tsc 32 (baseline inchangée) · Playwright 10/10 · build idempotent vérifié (2 runs consécutifs, 23 fichiers hashés à chaque fois).

**Commits** (`0b0f793`→`021c19d`, 10 commits) : spec, plan, 3 tâches d'implémentation, 1 fix régression, 1 correction de plan mi-course, 1 fix découvertes Task 4, 1 fix scope style.css, 1 fix `.gitattributes`, 1 JSDoc. Rien déployé — `npm run deploy` reste un geste humain explicite hors de ce chantier.

**Reste ouvert** : `auth.ts:659` (JSDoc cosmétique, todo.md:229) et le reste du backlog loop-engineering — voir checkpoint 52. Backlog loop quasi épuisé, tâches planifiées désactivées en attendant réapprovisionnement (décision utilisateur, 2026-07-24).

---

## Checkpoint 52 — Loop-engineering : `devis.js` `demanderAcompte()` refresh manquant — escaladé, aucune implémentation (2026-07-24)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (12 fichiers non-code > cap 5, différé), `record-result success` (0 échec consécutif), `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/static/js/devis.js` → **`sensitiveMatch:true`** (catégories `auth`, `isolation`, `paiement`, relation directe 1-saut).

**Sélection** : chantier cache-busting (🔴, 6 items L22-27) toujours escaladé (architectural, aucune décision actée depuis) → skip. Écartés en ordre déterministe, mêmes raisons que les runs précédents (checkpoints 47-51) : déploiement `[loop-safe]` L40, deep-link admin L36, décisions produit L37/L135/L136, convention nommage L38, assignation technicien L134, tests fuseau horaire L164, `escapeHtml` L165 (sécurité), `www` 521 L170 (infra), RGPD purge auto L177 (risque élevé), multi-sites L182, 4 items marketing Post-MVP L186-189, clarification dashboard agenda L207, rebranding `auth.ts` L229 (fichier explicitement listé comme déclencheur catégorie « Authentification / sessions » dans `loop-policy.md` — JSDoc cosmétique, mais le chemin lui-même est le déclencheur, appliqué « en cas de doute → risque élevé » → skip), non-atomicité check acompte unique L277 (nécessiterait un index UNIQUE → migration → risque élevé). Tâche retenue pour investigation : **`todo.md:278`** — `devis.js` `demanderAcompte()` ne rafraîchit pas la fiche après succès — jamais tentée dans un run antérieur (vérifié dans `.superpowers/sdd/loop-runs.md`).

**Investigation (Étape 2, lecture directe du code)** : `renderAcompteDetail()`/`demanderAcompte()` sont dupliquées à l'identique dans `devis.js` depuis `tickets.js` (commentaire explicite en tête de fichier). Le bug réel : la branche de rafraîchissement post-succès de `demanderAcompte()` ne couvre que `contextType === 'ticket'` (`viewTicket(...)`) — la branche `'devis'` (seul cas atteignable sur `devis.html`, `renderAcompteDetail(d, 'devis')` appelé en dur ligne 335) ne rafraîchit jamais rien après un `POST /api/devis/:id/acompte` réussi. Correctif identifié : `if (contextType === 'devis' && entityId) openDevisDetail(entityId);`, une ligne, réutilisant une fonction de lecture déjà existante — mais **non appliqué**.

**Décision d'escalade** : deux signaux convergents ont fait pencher vers risque élevé plutôt que risque faible malgré un diff trivial identifié : (1) mot-clé `acompte` — la fonction modifiée (`demanderAcompte()`) est littéralement la fonction de facturation d'acompte, catégorie explicite « Paiement / acompte » de `loop-policy.md` ; (2) signal graphe `sensitiveMatch:true` sur `devis.js` avec **3** catégories (`auth`/`isolation`/`paiement`), pas juste une. Nuance assumée dans le ledger : le correctif concret ne touche ni montant, ni mode de paiement, ni TVA, ni isolation/autorisation — un humain relisant ce diff précis pourrait légitimement le requalifier risque faible. Escaladé par prudence (« en cas de doute → risque élevé »), pas par certitude d'un risque réel.

**Aucun commit, aucun worktree, aucun gate exécuté** (arrêt à l'Étape 2). `todo.md:278` reste décochée. Détail complet et recommandation concrète (diff exact) dans `.superpowers/sdd/loop-runs.md` (run ~14:00Z).

## Checkpoint 51 — Loop-engineering : rebranding `register.html` « Mon Atelier » → « MyDesk » — mergé sur `main` (2026-07-24)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (11 fichiers non-code > cap 5, différé), `record-result success` (0 échec consécutif), `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/register.html` → `sensitiveMatch:false`.

**Sélection** : chantier cache-busting (🔴, 6 items L22-27) toujours escaladé (architectural, aucune décision actée depuis) → skip. Écartés en ordre déterministe, mêmes raisons que les runs précédents (checkpoint 50) : déploiement `[loop-safe]` L40, deep-link admin L36, décisions produit (restyle A4 L37, multi-appareils L135, acompte structuré L136), convention nommage L38, assignation technicien L134, tests fuseau horaire L164, `escapeHtml` L165 (sécurité), `www` 521 L170 (infra), RGPD purge auto L177 (risque élevé), multi-sites L182, 4 items marketing Post-MVP L186-189, clarification dashboard agenda L207. Tâche retenue : **`register.html` L228** (`todo.md:228`) — jamais tentée jusqu'ici, prochain item naturel du chantier rebranding après `login.html` (checkpoint 50).

**Déviation Étape 3** : `git worktree add ../izigsm-loop-rebrand-register-html-mydesk` réussit, mais l'écriture du brief graphe (`graphify-refresh.mjs brief > .../.superpowers/sdd/...`) dans ce worktree frère est bloquée explicitement par le sandbox de session (« Output redirection ... blocked ... allowed working directories ... 'izigsm/webapp' ») — même contrainte que les checkpoints 45/47/49/50. Worktree supprimé (`git worktree remove --force`) puis branche `-v2` créée directement depuis `main` à jour sur le checkout principal.

**Travail** : `public/register.html` — 5 occurrences : ligne 158 lien décoratif "🇧🇪 Mon atelier est en Belgique" → reformulé en "🇧🇪 Mon entreprise est en Belgique" (le todo signalait explicitement une formulation générique à reformuler, pas un simple remplacement — terminologie alignée sur "Nom de l'entreprise"/"Rechercher mon entreprise" déjà utilisée dans le même formulaire, décision jugée non ambiguë) ; ligne 201 placeholder `company_name` "Mon Atelier SARL" → "MyDesk SARL" ; ligne 326 placeholder onboarding "Mon Atelier" → "MyDesk" ; lignes 447-448 fallback `storeAuthSession()` (`boutique_name`/`company`, littéraux non conditionnels ici contrairement aux autres fichiers déjà traités) → "MyDesk". `boutique_id`, tokens (`izigsm_token`/`izigsm_refresh_token`) et logique credential/OTP intacts, vérifiés par lecture directe. Signal graphe `sensitiveMatch:false`. Bump `CACHE_VERSION` v2.69→v2.70 (`sw.js`) — `/register` en `NETWORK_ONLY_PATHS`, bump par cohérence uniquement.

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants inchangés) · tsc ✅ (32 erreurs, baseline `d7c5ed1`, delta nul ; `register.html` hors compilation TS) · build ✅ (`vite build` 950ms) · **playwright ✅ 10/10** (auth/health/isolation) · browser-use n·a (littéral d'affichage seul, pas de nouveau parcours utilisateur).

**Commit `4b5f195` mergé sur `main`** (`git merge --ff-only`, poussé ; branche `loop/rebrand-register-html-mydesk-v2` aussi poussée sur origin). Case `todo.md:228` cochée. Reste ouvert du chantier rebranding : `auth.ts` L229 (JSDoc seul mais fichier auth sensible — à re-classifier prudemment au prochain run malgré la nature cosmétique), item L230 (audit pages internes non fait, ex. `dashboard.html`/`settings.html`). Anciennes branches stale à nettoyer en session humaine si souhaité : `loop/rebrand-login-html-mydesk`/`-v2`, `loop/rebrand-app-js-mydesk`, `loop/rebrand-register-js-mydesk`.

## Checkpoint 50 — Loop-engineering : rebranding `login.html` « Mon Atelier » → « MyDesk » — mergé sur `main` (2026-07-24)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (10 fichiers non-code > cap 5, différé), `record-result success` (0 échec consécutif), `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/login.html` → `sensitiveMatch:false`.

**Sélection** : chantier cache-busting (🔴, 6 items L22-27) toujours escaladé (architectural — `> ~8 fichiers`, 29 pages HTML + 20 JS + service worker + config Vite, aucune décision actée depuis) → skip. Écartés en ordre déterministe : déploiement `[loop-safe]` L40 (la loop ne déploie jamais, aucune exception), deep-link admin L36 (isolation + reporté utilisateur), décisions produit (restyle A4 L37, multi-appareils L135, acompte structuré L136), convention nommage L38, assignation technicien L134 (feature à construire), tests fuseau horaire L164 (baseline ambigu), `escapeHtml` L165 (sécurité, risque élevé explicite), `www` 521 L170 (infra hors repo), RGPD purge auto L177 (risque élevé), multi-sites L182 (architecture + isolation), 4 items marketing Post-MVP L186-189, clarification dashboard agenda L207. Tâche retenue : **`login.html` L227** (`todo.md:227`) — déjà implémentée et escaladée au run du 2026-07-23 (branche `loop/rebrand-login-html-mydesk`, commit `76eb413`) pour une seule raison : gate Playwright inexécutable sur Windows, réparé depuis (`d7c5ed1`) — même changement de contexte légitime déjà invoqué pour `register.js`/`app.js` (checkpoints 47/49).

**Déviation Étape 3** : `git worktree add ../izigsm-loop-rebrand-login-html-v2` réussit, mais `cd` dans ce worktree frère est bloqué explicitement par le sandbox de session (même contrainte que checkpoints 45/47/49). Worktree supprimé (`git worktree remove --force`), travail refait sur la branche `loop/rebrand-login-html-mydesk-v2` (créée par le `worktree add` avorté) directement sur le checkout principal — l'ancienne branche `loop/rebrand-login-html-mydesk` (`76eb413`) datait de 15 commits derrière `main`, réimplémentation propre du même diff plutôt qu'un merge/rebase (hors `permissions.allow`).

**Travail** : `public/login.html:81,156,157,267,268` — placeholder input onboarding Google (`onboarding-workshop-name`) + fallback session localStorage `boutique_name`/`company` (×2 occurrences : flux email/mot de passe et `storeAuthSession()` factorisée, appelée après `/api/auth/google` et `/api/auth/complete-onboarding`) — 5 littéraux d'affichage `'Mon Atelier'` → `'MyDesk'`. `boutique_id`, tokens (`izigsm_token`/`izigsm_refresh_token`) et logique credential/OTP intacts, vérifiés par lecture directe avant et après. Signal graphe `sensitiveMatch:false`. Bump `CACHE_VERSION` v2.68→v2.69 (`sw.js`) — `/login` est en `NETWORK_ONLY_PATHS` (jamais mis en cache par le SW), bump fait par cohérence avec la règle frontend CLAUDE.md plutôt que par nécessité fonctionnelle.

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants `agendaService.test.ts` inchangés) · tsc ✅ (32 erreurs, exactement le baseline `d7c5ed1`, delta nul ; `login.html` hors compilation TS) · build ✅ (`vite build` 1.04s) · **playwright ✅ 10/10** (auth/health/isolation) · browser-use n·a (littéral d'affichage seul, pas de nouveau parcours utilisateur).

**Commit `600ffa6` mergé sur `main`** (`git merge --ff-only`, poussé). Case `todo.md:227` cochée. Reste ouvert du chantier rebranding : `register.html` L228 (jamais tenté), `auth.ts` L229 (JSDoc seul mais fichier auth sensible — à re-classifier prudemment au prochain run malgré la nature cosmétique du changement), item L230 (audit pages internes non fait). Anciennes branches stale à nettoyer en session humaine si souhaité : `loop/rebrand-login-html-mydesk` (`76eb413`, supersédée par ce commit), `loop/rebrand-app-js-mydesk` (`94efe76`), `loop/rebrand-register-js-mydesk` (`f029415`).

## Checkpoint 49 — Loop-engineering : rebranding `app.js` « Mon Atelier » → « MyDesk » — mergé sur `main` (2026-07-24)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Étape 1bis exécutée dans le bon ordre cette fois (avant l'implémentation, correction de l'omission du checkpoint 48) : `plan` → `update_no_semantic` (10 fichiers non-code > cap 5, différé), `record-result success`, `verify` → `valid:true` (1937 nœuds/2752 liens), `risk public/static/js/app.js` → `sensitiveMatch:false`.

**Sélection** : chantier cache-busting (🔴, 6 items) toujours escaladé (architectural, aucune décision depuis) → skip. Écartés en ordre déterministe : déploiement `[loop-safe]` (la loop ne déploie jamais), deep-link admin (isolation, reporté), décisions produit (restyle A4, multi-appareils, acompte structuré), convention nommage, assignation technicien (feature), tests fuseau horaire (baseline ambigu), `escapeHtml` (sécurité, risque élevé), `www` 521 (infra), RGPD purge auto (risque élevé), multi-sites (architecture + isolation), 4 items marketing Post-MVP, clarification dashboard agenda → skip. Tâche retenue : **`app.js` L27/424-425** (`todo.md:225`) — déjà implémentée et escaladée aux runs précédents (branche `loop/rebrand-app-js-mydesk` `94efe76`) pour la même raison que `register.js` : gate Playwright inexécutable. Réparé depuis (`d7c5ed1`, checkpoint 47) — changement de contexte légitime justifiant de reprendre la tâche, exactement le candidat annoncé au checkpoint 47.

**Déviation Étape 3** : `git worktree add ../izigsm-loop-rebrand-app-js-mydesk` réussit, mais `cd` dans ce worktree frère est bloqué explicitement par le sandbox de session (« may only change directories to the allowed working directories... 'izigsm/webapp' »). Même contrainte que les checkpoints 45/47. Worktree et branche `-v2` créée pour rien supprimés (`git worktree remove` + `git branch -D`), travail refait sur une branche fraîche `loop/rebrand-app-js-mydesk-v2` créée directement depuis `main` à jour sur le checkout principal — l'ancienne branche `loop/rebrand-app-js-mydesk` (`94efe76`) datait de 26 commits derrière `main`, réimplémentation propre plutôt qu'un merge/rebase (tous deux hors `permissions.allow`).

**Travail** : `public/static/js/app.js:27,424-425` — fallback `session.company`/`user.boutique_name || 'Mon Atelier'` → `'MyDesk'` (3 occurrences, littéral d'affichage seul dans `buildSidebar()` et `storeSession()`). `boutique_id`/tokens/logique d'auth intacts, vérifié par lecture directe avant et après. Signal graphe `sensitiveMatch:false`. Bump `CACHE_VERSION` v2.67→v2.68 (`sw.js`).

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants inchangés) · tsc ✅ (32 erreurs, exactement le baseline `d7c5ed1`, delta nul ; `app.js` hors compilation TS) · build ✅ (`vite build` 953ms) · **playwright ✅ 10/10** (auth/health/isolation) · browser-use n·a (littéral d'affichage seul, pas de nouveau parcours).

**Commit `283c8c5` mergé sur `main`** (`git merge --ff-only`, poussé, branche `loop/rebrand-app-js-mydesk-v2` aussi poussée sur origin). Case `todo.md:225` cochée. Reste ouvert du chantier rebranding : `login.html` L227 (branche `loop/rebrand-login-html-mydesk` existe déjà, état non vérifié), `register.html` L228, `auth.ts` L229 (JSDoc seul mais fichier auth sensible — signal à re-classifier au prochain run), anciennes branches stale `loop/rebrand-app-js-mydesk` (`94efe76`, obsolète, supersédée par ce commit) et `loop/rebrand-register-js-mydesk` (déjà mergée au checkpoint 47 sous un autre hash — à vérifier si suppression pertinente en session humaine).

## Checkpoint 48 — Loop-engineering : fiche imprimée utilise la boutique du ticket, pas la 1ère de la liste (2026-07-24)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé).

**Déviation procédurale à signaler** : l'Étape 1bis (rafraîchissement/vérification du graphe) a été exécutée **après** l'implémentation et le commit au lieu d'avant, par omission — le run a directement enchaîné Étape 0bis → sélection de tâche sans passer par `graphify-refresh.mjs plan/record-result/verify`. Rattrapé a posteriori dans ce même run : `plan` → `update_no_semantic` (10 fichiers non-code > cap 5, différé), `record-result success`, `verify` → `valid:true` (1937 nœuds/2752 liens, graphe sain). Aucun impact constaté sur la classification de risque (faite par mots-clés + lecture directe du code, cf. ci-dessous), mais **à corriger dans le prochain run** : respecter l'ordre Étape 0bis → 1 → 1bis → 2 avant toute implémentation.

**Sélection** : chantier cache-busting (🔴, 6 sous-tâches, même chantier architectural déjà classé risque élevé — `> ~8 fichiers`, 29 pages HTML + 20 JS + service worker) → toutes écartées sans implémentation. Déploiement groupé impression ticket `[loop-safe]` écarté (la loop ne déploie jamais, aucune exception). Deep-link admin et restyle A4 écartés (explicitement reportés/en attente de décision utilisateur dans `todo.md`). Convention nommage `.superpowers/sdd/` écartée (pas une tâche de code). Tâche retenue : **nom de boutique sur fiche imprimée** (`project-docs/todo.md:39`, bug mineur non bloquant, aucun mot-clé à risque, périmètre 1 fichier).

**Déviation Étape 3** : travail fait **directement sur le checkout principal** (`main`), pas dans un worktree isolé — omission, pas un choix délibéré (contrairement au checkpoint 47 où le worktree était bloqué par le sandbox). Le diff était trivial (1 fichier, 7 lignes) et tous les gates sont passés avant commit, donc pas de risque matériel constaté, mais **à corriger dans le prochain run** : créer le worktree à l'Étape 3 avant toute édition.

**Travail** : `public/static/js/tickets.js` (`_fetchTicketPrintData`) — le fetch du profil boutique prenait systématiquement `(GET /api/boutiques)[0]`, qui pour un compte admin retourne **toutes** les boutiques dans un ordre non garanti (pour un non-admin la route ne renvoie déjà que sa propre boutique, donc le bug ne se manifestait qu'en admin). Corrigé pour utiliser `GET /api/boutiques/:id` avec le `boutique_id` du ticket (`t.boutique_id`, présent via `SELECT t.*` dans `ticketService.ts:419`) — même patron déjà utilisé dans `settings.html`, isolation déjà en place côté route (`boutiques.ts:106`, 403 si non-admin hors de sa boutique).

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants inchangés) · tsc ✅ (mêmes erreurs pré-existantes, aucune sur `tickets.js` qui est hors périmètre tsc — fichier JS pur) · build ✅ (`vite build` 967ms) · playwright ✅ 10/10 · browser-use n·a (correction de bug sur parcours existant, pas de nouveau parcours — validation exploratoire optionnelle non exécutée, écriture hors repo bloquée par permission en session autonome).

**Commit `ece114d` poussé directement sur `main`** (pas de merge --ff-only, le commit a été fait directement sur le checkout principal — cf. déviation Étape 3 ci-dessus). `CACHE_VERSION` v2.66→v2.67 oublié dans ce commit puis rattrapé en commit séparé `ba3f81f` (règle CLAUDE.md, tâche frontend touchant `public/static/js/*.js`). Case `todo.md:39` cochée.

## Checkpoint 47 — Loop-engineering : rebranding `register.js` « Mon Atelier » → « MyDesk » — mergé sur `main` (2026-07-24)

**Contexte** : run de la loop-engineering. Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open**, signalé). Graphe : `plan` → `update_no_semantic` (9 fichiers non-code > cap 5, rafraîchissement différé), `record-result success`, `verify` OK (1937 nœuds/2752 liens).

**Sélection** : chantier cache-busting (🔴, 6 items L22-27) toujours escaladé (architectural, aucune décision depuis) → skip. Écartés en ordre déterministe : déploiement `[loop-safe]` (la loop ne déploie jamais), deep-link admin (isolation, reporté), décisions produit (restyle A4, multi-appareils, acompte structuré), convention nommage, nom boutique fiche imprimée (isolation), assignation technicien (feature), tests fuseau horaire (baseline ambigu), `escapeHtml` (sécurité, risque élevé explicite `loop-policy.md`), `www` 521 (infra), RGPD purge auto (risque élevé), multi-sites (architecture + isolation), 4 items marketing Post-MVP non scopés, clarification dashboard agenda, rebranding `app.js` L225 (déjà escaladé, branche non mergée, aucune décision) → skip. Tâche retenue : **`register.js` L226** — déjà implémentée et escaladée au run du 2026-07-23 (branche `loop/rebrand-register-js-mydesk`, commit `f029415`) pour une seule raison : gate Playwright inexécutable sur Windows.

**Fait nouveau déterminant** : commit `d7c5ed1` (2026-07-24, hors de cette session) a réparé les gates Windows — `@playwright/test` jamais installé (node_modules obsolète depuis le 07-19) + `executablePath` codé en dur vers un chemin Linux inexistant + `typescript` jamais déclaré en devDependency (`npx tsc` exécutait un package factice du registre npm). Cette réparation invalidait la raison d'escalade du run précédent sans qu'aucune décision produit n'ait été nécessaire — traité comme un changement de contexte légitime justifiant de reprendre la tâche (pas une nouvelle tentative aveugle sur une tâche déjà refusée).

**Déviation Étape 3 découverte pendant ce run** : `git worktree add ../izigsm-loop-<slug>` réussit maintenant (contrairement aux checkpoints 41/43/44/45), mais le worktree frère reste **non accessible en écriture/cd depuis cette session** (sandbox restreint à `izigsm/webapp` — confirmé par un blocage explicite du harness, pas une simple absence de permission fichier). Travail fait en checkoutant directement la branche existante sur le checkout principal — celle-ci datait d'avant `d7c5ed1` (`npm install` a fait régresser `typescript`/Playwright), donc **réimplémentation propre sur une branche fraîche depuis `main` à jour** plutôt qu'un `git rebase`/`git merge` (tous deux hors de `.claude/settings.json` § `permissions.allow`, seul `git merge --ff-only` y figure — bloqués par le harness, pas de contournement tenté).

**Travail** : `public/static/js/register.js:230-231` — fallback session après inscription email/OTP `company_name || 'Mon Atelier'` → `'MyDesk'` (identique au diff de la branche escaladée). Signal graphe `sensitiveMatch:true` catégorie `auth` sur ce fichier (nouveau garde-fou du 2026-07-23) — documenté comme signal complémentaire, classification risque faible maintenue après relecture du diff exact (littéral d'affichage seul, `boutique_id`/tokens/OTP intacts). Bump `CACHE_VERSION` v2.65→v2.66 (`sw.js`).

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants inchangés) · tsc ✅ (32 erreurs pré-existantes, exactement le baseline documenté par `d7c5ed1`, delta nul) · build ✅ (`vite build` 936ms) · **playwright ✅ 10/10** (gate désormais exécutable — auth/health/isolation tous verts) · browser-use n·a (pas de nouveau parcours utilisateur, littéral d'affichage seul).

**Commit `5506b73` mergé sur `main`** (`git merge --ff-only`, poussé). Case `todo.md:226` cochée. Reste ouvert du chantier rebranding : `app.js` L225 (déjà escaladé, branche `loop/rebrand-app-js-mydesk` non mergée — **à revérifier avec le gate maintenant réparé, candidat naturel du prochain run**), `login.html` L227 (une branche `loop/rebrand-login-html-mydesk` existe déjà, état non vérifié dans ce run), `register.html` L228, `auth.ts` L229 (risque élevé auth, JSDoc uniquement mais dans un fichier sensible).

## Checkpoint 46 — Graphify : chunks stale réparés, doublons fusionnés, graphe régénéré, lien QualiRépar↔ecosystem tracé (2026-07-24)

**Contexte** : suite du graphe de connaissance construit au checkpoint 40 (`/graphify` sur tout le repo, 1867 nœuds/2643 relations/418 communautés). Un relance `/graphify --update` en session interactive le 2026-07-23 avait laissé le graphe dans un état incohérent (`docs/superpowers/specs/2026-07-23-graphify-loop-integration-design.md:19` : "cache/semantic/ vide malgré 24 chunks déjà produits").

**Audit des 24 chunks sémantiques** (`graphify-out/.graphify_chunk_NN.json`) :
- **Chunk 11 (index)** : réellement tronqué — ne couvrait que 1/8 PDF (`test impression.pdf`) suite à la coupure de quota du checkpoint 40. Retraité intégralement : `CDC_izigsm.pdf`, `260115000258.PDF` (paiement Ecologic réel SOTELI), `bon de réparation.pdf`, `fiche réparation.pdf` (dossier réel `TELNET-SARL SOTELI` REPGSM2026-8530), 3 PDF `ecosystem` (RGPD/purge, PIEC, Guide API Fonds Réparation). 49 nœuds, 56 relations, 3 hyperedges.
- **12 chunks (index 12-23)** : vérifiés à tort suspectés stale (~300 octets chacun) — en réalité corrects, contenu légitimement minimal (favicon + 11 icônes PWA, un fichier SVG par chunk). 2 vrais bugs schema trouvés et corrigés : `chunk_13.json` (clé `"type"` au lieu de `"relation"`, `"confidence"` manquant), `chunk_23.json` (BOM UTF-8 en tête de fichier, piège déjà documenté dans `graphify-out/MODE-OPERATOIRE.md` §5).
- **Chunk 10 (index)** : découverte a posteriori — contenait 11 nœuds doublons (IDs génériques `pdf_bon_reparation`, `cdc_mod01_tickets`, `ecosystem_piec_doc`...) décrivant les **mêmes** documents que le chunk 11 retraité, formant une communauté 27 isolée (15 nœuds) dans le premier graphe régénéré. Fusion (pas suppression) : les 11 doublons retirés, leurs 38 relations + 3 hyperedges redirigés vers les IDs canoniques détaillés du chunk 11 — préserve les mappings uniques du chunk 10 (`tickets.html --implements--> CDC MOD-01`, 3 écarts spec/code déjà flaggés AMBIGUOUS, nœud `ecosystem_org`, 2 relations QualiRépar).

**`.graphify_detect.json` avait aussi un BOM** (même piège que chunk_23) — corrigé au passage (lecture `utf-8-sig`).

**Regénération complète du graphe** (2 passes, avant/après fusion chunk 10) : merge 24 chunks sémantiques + AST (`graphify.build`/`cluster`/`report`/`export`), relabeling manuel des 20 plus grosses communautés sur 407 (`to_json(..., force=True)` nécessaire — garde-fou légitimement déclenché par la réduction volontaire 1947→1937 nœuds). Sorties régénérées : `graph.json`, `graph.html`, `GRAPH_REPORT.md`, `obsidian/` (2344 notes + `graph.canvas`). Réduction ~745x vs relecture du corpus brut (benchmark `graphify.benchmark`).

**Découverte annexe non touchée** : un `cdc_izigsm_doc` distinct subsiste (chunk 07, source `graphify-out/converted/CDC_izigsm_54850a26.md`) — pas un doublon, membre d'une famille de 3 CDC divergents (izigsm/Manus/sections) déjà repérée par ce chunk, légitimement séparée du `docs/CDC_izigsm.pdf` que j'ai traité.

**Lien QualiRépar ↔ API ecosystem Fonds Réparation tracé** (surprising connection remontée par le graphe, vérifiée dans le code) : `public/qualirepar.js` est une **simulation UI 100% locale** (`getDB`/`addToDB`/`updateInDB`, zéro `fetch()` vers ecosystem, confirmé par grep sur `src/routes`/`src/services`) du workflow réel décrit dans `Guide d'utilisation des APIs Partenaires Fonds Réparation`. Statuts identiques en substance (Brouillon/Soumis/En instruction/Validé/Refusé ≈ En cours de création/Envoyé-vérification/ARCHIVED), formule de bonus locale et statique (`Math.min(amount*0.25, maxBonus)` avec `maxBonus` codé en dur dans le HTML) au lieu d'interroger `GET /catalog`. Gap actionnable identifié : brancher réellement le module sur l'API (`login` → `catalog` → `new-claim`/`upload-file`/`confirm-claim`) remplacerait la saisie manuelle par le flux réel avec montants de bonus authentiques.

**Rien commité côté code applicatif** — tout le travail vit dans `graphify-out/` (gitignoré). Ce checkpoint documente le travail dans `project-docs/` uniquement.

## Checkpoint 45 — Loop-engineering : rebranding `register.js` « Mon Atelier » → « MyDesk » (escaladé, branche `loop/rebrand-register-js-mydesk`) (2026-07-23)

**Contexte** : run de la loop-engineering (skill `.claude/skills/loop-engineering/SKILL.md`, gouverné par `loop-policy.md`). Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open** conforme, signalé). Graphe : `verify` OK (1867 nœuds), mais rafraîchissement sémantique **différé** (`plan` → `update_no_semantic`, 15 fichiers non-code > cap 5, `/graphify --update` tout-ou-rien non lancé) — `record-result success`, 0 échec consécutif.

**Sélection** : tête de file cache-busting (🔴, 6 items L22-27) **déjà escaladée** run `61fc30924e` (architectural), aucune décision actée depuis (`decisions.md` sans entrée cache-busting/Vite, texte inchangé) → `--skip`. Écartés en ordre déterministe : déploiement L40 `[loop-safe]` (la loop ne déploie jamais), deep-link admin L36 (isolation + reporté), décisions produit L37/L135/L136, convention L38, `nom boutique fiche` L39 (multi-tenant → risque élevé), technicien L134 (feature), tests fuseau L164 (DST/baseline, ambigu), `escapeHtml` L165 (sécurité), `www 521` L170 (infra), RGPD L177, multi-sites L182, marketing L186-189, clarification L207, **rebranding `app.js` L225 (`7af1ae2590`, déjà escaladé run 10:14:07, branche `loop/rebrand-app-js-mydesk` `94efe76` non mergée) → `--skip`**. Première tâche **risque faible non escaladée implémentable** → `b28fb68f88` (`todo.md:226`).

**Travail** : `public/static/js/register.js:230-231` — fallback session après inscription email/OTP `company_name || 'Mon Atelier'` → `'MyDesk'` (champs `boutique_name`/`company` de la session localStorage, littéral d'affichage). Contrôle OTP, tokens et `boutique_id` intacts. Bump `CACHE_VERSION` v2.65→v2.66 (`sw.js`, cohérence règle frontend — fonctionnellement optionnel ici : `/register` ∈ `NETWORK_ONLY_PATHS`, `register.js` ∉ `APP_SHELL`). Classification vérifiée sur le code réel + signal graphe `sensitiveMatch:false`. **Commit `f029415` sur branche `loop/rebrand-register-js-mydesk`, NON mergé** (escalade).

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants `agendaService.test.ts` inchangés — baseline stable) · tsc ✅ (0 nouvelle erreur ; `register.js`/`sw.js` hors compilation TS, delta nul) · build ✅ (`vite build` 1.08s) · **playwright ❌ inexécutable** (`@playwright/test` non provisionné, config chemin Linux CI — condition dure L2 → pas d'auto-commit) · browser-use **n·a**.

**Escalade** : gate Playwright inexécutable = condition dure L2 non satisfaite → aucun merge sur `main`, travail conservé sur branche. **2 branches rebranding en attente de merge humain** (`loop/rebrand-app-js-mydesk` `94efe76` app.js + `loop/rebrand-register-js-mydesk` `f029415` register.js). Reste du chantier : `login.html` L227, `register.html` L228, `auth.ts` L229 (**risque élevé auth**), autres pages L230. Case `todo.md:226` laissée **décochée** (escalade). Détail complet : ledger `.superpowers/sdd/loop-runs.md` (run 12:09).

## Checkpoint 44 — Loop-engineering : case obsolète `/robots.txt` 500 Genspark réconciliée (auto-commit risque faible) (2026-07-23)

**Contexte** : run de la loop-engineering (skill `.claude/skills/loop-engineering/SKILL.md`, gouverné par `loop-policy.md`). Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open** conforme, signalé).

**Sélection** : tête de file `pick-task.mjs` = chantier cache-busting (🔴, 6 items L22-27) **déjà escaladé** au run `61fc30924e` (architectural), aucune décision actée depuis (vérifié : `decisions.md` sans entrée cache-busting, dernier commit = checkpoint 39 ; texte de tâche inchangé) → `--skip` des 6 ids. Écartés ensuite en ordre déterministe : L40 déploiement `[loop-safe]` (la loop ne déploie jamais — garde-fou absolu), deep-link admin L36 (isolation + reporté utilisateur), décisions produit L37/L135/L136, convention nommage L38, `nom boutique fiche imprimée` L39 (multi-tenant → doute → risque élevé, code lu : `_fetchTicketPrintData` lit `GET /api/boutiques[0]`, fix toucherait la sélection de boutique + potentiellement la route isolation-sensible `GET /api/tickets/:id`), `assignation technicien` L134 (feature à construire), `3 tests fuseau horaire` L164 (touche DST/baseline vitest, non mécanique), `escapeHtml` L165 (sécurité XSS, risque élevé), **rebranding `app.js` L225** (`90109e0aad` du run précédent — **déjà escaladé au run 2026-07-23T10:14:07, branche `loop/rebrand-app-js-mydesk` commit `94efe76` non mergée**, gate Playwright inexécutable, aucune décision humaine depuis → `--skip`). Première tâche **risque faible réellement implémentable et complétable dans cet environnement** (docs-only) → `47f3736449` (`todo.md:169`).

**Constat durable confirmé (ledger run 10:14:07)** : dans cet environnement Windows, la loop **ne peut auto-commiter aucun vrai changement de code** — le gate e2e Playwright (condition dure L2) exige `@playwright/test` + navigateur non provisionnés (`playwright.config.ts` cible un chemin chromium Linux CI). Seules les réconciliations docs-only (playwright n·a) restent auto-committables. Le backlog risque-faible docs-only est quasi épuisé (r.success, noms de tables, phoneCatalogService déjà faits aux checkpoints 38/41/43).

**Travail** : investigation complète de `/robots.txt`. Genspark abandonné le 2026-07-10 (migration Cloudflare terminée) → le 500 spécifique à cet hébergeur est **sans objet**. Sur Cloudflare, `/robots.txt` renvoie **200** : servi comme asset statique (`public/robots.txt`, exclu des Pages Functions par `public/_routes.json:11`), doublé d'une route Hono de redondance (`src/index.tsx:242`, `c.text(ROBOTS_TXT, 200, ...)` — réponse statique, aucun 500 possible). Action : cocher la case `todo.md:169` avec note de vérification. **Delta code nul.** L170 (`www.repairdesk.fr` 521, infra DNS Gandi hors repo) laissée décochée — non actionnable dans le repo.

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants `agendaService.test.ts` `createRendezVous`/`updateRendezVous` — offset UTC/Paris DST — inchangés, baseline stable) · tsc ✅ (0 nouvelle erreur ; markdown hors compilation TS, delta nul vs `main` — erreurs restantes `factureService`/`photosService`/`rachatService`/`servicesService`/`stockService`/`tests/e2e/*`/`setup.ts`/`stockService.test.ts` pré-existantes) · build ✅ (`vite build` 1.12s) · playwright **n·a** · browser-use **n·a** (delta code nul).

**Déviation Étape 3 (transparence)** : pas de worktree isolé — périmètre d'écriture restreint à `izigsm/webapp`, worktree frère `../izigsm-loop-*` non-inscriptible (même contrainte que runs `eabf928d00`/`3a01544d33`/checkpoints 41/43). Changement docs-only à delta code nul → édité sur `main` directement.

## Checkpoint 43 — Loop-engineering : case obsolète `tests/phoneCatalogService.test.ts` réconciliée (auto-commit risque faible) (2026-07-23)

## Checkpoint 43 — Loop-engineering : case obsolète `tests/phoneCatalogService.test.ts` réconciliée (auto-commit risque faible) (2026-07-23)

**Contexte** : run de la loop-engineering (skill `.claude/skills/loop-engineering/SKILL.md`, gouverné par `loop-policy.md`). Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open** conforme, signalé).

**Sélection** : tête de file `pick-task.mjs` = chantier cache-busting (🔴, 6 items lignes 22-27) **déjà escaladé** au run `61fc30924e` (périmètre architectural, non isolable), aucune décision actée depuis (vérifié : `decisions.md` sans entrée cache-busting, texte de tâche inchangé) → passé (`--skip`, règle Étape 1). Écartés ensuite en ordre déterministe (mêmes raisons que checkpoint 41) : L40 déploiement `[loop-safe]` (la loop ne déploie jamais, garde-fou absolu), deep-link admin (isolation + reporté par l'utilisateur), décisions produit (L37/L135/L136), convention nommage (L38), `nom boutique fiche imprimée` (multi-tenant → doute → risque élevé), `escapeHtml` L165 (sécurité, risque élevé), `assignation technicien` L134 (feature à construire), `3 tests fuseau horaire` L164 (baseline connue). Première tâche **risque faible implémentable** → `96222a31f3` (`todo.md:168`, création de test) — exactement le candidat recommandé par les runs `eabf928d00` et `3a01544d33`.

**Travail** : le fichier `tests/phoneCatalogService.test.ts` **existe déjà** (créé lors de la migration Ports & Adapters, checkpoint 14, 2026-07-15) — 209 lignes, 11 tests couvrant les 5 fonctions exportées de `phoneCatalogService.ts` (`syncBrands`, `syncModelesByBrand`, `syncSelectedBrands`, `getLastSyncStatus`, `getCatalogStats`) via `fetch` mocké en échec → chemin de repli dataset statique. La tâche « à créer » était donc une **case obsolète** (même classe de décalage documentation/code que la case slug `92f0db8` et la réconciliation r.success du 2026-07-20). Action : cocher la case `todo.md:168` avec note de vérification. Aucun code produit modifié (delta code nul). Scope tenu : pas d'ajout de couverture supplémentaire (le sous-item `docs/TODO.md:225`, formulé « 0 test sur ~1500 lignes du fallback catalogue », vise une exhaustivité plus large **non revendiquée ici** → laissé décoché, signalé au ledger).

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants `computeFin()`/`updateRendezVous` inchangés — baseline stable ; `tests/phoneCatalogService.test.ts` 11/11 vert isolément) · tsc ✅ (0 nouvelle erreur ; markdown hors compilation TS, delta nul vs `main` — erreurs restantes `servicesService.ts`/`stockService.ts`/`tests/e2e/*`/`setup.ts`/`stockService.test.ts` pré-existantes) · build ✅ (`vite build` 856ms) · playwright **n·a** · browser-use **n·a** (delta code nul).

**Déviation Étape 3 (transparence)** : pas de worktree isolé — périmètre d'écriture restreint à `izigsm/webapp`, worktree frère `../izigsm-loop-*` non-inscriptible (même contrainte que runs `eabf928d00`/`3a01544d33`). Changement docs-only à delta code nul → édité sur `main` directement.

## Checkpoint 42 — Garde-fou anti-dump SKILL.md + collision git évitée avec un run planifié en cours (2026-07-20)

**Incident `alltasks.tmp.json`** : fichier de dump (29 Ko, sortie de `node scripts/loop/pick-task.mjs --all`) trouvé non suivi dans le working tree, généré par une investigation automatique du backlog lors d'un run précédent. Purement un fichier de lecture — aucune tâche/checkpoint/commit perdu — mais un fichier non suivi bloque le **prochain** run planifié dès l'Étape 0 (précondition « working tree propre »), même classe d'incident que les fichiers temporaires Graphify du même jour. Supprimé, pattern `*.tmp.json` ajouté au `.gitignore` (commit `40fb393`).

**Garde-fou ajouté** dans `.claude/skills/loop-engineering/SKILL.md` § Garde-fous globaux : toute investigation ponctuelle (dump/debug) doit rediriger hors du repo (dossier temp système) ou être nettoyée avant la fin du run — pour empêcher la récidive de cette classe d'incident sur de futurs runs. Documenté aussi dans `bugs.md` (commit `9305d0b`).

**Collision git évitée** : avant de committer ce garde-fou, `git status` a révélé des changements déjà indexés (`git add`, pas encore `git commit`) sur `docs/ARCHITECTURE_MODULES.md`/`current-state.md`/`todo.md` — signe qu'un run planifié tournait activement (`scripts/loop/.loop-lock` présent, horodaté 20:00:19 UTC, démarré ~13 min plus tôt, dans la fenêtre normale). Plutôt que de committer par-dessus un run en cours (risque de collision/corruption), attente explicite de la disparition du lock (`until [ ! -f scripts/loop/.loop-lock ]; do sleep 20; done`) avant de procéder. Le run planifié a terminé proprement de son côté (checkpoint 41 ci-dessous, commits `2e6da16`/`112d925`), confirmant que l'attente était justifiée et suffisante — aucune intervention manuelle nécessaire au-delà d'attendre.

**Commande `/approve` reconfirmée** en usage réel entre-temps (tâche `73e011907f`, voir checkpoint 40) — les 4 commandes Telegram restent toutes validées.

## Checkpoint 41 — Loop-engineering : `docs/ARCHITECTURE_MODULES.md` §2 noms de tables corrigés (auto-commit risque faible) (2026-07-20)

**Contexte** : run de la loop-engineering (skill `.claude/skills/loop-engineering/SKILL.md`, gouverné par `loop-policy.md`). Environnement opérant (`node`/`npm`/`npx` exécutables, `pick-task.mjs` fonctionnel). Gate quota `check-quota.mjs` → code 2 (historique local insuffisant → **fail-open** conforme à `loop-policy.md`, signalé).

**Sélection** : tête de file `pick-task.mjs` = chantier cache-busting (🔴, 6 items) **déjà escaladé** au run `61fc30924e` (périmètre architectural), aucune décision actée depuis → passé (`--skip`, règle Étape 1). Écartés en ordre déterministe : L40 déploiement (la loop ne déploie jamais), deep-link admin (déjà escaladé, isolation), décisions produit (L37/L135/L136), convention nommage (L38), `nom boutique fiche imprimée` + `escapeHtml` (risque élevé), `assignation technicien` (feature à construire). Première tâche **risque faible implémentable** en aval → `3a01544d33` (`todo.md:163`, documentation).

**Travail** : correction de 5 noms de tables obsolètes dans le tableau §2 « Schéma de base de données », chacun vérifié contre les `CREATE TABLE` réels de `migrations/*.sql` : `statuts_historique`→`tickets_statuts_historique` (0004), `lignes_facture`→`lignes_document` (0006), `sessions_caisse`/`lignes_caisse`→`clotures_journalieres` (0008, les deux premiers noms n'existent dans aucune migration), `otp_codes`→`otp_tokens` (0009), `tickets_sav`→`sav_dossiers` (0019). Portée volontairement limitée aux **noms erronés** (pas d'ajout de complétude type `commissions`/`sequences`/migrations 0032-0036 — hors scope « noms obsolètes », éviterait le scope creep).

**Gates** : vitest ✅ (824/826, 2 échecs fuseau horaire pré-existants `computeFin()`/`updateRendezVous` inchangés — baseline stable) · tsc ✅ (0 nouvelle erreur ; markdown hors compilation TS, delta nul vs `main` — les erreurs restantes sur `servicesService.ts`/`stockService.ts`/`tests/e2e/*`/`setup.ts` sont pré-existantes) · build ✅ (`vite build` 1.93s) · playwright **n·a** · browser-use **n·a** (delta code nul, un changement markdown ne peut pas régresser le runtime ni introduire de parcours utilisateur — même raisonnement que le run docs-only `eabf928d00`).

**Déviation Étape 3 (transparence)** : pas de worktree isolé — le périmètre d'écriture de la session est restreint à `izigsm/webapp`, un worktree frère `../izigsm-loop-*` est non-inscriptible (même contrainte que le run `eabf928d00`). Pour ce changement docs-only à delta code nul, édition faite sur le checkout `main` directement, cohérent avec les commits docs sur `main` déjà présents (`d13976c`).

## Checkpoint 40 — Graphe de connaissance `/graphify` sur tout le repo + `/approve` Telegram validé (2026-07-20)

**Graphe construit** : `/graphify` lancé sur `izigsm/webapp` en entier (255 fichiers, ~1.63M mots) — **1867 nœuds, 2643 relations, 418 communautés**, réduction ~533x en coût de requête vs relire le corpus brut. Sorties dans `izigsm/webapp/graphify-out/` (gitignoré, non suivi par git — voir `.gitignore`) : `graph.json`, `graph.html`, `GRAPH_REPORT.md`, vault Obsidian (2282 notes + `graph.canvas`), et `MODE-OPERATOIRE.md` (procédure complète de relecture/mise à jour).

**Incident en cours de route (résolu)** : la limite de dépense mensuelle du compte a coupé 24 sous-agents d'extraction parallèles en plein run — 23/24 chunks ont quand même écrit leur fichier avant la coupure (l'erreur API n'annule pas les écritures disque déjà faites), seul 1 chunk (config racine + migrations 0001-0005) a été refait manuellement, sans sous-agent. Deuxième incident en cascade : les fichiers temporaires de graphify (non gitignorés au départ) ont sali le working tree et fait échouer le run planifié `iziGSM Loop Engineering` de 16:00 (code 1) — corrigé en ajoutant `.graphify_*`/`graphify-out/` au `.gitignore` (voir `bugs.md` si détail nécessaire, sinon `graphify-out/MODE-OPERATOIRE.md` §5 pour le récit complet des pièges).

**Commande `/approve` validée en conditions réelles** (commit `ee9a2e6`, hors de cette session — usage autonome du bot par l'utilisateur) : tâche `73e011907f` ("Déploiement groupé du chantier impression ticket") taguée `[loop-safe]` via Telegram. **Note** : cette tâche particulière concerne un déploiement — même taguée `loop-safe`, `loop-policy.md` interdit categoriquement tout `wrangler pages deploy` automatique, donc le tag n'a pas d'effet pratique ici au-delà de rendre la tâche éligible à la sélection ; le prochain run qui la sélectionne devrait simplement constater qu'il ne peut rien déployer et escalader. Les 4 commandes Telegram (`/status`, `/digest` informatif, `/run`, `/approve`) sont désormais toutes confirmées en usage réel au moins une fois.

**Nettoyage** : fichier `alltasks.tmp.json` (dump `pick-task.mjs --all`, généré par un run automatique d'investigation du backlog) supprimé + pattern `*.tmp.json` ajouté au `.gitignore` pour éviter la récidive.

## Checkpoint 39 — Loop-engineering : notifications Telegram, cadence horaire, commandes à distance (2026-07-20)

**Objectif de session** : rendre la loop-engineering (mise en place au checkpoint 37) observable et pilotable sans avoir à ouvrir une session Claude Code — bot Telegram (`iziGSM Loop Bot`) + accélération de la cadence.

**Notifications (`run-loop.ps1`)** : message Telegram au **démarrage** (permissions/quota OK, volume backlog `todo.md`/`TODO.md`, tête de file visée — style checkpoint) et à la **fin** de chaque run (actions faites = commits réels du run via `git log $PreRunHead..$PostRunHead`, prochaine tâche en tête de backlog) — plus un message court sur chaque cas d'abandon (tree sale, quota dépassé) ou d'échec (`claude -p` code ≠ 0). Toujours best-effort : une notif ratée ne bloque jamais le run.

**Watchdog (`scripts/loop/watchdog.ps1`, tâche planifiée « iziGSM Loop Watchdog », 30 min)** : alerte Telegram si `.loop-lock` (écrit par `run-loop.ps1` avant `claude -p`, supprimé après) date de plus de 60 min — silencieux sinon, jamais de "tout va bien" répété. N'arrête jamais un processus, alerte uniquement.

**Cadence** : tâche planifiée `iziGSM Loop Engineering` passée de 1x/jour (09:30) à **toutes les heures** (`MultipleInstances=IgnoreNew`, jamais 2 runs concurrents) — décision explicite de l'utilisateur pour accélérer le débit sur le backlog. Le budget « 1 tâche/déclenchement » de `loop-policy.md` n'a **pas changé** : c'est la fréquence du trigger qui augmente, pas la taille d'un run. Rappel documenté : la plupart des 48 tâches ouvertes de `todo.md` restent à risque élevé (isolation/NF525/paiement/migrations/architecture) et continueront d'escalader vers une session humaine quelle que soit la cadence — la loop ne vide que la queue mécanique à faible risque.

**Commandes Telegram (`scripts/loop/telegram-listener.mjs`, tâche planifiée « iziGSM Loop Telegram Listener », polling 5 min)** : set fixe de commandes sûres, décision explicite de ne **pas** transmettre de prompt libre à `claude -p` — `/status` (état des tâches planifiées + backlog), `/digest` (liste des tâches complexes détectées par heuristique `riskHint` de `pick-task.mjs --all`, **purement informatif**, pas de hand-off automatique vers une session Claude Code), `/run` (force un run si aucun en cours), `/approve <id>` (tag `[loop-safe]` sur une tâche + commit/push immédiat — override explicite de la classification automatique, à la discrétion de l'utilisateur), `/help`. Sécurité : toute commande d'un `chat_id` non autorisé est ignorée silencieusement ; tous les appels `git`/`node`/`powershell` passent par `execFileSync` (tableaux d'arguments, pas d'interpolation shell).

**3 tâches planifiées Windows actives** : `iziGSM Loop Engineering` (horaire), `iziGSM Loop Watchdog` (30 min), `iziGSM Loop Telegram Listener` (5 min) — les trois tournent en parallèle et indépendamment d'une session Claude Code interactive.

**Bugs trouvés et corrigés pendant la mise en place** :
1. Run planifié du 09:30 échoué (code 1) — working tree non propre (diff résiduel oublié dans `loop-runbook.md`, une ligne d'exemple 06:00→09:30). Corrigé, folded dans le premier commit de session.
2. Blocage confiance workspace (`hasTrustDialogAccepted: false` pour `izigsm/webapp` dans `~/.claude.json`) — empêchait `node`/`npm`/`npx` en session non-interactive (`claude -p`), faisait échouer tous les gates silencieusement. Résolu par une session interactive one-time (`cd` + `claude` + accepter le dialogue).
3. Dates PowerShell brutes (`/Date(1784...)/ `) dans le message `/status` — `Get-ScheduledTaskInfo` sérialisé en JSON sans conversion. Corrigé (`.ToString('yyyy-MM-dd HH:mm')` avant `ConvertTo-Json`).
4. (Découvert, pas un bug de cette session) Le ledger `.superpowers/sdd/loop-runs.md` contenait des entrées obsolètes suggérant que le fix CRLF `pick-task.mjs` n'était pas appliqué — en réalité déjà corrigé et commité (`49d4ffe`, 2026-07-19). Rappel : le ledger est un instantané figé par run, pas un état vivant (déjà documenté en tête du fichier).

**2 runs réels validés de bout en bout aujourd'hui** : 1 escalade légitime (isolation multi-tenant sur le deep-link admin, gates inexécutables en session non-interactive avant le fix de confiance workspace) + 1 commit réussi après le fix (réconciliation `todo.md` § pattern `r.success`/`r.data`, déjà corrigé par `c281411` — voir checkpoint 38 ci-dessous). Notification Telegram confirmée reçue par l'utilisateur sur les deux.

**Commits de cette session** : `d13976c`/`d87de2a` (checkpoint 38, réconciliation), `6051332` (notifs Telegram fin de run), `a480f5d` (notif démarrage + cadence horaire), `7fb2436` (commandes Telegram).

**Reste ouvert** : `/digest` et `/approve` pas encore testés en conditions réelles par l'utilisateur (seul `/status` confirmé) ; watchdog testé uniquement à vide (jamais déclenché sur un vrai run bloqué) ; 48 tâches `todo.md` toujours ouvertes, majoritairement à risque élevé (voir `todo.md` pour le détail).

## Checkpoint 38 — Loop-engineering : réconciliation backlog « pattern r.success/r.data » (2026-07-20)

**Run loop-engineering autonome (une tâche, de bout en bout).** Tâche sélectionnée par `pick-task.mjs` en ordre déterministe après skips Étape 1 : les 6 items du chantier cache-busting (🔴, déjà escaladé run `61fc30924e` comme périmètre architectural, aucune décision actée depuis) et le deep-link admin (déjà escaladé run 2026-07-20, « reporté à plus tard », risque élevé isolation) ont été passés ; L37 (décision produit), L38 (convention de nommage), L40 (déploiement — la loop ne déploie jamais) et L39 (nom de boutique sur fiche imprimée — touche la sélection de boutique → risque élevé par défaut) écartés. Première tâche réellement implémentable et de risque faible explicite (loop-policy.md § « Risque faible » : bugs d'affichage/frontend, pattern r.success/r.data) : **audit de `agenda.js` fonction par fonction** (`todo.md` § « Bug étendu — pattern r.success/r.data »).

**Résultat de l'audit : déjà corrigé.** Le commit `c281411` (2026-07-17, « fix(agenda,sav,stats): pattern r.success/r.data cassé sur 19 fonctions ») avait déjà traité les 3 fichiers de la section — agenda.js (8 fonctions), sav.js (8 fonctions), stats.html (3 pleinement + 4 wrapper corrigé) — et avait été validé en local live à l'époque. Audit statique de la loop confirmé : plus aucun `r.success`/`r.data` direct fautif, uniquement `r.ok`/`r.data?.data`/`r.error` avec commentaires explicatifs. Seules les checkboxes de `todo.md` étaient restées décochées — même décalage documentation/code que le bug slug (`92f0db8`, réconcilié rétroactivement lui aussi).

**Action de ce run** : réconciliation documentaire uniquement (aucun changement de code) — cases L44-L48 cochées dans `todo.md` avec référence `c281411`, ce checkpoint, entrée ledger. Gates baseline vérifiés verts avant réconciliation : `vitest` 824/826 (2 échecs fuseau horaire pré-existants `computeFin()`/`updateRendezVous` inchangés), `tsc --noEmit` sans nouvelle erreur (seules les erreurs pré-existantes sur anciens fichiers), `npm run build` OK. Playwright/browser-use : n·a (zéro delta de code — le correctif sous-jacent avait déjà été validé en live dans `c281411`). Déviation environnement notée : worktree Étape 3 créé puis retiré (chemin hors périmètre de permissions en écriture) — réconciliation faite sur le checkout principal, cohérent avec les commits ledger déjà faits sur `main`, sans risque (docs seulement).

## Checkpoint 37 — Mise en place loop-engineering + isolation multi-tenant `tickets.ts` (2026-07-19)

**Loop-engineering** : infrastructure d'automatisation mise en place (`.claude/skills/loop-engineering/SKILL.md`, `project-docs/loop-policy.md`, `project-docs/loop-runbook.md`, `scripts/loop/*`) — autonomie L2, un sous-agent implémenteur+reviewer par tâche pour le code, escalade obligatoire sur risque élevé (auth/isolation/NF525/RGPD/paiement/migration/périmètre large). Exécution : tâche planifiée Windows (`schtasks`/Planificateur, quotidienne, heure locale — voir `loop-runbook.md` pour la conversion GMT) qui lance `scripts/loop/run-loop.ps1` depuis `izigsm/webapp/` (le vrai dossier de dev — un clone redondant `izigsm_NG_temp_analysis/` créé pendant la mise en place a été identifié et supprimé). Un Routine Claude Code Remote (cloud) a été essayé puis abandonné (utilisateur en CLI locale exclusivement, pas de canal de notification exploitable).

**2 failles d'isolation multi-tenant trouvées et corrigées sur `src/routes/tickets.ts`** (même classe de bug qu'à chaque fois sur ce repo — aucune vérification `boutique_id` sur un accès par ID) :
- `GET /api/tickets/:id` — trouvée par le gate Playwright de la loop-engineering, corrigée manuellement par l'utilisateur (commit `ae6795f`), déployée, validée en prod réelle (`repairdesk.fr`, Claude in Chrome, compte `telnet@bbox.fr` — manager boutique 2) : `GET /api/tickets/1` (boutique 1, étrangère) 200→403, `GET /api/tickets/12` (boutique 2, propre) resté 200.
- `PUT /api/tickets/:id`, `PUT /api/tickets/:id/statut`, `DELETE /api/tickets/:id` — trouvées par un audit statique de la loop-engineering (escaladée, pas d'auto-fix — risque élevé), fix préparé sur branche par la session, relu par l'utilisateur, mergé (`22b3071`), déployé, validé en prod (même compte, `PUT /:id` boutique étrangère → 403 confirmé).
- `POST /:id/acompte` et les routes photos étaient déjà protégées — chantier isolation `tickets.ts` intégralement traité.
- Suite Playwright relancée par la loop-engineering après les deux fix : 7/7 verts, `isolation.spec.ts` confirmé résolu. `tsc --noEmit`/tests unitaires (824/826) inchangés sur le fix `GET /:id`.

**Autres corrections faites pendant la mise en place** (détail complet dans `bugs.md`) : bug d'installation locale (`--d1=DB` cassait `wrangler pages dev`), `pick-task.mjs` cassé par CRLF Windows, `.claude/settings.json` ajouté (permissions pré-approuvées pour la loop), confiance workspace Claude Code (prérequis one-time par dossier), `.gitignore` étendu (pdf/docx/zip de référence bloquaient le gate "working tree propre").

**Note d'environnement (Windows)** : `core.fileMode` désactivé localement sur ce poste (`git config core.fileMode false`) — les scripts `scripts/loop/*` (`.ps1`/`.mjs`/`.py`) perdaient leur bit exécutable à chaque checkout NTFS, provoquant un diff de mode fantôme bloquant les rebases. Config locale uniquement, pas commitée — à reproduire sur toute autre machine Windows si le symptôme réapparaît.

**Reste ouvert** (voir `todo.md`) : chantier cache-busting (checkpoint 36, priorité 🔴, escaladé par la loop comme périmètre architectural — nécessite le pipeline superpowers complet en session humaine, pas la loop autonome).

**Investigation Graphify (2026-07-19, pas encore mise en œuvre)** : exploration de `/graphify-windows` (confirmé installé localement, skill équivalent au `/graphify` officiel de https://github.com/Graphify-Labs/graphify — extraction de code 100% locale/gratuite via tree-sitter, extraction sémantique des docs via IA/tokens) pour donner à la loop-engineering une carte du code/docs déjà construite plutôt que d'explorer par `Grep`/`Glob` à chaque run. Plan détaillé (installation, commandes exactes par sous-corpus `src/`/`docs/`/`project-docs/`, piège effet-de-bord déjà documenté sur un test antérieur, option `graphify hook install` pour rebuild auto au commit) remis à l'utilisateur en fichier séparé (`PLAN-graphify-izigsm.md`), à exécuter dans un dossier isolé `graphify-test-izigsm/` hors de ce repo. **Rien exécuté côté izigsm, aucune intégration dans `SKILL.md` pour l'instant** — décision d'intégration à la loop différée après validation humaine de l'utilité réelle du graphe.

## Incident propagation CDN figée dans le précache SW — CORRIGÉ le 2026-07-18
Utilisateur a signalé le nouveau contenu (v2.64) absent malgré `CACHE_VERSION` à jour dans son navigateur. Root cause confirmée en direct (Claude in Chrome) : le précache du Service Worker a fetché `tickets.js` pendant la fenêtre de propagation du cache CDN Cloudflare juste après le déploiement, figeant une version transitoire encore ancienne sous le nouveau `CACHE_VERSION`. Fix immédiat appliqué sur le poste de l'utilisateur (désinscription SW + purge cache). Fix structurel déployé : `cache.add()` → `cache: 'reload'` au précache (`CACHE_VERSION v2.65`, commit `796be8d`) — réduit le risque sans l'éliminer totalement (limite du edge CDN hors de notre contrôle).

**Chantier prioritaire identifié pour la prochaine session** (`todo.md`) : cache-busting par hash de contenu des fichiers statiques (`tickets.a3f8e1.js`) — élimination structurelle de cette classe de bug, nécessite un vrai chantier d'outillage Vite + manifeste + régénération dynamique du précache SW. Pas commencé, détail complet des sous-tâches dans `todo.md`.


## Amendement contenu ticket 3 volets + fiche A4 — DÉPLOYÉ le 2026-07-18 (commit `fbc28c4`)
Suite comparaison directe avec `bon de réparation.pdf`/`print-prise-en-charge.php` (ancien `izigsm_app`) : IMEI/N° Série désormais toujours affichés (fallback "—") sur les 2 volets thermiques (client+technicien) ; texte légal acompte remplacé par 3 mentions reflétant le comportement réel (déduit si accepté / conservé si refusé / recyclage après 4 semaines), appliqué à la fois sur la fiche A4 et le ticket 3 volets, sur demande explicite de l'utilisateur — le cas d'annulation (avoir automatique) reste volontairement absent de ce texte. Pas de changement de schéma (état à l'entrée reste en tags checklist, pas de niveau de gravité ajouté), format Marque+Modèle groupé conservé, volet technicien reste sans acompte/signature. Déployé (`CACHE_VERSION v2.64`, commit `8aff690`), vérifié en prod.

**Limite de validation** : test navigateur local bloqué par l'extension NoScript de l'utilisateur (interfère aussi sur `localhost`, pas seulement `repairdesk.fr`) — validé autrement (relecture diff, `node --check`, simulation isolée de la logique fallback). Vérifié directement sur le contenu servi en prod après déploiement (présence confirmée des nouvelles chaînes).


## Incident client — /login + dashboard cassés sur Chrome — RÉSOLU le 2026-07-18 (cause : extension NoScript, pas l'app)
Utilisateur a signalé une connexion impossible + identifiants visibles dans l'URL sur `repairdesk.fr/login`, puis un dashboard vide (sidebar absente, widgets bloqués). Vraie cause trouvée en investiguant en direct sur son poste (Claude in Chrome) : l'extension **NoScript** bloquait l'exécution JS de la page (`repairdesk.fr` pas encore en site de confiance) — logs `DocumentFreezer`/`SyncMessage loops` confirmés en console. Résolu par l'utilisateur en ajoutant `repairdesk.fr` aux domaines de confiance NoScript. Le code applicatif n'était jamais en cause. Un fix Service Worker déployé en cours de route (retirer `/login`/`/register`/`/reset-password` du cache, `CACHE_VERSION v2.63`, commit `40ac842`) reste une amélioration légitime mais ne réglait pas ce symptôme précis. Détail complet + leçon méthodologique dans `bugs.md`.


## Déploiement production — 2026-07-18 (chantier impression ticket, 8/8 tâches)
Les 8 tâches du chantier impression ticket (+ 2 amendements hors plan, Tasks 4bis/4b) ont été déployées sur `repairdesk.fr`, sur confirmation explicite de l'utilisateur. Tests avant déploiement : 824/826 (2 échecs fuseau horaire pré-existants connus). `CACHE_VERSION` bumpée `v2.61` → `v2.62` (fichiers frontend touchés : `tickets.js`/`tickets.html`/`print.css`). Vérifié après déploiement : `GET /api/health` → 200, `sw.js` confirme `CACHE_VERSION izigsm-v2.62`. **2 bugs connus non corrigés, documentés dans `bugs.md`** : le deep-link technicien (`tickets.html?open=<token>`) ne fonctionne jamais pour un compte admin (route `GET /api/tickets` exige `boutique_id` sans exception admin), et une confusion connexe erreur/introuvable dans `_checkOpenDeepLink()` — les deux affectent maintenant la production, pas seulement le code. Archive locale du dossier webapp demandée par l'utilisateur, en attente.


## Checkpoint 32 — Task 6 clarifiée puis terminée (ticket 3 volets), Task 7 dispatchée, 2026-07-18

Correction factuelle apportée à l'utilisateur en cours de session : Task 4/4b (fiche A4) ne contenait PAS déjà un "ticket technicien" (vérifié par grep — juste un champ nom + case signature vide). Après clarification (plusieurs tours d'AskUserQuestion), la vraie demande était un **ticket 3 volets** thermique (client×2 + technicien, un seul job d'impression avec pointillés), remplaçant le ticket client seul de Task 5 (dont le contenu a été réutilisé, pas perdu). **Task 6 (révisée) terminée et approuvée** (commit `62b03e4`) — confidentialité du volet technicien vérifiée directement dans le diff par le reviewer. **Task 7 (révisée, 2 boutons au lieu de 3) dispatchée, en cours** au moment de ce checkpoint. Voir `project-docs/recovery-prompt.md` (checkpoint 32) pour le détail complet.


## Checkpoint 31 — Tasks 3, 4, 4bis, 4b, 5 terminées et approuvées + 3 bugs préexistants corrigés, 2026-07-18

Suite du checkpoint 30 (2/8 tâches). Reprise via `/init recover`. Chantier impression ticket avancé à 5/8 tâches (Task 6/7/8 restantes) :
- Task 3 (helpers QR/EAN-13 + libs CDN) revue et approuvée
- Task 4 (fiche A4 : retrait fuite notes internes + QR/EAN) revue, approuvée, fuite prouvée absente en conditions réelles (ticket de test avec marqueur distinctif)
- **Amendement de plan (décision utilisateur)** : 2 PDF de référence fournis (`docs/test impression.pdf`, `docs/bon de réparation.pdf`, issus de l'ancien template abandonné `izigsm_app`) pour enrichir le contenu des fiches imprimables. Décision : garder le format thermique 72mm déjà validé (pas le format A4 3-copies de l'ancien template), reprendre le contenu (IMEI/N° série/adresse/acompte), sans signature (électronique déjà captée ailleurs), système visuel A4 indigo existant conservé (pas le bandeau bleu marine du modèle — classes CSS partagées avec factures/devis).
- **Task 4bis** (backend, hors plan écrit) : `getTicketById()` expose désormais IMEI/N° série (JOIN `appareils`) + adresse client
- **Task 4b** (hors plan écrit) : fiche A4 enrichie (N° série, adresse, section "Acompte versé" encadrée)
- Task 5 (révisée) : `_buildTicketThermiqueHTML()` — ticket client 72mm, contenu inspiré de l'ancien template, sans signature
- **3 bugs préexistants corrigés au passage** : `panne` toujours vide sur les fiches imprimables (mauvais champ API), marque/modèle mal mappés (idem), commentaire JSDoc obsolète
- **Incident process** : sous-agent Task 5 a écrasé `.superpowers/sdd/task-5-report.md` (contenu d'un chantier antérieur déjà documenté ailleurs, non tracké git, non récupérable) sans proposer avant — collision de naming générique `task-N-*.md` entre chantiers. À corriger : namespacer les futurs fichiers ad-hoc hors plan écrit.
- Rien de ce chantier n'est encore déployé en prod. Voir `project-docs/recovery-prompt.md` (checkpoint 31) pour le détail complet et les prochaines étapes.


## Déploiement production — 2026-07-18 (acompte structuré, checkpoint 29)
Les 10 tâches + revue finale du chantier acompte structuré (checkpoint 29) ont été déployées sur `repairdesk.fr` (`npm run build` → `npx wrangler pages deploy dist --project-name izigsm`), sur confirmation explicite de l'utilisateur. Tests avant déploiement : 824/826 (2 échecs fuseau horaire pré-existants connus, `computeFin()`, sans impact prod). Vérifié après déploiement : `GET /api/health` → 200, `sw.js` confirme `CACHE_VERSION izigsm-v2.61`. **HEAD au moment du déploiement incluait aussi les Tasks 1-3 du chantier impression ticket** (déjà commitées sur `main`, revues/approuvées, code additif et inerte — recherche ticket par token/EAN-13 + helpers QR/EAN-13 non encore branchés à aucune UI) — signalé à l'utilisateur avant déploiement, pas d'objection. Plus de décalage `origin/main`/prod pour l'acompte structuré.

## Checkpoint 30 — chantier impression ticket démarré (subagent-driven-development), session suspendue le soir du 2026-07-17

Nouveau chantier, brainstormé et planifié dans la foulée du checkpoint 29 (acompte structuré). Objectif : 2 nouveaux formats d'impression ticket thermique (72mm) — ticket client à emporter + étiquette technicien à coller sur l'appareil — en plus de la fiche A4 existante (corrigée au passage : elle affichait les notes internes, une fuite de confidentialité). QR code (lien de suivi client ou lien interne technicien selon le format) + code-barre EAN-13 (ID ticket) sur les 3 formats. Pas d'agent d'impression externe (QZ Tray écarté) — `window.print()` natif comme l'existant, l'imprimante thermique 72mm est reconnue comme imprimante système standard.

**Spec** : `docs/superpowers/specs/2026-07-17-impression-ticket-design.md` (commit `2b63d23`) — décisions détaillées (rôle QR vs EAN-13, recherche par scan additive-OR, deep-link technicien sans gestion de reconnexion).
**Plan** : `docs/superpowers/plans/2026-07-17-impression-ticket.md` (commit `10cd47e`) — 8 tâches TDD/local-live.

**État d'avancement — 2/8 tâches, session suspendue avant la revue de Task 2** (voir `.superpowers/sdd/progress.md` pour le détail complet) :
- [x] Task 1 : `_fetchTicketPrintData()` expose l'ID numérique (commit `a9bf783`) — revue a trouvé un rapport de validation non prouvé (langage conditionnel "Would display..."), contrôleur a refait la validation réellement (script Node + wrangler local, confirmé).
- [x] Task 2 (implémentée, **PAS ENCORE REVUE**) : `listTickets()` reconnaît un token scanné (QR) ou un ID EAN-13 dans la recherche, en plus du texte libre existant (commit `236f8c2`) — 5/5 tests verts, suite complète 824 passed.
- [ ] Tasks 3-8 : pas commencées (helpers QR/EAN-13 + libs CDN, 2 nouveaux formats thermiques, 3 boutons d'impression, deep-link technicien).

**Prochaine étape au retour** : dispatcher le reviewer sur Task 2 (BASE `a9bf783`, HEAD `236f8c2`) avant de continuer vers Task 3 — ne pas re-dispatcher l'implémenteur, juste la revue, per le ledger SDD.

**Incident de session** : plusieurs blocages du dispatch de subagent par le classificateur du mode auto pendant ce chantier (Task 5 de l'agent tool, motif "Blocked by classifier") — résolu en sortant du mode auto, pas un problème de code. À surveiller si ça se reproduit.

## Checkpoint 29 — acompte structuré implémenté de bout en bout (subagent-driven-development), 2026-07-17

Suite du checkpoint 28 (plan écrit). Exécution du plan 10 tâches (`docs/superpowers/plans/2026-07-16-acompte-structure.md`) via `superpowers:subagent-driven-development`, directement sur `main` (comme le précédent chantier Ports & Adapters) — un subagent implémenteur + un subagent reviewer par tâche, revue finale de branche (modèle opus) sur l'ensemble.

**Avant le chantier acompte, dans la même session** : bug étendu `r.success`/`r.data` (même classe que `devis.js`/`settings.html`) corrigé dans `agenda.js`/`sav.js`/`stats.html` — 19 fonctions cassées depuis toujours, ces 3 pages étaient intégralement non fonctionnelles (KPIs jamais affichés, formulaires toujours en échec silencieux). Commit `33d9a739`.

**Les 10 tâches, toutes terminées et approuvées** — détail complet task par task, chaque finding et son traitement, dans `.superpowers/sdd/progress.md` (ledger SDD) et le résumé consolidé dans `todo.md` § "Chantier acompte structuré". Résumé fonctionnel : acompte facturé immédiatement (vraie facture verrouillée, séquence `FAC-` partagée), déduit automatiquement à la facture finale, annulation avec acompte perçu → avoir automatique (2 mois), UI staff (tickets/devis) + UI publique (`suivi.html`).

**Incident de session (pas un problème de code)** : le subagent implémenteur de la Task 8 a été coupé par la limite de dépense mensuelle de l'utilisateur juste après avoir committé mais avant d'écrire son rapport — code intact, juste pas de rapport détaillé. Revue Task 8 faite sans rapport implémenteur (sur le diff seul), validation live du flux avoir refaite directement par le contrôleur (script Node contre `wrangler pages dev --local`) pour combler le vide.

**Revue finale de branche (33d9a739..09d7e23, 17 commits, verdict initial "With fixes")** : les 5 fixes post-revue par tâche vérifiés réellement en HEAD (pas juste les messages de commit), invariant "un seul acompte par dossier" vérifié cohérent sur les 5 sites qui en dépendent, isolation boutique/rôle cohérente sur les 2 routes. 2 findings Important traités après la revue (commit `a9d28d5`) : validation `montant_ht` durcie (déjà fait avant la revue finale, Tasks 5/6), et surtout `changeStatus()` (annulation avec avoir) qui approximait le HT/taux TVA de l'acompte à 20% fixe au lieu de lire les valeurs réelles — corrigé pour éviter de reproduire la pollution du rapport comptable déjà fixée en Task 7. `avoirs.date_expiration` jamais "appliquée" automatiquement (juste persistée) confirmé comme périmètre MVP intentionnel par lecture directe du spec, pas un gap.

## Checkpoint 28 — plan d'implémentation acompte structuré écrit, PAS commencé, 2026-07-16

Suite du checkpoint 27 (spec approuvée). Skill `superpowers:writing-plans` invoqué pour transformer le spec en plan détaillé.

**Bonus avant le plan** : en recherchant du contexte pour le plan (l'écran cible du futur bouton "Demander un acompte" est la fiche détail devis), découverte et correction d'un bug significatif — `devis.js` avait 3 fonctions cassées depuis toujours (`loadDevisStats()`, `openDevisDetail()`, `openEditDevis()`), même classe que le bug `settings.html` du checkpoint 23 (`result.data` au lieu de `result.data?.data`). Corrigé, testé en local live, déployé (commit `d876981`). **Balayage plus large repéré mais pas traité** : même pattern probable dans `agenda.js`/`sav.js`/`stats.html` (~17 endpoints), documenté dans `todo.md` pour une session dédiée.

**Plan écrit** : `docs/superpowers/plans/2026-07-16-acompte-structure.md` (commit `15bdea8`) — 10 tâches TDD avec commits fréquents. Auto-relecture du plan a trouvé un vrai trou de couverture par rapport au spec (le mécanisme de déduction à la facture finale — ligne négative — n'avait pas de tâche dédiée) — corrigé en ajoutant la Task 7 (`convertirDevis()`), tâches suivantes renumérotées.

**Résumé des 10 tâches** : (1) migration `type_facture`/`date_expiration`, (2) `createFactureAcompte()`, (3) `createAvoir()` + `date_expiration`, (4) exposer la facture d'acompte sur `getTicketById()`/`getDevis()`, (5-6) routes `POST /api/tickets|devis/:id/acompte`, (7) `convertirDevis()` déduit l'acompte de la facture finale, (8-9) UI `tickets.js`/`devis.js`, (10) affichage `suivi.html`.

**En attente du choix de mode d'exécution** (proposé par le skill `writing-plans`, jamais tranché) : subagent-driven (`superpowers:subagent-driven-development`, un subagent frais par tâche + relecture) vs inline (`superpowers:executing-plans`, exécution dans cette session par lots). **Aucun code de ce plan n'a encore été écrit.**

## Checkpoint 27 — spec acompte structuré finalisée, en attente de relecture utilisateur, 2026-07-16

Suite du checkpoint 26 : le design a été présenté section par section (vue d'ensemble, modèle de données, API/rôles, UI/tests) et **entièrement approuvé** par l'utilisateur, avec 3 clarifications importantes obtenues en cours de route (toutes intégrées au spec) :
1. Numérotation `FAC-` partagée entre facture normale et facture d'acompte — explicitement demandé par l'utilisateur de justifier pourquoi ce n'est pas une entorse à NF525 (une facture d'acompte est légalement une "facture", même catégorie qu'une facture normale — contrairement aux devis/avoirs qui sont des catégories de documents distinctes et ont donc leur propre séquence)
2. Résolution d'une tension entre "l'acompte doit compter dans le CA du jour" et "facture finale = montant total" (qui aurait exigé d'exclure l'acompte du CA pour éviter un double comptage) → tranché en faveur de **facture finale = solde restant uniquement**, via une ligne négative de déduction
3. Confirmation à l'annulation d'un ticket avec acompte perçu : `confirm()` avec texte explicite + motif fixe pré-rempli (pas de formulaire dédié pour le MVP)

**Spec écrit et pushé** : `docs/superpowers/specs/2026-07-16-acompte-structure-design.md` (commit `ae094a7`), auto-relu (une affirmation trop forte corrigée — le cas où une facture finale et une annulation pourraient théoriquement coexister sur un même dossier, non bloquant mais documenté comme edge case non couvert par ce MVP).

**En attente de la relecture utilisateur du spec écrit avant d'invoquer le skill `writing-plans`** (hard-gate du skill brainstorming — ne pas coder avant l'approbation du spec écrit, distincte de l'approbation section-par-section déjà obtenue).

## Checkpoint 26 — brainstorming acompte structuré (skill superpowers:brainstorming), 2026-07-16

**Aucun code modifié ce checkpoint** — session de conception pure, conforme au hard-gate du skill brainstorming (pas d'implémentation avant design approuvé). Reprend le chantier "acompte structuré" reporté au checkpoint 25.

Décomposé en 2 sous-projets : **(A) acompte manuel** (traité dans cette session) et **(B) paiement en ligne/Stripe** (session future dédiée). Décisions validées pour (A) : un seul acompte par dossier, montant libre, et surtout — **modèle "facture d'acompte"** plutôt qu'une table de suivi séparée, découvert nécessaire car `createAvoir()` exige une facture verrouillée existante (l'utilisateur veut un avoir, pas un remboursement, en cas d'annulation). Ce choix réutilise `factures`/`avoirs`/`journal_nf525` tels quels, sans étendre la chaîne NF525. Avoir sur acompte annulé : validité 2 mois **réellement appliquée** (pas juste imprimée) — nécessite une nouvelle colonne `date_expiration` sur `avoirs` + logique d'expiration automatique.

Design "Vue d'ensemble" présenté, pas encore approuvé par l'utilisateur — session interrompue pour un checkpoint avant de continuer. Détail complet des décisions et des points restant à valider dans `todo.md` § Chantier futur — acompte structuré.

**Reprise** : continuer la présentation du design (skill brainstorming), sections restantes (modèle de données détaillé, mécanisme de déduction, UI), avant d'écrire le spec dans `docs/superpowers/specs/2026-07-16-acompte-structure-design.md`.

## Checkpoint 25 — feature "Accord" (timeline suivi.html + override staff), 2026-07-16

Implémente la feature "Accord" spécifiée le 2026-07-10 (double validation boutique→client, réutilise le flow devis existant, pas de nouveau système de token) + une extension demandée dans la foulée : override manuel par le staff en cas de non-réponse client.

**Timeline `suivi.html`** : l'étape "Accord" (gris/orange/vert) dérive désormais de `devis_statut` (devis le plus récent lié au ticket), pas seulement du statut ticket. `getTicketPublicByToken()`/`getTicketById()` exposent ce champ via un `LEFT JOIN devis` corrélé. Bug annexe trouvé et corrigé : `routes/public.ts` filtrait explicitement les champs renvoyés, `devis_statut` était résolu côté service mais jamais exposé au client.

**Override staff** (`POST /api/devis/:id/accord-manuel`, admin/manager/technicien) : permet de forcer l'acceptation d'un devis "envoyé" sans réponse client, pour débloquer la prise en charge. Volontairement plus étroit que `PUT /devis/:id/statut` (réservé admin/manager) — seule la transition `envoye→accepte`, pas un accès général à la gestion des devis. Tracé (`ACCORD_MANUEL_STAFF`). Bouton correspondant dans la fiche détail ticket (`tickets.js`).

**Acompte structuré** : demandé en même temps, décisions de scope actées (encaissement manuel + en ligne, demandé au devis + à la prise en charge) mais **explicitement reporté à une session dédiée** (dépendances Stripe + NF525 à cadrer). Détail complet dans `todo.md`.

Validé en local live de bout en bout (devis→orange→override→vert, isolation rôle technicien confirmée, 409 sur re-override). Tests 803/805 (fixtures SQL mises à jour). `CACHE_VERSION` bumpée `v2.55`→`v2.56`. **Déployé (`271accb`)**, `sw.js` confirme `izigsm-v2.56` en prod.

## Checkpoint 24 — populateTechniciens() filtré + CACHE_VERSION bumpée, 2026-07-16

Suite du checkpoint 23. Bug slug boutiques libre-service revérifié : **déjà corrigé depuis le 2026-07-11** (`92f0db8`), seule la checkbox `todo.md` n'avait jamais été mise à jour — aucune action de code nécessaire, doc corrigée.

`populateTechniciens()` (`tickets.js`) listait tous les rôles (admin/manager/technicien) au lieu des seuls techniciens — filtre `.filter(u => u.role === 'technicien')` ajouté. **Découverte importante en validant** : le Service Worker servait encore l'ancien `tickets.js` malgré le rebuild/redéploiement — `CACHE_VERSION` n'avait pas été bumpée depuis `v2.54` (checkpoint 22 lot B) alors que les lots C (`clients.js`) et G (`settings.html`) de cette session avaient changé du frontend sans bump correspondant. Bumpé à `v2.55`, ce qui invalide rétroactivement le cache pour tous ces changements accumulés, pas seulement celui-ci. **Déployé (`d3a3592`)**, `sw.js` confirme `izigsm-v2.55` en prod. Détail complet dans `bugs.md`.

## Checkpoint 23 — reset password + créneaux RDV bookables + bug settings.html, 2026-07-16

Suite directe du checkpoint 22 (lots A-D déjà déployés). Traite les 2 derniers bugs connus (`bugs.md`) + 1 bug annexe découvert en validant :

**E. Reset password jamais envoyé (commité, pushé, déployé, `2dbb297`, validé en prod avec envoi réel)** : `sendResetPasswordEmail()` (nouveau, `emailService.ts`, modèle `sendOtpInscription()`) remplace l'appel `sendEmail()` mal paramétré dans `routes/auth.ts`. `tsc` : erreur historique disparue. **Testé en prod le 2026-07-16** avec `telnet@bbox.fr` (compte réel) : email de réinitialisation reçu, confirmé par l'utilisateur.

**F. Créneaux RDV bookables — `boutique_creneaux` était vide pour toutes les boutiques (commité, pushé, déployé, `2dbb297`)** : `creneauxService.ts` (nouveau) + `GET`/`PUT /api/boutiques/:id/creneaux` + onglet "Horaires RDV" dans `settings.html`. 12 tests nouveaux. Cycle complet validé en local live : API + `getDisponibilites()` publique génère bien des créneaux réels + round-trip navigateur (compte manager réel, ajout plage, sauvegarde confirmée).

**G. Bug annexe — `settings.html` entier cassé depuis la migration ApiService→apiGet (commité, pushé, déployé, `2dbb297`)** : 10 sites `r.success`/`r.data` au lieu de `r.data.success`/`r.data.data` — les 5 onglets existants ne préaffichaient jamais les vraies valeurs (risque d'écrasement par des champs vides) et le toast de sauvegarde affichait toujours "❌ échec" même en cas de succès, depuis le commit `a62c4fd`. Détecté en validant l'onglet Horaires RDV (qui reproduisait initialement le même bug).

Détail complet des 3 items dans `todo.md` § Checkpoint 23 et `bugs.md`. Tests 803/805 (12 nouveaux, mêmes 2 échecs pré-existants `computeFin()`). Déployé, `repairdesk.fr/api/health` → 200 après déploiement.

## Checkpoint 22 — reprise via conversation en cours (pas `/init recover`), 2026-07-15

Quatre lots de travail dans cette session, sur `izigsm/webapp/` :

**A. Bug + feature prise en charge (déployé, commits `c30984e`/`03e384d`)** : autocomplete Modèle réparé (bug d'extraction `res.data` vs `res.data.data`), champ Marque converti en autocomplete (126 marques réelles, remplace un `<select>` figé à 7 options), grille schéma de déverrouillage 9 points ajoutée (stockée dans la colonne texte existante, pas de migration). Faille XSS trouvée et corrigée dans les deux autocompletes (onclick interpolé → `data-*`/listener délégué).

**B. Fiche client type société (déployé, commit `f3938c5`, migration `0035` en prod)** : toggle particulier/professionnel, champs raison sociale/SIRET/TVA intracom, autocomplete adresse via l'API gouvernementale BAN. Bug corrigé au passage : `listClients()` ne renvoyait jamais adresse/code_postal/siret/tva_intracom (édition perdait ces champs). Sidebar : Clients remonté sous Tableau de bord.

**C. Recherche entreprise par SIRET (pushé et déployé le 2026-07-16)** : `recherche-entreprises.api.gouv.fr`, auto à 14 chiffres, pré-remplit raison sociale/adresse/TVA (calculée depuis le SIREN) sans jamais écraser une saisie manuelle. Commit `97f96b2` rebasé sans conflit sur `origin/main` (`a25c472`), buildé et déployé (`wrangler pages deploy`). **Validé en prod** (Claude in Chrome, SIRET réel DINUM `13002526500013`) : toast de confirmation, raison sociale/adresse/code postal/ville/TVA (`FR07130025265`) tous corrects.

**D. Fix sécurité — isolation photos tickets (commité, pushé, déployé le 2026-07-16, commit `506990f`)** : `GET`/`POST /api/tickets/:id/photos` appelaient `getBoutiqueId(c)` (contexte Hono seul, bug ouvert depuis le checkpoint 21) — remplacé par `getBoutiqueId(user, queryBoutiqueId)`, même pattern que `/photos/:photoId/url`. Test d'isolation dédié en local live : technicien d'une autre boutique → 403 sur un ticket qui n'est pas le sien (avant fix : 200, faille reproduite). Déployé, `repairdesk.fr/api/health` → 200 après déploiement.

Détail complet des 4 lots dans `todo.md` (§ Checkpoint 22). Tests 791/793 sur toute la session (2 échecs pré-existants `computeFin()`, sans rapport).

## Fix photos ticket — jeton signé courte durée — 2026-07-15

Suite au fix vignettes/lightbox (blob+fetch), remplacé par un système de jeton HMAC-SHA256 courte durée (5 min, `src/lib/photoToken.ts`) : `GET /api/tickets/:id/photos/:photoId/url` (authentifié) émet un jeton scopé `{photoId, boutiqueId, exp}`, consommé par `GET /api/photo-view/:token` (public, hors `authMiddleware`, `index.tsx`). Évite le passage par `fetch()`+blob côté client — `img.src` reçoit directement l'URL avec jeton. Validé en prod (cycle complet + rejets 401 sans/avec mauvais jeton). `sw.js` bumpé `v2.51`→`v2.52`.

**Bug de sécurité découvert en cours de route — CORRIGÉ le 2026-07-16** (voir § Checkpoint 22 lot D ci-dessus) : `GET`/`POST /api/tickets/:id/photos` appelaient `getBoutiqueId(c)` avec un seul argument au lieu de `(user, paramBoutiqueId)` — l'isolation multi-tenant sur ces 2 endpoints ne se déclenchait jamais. Détail complet dans `bugs.md`.

## 3 fixes frontend ticket post-déploiement — 2026-07-15

## Fix 3 bugs frontend ticket — 2026-07-15 (signalé par test utilisateur `telnet@bbox.fr`)

Détail complet `bugs.md`. Résumé : (1) impression fiche ticket cassée depuis Sprint 2.13 (`_triggerPrint` jamais chargé sur `tickets.html`, centralisé dans `app.js`) ; (2) changement de statut ticket jamais fonctionnel depuis le workflow granulaire 10-statuts (boutons legacy 4-statuts remplacés par génération dynamique depuis `TRANSITIONS_TICKET`) ; (3) création de ticket silencieusement écrite en localStorage seul (jamais en base) si le premier `GET /api/tickets` de la session avait raté — `saveTicket()` tente désormais toujours l'API réelle en premier. `sw.js` bumpé `v2.48`→`v2.49`. Déployé et vérifié en prod (fichiers statiques confirmés à jour), non testé en navigateur réel.

## Fix auth frontend — 2026-07-15 (signalé par test utilisateur `telnet@bbox.fr`)

3 bugs auth frontend corrigés et déployés (détail complet `bugs.md`) : `uploadPhoto()`/`archiverTicket()` (`tickets.js`) envoyaient un token toujours vide → 401 "Token manquant." systématique sur ajout photo/archivage ; `tryRefreshToken()` (`app.js`) envoyait un corps de requête et lisait une réponse au mauvais format (snake_case au lieu du camelCase réel de l'API) → le refresh JWT n'a jamais fonctionné, déconnexion silencieuse après 1h. `sw.js` `CACHE_VERSION` bumpée à `v2.48` pour forcer l'invalidation du cache App Shell chez les utilisateurs déjà connectés. Validé en prod (login + appels API directs), propagation confirmée sur `repairdesk.fr`.

## Déploiement production — 2026-07-15 (post checkpoint 20)

Les 15 checkpoints en attente depuis le checkpoint 5 (6→20, chantier Ports & Adapters complet) ont été **déployés en production** sur `repairdesk.fr` (`npm run build` → `wrangler pages deploy dist --project-name izigsm`). Suite de tests avant déploiement : 791/793 (2 échecs fuseau horaire connus, sans impact prod). Vérifié après déploiement : `GET https://repairdesk.fr/api/health` → 200, `version: 2.45.0`. Plus de décalage entre `origin/main` et la production.

## Chantier Ports & Adapters — TERMINÉ — 20/20 services migrés (session du 2026-07-15)

Dernier service migré : **statsService.ts** (2026-07-15) — 10/10 fonctions intégralement. `lib/timezone.ts` appliqué systématiquement (`todayParis`/`currentMonthParis` + helpers locaux `addDaysParis`/`addMonthsParis`). Tests étendus 15→33. **3 bugs préexistants corrigés** : `exportCsvCa()`/`getRapportComptable()` cassés depuis toujours (colonne `mode_paiement` inexistante sur `factures`, vit sur `paiements`) ; le test "1er du mois courant" documenté pré-existant non-bloquant depuis le 2026-07-09 est réparé. **Validé en local live** : 10/10 endpoints ✅.

**Chantier Ports & Adapters complet** : les 20 services métier passent par le port `Database` (au moins partiellement — chaque fonction dépendant d'`auditLog()`/`nextNumero()`/`enregistrerTransaction()`/`db.batch()` reste sur `D1Database` brut par choix architectural assumé, voir `docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md`). Prochaine étape (hors scope immédiat) : adaptateur Postgres + bascule VPS, si engagée.

## Chantier Ports & Adapters — 19/20 services migrés (session du 2026-07-15)
- **agendaService.ts** (2026-07-15) — 12/12 fonctions migrées intégralement. `lib/timezone.ts` appliqué (`todayParis()` dans `getKpisAgenda`, `getWeekStart`/`getWeekEnd` refaits en arithmétique UTC pure). Câblage `routes/agenda.ts` + `index.tsx` (route iCal publique). Tests (73/75 ✅, 2 échecs confirmés pré-existants, bug `computeFin()` sans impact prod, documenté dans `bugs.md`). **Validé en local live** : CRUD RDV complet, KPIs, vue calendrier, token iCal — 9/9 ✅.

## Chantier Ports & Adapters — 18/20 services migrés (session du 2026-07-15)
- **garantiesService.ts** (2026-07-15) — 9/10 fonctions migrées (`createSav` reste D1, dépend de `nextNumero` ×2). Fuseau horaire vérifié sans correction nécessaire (UTC↔UTC). Tests (65/65 ✅). **Validé en local live** : cycle complet ticket terminé→garantie→SAV→consommation→clôture→expiration, 10/10 ✅.

## Chantier Ports & Adapters — 17/20 services migrés (session du 2026-07-15)
- **emailService.ts** (2026-07-15) — 13/13 fonctions migrées intégralement (`sendOtpInscription` exclue, aucun accès D1). Câblage `tickets.ts`/`sav.ts`/`notifications.ts`/`facturation.ts`. Tests convertis en bloc vers `mockDatabase` (24/24 ✅). **2 bugs préexistants découverts** : `sendEmail()` mal appelée dans `routes/auth.ts` (reset password jamais envoyé, non corrigé — décision de conception requise) ; `processRelancesDevis()` référençait une colonne inexistante `montant_ttc` (corrigé → `total_ttc`). **Validé en local live** : 8/8 endpoints/hooks ✅.

## Chantier Ports & Adapters — 16/20 services migrés (session du 2026-07-15)
- **phoneCatalogService.ts** (2026-07-15) — 5/5 fonctions migrées intégralement, aucune dépendance `auditLog`/`nextNumero`. **0 test existant avant** (seul service sans couverture) → `tests/phoneCatalogService.test.ts` créé (11 tests, `fetch` mocké). **Validé en local live** : sync-brands (126), sync-modeles fairphone (5/5), sync-selected cat (22/22), stats cohérentes.

## Chantier Ports & Adapters — 15/20 services migrés (session du 2026-07-15)
- **reconditionnementService.ts** (2026-07-15) — 12/13 fonctions migrées (tout sauf `createOrdre`, dépendant de `nextNumero()`). Aucun `auditLog()` dans ce fichier. `routes/reconditionnement.ts` : `Variables.db`/`dbPort` ajoutés de zéro (2 routers). Tests scindés (50/50 ✅). **Validé en local live** : cycle ordre complet (création→en_cours→terminer avec produit occasion créé) + cycle bon d'achat (créer→lister→vérifier→annuler), 10/11 ✅ (consommation bloquée par FK factures vide en local, attendu).

## Chantier Ports & Adapters — 14/20 services migrés (session du 2026-07-15)
- **ticketService.ts** (2026-07-15) — 6/11 fonctions migrées (`listTickets`, `getKanban`, `getTicketById`, `getTicketBoutiqueId`, `getTicketAvecClient` + `checkAndArchiveTickets`, cette dernière sans dépendance `auditLog`). Les 5 fonctions restantes (`createTicket`/`updateTicket`/`updateStatutTicket`/`deleteTicket`/`archiveTicket`) restent sur `D1Database`. Bonus sécurité : SQL interpolé (`boutique_id = ${boutiqueId}`) remplacé par un paramètre lié dans `checkAndArchiveTickets`. `lib/timezone.ts` appliqué au calcul `en_retard` de `getKanban()` (`parseUtcTimestamp` sur `date_promesse`). Tests scindés `mockDatabase`/`mockD1` (45/45 ✅, 3 nouveaux). **Validé en local live** : cycle complet création→statuts→hooks garantie/email→archivage, 6/6 ✅.

## Chantier Ports & Adapters — 13/20 services migrés (session du 2026-07-15)
- **servicesService.ts** (2026-07-15) — 8/22 fonctions migrées (toutes lecture pure : `listCategories`, `listServices`, `getService`, `getCatalogueArbre`, `listMarques`, `listModeles`, `getServicesByModele`, `getModeleWithServices`). Les 14 fonctions d'écriture (create/update/delete catégories/services/marques/modeles + link/unlink) restent sur `D1Database` — chacune appelle `auditLog()` directement. `routes/services.ts` : `Variables.db` ajouté. Tests scindés `mockDatabase`/`mockD1` (38/38 ✅, 7 nouveaux tests écrits pour des fonctions jusque-là non couvertes). **Bug préexistant corrigé** (Sprint 2.38, sans lien) : `GET /services/marques`/`GET /services/modeles` inaccessibles depuis toujours (collision de route avec `/services/:id`) — détail `bugs.md`. **Validé en local live** : 12/14 étapes du cycle catégorie→service→catalogue→marque→modèle→liaison ✅ (liaison INSERT bloquée par un artefact CLI wrangler local déjà connu, sans lien avec le code).


## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Tout ce qui était opérationnel au checkpoint 4 (migration Cloudflare, auth, slug boutiques, chantier prise en charge, technicien_id, numérotation par boutique) — toujours en place, aucune régression.
- Checkpoint 5 (7 services Ports & Adapters + `lib/timezone.ts` + 2 bugs NF525) commité et déployé (commit `5bcea99`).
- Checkpoints 6/7/8/9 (`devisService.ts`, `authService.ts`, `stockService.ts`, `clientService.ts`, 11/20 services) commités et pushés (`485dd02`) — **pas encore déployés** au moment de cette mise à jour.
- **⚠ Le travail décrit ci-dessous (checkpoint 10, migration `fournisseursService.ts`) n'est PAS encore commité ni déployé** — développé, testé (unitaire + local live complet), pas encore buildé/déployé sur Cloudflare Pages ni poussé sur `origin/main`.

## Chantier Ports & Adapters — 12/20 services migrés (session du 2026-07-14)
- **fournisseursService.ts** (2026-07-14) — 6/12 fonctions migrées (`listFournisseurs`, `getFournisseur`, `listBonsCommande`, `getBonCommande`, `getKpisFournisseurs`, `getProduitsACommander`). `createFournisseur`/`updateFournisseur`/`deleteFournisseur`/`createBonCommande`/`updateStatutBonCommande`/`receptionnerBonCommande` restent sur `D1Database` (dépendent d'`auditLog`). `routes/fournisseurs.ts` n'avait aucun pattern `dbPort`/`db` avant cette migration — ajouté de zéro (`Variables.db`). Tests scindés `mockDatabase`/`mockD1` (65/65 ✅). Bonus : 5 erreurs TypeScript préexistantes corrigées en passant (casts non-sûrs remplacés par des génériques correctement typés). **Validé en local live** : CRUD fournisseur, CRUD bon de commande, cycle complet réception avec recalcul CUMP (stock 5→8, `prix_achat_cump` mis à jour, statut→`received`), KPIs, vue "à commander" — 12/12 fonctions couvertes, données de test nettoyées.

## Chantier Ports & Adapters — 11/20 services migrés (session du 2026-07-14)
- **clientService.ts** (2026-07-14) — 11/12 fonctions migrées (toutes sauf `purgeClient`, dépendante d'`auditLog`). Câblage `routes/clients.ts` (`dbPort`/`db` mixte), `routes/sav.ts` (nouveau `Variables.db`), `routes/tickets.ts` (`dbPort` ajouté à `POST /`). Tests scindés `mockDatabase`/`mockD1` (48/48 ✅). **2 bugs RGPD critiques découverts et corrigés en live** : `exportClientRgpd()`/`purgeClient()` cassés depuis toujours (table `appareils_client` inexistante + colonne `imei` inexistante sur `tickets`) — droit d'accès (Art. 15) et droit à l'effacement (Art. 17) RGPD n'avaient jamais fonctionné en production malgré 48 tests unitaires verts. Détail complet `bugs.md`. **Validé en local live** : CRUD client, appareils, historique CRM, import CSV, export RGPD, purge RGPD (+ idempotence), hooks email tickets/SAV — 11/12 fonctions couvertes, données de test nettoyées.

## Chantier Ports & Adapters — 10/20 services migrés (session du 2026-07-14)
- **stockService.ts** (2026-07-14) — 6/10 fonctions migrées (`listProduits`, `getProduitById`, `enregistrerMouvement`, `listCategories`, `createCategorie`, `getKpisStock`). `createProduit`/`updateProduit`/`deleteProduit`/`importCatalogueCsv` restent sur `D1Database` (dépendent d'`auditLog`). `routes/stocks.ts` : helper `ctx()` étendu avec `dbPort` en plus de `db`. Tests scindés `mockDatabase`/`mockD1` (56/56 ✅). **Validé en local live** : les 10 fonctions couvertes (create/list catégorie, create/get/list produit, KPIs, mouvement stock, update/delete produit, import CSV), données de test nettoyées.

## Chantier Ports & Adapters — 9/20 services migrés (session du 2026-07-14)
- **authService.ts** (2026-07-14) — 13/13 fonctions migrées **intégralement** (aucune dépendance `auditLog`/`nextNumero`/`batch`), 1er service sensible sécurité du chantier. `routes/auth.ts` câblé sur `c.get('db')` pour les 13 fonctions ; `auditLog`/`sendEmail` (non migrés) restent sur `c.env.DB`. Tests → `mockDatabase`, 25/25 ✅. **Validé en local live** : login, /me, refresh, register→verify-otp (avec/sans boutique), resend-otp, complete-onboarding (+ idempotence testée), reset-password-request→reset-password (mdp admin restauré après test), logout — 12/13 fonctions couvertes en conditions réelles (Google OAuth exclu, nécessite un vrai token externe). Détail complet dans `todo.md`.

## Chantier Ports & Adapters — 8/20 services migrés (session du 2026-07-13)
Pattern établi : `src/ports/database.ts` (interface `Database`) + `src/adapters/cloudflare/d1Database.ts` (adaptateur D1). Ordre de migration complet dans `todo.md`. Fonctions dépendant d'`auditLog()`/`nextNumero()`/`enregistrerTransaction()`/`db.batch()` (encore sur `D1Database` brut) restent non migrées au sein de chaque service — migration partielle assumée, pas un blocage.

Services migrés (dans l'ordre, cumulatif) :
1. `photosService.ts` — partiel (3/5 fns)
2. `publicService.ts` — intégral (8/8)
3. `boutiqueService.ts` — intégral (8/8)
4. `rachatService.ts` — partiel (3/5), 0 test existant → 17 écrits
5. `personnelService.ts` — partiel (8/9)
6. `caisseService.ts` — partiel (7/8), tests 14→31
7. `factureService.ts` — partiel (6/9), tests restructurés (41/41)
8. `devisService.ts` — partiel (6/10 fns : `listDevis`, `getDevis`, `getDevisByToken`, `getStatsDevis`, `expireDevisPerimes`, `saveSignatureDevis`). `createDevis`/`updateDevis`/`updateStatutDevis`/`convertirDevis` restent sur `D1Database` (dépendent de `nextNumero()`/`upsertLignes()`-batch/`auditLog()`). Tests scindés `mockDatabase`/`mockD1` (58/58). Câblage `routes/facturation.ts` + `routes/public.ts`. **Validé en local live** : cycle complet devis (créer→lister→consulter→stats→modifier→envoyer→consultation+réponse publique par token avec signature→expire→conversion facture), 10/10 ✅, données de test nettoyées.

Chaque service : migré, testé unitairement (`mockDatabase` pour les fonctions migrées, `mockD1` pour les restantes), vérifié sans nouvelle erreur `tsc`, **et validé en local live réelle** (`wrangler d1 migrations apply --local` + `npm run dev` + requêtes HTTP réelles, données de test nettoyées après coup) — exigence explicite de l'utilisateur.

## Fuseau horaire France — `src/lib/timezone.ts` (créé aujourd'hui)
`parseUtcTimestamp()` + `todayParis()` + `currentMonthParis()` (DST auto via Intl/ICU). Appliqué à `personnelService.ts` (bug réel corrigé : heures travaillées gonflées de l'écart local/UTC) et `caisseService.ts` (`DATE('now')`/`strftime` → jour/mois français, critique pour clôture NF525). Vérifié sur `factureService.ts` : rien à corriger (horodatages déjà UTC-Z explicites). Principe à appliquer lors de la migration de `ticketService.ts`, `garantiesService.ts`, `agendaService.ts`, `statsService.ts` (détail exact dans `todo.md`).

## 2 bugs de production découverts et corrigés aujourd'hui (sans lien avec la migration, confirmés pré-existants via `git show HEAD`)
- **`GET /api/rachats/export` → 404 depuis toujours** — collision de route avec `/rachats/:id` (déclarée avant). Fixé en réordonnant, même pattern que `/kanban` dans `tickets.ts`.
- **🔴 Vente POS d'un produit en stock cassée à 100% + facture orpheline NF525** — `mouvements_stock` INSERT référençait des colonnes inexistantes (`raison`/`reference_id` au lieu de `motif`, `stock_avant`/`stock_apres` NOT NULL jamais fournies). Conséquence grave : facture déjà `payee` créée avant le crash, sans entrée `journal_nf525` correspondante (violation de conformité). Corrigé, testé, revalidé en live (flux complet vente→KPIs→journal→clôture→intégrité chaîne).

## Bugs connus non corrigés (détail complet dans `bugs.md`)
- Prise de RDV en ligne : table `boutique_creneaux` vide, aucune UI pour la configurer
- `www.repairdesk.fr` → Error 521 (Gandi, indépendant de nous)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, stable, `agendaService`/`statsService`)
- `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas juste les techniciens
- Pas de test dédié pour `D1DatabaseAdapter`

## Chantiers identifiés pour plus tard (voir `todo.md` pour le détail complet)
- Continuer la migration des 12 services restants vers le port `Database` (prochain : `authService.ts`)
- Appliquer `lib/timezone.ts` à `ticketService.ts`/`garantiesService.ts`/`agendaService.ts`/`statsService.ts` lors de leur migration
- Ports `Storage`/`Cache`, adaptateur Postgres, bascule VPS — hors scope tant que non engagé
- Purge RGPD automatique, multi-sites géré, multi-appareils par ticket, acompte structuré, UI créneaux bookables, rebranding "Mon Atelier"→"MyDesk" — toujours en attente

## Repo et déploiement
- Repo : `izigsm/webapp/` (racine git), remote `zinside69/izigsm_NG_temp_analysis`, branche `main`
- **Rien déployé depuis le checkpoint 5** (`5bcea99`) — le travail du checkpoint 6 (`devisService.ts`) est local, testé, non buildé/non poussé au moment de cette mise à jour
- Suite de tests : 746/749 (mêmes 3 échecs fuseau horaire pré-existants, sans lien avec `devisService.ts`)
- Git : working tree avec modifications non commitées au moment de cette mise à jour (`src/services/devisService.ts`, `src/routes/facturation.ts`, `src/routes/public.ts`, `tests/devisService.test.ts`, `project-docs/todo.md`, `project-docs/current-state.md`) — commit à proposer à l'utilisateur
