import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'

/**
 * Conformite d'isolation multi-tenant.
 *
 * Toute route dont le chemin porte un parametre d'identifiant doit soit verifier
 * l'appartenance de la ressource a la boutique appelante, soit figurer dans
 * EXEMPTIONS avec un motif. Trois campagnes de correction (2026-07-19, 07-30,
 * 07-31) ont chacune laisse des routes ouvertes faute d'un tel garde-fou.
 *
 * IMPORTANT (task 7) : au premier lancement, ce test a remonte 23 routes qui ne
 * sont NI gardees NI dans les exemptions ci-dessous, en plus des cas legitimes
 * traites par elargissement de aUneGarde() ou par exemption motivee. Ces 23
 * routes sont de vraies failles d'isolation non corrigees par ce chantier (hors
 * perimetre de la tache 7, qui ne modifie aucune route applicative) : elles
 * laissent volontairement le test ROUGE plutot que d'etre exemptees pour faire
 * du vert de facade. Voir task-7-report.md pour le detail et le classement
 * complet des 28 routes remontees au premier lancement.
 *
 * DURCISSEMENT 2026-07-31 (condition 3 de la revue finale) : ce garde-fou
 * acceptait le simple CHARGEMENT d'un boutique_id (`getTicketBoutiqueId`,
 * `getBonCommandeBoutiqueId`, ...) comme preuve de garde. Ces fonctions ne
 * comparent rien — preuve par mutation : en retirant tous les
 * `assertBoutiqueOwnership` des handlers, 8 routes restaient vertes. Un signal de
 * chargement ne vaut desormais garde qu'accompagne d'un signal de COMPARAISON
 * dans le meme corps. Le patron « derive boutiqueId du JWT puis le passe au
 * service qui filtre en SQL » (17 routes de clients.ts / reconditionnement.ts /
 * users.ts, non vulnerables) reste reconnu, mais exige la propagation effective
 * de la variable. Les commentaires sont retires avant analyse : le corps d'un
 * handler englobe le JSDoc de la route suivante, dont une simple mention
 * suffisait a verdir la precedente.
 */

// @ts-ignore process types not available without @types/node
const ROUTES_DIR = join(process.cwd(), 'src', 'routes')

/** Routes sans garde d'isolation, volontairement et avec motif. */
const EXEMPTIONS: Record<string, string> = {
  'personnel.ts DELETE /employes/:id':               'admin-only : requireRole(admin) seul, l\'admin plateforme traverse par conception',
  'public.ts GET /token-for-ticket/:id':             'endpoint desactive : repond toujours 405 sans jamais lire ni ecrire aucune ressource, le param :id n\'est meme pas lu dans le handler',
  'services.ts PUT /services/marques/:id':           'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts DELETE /services/marques/:id':        'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts PUT /services/modeles/:id':           'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts DELETE /services/modeles/:id':        'referentiel-global : ecriture restreinte a requireRole(admin)',
}

