/**
 * @file tests/setup.ts
 * @description Setup global Vitest — exécuté avant chaque suite de tests.
 *
 * Responsabilités :
 *   1. Vérifier la disponibilité de Web Crypto API (Node 18+)
 *   2. S'assurer que `crypto.subtle` est disponible globalement
 *      (requis par authService, nf525.ts, lib/auth.ts)
 *
 * Note : Node 18+ expose `globalThis.crypto` nativement avec Web Crypto API complète.
 * Pas de polyfill nécessaire si la version de Node est >= 18.
 */

import { vi } from 'vitest'

// Vérifier Web Crypto disponible (requis par PBKDF2, SHA-256, getRandomValues)
if (!globalThis.crypto?.subtle) {
  throw new Error(
    '[tests/setup] Web Crypto API non disponible. Requires Node >= 18. ' +
    `Version actuelle : ${process.version}`
  )
}
