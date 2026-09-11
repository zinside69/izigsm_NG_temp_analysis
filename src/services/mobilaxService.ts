/**
 * @file src/services/mobilaxService.ts
 * @description Service Mobilax — recherche de pièces chez le grossiste, au nom d'une boutique
 * (ticket 03, chantier `integration-mobilax`).
 *
 * **Seul point du dépôt qui manipule la forme brute d'une réponse Mobilax.** L'API n'a pas
 * d'enveloppe uniforme (`POST /auth` à plat, `GET /products` sous `data` sans `status`,
 * d'autres routes avec `status`) : tout ce qui sort d'ici est normalisé (`ProduitMobilax`),
 * aucun appelant ne lit jamais un champ Mobilax brut.
 *
 * Modelé sur `phoneCatalogService` : `fetch` natif, port `Database` pour les données locales.
 * Référence de l'API et mesures réelles : `project-docs/recherche-api-mobilax-2026-09-09.md`.
 */

import type { Database } from '../ports/database'
import type { D1KVNamespace } from '../lib/d1kv'
import { chiffrer, dechiffrer } from '../lib/chiffrement'
import { trouverFournisseurApi, getApiKeyDechiffree } from './fournisseursService'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Produit Mobilax sous la seule forme qui sort de ce service. */
export interface ProduitMobilax {
  /** Identifiant Mobilax — lien stable vers la pièce (aucun champ `reference` n'existe). */
  mobilax_id:    number
  nom:           string
  /** EAN13 — la « référence » cherchable (mesuré : la recherche le trouve). */
  ean13:         string | null
  /** Prix d'achat HT du compte (`price`, seul champ de prix confirmé fiable). */
  prix_achat_ht: number | null
  /** Quantité affichée par Mobilax — indication, jamais une promesse (check-stock). */
  stock:         number
}

export type ResultatRechercheMobilax =
  | { ok: true; total: number; produits: ProduitMobilax[] }
  | { ok: false; erreur: ErreurMobilax; message: string; reessayer_dans_s?: number }

export type ErreurMobilax =
  | 'sans_fournisseur' | 'plusieurs_fournisseurs' | 'sans_cle'
  | 'cle_refusee' | 'quota' | 'indisponible'

/** Dépendances injectées — tout ce que le service touche hors de lui-même. */
export interface DepsMobilax {
  db:             Database
  kv:             D1KVNamespace
  /** Secret de plateforme `FOURNISSEUR_CRYPTO_KEY`. */
  cleChiffrement: string
  /** `MOBILAX_API_BASE` — préproduction ou production, jamais codée en dur. */
  baseUrl:        string
}

/** Nombre de résultats demandés par recherche. */
const LIMITE_RESULTATS = 20

// ─── Recherche ────────────────────────────────────────────────────────────────

/**
 * Cherche des pièces Mobilax par nom ou EAN, avec la clé de la boutique appelante.
 *
 * @param deps        Dépendances (base, KV, secret, adresse de l'API)
 * @param boutiqueId  Boutique appelante — c'est SA clé qui est utilisée, jamais une autre
 * @param terme       Texte cherché (nom, EAN13)
 * @returns           Produits normalisés, ou une erreur nommée avec un message pour l'opérateur
 */
export async function rechercherProduitsMobilax(
  deps: DepsMobilax, boutiqueId: number, terme: string
): Promise<ResultatRechercheMobilax> {
  // ── Quelle fiche, quelle clé : tout est vérifié AVANT le moindre appel à Mobilax ──
  const fiches = await trouverFournisseurApi(deps.db, boutiqueId, 'mobilax')
  if (fiches.length === 0) return echec('sans_fournisseur',
    'Aucun fournisseur n\'est marqué « Mobilax ». Cochez la case dans sa fiche (Fournisseurs).')
  if (fiches.length > 1) return echec('plusieurs_fournisseurs',
    'Plusieurs fournisseurs sont marqués « Mobilax ». N\'en gardez qu\'un seul coché.')
  if (!fiches[0].a_cle) return echec('sans_cle',
    'Le fournisseur Mobilax n\'a pas de clé API. Renseignez-la dans sa fiche (Fournisseurs).')

  const apiKey = await getApiKeyDechiffree(deps.db, fiches[0].id, boutiqueId, deps.cleChiffrement)
  if (!apiKey) return echec('sans_cle',
    'Le fournisseur Mobilax n\'a pas de clé API. Renseignez-la dans sa fiche (Fournisseurs).')

  // ── Appels Mobilax : toute sortie est un résultat nommé, jamais une exception ──
  // Aucune nouvelle tentative à l'aveugle : un quota atteint est rendu tel quel à l'opérateur,
  // avec le délai annoncé par Mobilax (quota partagé par toute la boutique).
  try {
    const cleKv = `mobilax:jeton:${boutiqueId}:${await empreinte(apiKey)}`
    const url = `${deps.baseUrl}/products?search=${encodeURIComponent(terme)}&limit=${LIMITE_RESULTATS}`

    // Au plus deux passages : la doc prescrit de renouveler le jeton sur un 401. On ne le fait
    // qu'une fois, et seulement si le jeton refusé venait du KV — un jeton tout neuf refusé
    // met la clé en cause, le redemander ne ferait que brûler le quota /auth.
    for (let passage = 1; passage <= 2; passage++) {
      const jeton = await obtenirJeton(deps, cleKv, apiKey)
      if (!jeton.ok) return jeton.resultat

      const rep = await fetch(url, { headers: { Authorization: `Bearer ${jeton.token}` } })
      if (rep.status === 401) {
        await deps.kv.delete(cleKv)
        if (jeton.garde && passage === 1) continue
        return cleRefusee()
      }
      if (rep.status === 429) return quotaAtteint(rep)
      if (!rep.ok) return indisponible()

      // `GET /products` : `{ data: { total, products } }`, sans `status` (mesuré le 2026-09-11)
      const corps = await rep.json() as { data?: { total?: number; products?: any[] } }
      return {
        ok: true,
        total: corps.data?.total ?? 0,
        produits: (corps.data?.products ?? []).map(versProduitMobilax),
      }
    }
    return cleRefusee()
  } catch {
    return indisponible()
  }
}

