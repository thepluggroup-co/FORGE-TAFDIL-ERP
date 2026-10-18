# Rapport d’audit — retours de visite TAFDIL (15/10/2026)

Audit en lecture seule du dépôt `main`, sans modification de code ni exécution de tests.

## 1. Emplacements fonctionnels

| Sujet | Emplacements constatés |
|---|---|
| Devis API | `apps/api/src/routes/commerce.ts` (CRUD, workflow, PDF), `apps/api/src/services/pdf.service.ts` (génération), `apps/api/src/routes/configurateur.ts` (demandes configurateur et devis brouillon), `apps/api/src/routes/shop.ts` (demandes web et qualification). Le montage API est dans `apps/api/src/app.ts`. |
| Devis ERP web | `apps/web/src/pages/Devis.tsx` (liste, formulaire et lignes), `apps/web/src/hooks/useDevis.ts`, `apps/web/src/hooks/useDevisWeb.ts`, `apps/web/src/components/devis/Configurateur.tsx`, `apps/web/src/components/devis/DevisPreview.tsx`. Entrée de navigation dans `apps/web/src/components/layout/Sidebar.tsx`; route dans `apps/web/src/App.tsx`. |
| Devis desktop | Stockage local SQLite défini/évolué dans `apps/desktop/src/main/ipc/db-handler.ts`; tables synchronisées vers Supabase dans `apps/desktop/src/main/ipc/sync-handler.ts` (`SYNC_TABLES`, entrée `devis`). Aucune page/composant desktop de saisie de devis dédiée trouvé sous `apps/desktop/src`. L’UI ERP est la webview, voir `apps/desktop/src/main/index.ts`. |
| Fiche technique | Interface d’administration dans `apps/web/src/pages/Catalogue.tsx`, hooks API dans `apps/web/src/hooks/useCatalogue.ts`, endpoints notamment `apps/api/src/routes/catalogue.ts`; calcul dans `apps/api/src/services/devis-calculation.service.ts` et `packages/shared/src/devis-calcul.ts`. Tables Drizzle dans `packages/db/src/schema.pg.ts` et migrations Supabase `supabase/migrations/20260925_phase1_gamme_fiche_technique.sql`. |
| Produits configurables | ERP : `apps/web/src/components/devis/Configurateur.tsx`, gestion catalogue `apps/web/src/pages/Catalogue.tsx` et `apps/web/src/components/catalogue/ParametresConfiguration.tsx`; API `apps/api/src/routes/configurateur.ts`, `apps/api/src/services/configuration.service.ts`; logique pure `packages/shared/src/configuration.ts`; Shop `apps/shop/app/configurateur/[id]/ConfigurateurClient.tsx`. Schéma/migrations : `supabase/migrations/20261004_catalogue_hybride_phase3_configurateur.sql` et étapes catalogue `20260925_phase1_gamme_fiche_technique.sql`, `20261001_catalogue_hybride_phase1_hierarchie.sql`. |
| Visibilité boutique | Champ/vitrine déjà existant `produits_shop.visible_shop`, endpoints de gestion dans `apps/api/src/routes/shop.ts` (notamment PUT `/api/shop-erp/produits/:id/visibilite`) et interface `apps/web/src/pages/Boutique.tsx`; les modèles configurables utilisent `modeles_shop.visible_shop`. À réutiliser, aucune seconde visibilité n’est nécessaire. Migrations `supabase/migrations/20260519_shop_tables.sql`, `20261002_catalogue_hybride_phase2_modeles_shop.sql`. |
| Menus ERP | Groupes et liens filtrés par permissions dans `apps/web/src/components/layout/Sidebar.tsx` (`NAV_GROUPS` : Activité, Commercial, Gestion, Pilotage). Conteneur/menu supérieur dans `apps/web/src/components/layout/AppShell.tsx` et `TopBar.tsx`. |

