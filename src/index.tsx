import { Hono } from 'hono'
import { cors } from 'hono/cors'

/**
 * iziGSM — API Backend (Cloudflare Pages Functions)
 *
 * Architecture Cloudflare Pages :
 * - Les fichiers dans dist/ (HTML, CSS, JS) sont servis AUTOMATIQUEMENT
 *   par Cloudflare Pages sans aucune route Hono nécessaire.
 * - Hono gère UNIQUEMENT les routes /api/* côté Worker.
 * - Le routing des pages HTML est géré par _routes.json généré par wrangler.
 */

const app = new Hono()

// ─── CORS pour les routes API ───────────────────────────────────────────────
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({
    status   : 'ok',
    app      : 'iziGSM',
    version  : '1.0.0',
    timestamp: new Date().toISOString()
  })
})

// ─── POST /api/register ─────────────────────────────────────────────────────
app.post('/api/register', async (c) => {
  try {
    const body = await c.req.json()
    const { email, firstName, lastName, workshopName, phone } = body

    if (!email || !firstName || !lastName) {
      return c.json({ success: false, error: 'Champs obligatoires manquants.' }, 400)
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    console.log(`[iziGSM] Nouveau compte : ${email} — OTP DÉMO: ${otp}`)

    return c.json({
      success : true,
      message : 'Code OTP généré.',
      otpDemo : otp,
      user    : { email, firstName, lastName, workshopName, phone }
    })
  } catch {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/verify-otp ───────────────────────────────────────────────────
app.post('/api/verify-otp', async (c) => {
  try {
    const { email, otp, expectedOtp } = await c.req.json()
    if (!email || !otp) return c.json({ success: false, error: 'Données manquantes.' }, 400)

    const valid = otp === expectedOtp
    return c.json({
      success: valid,
      message: valid ? 'Compte activé avec succès !' : 'Code OTP invalide ou expiré.',
      token  : valid ? `demo_${Date.now()}` : null
    })
  } catch {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/login ────────────────────────────────────────────────────────
app.post('/api/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password) {
      return c.json({ success: false, error: 'Email et mot de passe requis.' }, 400)
    }

    const isDemo        = email === 'demo@izigsm.fr' && password === 'Demo1234'
    const isValidFormat = email.includes('@') && password.length >= 6

    if (!isDemo && !isValidFormat) {
      return c.json({ success: false, error: 'Identifiants incorrects.' }, 401)
    }

    return c.json({
      success : true,
      message : 'Connexion réussie.',
      token   : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      user    : {
        id           : 1,
        email,
        firstName    : isDemo ? 'Démo' : email.split('@')[0],
        lastName     : 'iziGSM',
        workshopName : isDemo ? 'Atelier Démo' : 'Mon Atelier',
        plan         : 'trial',
        trialDaysLeft: 14
      }
    })
  } catch {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── POST /api/logout ───────────────────────────────────────────────────────
app.post('/api/logout', (c) => {
  return c.json({ success: true, message: 'Déconnecté.' })
})

// ─── GET /api/stats ─────────────────────────────────────────────────────────
app.get('/api/stats', (c) => {
  return c.json({
    tickets  : { total: 12, enCours: 5, termines: 7 },
    devis    : { total: 8,  enAttente: 3, acceptes: 5 },
    factures : { total: 6,  montantTotal: 2340.50 },
    clients  : { total: 24, nouveaux: 3 }
  })
})

export default app
