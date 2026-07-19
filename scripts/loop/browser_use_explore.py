#!/usr/bin/env python3
"""
browser_use_explore.py — validation exploratoire d'un parcours utilisateur via un
agent LLM piloté navigateur (browser-use), complémentaire au gate Playwright
déterministe (npm run test:e2e).

Rôle dans la loop-engineering (voir .claude/skills/loop-engineering/SKILL.md,
étape 5) : signal complémentaire pour les tâches qui introduisent un NOUVEAU
parcours utilisateur (pas juste une correction de régression déjà couverte par
Playwright). Moins déterministe qu'un test figé — un échec n'est pas forcément
bloquant en soi, mais doit toujours être lu, jamais ignoré silencieusement (voir
loop-policy.md).

Prérequis :
    python3 -m venv .venv-loop && source .venv-loop/bin/activate
    pip install -r scripts/loop/requirements.txt
    export ANTHROPIC_API_KEY=...   (ou passer --api-key)
    Le serveur local doit tourner : npx wrangler pages dev dist --local --port 3000

Usage :
    python3 scripts/loop/browser_use_explore.py \
        --task "Se connecter avec admin@izigsm.fr / Admin@2026!, créer un ticket \
                pour un client existant, vérifier qu'il apparaît dans le Kanban." \
        --base-url http://localhost:3000

Sortie : rapport texte sur stdout (résumé + verdict PASS/FAIL/INCONCLUSIVE) et code
de sortie (0 = PASS, 1 = FAIL, 2 = INCONCLUSIVE/erreur d'exécution — à distinguer
d'un vrai échec fonctionnel, voir SKILL.md étape 5).
"""
import argparse
import asyncio
import os
import sys

DEFAULT_MODEL = 'claude-haiku-4-5'
DEFAULT_CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--task', required=True, help="Description en langage naturel du parcours à valider.")
    parser.add_argument('--base-url', default='http://localhost:3000', help="URL de base du serveur local (wrangler pages dev).")
    parser.add_argument('--model', default=DEFAULT_MODEL, help=f"Modèle Anthropic à utiliser (défaut : {DEFAULT_MODEL}, volontairement léger/économique pour un check exploratoire).")
    parser.add_argument('--api-key', default=None, help="Clé API Anthropic. Défaut : variable d'environnement ANTHROPIC_API_KEY.")
    parser.add_argument('--chromium-path', default=DEFAULT_CHROMIUM_PATH, help="Chemin de l'exécutable Chromium (même Chromium pré-installé que le gate Playwright).")
    parser.add_argument('--headless', action='store_true', default=True, help="Mode headless (défaut : oui).")
    parser.add_argument('--max-steps', type=int, default=25, help="Nombre maximum d'actions de l'agent avant abandon.")
    return parser.parse_args()


async def run(args: argparse.Namespace) -> int:
    try:
        from browser_use import Agent
        from browser_use.browser.profile import BrowserProfile
        from browser_use.llm.anthropic.chat import ChatAnthropic
    except ImportError as e:
        print(f"[browser_use_explore] Dépendance manquante : {e}", file=sys.stderr)
        print("Installer avec : pip install -r scripts/loop/requirements.txt", file=sys.stderr)
        return 2

    api_key = args.api_key or os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print("[browser_use_explore] ANTHROPIC_API_KEY absente (ni --api-key, ni variable d'environnement).", file=sys.stderr)
        return 2

    task = (
        f"Contexte : application web iziGSM (gestion multi-boutique de réparation "
        f"électronique), accessible sur {args.base_url}. "
        f"Objectif à valider : {args.task} "
        f"Si une étape échoue ou qu'un élément attendu est absent/incorrect, le "
        f"signaler précisément (page, élément, comportement observé vs attendu) — "
        f"ne jamais improviser un contournement pour 'faire passer' le parcours."
    )

    llm = ChatAnthropic(model=args.model, api_key=api_key)
    browser_profile = BrowserProfile(
        executable_path=args.chromium_path,
        headless=args.headless,
    )

    agent = Agent(
        task=task,
        llm=llm,
        browser_profile=browser_profile,
        max_actions_per_step=4,
    )

    history = await agent.run(max_steps=args.max_steps)

    success = history.is_successful()
    final_result = history.final_result()

    print('=' * 70)
    print(f"Tâche : {args.task}")
    print(f"Base URL : {args.base_url}")
    print(f"Verdict agent : {'PASS' if success else 'FAIL/INCONCLUSIVE'}")
    print('-' * 70)
    print(final_result or '(aucun résumé final produit par l\'agent)')
    print('=' * 70)

    if success is True:
        return 0
    if success is False:
        return 1
    return 2


def main() -> None:
    args = parse_args()
    exit_code = asyncio.run(run(args))
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
