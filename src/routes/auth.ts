/**
 * @module routes/auth
 * @description Controller Authentification — register, OTP, login, refresh, logout, me.
 *
 * Rôle architectural (P1 Modularité) :
 *   Controller pur — 0 SQL direct. Toutes les opérations DB sont déléguées
 *   à `authService.ts`. La cryptographie (PBKDF2, JWT, OTP) est déléguée
 *   à `auth.ts` (lib).
 *
 * Flux d'inscription :
 *   1. POST /register  → crée le compte (inactif), génère OTP, stocke hashé en KV
 *   2. POST /verify-otp → valide l'OTP, active le compte, retourne la paire de tokens
 *
 * Flux de connexion :
 *   1. POST /login     → vérifie email + PBKDF2, génère tokens, stocke refresh en KV
 *
 * Flux de rafraîchissement (rotation de token) :
 *   1. POST /refresh   → valide refresh en KV, révoque l'ancien, génère une nouvelle paire
 *
 * Endpoints :
 *   POST   /api/auth/register    → Inscription (crée boutique optionnelle + OTP)
 *   POST   /api/auth/verify-otp  → Vérification email par OTP (usage unique)
 *   POST   /api/auth/login       → Connexion email + mot de passe
 *   POST   /api/auth/refresh     → Rafraîchissement token (rotation — révoque l'ancien)
 *   POST   /api/auth/logout      → Déconnexion (révoque le refresh token)
 *   GET    /api/auth/me          → Profil utilisateur courant (JWT requis)
 *
 * Sécurité :
 *   - Mots de passe : PBKDF2-SHA256 (100 000 itérations) via Web Crypto API
 *   - JWT : HMAC-SHA256, TTL 1h, signé avec `JWT_SECRET`
 *   - Refresh tokens : 32 octets aléatoires, TTL 7j, stockés en KV, rotation obligatoire
 *   - OTP : 6 chiffres, hashé PBKDF2 en KV, TTL 10 minutes, usage unique
 *
 * Format de réponse (P5 uniforme) : `{ success, data?, error?, message? }`
 */

import { Hono } from 'hono'
import {
  hashPassword, verifyPassword,
  generateTokenPair,
  storeRefreshToken, validateRefreshToken, revokeRefreshToken,
  storeOtp, verifyOtp, generateOtp
} from '../lib/auth'
import { validateEmail, auditLog } from '../lib/db'
import { authMiddleware } from '../lib/middleware'
import {
  findUserByEmail,
  findUserByEmailFull,
  findUserById,
  findUserWithProfile,
  createBoutiqueWithSettings,
  createUser,
  activateUser,
  findUserByEmailAfterActivation,
} from '../services/authService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── POST /api/auth/register ──────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Inscrit un nouvel utilisateur et démarre le flux de vérification email par OTP.
 *
 * Séquence :
 *   1. Valide les champs obligatoires (email, password, prenom, nom)
 *   2. Vérifie l'unicité de l'email via `findUserByEmail()`
 *   3. Crée optionnellement une boutique via `createBoutiqueWithSettings()` si `workshopName` est fourni
 *   4. Hashe le mot de passe via `hashPassword()` (PBKDF2-SHA256)
 *   5. Crée l'utilisateur inactif via `createUser()`
 *   6. Génère un OTP 6 chiffres et le stocke hashé en KV (TTL 10 min)
 *   7. Logue l'action `REGISTER` en audit
 *
 * En mode démo sandbox : l'OTP est retourné en clair dans la réponse (`otpDemo`).
 * En production : l'OTP doit être envoyé par email (via emailService).
 *
 * Body JSON :
 * ```json
 * {
 *   "email":        "user@example.com",
 *   "password":     "motdepasse123",  // min 8 caractères
 *   "prenom":       "Jean",
 *   "nom":          "Dupont",
 *   "telephone":    "0612345678",     // optionnel
 *   "workshopName": "iZiGSM Paris"    // optionnel — crée une boutique liée
 * }
 * ```
 *
 * @returns 201 `{ success: true, message, otpDemo }` — otpDemo supprimé en production
 * @returns 400 si champs obligatoires manquants, email invalide, ou password < 8 chars
 * @returns 409 si l'email est déjà utilisé
 * @returns 500 en cas d'erreur serveur
 */
