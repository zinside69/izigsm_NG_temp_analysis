/**
 * @file src/services/mobilaxService.ts
 * @description Service Mobilax — recherche de pièces chez le grossiste et import d'une pièce
 * dans le stock, au nom d'une boutique (tickets 03 et 04, chantier `integration-mobilax`).
 *
 * **Seul point du dépôt qui manipule la forme brute d'une réponse Mobilax.** L'API n'a pas
 * d'enveloppe uniforme (`POST /auth` à plat, `GET /products` sous `data` sans `status`,
 * `GET /products/:id/full` sous `{ status, data }`) : tout ce qui sort d'ici est normalisé,
 * aucun appelant ne lit jamais un champ Mobilax brut.
 *
 * Modelé sur `phoneCatalogService` : `fetch` natif, port `Database` pour les données locales.
 * Référence de l'API et mesures réelles : `project-docs/recherche-api-mobilax-2026-09-09.md`.
 */

import type { Database } from '../ports/database'
import type { D1KVNamespace } from '../lib/d1kv'
import { chiffrer, dechiffrer } from '../lib/chiffrement'
import { trouverFournisseurApi, getApiKeyDechiffree } from './fournisseursService'
import { createProduit, trouverProduitImporte, trouverOuCreerCategorie } from './stockService'
import { getBoutiqueSettings, resoudreTauxMarge } from './boutiqueService'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Produit Mobilax sous la seule forme qui sort de ce service. */
export interface ProduitMobilax {
  /** Identifiant Mobilax (la référence n'est portée que par la fiche complète, `/:id/full`). */
  mobilax_id:    number
  nom:           string
  /** EAN13 — cherchable par la recherche texte, contrairement à la référence (mesuré). */
  ean13:         string | null
  /** Prix d'achat HT du compte (`price`, seul champ de prix confirmé fiable). */
  prix_achat_ht: number | null
  /** Quantité affichée par Mobilax — indication, jamais une promesse (check-stock). */
  stock:         number
}

export type ErreurMobilax =
  | 'sans_fournisseur' | 'plusieurs_fournisseurs' | 'sans_cle' | 'cle_illisible'
  | 'cle_refusee' | 'quota' | 'indisponible'
  | 'introuvable' | 'deja_importe'

/** Échec nommé, avec le message destiné à l'opérateur. */
export interface EchecMobilax {
  ok:                false
  erreur:            ErreurMobilax
  message:           string
  reessayer_dans_s?: number
  /** `deja_importe` : le produit du stock qui porte déjà cette pièce. */
  produit_id?:       number
}

export type ResultatRechercheMobilax =
  | { ok: true; total: number; page: number; pages: number; produits: ProduitMobilax[] }
  | EchecMobilax

export type ResultatImportMobilax =
  | { ok: true; produit_id: number }
  | EchecMobilax

/** Dépendances injectées — tout ce que le service touche hors de lui-même. */
export interface DepsMobilax {
  db:             Database
  kv:             D1KVNamespace
  /** Secret de plateforme `FOURNISSEUR_CRYPTO_KEY`. */
  cleChiffrement: string
  /** `MOBILAX_API_BASE` — préproduction ou production, jamais codée en dur. */
  baseUrl:        string
}

/** Résultats par page de recherche — le maximum accepté par `/products` (mesuré, décision du 2026-09-11). */
const LIMITE_RESULTATS = 100

/** Longueur maximale gardée de la description Mobilax (HTML de plusieurs ko, mesuré). */
const DESCRIPTION_MAX = 2000

// ─── Recherche ────────────────────────────────────────────────────────────────

/**
 * Cherche des pièces Mobilax par nom ou EAN, avec la clé de la boutique appelante.
 *
 * @param deps        Dépendances (base, KV, secret, adresse de l'API)
 * @param boutiqueId  Boutique appelante — c'est SA clé qui est utilisée, jamais une autre
 * @param terme       Texte cherché (nom, EAN13)
 * @param page        Page demandée (1 par défaut), de `LIMITE_RESULTATS` pièces — une par appel
 * @returns           Produits normalisés avec `page`/`pages`, ou une erreur nommée
 */
