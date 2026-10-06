-- Prix TTC « non ronds » des services et des prix par modèle — à jouer AVANT la migration 0064, en
-- lecture seule (ticket 04 du chantier prix TTC, décision Q8 de l'exploitant du 2026-10-04).
--
-- Liste les services actifs et les prix spécifiques par modèle dont le TTC repris (HT × (1 + taux du
-- service), arrondi au centime, même calcul que la migration) n'aura ni 00 ni 90 centimes, pour que
-- l'exploitant les corrige à la main.
--
-- En production (une seule commande ; le mode --file est refusé à distance, erreur 10000 vécue au
-- ticket 01 — passer le contenu par --command) :
--   npx wrangler d1 execute DB --remote --command "<contenu de ce fichier>"
SELECT * FROM (
  -- 1. Prix du service lui-même
  SELECT
    'service'                AS nature,
    services.boutique_id     AS boutique_id,
    services.id              AS service_id,
    NULL                     AS modele_id,
    services.nom             AS nom,
    services.prix_ht         AS prix_ht,
    services.tva_taux        AS tva_taux,
    -- TTC repris, en euros
    ROUND(services.prix_ht * (100 + services.tva_taux)) / 100.0 AS prix_ttc_repris
  FROM services
  -- Services encore proposés seulement
  WHERE services.actif = 1
    -- Centimes du TTC repris : ni 00 ni 90
    AND CAST(ROUND(services.prix_ht * (100 + services.tva_taux)) AS INTEGER) % 100 NOT IN (0, 90)

  UNION ALL

  -- 2. Prix spécifique d'un service pour un modèle (au taux du service)
  SELECT
    'prix par modèle'                     AS nature,
    service_du_prix.boutique_id           AS boutique_id,
    service_du_prix.id                    AS service_id,
    prix_modele.modele_id                 AS modele_id,
    service_du_prix.nom                   AS nom,
    prix_modele.prix_ht_specifique        AS prix_ht,
    service_du_prix.tva_taux              AS tva_taux,
    ROUND(prix_modele.prix_ht_specifique * (100 + service_du_prix.tva_taux)) / 100.0 AS prix_ttc_repris
  FROM service_modeles AS prix_modele
  JOIN services        AS service_du_prix ON service_du_prix.id = prix_modele.service_id
  -- Un prix spécifique existe (NULL = le prix du service s'applique)
  WHERE prix_modele.prix_ht_specifique IS NOT NULL
    -- Liaison et service encore actifs
    AND prix_modele.actif = 1
    AND service_du_prix.actif = 1
    -- Centimes du TTC repris : ni 00 ni 90
    AND CAST(ROUND(prix_modele.prix_ht_specifique * (100 + service_du_prix.tva_taux)) AS INTEGER) % 100 NOT IN (0, 90)
)
ORDER BY boutique_id, nature DESC, service_id, modele_id;