/** Mobilax refuse la clé (ou un jeton tout juste obtenu avec elle). */
function cleRefusee(): ResultatRechercheMobilax {
  return echec('cle_refusee',
    'Mobilax refuse la clé API enregistrée. Vérifiez-la dans la fiche du fournisseur Mobilax.')
}

/** 429 : délai lu dans `ratelimit-reset` (en-tête mesuré présent), sinon message sans chiffre. */
function quotaAtteint(rep: Response): ResultatRechercheMobilax {
  const reset = Number(rep.headers.get('ratelimit-reset'))
  return Number.isFinite(reset) && reset > 0
    ? echec('quota', `Limite d'appels Mobilax atteinte. Réessayez dans ${reset} s.`, reset)
    : echec('quota', 'Limite d\'appels Mobilax atteinte. Réessayez dans quelques instants.')
}

/** Panne réseau, réponse 5xx ou réponse illisible. */
function indisponible(): ResultatRechercheMobilax {
  return echec('indisponible', 'Mobilax ne répond pas pour le moment. Réessayez plus tard.')
}

// ─── Jeton ────────────────────────────────────────────────────────────────────
//
// Sans jeton gardé, chaque recherche consommerait une connexion : le quota `/auth` (10/min,
// partagé par toute la boutique) plafonnerait la recherche à 10 par minute. Le jeton est donc
// gardé dans le KV, CHIFFRÉ (c'est un secret, même d'une heure), le temps annoncé par
// `expireIn` moins une minute. La clé KV porte une empreinte de la clé API : une clé changée
// (rotation) ne réutilise jamais le jeton de l'ancienne, sans code de nettoyage à maintenir.

/** Marge retirée de la durée annoncée, pour ne jamais présenter un jeton sur le point d'expirer. */
const MARGE_JETON_S = 60

/** `garde` : le jeton vient du KV (il a pu expirer chez Mobilax avant sa date annoncée). */
type Jeton = { ok: true; token: string; garde: boolean } | { ok: false; resultat: ResultatRechercheMobilax }

/**
 * Renvoie un jeton : celui gardé s'il existe, sinon une nouvelle connexion.
 * @param cleKv Clé KV du jeton — `mobilax:jeton:<boutique>:<empreinte de la clé API>`
 */
async function obtenirJeton(deps: DepsMobilax, cleKv: string, apiKey: string): Promise<Jeton> {
  const garde = await deps.kv.get(cleKv)
  if (garde) return { ok: true, token: await dechiffrer(garde, deps.cleChiffrement), garde: true }

  const auth = await fetch(`${deps.baseUrl}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  if (auth.status === 429) return { ok: false, resultat: quotaAtteint(auth) }
  // Toutes les erreurs d'authentification Mobilax sont des 401 (clé invalide, désactivée,
  // client inactif — doc) : c'est la clé qui est en cause, pas une panne.
  if (auth.status === 401 || auth.status === 403) return { ok: false, resultat: cleRefusee() }
  if (!auth.ok) return { ok: false, resultat: indisponible() }

  // `POST /auth` répond à plat, ni `status` ni `data` : `{ token, refreshToken, expireIn }`
  const { token, expireIn } = await auth.json() as { token?: string; expireIn?: unknown }
  if (!token) return { ok: false, resultat: indisponible() }

  // Durée jamais codée en dur : illisible → rien de gardé, plutôt qu'une durée inventée
  const duree = dureeEnSecondes(expireIn)
  if (duree !== null && duree > MARGE_JETON_S)
    await deps.kv.put(cleKv, await chiffrer(token, deps.cleChiffrement), { expirationTtl: duree - MARGE_JETON_S })
  return { ok: true, token, garde: false }
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

/** Résultat d'échec, avec le message destiné à l'opérateur. */
function echec(erreur: ErreurMobilax, message: string, reessayer_dans_s?: number): ResultatRechercheMobilax {
  return reessayer_dans_s === undefined
    ? { ok: false, erreur, message }
    : { ok: false, erreur, message, reessayer_dans_s }
}

/** Normalise un produit brut de `GET /products` — le seul endroit qui lit ses champs. */
function versProduitMobilax(p: any): ProduitMobilax {
  const prix = Number(p.price)
  return {
    mobilax_id:    Number(p.id),
    nom:           String(p.name ?? p.short_name ?? ''),
    ean13:         p.ean13 ? String(p.ean13) : null,
    prix_achat_ht: Number.isFinite(prix) ? prix : null,
    stock:         Number(p.quantity) || 0,
  }
}