export async function rechercherProduitsMobilax(
  deps: DepsMobilax, boutiqueId: number, terme: string, page = 1
): Promise<ResultatRechercheMobilax> {
  const cle = await resoudreCle(deps, boutiqueId)
  if (!cle.ok) return cle.echec

  try {
    const url = `${deps.baseUrl}/products?search=${encodeURIComponent(terme)}&page=${page}&limit=${LIMITE_RESULTATS}`
    const appel = await appelerMobilax(deps, boutiqueId, cle.apiKey, url)
    if (!appel.ok) return appel.echec
    if (!appel.rep.ok) return indisponible()

    // `GET /products` : `{ data: { total, products } }`, sans `status` (mesuré le 2026-09-11).
    // Une autre forme n'est PAS une recherche vide : la présenter comme « aucune pièce »
    // cacherait un changement d'API derrière un résultat plausible.
    const corps = await appel.rep.json() as {
      data?: { total?: unknown; currentPage?: unknown; totalPage?: unknown; products?: unknown }
    }
    if (!Array.isArray(corps.data?.products)) return indisponible()
    const produits = corps.data.products.map(versProduitMobilax)
      .filter((p): p is ProduitMobilax => p !== null)
    const total = Number(corps.data.total)
    // `totalPage` au singulier et `currentPage` en camelCase (mesuré) — à défaut, la page demandée
    const pages = Number(corps.data.totalPage)
    const pageRendue = Number(corps.data.currentPage)
    return {
      ok: true,
      total: Number.isFinite(total) ? total : produits.length,
      page:  Number.isInteger(pageRendue) && pageRendue > 0 ? pageRendue : page,
      pages: Number.isInteger(pages) && pages > 0 ? pages : 1,
      produits,
    }
  } catch {
    return indisponible()
  }
}

// ─── Import dans le stock (ticket 04) ─────────────────────────────────────────

/**
 * Importe une pièce Mobilax comme produit du stock de la boutique.
 *
 * Nom, description, référence et prix d'achat sont **relus chez Mobilax** (`/:id/full`) au
 * moment de l'import — jamais pris dans ce qu'envoie le navigateur (décision du 2026-09-11) :
 * le coût enregistré est celui du fournisseur. Défauts, tous modifiables ensuite : prix de
 * vente = prix d'achat × marge résolue (famille « pièce », sinon défaut boutique ; 0 sans
 * taux — `null` n'est jamais remplacé par un taux inventé, décision du 2026-09-10), stock 0,
 * seuil d'alerte 0. ⚠ Ce seuil n'évite PAS l'alerte de rupture : le dépôt compare
 * `stock_actuel <= stock_minimum`, 0 ≤ 0 est vrai (`todo.md`, décision à prendre).
 *
 * Un produit par pièce : une pièce déjà importée (même fiche fournisseur, même référence) est
 * refusée en `deja_importe`, avec l'identifiant du produit existant.
 *
 * @param deps        Dépendances, plus le binding D1 brut (`createProduit()` et son auditLog)
 * @param boutiqueId  Boutique appelante — propriétaire exclusive du produit créé
 * @param userId      Utilisateur qui importe (mouvement, audit)
 * @param mobilaxId   Identifiant Mobilax de la pièce (issu d'un résultat de recherche)
 * @returns           `{ ok, produit_id }`, ou une erreur nommée
 */
