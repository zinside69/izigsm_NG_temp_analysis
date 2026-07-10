/**
 * @module services/sirenService
 * @description Model P1 : recherche d'entreprises françaises via l'API publique
 *              recherche-entreprises.api.gouv.fr (gratuite, sans clé, données INSEE/SIRENE).
 *
 * Rôle architectural (P1 MVC) : seul endroit du code qui appelle cette API externe.
 * `routes/public.ts` est un controller pur qui délègue ici — même principe que
 * `emailService.ts` pour Resend.
 *
 * Usage : autocomplete "Rechercher mon entreprise" à l'inscription (register.html
 * étape 2) et onboarding post-Google (register.html/login.html) — préremplit
 * nom/SIRET/adresse pour éviter la saisie manuelle et réduire les erreurs.
 *
 * Périmètre volontairement restreint : seuls nom/SIRET/adresse sont exposés.
 * La forme juridique (`nature_juridique`, code INSEE à 4 chiffres, ex: 5710=SAS)
 * n'est pas mappée vers le select `legal_form` existant — table de correspondance
 * INSEE trop large pour la valeur ajoutée ici, l'utilisateur la choisit lui-même.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntrepriseResult {
  siren:       string
  siret:       string
  nom:         string
  adresse:     string
  code_postal: string
  ville:       string
}

// ─── Recherche ────────────────────────────────────────────────────────────────

/**
 * Recherche des entreprises par nom, SIREN ou SIRET via l'API gouv.fr.
 * Ne jette jamais d'exception — retourne un tableau vide en cas d'erreur ou de
 * réponse non-OK (l'autocomplete frontend doit rester silencieux sur un échec).
 *
 * @param query  Terme de recherche (nom d'entreprise, SIREN 9 chiffres ou SIRET 14 chiffres)
 * @returns      Jusqu'à 5 résultats (établissement siège), tableau vide si rien trouvé/erreur
 */
export async function searchEntreprises(query: string): Promise<EntrepriseResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  try {
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=5`
    const resp = await fetch(url)
    if (!resp.ok) return []

    const body = await resp.json() as { results?: any[] }
    if (!Array.isArray(body.results)) return []

    return body.results
      .filter(r => r.siege?.siret)
      .map(r => ({
        siren:       r.siren,
        siret:       r.siege.siret,
        nom:         r.nom_complet ?? r.nom_raison_sociale ?? '',
        adresse:     formatAdresse(r.siege),
        code_postal: r.siege.code_postal ?? '',
        ville:       r.siege.libelle_commune ?? '',
      }))
  } catch (e) {
    console.error('[searchEntreprises]', e)
    return []
  }
}

/**
 * Reconstruit une adresse lisible (numéro + type de voie + libellé) à partir des
 * champs structurés de l'API — évite de dépendre de `siege.adresse` (chaîne brute
 * qui inclut déjà le code postal et la ville, redondant avec nos champs séparés).
 */
function formatAdresse(siege: any): string {
  return [siege.numero_voie, siege.type_voie, siege.libelle_voie]
    .filter(Boolean)
    .join(' ')
    .trim()
}
