/**
 * routes/auth.ts — Authentification (register, login, refresh, logout, me)
 */

import { Hono } from 'hono'
import {
  hashPassword, verifyPassword,
  generateTokenPair, validateAccessToken,
  storeRefreshToken, validateRefreshToken, revokeRefreshToken,
  storeOtp, verifyOtp, generateOtp
} from '../lib/auth'
import { validateEmail, auditLog } from '../lib/db'
import { authMiddleware } from '../lib/middleware'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── POST /api/auth/register ───────────────────────────────────────────────────
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
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing)
      return c.json({ success: false, error: 'Cet email est déjà utilisé.' }, 409)

    // Créer la boutique si workshopName fourni
    let boutiqueId: number | null = null
    if (workshopName) {
      const bResult = await c.env.DB.prepare(
        'INSERT INTO boutiques (nom) VALUES (?) RETURNING id'
      ).bind(workshopName).first<{ id: number }>()
      boutiqueId = bResult?.id ?? null

      if (boutiqueId) {
        await c.env.DB.prepare(
          'INSERT INTO boutique_settings (boutique_id) VALUES (?)'
        ).bind(boutiqueId).run()
      }
    }

    // Hasher le mot de passe
    const passwordHash = await hashPassword(password)

    // Créer l'utilisateur (inactif jusqu'à vérification email)
    const result = await c.env.DB.prepare(`
      INSERT INTO users (email, password_hash, prenom, nom, telephone, boutique_id, role_id, actif, email_verifie)
      VALUES (?, ?, ?, ?, ?, ?, 2, 0, 0)
      RETURNING id
    `).bind(email, passwordHash, prenom, nom, telephone ?? null, boutiqueId).first<{ id: number }>()

    const userId = result?.id
    if (!userId) throw new Error('Erreur création utilisateur')

    // Générer et stocker l'OTP
    const otp = generateOtp()
    await storeOtp(c.env.KV, email, otp)

    // Log audit
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

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
auth.post('/verify-otp', async (c) => {
  try {
    const { email, otp } = await c.req.json()
    if (!email || !otp)
      return c.json({ success: false, error: 'Email et OTP requis.' }, 400)

    const valid = await verifyOtp(c.env.KV, email, otp)
    if (!valid)
      return c.json({ success: false, error: 'Code OTP invalide ou expiré.' }, 400)

    // Activer le compte
    await c.env.DB.prepare(
      'UPDATE users SET actif = 1, email_verifie = 1, updated_at = CURRENT_TIMESTAMP WHERE email = ?'
    ).bind(email).run()

    const user = await c.env.DB.prepare(`
      SELECT u.id, u.email, u.prenom, u.nom, u.boutique_id, r.nom as role
      FROM   users u JOIN roles r ON r.id = u.role_id
      WHERE  u.email = ?
    `).bind(email).first<any>()

    if (!user) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)

    const tokens = await generateTokenPair(user, c.env.JWT_SECRET)
    await storeRefreshToken(c.env.KV, user.id, tokens.refreshToken)

    return c.json({ success: true, message: 'Compte activé !', ...tokens, user: { id: user.id, email: user.email, prenom: user.prenom, nom: user.nom, role: user.role } })
  } catch (e) {
    console.error('[verify-otp]', e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ── POST /api/auth/login ──────────────────────────────────────────────────────
auth.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password)
      return c.json({ success: false, error: 'Email et mot de passe requis.' }, 400)

    const user = await c.env.DB.prepare(`
      SELECT u.id, u.email, u.password_hash, u.prenom, u.nom, u.boutique_id, u.actif, u.email_verifie, r.nom as role
      FROM   users u JOIN roles r ON r.id = u.role_id
      WHERE  u.email = ?
    `).bind(email).first<any>()

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

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
auth.post('/refresh', async (c) => {
  try {
    const { userId, refreshToken } = await c.req.json()
    if (!userId || !refreshToken)
      return c.json({ success: false, error: 'userId et refreshToken requis.' }, 400)

    const valid = await validateRefreshToken(c.env.KV, userId, refreshToken)
    if (!valid)
      return c.json({ success: false, error: 'Refresh token invalide ou expiré.' }, 401)

    // Rotation : on révoque l'ancien et on en crée un nouveau
    await revokeRefreshToken(c.env.KV, userId, refreshToken)

    const user = await c.env.DB.prepare(`
      SELECT u.id, u.email, u.prenom, u.nom, u.boutique_id, r.nom as role
      FROM   users u JOIN roles r ON r.id = u.role_id
      WHERE  u.id = ? AND u.actif = 1
    `).bind(userId).first<any>()

    if (!user) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)

    const tokens = await generateTokenPair(user, c.env.JWT_SECRET)
    await storeRefreshToken(c.env.KV, user.id, tokens.refreshToken)

    return c.json({ success: true, ...tokens })
  } catch (e) {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
auth.post('/logout', authMiddleware, async (c) => {
  const { refreshToken } = await c.req.json().catch(() => ({}))
  const user = c.get('user')
  if (refreshToken) await revokeRefreshToken(c.env.KV, user.sub, refreshToken)
  await auditLog(c.env.DB, { user_id: user.sub, action: 'LOGOUT' })
  return c.json({ success: true, message: 'Déconnecté.' })
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
auth.get('/me', authMiddleware, async (c) => {
  const user = c.get('user')
  const profile = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.boutique_id, r.nom as role,
           b.nom as boutique_nom
    FROM   users u
    JOIN   roles r ON r.id = u.role_id
    LEFT JOIN boutiques b ON b.id = u.boutique_id
    WHERE  u.id = ? AND u.actif = 1
  `).bind(user.sub).first()
  if (!profile) return c.json({ success: false, error: 'Utilisateur introuvable.' }, 404)
  return c.json({ success: true, user: profile })
})

export default auth