export async function importerProduitMobilax(
  deps: DepsMobilax & { d1: D1Database }, boutiqueId: number, userId: number, mobilaxId: number
): Promise<ResultatImportMobilax> {
  const cle = await resoudreCle(deps, boutiqueId)
  if (!cle.ok) return cle.echec

  let fiche: FicheMobilax | null
  try {
    const appel = await appelerMobilax(deps, boutiqueId, cle.apiKey, `${deps.baseUrl}/products/${mobilaxId}/full`)
    if (!appel.ok) return appel.echec
    if (appel.rep.status === 404) return echec('introuvable', 'Cette pièce n\'existe plus chez Mobilax.')
    if (!appel.rep.ok) return indisponible()
    // `GET /products/:id/full` : `{ status: 'OK', data: { … } }` (mesuré le 2026-09-11)
    const corps = await appel.rep.json() as { data?: unknown }
    fiche = versFicheMobilax(corps.data)
  } catch {
    return indisponible()
  }
  if (!fiche) return indisponible()

  const existant = await trouverProduitImporte(deps.db, boutiqueId, cle.fiche.id, fiche.reference)
  if (existant) return echec('deja_importe', 'Cette pièce est déjà dans votre stock.', { produit_id: existant.id })

  // Famille déduite de la branche Mobilax, puis marge résolue sur CETTE famille (un accessoire
  // prend le taux des accessoires, pas celui des pièces) — décisions du 2026-09-11
  const famille = await familleDepuisCategorie(deps, boutiqueId, cle.apiKey, fiche.categorie_id)
  const taux = resoudreTauxMarge(await getBoutiqueSettings(deps.db, boutiqueId), famille)
  const prixVente = taux === null ? 0 : Math.round(fiche.prix_achat_ht * (1 + taux / 100) * 100) / 100

  // Catégorie locale = catégorie Mobilax la plus fine, trouvée ou créée dans CETTE boutique
  const categorieId = fiche.categorie_nom
    ? (await trouverOuCreerCategorie(deps.db, boutiqueId, fiche.categorie_nom)).id
    : null

  const { id } = await createProduit(deps.d1, boutiqueId, userId, {
    nom:                   fiche.nom,
    // SKU = EAN (scannable) ; la référence Mobilax reste en `reference_fournisseur`
    sku:                   fiche.ean13,
    description:           fiche.description,
    famille,
    categorie_id:          categorieId,
    marque:                fiche.marque,
    prix_achat_ht:         fiche.prix_achat_ht,
    prix_vente_ht:         prixVente,
    stock_actuel:          0,
    stock_minimum:         0,
    fournisseur:           cle.fiche.nom,
    reference_fournisseur: fiche.reference,
    code_barre:            fiche.ean13,
  }, { fournisseur_id: cle.fiche.id })
  return { ok: true, produit_id: id }
}

/** Fiche complète normalisée — ce que l'import retient de `/products/:id/full`. */
interface FicheMobilax {
  nom:           string
  /** Référence Mobilax (ex. `ECRTAREAPPIPHNE12MNO`) ; l'identifiant à défaut. */
  reference:     string
  ean13:         string | null
  /** Description réduite en texte, précédée de la gamme Mobilax si elle est connue. */
  description:   string | null
  prix_achat_ht: number
  /** Catégorie Mobilax la plus fine (`categorie`), pour la famille et la catégorie locale. */
  categorie_id:  number | null
  categorie_nom: string | null
  /** Marque de l'appareil compatible (`models.brand_name`) — `manufacturer_brand` est nul (mesuré). */
  marque:        string | null
}

/** Normalise `data` de `/products/:id/full` ; `null` si nom ou prix manquent. */
function versFicheMobilax(d: any): FicheMobilax | null {
  const prix = Number(d?.price)
  const nom = String(d?.name ?? d?.short_name ?? '').trim()
  if (!nom || !Number.isFinite(prix)) return null
  // `models` est un objet dans les réponses mesurées, un tableau dans la doc : les deux lus
  const modele = Array.isArray(d.models) ? d.models[0] : d.models
  const gamme = d.mobilax_brand?.name ? `Gamme Mobilax : ${String(d.mobilax_brand.name)}` : null
  const texte = d.description ? texteBrut(String(d.description)) || null : null
  const categorieId = Number(d.categorie?.id)
  return {
    nom,
    reference:     String(d.reference ?? d.id),
    ean13:         d.ean13 ? String(d.ean13) : null,
    description:   [gamme, texte].filter(Boolean).join('\n') || null,
    prix_achat_ht: prix,
    categorie_id:  Number.isInteger(categorieId) ? categorieId : null,
    categorie_nom: d.categorie?.name ? String(d.categorie.name) : (d.category_name ? String(d.category_name) : null),
    marque:        modele?.brand_name ? String(modele.brand_name) : null,
  }
}

/**
 * Famille iziGSM d'une pièce, déduite de la branche racine de sa catégorie Mobilax.
 *
 * Correspondance sur le DÉBUT du nom de la racine, pas sur son identifiant : la préproduction
 * nomme « Accessoires test permission » ce que la production nomme « Accessoires » (mesuré).
 * Pièces… → pièce · Accessoire… → accessoire · Mobile / Tablette… → appareil · le reste
 * (Informatique, Équipement, E-Mobility…) → consommable. Arbre illisible → pièce, le défaut
 * historique de l'import : une panne du référentiel ne bloque pas l'import.
 *
 * `/catalog/*` ne relève d'aucun quota (mesuré : aucun en-tête `ratelimit`) ; l'arbre pèse
 * environ 280 ko, relu à chaque import plutôt que gardé — l'import est un geste rare.
 */
