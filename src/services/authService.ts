/**
 * @module services/authService
 * @description Service Authentification — toutes les opérations SQL liées aux utilisateurs,
 *              aux boutiques d'inscription et aux sessions.
 *
 * Rôle architectural (P1 Modularité) :
 *   Ce service est le seul endroit où des requêtes SQL concernant `users`,
 *   `boutiques` et `boutique_settings` sont émises dans le flux d'authentification.
 *   `routes/auth.ts` est un controller pur qui appelle ce service — 0 SQL direct.
 *
 * Fonctions exposées :
 *   - `findUserByEmail()`     → cherche un utilisateur par email (unicité + login)
 *   - `findUserById()`        → cherche un utilisateur actif par id (refresh + me)
 *   - `findUserByEmailFull()` → cherche avec password_hash pour le login
 *   - `findUserWithProfile()` → cherche avec boutique_nom pour /me
 *   - `createBoutiqueWithSettings()` → crée boutique + boutique_settings en séquence
 *   - `createUser()`          → insert user inactif avec boutique_id optionnel
 *   - `activateUser()`        → UPDATE actif=1, email_verifie=1 après OTP validé
 *   - `findUserByEmailAfterActivation()` → SELECT avec rôle après activation
 *
 * Conventions SQL :
 *   - Toutes les requêtes utilisent des paramètres liés (`?`) — pas d'interpolation
 *   - Les champs optionnels utilisent `?? null` (nullish coalescing)
 *   - Les requêtes retournant un seul enregistrement utilisent `.first<T>()`
 *   - Les requêtes d'écriture utilisent `.run()`
 *
 * @see routes/auth.ts  Controller qui consomme ce service
 * @see lib/auth.ts     Cryptographie (hashPassword, JWT, OTP) — séparée de la DB
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Représentation d'un utilisateur avec son rôle (pour génération JWT).
 */
export interface UserWithRole {
  id:          number
  email:       string
  prenom:      string
  nom:         string
  boutique_id: number | null
  role:        string
}

/**
 * Représentation d'un utilisateur complet avec son hash (pour login).
 */
export interface UserFull extends UserWithRole {
  password_hash:  string
  actif:          number
  email_verifie:  number
}

/**
 * Profil utilisateur enrichi avec nom de boutique (pour /me).
 */
export interface UserProfile extends UserWithRole {
  telephone:    string | null
  boutique_nom: string | null
}

// ─── findUserByEmail ──────────────────────────────────────────────────────────

/**
 * Vérifie l'existence d'un email dans la table `users`.
 *
 * Utilisé dans `POST /register` pour garantir l'unicité avant insertion.
 * Retourne uniquement l'`id` pour minimiser la lecture inutile.
 *
 * @param db     Instance D1Database (injectée depuis le contexte Hono)
 * @param email  Adresse email à rechercher (sensible à la casse selon SQLite)
 * @returns      `{ id: number }` si l'email existe, `null` sinon
 */
export async function findUserByEmail(
  db: D1Database,
  email: string
): Promise<{ id: number } | null> {
  return db.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>()
}

// ─── findUserByEmailFull ──────────────────────────────────────────────────────

/**
 * Récupère un utilisateur complet (avec hash du mot de passe) par email.
 *
 * Utilisé exclusivement dans `POST /login` pour vérifier le mot de passe.
 * Inclut `actif` et `email_verifie` pour les vérifications de statut de compte.
 *
 * Sécurité : le `password_hash` ne doit JAMAIS être retourné dans une réponse HTTP.
 * Il est utilisé uniquement pour la vérification PBKDF2 locale.
 *
 * @param db     Instance D1Database
 * @param email  Adresse email de l'utilisateur
 * @returns      `UserFull` complet (avec hash), `null` si email introuvable
 */
export async function findUserByEmailFull(
  db: D1Database,
  email: string
): Promise<UserFull | null> {
  return db.prepare(`
    SELECT u.id, u.email, u.password_hash, u.prenom, u.nom,
           u.boutique_id, u.actif, u.email_verifie, r.nom as role
    FROM   users u JOIN roles r ON r.id = u.role_id
    WHERE  u.email = ?
  `).bind(email).first<UserFull>()
}

// ─── findUserById ─────────────────────────────────────────────────────────────

/**
 * Récupère un utilisateur actif par son identifiant.
 *
 * Utilisé dans `POST /refresh` (rotation de token) pour reconstruire le payload JWT.
 * La clause `AND actif = 1` garantit qu'un compte désactivé ne peut pas renouveler
 * son token même si le refresh token KV est encore valide.
 *
 * @param db      Instance D1Database
 * @param userId  Identifiant numérique de l'utilisateur (issu du payload JWT `sub`)
 * @returns       `UserWithRole` si l'utilisateur existe et est actif, `null` sinon
 */
export async function findUserById(
  db: D1Database,
  userId: number
): Promise<UserWithRole | null> {
  return db.prepare(`
    SELECT u.id, u.email, u.prenom, u.nom, u.boutique_id, r.nom as role
    FROM   users u JOIN roles r ON r.id = u.role_id
    WHERE  u.id = ? AND u.actif = 1
  `).bind(userId).first<UserWithRole>()
}

// ─── findUserWithProfile ──────────────────────────────────────────────────────

/**
 * Récupère le profil complet de l'utilisateur courant, enrichi du nom de boutique.
 *
 * Utilisé exclusivement dans `GET /me` pour retourner les données affichables
 * dans l'interface (nom de la boutique, téléphone, etc.).
 * La `LEFT JOIN boutiques` permet aux utilisateurs sans boutique (admin global) de
 * se connecter normalement (`boutique_nom` sera `null`).
 *
 * @param db      Instance D1Database
 * @param userId  Identifiant numérique de l'utilisateur courant (issu du JWT `sub`)
 * @returns       `UserProfile` enrichi si actif, `null` si désactivé ou introuvable
 */
