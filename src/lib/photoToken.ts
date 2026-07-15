/**
 * @module photoToken
 * @description Jetons courte durée (5 min) signés HMAC-SHA256 pour l'accès direct
 * aux photos de tickets via `<img src="...">`.
 *
 * Pourquoi : une balise `<img>` ne peut jamais porter de header `Authorization` —
 * l'accès aux photos ne peut donc pas dépendre du JWT de session (comme le reste
 * de l'API). Plutôt que d'exposer ce JWT complet (1h, tous droits) dans une URL
 * (historique navigateur, logs, header Referer), on émet un jeton dédié, scopé à
 * une seule photo et de très courte durée de vie — même principe que les URLs
 * présignées S3, sans dépendre de credentials S3/R2 supplémentaires (le binding
 * R2 direct de ce projet n'expose pas l'API S3).
 *
 * Émission : `GET /api/tickets/:id/photos/:photoId/url` (authentifié, JWT normal).
 * Consommation : `GET /api/photo-view/:token` (public, hors authMiddleware —
 * voir index.tsx, même pattern que la route iCal publique).
 */

const PHOTO_TOKEN_TTL = 300 // 5 minutes — suffisant pour charger une vignette/lightbox

interface PhotoTokenPayload {
  photoId:     number
  boutiqueId:  number
  exp:         number
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): string {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  return atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

/**
 * Signe un jeton d'accès photo court terme, scopé à une photo et une boutique précises.
 * @param photoId     ID de la photo
 * @param boutiqueId  ID boutique propriétaire (revalidé à la vérification, isolation multi-tenant)
 * @param secret      Clé HMAC (réutilise `JWT_SECRET`, même secret Cloudflare que les JWT de session)
 * @returns           Jeton compact `payloadB64url.signatureB64url`
 */
export async function signPhotoToken(photoId: number, boutiqueId: number, secret: string): Promise<string> {
  const payload: PhotoTokenPayload = {
    photoId,
    boutiqueId,
    exp: Math.floor(Date.now() / 1000) + PHOTO_TOKEN_TTL,
  }
  const encoder = new TextEncoder()
  const p   = base64url(encoder.encode(JSON.stringify(payload)))
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(p))
  return `${p}.${base64url(new Uint8Array(sig))}`
}

/**
 * Vérifie un jeton d'accès photo : signature HMAC-SHA256 + expiration.
 * @param token   Jeton à vérifier
 * @param secret  Clé HMAC (doit correspondre à celle utilisée lors de la signature)
 * @returns       Payload décodé si valide, `null` sinon (signature invalide, expiré, malformé)
 */
export async function verifyPhotoToken(token: string, secret: string): Promise<PhotoTokenPayload | null> {
  try {
    const [p, sig] = token.split('.')
    if (!p || !sig) return null
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(p))
    if (!valid) return null
    const payload = JSON.parse(base64urlDecode(p)) as PhotoTokenPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