async function familleDepuisCategorie(
  deps: DepsMobilax, boutiqueId: number, apiKey: string, categorieId: number | null
): Promise<'piece' | 'accessoire' | 'appareil' | 'consommable'> {
  if (categorieId === null) return 'piece'
  try {
    const appel = await appelerMobilax(deps, boutiqueId, apiKey, `${deps.baseUrl}/catalog/categories`)
    if (!appel.ok || !appel.rep.ok) return 'piece'
    const arbre = (await appel.rep.json() as { data?: unknown }).data
    if (!Array.isArray(arbre)) return 'piece'
    const parId = new Map(arbre.map((c: any) => [Number(c.id), c]))
    // Remontée jusqu'à la racine, bornée : un arbre bouclé ne doit pas bloquer l'import
    let noeud = parId.get(categorieId)
    for (let i = 0; noeud && parId.has(Number(noeud.id_parent)) && i < 20; i++) noeud = parId.get(Number(noeud.id_parent))
    const racine = String(noeud?.name ?? '').toLowerCase()
    if (racine.startsWith('pièce') || racine.startsWith('piece')) return 'piece'
    if (racine.startsWith('accessoire')) return 'accessoire'
    if (racine.startsWith('mobile') || racine.startsWith('tablette')) return 'appareil'
    return noeud ? 'consommable' : 'piece'
  } catch {
    return 'piece'
  }
}

/**
 * Description Mobilax (HTML) → texte brut : blocs en retours à la ligne, entités décodées,
 * balises retirées, tronqué. Rien de ce HTML tiers n'est gardé tel quel en base.
 *
 * Ordre voulu : décoder AVANT de retirer les balises, puis retirer tout `<`/`>` restant.
 * Dans l'autre sens, un `&lt;img onerror…&gt;` redevenait une vraie balise après le
 * nettoyage (trouvé en revue du ticket 04). Le texte produit ne contient donc jamais de
 * chevron — un futur affichage devra tout de même l'échapper, comme toute donnée tierce.
 */
function texteBrut(html: string): string {
  const entites: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", eacute: 'é', egrave: 'è',
    ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', euro: '€',
  }
  return html
    .replace(/<\s*(br|\/p|\/h[1-6]|\/li|\/div)\s*\/?>/gi, '\n')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] !== '#' ? (entites[e.toLowerCase()] ?? m)
      : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))))
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, DESCRIPTION_MAX)
}

// ─── Clé de la boutique ───────────────────────────────────────────────────────

type AccesMobilax =
  | { ok: true; fiche: { id: number; nom: string }; apiKey: string }
  | { ok: false; echec: EchecMobilax }

/** Quelle fiche, quelle clé : tout est vérifié AVANT le moindre appel à Mobilax. */
async function resoudreCle(deps: DepsMobilax, boutiqueId: number): Promise<AccesMobilax> {
  const fiches = await trouverFournisseurApi(deps.db, boutiqueId, 'mobilax')
  if (fiches.length === 0) return { ok: false, echec: echec('sans_fournisseur',
    'Aucun fournisseur n\'est marqué « Mobilax ». Cochez la case dans sa fiche (Fournisseurs).') }
  if (fiches.length > 1) return { ok: false, echec: echec('plusieurs_fournisseurs',
    'Plusieurs fournisseurs sont marqués « Mobilax ». N\'en gardez qu\'un seul coché.') }
  if (!fiches[0].a_cle) return { ok: false, echec: sansCle() }

  // Une clé chiffrée avec un autre secret (FOURNISSEUR_CRYPTO_KEY tourné) ne se déchiffre
  // plus : message sur la clé, jamais un 500 brut remonté à l'écran.
  let apiKey: string | null
  try {
    apiKey = await getApiKeyDechiffree(deps.db, fiches[0].id, boutiqueId, deps.cleChiffrement)
  } catch {
    return { ok: false, echec: echec('cle_illisible',
      'La clé API Mobilax enregistrée est illisible. Ressaisissez-la dans la fiche du fournisseur Mobilax.') }
  }
  if (!apiKey) return { ok: false, echec: sansCle() }
  return { ok: true, fiche: { id: fiches[0].id, nom: fiches[0].nom }, apiKey }
}

