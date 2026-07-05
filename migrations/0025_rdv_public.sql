-- Migration 0025 : Prise de RDV en ligne (MOD-14)
-- Créneaux horaires configurables par boutique + index pour les disponibilités

-- Créneaux horaires hebdomadaires par boutique
-- Chaque ligne = une plage horaire un jour de semaine donné
CREATE TABLE IF NOT EXISTS boutique_creneaux (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id  INTEGER NOT NULL REFERENCES boutiques(id),
  jour_semaine INTEGER NOT NULL CHECK (jour_semaine BETWEEN 1 AND 7), -- 1=Lundi … 7=Dimanche
  heure_debut  TEXT    NOT NULL, -- "HH:MM" ex: "09:00"
  heure_fin    TEXT    NOT NULL, -- "HH:MM" ex: "18:00"
  duree_slot   INTEGER NOT NULL DEFAULT 30, -- durée d'un créneau en minutes
  actif        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_creneaux_boutique ON boutique_creneaux(boutique_id, jour_semaine);

-- Index pour accélérer la recherche de disponibilités (RDV d'une boutique par plage de dates)
CREATE INDEX IF NOT EXISTS idx_rdv_boutique_debut ON rendez_vous(boutique_id, debut)
  WHERE actif = 1;