export async function findUserWithProfile(
  db: D1Database,
  userId: number
): Promise<UserProfile | null> {
  return db.prepare(`
    SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.boutique_id,
           r.nom as role, b.nom as boutique_nom
    FROM   users u
    JOIN   roles r ON r.id = u.role_id
    LEFT JOIN boutiques b ON b.id = u.boutique_id
    WHERE  u.id = ? AND u.actif = 1
  `).bind(userId).first<UserProfile>()
}

// ─── createBoutiqueWithSettings ───────────────────────────────────────────────

/**
 * Crée une boutique et initialise ses paramètres par défaut (`boutique_settings`).
 *
 * Utilisé dans `POST /register` lorsque `workshopName` est fourni.
 * L'insertion dans `boutique_settings` utilise les DEFAULT SQL de la table —
 * aucune valeur n'est passée explicitement pour conserver les défauts métier.
 *
 * Séquence (2 opérations) :
 *   1. INSERT INTO boutiques (nom) RETURNING id
 *   2. INSERT INTO boutique_settings (boutique_id)  ← initialise avec DEFAULT
 *
 * Note : pas de transaction explicite (D1 en local gère l'autocommit).
 * En cas d'échec de l'étape 2, la boutique existe sans settings — acceptable
 * car les DEFAULT SQL permettent de fonctionner sans settings explicites.
 *
 * @param db            Instance D1Database
 * @param workshopName  Nom commercial de la boutique à créer
 * @returns             L'identifiant numérique de la boutique créée, `null` si échec
 */
export async function createBoutiqueWithSettings(
  db: D1Database,
  workshopName: string
): Promise<number | null> {
  const bResult = await db.prepare(
    'INSERT INTO boutiques (nom) VALUES (?) RETURNING id'
  ).bind(workshopName).first<{ id: number }>()

  const boutiqueId = bResult?.id ?? null

  if (boutiqueId) {
    await db.prepare(
      'INSERT INTO boutique_settings (boutique_id) VALUES (?)'
    ).bind(boutiqueId).run()
  }

  return boutiqueId
}

// ─── createUser ───────────────────────────────────────────────────────────────

/**
 * Insère un nouvel utilisateur en base avec statut inactif.
 *
 * L'utilisateur est créé avec `actif = 0` et `email_verifie = 0` —
 * il ne pourra pas se connecter avant la validation de son OTP via `POST /verify-otp`.
 * Le `role_id = 2` correspond au rôle `technicien` (rôle par défaut à l'inscription).
 *
 * Le `password_hash` doit avoir été généré par `hashPassword()` (lib/auth.ts)
 * avant d'appeler cette fonction.
 *
 * @param db            Instance D1Database
 * @param email         Adresse email (unique, validée avant appel)
 * @param passwordHash  Hash PBKDF2-SHA256 (format : "iter:salt_hex:hash_hex")
 * @param prenom        Prénom de l'utilisateur
 * @param nom           Nom de famille de l'utilisateur
 * @param telephone     Numéro de téléphone (optionnel, `null` si absent)
 * @param boutiqueId    Identifiant de la boutique associée (`null` si pas de boutique)
 * @returns             L'identifiant numérique du nouvel utilisateur, `null` si échec
 */
export async function createUser(
  db: D1Database,
  email: string,
  passwordHash: string,
  prenom: string,
  nom: string,
  telephone: string | null,
  boutiqueId: number | null
): Promise<number | null> {
  const result = await db.prepare(`
    INSERT INTO users (email, password_hash, prenom, nom, telephone, boutique_id, role_id, actif, email_verifie)
    VALUES (?, ?, ?, ?, ?, ?, 2, 0, 0)
    RETURNING id
  `).bind(email, passwordHash, prenom, nom, telephone, boutiqueId).first<{ id: number }>()

  return result?.id ?? null
}

// ─── activateUser ─────────────────────────────────────────────────────────────

/**
 * Active un compte utilisateur après validation de l'OTP.
 *
 * Met à jour `actif = 1` et `email_verifie = 1` identifié par email.
 * Appelé immédiatement après `verifyOtp()` dans `POST /verify-otp`.
 *
 * @param db     Instance D1Database
 * @param email  Adresse email dont le compte doit être activé
 * @returns      Promesse résolue après l'UPDATE (pas de valeur de retour)
 */
export async function activateUser(
  db: D1Database,
  email: string
): Promise<void> {
  await db.prepare(
    'UPDATE users SET actif = 1, email_verifie = 1, updated_at = CURRENT_TIMESTAMP WHERE email = ?'
  ).bind(email).run()
}

// ─── findUserByEmailAfterActivation ───────────────────────────────────────────

/**
 * Récupère le profil utilisateur (avec rôle) après activation OTP.
 *
 * Appelé juste après `activateUser()` dans `POST /verify-otp` pour construire
 * le payload JWT avant d'émettre la paire de tokens initiale.
 * Identique à `findUserByEmailFull` mais sans le `password_hash`
 * (non nécessaire ici — le hash n'est utilisé que pour la vérification login).
 *
 * @param db     Instance D1Database
 * @param email  Adresse email de l'utilisateur nouvellement activé
 * @returns      `UserWithRole` si trouvé, `null` sinon (cas d'erreur inattendu)
 */
export async function findUserByEmailAfterActivation(
  db: D1Database,
  email: string
): Promise<UserWithRole | null> {
  return db.prepare(`
    SELECT u.id, u.email, u.prenom, u.nom, u.boutique_id, r.nom as role
    FROM   users u JOIN roles r ON r.id = u.role_id
    WHERE  u.email = ?
  `).bind(email).first<UserWithRole>()
}
