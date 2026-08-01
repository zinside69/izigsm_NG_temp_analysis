/**
 * console-boutiques.js — Console des boutiques (admin plateforme)
 *
 * Point d'entrée de l'exploitant du SaaS à la connexion : la liste des enseignes
 * clientes actives, avec pour chacune son nom, son slug et son nombre de comptes.
 *
 * Périmètre volontairement en lecture seule (ticket 01 du chantier supervision) :
 * cliquer une boutique ne fait rien encore, la sélection arrive au ticket 02.
 *
 * Vocabulaire (`CONTEXT.md` § Multi-tenant) : « admin plateforme » et « manager »,
 * jamais « admin » seul — le rôle en base reste `admin`, mais il désigne ici
 * l'exploitant, pas le responsable d'une boutique cliente.
 */

const ConsoleBoutiques = (() => {
  /** Boutiques renvoyées par l'API, avant filtrage par la recherche. */
  let _boutiques = [];

  // ══════════════════════════════════════════════════════════════════════════
  // UTILITAIRES
  // ══════════════════════════════════════════════════════════════════════════

  /** Échappement HTML — app.js n'expose pas d'utilitaire partagé pour ça. */
  function _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Affiche un message à la place du tableau (chargement, liste vide, erreur).
   * Un seul des deux blocs est visible à la fois : une liste vide muette est
   * indiscernable d'un écran cassé.
   *
   * `data-etat` porte l'état courant : les quatre messages partagent le même
   * conteneur, et « en cours de chargement » ne doit pas pouvoir se confondre
   * avec « il n'y a rien » — ni à l'œil, ni pour un test, ni pour `aria-busy`.
   *
   * @param {'chargement'|'vide'|'aucun-resultat'|'erreur'} etat
   */
  function _afficherMessage(etat, titre, texte) {
    document.getElementById('console-table').style.display = 'none';
    // Vider réellement le tableau : le masquer en CSS y laisserait les lignes
    // précédentes, encore lisibles par une technologie d'assistance et par tout
    // ce qui interroge le DOM — un « aucun résultat » qui contient des résultats.
    document.getElementById('console-list').innerHTML = '';
    const bloc = document.getElementById('console-empty');
    bloc.style.display = '';
    bloc.dataset.etat = etat;
    bloc.setAttribute('aria-busy', etat === 'chargement' ? 'true' : 'false');
    document.getElementById('console-empty-title').textContent = titre;
    document.getElementById('console-empty-text').textContent  = texte;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDU
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Rend la liste filtrée par la recherche courante.
   * Distingue trois cas : aucune boutique cliente, aucun résultat de recherche,
   * et la liste normale — les deux premiers ont des messages différents parce
   * qu'ils appellent des actions différentes.
   */
  function rendre() {
    const filtre = (document.getElementById('console-search')?.value || '').trim().toLowerCase();
    const liste  = filtre
      ? _boutiques.filter(b => (b.nom || '').toLowerCase().includes(filtre))
      : _boutiques;

    const compteur = document.getElementById('console-compteur');
    compteur.textContent = _boutiques.length
      ? `Boutiques (${liste.length}${filtre ? ` sur ${_boutiques.length}` : ''})`
      : 'Boutiques';

    if (_boutiques.length === 0) {
      _afficherMessage(
        'vide',
        'Aucune boutique cliente enregistrée',
        "La plateforme ne compte encore aucune enseigne active. Cet écran se remplira dès qu'un client sera créé."
      );
      return;
    }

    if (liste.length === 0) {
      _afficherMessage(
        'aucun-resultat',
        'Aucune boutique ne correspond',
        `Aucune enseigne active ne porte un nom contenant « ${filtre} ».`
      );
      return;
    }

    document.getElementById('console-empty').style.display = 'none';
    document.getElementById('console-table').style.display = '';
    document.getElementById('console-list').innerHTML = liste.map(b => `
      <tr data-boutique-id="${_esc(b.boutique_id ?? b.id)}">
        <td class="b-nom" style="font-weight:600;">${_esc(b.nom)}</td>
        <td class="b-slug">${_esc(b.slug || '—')}</td>
        <td class="b-comptes" style="text-align:right;">${_esc(b.nb_comptes ?? 0)}</td>
      </tr>
    `).join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHARGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Charge les boutiques actives. `GET /api/boutiques` renvoie déjà toutes les
   * boutiques à ce rôle ; le nombre de comptes vient de l'enrichissement du
   * chemin admin plateforme (`listAllBoutiques`).
   */
  async function charger() {
    const res = await apiGet('/api/boutiques');

    // Piège connu du dépôt (bugs.md) : le corps applicatif est dans `res.data.data`,
    // pas `res.data` — `res` est l'enveloppe du wrapper fetch d'app.js.
    if (!res.ok || !Array.isArray(res.data?.data)) {
      _afficherMessage(
        'erreur',
        'Boutiques indisponibles',
        res.error || "La liste des boutiques n'a pas pu être récupérée. Réessayez dans un instant."
      );
      return;
    }

    _boutiques = res.data.data;
    rendre();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALISATION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Garde d'accès + amorçage.
   * Un manager qui atteindrait cette URL repart vers son tableau de bord :
   * l'écran n'a pas de sens pour lui, et l'API ne lui renverrait de toute façon
   * que sa propre boutique.
   */
  function init() {
    const session = requireAuth();
    if (!session) return;

    if (!isAdminPlateforme(session)) {
      window.location.replace('/dashboard');
      return;
    }

    document.getElementById('console-identite').textContent = session.name || session.email || '';
    document.getElementById('console-search')?.addEventListener('input', rendre);
    charger();
  }

  // Surface publique réduite à l'amorçage : rien d'autre n'est appelé depuis le
  // HTML ni depuis un autre script. Exposer davantage figerait des détails
  // internes que les tickets 02 et 03 vont faire bouger.
  return { init };
})();

document.addEventListener('DOMContentLoaded', ConsoleBoutiques.init);
