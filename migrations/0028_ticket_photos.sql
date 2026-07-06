-- Sprint 2.36 — MOD-01 Photos tickets (R2 + D1 métadonnées)
-- Stockage binaire : Cloudflare R2 (clé unique par photo)
-- Métadonnées     : D1 (id, ticket_id, type, taille, mime, created_at)

CREATE TABLE IF NOT EXISTS ticket_photos (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER  NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  r2_key      TEXT     NOT NULL UNIQUE,
  nom_fichier TEXT     NOT NULL DEFAULT '',
  type_photo  TEXT     NOT NULL DEFAULT 'autre'
                       CHECK (type_photo IN ('avant', 'apres', 'autre')),
  mime_type   TEXT     NOT NULL DEFAULT 'image/jpeg',
  taille      INTEGER  NOT NULL DEFAULT 0,  -- bytes
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  INTEGER  REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_photos_ticket_id ON ticket_photos(ticket_id);
CREATE INDEX IF NOT EXISTS idx_photos_type      ON ticket_photos(ticket_id, type_photo);
