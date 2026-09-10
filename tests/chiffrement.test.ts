/**
 * @file tests/chiffrement.test.ts
 * @description Tests unitaires — src/lib/chiffrement.ts
 *
 * Chiffrement réversible AES-GCM via Web Crypto (ticket 01, chantier Mobilax) — premier
 * chiffrement réversible de ce dépôt. Les usages existants de crypto.subtle
 * (PBKDF2 mot de passe, HMAC JWT/photoToken, SHA-256 NF525) sont tous à sens unique ou du
 * HMAC ; aucun n'est réutilisable pour une valeur qu'il faut relire en clair.
 *
 * Testé contre l'implémentation réelle de Web Crypto, jamais mocké — même parti pris que
 * le chaînage SHA-256 de NF525 (`tests/caisseService.test.ts`).
 */

import { describe, it, expect } from 'vitest'
import { chiffrer, dechiffrer } from '../src/lib/chiffrement'

/** Clé de 256 bits (32 octets), hex — même format qu'une clé Cloudflare secret typique. */
const CLE_TEST = 'a'.repeat(64)
const AUTRE_CLE = 'b'.repeat(64)

describe('chiffrer() / dechiffrer()', () => {
  it('déchiffre exactement ce qui a été chiffré', async () => {
    const clair = 'sk_live_mobilax_1234567890abcdef'

    const chiffre = await chiffrer(clair, CLE_TEST)
    const resultat = await dechiffrer(chiffre, CLE_TEST)

    expect(resultat).toBe(clair)
  })

  it('produit un résultat différent à chaque appel, même pour la même valeur (IV aléatoire)', async () => {
    const clair = 'sk_live_mobilax_1234567890abcdef'

    const chiffre1 = await chiffrer(clair, CLE_TEST)
    const chiffre2 = await chiffrer(clair, CLE_TEST)

    expect(chiffre1).not.toBe(chiffre2)
    // Les deux doivent pourtant redonner la même valeur en clair.
    expect(await dechiffrer(chiffre1, CLE_TEST)).toBe(clair)
    expect(await dechiffrer(chiffre2, CLE_TEST)).toBe(clair)
  })

  it('échoue à déchiffrer avec la mauvaise clé', async () => {
    const chiffre = await chiffrer('valeur secrète', CLE_TEST)

    await expect(dechiffrer(chiffre, AUTRE_CLE)).rejects.toThrow()
  })

  it('la valeur chiffrée ne contient jamais le texte en clair', async () => {
    const clair = 'sk_live_mobilax_reconnaissable'

    const chiffre = await chiffrer(clair, CLE_TEST)

    expect(chiffre).not.toContain(clair)
  })
})
