-- Migration 0032 — Backfill slug boutiques SOTELI (id 2) et Desk1 (id 3)
-- Créées en libre-service (/register, onboarding Google) avant le fix de
-- createBoutiqueWithSettings() (authService.ts) qui ne générait jamais de
-- slug — leur vitrine/RDV public était inaccessible (voir bugs.md/todo.md).
-- Valeurs alignées sur slugify() (src/lib/db.ts) : minuscules uniquement,
-- déjà sans espace ni accent pour ces deux noms.

UPDATE boutiques SET slug = 'soteli' WHERE id = 2 AND slug IS NULL;
UPDATE boutiques SET slug = 'desk1'  WHERE id = 3 AND slug IS NULL;
