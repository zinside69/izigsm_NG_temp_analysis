/**
 * @file vitest.config.ts
 * @description Configuration Vitest pour iziGSM.
 *
 * Stratégie de test adaptée à Cloudflare Workers :
 *   - Environnement `node` (pas `jsdom`) — les services sont du TS pur sans DOM
 *   - Web Crypto API disponible nativement dans Node 18+ (globalThis.crypto)
 *   - D1Database et KVNamespace mockés via des helpers dans `tests/helpers/`
 *   - Pas de wrangler au runtime — les tests sont unitaires (pas d'intégration CF)
 *
 * Coverage :
 *   - Provider : `v8` (natif Node, pas besoin d'instrumentation babel)
 *   - Reporters : text (terminal) + html (dist/coverage/)
 *   - Seuil minimal : 70% (lignes/fonctions/branches)
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Environnement Node — Web Crypto disponible nativement dans Node 18+
    environment: 'node',

    // Fichiers de test — pattern standard
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],

    // Globals (describe, it, expect) sans import explicite
    globals: true,

    // Setup global avant tous les tests (polyfills si nécessaire)
    setupFiles: ['tests/setup.ts'],

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'dist/coverage',
      include: ['src/services/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/routes/**'],
      thresholds: {
        lines:     70,
        functions: 70,
        branches:  60,
      },
    },
  },
})
