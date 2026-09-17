# 12 — Pose d'une pièce

**What to build:** un technicien — celui du ticket ou un collègue — marque une pièce comme **posée** :
elle sort du stock à cet instant, une seule fois, et son auteur est conservé. Une pièce absente du
stock ajoutée à un ticket passe **« à commander » avec le numéro du ticket** qui l'attend, et le
ticket affiche « pièce en attente ». Un devis refusé ne fait rien bouger.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 55 à 61 ; décision « Lignes de ticket ») ;
vocabulaire `CONTEXT.md` (Pose).

**Blocked by:** 11 — Lignes de ticket.

**Status:** ready-for-agent

- [ ] Action « posée » sur une ligne de pièce, ouverte à tout technicien de la boutique ; date et
      auteur enregistrés
- [ ] La pose écrit **un** mouvement de stock (sortie, motif lié au ticket), écrêtage à 0 comme en
      caisse — prouvé sur la vraie base locale
- [ ] Une seconde pose de la même ligne est **refusée** (test de route et test en base)
- [ ] Pièce en rupture ajoutée : la ligne est « à commander », la pièce apparaît dans la liste « à
      commander » **avec le ticket**, le ticket affiche « pièce en attente » ; l'état redevient
      disponible quand le stock le permet
- [ ] Retirer une ligne déjà posée est refusé, ou remet la pièce en stock par un mouvement tracé —
      choix documenté dans le ticket, jamais une suppression silencieuse
- [ ] La règle « sous le seuil » continue de passer par le fragment SQL commun (garde-fou vert)
- [ ] E2E : poser une pièce, relire le stock, tenter une seconde pose ; ajouter une pièce en rupture
      et la voir dans « à commander » avec le ticket ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