// ─── Appel authentifié ────────────────────────────────────────────────────────

type Appel = { ok: true; rep: Response } | { ok: false; echec: EchecMobilax }

/**
 * `GET` authentifié vers Mobilax. Rend la réponse pour tout statut que l'appelant sait lire
 * (200, 404…) ; traite lui-même le jeton, le quota et le 401.
 *
 * Aucune nouvelle tentative à l'aveugle : un quota atteint est rendu tel quel à l'opérateur,
 * avec le délai annoncé par Mobilax (quota partagé par toute la boutique). Au plus deux
 * passages : la doc dit de renouveler le jeton sur un 401. Renouvellement fait par une
 * nouvelle connexion (`POST /auth`) plutôt que par `/auth/refresh-token` : aucun jeton de
 * renouvellement à garder en plus, et les deux routes relèvent du même quota `/auth`. Une
 * seule fois, et seulement si le jeton refusé venait du KV — un jeton tout neuf refusé met la
 * clé en cause, le redemander ne ferait que brûler ce quota.
 *
 * Peut lever (réseau coupé) : l'appelant rattrape en `indisponible`.
 */
async function appelerMobilax(deps: DepsMobilax, boutiqueId: number, apiKey: string, url: string): Promise<Appel> {
  const cleKv = `mobilax:jeton:${boutiqueId}:${await empreinte(apiKey)}`
  for (let passage = 1; passage <= 2; passage++) {
    const jeton = await obtenirJeton(deps, cleKv, apiKey)
    if (!jeton.ok) return { ok: false, echec: jeton.echec }

    const rep = await fetch(url, { headers: { Authorization: `Bearer ${jeton.token}` } })
    if (rep.status === 401) {
      await deps.kv.delete(cleKv)
      if (jeton.depuisKv && passage === 1) continue
      return { ok: false, echec: cleRefusee() }
    }
    if (rep.status === 429) return { ok: false, echec: quotaAtteint(rep) }
    if (rep.status >= 500) return { ok: false, echec: indisponible() }
    return { ok: true, rep }
  }
  return { ok: false, echec: cleRefusee() }
}

// ─── Jeton ────────────────────────────────────────────────────────────────────
//
// Sans jeton gardé, chaque appel consommerait une connexion : le quota `/auth` (10/min,
// partagé par toute la boutique) plafonnerait la recherche à 10 par minute. Le jeton est donc
// gardé dans le KV, CHIFFRÉ (c'est un secret, même d'une heure), le temps annoncé par
// `expireIn` moins une minute. La clé KV porte une empreinte de la clé API : une clé changée
// (rotation) ne réutilise jamais le jeton de l'ancienne, sans code de nettoyage à maintenir.

/** Marge retirée de la durée annoncée, pour ne jamais présenter un jeton sur le point d'expirer. */
const MARGE_JETON_S = 60

/** `depuisKv` : le jeton vient du KV (il a pu expirer chez Mobilax avant sa date annoncée). */
type Jeton = { ok: true; token: string; depuisKv: boolean } | { ok: false; echec: EchecMobilax }

/**
 * Renvoie un jeton : celui gardé s'il existe, sinon une nouvelle connexion.
 * @param cleKv Clé KV du jeton — `mobilax:jeton:<boutique>:<empreinte de la clé API>`
 */
