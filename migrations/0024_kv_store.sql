-- Migration 0024 : table kv_store
-- Émule l'API KV Cloudflare dans D1 pour le déploiement gsk-hosted
-- (KV namespace non provisionnable en workers-for-platform)
--
-- Usage : OTP (TTL 10 min), refresh tokens (TTL 7j), sessions PIN (TTL 15 min)
-- Le nettoyage des entrées expirées est effectué par d1KvCleanup() dans lib/d1kv.ts

CREATE TABLE IF NOT EXISTS kv_store (
  key        TEXT    NOT NULL PRIMARY KEY,
  value      TEXT    NOT NULL,
  expires_at INTEGER          -- epoch secondes, NULL = pas d'expiration
);

CREATE INDEX IF NOT EXISTS idx_kv_store_expires_at ON kv_store(expires_at)
  WHERE expires_at IS NOT NULL;
