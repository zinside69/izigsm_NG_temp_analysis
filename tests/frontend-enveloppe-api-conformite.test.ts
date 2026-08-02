import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'

/**
 * Conformité du niveau d'enveloppe dans le frontend.
 *
 * `apiGet`/`apiPost`/`apiPut`/`apiPatch`/`apiDelete` (`public/static/js/app.js`) renvoient
 * une **enveloppe** `{ ok, status, data, error }` où `data` est le corps JSON complet de
 * l'API, lui-même de la forme `{ success, data, … }`. Lire `res.success` sur l'enveloppe
 * donne donc toujours `undefined`, et la page sort par un `return` silencieux : l'API
 * répond 200, aucune exception n'est levée, et **rien ne s'affiche**.
 *
 * C'est la classe de défaut la plus coûteuse du dépôt : `fournisseurs.js`, `caisse.js`,
 * `reconditionnement.js`, `kanban.js` et une moitié de `services.js` n'ont jamais rien
 * affiché, pour aucun rôle, pendant des mois — et sur `caisse.js` une vente réellement
 * enregistrée s'annonçait comme un échec, invitant à la ressaisir.
 *
 * Aucun test de bout en bout ne peut attraper ça : le balayage du menu de gauche ne voit
 * ni erreur HTTP ni exception JS. Seul un contrôle **statique** est déterministe — c'est
 * la conclusion tirée le 2026-08-01 (`todo.md` § P1), implémentée ici le 2026-08-02.
 *
 * Ce que le garde-fou interdit : affecter le résultat brut d'un `api*()` à une variable,
 * puis lire `.success` dessus.
 *
 * Les deux écritures correctes restent permises :
 *   - déballer au point d'appel : `const res = (await apiGet(…)).data` puis `res?.success`
 *   - lire l'enveloppe elle-même : `res.ok` / `res.error` (statut HTTP)
 *
 * Limite assumée : prendre `res.data` pour la charge utile (au lieu de `res.data.data`) est
 * la même erreur d'un cran, mais elle n'est pas détectable sans faux positifs — `res.data`
 * est aussi l'écriture correcte pour accéder au corps. Ce cas reste du ressort de la revue
 * et des tests de rendu.
 */

// @ts-ignore process types not available without @types/node
const JS_DIR = join(process.cwd(), 'public', 'static', 'js')

const HELPERS = ['apiGet', 'apiPost', 'apiPut', 'apiPatch', 'apiDelete']

/** Fichiers dispensés du contrôle, avec motif — jamais un contournement silencieux. */
const EXEMPTIONS: Record<string, string> = {}

/**
 * Retire commentaires de bloc et de ligne avant analyse.
 *
 * Les fichiers corrigés portent en tête un avertissement qui cite l'écriture fautive en
 * toutes lettres (« ne jamais réintroduire `res.success` ») : sans cette passe, la
 * documentation du défaut déclencherait le garde-fou censé l'empêcher.
 */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Position du caractère fermant l'expression ouverte à `depuis` (une parenthèse).
 * Retourne -1 si l'expression n'est jamais refermée.
 */
function finExpression(src: string, depuis: number): number {
  let profondeur = 0
  for (let i = depuis; i < src.length; i++) {
    if (src[i] === '(') profondeur++
    else if (src[i] === ')') {
      profondeur--
      if (profondeur === 0) return i
    }
  }
  return -1
}

interface Violation {
  fichier: string
  variable: string
  ligne: number
}

/**
 * Repère les affectations `const X = await apiGet(…)` **non déballées**, puis les lectures
 * de `X.success` qui suivent dans le même corps.
 *
 * Le suivi s'arrête à la prochaine affectation de la même variable : au-delà, `X` peut
 * légitimement porter autre chose.
 */
function violations(fichier: string, source: string): Violation[] {
  const src = sansCommentaires(source)
  const trouvees: Violation[] = []

  const affectation = new RegExp(
    `(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:\\(\\s*)?await\\s+(?:${HELPERS.join('|')})\\s*\\(`,
    'g'
  )

  let m: RegExpExecArray | null
  while ((m = affectation.exec(src)) !== null) {
    const variable = m[1]
    const ouvrante = src.indexOf('(', m.index + m[0].length - 1)
    const fin = finExpression(src, ouvrante)
    if (fin === -1) continue

    // Déballé au point d'appel ? La suite immédiate de l'expression porte alors `.data`
    // (soit `)).data`, soit `).data` selon la parenthèse d'enrobage).
    const suite = src.slice(fin + 1, fin + 12)
    if (/^\s*\)?\s*\.data\b/.test(suite)) continue

    // La variable porte l'enveloppe : toute lecture de `.success` dessus est fautive.
    const portee = src.slice(fin)
    const relecture = new RegExp(`(?:const|let|var)\\s+${variable}\\s*=`).exec(portee.slice(1))
    const zone = relecture ? portee.slice(0, relecture.index + 1) : portee

    const lecture = new RegExp(`\\b${variable}\\s*\\??\\.\\s*success\\b`)
    if (lecture.test(zone)) {
      trouvees.push({
        fichier,
        variable,
        ligne: src.slice(0, m.index).split('\n').length,
      })
    }
  }

  return trouvees
}

describe('Conformité du niveau d\'enveloppe des réponses API (frontend)', () => {
  it('aucun fichier de page ne lit `.success` sur le résultat brut d\'un api*()', () => {
    const fichiers = readdirSync(JS_DIR).filter((f: string) => f.endsWith('.js'))
    expect(fichiers.length).toBeGreaterThan(0)

    const anomalies = fichiers
      .filter((f: string) => !(f in EXEMPTIONS))
      .flatMap((f: string) => violations(f, readFileSync(join(JS_DIR, f), 'utf8')))
      .map((v: Violation) => `${v.fichier}:${v.ligne} — \`${v.variable}\` porte l'enveloppe, `
        + `\`${v.variable}.success\` vaut toujours undefined `
        + `(déballer : \`const ${v.variable} = (await api…).data\`, ou tester \`${v.variable}.ok\`)`)

    expect(anomalies, 'lectures de `.success` au mauvais niveau d\'enveloppe').toEqual([])
  })

  it('le détecteur voit bien le défaut qu\'il est censé empêcher', () => {
    // Preuve par mutation, intégrée : sans elle, un détecteur qui ne trouve jamais rien
    // passerait pour un garde-fou. Ce sont les deux écritures réelles rencontrées.
    const fautif = `
      async function charge() {
        const res = await apiGet('/api/fournisseurs/kpis')
        if (!res.success) return
      }
      async function envoie() {
        const resp = await apiPut('/api/tickets/1/statut', {
          statut: 'termine',
        })
        if (resp?.success) toast('ok')
      }
    `
    expect(violations('cas-fautif.js', fautif)).toHaveLength(2)

    const correct = `
      async function charge() {
        const res = (await apiGet('/api/fournisseurs/kpis')).data
        if (!res?.success) return
      }
      async function envoie() {
        const res = await apiPut('/api/services/1', { nom: 'x' })
        if (!res.ok) { showFlash(res.error); return }
      }
    `
    expect(violations('cas-correct.js', correct)).toEqual([])
  })
})
