# Principes Architecturaux Core - izigsm

Ce document définit les règles immuables pour le développement et la modification de l'application Izigsm. Tout développeur (ou IA) doit s'y conformer strictement.

## 1. Modularité et Indépendance
- L'application est composée de modules fonctionnels indépendants.
- Les modules communiquent **exclusivement** à travers des APIs.
- Aucun module ne doit accéder directement à la base de données d'un autre module.

## 2. Découplage Frontend / Backend
- Le **Frontend** (BFF - Backend For Frontend) est développé en **PHP**.
- Le **Backend** est composé de microservices en **Node.js**.
- Le couplage doit être faible : le frontend utilise uniquement des appels API REST via l'API Gateway.

## 3. Backend PHP (BFF)
- Le PHP assure la logique de présentation, la validation d'entrée et la coordination des appels API.
- Forcer l'utilisation de PHP pour toute la couche de rendu et de gestion de session utilisateur.

## 4. Design Patterns et Lisibilité
- Utiliser des design patterns reconnus (MVC, Proxy, Gateway, Strategy).
- Le code doit être conçu pour une lecture humaine aisée.
- **Documentation Obligatoire** : Chaque fonction, classe et bloc de logique complexe doit être commenté en précisant son rôle architectural.

## 5. Communication via API
- Toutes les opérations de persistance (CRUD) doivent passer par l'API.
- Utiliser l'objet `ApiService` pour standardiser les appels.

---
*Dernière mise à jour : 16 février 2026*
