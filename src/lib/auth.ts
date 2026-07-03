/**
 * @module auth
 * @description Authentification JWT + hachage mot de passe PBKDF2 + gestion OTP.
 *
 * Contrainte Cloudflare Workers :
 *   Pas de `bcrypt` (trop lourd pour l'environnement Edge).
 *   Utilisation de `Web Crypto API` (PBKDF2-SHA256) — standard, sécurisé, natif.
 *
 * Stratégie JWT :
 *   - Access token  : HMAC-SHA256, TTL 1 heure, signé avec `JWT_SECRET` (Cloudflare secret)
 *   - Refresh token : 32 octets aléatoires (hex 64 chars), TTL 7 jours, stocké dans KV
 *   - Rotation      : à chaque refresh, l'ancien token est révoqué, un nouveau émis
 *
 * Stockage KV :
 *   - Refresh tokens : clé `refresh:{userId}:{token}`, TTL 7 jours
 *   - OTP            : clé `otp:{email}`, valeur = hash PBKDF2 de l'OTP, TTL 10 minutes
 *
 * Sécurité :
 *   - `timingSafeEqual()` : comparaison en temps constant (protection timing attack)
 *   - OTP usage unique    : supprimé de KV dès la première vérification valide
 *   - PBKDF2 100 000 itérations : résistance aux attaques par force brute
 *
 * Fonctions exportées :
 *   - `hashPassword()`        : PBKDF2 → "iterations:salt_hex:hash_hex"
 *   - `verifyPassword()`      : vérification PBKDF2 en temps constant
 *   - `generateTokenPair()`   : génère accessToken + refreshToken
 *   - `validateAccessToken()` : vérifie et décode un JWT
 *   - `storeRefreshToken()`   : stocke en KV avec TTL
 *   - `validateRefreshToken()`: vérifie existence en KV
 *   - `revokeRefreshToken()`  : supprime de KV (logout / rotation)
 *   - `storeOtp()`            : stocke OTP hashé en KV (TTL 10 min)
 *   - `verifyOtp()`           : vérifie OTP et le supprime si valide
 *   - `generateOtp()`         : génère un code numérique 6 chiffres
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub:         number    // user_id
  email:       string
  role:        string    // 'admin' | 'manager' | 'technicien' | 'client'
  boutique_id: number | null
  prenom:      string
  nom:         string
  exp:         number    // timestamp UNIX
  iat:         number
}

export interface TokenPair {
  accessToken:  string
  refreshToken: string
  expiresIn:    number   // secondes
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL  = 60 * 60          // 1 heure
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7 // 7 jours

// ─── Hachage mot de passe (PBKDF2 via Web Crypto) ────────────────────────────

/**
 * Hashe un mot de passe avec PBKDF2-SHA256 via Web Crypto API.
 *
 * Format retourné : `"iterations:salt_hex:hash_hex"`
 *   - `iterations` : 100 000 (résistance brute force)
 *   - `salt_hex`   : 16 octets aléatoires en hexadécimal (32 chars)
 *   - `hash_hex`   : 256 bits dérivés en hexadécimal (64 chars)
 *
 * Note : utilise `crypto.getRandomValues()` pour le sel — disponible en Workers.
 * Ne pas utiliser `require('crypto').randomBytes()` (Node.js uniquement).
 *
 * @param password  Mot de passe en clair à hasher
 * @returns         Hash formaté "iterations:salt_hex:hash_hex"
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt    = crypto.getRandomValues(new Uint8Array(16))
  const keyMat  = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMat, 256
  )
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `100000:${saltHex}:${hashHex}`
}

/**
 * Vérifie un mot de passe contre son hash PBKDF2 stocké.
 *
 * Parse le format "iterations:salt_hex:hash_hex", recalcule le hash
 * avec les mêmes paramètres et compare en temps constant pour prévenir
 * les attaques par timing (via `timingSafeEqual()`).
 *
 * @param password  Mot de passe en clair saisi par l'utilisateur
 * @param stored    Hash stocké en base (format "iterations:salt_hex:hash_hex")
 * @returns         `true` si le mot de passe correspond, `false` sinon (jamais d'exception)
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [iterStr, saltHex, storedHash] = stored.split(':')
    const iterations = parseInt(iterStr, 10)
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
    const encoder = new TextEncoder()
    const keyMat  = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    )
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMat, 256
    )
    const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
    // Comparaison en temps constant (protection timing attack)
    return timingSafeEqual(hashHex, storedHash)
  } catch {
    return false
  }
}

/**
 * Comparaison de chaînes en temps constant pour prévenir les timing attacks.
 * Parcourt toujours les deux chaînes jusqu'au bout (même si une différence est détectée).
 *
 * @param a  Première chaîne (hash recalculé)
 * @param b  Deuxième chaîne (hash stocké)
 * @returns  `true` si identiques, `false` sinon
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ─── JWT (implémentation manuelle HMAC-SHA256) ────────────────────────────────

/**
 * Encode un Uint8Array en Base64URL (RFC 4648 §5) sans padding.
 * Remplace `+` → `-`, `/` → `_`, supprime `=`.
 *
 * @param data  Données binaires à encoder
 * @returns     Chaîne Base64URL sans padding
 */
