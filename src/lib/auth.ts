/**
 * lib/auth.ts — JWT réel + bcrypt-like hashing
 *
 * Cloudflare Workers n'a PAS bcrypt (trop lourd).
 * On utilise Web Crypto API (PBKDF2) — standard, sécurisé, natif dans Workers.
 *
 * JWT : signé via HMAC-SHA256 avec JWT_SECRET (Cloudflare secret).
 * Refresh tokens : stockés dans Cloudflare KV avec TTL 7 jours.
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
 * Hashe un mot de passe avec PBKDF2-SHA256.
 * Format retourné : "iterations:salt_hex:hash_hex"
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
 * Vérifie un mot de passe contre son hash stocké.
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ─── JWT (implémentation manuelle HMAC-SHA256) ────────────────────────────────

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): string {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

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

export async function validateAccessToken(token: string, secret: string): Promise<JwtPayload | null> {
  return verifyJwt(token, secret)
}

function generateRefreshToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── KV : gestion refresh tokens ─────────────────────────────────────────────

export async function storeRefreshToken(
  kv: KVNamespace, userId: number, refreshToken: string
): Promise<void> {
  await kv.put(
    `refresh:${userId}:${refreshToken}`,
    JSON.stringify({ userId, createdAt: Date.now() }),
    { expirationTtl: REFRESH_TOKEN_TTL }
  )
}

export async function validateRefreshToken(
  kv: KVNamespace, userId: number, refreshToken: string
): Promise<boolean> {
  const val = await kv.get(`refresh:${userId}:${refreshToken}`)
  return val !== null
}

export async function revokeRefreshToken(
  kv: KVNamespace, userId: number, refreshToken: string
): Promise<void> {
  await kv.delete(`refresh:${userId}:${refreshToken}`)
}

// ─── KV : gestion OTP ────────────────────────────────────────────────────────

export async function storeOtp(kv: KVNamespace, email: string, otp: string): Promise<void> {
  const hash = await hashPassword(otp)
  await kv.put(`otp:${email}`, hash, { expirationTtl: 600 }) // 10 minutes
}

export async function verifyOtp(kv: KVNamespace, email: string, otp: string): Promise<boolean> {
  const stored = await kv.get(`otp:${email}`)
  if (!stored) return false
  const valid = await verifyPassword(otp, stored)
  if (valid) await kv.delete(`otp:${email}`) // usage unique
  return valid
}

export function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]
  return String(n % 1_000_000).padStart(6, '0')
}