auth.post('/register', async (c) => {
  try {
    const { email, password, prenom, nom, telephone, workshopName } = await c.req.json()

    if (!email || !password || !prenom || !nom)
      return c.json({ success: false, error: 'Champs obligatoires : email, password, prenom, nom.' }, 400)
    if (!validateEmail(email))
      return c.json({ success: false, error: 'Format email invalide.' }, 400)
    if (password.length < 8)
      return c.json({ success: false, error: 'Mot de passe minimum 8 caractères.' }, 400)

    // Vérifier si email déjà utilisé
    const existing = await findUserByEmail(c.env.DB, email)
    if (existing)
      return c.json({ success: false, error: 'Cet email est déjà utilisé.' }, 409)

    // Créer la boutique si workshopName fourni
    const boutiqueId = workshopName
      ? await createBoutiqueWithSettings(c.env.DB, workshopName)
      : null

    // Hasher le mot de passe (PBKDF2-SHA256, 100 000 itérations)
    const passwordHash = await hashPassword(password)

    // Créer l'utilisateur (inactif jusqu'à vérification email)
    const userId = await createUser(
      c.env.DB, email, passwordHash, prenom, nom,
      telephone ?? null, boutiqueId
    )
    if (!userId) throw new Error('Erreur création utilisateur')

    // Générer et stocker l'OTP (hashé en KV, TTL 10 min)
    const otp = generateOtp()
    await storeOtp(c.env.KV, email, otp)

    // Traçabilité
    await auditLog(c.env.DB, { user_id: userId, action: 'REGISTER', entite_type: 'user', entite_id: userId })

    return c.json({
      success: true,
      message: 'Compte créé. Vérifiez votre email.',
      // En production : ne pas retourner l'OTP — l'envoyer par email
      // En démo sandbox : on le retourne pour test
      otpDemo: otp
    }, 201)
  } catch (e: any) {
    console.error('[register]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────

/**
 * POST /api/auth/verify-otp
 * Valide le code OTP envoyé par email et active le compte utilisateur.
 *
 * Séquence :
 *   1. Vérifie l'OTP en KV via `verifyOtp()` (usage unique — supprimé si valide)
 *   2. Active le compte via `activateUser()` (`actif = 1`, `email_verifie = 1`)
 *   3. Récupère le profil via `findUserByEmailAfterActivation()`
 *   4. Génère une paire de tokens et stocke le refresh en KV
 *
 * Body JSON :
 * ```json
 * { "email": "user@example.com", "otp": "042713" }
 * ```
 *
 * @returns 200 `{ success: true, accessToken, refreshToken, expiresIn, user }`
 * @returns 400 si email/OTP manquants, ou OTP invalide/expiré
 * @returns 404 si utilisateur introuvable après activation
 * @returns 500 en cas d'erreur serveur
 */
auth.post('/verify-otp', async (c) => {
  try {
    const { email, otp } = await c.req.json()
    if (!email || !otp)
      return c.json({ success: false, error: 'Email et OTP requis.' }, 400)

    const valid = await verifyOtp(c.env.KV, email, otp)
    if (!valid)
      return c.json({ success: false, error: 'Code OTP invalide ou expiré.' }, 400)

    // Activer le compte
    await activateUser(c.env.DB, email)

    const user = await findUserByEmailAfterActivation(c.env.DB, email)
    if (!user) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)

    const tokens = await generateTokenPair(user, c.env.JWT_SECRET)
    await storeRefreshToken(c.env.KV, user.id, tokens.refreshToken)

    return c.json({
      success: true,
      message: 'Compte activé !',
      ...tokens,
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role }
    })
  } catch (e) {
    console.error('[verify-otp]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Authentifie un utilisateur par email et mot de passe.
 *
 * Séquence :
 *   1. Récupère l'utilisateur par email via `findUserByEmailFull()` (avec hash)
 *   2. Vérifie que le compte est actif et email vérifié
 *   3. Vérifie le mot de passe via `verifyPassword()` (PBKDF2 en temps constant)
 *   4. Génère une paire de tokens et stocke le refresh en KV
 *   5. Logue l'action `LOGIN` en audit
 *
 * Body JSON :
 * ```json
 * { "email": "user@example.com", "password": "motdepasse123" }
 * ```
 *
 * Note sécurité : les messages d'erreur 401 sont volontairement identiques
 * pour l'email et le mot de passe (pas d'énumération des comptes).
 *
 * @returns 200 `{ success: true, accessToken, refreshToken, expiresIn, user }`
 * @returns 400 si email ou password manquant
 * @returns 401 si email inconnu ou mot de passe incorrect
 * @returns 403 si compte non vérifié ou désactivé
 * @returns 500 en cas d'erreur serveur
 */
auth.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password)
      return c.json({ success: false, error: 'Email et mot de passe requis.' }, 400)

    const user = await findUserByEmailFull(c.env.DB, email)

    // Message identique pour email inconnu et mot de passe incorrect (anti-énumération)
    if (!user)
      return c.json({ success: false, error: 'Email ou mot de passe incorrect.' }, 401)
    if (!user.email_verifie)
      return c.json({ success: false, error: 'Vérifiez votre email avant de vous connecter.' }, 403)
    if (!user.actif)
      return c.json({ success: false, error: 'Compte désactivé. Contactez l\'administrateur.' }, 403)

    const passwordOk = await verifyPassword(password, user.password_hash)
    if (!passwordOk)
      return c.json({ success: false, error: 'Email ou mot de passe incorrect.' }, 401)

    const tokens = await generateTokenPair(user, c.env.JWT_SECRET)
    await storeRefreshToken(c.env.KV, user.id, tokens.refreshToken)

    await auditLog(c.env.DB, { boutique_id: user.boutique_id, user_id: user.id, action: 'LOGIN' })

    return c.json({
      success: true,
      ...tokens,
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, boutique_id: user.boutique_id }
    })
  } catch (e) {
    console.error('[login]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

/**
 * POST /api/auth/refresh
 * Rafraîchit une paire de tokens par rotation du refresh token.
 *
 * Rotation de token (sécurité) :
 *   1. Valide l'ancien refresh token en KV via `validateRefreshToken()`
 *   2. Révoque l'ancien token via `revokeRefreshToken()` (ne peut plus être réutilisé)
 *   3. Récupère l'utilisateur actif via `findUserById()`
 *   4. Régénère une nouvelle paire et stocke le nouveau refresh en KV
 *
 * Body JSON :
 * ```json
 * { "userId": 42, "refreshToken": "a3f2...hex64chars" }
 * ```
 *
 * @returns 200 `{ success: true, accessToken, refreshToken, expiresIn }`
 * @returns 400 si userId ou refreshToken manquant
 * @returns 401 si refresh token invalide ou expiré
 * @returns 404 si utilisateur introuvable ou inactif
 * @returns 500 en cas d'erreur serveur
 */
auth.post('/refresh', async (c) => {
  try {
    const { userId, refreshToken } = await c.req.json()
    if (!userId || !refreshToken)
      return c.json({ success: false, error: 'userId et refreshToken requis.' }, 400)

    const valid = await validateRefreshToken(c.env.KV, userId, refreshToken)
    if (!valid)
      return c.json({ success: false, error: 'Refresh token invalide ou expiré.' }, 401)

    // Rotation : révoquer l'ancien avant d'émettre le nouveau
    await revokeRefreshToken(c.env.KV, userId, refreshToken)

    const user = await findUserById(c.env.DB, userId)
    if (!user) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)

    const tokens = await generateTokenPair(user, c.env.JWT_SECRET)
    await storeRefreshToken(c.env.KV, user.id, tokens.refreshToken)

    return c.json({ success: true, ...tokens })
  } catch (e) {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

/**
 * POST /api/auth/logout
 * Déconnecte l'utilisateur en révoquant son refresh token.
 * Nécessite un JWT valide (`authMiddleware`).
 *
 * Le refresh token passé en body est supprimé de KV.
 * L'access token reste valide jusqu'à son expiration (TTL 1h) — normal pour JWT stateless.
 *
 * Body JSON (optionnel) :
 * ```json
 * { "refreshToken": "a3f2...hex64chars" }
 * ```
 *
 * @returns 200 `{ success: true, message: 'Déconnecté.' }`
 */
auth.post('/logout', authMiddleware, async (c) => {
  const { refreshToken } = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  // Révoquer le refresh token si fourni (le body est optionnel)
  if (refreshToken) await revokeRefreshToken(c.env.KV, user.sub, refreshToken)
  await auditLog(c.env.DB, { user_id: user.sub, action: 'LOGOUT' })
  return c.json({ success: true, message: 'Déconnecté.' })
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

/**
 * GET /api/auth/me
 * Retourne le profil complet de l'utilisateur courant (issu du JWT).
 * Nécessite un JWT valide (`authMiddleware`).
 *
 * Enrichit les données JWT avec le profil DB complet (téléphone, boutique_nom)
 * via `findUserWithProfile()`.
 * Vérifie que le compte est toujours actif en base (évite les tokens zombies).
 *
 * @returns 200 `{ success: true, user: { id, email, prenom, nom, telephone, boutique_id, role, boutique_nom } }`
 * @returns 404 si l'utilisateur a été désactivé depuis l'émission du JWT
 */
auth.get('/me', authMiddleware, async (c) => {
  const user = c.get('user')
  const profile = await findUserWithProfile(c.env.DB, user.sub)
  if (!profile) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)
  return c.json({ success: true, user: profile })
})

export default auth
