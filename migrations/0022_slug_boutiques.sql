-- Migration 0022 — Auto-génération slug boutiques
-- Sprint 2.18 : la colonne slug était NULL pour toutes les boutiques existantes.
-- Ce slug est requis par GET /api/public/boutique/:slug (MOD-14 Vitrine publique).
-- Format : nom en minuscules, espaces → tirets, accents normalisés.

UPDATE boutiques
SET slug = lower(
  replace(replace(replace(replace(replace(replace(replace(replace(
    nom,
    ' ', '-'),
    'é', 'e'),
    'è', 'e'),
    'ê', 'e'),
    'à', 'a'),
    'â', 'a'),
    'ô', 'o'),
    'û', 'u')
)
WHERE slug IS NULL;
