-- ============================================================
-- SEED — Données de test iziGSM
-- À appliquer APRÈS les 9 migrations
-- wrangler d1 execute izigsm-production --local --file=seed.sql
-- ============================================================

-- ── Boutique de démo ──────────────────────────────────────
INSERT OR IGNORE INTO boutiques (id, nom, siret, tva_numero, adresse, code_postal, ville, telephone, email) VALUES
  (1, 'iziGSM Paris 11', '12345678901234', 'FR12345678901', '42 rue de la Roquette', '75011', 'Paris', '01 23 45 67 89', 'paris11@izigsm.fr');

INSERT OR IGNORE INTO boutique_settings (boutique_id, tva_taux_defaut, horaires) VALUES
  (1, 20.0, '{"lun":"09:00-19:00","mar":"09:00-19:00","mer":"09:00-19:00","jeu":"09:00-19:00","ven":"09:00-19:00","sam":"10:00-18:00","dim":"ferme"}');

-- ── Utilisateurs ─────────────────────────────────────────
-- Mots de passe : "Admin@2026!" — PBKDF2-SHA256, 100 000 itérations
-- Format : 100000:salt_hex(32):hash_hex(64)  (généré par src/lib/auth.ts hashPassword)
INSERT OR IGNORE INTO users (id, email, password_hash, prenom, nom, telephone, role_id, boutique_id, actif, email_verifie) VALUES
  (1, 'admin@izigsm.fr',   '100000:f0cc9cb2109bfb74f965a6345f93793e:7df66f3af9547f005e0d89a96e0d488a52c87facdaaa063920df47b2590c606f', 'Admin',   'iziGSM',  '06 00 00 00 01', 1, NULL, 1, 1),
  (2, 'manager@izigsm.fr', '100000:477ac0b6ec7ba6943c21c9faf240677f:7932b82f965ade06659c8ebb27ae8410a377ad96201ddc9d1a1529c5942911c7', 'Sophie',  'Martin',  '06 00 00 00 02', 2, 1,    1, 1),
  (3, 'tech1@izigsm.fr',   '100000:bc773f3148d0e1d9b27b7f87f730f9a2:628f3aa6252f0dd4f4cb5832df3764dff53503f36a3ee1907df5a49dfa62c622', 'Lucas',   'Dubois',  '06 00 00 00 03', 3, 1,    1, 1),
  (4, 'tech2@izigsm.fr',   '100000:8d45ac196da2b50b01d54009303245d2:dddc2ec27ea2ba531ddfe5e4e0ec50c1da3db390efc000b36a6864b7f927b2a8', 'Emma',    'Bernard', '06 00 00 00 04', 3, 1,    1, 1);

-- ── Employés (liés aux users techniciens) ────────────────
INSERT OR IGNORE INTO employes (id, boutique_id, user_id, prenom, nom, poste, commission_pct, statut_pointage) VALUES
  (1, 1, 3, 'Lucas',  'Dubois',  'technicien', 5.0, 'absent'),
  (2, 1, 4, 'Emma',   'Bernard', 'technicien', 5.0, 'absent'),
  (3, 1, 2, 'Sophie', 'Martin',  'manager',    0.0, 'absent');

-- ── Catégories de produits ───────────────────────────────
INSERT OR IGNORE INTO categories (id, boutique_id, nom, parent_id) VALUES
  (1, 1, 'Écrans',       NULL),
  (2, 1, 'Batteries',    NULL),
  (3, 1, 'Connecteurs',  NULL),
  (4, 1, 'Coques',       NULL),
  (5, 1, 'iPhone',       1),
  (6, 1, 'Samsung',      1),
  (7, 1, 'iPhone',       2),
  (8, 1, 'Samsung',      2);