Le calcul de fiche technique connaît actuellement plusieurs bases (`quantitatif`, `surface`, `lineaire`, `volume`, `poids`, `forfait`, `qualitatif`) dans `packages/shared/src/devis-calcul.ts`; la branche `volume` calcule un volume dimensionnel puis le multiplie par la quantité. Cela situe précisément le comportement à examiner au lot fonctionnel suivant, sans préjuger du changement demandé.

## 2. Rôles et écarts de nommage

### Trois emplacements demandés

- **Types API** : `apps/api/src/types.ts` définit le rôle profil historique en union : `admin | superviseur | operateur | technicien | livreur | caissier`.
- **Types partagés** : `packages/shared/src/types.ts`, `UserRoleSchema`, définit `admin | superviseur | operateur | technicien | caissier | livreur` (mêmes valeurs, ordre différent; pas de `apprenant`).
- **Schéma Drizzle/PostgreSQL** : il n’y a pas une seule définition cohérente. `packages/db/src/schema.pg.ts` `roleEnum` vaut `admin | superviseur | operateur | apprenant`; `packages/db/src/schema.ts` (SQLite/local) utilise `directeur | admin | operateur | viewer`; `packages/db/src/schema.pg.rbac.ts` définit en plus l’enum RBAC distinct `rbac_role_name` avec `SUPER_ADMIN`, `MANAGER`, `COMMERCIAL`, `CAISSIER`, etc. Le type profil SQL courant est donc désaligné avec API/types partagés (livreur/technicien absents; apprenant en plus). Des migrations ont aussi élargi des contraintes : `packages/db/migrations/0032_livreur_enum.sql`, `0033_livreur_rbac_ddl.sql`, `supabase/migrations/20260815_add_caissier_livreur_role.sql`, `20260903_rbac_expand_commercial_livreur_caissier.sql`.

### MANAGER / superviseur

Le RBAC moderne est une seconde notion de rôle, pas un remplacement direct de `profiles.role` :

- `packages/db/src/schema-rbac.ts`, `packages/db/src/schema.pg.rbac.ts`, `packages/db/src/seeds/rbac.ts`, `packages/shared/src/types.ts` (types RBAC) et `apps/web/src/lib/rbac-constants.ts` définissent `MANAGER`.
- `supabase/migrations/20260607_rbac_module.sql` mappe `superviseur` vers `MANAGER`; `apps/api/src/services/rbacService.ts` garde le même mapping. L’interface d’administration `apps/web/src/pages/AdminSettings.tsx` présente notamment `MANAGER` avec le libellé « Superviseur », tandis que `apps/web/src/lib/rbac-constants.ts` nomme le rôle « Manager ». C’est un écart de libellé UI.
- occurrences littérales métier de `superviseur` restent nombreuses dans API, web et mobile (garde d’accès et libellés), par ex. `apps/api/src/index.ts`, `apps/api/src/routes/admin.ts`, `apps/web/src/context/AuthContext.tsx`, `apps/web/src/components/layout/Sidebar.tsx`, `apps/mobile/src/context/AuthContext.tsx` et `apps/mobile/src/pages/ProfilePage.tsx`.
- Les occurrences de `manager` couvrent tantôt le rôle RBAC en majuscules, tantôt le nom générique d’un gestionnaire de processus (ex. `SyncManager` dans `apps/desktop/src/main/ipc/sync-handler.ts`). Elles ne sont pas toutes des rôles.
- `gestionnaire` apparaît comme traduction descriptive du gestionnaire de synchronisation et dans des commentaires métier; aucun rôle profil `gestionnaire` n’a été trouvé.

### Écarts résumés

1. Libellé du même rôle RBAC : « Manager » (`apps/web/src/lib/rbac-constants.ts`) vs « Superviseur » (`apps/web/src/pages/AdminSettings.tsx`).
2. Le rôle historique `superviseur` est traduit vers `MANAGER` par RBAC, mais certaines vérifications et libellés utilisent le profil legacy directement.
3. L’enum profil PostgreSQL Drizzle ne représente ni toutes les valeurs API/partagées ni les mêmes valeurs SQLite.
4. Tests d’interface (`apps/web/e2e/dashboard-roles.spec.ts`) utilisent explicitement `rbac: MANAGER` et `legacy: superviseur`, confirmant l’existence simultanée des deux niveaux.

