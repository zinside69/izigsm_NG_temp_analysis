import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'

/**
 * Conformité des formulaires qui portent un mot de passe (CLAUDE.md § « Formulaires avec mot de
 * passe — jamais de soumission native », depuis le 2026-09-12).
 *
 * Tout `<form>` contenant un `type="password"` déclare `method="post"` et `onsubmit="return false"`
 * dans son HTML. Sans cela, valider avant que le script de la page soit attaché déclenche la
 * soumission native du navigateur — en GET par défaut, identifiants dans l'URL (historique,
 * journaux). Vécu en production sur la connexion, le 2026-09-12 et le 2026-07-18.
 *
 * Statique, comme `routes-isolation-conformite` : seul moyen de couvrir une page qui n'existe pas
 * encore. Le comportement, lui, se prouve à l'écran (`connexion-formulaire-post.spec.ts`,
 * `formulaires-mot-de-passe.spec.ts`). Commentaires HTML retirés avant analyse : un gabarit cité
 * dans un commentaire n'est pas un formulaire servi.
 *
 * Limites assumées (revue du 2026-09-15) — ce que ce garde-fou NE voit PAS :
 * - un `<form>` fabriqué en JavaScript (`innerHTML`, `public/static/js/*.js`) : aucun aujourd'hui —
 *   le PIN d'`app.js` et `fournisseurs.html #f-api-key` sont des `type="password"` hors de tout
 *   formulaire, donc non soumissibles nativement ;
 * - un formulaire non fermé ou imbriqué (le suivant est lu comme son contenu), un `>` dans une valeur
 *   d'attribut de la balise `<form>` : analyse par expression régulière, pas par un vrai parseur ;
 * - une page servie par le Worker plutôt que par `public/`.
 * Aucune exemption n'existe : un formulaire à mot de passe qui devrait partir nativement est à
 * discuter avant d'être écrit.
 */

// @ts-ignore process types not available without @types/node
const PUBLIC_DIR = join(process.cwd(), 'public')

/** Pages HTML de `public/`, sous-dossiers compris — chemin relatif à `public/`. */
function pages(dossier = ''): string[] {
  return readdirSync(join(PUBLIC_DIR, dossier), { withFileTypes: true }).flatMap((e: any) => {
    const chemin = dossier ? `${dossier}/${e.name}` : e.name
    if (e.isDirectory()) return pages(chemin)
    return e.name.endsWith('.html') ? [chemin] : []
  })
}

/**
 * Attribut `nom` réellement porté par l'élément : ni précédé d'un tiret ni d'une lettre
 * (`data-type`, `data-id` ne comptent pas), valeur entre guillemets doubles, simples ou sans.
 */
function attribut(nom: string, valeur = '[^"\'\\s>]+'): RegExp {
  return new RegExp(`(?<![\\w-])${nom}\\s*=\\s*(["']?)(${valeur})\\1(?![\\w-])`, 'i')
}

/** Formulaires d'une page qui portent un mot de passe : identifiant et balise ouvrante. */
function formulairesAvecMotDePasse(html: string): { id: string; balise: string }[] {
  const sansCommentaires = html.replace(/<!--[\s\S]*?-->/g, '')
  const trouves: { id: string; balise: string }[] = []
  const formulaire = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi
  let m: RegExpExecArray | null
  while ((m = formulaire.exec(sansCommentaires)) !== null) {
    if (!attribut('type', 'password').test(m[2])) continue
    trouves.push({ id: attribut('id').exec(m[1])?.[2] ?? '(sans id)', balise: `<form${m[1]}>` })
  }
  return trouves
}