async function obtenirJeton(deps: DepsMobilax, cleKv: string, apiKey: string): Promise<Jeton> {
  const garde = await deps.kv.get(cleKv)
  if (garde) {
    // Indéchiffrable (secret tourné) : oublié et remplacé par une connexion — sinon la
    // recherche resterait en panne jusqu'à l'expiration de l'entrée, jusqu'à une heure.
    try {
      return { ok: true, token: await dechiffrer(garde, deps.cleChiffrement), depuisKv: true }
    } catch {
      await deps.kv.delete(cleKv)
    }
  }

  const auth = await fetch(`${deps.baseUrl}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  if (auth.status === 429) return { ok: false, echec: quotaAtteint(auth) }
  // Toutes les erreurs d'authentification Mobilax sont des 401 (clé invalide, désactivée,
  // client inactif — doc) : c'est la clé qui est en cause, pas une panne.
  if (auth.status === 401 || auth.status === 403) return { ok: false, echec: cleRefusee() }
  if (!auth.ok) return { ok: false, echec: indisponible() }

  // `POST /auth` répond à plat, ni `status` ni `data` : `{ token, refreshToken, expireIn }`
  const { token, expireIn } = await auth.json() as { token?: string; expireIn?: unknown }
  if (!token) return { ok: false, echec: indisponible() }

  // Durée jamais codée en dur : illisible → rien de gardé, plutôt qu'une durée inventée
  const duree = dureeEnSecondes(expireIn)
  if (duree !== null && duree > MARGE_JETON_S)
    await deps.kv.put(cleKv, await chiffrer(token, deps.cleChiffrement), { expirationTtl: duree - MARGE_JETON_S })
  return { ok: true, token, depuisKv: false }
}

/**
 * Convertit `expireIn` en secondes. Mesuré : `"1h"` en préproduction, `"120m"` dans la doc —
 * une chaîne, pas un nombre. Accepte `s`, `m`, `h`, `d`, ou un nombre nu de secondes.
 * @returns Secondes, ou `null` si la valeur n'est pas lisible
 */
function dureeEnSecondes(expireIn: unknown): number | null {
  const m = /^\s*(\d+)\s*([smhd]?)\s*$/.exec(String(expireIn ?? ''))
  if (!m) return null
  const facteur = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as '' | 's' | 'm' | 'h' | 'd']
  return Number(m[1]) * facteur
}

/** Empreinte courte (SHA-256, 16 hex) d'une clé API — jamais la clé elle-même dans le KV. */
async function empreinte(valeur: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valeur))
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// ─── Échecs nommés ────────────────────────────────────────────────────────────

/** Échec avec le message destiné à l'opérateur ; précisions (délai, produit existant) en option. */
function echec(
  erreur: ErreurMobilax, message: string,
  precisions: { reessayer_dans_s?: number; produit_id?: number } = {}
): EchecMobilax {
  return { ok: false, erreur, message, ...precisions }
}

/** La fiche Mobilax ne porte pas de clé API. */
function sansCle(): EchecMobilax {
  return echec('sans_cle',
    'Le fournisseur Mobilax n\'a pas de clé API. Renseignez-la dans sa fiche (Fournisseurs).')
}

/** Mobilax refuse la clé (ou un jeton tout juste obtenu avec elle). */
function cleRefusee(): EchecMobilax {
  return echec('cle_refusee',
    'Mobilax refuse la clé API enregistrée. Vérifiez-la dans la fiche du fournisseur Mobilax.')
}

/** 429 : délai lu dans `ratelimit-reset` (en-tête mesuré présent), sinon message sans chiffre. */
function quotaAtteint(rep: Response): EchecMobilax {
  const reset = Number(rep.headers.get('ratelimit-reset'))
  return Number.isFinite(reset) && reset > 0
    ? echec('quota', `Limite d'appels Mobilax atteinte. Réessayez dans ${reset} s.`, { reessayer_dans_s: reset })
    : echec('quota', 'Limite d\'appels Mobilax atteinte. Réessayez dans quelques instants.')
}

/** Panne réseau, réponse 5xx ou réponse illisible. */
function indisponible(): EchecMobilax {
  return echec('indisponible', 'Mobilax ne répond pas pour le moment. Réessayez plus tard.')
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise un produit brut de `GET /products` — le seul endroit qui lit ses champs.
 * @returns `null` si l'identifiant n'est pas un entier : c'est le lien stable vers la pièce
 *          (c'est par lui que l'import relit la fiche, ticket 04), un `NaN` ne doit jamais en sortir
 */
function versProduitMobilax(p: any): ProduitMobilax | null {
  const id = Number(p?.id)
  if (!Number.isInteger(id)) return null
  const prix = Number(p.price)
  return {
    mobilax_id:    id,
    nom:           String(p.name ?? p.short_name ?? ''),
    ean13:         p.ean13 ? String(p.ean13) : null,
    prix_achat_ht: Number.isFinite(prix) ? prix : null,
    stock:         Number(p.quantity) || 0,
  }
}