Pour une extraction exhaustive vérifiable : `rg -n -i 'superviseur|supervisor|manager|gestionnaire' apps packages supabase/migrations`. Le terme anglais `supervisor` apparaît surtout dans les noms de policies/commentaires SQL, par exemple `packages/db/migrations/0042_bons_livraison.sql` (`admin_supervisor_read_all_bl`), pas comme valeur d’enum relevée.

## 3. Domaines et HTTPS

### Domaines publics identifiés dans configurations et documentation

- `forge-tafdil-erp-web.vercel.app` — ERP; `.env.example` (`FRONTEND_URL`, `INVITE_REDIRECT_URL`), `docs/deploiement-railway-vercel.md`.
- `forge-tafdil.vercel.app` — ancien domaine ERP, commenté dans `.env.example` et autorisé dans la documentation Railway.
- `shop.tafdil.cm` — Shop; `.env.example` (`NEXT_PUBLIC_SITE_URL`), doc déploiement et `apps/shop/vercel.json` (configuration de build, sans nom de domaine).
- `shimmering-balance-forge-tafdil.up.railway.app` — API Railway active indiquée par `.env.example`, `railway.json` indirectement via config Railway, doc déploiement; aussi callback paiement.
- `forge-tafdil-erp-tafdil.up.railway.app` — ancienne URL API marquée expirée/hors service dans `.env.example` et doc.
- `lcfuuwwsfqdhphhsbkky.supabase.co` — API/base Supabase exposée par `.env.example` et documentation.
- domaines externes présents comme dépendances mais non domaines de déploiement FORGE : `api.anthropic.com` (URL fournisseur de code/config); ne pas les confondre avec les quatre services publics FORGE.

Aucun domaine personnalisé ERP distinct n’a été trouvé au-delà des domaines Vercel référencés. Les projets peuvent avoir des alias Vercel non présents dans le dépôt; le repo seul ne permet pas d’en établir la liste côté console.

### Contrôles réseau

Les vérifications actives n’ont pas pu aboutir depuis cet environnement. `openssl` n’est pas installé (« commande non reconnue »); `curl.exe` échoue à ouvrir les connexions HTTP et HTTPS (« Failed to connect », ports 80 et 443). Donc aucun résultat d’émetteur, expiration, chaîne, SAN, redirection ou HSTS ne peut être attesté ici. Ne pas interpréter cette absence comme un certificat invalide.

À lancer depuis une machine disposant d’OpenSSL et d’un accès réseau, pour chacun des hôtes listés ci-dessus (l’ancien Railway peut ne plus résoudre) :

```sh
openssl s_client -connect <domaine>:443 -servername <domaine> -showcerts </dev/null
curl -sS -I -L http://<domaine>
curl -sS -I https://<domaine>
```

Vérifier `issuer`, dates `notAfter`, tous les certificats présentés, `Verify return code`, SAN du certificat, la séquence de statuts et l’en-tête `Strict-Transport-Security`. Le certificat public Supabase est celui de son domaine projet, à auditer séparément si le client considère ce domaine comme public à contrôler.

Recherche statique : aucune URL `http://` applicative codée en dur n’a été trouvée dans `apps/web/src` ou `apps/shop` hors valeurs localhost de développement (`apps/web/src/pages/Boutique.tsx`, `apps/shop/lib/forge-api.ts`). `.env.example` configure aussi `VITE_API_URL=http://localhost:3001` en local. Cela ne permet pas d’exclure du contenu mixte injecté par configuration distante ou données enregistrées en base.

## 4. Persistance d’un devis

