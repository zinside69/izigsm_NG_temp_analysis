/**
 * console-boutiques.js — Console des boutiques (admin plateforme)
 *
 * Point d'entrée de l'exploitant du SaaS à la connexion : la liste des enseignes
 * clientes actives, avec pour chacune son nom, son slug et son nombre de comptes.
 *
 * Choisir une boutique fait entrer l'exploitant dans son contexte : le choix vaut pour
 * toute la session et les pages métier existantes basculent dessus sans être modifiées
 * (ticket 02 du chantier supervision).
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
    // Le nom est porté par un attribut plutôt que relu dans le DOM : ce qui est
    // mémorisé en session doit être la donnée reçue de l'API, pas le rendu.
    document.getElementById('console-list').innerHTML = liste.map(b => `
      <tr class="b-ligne" data-boutique-id="${_esc(b.boutique_id ?? b.id)}" data-boutique-nom="${_esc(b.nom)}">
        <td class="b-nom" style="font-weight:600;">
          <button type="button" class="b-select">${_esc(b.nom)}</button>
        </td>
        <td class="b-slug">${_esc(b.slug || '—')}</td>
        <td class="b-comptes" style="text-align:right;">${_esc(b.nb_comptes ?? 0)}</td>
      </tr>
    `).join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SÉLECTION
  // ══════════════════════════════════════════════════════════════════════════

  /** Page métier où l'on atterrit après avoir choisi une boutique. */
  const PAGE_APRES_SELECTION = '/dashboard';

  /**
   * Entre dans le contexte d'une boutique : le choix est mémorisé dans la session,
   * puis les pages métier existantes basculent d'elles-mêmes dessus — elles passent
   * toutes par le résolveur partagé d'`app.js`, aucune n'a été adaptée pour ça.
   *
   * @param {HTMLTableRowElement} ligne - Ligne cliquée
   */
  function selectionner(ligne) {
    const id  = ligne.dataset.boutiqueId;
    const nom = ligne.dataset.boutiqueNom || '';
    if (!id) return;

    if (!selectionnerBoutique(id, nom)) {
      // Sans session ouverte, mémoriser le choix n'aurait aucun effet et la page
      // suivante repartirait sans boutique : le dire plutôt que naviguer dans le vide.
      _afficherMessage(
        'erreur',
        'Session introuvable',
        'Votre session a expiré. Reconnectez-vous pour choisir une boutique.'
      );
      return;
    }

    window.location.href = PAGE_APRES_SELECTION;
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

    // Délégation sur le conteneur : les lignes sont réécrites à chaque recherche,
    // un écouteur par ligne serait à recâbler à chaque rendu. Le bouton porte
    // l'accessibilité (focus, clavier), la ligne entière reste cliquable au pointeur.
    document.getElementById('console-list').addEventListener('click', (e) => {
      const ligne = e.target.closest('tr.b-ligne');
      if (ligne) selectionner(ligne);
    });

    charger();
  }

  // Surface publique réduite à l'amorçage : rien d'autre n'est appelé depuis le
  // HTML ni depuis un autre script. Exposer davantage figerait des détails
  // internes que les tickets 02 et 03 vont faire bouger.
  return { init };
})();

document.addEventListener('DOMContentLoaded', ConsoleBoutiques.init);