/** Vrai si la balise ouvrante empêche la soumission native (et donc le GET avec identifiants). */
function baliseConforme(balise: string): boolean {
  return attribut('method', 'post').test(balise)
    && /(?<![\w-])onsubmit\s*=\s*["']\s*return\s+false\s*;?\s*["']/i.test(balise)
}

/** « page #id » de chaque formulaire à mot de passe de `public/`. */
function tousLesFormulaires(): { ou: string; balise: string }[] {
  return pages().flatMap((p: string) =>
    formulairesAvecMotDePasse(readFileSync(join(PUBLIC_DIR, p), 'utf8'))
      .map(f => ({ ou: `${p} #${f.id}`, balise: f.balise })))
}

describe('formulaires avec mot de passe — method="post" et onsubmit="return false"', () => {
  it('le détecteur repère un formulaire non conforme et accepte la forme de login.html', () => {
    const html = `<form id="a" novalidate><input type="password"></form>
      <form id="b" method="post" onsubmit="return false" novalidate><input type="password"></form>
      <form id="c"><input type="email"></form>
      <!-- <form id="d"><input type="password"></form> -->
      <form id="e"><input type=password name="pin"></form>
      <form data-id="leurre" id="f"><input data-type="password" type="text"></form>`
    const trouves = formulairesAvecMotDePasse(html)
    // `e` : `type=password` sans guillemets reste un mot de passe ; `f` : `data-type` n'en est pas un,
    // et `data-id` n'est pas l'identifiant (revue du 2026-09-15)
    expect(trouves.map(f => f.id)).toEqual(['a', 'b', 'e'])
    expect(trouves.map(f => baliseConforme(f.balise))).toEqual([false, true, false])
  })

  it('le balayage voit bien les formulaires existants — il ne peut pas passer à vide', () => {
    expect(tousLesFormulaires().map(f => f.ou)).toContain('login.html #login-form')
  })

  it('aucune page de public/ ne porte un formulaire à mot de passe soumissible nativement', () => {
    const violations = tousLesFormulaires().filter(f => !baliseConforme(f.balise)).map(f => f.ou)
    expect(violations).toEqual([])
  })
})

// ── Formulaires qui portent un email (ajouté le 2026-10-01, décision de l'exploitant) ─────────
//
// Même règle, même raison : un envoi natif part en GET et met la saisie dans l'adresse. Mesuré le
// 2026-10-01 sur `reset-password.html #form-request` (fuite réelle, `GET /reset-password?email=…`).
// Deux autres formulaires ne la suivaient pas sans fuir pour autant — `settings.html #form-general`
// (aucun champ `name`) et `personnel.html #form-add-employe` (fenêtre masquée ouverte par le script) :
// des propriétés fragiles, mis en conformité le même jour.

/** Formulaires d'une page qui portent un champ `type="email"` : identifiant et balise ouvrante. */
function formulairesAvecEmail(html: string): { id: string; balise: string }[] {
  const sansCommentaires = html.replace(/<!--[\s\S]*?-->/g, '')
  const trouves: { id: string; balise: string }[] = []
  const formulaire = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi
  let m: RegExpExecArray | null
  while ((m = formulaire.exec(sansCommentaires)) !== null) {
    if (!attribut('type', 'email').test(m[2])) continue
    trouves.push({ id: attribut('id').exec(m[1])?.[2] ?? '(sans id)', balise: `<form${m[1]}>` })
  }
  return trouves
}

describe('formulaires avec email — method="post" et onsubmit="return false"', () => {
  it('le détecteur repère un formulaire à email et ignore le reste', () => {
    const html = `<form id="a"><input type="email" name="email"></form>
      <form id="b" method="post" onsubmit="return false"><input type=email></form>
      <form id="c"><input type="text" data-type="email"></form>
      <!-- <form id="d"><input type="email"></form> -->`
    const trouves = formulairesAvecEmail(html)
    expect(trouves.map(f => f.id)).toEqual(['a', 'b'])
    expect(trouves.map(f => baliseConforme(f.balise))).toEqual([false, true])
  })

  it('le balayage voit bien les formulaires à email existants', () => {
    const tous = pages().flatMap((p: string) =>
      formulairesAvecEmail(readFileSync(join(PUBLIC_DIR, p), 'utf8')).map(f => `${p} #${f.id}`))
    expect(tous).toContain('reset-password.html #form-request')
  })

  it('aucune page de public/ ne porte un formulaire à email soumissible nativement', () => {
    const violations = pages().flatMap((p: string) =>
      formulairesAvecEmail(readFileSync(join(PUBLIC_DIR, p), 'utf8'))
        .filter(f => !baliseConforme(f.balise)).map(f => `${p} #${f.id}`))
    expect(violations).toEqual([])
  })
})
