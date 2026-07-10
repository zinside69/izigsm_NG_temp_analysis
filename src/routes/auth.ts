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
import { sendOtpInscription } from '../services/emailService'
import {
  findUserByEmail,
  findUserByEmailFull,
  findUserById,
  findUserWithProfile,
  createBoutiqueWithSettings,
  createUser,
  activateUser,
  findUserByEmailAfterActivation,
  updatePasswordHash,
  findUserByGoogleId,
  linkGoogleId,
  createGoogleUser,
} from '../services/authService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string; RESEND_API_KEY?: string }
type Variables = { user: any }

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── GET /api/auth/config ─────────────────────────────────────────────────────

/**
 * GET /api/auth/config
 * Expose la configuration publique d'authentification côté client.
 * Retourne uniquement les valeurs non-secrètes (Client ID public Google).
 * Pas d'authentification requise — endpoint public.
 *
 * @returns 200 { success: true, googleClientId: string | null }
 */
auth.get('/config', (c) => {
  const googleClientId = (c.env as any).GOOGLE_CLIENT_ID ?? null
  return c.json({ success: true, googleClientId })
})

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
 * L'OTP est envoyé par email via `sendOtpInscription()` (Resend, `RESEND_API_KEY`).
 * Si la clé n'est pas configurée ou si l'envoi échoue, l'OTP est retourné en clair
 * dans la réponse (`otpDemo`) en secours — utilisé en dev local sans clé Resend.
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

    // Envoyer l'OTP par email (Resend) — fallback en clair si pas de clé ou échec d'envoi
    const apiKey = c.env.RESEND_API_KEY
    const emailResult = apiKey ? await sendOtpInscription(apiKey, email, prenom, otp) : { success: false }

    // Traçabilité
    await auditLog(c.env.DB, { user_id: userId, action: 'REGISTER', entite_type: 'user', entite_id: userId })

    return c.json({
      success: true,
      message: 'Compte créé. Vérifiez votre boîte email pour le code de vérification.',
      ...(emailResult.success ? {} : { otpDemo: otp }),
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
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, boutique_id: user.boutique_id }
    })
  } catch (e) {
    console.error('[verify-otp]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/auth/resend-otp ────────────────────────────────────────────────

/**
 * POST /api/auth/resend-otp
 * Régénère et renvoie l'OTP par email pour un compte déjà créé mais pas encore vérifié.
 * Utilisé par le bouton "Renvoyer le code" du wizard d'inscription.
 *
 * Body JSON :
 * ```json
 * { "email": "user@example.com" }
 * ```
 *
 * @returns 200 `{ success: true, message, otpDemo? }` — otpDemo seulement si l'envoi email échoue
 * @returns 400 si email manquant
 * @returns 404 si aucun compte pour cet email
 * @returns 409 si le compte est déjà vérifié
 * @returns 500 en cas d'erreur serveur
 */
auth.post('/resend-otp', async (c) => {
  try {
    const { email } = await c.req.json()
    if (!email) return c.json({ success: false, error: 'Email requis.' }, 400)

    const user = await findUserByEmailFull(c.env.DB, email)
    if (!user) return c.json({ success: false, error: 'Aucun compte associé à cet email.' }, 404)
    if (user.email_verifie) return c.json({ success: false, error: 'Ce compte est déjà vérifié.' }, 409)

    const otp = generateOtp()
    await storeOtp(c.env.KV, email, otp)

    const apiKey = c.env.RESEND_API_KEY
    const emailResult = apiKey ? await sendOtpInscription(apiKey, email, user.prenom, otp) : { success: false }

    return c.json({
      success: true,
      message: 'Code renvoyé.',
      ...(emailResult.success ? {} : { otpDemo: otp }),
    })
  } catch (e) {
    console.error('[resend-otp]', e)
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

// ─── POST /api/auth/reset-password-request ───────────────────────────────────

/**
 * POST /api/auth/reset-password-request
 * Démarre le flux de réinitialisation mot de passe.
 *
 * Génère un token UUID hex (64 chars) stocké en KV clé `reset:{email}` TTL 1h.
 * Envoie un email fire-and-forget avec le lien de réinitialisation.
 *
 * Sécurité : réponse identique si email inconnu (anti-énumération).
 *
 * Body JSON : { "email": "user@example.com" }
 * @returns 200 { success: true, message } — toujours, même si email inconnu
 */
auth.post('/reset-password-request', async (c) => {
  try {
    const { email } = await c.req.json().catch(() => ({}))
    if (!email || !validateEmail(email))
      return c.json({ success: false, error: 'Email invalide.' }, 400)

    // Anti-énumération : même réponse quelle que soit l'existence de l'email
    const user = await findUserByEmail(c.env.DB, email)

    if (user) {
      // Générer token réinitialisation 32 octets → hex 64 chars
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')

      // Stocker en KV — TTL 1h
      await c.env.KV.put(`reset:${email}`, JSON.stringify({ userId: user.id, token }), { expirationTtl: 3600 })

      // Lien de réinitialisation
      const frontendUrl = (c.env as any).FRONTEND_URL ?? 'http://localhost:3000'
      const resetLink = `${frontendUrl}/reset-password.html?token=${token}&email=${encodeURIComponent(email)}`

      // Fire-and-forget email (emailService si disponible)
      try {
        const { sendEmail } = await import('../services/emailService')
        await sendEmail(c.env.DB, user.id, email, 'autre', {
          subject: 'Réinitialisation de votre mot de passe iziGSM',
          htmlBody: `
            <div style="font-family:sans-serif;max-width:520px;margin:auto;">
              <h2 style="color:#6366f1;">Réinitialisation de mot de passe</h2>
              <p>Vous avez demandé à réinitialiser votre mot de passe iziGSM.</p>
              <p style="margin:24px 0;">
                <a href="${resetLink}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;"
                >Réinitialiser mon mot de passe</a>
              </p>
              <p style="color:#667085;font-size:.88rem;">Ce lien expire dans <strong>1 heure</strong>.<br>
              Si vous n'avez pas fait cette demande, ignorez cet email.</p>
              <p style="color:#667085;font-size:.82rem;">Ou copiez ce lien : ${resetLink}</p>
            </div>`,
        })
      } catch (_) { /* non bloquant */ }

      await auditLog(c.env.DB, { user_id: user.id, action: 'RESET_PASSWORD_REQUEST', entite_type: 'user', entite_id: user.id })
    }

    return c.json({ success: true, message: 'Si cet email est enregistré, un lien de réinitialisation a été envoyé.' })
  } catch (e) {
    console.error('[reset-password-request]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/auth/reset-password ────────────────────────────────────────────

/**
 * POST /api/auth/reset-password
 * Finalise la réinitialisation du mot de passe avec le token reçu par email.
 *
 * Vérifie le token en KV, met à jour le hash PBKDF2, révoque le token (usage unique).
 *
 * Body JSON : { "email": "user@example.com", "token": "...", "password": "nouveauMdp" }
 * @returns 200 { success: true, message }
 * @returns 400 si token invalide/expiré ou password < 8 chars
 */
auth.post('/reset-password', async (c) => {
  try {
    const { email, token, password } = await c.req.json().catch(() => ({}))

    if (!email || !token || !password)
      return c.json({ success: false, error: 'email, token et password requis.' }, 400)
    if (password.length < 8)
      return c.json({ success: false, error: 'Mot de passe minimum 8 caractères.' }, 400)

    // Vérifier le token en KV
    const raw = await c.env.KV.get(`reset:${email}`)
    if (!raw)
      return c.json({ success: false, error: 'Lien invalide ou expiré. Veuillez refaire la demande.' }, 400)

    const stored = JSON.parse(raw) as { userId: number; token: string }
    if (stored.token !== token)
      return c.json({ success: false, error: 'Lien invalide ou expiré.' }, 400)

    // Nouveau hash PBKDF2
    const newHash = await hashPassword(password)
    await updatePasswordHash(c.env.DB, stored.userId, newHash)

    // Révoquer le token (usage unique)
    await c.env.KV.delete(`reset:${email}`)

    await auditLog(c.env.DB, { user_id: stored.userId, action: 'RESET_PASSWORD', entite_type: 'user', entite_id: stored.userId })

    return c.json({ success: true, message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' })
  } catch (e) {
    console.error('[reset-password]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/auth/google ────────────────────────────────────────────────────

/**
 * POST /api/auth/google
 * Authentifie (ou crée) un utilisateur via Google OAuth One Tap.
 *
 * Reçoit le JWT Google (credential), le vérifie via l'endpoint tokeninfo de Google,
 * puis :
 *   - Si google_id connu → connexion directe
 *   - Si email connu mais sans google_id → liaison du compte existant
 *   - Sinon → création d'un nouveau compte (actif, email vérifié)
 *
 * Nécessite le secret GOOGLE_CLIENT_ID configuré en environnement.
 *
 * Body JSON : { "credential": "<JWT Google One Tap>" }
 * @returns 200 { success, accessToken, refreshToken, expiresIn, user }
 * @returns 400 si credential manquant ou invalid
 * @returns 503 si GOOGLE_CLIENT_ID absent
 */
auth.post('/google', async (c) => {
  try {
    const googleClientId = (c.env as any).GOOGLE_CLIENT_ID
    if (!googleClientId)
      return c.json({ success: false, error: 'OAuth Google non configuré sur ce serveur.' }, 503)

    const { credential } = await c.req.json().catch(() => ({}))
    if (!credential)
      return c.json({ success: false, error: 'credential Google requis.' }, 400)

    // Vérification du JWT Google via tokeninfo (léger, sans lib)
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    )
    if (!tokenInfoRes.ok)
      return c.json({ success: false, error: 'Token Google invalide.' }, 400)

    const googlePayload = await tokenInfoRes.json() as {
      sub: string; email: string; given_name?: string; family_name?: string;
      email_verified?: string; aud?: string;
    }

    // Vérifier que le token est bien destiné à notre app
    if (googlePayload.aud !== googleClientId)
      return c.json({ success: false, error: 'Token Google non valide pour cette application.' }, 400)
    if (googlePayload.email_verified !== 'true')
      return c.json({ success: false, error: 'Email Google non vérifié.' }, 400)

    const googleId = googlePayload.sub
    const email    = googlePayload.email
    const prenom   = googlePayload.given_name  || email.split('@')[0]
    const nom      = googlePayload.family_name || ''

    // 1. Chercher par google_id
    let user = await findUserByGoogleId(c.env.DB, googleId)

    if (!user) {
      // 2. Chercher par email — liaison d'un compte existant
      const existing = await findUserByEmailFull(c.env.DB, email)
      if (existing) {
        await linkGoogleId(c.env.DB, existing.id, googleId)
        user = await findUserById(c.env.DB, existing.id)
      } else {
        // 3. Créer un nouveau compte Google
        const newUserId = await createGoogleUser(c.env.DB, email, prenom, nom, googleId)
        if (!newUserId)
          return c.json({ success: false, error: 'Erreur création compte.' }, 500)
        user = await findUserById(c.env.DB, newUserId)
        await auditLog(c.env.DB, { user_id: newUserId, action: 'REGISTER_GOOGLE', entite_type: 'user', entite_id: newUserId })
      }
    }

    if (!user)
      return c.json({ success: false, error: 'Erreur authentification Google.' }, 500)

    const tokens = await generateTokenPair(user, c.env.JWT_SECRET)
    await storeRefreshToken(c.env.KV, user.id, tokens.refreshToken)
    await auditLog(c.env.DB, { boutique_id: user.boutique_id, user_id: user.id, action: 'LOGIN_GOOGLE' })

    return c.json({
      success: true,
      ...tokens,
      user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role, boutique_id: user.boutique_id }
    })
  } catch (e) {
    console.error('[auth/google]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

export default auth
