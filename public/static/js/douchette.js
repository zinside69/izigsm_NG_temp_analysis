/**
 * douchette.js — Capture globale d'une douchette (lecteur de codes-barres)
 * Chantier `vente-lit-catalogue`, ticket 04 (caisse) ; réutilisé par la page Tickets (ticket 08b).
 *
 * Une douchette se comporte comme un clavier : elle tape le code, très vite, puis Entrée. Ce
 * module accumule les caractères tapés **hors de tout champ de saisie** et, sur Entrée, rend le
 * code à la page par `surScan(code)`. Il ne sait rien de la caisse ni des tickets : ce que le code
 * désigne est décidé par le serveur (`GET /api/catalogue/recherche?scan=`, `routerScan()`).
 *
 * Règles :
 *   - focus dans un `input`, `textarea`, `select` ou élément `contenteditable` → rien n'est capté :
 *     la frappe reste dans le champ (story 9, un scan pendant la saisie d'une désignation) ;
 *   - plus de 300 ms entre deux caractères → le tampon repart de zéro (restes d'une frappe
 *     humaine lente, sans rapport avec le code qui arrive) ;
 *   - Entrée avec un tampon non vide → `surScan(code)`, tampon vidé ; la touche est alors
 *     neutralisée, sinon elle « cliquerait » le bouton qui a le focus ;
 *   - touches avec Ctrl, Alt ou Méta → ignorées (raccourcis).
 */
;(function () {
  /** Délai maximal entre deux caractères d'un même scan. */
  const DELAI_MAX_MS = 300

  /** Vrai si l'élément reçoit du texte : la frappe lui appartient, pas à la douchette. */
  function estChampDeSaisie(el) {
    if (!el) return false
    const balise = el.tagName
    return balise === 'INPUT' || balise === 'TEXTAREA' || balise === 'SELECT' || el.isContentEditable === true
  }

  /**
   * Écoute la douchette sur toute la page.
   * @param {(code: string) => void} surScan Appelée avec le code lu, espaces de bord retirés
   * @returns {() => void} Fonction qui arrête l'écoute
   */
  function ecouterDouchette(surScan) {
    let tampon  = ''
    let dernier = 0

    function surTouche(e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (estChampDeSaisie(e.target)) { tampon = ''; return }

      const maintenant = Date.now()
      if (maintenant - dernier > DELAI_MAX_MS) tampon = ''
      dernier = maintenant

      if (e.key === 'Enter') {
        const code = tampon.trim()
        tampon = ''
        if (!code) return
        e.preventDefault()
        surScan(code)
        return
      }
      if (e.key.length === 1) tampon += e.key
    }

    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }

  window.ecouterDouchette = ecouterDouchette
})()
