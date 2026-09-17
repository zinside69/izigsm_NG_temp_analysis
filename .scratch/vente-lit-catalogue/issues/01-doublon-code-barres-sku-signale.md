# 01 — Doublon de code-barres ou de SKU signalé clairement

**What to build:** un responsable de boutique qui crée un produit — à la main ou par import CSV —
avec un code-barres ou un SKU déjà porté par un autre produit actif de sa boutique reçoit un message
qui **nomme le produit existant**, au lieu d'une erreur de base de données. La règle « un
code-barres, un produit » devient vraie en base : la migration d'unicité déjà écrite (index uniques
partiels sur le code-barres et le SKU, produits actifs, code non vide) part avec ce ticket.
Préalable au scan : la douchette suppose qu'un code désigne un seul produit.
Spec : `.scratch/vente-lit-catalogue/spec.md` (story 36, décision « Unicité des codes ») ;
vocabulaire `CONTEXT.md` (Code-barres, SKU).

**Blocked by:** None — can start immediately.

**Status:** done (2026-09-17)

- [x] La migration d'unicité du code-barres et du SKU est testée contre un vrai SQLite : un doublon
      actif est refusé ; deux produits sans code, un produit inactif et deux boutiques différentes
      ne le sont pas — avec un **témoin sans la migration** (mutation : retirée, 3 tests rouges)
- [x] Création manuelle d'un produit dont le code-barres est déjà pris : refus explicite nommant le
      produit existant (409), vu rouge d'abord — sur la vraie base locale, la violation donnait **500**
- [x] Même chose pour un SKU déjà pris
- [x] ~~Import CSV : la ligne en doublon est rapportée dans le bilan de l'import avec le produit
      existant, les autres lignes passent~~ — **sans objet, mesuré** : l'import CSV fait un UPSERT
      sur le SKU (un SKU déjà pris part en mise à jour, jamais en violation) et **n'écrit pas la
      colonne `code_barre`**. Seule une écriture concurrente rapporterait encore le message brut.
      Ce second point est un **défaut distinct** (colonne documentée, ignorée) : `bugs.md`.
- [x] L'import fournisseur garde son comportement (`deja_importe`) — et gagne un cas : une pièce
      dont l'EAN ou le SKU est déjà porté répondait **500** avec la migration ; elle répond
      désormais `deja_importe` en nommant le produit. SKU compris, **par décision de l'exploitant**
      (la fiche produit n'a pas de champ code-barres, l'EAN y est tapé comme SKU : même article).
      La quantité saisie n'est toujours pas ajoutée (règle du 2026-09-12, confirmée).
- [x] Toute autre erreur SQL reste relevée telle quelle (seule la violation d'unicité est convertie ;
      la contrainte fournisseur `0046` n'est pas confondue ; un porteur introuvable relève l'erreur
      d'origine)
- [x] À l'écran : message affiché dans la fiche produit (SKU), fiche restée ouverte ; message nommant
      le produit à l'import fournisseur unitaire, **en information** — E2E sur la vraie base locale.
      **Partiel, assumé** : le code-barres n'est prouvé que par l'API (la fiche n'a pas de champ
      code-barres) ; le CSV est sans objet (ci-dessus)
- [x] `npx vitest run` vert (1143/1145, les 2 échecs permanents d'`agendaService`), tsc 32 inchangé,
      E2E stock + fournisseur 67/67, balayage du menu 17/17
- [ ] Rappel de déploiement : la migration est appliquée à distance **avant** le code, et
      `d1_migrations` distant est relu entre les deux commandes — **à faire avec le déploiement du
      lot 1**

## Notes de réalisation

- **Hors du ticket, ajouté volontairement** : la **modification** d'un produit (`PUT`) convertit la
  violation de la même façon — sans cela, changer le SKU d'un produit vers une valeur prise
  renvoyait l'erreur brute. La réponse 409 porte aussi `champ` et `produit_id`.
- Revue à deux axes : aucune violation dure. Jugements non appliqués : l'idiome
  `.first().catch(...)` (nouveau dans `src/`, correct, gardé pour ne pas réindenter l'INSERT) ; la
  double lecture du message « UNIQUE constraint failed » (service de stock et import fournisseur,
  ce dernier réservé à la contrainte `0046`, inchangé).
- **Coût connu** : une pièce reconnue par son seul EAN n'est pas liée à la fiche fournisseur ;
  chaque nouvel import de cette pièce rappelle le fournisseur avant de retomber sur « déjà en
  stock ». Traité par le ticket 18.
- La quantité saisie d'une pièce déjà en stock et la reprise de la description : **ticket 18**.