const DECL = /^\s*\w+\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]*)['"`]/

/**
 * Retire commentaires de bloc et de ligne avant analyse.
 *
 * Le corps d'un handler s'etend jusqu'a la declaration suivante : il englobe donc
 * le bloc de commentaires qui documente la route d'apres. Une simple phrase de
 * JSDoc mentionnant `getBoutiqueId()` suffisait a verdir la route precedente —
 * meme classe de faux positif que le constat traite ici (un signal qui n'execute
 * rien vaut preuve). Un commentaire ne garde rien : on ne l'analyse pas.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Certains routers definissent un helper local `ctx(c)` qui derive lui-meme
 * boutiqueId via getBoutiqueId() avant de le retourner (sav.ts) : les handlers
 * font `const { boutiqueId } = ctx(c)` puis passent `boutiqueId` aux services,
 * mais le texte "getBoutiqueId" n'apparait alors jamais dans le corps du
 * handler individuel — seulement dans le helper partage, une fois, en tete de
 * fichier. D'autres fichiers (clients.ts, stocks.ts, tickets.ts, reconditionnement.ts)
 * definissent aussi un `ctx(c)`, mais sans y deriver boutiqueId (ils se contentent
 * d'extraire `queryBoutiqueId` brut) : la garde reste alors explicite dans chaque
 * handler individuel.
 *
 * Verifie manuellement (task 7, 2026-07-31) : getGarantie/getSav/updateSavStatut
 * (src/services/garantiesService.ts) filtrent bien `WHERE ... AND boutique_id = ?`
 * avec la valeur issue de ce helper avant d'elargir la detection sur ce patron.
 */
function fichierDeriveBoutiqueIdViaCtx(texteFichier: string): boolean {
  const m = sansCommentaires(texteFichier).match(/function\s+ctx\s*\(c[^)]*\)\s*\{([\s\S]*?)\n\}/)
  return !!m && /getBoutiqueId\(/.test(m[1])
}

/**
 * Signaux de COMPARAISON : le handler oppose effectivement la ressource a la
 * boutique de l'appelant, ou delegue cette comparaison a une fonction qui la fait.
 */
const COMPARAISON: RegExp[] = [
  /assertBoutiqueOwnership/,
  /boutique_id\s*!==/,
  // boutiques.ts s'identifie par `id`, pas par `boutique_id`
  /user\.boutique_id/,
  // SQL inline filtre (routes historiques)
  /boutique_id\s*=\s*\?/,
  // resetPINAdmin() (src/services/userService.ts) compare en interne
  // target.boutique_id a adminUser.boutique_id — adminUser est c.get('user')
  // (payload JWT signe), jamais une valeur fournie par l'appelant. Verifie
  // manuellement le 2026-07-31 (task 7) avant d'elargir la detection.
  /resetPINAdmin\(/,
]

/**
 * Signaux de CHARGEMENT SEUL — ne valent PAS garde a eux seuls (durcissement
 * 2026-07-31, condition 3 de la revue finale).
 *
 * Ces fonctions de service se contentent de lire le `boutique_id` d'une ressource
 * (`SELECT boutique_id FROM ... WHERE id = ?`). Elles ne le comparent a rien : la
 * comparaison est faite ensuite par `assertBoutiqueOwnership()`. Les accepter
 * seules rendait le garde-fou aveugle — preuve par mutation : en supprimant tous
 * les `assertBoutiqueOwnership` des handlers, 8 routes restaient vertes.
 * Elles sont conservees ici uniquement a titre documentaire : une route qui les
 * appelle DOIT porter en plus un signal de COMPARAISON.
 */
const CHARGEMENT_SEUL: RegExp[] = [
  /getTicketBoutiqueId/,
  /getBonCommandeBoutiqueId/,
  /getCategorieBoutiqueId/,
  /getRdvBoutiqueId/,
]

/**
 * Mots-cles du langage qui ressemblent syntaxiquement a un appel de fonction.
 * `if (!boutiqueId) return ...` ouvre tout handler du patron JWT : les compter
 * comme des appels validait n'importe quelle route sans rien verifier.
 */
const MOTS_CLES = new Set([
  'if', 'while', 'for', 'switch', 'catch', 'return', 'typeof', 'await', 'function', 'new', 'async',
])

/**
 * Extrait les appels de fonction d'un corps de handler, en equilibrant les
 * parentheses.
 *
 * Une regex `\(([^()]*)\)` ne franchit pas les arguments imbriques : sur
 * `getModeleWithServices(c.get('db'), id, boutiqueId)` elle ne voyait que
 * `c.get('db')` et manquait l'appel englobant — donc la propagation de
 * `boutiqueId`. Retirer cet argument (et rouvrir ainsi la fuite de tarifs
 * inter-tenants corrigee le 2026-07-31) laissait le garde-fou vert.
 *
 * Limite connue : une parenthese a l'interieur d'une chaine de caracteres
 * fausserait le comptage. Aucune occurrence dans `src/routes/*.ts` au 2026-07-31.
 */
function appelsDeFonction(corps: string): Array<{ nom: string; args: string }> {
  const appels: Array<{ nom: string; args: string }> = []
  const debutAppel = /([A-Za-z_$][\w$.]*)\s*\(/g
  let m: RegExpExecArray | null

  while ((m = debutAppel.exec(corps)) !== null) {
    let profondeur = 1
    let i = m.index + m[0].length
    const debutArgs = i
    while (i < corps.length && profondeur > 0) {
      if (corps[i] === '(') profondeur++
      else if (corps[i] === ')') profondeur--
      i++
    }
    if (profondeur === 0) appels.push({ nom: m[1], args: corps.slice(debutArgs, i - 1) })
  }
  return appels
}

/**
 * Patron legitime distinct : le handler derive `boutiqueId` du JWT
 * (`getBoutiqueId()`, jamais une valeur fournie par l'appelant) PUIS le passe en
 * argument a un service qui filtre en SQL — `getOrdre(dbPort, id, boutiqueId)`,
 * `getPermissions(db, targetId, boutiqueId)`, `canAccessClient(user, client, boutiqueId)`.
 * Le filtrage a bien lieu, simplement dans le service et non dans le controller.
 *
 * 17 routes (clients.ts, reconditionnement.ts, users.ts) reposent sur ce patron,
 * verifiees non vulnerables par la revue finale. La detection exige la PROPAGATION
 * de la variable, pas la seule presence de `getBoutiqueId` : deriver un boutiqueId
 * puis ne jamais s'en servir ne garde rien non plus.
 */
function propageAUnService(corps: string, variable: string): boolean {
  const motif = new RegExp(`\\b${variable}\\b`)
  for (const { nom, args } of appelsDeFonction(corps)) {
    // Mots-cles du langage : `if (!boutiqueId)` n'est pas un appel de service.
    // Sans cette exclusion, tout handler du patron JWT etait valide d'office —
    // ils commencent tous par `if (!boutiqueId) return ...`.
    if (MOTS_CLES.has(nom)) continue
    // Exclusions : la derivation elle-meme, le rendu de reponse, les conversions.
    if (nom === 'getBoutiqueId' || nom.startsWith('c.') || nom === 'parseInt' || nom === 'Number' || nom === 'String')
      continue
    // Appel prenant une fonction en argument : c'est la declaration de route
    // elle-meme (`recond.get('/:id', async (c) => { ... })`), dont les arguments
    // englobent tout le handler — donc `boutiqueId`, quoi qu'en fasse le code.
    // Un appel de service ne recoit jamais de fonction flechee dans ce depot.
    if (args.includes('=>')) continue
    if (motif.test(args)) return true
  }
  return false
}

/** Signaux acceptes comme garde d'isolation. */
function aUneGarde(corpsBrut: string, texteFichier: string): boolean {
  const corps = sansCommentaires(corpsBrut)

  if (COMPARAISON.some(re => re.test(corps))) return true

  // Chargement seul, sans comparaison dans le meme corps → refuse.
  if (CHARGEMENT_SEUL.some(re => re.test(corps))) return false

  // Derivation depuis le JWT + propagation au service qui filtre.
  const declaration = corps.match(/(?:const|let)\s+(\w+)\s*=\s*getBoutiqueId\s*\(/)
  if (declaration && propageAUnService(corps, declaration[1])) return true

  // Meme patron, mais boutiqueId derive dans le helper local ctx(c) (sav.ts).
  if (/\bctx\(c\)/.test(corps) && fichierDeriveBoutiqueIdViaCtx(texteFichier)
      && propageAUnService(corps, 'boutiqueId'))
    return true

  return false
}

function routesParId() {
  const trouvees: Array<{ cle: string; corps: string; texteFichier: string }> = []
  for (const fichier of readdirSync(ROUTES_DIR).filter((f: string) => f.endsWith('.ts'))) {
    const texteFichier: string = readFileSync(join(ROUTES_DIR, fichier), 'utf8')
    const lignes = texteFichier.split('\n')
    const decls: Array<{ i: number; verbe: string; chemin: string }> = []
    lignes.forEach((l: string, i: number) => {
      const m = l.match(DECL)
      if (m) decls.push({ i, verbe: m[1].toUpperCase(), chemin: m[2] })
    })
    decls.forEach((d, k) => {
      if (!/:\w*[iI]d/.test(d.chemin)) return
      const fin = k + 1 < decls.length ? decls[k + 1].i : lignes.length
      trouvees.push({
        cle:          `${fichier} ${d.verbe} ${d.chemin}`,
        corps:        lignes.slice(d.i, fin).join('\n'),
        texteFichier,
      })
    })
  }
  return trouvees
}

describe('Conformite isolation multi-tenant', () => {
  it('toute route par ID a une garde d\'isolation ou une exemption motivee', () => {
    const manquantes = routesParId()
      .filter(r => !aUneGarde(r.corps, r.texteFichier))
      .filter(r => !(r.cle in EXEMPTIONS))
      .map(r => r.cle)

    expect(manquantes,
      `Routes par ID sans garde d'isolation :\n  ${manquantes.join('\n  ')}\n\n` +
      `Ajoutez assertBoutiqueOwnership() dans le handler, ou inscrivez la route ` +
      `dans EXEMPTIONS avec un motif si l'absence de garde est deliberee. ` +
      `Voir task-7-report.md si cette liste contient des routes deja connues comme ` +
      `failles reelles non corrigees (ne pas les exempter pour faire passer ce test).`
    ).toEqual([])
  })

  it('chaque exemption porte un motif non vide', () => {
    for (const [cle, motif] of Object.entries(EXEMPTIONS)) {
      expect(motif.trim().length, `Exemption sans motif : ${cle}`).toBeGreaterThan(0)
    }
  })

  it('aucune exemption ne designe une route disparue', () => {
    const existantes = new Set(routesParId().map(r => r.cle))
    const orphelines = Object.keys(EXEMPTIONS).filter(c => !existantes.has(c))
    expect(orphelines, `Exemptions obsoletes a supprimer :\n  ${orphelines.join('\n  ')}`).toEqual([])
  })

  // ── Meta-tests du garde-fou lui-meme ──────────────────────────────────────
  // Sans eux, rien n'empeche un futur elargissement de aUneGarde() de reintroduire
  // le faux positif corrige le 2026-07-31 (chargement pris pour comparaison).

  describe('aUneGarde() — durcissement chargement vs comparaison', () => {
    it('refuse un handler qui se contente de CHARGER un boutique_id', () => {
      const corps = `
        fournisseurs.post('/bons-commande/:id/receptionner', async (c) => {
          const bon = await getBonCommandeBoutiqueId(c.get('db'), id)
          return c.json({ success: true })
        })`
      expect(aUneGarde(corps, corps)).toBe(false)
    })

    it('accepte le meme handler des lors qu\'il COMPARE', () => {
      const corps = `
        fournisseurs.post('/bons-commande/:id/receptionner', async (c) => {
          const bon = await getBonCommandeBoutiqueId(c.get('db'), id)
          const deny = assertBoutiqueOwnership(c.get('user'), bon, 'Bon de commande')
          if (deny) return c.json({ success: false }, deny.status)
        })`
      expect(aUneGarde(corps, corps)).toBe(true)
    })

    it('accepte la derivation JWT propagee a un service qui filtre', () => {
      const corps = `
        recond.get('/:id', async (c) => {
          const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
          const ordre = await getOrdre(dbPort, id, boutiqueId)
        })`
      expect(aUneGarde(corps, corps)).toBe(true)
    })

    it('refuse une derivation JWT jamais propagee', () => {
      const corps = `
        recond.get('/:id', async (c) => {
          const boutiqueId = getBoutiqueId(user, queryBoutiqueId)
          const ordre = await getOrdre(dbPort, id)
          return c.json({ success: true, boutique_id: boutiqueId, data: ordre })
        })`
      expect(aUneGarde(corps, corps)).toBe(false)
    })

    // Les deux cas ci-dessous reproduisent un defaut trouve en re-revue le
    // 2026-07-31 : `if (...)` etait compte comme un appel de fonction, et la
    // detection d'appels ne franchissait pas les parentheses imbriquees. Les deux
    // defauts se compensaient — le test passait pour la mauvaise raison.

    it('ne prend pas `if (!boutiqueId)` pour une propagation a un service', () => {
      // Tout handler du patron JWT commence par cette garde de presence. Sans
      // exclusion des mots-cles, `if` suffisait a valider n'importe quel handler.
      const corps = `
        recond.get('/:id', async (c) => {
          const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
          if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)
          const ordre = await getOrdre(dbPort, id)
          return c.json({ success: true, data: ordre })
        })`
      expect(aUneGarde(corps, corps)).toBe(false)
    })

    it('voit la propagation meme avec des parentheses imbriquees dans les arguments', () => {
      // `getModeleWithServices(c.get('db'), id, boutiqueId)` : l'appel reel de
      // GET /services/modeles/:id/services. Sans equilibrage des parentheses, il
      // n'etait jamais detecte — retirer `boutiqueId` de cet appel (donc rouvrir la
      // fuite de tarifs inter-tenants) laissait le garde-fou vert.
      const corps = `
        services.get('/services/modeles/:id/services', async (c) => {
          const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
          if (!boutiqueId) return c.json({ success: false }, 400)
          const data = await getModeleWithServices(c.get('db'), id, boutiqueId)
          return c.json({ success: true, data })
        })`
      expect(aUneGarde(corps, corps)).toBe(true)
    })

    it('ne prend pas un commentaire pour une garde', () => {
      const corps = `
        services.delete('/services/modeles/:id', async (c) => {
          await deleteModele(c.env.DB, id, user.sub)
        })
        /** Route suivante : derive boutiqueId via getBoutiqueId() et compare
         *  avec assertBoutiqueOwnership(). */`
      expect(aUneGarde(corps, corps)).toBe(false)
    })
  })
})
