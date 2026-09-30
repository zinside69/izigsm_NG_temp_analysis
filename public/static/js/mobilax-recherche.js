/**
 * iziGSM — mobilax-recherche.js
 * Module de recherche Mobilax partagé (ticket 06, chantier `integration-mobilax`).
 *
 * Point d'entrée unique : monterRechercheMobilax(conteneur, { surSelection }). Construit un
 * champ de recherche paginé (GET /api/mobilax/produits) ; un clic sur un résultat calcule son
 * prix de vente marginé côté serveur (GET /api/mobilax/prix-vente, jamais un prix venu du
 * navigateur) puis appelle `surSelection(...)`. Ce module n'insère jamais de ligne lui-même et
 * ne porte aucune logique propre à un écran — c'est l'appelant qui décide quoi faire de la
 * sélection (tickets 07-09 : facture, caisse, prise en charge).
 *
 * Dépend de `app.js` (apiGet, echapperHtml, formatMoney) — chargé après lui, avant tout écran
 * appelant.
 */

'use strict';

/**
 * Monte la recherche Mobilax dans `conteneur` (vidé puis reconstruit à chaque appel).
 *
 * @param {HTMLElement} conteneur
 * @param {{ surSelection: (choix: {
 *   description: string, prix_unitaire_ht: number, prix_achat_ht: number,
 *   famille: string, taux: number|null, mobilax_id: number
 * }) => void }} options
 */