Le devis ERP enregistré est conservé en base Supabase/PostgreSQL via les routes `apps/api/src/routes/commerce.ts` et les hooks `apps/web/src/hooks/useDevis.ts` / `useDevisWeb.ts`; ce n’est pas uniquement de l’état React. Le configurateur API crée aussi une configuration et, si applicable, un devis `brouillon` en base (`apps/api/src/routes/configurateur.ts`). Le desktop possède une table SQLite locale `devis` et une entrée de synchronisation dans `apps/desktop/src/main/ipc/db-handler.ts` et `sync-handler.ts`, donc copie offline puis sync.

Dans `apps/web/src/pages/Devis.tsx`, l’état React sert au formulaire courant. Le localStorage constaté ne conserve qu’un masque de devis expirés (`CLE_EXPIRES_MASQUES`), pas le contenu d’un brouillon de formulaire de devis. Les demandes publiques avant qualification sont conservées en table `demandes_devis_web` par `apps/api/src/routes/shop.ts`.

## 5. Inventaire des champs numériques

Inventaire statique des `input type="number"` dans les sources web/mobile/desktop. La valeur « défaut » décrit le `value`, `defaultValue` ou `placeholder` visible dans le JSX; quand elle dépend d’un state non initialisé dans l’extrait, elle est indiquée comme dynamique. Les contrôles `range` sont signalés séparément. `step` omis signifie le défaut HTML `1`. Les champs sont généralement stockés comme **chaînes** lorsque `onChange` passe `e.target.value`; ceux avec `Number(...)` deviennent des nombres.

### ERP Web