-- ── Produits de démonstration ────────────────────────────
INSERT OR IGNORE INTO produits (id, boutique_id, categorie_id, sku, nom, marque, prix_achat_ht, prix_vente_ht, tva_taux, stock_actuel, stock_minimum, fournisseur) VALUES
  (1, 1, 5, 'ECR-IP14-001', 'Écran iPhone 14',        'Apple',   45.00,  89.00, 20.0, 12, 3, 'Mobilax'),
  (2, 1, 5, 'ECR-IP13-001', 'Écran iPhone 13',        'Apple',   38.00,  75.00, 20.0, 8,  3, 'Mobilax'),
  (3, 1, 5, 'ECR-SS-S23',   'Écran Samsung Galaxy S23','Samsung', 52.00,  99.00, 20.0, 5,  3, 'Utopya'),
  (4, 1, 7, 'BAT-IP14-001', 'Batterie iPhone 14',     'Apple',   18.00,  39.00, 20.0, 20, 5, 'Phone LCD'),
  (5, 1, 7, 'BAT-IP13-001', 'Batterie iPhone 13',     'Apple',   15.00,  35.00, 20.0, 15, 5, 'Phone LCD'),
  (6, 1, 8, 'BAT-SS-S22',   'Batterie Samsung S22',   'Samsung', 20.00,  42.00, 20.0, 10, 3, 'Mobilax'),
  (7, 1, 3, 'CNX-LIGHT-IP', 'Connecteur Lightning',   'Apple',    8.00,  25.00, 20.0, 25, 5, 'Mobilax'),
  (8, 1, 3, 'CNX-USBC-SS',  'Connecteur USB-C',       'Samsung',  6.00,  20.00, 20.0, 30, 5, 'Utopya'),
  (9, 1, 3, 'CNX-CHARGE-IP','Connecteur de charge IP14','Apple',  12.00, 35.00, 20.0,  2, 5, 'Phone LCD');  -- stock bas !

-- ── Clients de démonstration ─────────────────────────────
INSERT OR IGNORE INTO clients (id, boutique_id, prenom, nom, email, telephone, adresse, code_postal, ville) VALUES
  (1, 1, 'Jean',    'Dupont',   'jean.dupont@gmail.com',    '06 12 34 56 78', '15 rue de la Paix',  '75001', 'Paris'),
  (2, 1, 'Marie',   'Leroy',    'marie.leroy@outlook.fr',   '06 23 45 67 89', '8 avenue Victor Hugo','75016', 'Paris'),
  (3, 1, 'Pierre',  'Moreau',   'pierre.moreau@yahoo.fr',   '07 34 56 78 90', '3 allée des Roses',  '75012', 'Paris'),
  (4, 1, 'Nathalie','Girard',   'n.girard@gmail.com',       '06 45 67 89 01', '22 bd Voltaire',     '75011', 'Paris'),
  (5, 1, 'Thomas',  'Petit',    'thomas.petit@free.fr',     '07 56 78 90 12', '45 rue Oberkampf',   '75011', 'Paris');

-- ── Appareils des clients ────────────────────────────────
INSERT OR IGNORE INTO appareils (id, client_id, marque, modele, type, imei, couleur) VALUES
  (1, 1, 'Apple',   'iPhone 14',        'smartphone', '359123456789012', 'Noir'),
  (2, 1, 'Apple',   'iPad Pro 12.9',    'tablette',   NULL,              'Gris sidéral'),
  (3, 2, 'Samsung', 'Galaxy S23',       'smartphone', '358987654321098', 'Blanc'),
  (4, 3, 'Apple',   'iPhone 13',        'smartphone', '357654321098765', 'Bleu'),
  (5, 4, 'Xiaomi',  'Redmi Note 12',    'smartphone', NULL,              'Vert'),
  (6, 5, 'Samsung', 'Galaxy A54',       'smartphone', '356543210987654', 'Noir');

-- ── Tickets de démonstration ─────────────────────────────
INSERT OR IGNORE INTO tickets (id, boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele, description_panne, statut, technicien_id, diagnostic, prix_estime, prix_final) VALUES
  (1, 1, 'TKT-2026-00001', 1, 1, 'Apple',   'iPhone 14',     'Écran fissuré suite à une chute',         'en_reparation', 3, 'Écran LCD endommagé, remplacement nécessaire', 89.00, 89.00),
  (2, 1, 'TKT-2026-00002', 2, 3, 'Samsung', 'Galaxy S23',    'Batterie se décharge trop vite',           'diagnostic',    4, NULL, 42.00, NULL),
  (3, 1, 'TKT-2026-00003', 3, 4, 'Apple',   'iPhone 13',     'Ne charge plus',                           'recu',          NULL, NULL, NULL, NULL),
  (4, 1, 'TKT-2026-00004', 4, 5, 'Xiaomi',  'Redmi Note 12', 'Micro défaillant, interlocuteur n''entend plus','termine',   3, 'Remplacement micro nécessaire', 35.00, 35.00),
  (5, 1, 'TKT-2026-00005', 1, 1, 'Apple',   'iPhone 14',     'Touch ID ne fonctionne plus',              'livre',         3, 'Connecteur flex remplacé', 45.00, 45.00);

-- ── Séquences (pour numérotation auto) ───────────────────
INSERT OR IGNORE INTO sequences (boutique_id, type, annee, dernier_num) VALUES
  (1, 'ticket',  2026, 5),
  (1, 'facture', 2026, 2),
  (1, 'devis',   2026, 3);
