-- ============================================================
-- Migration 0041 — Clé API chiffrée par fournisseur (ticket 01, chantier Mobilax)
-- ============================================================
-- Un fournisseur (ex. Mobilax) peut exposer une API dont l'accès est propre à chaque
-- boutique (tarifs négociés). La colonne porte la clé CHIFFRÉE — jamais en clair — par
-- src/lib/chiffrement.ts (AES-GCM, clé d'enveloppe en secret de plateforme).
--
-- ⚠ N'importe quel fournisseur peut porter une clé : pas de traitement spécial pour
-- Mobilax, la table reste générique.
--
-- listFournisseurs()/getFournisseur() ne doivent JAMAIS sélectionner cette colonne par
-- SELECT * ou équivalent — voir bugs.md § email_api_key pour la classe de défaut que ça
-- évite. La lecture déchiffrée passe par une fonction dédiée, non exposée par une route.

ALTER TABLE fournisseurs ADD COLUMN api_key_chiffree TEXT;