| Fichier:ligne | Champ | type / step | Défaut observé | stockage et note |
|---|---|---|---|---|
| `apps/web/src/components/production/FabricationOF.tsx:63` | quantité facturable | number / any | vide (placeholder) | chaîne (`setQuantite(value)`) |
| `.../FabricationOF.tsx:106` | temps réel | number / 0.25 | state `temps` | chaîne (`setTemps`) |
| `.../FabricationOF.tsx:181` | quantité réalisée | number / any | state `reel` | chaîne (`setReel`) |
| `.../FabricationOF.tsx:219` | quantité composant | number / any | `f.quantite` | chaîne |
| `apps/web/src/components/catalogue/ReglesMarge.tsx:66` | taux marge | number / 0.5 | state `taux` | chaîne |
| `.../catalogue/GammeOperations.tsx:73` | numéro d’ordre | number / 10 | `form.numero || prochainNumero` | state numérique; incrément proposé par dizaines |
| `.../GammeOperations.tsx:88` | temps unitaire h | number / 0.05 | vide via `|| ''` | conversion en nombre dans handler |
| `.../GammeOperations.tsx:92` | temps fixe h | number / 0.25 | vide via `|| ''` | conversion en nombre |
| `.../GammeOperations.tsx:129` | coût horaire XAF | number / 50 | `defaultValue={p.cout_horaire_xaf}` | non contrôlé, valeur initiale DB |
| `apps/web/src/components/catalogue/FraisIndirects.tsx:75` | montant/taux frais | number / conditionnel 0.5 ou 1 | state de formulaire | conversion à confirmer au handler; pas de `value` dans la ligne JSX relevée |
| `apps/web/src/components/devis/Configurateur.tsx:107` | dimension/paramètre configurable | number / 0.01 | `param.valeur_defaut` dans JSX | conversion en nombre; initialisé selon la valeur de modèle, potentiellement zéro |
| `.../Configurateur.tsx:124` | quantité de produits | number / 1 | state `quantite` | state numérique, défaut 1 et pas de pas autre que 1 |
| `apps/web/src/components/boutique/VitrineModeles.tsx:107` | prix public XAF | number / 1 | state `prix` | chaîne |
| `.../VitrineModeles.tsx:117` | délai fabrication jours | number / 1 | state `delai` | chaîne |
| `.../VitrineModeles.tsx:124` | quantité minimum | number / 1 | state `min` | chaîne; minimum 1 |
| `apps/web/src/components/boutique/DemandesDevis.tsx:112` | quantité demandée | number / any | `f.quantite` | chaîne |
| `apps/web/src/pages/Devis.tsx:1164,1275` | quantité ligne de devis | number / 0.01 | `ligne.quantite` | state numérique/ligne modifié via parsing; min 0.01 |
| `apps/web/src/pages/Projets.tsx:199` | quantité ressource de projet | number / 0.01 | `form.quantite` | state numérique (voir handler du formulaire) |
| `apps/web/src/pages/Commandes.tsx:1063` | quantité article | number / any | valeur ligne | state lié à l’article; min 0.001 |
| `apps/web/src/pages/Production.tsx:314` | valeur de production (quantité/mesure) | number / 0.01 | valeur contrôlée par state | préciser le libellé métier selon contexte de la page |
| `apps/web/src/pages/Caisse.tsx:542` | quantité vente | number / 0.01 | `l.quantite` | état de ligne, min 0.01 |
| `apps/web/src/pages/Catalogue.tsx:848` | quantité ressource par unité | number / 0.001 | `defaultValue={r.quantite_par_unite}` | non contrôlé, commit onBlur/change; défaut fiche existante, création préinitialisée à 1 |
| `.../Catalogue.tsx:860` | coût unitaire référence XAF | number / 1 | `defaultValue={r.cout_unitaire_reference_xaf}` | non contrôlé; INTEGER monétaire en base |
| `.../Catalogue.tsx:950` | quantité ressource par unité | number / 0.001 | `ressourceForm.quantite_par_unite` (initialisée à 1) | nombre via `Number(e.target.value)`; force 1 initialement |
| `.../Catalogue.tsx:959` | coût de référence XAF | number / 1 | state formulaire (0) | conversion numérique; force 0 initialement |
| `.../Catalogue.tsx:967` | temps de référence h | number / 0.01 | valeur initiale vide/optionnelle | nombre ou undefined selon gestion formulaire |
| `.../Catalogue.tsx:976` | ordre ressource | number / 1 | formulaire (0) | nombre; ordre initial 0 |
| `apps/web/src/pages/Equipements.tsx:534` | coût horaire XAF | number / 50 | coût existant ou vide (`?? ''`) | non contrôlé, `defaultValue` |
| `apps/web/src/features/credit/CreditLimitForm.tsx:130` | limite de crédit XAF | number / 10000 | `value` contrôlé par state formulaire | incrément inhabituel de 10 000 FCFA |
| `apps/web/src/features/credit/PaymentPlanWizard.tsx:200` | acompte (%) | **range** / 5 | `firstPercent` | numérique, incréments de 5 % |

Remarques ciblées : plusieurs entrées de configuration ou ressources démarrent à 0/1 au lieu d’être vides (notamment Catalogue.tsx, et quantité du configurateur à 1). Les champs monétaires XAF repérés ont des pas de 1, 50 ou 10 000; temps et quantités fractionnaires ont des pas explicites. `step="any"` autorise une granularité arbitraire, incompatible potentiellement avec la contrainte métier INTEGER si utilisé pour un montant; les lignes listées `any` sont des quantités/temps, pas prix.

### Desktop et mobile

Aucun `input type="number"` littéral trouvé dans `apps/desktop/src` ni `apps/mobile/src`. Desktop héberge l’ERP web; ses champs viennent donc de `apps/web/src`. Mobile actuel utilise des pages et composants natifs web (`apps/mobile/src/pages`, `components`) sans saisie HTML `type=number` repérée. Recherche utilisée : `rg -n 'type="number"|type=''number''' apps/web/src apps/desktop/src apps/mobile/src`.

Cette liste est une extraction des inputs HTML `number` du code applicatif. Les champs de texte contrôlés avec clavier numérique via `inputMode`, composants encapsulés ou formulaires alimentés par données peuvent nécessiter un second passage dédié si le périmètre inclut toute saisie numérique, pas seulement les inputs number.

