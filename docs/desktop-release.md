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
