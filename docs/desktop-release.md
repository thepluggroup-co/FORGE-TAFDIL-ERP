# Application Desktop — installation et mises à jour

## Principe

- **Données** : toutes les machines lisent/écrivent la même base Supabase (via l'API Railway).
  Une modification faite sur un poste est visible sur les autres à la synchro suivante (≤ 5 min) ou au rechargement.
- **Logiciel** : chaque poste vérifie GitHub Releases au démarrage puis toutes les heures,
  télécharge la nouvelle version en arrière-plan et propose de redémarrer
  (sinon elle s'installe automatiquement à la fermeture). Menu *Aide → Rechercher les mises à jour*.

## Publier une nouvelle version

1. Incrémenter `version` dans `apps/desktop/package.json` (ex. `1.0.0` → `1.0.1`). **Obligatoire** : un poste ne se met à jour que si la version publiée est supérieure à la sienne.
2. Depuis `apps/desktop` :

   ```sh
   # PowerShell
   $env:GH_TOKEN = (gh auth token); pnpm run release:win
   ```

   Cela build le web + Electron, génère `release/FORGE-Setup-<version>.exe` et crée la release GitHub `v<version>` avec `latest.yml`.
3. Les postes installés récupèrent la mise à jour automatiquement.

Prérequis sur la machine de build : `apps/web/.env.local` (VITE_API_URL, VITE_SUPABASE_*) et `apps/desktop/.env` (SUPABASE_URL, SUPABASE_ANON_KEY).

> L'installateur est public (dépôt public). Ne jamais embarquer `SUPABASE_SERVICE_ROLE_KEY` ni `SUPABASE_JWT_SECRET` dans le build desktop.

## Installer sur un nouveau poste

Télécharger `FORGE-Setup-<version>.exe` depuis la page *Releases* du dépôt GitHub et l'exécuter.
L'installation se fait par utilisateur (aucun droit administrateur requis). Windows SmartScreen peut afficher
« Windows a protégé votre ordinateur » (installateur non signé) : *Informations complémentaires → Exécuter quand même*.

## Problèmes connus (machine de build Windows)

- `Cannot create symbolic link` pendant le build : extraire manuellement l'archive `winCodeSign` dans
  `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` en excluant les `*.dylib`, ou activer le mode développeur Windows.
- Lancer l'exe depuis le terminal de VS Code ne fait rien : VS Code définit `ELECTRON_RUN_AS_NODE=1`. Lancer depuis l'Explorateur ou supprimer la variable.

## Mode hors ligne (desktop et mobile)

- **Lecture** : chaque réponse de l'API consultée en ligne est copiée sur l'appareil, par utilisateur. Sans réseau, les écrans affichent la dernière copie. Un écran jamais ouvert en ligne sur cet appareil reste vide. Sur desktop, les données consultées habituellement sont rafraîchies en arrière-plan à la connexion et au retour du réseau.
- **Connexion** : après une connexion en ligne réussie, une empreinte (PBKDF2) des identifiants est gardée sur l'appareil. Sans réseau, les mêmes identifiants (email + mot de passe, ou téléphone + PIN sur desktop) ouvrent l'app. Refusé pour un compte jamais connecté sur l'appareil, après 7 jours sans connexion en ligne, ou 5 minutes après 5 échecs. Code : `packages/shared/src/offline-auth.ts`.
- **Écriture** : sans réseau, les créations, modifications, suppressions et encaissements en espèces sont mis en file d'attente sur l'appareil et rejoués dans l'ordre à la reconnexion. Restent en ligne uniquement : validations et approbations, changements de statut, mobile money, mots de passe et PIN, comptes et droits, envois de fichiers, calculs serveur. La règle est dans `packages/shared/src/offline-writes.ts`.
  - Desktop : toutes les écritures autorisées passent par la file (`apps/web/src/lib/outbox.ts`). Le bouton « N actions en attente » (en bas à droite) liste ce qui n'est pas parti et ce que le serveur a refusé, avec Réessayer / Abandonner. La Caisse garde sa propre file locale.
  - Mobile : seuls les mouvements de stock sont mis en file ; refus et abandon se gèrent dans le bandeau.
  - Un élément créé hors ligne n'a ni numéro ni présence dans les listes avant la synchronisation, et on ne peut pas enchaîner une action sur lui (il n'a pas encore d'identifiant).
  - Une action en attente depuis plus de 7 jours n'est plus envoyée sans confirmation.
- **Anti-doublon** : chaque écriture desktop/mobile porte un en-tête `Idempotency-Key` ; l'API (`apps/api/src/middleware/idempotency.ts`) n'exécute une clé qu'une fois. **Ordre de mise en production obligatoire** : 1) coller `supabase/migrations/20261018_idempotency_keys.sql` dans l'éditeur SQL Supabase, 2) déployer l'API, 3) seulement ensuite publier le desktop et l'APK mobile. Sans les étapes 1 et 2, une action rejouée après une coupure peut être enregistrée deux fois, et le mobile ne peut plus écrire tant que l'API n'autorise pas l'en-tête.
- Dans un navigateur web, rien n'est conservé (poste potentiellement partagé).