function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Décode une chaîne Base64URL en string UTF-8.
 * Restaure le padding `=` manquant avant de décoder.
 *
 * @param str  Chaîne Base64URL (avec ou sans padding)
 * @returns    Chaîne décodée (JSON du payload JWT)
 */
function base64urlDecode(str: string): string {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

/**
 * Signe un payload JWT avec HMAC-SHA256.
 * Construit le token au format standard : `header.payload.signature`
 *
 * @param payload  Objet à inclure dans le payload JWT
 * @param secret   Clé secrète HMAC (Cloudflare secret `JWT_SECRET`)
 * @returns        Token JWT signé au format Base64URL
 */
async function signJwt(payload: object, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const header  = { alg: 'HS256', typ: 'JWT' }
  const h = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const p = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const data    = `${h}.${p}`
  const key     = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return `${data}.${base64url(new Uint8Array(sig))}`
}

/**
 * Vérifie la signature HMAC-SHA256 d'un JWT et décode son payload.
 *
 * Validations effectuées :
 *   1. Structure en 3 parties séparées par `.`
 *   2. Signature HMAC-SHA256 valide (via `crypto.subtle.verify`)
 *   3. Token non expiré (`exp > Date.now() / 1000`)
 *
 * @param token   Token JWT à vérifier
 * @param secret  Clé secrète HMAC (doit correspondre à celle utilisée lors de la signature)
 * @returns       Payload décodé (`JwtPayload`) ou `null` si invalide/expiré
 */
async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, sig] = parts
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${h}.${p}`))
    if (!valid) return null
    const payload = JSON.parse(base64urlDecode(p)) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ─── Génération de tokens ─────────────────────────────────────────────────────

/**
 * Génère une paire de tokens (access + refresh) pour un utilisateur authentifié.
 *
 * Access token  : JWT signé HMAC-SHA256, TTL 1 heure.
 *   Payload : `{ sub, email, role, boutique_id, prenom, nom, iat, exp }`
 *
 * Refresh token : 32 octets aléatoires en hexadécimal (64 chars).
 *   À stocker en KV via `storeRefreshToken()` immédiatement après.
 *
 * @param user    Données utilisateur à encoder dans le JWT
 * @param secret  Clé secrète HMAC-SHA256 (Cloudflare secret `JWT_SECRET`)
 * @returns       `{ accessToken, refreshToken, expiresIn }` — expiresIn en secondes (3600)
 */
export async function generateTokenPair(
  user: { id: number; email: string; role: string; boutique_id: number | null; prenom: string; nom: string },
  secret: string
): Promise<TokenPair> {
  const now = Math.floor(Date.now() / 1000)

  const accessPayload: JwtPayload = {
    sub:         user.id,
    email:       user.email,
    role:        user.role,
    boutique_id: user.boutique_id,
    prenom:      user.prenom,
    nom:         user.nom,
    iat:         now,
    exp:         now + ACCESS_TOKEN_TTL,
  }

  const accessToken  = await signJwt(accessPayload, secret)
  const refreshToken = generateRefreshToken()

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL }
}

/**
 * Valide un access token JWT et retourne son payload décodé.
 * Délègue à `verifyJwt()` — retourne `null` si invalide ou expiré.
 *
 * @param token   Access token JWT à valider
 * @param secret  Clé secrète HMAC (Cloudflare secret `JWT_SECRET`)
 * @returns       Payload `JwtPayload` ou `null`
 */
export async function validateAccessToken(token: string, secret: string): Promise<JwtPayload | null> {
  return verifyJwt(token, secret)
}

/**
 * Génère un refresh token cryptographiquement sécurisé.
 * 32 octets aléatoires via `crypto.getRandomValues()` → hex 64 chars.
 *
 * @returns  Token hexadécimal 64 caractères (256 bits d'entropie)
 */
function generateRefreshToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── KV : gestion refresh tokens ─────────────────────────────────────────────

/**
 * Stocke un refresh token dans Cloudflare KV avec TTL 7 jours.
 * Clé KV : `refresh:{userId}:{refreshToken}`
 * Valeur  : `{ userId, createdAt }` (JSON)
 *
 * À appeler immédiatement après `generateTokenPair()` lors du login ou du refresh.
 *
 * @param kv            Binding KV Cloudflare
 * @param userId        Identifiant de l'utilisateur
 * @param refreshToken  Token généré par `generateTokenPair()`
 */
export async function storeRefreshToken(
  kv: import("./d1kv").D1KVNamespace, userId: number, refreshToken: string
): Promise<void> {
  await kv.put(
    `refresh:${userId}:${refreshToken}`,
    JSON.stringify({ userId, createdAt: Date.now() }),
    { expirationTtl: REFRESH_TOKEN_TTL }
  )
}

/**
 * Vérifie qu'un refresh token existe et est valide dans KV.
 * Un token expiré est automatiquement absent de KV (TTL Cloudflare).
 *
 * @param kv            Binding KV Cloudflare
 * @param userId        Identifiant de l'utilisateur
 * @param refreshToken  Token à vérifier
 * @returns             `true` si le token existe en KV, `false` s'il est absent ou expiré
 */
export async function validateRefreshToken(
  kv: import("./d1kv").D1KVNamespace, userId: number, refreshToken: string
): Promise<boolean> {
  const val = await kv.get(`refresh:${userId}:${refreshToken}`)
  return val !== null
}

/**
 * Révoque un refresh token en le supprimant de KV.
 * À appeler lors du logout ou de la rotation de token (refresh).
 *
 * La rotation garantit qu'un token volé ne peut être utilisé qu'une seule fois :
 *   1. Valider l'ancien token (`validateRefreshToken`)
 *   2. Révoquer l'ancien (`revokeRefreshToken`)
 *   3. Générer et stocker le nouveau (`generateTokenPair` + `storeRefreshToken`)
 *
 * @param kv            Binding KV Cloudflare
 * @param userId        Identifiant de l'utilisateur
 * @param refreshToken  Token à supprimer
 */
export async function revokeRefreshToken(
  kv: import("./d1kv").D1KVNamespace, userId: number, refreshToken: string
): Promise<void> {
  await kv.delete(`refresh:${userId}:${refreshToken}`)
}

// ─── KV : gestion OTP ────────────────────────────────────────────────────────

/**
 * Stocke un OTP hashé dans KV avec TTL 10 minutes.
 * L'OTP est hashé via PBKDF2 avant stockage (même sécurité qu'un mot de passe).
 * Clé KV : `otp:{email}`
 *
 * À appeler après la génération de l'OTP (`generateOtp()`) lors de l'inscription
 * ou d'une demande de réinitialisation de mot de passe.
 *
 * @param kv    Binding KV Cloudflare
 * @param email Email de l'utilisateur (identifiant unique de l'OTP)
 * @param otp   Code OTP en clair généré par `generateOtp()`
 */
export async function storeOtp(kv: import("./d1kv").D1KVNamespace, email: string, otp: string): Promise<void> {
  const hash = await hashPassword(otp)
  await kv.put(`otp:${email}`, hash, { expirationTtl: 600 }) // 10 minutes
}

/**
 * Vérifie un OTP saisi par l'utilisateur contre le hash stocké en KV.
 * Si valide, supprime immédiatement l'OTP de KV (usage unique).
 *
 * @param kv    Binding KV Cloudflare
 * @param email Email de l'utilisateur
 * @param otp   Code OTP saisi par l'utilisateur (6 chiffres)
 * @returns     `true` si l'OTP est valide et non expiré, `false` sinon
 */
export async function verifyOtp(kv: import("./d1kv").D1KVNamespace, email: string, otp: string): Promise<boolean> {
  const stored = await kv.get(`otp:${email}`)
  if (!stored) return false
  const valid = await verifyPassword(otp, stored)
  if (valid) await kv.delete(`otp:${email}`) // usage unique
  return valid
}

/**
 * Génère un code OTP numérique à 6 chiffres cryptographiquement sécurisé.
 * Utilise `crypto.getRandomValues()` (entropie hardware via Web Crypto API).
 * Garantit toujours 6 chiffres avec `padStart(6, '0')` (ex: "004271").
 *
 * @returns  Code OTP à 6 chiffres sous forme de string (ex: "042713")
 */
export function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]
  return String(n % 1_000_000).padStart(6, '0')
}
