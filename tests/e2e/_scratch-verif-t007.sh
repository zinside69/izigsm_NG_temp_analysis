# SCRATCH — À SUPPRIMER AVANT MERGE.
#
# Script de vérification manuelle locale (T-007), sans rapport avec le produit ni avec un
# test : il lance un second `wrangler pages dev` pour rejouer `devis-mobilax.spec.ts` à la
# main, car `orchestrator/e2e-gate.sh` ne détecte que les specs déjà COMMITÉES (diff contre
# HEAD) — impossible avant que le harnais commite ce travail (ADR 0004). `rm` a été refusé
# dans cette session (commande destructive nécessitant une approbation interactive absente) :
# ce fichier n'a donc pas pu être retiré par l'agent. Il ne matche aucun pattern de test
# Playwright (`*.spec.ts`/`*.test.ts`) et n'est référencé nulle part — inerte mais à supprimer.
