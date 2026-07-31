/**
 * @file tests/e2e/fixtures/service-modele-link.ts
 * @description Helper E2E — crée une liaison `service_modeles` directement dans la
 * base D1 locale (miniflare), en contournant l'API.
 *
 * Pourquoi ne pas passer par `POST /api/services/modeles/:id/services` :
 * un bug de schéma PRÉ-EXISTANT rend cet endpoint inutilisable dans tous les cas —
 * `service_modeles.modele_id` référence encore `modeles_appareils_old`, table
 * renommée puis supprimée par la migration 0031, laissant une FK pendante. Tout
 * INSERT dans `service_modeles` échoue donc en 500 `no such table:
 * main.modeles_appareils_old`, y compris pour un appelant parfaitement légitime
 * (constaté et documenté dans `isolation-routes.spec.ts`, describe « Liaison
 * service <-> modele », et re-vérifié le 2026-07-31).
 *
 * Sans ce contournement, aucun test ne pourrait démontrer la fuite de tarifs
 * inter-tenants sur `GET /api/services/modeles/:id/services` : la table resterait
 * vide et les deux tenants verraient une liste vide, ce qui ne prouve rien.
 *
 * Ce helper n'est utilisable que contre un `wrangler pages dev --local` (même
 * contrainte que `createTenantAdmin`, qui dépend d'`otpDemo`). Il n'a aucun effet
 * en dehors du poste de développement.
 */
// @ts-ignore node:fs types not available without @types/node
import { readdirSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
// @ts-ignore node:sqlite types not available without @types/node
import { DatabaseSync } from 'node:sqlite'

/** Répertoire de persistance D1 de miniflare (créé par `wrangler pages dev --local`). */
const D1_DIR = join(
  // @ts-ignore process types not available without @types/node
  process.cwd(), '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject'
)

/**
 * Résout le fichier SQLite de la base D1 locale.
 * Son nom est un hash SHA-256 propre à chaque poste — d'où la reconnaissance par
 * motif (64 caractères hexadécimaux), qui écarte au passage le `metadata.sqlite`
 * interne de miniflare présent dans le même répertoire.
 */
function resolveD1File(): string {
  const fichiers = readdirSync(D1_DIR).filter((f: string) => /^[0-9a-f]{64}\.sqlite$/.test(f))
  if (fichiers.length !== 1) {
    throw new Error(
      `Base D1 locale introuvable ou ambigue dans ${D1_DIR} (${fichiers.length} fichier(s) .sqlite). ` +
      `Lancer les migrations locales avant les tests E2E.`
    )
  }
  return join(D1_DIR, fichiers[0])
}

/**
 * Lie un service à un modèle d'appareil (référentiel global) en écrivant
 * directement dans D1 local.
 *
 * `PRAGMA foreign_keys = OFF` : uniquement pour contourner la FK pendante décrite
 * en tête de fichier — la liaison écrite est par ailleurs parfaitement valide.
 */
export function lierServiceAModele(serviceId: number, modeleId: number, prixHtSpecifique: number | null = null): void {
  const db = new DatabaseSync(resolveD1File())
  try {
    db.exec('PRAGMA foreign_keys = OFF')
    db.prepare(`
      INSERT OR REPLACE INTO service_modeles (service_id, modele_id, prix_ht_specifique, actif)
      VALUES (?, ?, ?, 1)
    `).run(serviceId, modeleId, prixHtSpecifique)
  } finally {
    db.close()
  }
}
