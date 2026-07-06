-- Migration 0027 — Sprint 2.35 : OAuth Google + réinitialisation mot de passe
-- Ajout google_id sur users pour lier un compte Google à un compte iziGSM.
-- Nullable : les comptes existants (email/mot de passe) ne sont pas affectés.

ALTER TABLE users ADD COLUMN google_id TEXT;

-- Index unique : un google_id ne peut être lié qu'à un seul compte.
-- WHERE google_id IS NOT NULL : exclut les NULL de la contrainte d'unicité (SQLite partiel index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
