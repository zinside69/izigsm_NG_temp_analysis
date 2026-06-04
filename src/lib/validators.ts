/**
 * lib/validators.ts — Validation centralisée des entrées (P3 BFF Hono)
 * Rôle architectural : chaque fonction retourne null si valide,
 * ou un message d'erreur string si invalide.
 * Les routes appellent ces fonctions AVANT toute logique métier.
 */

// ─── Services ─────────────────────────────────────────────────────────────────

/**
 * Valide le corps d'une requête de création/modification de service.
 * @returns null si valide, message d'erreur sinon
 */
export function validateService(body: any): string | null {
  if (!body.nom?.trim())
    return 'Nom du service obligatoire.'
  if (body.prix_ht === undefined || body.prix_ht === null || isNaN(Number(body.prix_ht)) || Number(body.prix_ht) < 0)
    return 'Prix HT obligatoire (≥ 0).'
  if (body.tva_taux !== undefined && ![0, 5.5, 10, 20].includes(Number(body.tva_taux)))
    return 'Taux TVA invalide. Valeurs acceptées : 0, 5.5, 10, 20.'
  if (body.duree_minutes !== undefined && body.duree_minutes !== null && (isNaN(Number(body.duree_minutes)) || Number(body.duree_minutes) < 0))
    return 'Durée invalide (en minutes, ≥ 0).'
  if (body.garantie_jours !== undefined && (isNaN(Number(body.garantie_jours)) || Number(body.garantie_jours) < 0))
    return 'Garantie invalide (en jours, ≥ 0).'
  return null
}

/**
 * Valide le corps d'une requête de création/modification de catégorie de service.
 * @returns null si valide, message d'erreur sinon
 */
export function validateCategorieService(body: any): string | null {
  if (!body.nom?.trim())
    return 'Nom de catégorie obligatoire.'
  if (body.couleur && !/^#[0-9a-fA-F]{6}$/.test(body.couleur))
    return 'Couleur invalide (format #RRGGBB attendu).'
  return null
}

// ─── Clients ──────────────────────────────────────────────────────────────────

/**
 * Valide le corps d'une requête client.
 * @returns null si valide, message d'erreur sinon
 */
export function validateClient(body: any): string | null {
  if (!body.prenom?.trim() || !body.nom?.trim())
    return 'Prénom et nom obligatoires.'
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    return 'Email invalide.'
  return null
}

// ─── Tickets ──────────────────────────────────────────────────────────────────

/**
 * Valide le corps d'une requête ticket.
 * @returns null si valide, message d'erreur sinon
 */
export function validateTicket(body: any): string | null {
  if (!body.client_id)
    return 'client_id obligatoire.'
  if (!body.appareil_marque?.trim())
    return 'Marque de l\'appareil obligatoire.'
  if (!body.appareil_modele?.trim())
    return 'Modèle de l\'appareil obligatoire.'
  if (!body.description_panne?.trim())
    return 'Description de la panne obligatoire.'
  return null
}