## 6. Gabarit PDF devis

- Fichier : `apps/api/src/services/pdf.service.ts`; bibliothèque `pdfkit` (import ligne 1; `PDFDocument`, format A4).
- `generateDevisPDF` ligne 878 environ; en-tête dessiné par `drawDevisHeaderTafdil` (~676), filigrane par `drawDevisWatermark` (~703).
- Logo principal en haut à gauche, légèrement par-dessus le bandeau rouge/noir : `doc.image(LOGO_TRANSPARENT_PATH, ML - 4, 10, { width: 70, height: 78 })`. Logo filigrane centré à opacité 0,05 sur chaque page via `drawDevisWatermark`.
- Bloc visible intitulé « DÉTAIL DES RESSOURCES (produits catalogue — calcul automatique) » créé par `drawDevisRessourcesDetail` (~848), appelé depuis `generateDevisPDF` (~921) uniquement si `ressources_snapshot` contient des lignes. Les sous-fonctions d’en-tête, groupe et ligne sont `drawDevisRessourcesTableHeader`, `drawDevisRessourcesGroupRow`, `drawDevisRessourcesRow` (~809–842).

## État du lot 0

Seul ce rapport est à créer/modifier : `docs/audit/2026-10-15-retours-visite.md`. Aucune migration, aucun test ajouté. Je m’arrête ici en attente de validation avant le lot suivant.

## Corrigendum — périmètre de l’inventaire numérique

Le relevé initial de la section 5 était incomplet : une recherche plus large après sa rédaction a retrouvé des champs qui n’y figuraient pas, notamment plusieurs champs caisse, finance, stock, RH, paramètres de configuration, ainsi que des champs mobiles. La phrase indiquant qu’aucun champ numérique n’existe sur mobile était erronée. Le relevé exhaustif doit être repris avant d’utiliser cette section comme spécification de correction.

Résultats complémentaires confirmés par parcours des sources :

- **Mobile** : champs dans `apps/mobile/src/pages/BoutiquePage.tsx` (quantité, prix, montant reçu), `CaissePage.tsx` (vente/paiement), `StockDetailPage.tsx` et `StocksPage.tsx` (stock). Donc le mobile a bien des champs numériques.
- **Web hors lignes déjà inventoriées** : quantités et montants dans `apps/web/src/pages/Caisse.tsx`, `Finance.tsx`, `Stocks.tsx`, `BonsAppro.tsx`, `BonsSortie.tsx`, `Boutique.tsx`, `Commandes.tsx`; paramètres de configurateur dans `apps/web/src/components/catalogue/ParametresConfiguration.tsx`; prix dans `DemandesDevis.tsx`; montants et dates/compteurs dans `Equipements.tsx`, `Formation.tsx`, `RH.tsx`, `Marketing.tsx`, `Projets.tsx`, `Production.tsx`; sécurité dans `apps/web/src/features/admin/SecuritySettings.tsx`; crédit dans `CreditLimitForm.tsx` et `PaymentPlanDetail.tsx`; analytique dans `apps/web/src/pages/intelligence/ShopPerformance.tsx`.
- **Desktop** : pas de page de formulaire autonome observée sous `apps/desktop/src`; l’ERP intégré expose les champs web. Les états de stockage/synchronisation restent documentés en section 1.

Commande reproductible pour la liste exhaustive des emplacements JSX actuellement versionnés :

```powershell
Get-ChildItem apps/web/src,apps/desktop/src,apps/mobile/src -Recurse -Include *.tsx,*.ts |
  Select-String -Pattern 'type="number"|type=''number''|type="range"'
```

La section 5 du présent audit est donc un premier relevé partiel et ne satisfait pas encore l’exigence « tous les champs » du prompt. Il faudra la régénérer et vérifier chaque valeur initiale, attribut `step`, type HTML et conversion d’état avant de conclure le lot 0.
