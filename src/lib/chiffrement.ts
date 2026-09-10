/**
 * @module chiffrement
 * @description Chiffrement réversible AES-GCM via Web Crypto (ticket 01, chantier Mobilax).
 *
 * Premier chiffrement RÉVERSIBLE de ce dépôt. Les usages existants de `crypto.subtle`
 * (`lib/auth.ts` PBKDF2 mot de passe + HMAC JWT, `lib/photoToken.ts` HMAC,
 * `lib/nf525.ts`/`caisseService.ts` SHA-256) sont tous à sens unique ou du HMAC — aucun
 * n'est réutilisable pour une valeur qu'un appelant doit pouvoir relire en clair, comme une
 * clé API fournisseur.
 *
 * Format stocké : `<iv_hex>:<ciphertext_hex>`, même convention que le hash PBKDF2 de
 * `lib/auth.ts` (`iterations:salt_hex:hash_hex`) — des segments hex séparés par `:`.
 *
 * La clé passée en paramètre est un secret de plateforme (Cloudflare secret), jamais lue
 * ici depuis l'environnement : ce module reste une fonction pure, testable sans Worker.
 */

const ALGO = 'AES-GCM'
const IV_LENGTH_OCTETS = 12   // taille recommandée pour AES-GCM

function hexVersOctets(hex: string): Uint8Array {
  const octets = hex.match(/.{2}/g) ?? []
  return new Uint8Array(octets.map(h => parseInt(h, 16)))
}

function octetsVersHex(octets: Uint8Array): string {
  return Array.from(octets).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function importerCle(cleHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexVersOctets(cleHex), ALGO, false, ['encrypt', 'decrypt'])
}

/**
 * Chiffre une valeur en clair. Un IV aléatoire est tiré à chaque appel — deux appels sur la
 * même valeur produisent deux résultats différents, tous deux déchiffrables.
 *
 * @param clair  Valeur à chiffrer (ex. une clé API fournisseur)
 * @param cleHex Clé AES-256 en hexadécimal (32 octets = 64 caractères hex)
 * @returns      `<iv_hex>:<ciphertext_hex>`
 */
export async function chiffrer(clair: string, cleHex: string): Promise<string> {
  const cle = await importerCle(cleHex)
  const iv  = crypto.getRandomValues(new Uint8Array(IV_LENGTH_OCTETS))

  const chiffre = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    cle,
    new TextEncoder().encode(clair)
  )

  return `${octetsVersHex(iv)}:${octetsVersHex(new Uint8Array(chiffre))}`
}

/**
 * Déchiffre une valeur produite par {@link chiffrer}.
 *
 * @param stocke Valeur au format `<iv_hex>:<ciphertext_hex>`
 * @param cleHex Même clé AES-256 hex utilisée pour chiffrer
 * @throws       Si la clé est incorrecte ou la valeur corrompue (échec d'authentification GCM)
 */
export async function dechiffrer(stocke: string, cleHex: string): Promise<string> {
  const [ivHex, chiffreHex] = stocke.split(':')
  const cle = await importerCle(cleHex)

  const clair = await crypto.subtle.decrypt(
    { name: ALGO, iv: hexVersOctets(ivHex) },
    cle,
    hexVersOctets(chiffreHex)
  )

  return new TextDecoder().decode(clair)
}