function monterRechercheMobilax(conteneur, { surSelection }) {
  if (!conteneur) return;

  // La barre de pagination porte hidden sur une enveloppe sans classe ni display en ligne
  // (data-role, pas class) : posé directement sur .mx-recherche-pagination, qui garde son
  // display:flex en ligne, l'attribut serait écrasé et la barre resterait affichée sur une
  // seule page — même défaut que #mobilax-pagination (stock.html/js, bugs.md 2026-09-15).
  conteneur.innerHTML = `
    <form class="mx-recherche-form" style="display:flex;gap:8px;margin-bottom:10px;">
      <input type="search" class="mx-recherche-terme" placeholder="Nom ou EAN — ex. écran iPhone 12"
             style="flex:1;padding:8px 10px;border:1px solid #d0d5dd;border-radius:8px;font:inherit;font-size:0.88rem;">
      <button type="submit" class="btn btn-sm btn-secondary mx-recherche-chercher">Chercher</button>
    </form>
    <div class="mx-recherche-message" style="font-size:0.85rem;color:var(--muted);margin-bottom:8px;"></div>
    <div class="mx-recherche-resultats"></div>
    <div data-role="mx-recherche-pagination-enveloppe" hidden>
      <div class="mx-recherche-pagination" style="display:flex;align-items:center;gap:10px;margin-top:8px;">
        <button type="button" class="btn btn-ghost btn-sm mx-recherche-precedente">« Précédente</button>
        <span class="mx-recherche-page" style="font-size:0.82rem;color:var(--muted);"></span>
        <button type="button" class="btn btn-ghost btn-sm mx-recherche-suivante">Suivante »</button>
      </div>
    </div>
  `;

  const form             = conteneur.querySelector('.mx-recherche-form');
  const champTerme       = conteneur.querySelector('.mx-recherche-terme');
  const zoneMessage      = conteneur.querySelector('.mx-recherche-message');
  const zoneResultats    = conteneur.querySelector('.mx-recherche-resultats');
  const pagination       = conteneur.querySelector('[data-role="mx-recherche-pagination-enveloppe"]');
  const boutonPrecedente = conteneur.querySelector('.mx-recherche-precedente');
  const boutonSuivante   = conteneur.querySelector('.mx-recherche-suivante');
  const pageLabel        = conteneur.querySelector('.mx-recherche-page');

  const etat = { page: 1, pages: 1 };
  // Un seul calcul de prix à la fois : un clic sur un résultat pendant qu'un calcul est en
  // cours (le même résultat, ou un autre) n'insère jamais deux lignes.
  let selectionEnCours = false;

  function message(texte, estErreur = false) {
    zoneMessage.textContent = texte;
    zoneMessage.style.color = estErreur ? 'var(--red)' : 'var(--muted)';
  }

  /** Message d'erreur Mobilax normalisé (route produits ou prix-vente, même enveloppe). */
  function messageErreurMobilax(reponse) {
    const delai    = reponse?.reessayer_dans_s;
    const suffixe  = delai ? ` Réessayez dans ${delai} s.` : '';
    message((reponse?.error || 'Mobilax est indisponible.') + suffixe, true);
  }

  async function chercher(page) {
    const terme = champTerme.value.trim();
    if (terme.length < 2) { message('Saisissez au moins 2 caractères.', true); return; }

    zoneResultats.innerHTML = '';
    pagination.hidden = true;
    message('Recherche en cours…');

    let corps;
    try {
      corps = (await apiGet(`/api/mobilax/produits?q=${encodeURIComponent(terme)}&page=${page}`)).data;
    } catch {
      // fetch() rejeté (réseau coupé) : l'état « Recherche en cours… » ne doit pas rester figé.
      message('Recherche impossible : connexion interrompue.', true);
      return;
    }
    if (!corps?.success) { messageErreurMobilax(corps); return; }

    etat.page  = corps.data.page;
    etat.pages = corps.data.pages;
    const produits = corps.data.produits;

    if (!produits.length) {
      message(`Aucune pièce trouvée pour « ${terme} ».`);
      return;
    }
    message(`${corps.data.total} pièce${corps.data.total > 1 ? 's' : ''} trouvée${corps.data.total > 1 ? 's' : ''}.`);
    afficherResultats(produits);

    if (etat.pages > 1) {
      pagination.hidden = false;
      pageLabel.textContent = `Page ${etat.page} / ${etat.pages}`;
      boutonPrecedente.disabled = etat.page <= 1;
      boutonSuivante.disabled   = etat.page >= etat.pages;
    }
  }

  function afficherResultats(produits) {
    // Toute donnée Mobilax est tierce : échappée comme une saisie utilisateur (echapperHtml).
    zoneResultats.innerHTML = produits.map(p => `
      <div class="mx-recherche-ligne" data-mobilax-id="${Number(p.mobilax_id)}"
           style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;cursor:pointer;">
        <span>${echapperHtml(p.nom)}</span>
        <span style="color:var(--muted);font-size:0.85rem;">${formatMoney(p.prix_achat_ht)} HT</span>
      </div>
    `).join('');
  }

  async function choisir(mobilaxId) {
    if (selectionEnCours) return;
    selectionEnCours = true;
    const messageAvant = zoneMessage.textContent;
    message('Calcul du prix en cours…');

    let corps;
    try {
      corps = (await apiGet(`/api/mobilax/prix-vente?mobilax_id=${mobilaxId}`)).data;
    } catch {
      selectionEnCours = false;
      message('Calcul du prix impossible : connexion interrompue.', true);
      return;
    }
    selectionEnCours = false;

    if (!corps?.success) { messageErreurMobilax(corps); return; }

    message(messageAvant);
    surSelection({
      description:      corps.data.nom,
      prix_unitaire_ht: corps.data.prix_vente_ht,
      prix_achat_ht:    corps.data.prix_achat_ht,
      famille:          corps.data.famille,
      taux:             corps.data.taux,
      mobilax_id:       corps.data.mobilax_id,
    });
  }

  form.addEventListener('submit', e => { e.preventDefault(); chercher(1); });
  boutonPrecedente.addEventListener('click', () => chercher(etat.page - 1));
  boutonSuivante.addEventListener('click', () => chercher(etat.page + 1));
  zoneResultats.addEventListener('click', e => {
    const ligne = e.target.closest('[data-mobilax-id]');
    if (ligne) choisir(Number(ligne.dataset.mobilaxId));
  });
}

window.monterRechercheMobilax = monterRechercheMobilax;
