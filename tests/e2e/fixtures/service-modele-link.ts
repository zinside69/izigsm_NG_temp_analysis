/**
 * @file tests/e2e/fixtures/service-modele-link.ts
 * @description Helper E2E — lie un service à un modèle d'appareil du référentiel
 * global, via l'API publique.
 *
 * Historique : ce helper écrivait initialement en direct dans le SQLite de D1 local,
 * avec `PRAGMA foreign_keys = OFF`, parce que `POST /api/services/modeles/:id/services`
 * était inutilisable — `service_modeles.modele_id` référençait `modeles_appareils_old`,
 * table renommée puis supprimée par la migration 0031, laissant une clé étrangère
 * pendante et faisant échouer tout INSERT en 500, y compris pour un appelant légitime.
 *
 * La migration `0038_service_modeles_fk_reconstruction.sql` (2026-07-31) a reconstruit
 * la table avec la bonne référence. Le contournement n'a plus lieu d'être : ce helper
 * passe désormais par la vraie route, comme le reste des fixtures E2E — un test qui
 * écrit en base par la porte de derrière ne peut pas détecter une régression de schéma.
 */
import type { APIRequestContext } from '@playwright/test'

/**
 * Lie un service à un modèle d'appareil, avec le compte propriétaire du service.
 *
 * La route vérifie que le service appartient bien à la boutique de l'appelant
 * (le modèle, lui, est global) : le token passé doit donc être celui du tenant
 * propriétaire du service, sans quoi la liaison est refusée en 403.
 */
export async function lierServiceAModele(
  request: APIRequestContext,
  accessToken: string,
  modeleId: number,
  serviceId: number,
  prixHtSpecifique: number | null = null
): Promise<void> {
  const res = await request.post(`/api/services/modeles/${modeleId}/services`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { service_id: serviceId, prix_ht_specifique: prixHtSpecifique },
  })
  if (!res.ok()) {
    throw new Error(
      `liaison service ${serviceId} <-> modele ${modeleId} echouee: ${res.status()} ${await res.text()}`
    )
  }
}
