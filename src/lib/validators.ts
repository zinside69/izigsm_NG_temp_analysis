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

// ─── Fournisseurs ─────────────────────────────────────────────────────────────

/**
 * Valide le corps d'une requête fournisseur.
 * @returns null si valide, message d'erreur sinon
 */
export function validateFournisseur(body: any): string | null {
  if (!body.nom?.trim())
    return 'Nom du fournisseur obligatoire.'
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
    return 'Email invalide.'
  return null
}

/**
 * Valide le corps d'une requête bon de commande.
 * @returns null si valide, message d'erreur sinon
 */
export function validateBonCommande(body: any): string | null {
  if (!body.fournisseur_id || isNaN(Number(body.fournisseur_id)))
    return 'fournisseur_id obligatoire.'
  if (!Array.isArray(body.lignes) || body.lignes.length === 0)
    return 'Au moins une ligne de commande obligatoire.'
  for (const [i, l] of body.lignes.entries()) {
    if (!l.designation?.trim())
      return `Ligne ${i + 1} : désignation obligatoire.`
    if (!l.quantite_commandee || l.quantite_commandee <= 0)
      return `Ligne ${i + 1} : quantité doit être > 0.`
    if (l.prix_achat_ht === undefined || l.prix_achat_ht === null || isNaN(Number(l.prix_achat_ht)) || Number(l.prix_achat_ht) < 0)
      return `Ligne ${i + 1} : prix achat HT obligatoire (≥ 0).`
  }
  return null
}

// ─── Agenda ───────────────────────────────────────────────────────────────────

const TYPES_RDV_VALIDES  = ['reparation','restitution','devis','diagnostic','autre']
const STATUTS_RDV_VALIDES = ['PENDING','SCHEDULED','DONE','NO_SHOW','CANCELLED','CONVERTED']

/**
 * Valide le corps d'une requête rendez-vous.
 * @returns null si valide, message d'erreur sinon
 */
export function validateRendezVous(body: any): string | null {
  if (!body.titre?.trim())
    return 'Titre du rendez-vous obligatoire.'
  if (!body.debut)
    return 'Date/heure de début obligatoire.'
  if (isNaN(Date.parse(body.debut)))
    return 'Format date/heure début invalide (ISO 8601 attendu).'
  if (body.fin && isNaN(Date.parse(body.fin)))
    return 'Format date/heure fin invalide.'
  if (body.fin && new Date(body.fin) <= new Date(body.debut))
    return 'La fin doit être postérieure au début.'
  if (body.duree_minutes !== undefined && (isNaN(Number(body.duree_minutes)) || Number(body.duree_minutes) <= 0))
    return 'duree_minutes doit être un entier positif.'
  if (body.type_rdv && !TYPES_RDV_VALIDES.includes(body.type_rdv))
    return `type_rdv invalide. Valeurs : ${TYPES_RDV_VALIDES.join(', ')}`
  if (body.statut && !STATUTS_RDV_VALIDES.includes(body.statut))
    return `statut invalide. Valeurs : ${STATUTS_RDV_VALIDES.join(', ')}`
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

/**
 * Valide qu'une signature client (prise en charge) est un data URL image PNG/JPEG
 * en base64 — rien d'autre. Rejette toute autre valeur avant stockage.
 *
 * Nécessaire car `signature_client` est ensuite interpolé dans un `<img src="...">`
 * côté frontend (`tickets.js`) — l'échappement `esc()` utilisé ailleurs n'échappe
 * pas les guillemets et ne protège donc pas ce contexte attribut. Valider le format
 * en amont (charset restreint au base64) empêche toute injection HTML, y compris
 * via un appel API direct qui contournerait le canvas de dessin.
 *
 * @returns null si valide, message d'erreur sinon
 */
export function validateSignatureDataUrl(value: string): string | null {
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value))
    return 'Signature invalide (format data URL image attendu).'
  return null
}

// ─── SAV & Garanties ──────────────────────────────────────────────────────────

const STATUTS_SAV_VALIDES = ['ouvert', 'en_traitement', 'resolu', 'refuse', 'clos']

/**
 * Valide le corps d'une requête d'ouverture de dossier SAV.
 * @returns null si valide, message d'erreur sinon
 */
export function validateSav(body: any): string | null {
  if (!body.motif?.trim())
    return 'Motif du SAV obligatoire.'
  if (body.garantie_id !== undefined && body.garantie_id !== null && isNaN(Number(body.garantie_id)))
    return 'garantie_id invalide.'
  if (body.client_id !== undefined && body.client_id !== null && isNaN(Number(body.client_id)))
    return 'client_id invalide.'
  return null
}

/**
 * Valide un changement de statut SAV.
 * @returns null si valide, message d'erreur sinon
 */
export function validateSavStatut(body: any): string | null {
  if (!body.statut?.trim())
    return 'statut obligatoire.'
  if (!STATUTS_SAV_VALIDES.includes(body.statut))
    return `statut invalide. Valeurs : ${STATUTS_SAV_VALIDES.join(', ')}`
  return null
}

/**
 * Valide le corps d'une requête de création manuelle de garantie.
 * @returns null si valide, message d'erreur sinon
 */
export function validateGarantie(body: any): string | null {
  if (body.garantie_jours !== undefined &&
      (isNaN(Number(body.garantie_jours)) || Number(body.garantie_jours) < 1 || Number(body.garantie_jours) > 3650))
    return 'garantie_jours invalide (1–3650 jours).'
  if (body.ticket_id !== undefined && body.ticket_id !== null && isNaN(Number(body.ticket_id)))
    return 'ticket_id invalide.'
  return null
}
