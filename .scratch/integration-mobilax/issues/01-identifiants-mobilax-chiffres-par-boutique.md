# 01 — Identifiants Mobilax chiffrés par boutique

**What to build:** une boutique enregistre et modifie sa propre clé API Mobilax depuis l'écran de
gestion des fournisseurs déjà existant. La clé est stockée chiffrée au repos (chiffrement
réversible, clé d'enveloppe portée par un secret de plateforme) et **n'apparaît jamais en clair**
dans une réponse API qui liste ou lit une boutique ou son fournisseur. Un admin plateforme ne
peut ni lire ni utiliser la clé d'une boutique cliente.

**Blocked by:** None — peut démarrer immédiatement.

**Status:** done

- [x] Une boutique peut enregistrer/modifier sa clé Mobilax depuis l'écran de gestion des
      fournisseurs existant (pas de nouvel écran) — champ `#f-api-key` sur le formulaire
      existant, jamais pré-rempli en édition (la valeur n'est jamais renvoyée)
- [x] La clé est chiffrée au repos — chiffrement réversible (le serveur doit pouvoir la
      déchiffrer pour appeler Mobilax au nom de la boutique), clé d'enveloppe en secret de
      plateforme — `src/lib/chiffrement.ts`, AES-GCM, `FOURNISSEUR_CRYPTO_KEY`
- [x] Aucune réponse API lisant ou listant une boutique/fournisseur ne renvoie la valeur en
      clair — test dédié, garde-fou direct contre le défaut déjà trouvé sur `email_api_key`
      (`bugs.md` § du même titre). Double protection : colonnes SQL explicites (jamais
      `SELECT *`) **et** mapping de sortie explicite (`versFournisseurPublic()`) qui omet le
      champ même si la ligne source le portait
- [x] Un admin plateforme ne peut ni lire ni utiliser la clé Mobilax d'une boutique cliente —
      même discipline d'isolation que le reste des routes par ID. Par construction :
      `getApiKeyDechiffree()` n'est exposée par aucune route, et `GET /fournisseurs/:id`
      applique déjà `assertBoutiqueOwnership`
- [ ] Une tentative d'usage Mobilax sans clé configurée produit un message clair, jamais un
      échec silencieux — **relève en réalité du ticket 03** : ce ticket-ci ne construit aucun
      chemin qui *utilise* Mobilax, seulement le stockage. `getApiKeyDechiffree()` renvoie déjà
      `null` proprement (jamais une exception) pour que le ticket 03 puisse produire ce message
      sans avoir à gérer une erreur
- [x] Test vu rouge avant le correctif ; le chiffrement/déchiffrement est testé contre
      l'implémentation réelle de Web Crypto, jamais mocké (même parti pris que le chaînage
      SHA-256 de NF525) — 4 tests dans `tests/chiffrement.test.ts`, 8 dans
      `tests/fournisseursService.test.ts`, 1 test E2E (`fournisseur-api-key-chiffree.spec.ts`)

## Trouvé en marge, hors périmètre de ce ticket

En écrivant le test E2E, découverte que l'écran `/fournisseurs` n'affiche **jamais** son
contenu, sur aucun des trois onglets, pour personne — défaut préexistant sans rapport avec
Mobilax (`bugs.md` § « Le contenu de `/fournisseurs` est invisible... », `todo.md` 🔴 P1). Le
test contourne ce défaut (lecture par l'API, appel direct de `openModalFournisseur()`) plutôt
que de le corriger — hors périmètre de ce ticket.

## Gates

vitest **945/947** (+16 vs baseline ; les 2 échecs restent les permanents `agendaService`),
Playwright **196/196** (+1 vs baseline 195), tsc **32** inchangé, build ✓.

## Revue à deux axes (2026-09-10)

Standards : aucune violation dure. Spec : aucune dérive de périmètre, deux points corrigés
après revue — `getApiKeyDechiffree()` vérifie désormais elle-même `boutique_id` (n'attendait
pas un futur appelant pour le faire), et `FOURNISSEUR_CRYPTO_KEY` est documentée dans
`wrangler.jsonc`, `docs/DEPLOIEMENT.md`, `docs/INSTALLATION.md`, `README.md`.
