# TAFDIL × FORGE — Audit d'architecture (Phase 0)

> **Date** : 27/09/2026 · **Branche auditée** : `main` @ `30d72c6` + 68 fichiers modifiés non commités
> **Portée** : Phase 0 du *Master Prompt — Intégration progressive et sécurisée (Catalogue Hybride)*.
> **Aucun changement fonctionnel n'a été fait.** Ce document est le seul livrable de la phase.
>
> **Contexte important** : ce brief n'arrive pas sur un terrain vierge. Le *Master Prompt V3*
> ([docs/MASTER-PROMPT-V3.md](../docs/MASTER-PROMPT-V3.md)) a déjà été exécuté en Phases 1 à 6
> (gamme, fiches techniques, moteur de calcul, workflow devis, production, audit, configurateur ERP).
> Une bonne partie du modèle cible **existe déjà sous d'autres noms**. L'enjeu principal est donc
> de **converger**, pas de construire, et d'éviter de créer un 3ᵉ système à côté des deux qui
> existent déjà (voir §F.1).

---

## Résumé exécutif

| # | Constat | Gravité |
|---|---|---|
| 1 | Le **mode commercial** existe déjà : `type_gamme` = `catalogue` / `configuration` / `sur_mesure`, porté par la famille **et surchargeable par modèle** (`resolveTypeGamme`). C'est déjà l'équivalent de STANDARD / CONFIGURABLE / QUOTE. | Réutilisable |
| 2 | **Deux hiérarchies produits concurrentes** : `produit_familles`/`produit_categories` (V3 Phase 1, 25/09, **jamais utilisées par le code**) et `familles` (arbre `parent_id`)/`modeles` (26/09, utilisées par l'API et l'ERP web). | Dette à résorber |
| 3 | **Deux catalogues déconnectés** : la boutique TAFDIL vend des `produits` (le **stock matières** : fer plat, disques, serrures…) via `produits_shop` ; les produits finis (`modeles`) ne sont **pas exposés** au site. Un « Portail P001 à 350 000 FCFA » n'a aujourd'hui aucune place dans le parcours web. | **Bloquant pour la Phase 2** |
| 4 | **Pas de distinction coût de revient / prix de vente.** Le moteur produit un « devis brut » = Σ ressources × `cout_unitaire_reference_xaf`, utilisé directement comme prix. Aucune marge, aucune règle de marge. | **Bloquant pour les Phases 3-4** |
| 5 | **`POST /api/shop/commandes` fait confiance au prix envoyé par le navigateur** (`prix_unitaire`, `frais_livraison`). Le proxy Next.js transmet le body tel quel. Un client peut commander à 1 FCFA. | **Sécurité P0** |
| 6 | Pas de **bornes de configuration** (min/max) ni de modélisation des **options** (motorisation, couleur…) : le cas pilote CAS 3 (10 m × 5 m) serait chiffré comme un cas normal. | Manquant |
| 7 | Pas d'entité **Configuration** persistée ni de numérotation `CFG-`. La config vit en JSONB dans `devis.config_snapshot` / `devis_lignes.configuration`. | Partiel |
| 8 | Numérotation par `count + 1` (course critique possible) partout ; la réf web `WEB-YYYY-XXXX` est **aléatoire** (collision → 500). | Risque |
| 9 | Politiques RLS `USING (true)` sur `produits_shop` (écriture) et `commandes_shop` (lecture) : la clé anonyme peut lire toutes les commandes web (données personnelles) et modifier les prix publics. | **Sécurité P0** |
| 10 | Suite de tests API **saine** : **473/473 verts, 32 fichiers** (exécutée pendant l'audit, sur l'arbre de travail actuel). La dette documentée le 26/09 (66 échecs) est résorbée dans les modifications non commitées. | Base solide |

---

## A. Architecture actuelle

Monorepo **pnpm + Turborepo**, Node ≥ 20, TypeScript partout.

```text
apps/
  api/      Hono (Node) — API REST unique, Zod, vitest. Déployée sur Railway.
  web/      ERP interne FORGE — React + Vite + TanStack Query.
  shop/     Site TAFDIL — Next.js (App Router), Vercel. Proxy /app/api/* → API Hono.
  desktop/  Electron (ERP hors ligne, SQLite local + sync).
  mobile/   Capacitor (Android).
packages/
  db/       Drizzle : schema.pg.ts (Postgres/Supabase) + schema.ts (SQLite hors ligne) + sync.ts
  shared/   Types, constantes, et le moteur de calcul PUR (devis-calcul.ts)
  ai/       Assistant IA FORGE
  ui/       Composants partagés
supabase/migrations/   ← migrations RÉELLEMENT appliquées (collées à la main dans le SQL Editor)
packages/db/migrations/ ← migrations Drizzle 0000-0042 (historiques, non utilisées pour Supabase)
```

- **Base de données** : Supabase (PostgreSQL). L'API utilise la clé `service_role` (contourne RLS).
  Les colonnes monétaires sont en `NUMERIC` côté SQL (le schéma Drizzle les déclare `real` —
  divergence déclarative seulement, la DB fait foi).
- **Auth** : JWT Supabase (ERP), OTP téléphone + PIN (shop / terrain).
- **RBAC** : tables `rbac_*`, middleware `requirePermission(module, action)` côté serveur.
- **Migrations** : pas de CLI Supabase liée ; fichiers datés `YYYYMMDD_*.sql` collés manuellement.
- **Moteur de calcul** : séparation propre **pur** (`packages/shared/src/devis-calcul.ts`) /
  **accès DB** (`apps/api/src/services/devis-calculation.service.ts`). À conserver comme modèle.

## B. Modules existants

| Module | Routes API | UI ERP (`apps/web/src/pages`) | Shop |
|---|---|---|---|
| Catalogue produits finis | `/api/catalogue/familles`, `/modeles`, `/modeles/:id/configuration`, `/specifications`, `/fiche-technique`, `/fiche-technique/:id/ressources` | `Catalogue.tsx`, `components/devis/Configurateur.tsx` | — |
| Stock / matières | `/api/stocks/*`, `/api/bons/*` (bons de sortie, appro) | `Stocks.tsx` | via `produits_shop` |
| Boutique (ERP) | `/api/shop-erp/produits`, `/devis-web`, `/devis/:id/creer-erp` | `Boutique.tsx` | — |
| Boutique (public) | `/api/shop/catalogue`, `/categories`, `/commandes`, `/devis`, `/conditions-paiement` | — | `catalogue/`, `panier/`, `commander/`, `devis/`, `suivi/`, `compte/` |
| Devis | `/api/devis`, `/devis/calculate`, `/devis/:id/statut`, `/envoyer-approbation`, `/transformer-commande`, public `/devis/approuver/:token` | `Devis.tsx`, `DevisPreview.tsx` | formulaire `devis/` |
| Commandes | `/api/commandes`, `/:id/production`, `/:id/timeline`, `/:id/paiements`, public `/api/commandes/public/:ref` | `Commandes.tsx` | `suivi/` |
| Production | `/api/production/jobs`, `/production/historique/:commande_id`, `/projets/*` | `Production.tsx`, `Projets.tsx` | — |
| Équipements | `/api/equipements/*` (+ maintenances) | `Equipements.tsx` | — |
| Achats / fournisseurs | `/api/fournisseurs/*`, bons d'approvisionnement (dans `/bons`) | `Fournisseurs.tsx` | — |
| Finance | factures, versements, crédit, trésorerie, charges (`finance.ts`, `credit.ts`, `paiements.ts`) | `Finance.tsx` | paiement NOKASH |
| RH / Paie, Caisse, Logistique, Rapports, IA, Admin | … | … | — |

## C. Modèles de données existants (pertinents pour ce chantier)

**Catalogue produits finis (utilisé)**
- `familles` (id, nom, **parent_id** → arbre illimité, **type_gamme** NOT NULL, ordre, actif) — 12 familles racines seedées.
- `modeles` (famille_id, reference UNIQUE, designation, description, unite_facturation + `unite_facturation_id`, **type_gamme nullable = surcharge**, actif).
- `modele_specifications` (clé/valeur/unité, pour l'affichage).

**Catalogue V3 Phase 1 (non utilisé par le code)**
- `produit_familles`, `produit_categories`, `produits.categorie_id` — aucune référence dans `apps/` ni `packages/shared`.

**Ingénierie**
- `unites_facturation` (unite, m2, ml, m3, kg, l, h, forfait + `mode_calcul`).
- `fiche_technique` (modele_id, version, statut brouillon/active/archivee — **une seule active par modèle**, mode_calcul).
- `fiche_technique_ressources` (type materiau/main_oeuvre/equipement, ressource_produit_id → `produits`, ressource_equipement_id → `equipements`, quantite_par_unite, cout_unitaire_reference_xaf, temps_reference_h, ordre).
  → C'est **une BOM « à plat » fusionnée avec une gamme opératoire** (MO et machines sont des lignes de la même liste, sans notion d'opération 10/20/30).

**Stock** : `produits` (328 lignes : matières, outils, consommables — `categorie` texte libre : metaux, outils, peinture…), `mouvements_stock`, `bons_sortie(_lignes)`, `bons_approvisionnement(_lignes)`, `fournisseurs`.

**Commercial** : `devis` (+ `source_demande`, `fiche_technique_id`, `config_snapshot`, `ressources_snapshot`), `devis_lignes` (+ `configuration`, `formule_utilisee`, `quantite_calculee`, `cout_calcule_xaf`, ajustement manuel tracé), `commandes` (`devis_id`), `commandes_lignes`, `historique_commandes`, `conditions_paiement`, `remises_bareme`.

**Shop** : `produits_shop` (product_id → **`produits`**, prix_public, images, visible_shop, délai, min_commande), `commandes_shop` (lignes JSONB, erp_commande_id), `demandes_devis_web` (nom, téléphone, description, type_projet, produit_ref, statut, erp_devis_id), `campagnes_produits` (promos).

**Production** : `jobs_production` (numero `OF-…`, commande_id, produit_id, machine_id → `machines`, technicien_id, `ressources_besoin` JSONB figé), `machines`, `equipements` (+ valeur d'achat, maintenance), `projets(_ressources/_membres)`.

**Audit / RBAC** : `audit_log` (générique, middleware), `rbac_audit_logs` (+ enum `audit_action_type` étendu en V3 Phase 5 : `DEVIS_CREATED`, `DEVIS_LIGNE_AJUSTEE`, `DEVIS_CONVERTI_COMMANDE`…), `rbac_roles`, `rbac_permissions`, `rbac_role_permissions`, `rbac_user_profiles`.

## D. API existantes (points d'entrée clés)

| Endpoint | Rôle | Remarque |
|---|---|---|
| `GET /api/catalogue/modeles/:id/configuration` | mode effectif, champs de dimensions, fiche dispo | Protégé `PRODUCTION:READ` — **pas accessible au shop** |
| `POST /api/devis/calculate` | calcul pur, n'écrit rien | Retourne coûts internes |
| `POST /api/devis` | création + snapshot | |
| `POST /api/devis/:id/transformer-commande` | conversion **idempotente** (verrou atomique sur `statut`) | Crée les jobs `OF-<CMD>-NN` |
| `GET /api/commandes/:id/timeline` | suivi client | |
| `GET /api/shop/catalogue(/:id)` | catalogue public (produits stock) | cache 60 s |
| `POST /api/shop/commandes` | commande web **sans auth** | ⚠️ prix client de confiance |
| `POST /api/shop/devis` | demande de devis web | crée un devis ERP brouillon vide |
| `POST /api/shop-erp/devis/:id/creer-erp` | qualification ERP d'une demande web | |

## E. Fonctionnalités déjà disponibles

- Arbre de familles de profondeur libre + modèles + surcharge du mode par modèle.
- Moteur de quantité facturable (quantitatif, surface, linéaire, volume, poids, forfait, qualitatif) **pur et testé**.
- Fiche technique versionnée, une seule active, rattachée au modèle.
- Snapshot au devis (`config_snapshot`, `ressources_snapshot`) et `ressources_besoin` figé sur l'OF.
- Ajustement manuel tracé (valeur calculée / retenue / motif / qui / quand).
- Workflow devis brouillon → envoyé → accepté → transformé (+ refusé/expiré), approbation client par lien tokenisé.
- Conversion devis → commande idempotente, création des OF, timeline, `source_demande` (canaux hors plateforme).
- Panier + checkout + paiement mobile (NOKASH) + suivi SMS côté shop.
- Stock, bons de sortie, approvisionnement, fournisseurs, équipements, facturation/acompte.
- Audit RBAC avec actions devis spécifiques.

## F. Fonctionnalités manquantes (ou incomplètes)

1. **Hiérarchie unique.** Deux systèmes coexistent (voir résumé #2). La hiérarchie cible Catégorie → Famille → Sous-famille est **déjà exprimable** avec l'arbre `familles.parent_id` (niveaux 1/2/3) sans nouvelle table.
2. **Mode commercial typé.** `type_gamme` est une chaîne `catalogue|configuration|sur_mesure` répétée en littéral (SQL CHECK, `pgEnum`, Zod dans `catalogue.ts`). Pas de constante partagée STANDARD/CONFIGURABLE/QUOTE dans `@forge/shared`.
3. **Produit standard fini vendable en ligne** : aucun lien `modeles` ↔ shop, pas de prix de vente sur `modeles`.
4. **Schéma de configuration** : pas de paramètres typés par modèle (bornes min/max, pas, liste de valeurs, options payantes, règle « hors limites → sur devis »). Les `options` sont passées au moteur mais **ignorées dans le calcul**.
5. **Entité Configuration persistée** (`CFG-XXXXX`) indépendante du devis, avec statut valide / invalide / à valider / hors limites.
6. **Coût vs prix** : pas de marge, pas de règles de marge paramétrables, pas de frais indirects, transport, installation, sous-traitance, consommables séparés des matières.
7. **Taux horaires** MO et machine : saisis en dur par ligne de fiche technique (`cout_unitaire_reference_xaf`), pas de référentiel (poste, coût horaire).
8. **Gamme opératoire (routing)** : pas d'opérations ordonnées (10 Découpe, 20 Assemblage…) distinctes de la BOM.
9. **Conversion d'unités** centralisée (mm ↔ m) : les dimensions sont implicitement en mètres.
10. **Demande de devis riche** côté shop : pas de dimensions, localisation, délai, pièces jointes ; statuts `nouvelle/en_cours` seulement.
11. **Configurateur côté shop** : inexistant (il n'existe que dans l'ERP).
12. **Coût réel / écarts** : pas de capture de consommation réelle rapprochée de l'estimé.

## G. Risques de régression

| Risque | Où | Mitigation |
|---|---|---|
| Casser l'ERP web qui lit `type_gamme` littéral | `catalogue.ts`, `useCatalogue.ts`, `Configurateur.tsx` | Garder les valeurs DB, ajouter un **mapping** typé, ne pas renommer la colonne |
| Toucher `produits` (328 lignes) | stock, bons, shop, caisse, fiches techniques | Aucune modification de schéma sur `produits` en Phase 1 |
| Rejouer une migration destructive | `20260519_shop_tables.sql` contient `DROP TABLE … CASCADE` sur `produits_shop`, `commandes_shop`, `demandes_devis_web` | **Ne jamais la rejouer** ; toutes les nouvelles migrations en `IF NOT EXISTS` |
| Corriger le prix shop casse le panier | `lib/cart.ts`, promos `campagnes_produits` | Recalcul serveur à partir de `prix_public` **+ promo active**, tests shop existants à étendre |
| Mirror SQLite hors ligne | `packages/db/src/schema.ts`, `sync.ts` (desktop) | Les tables catalogue ne sont pas synchronisées aujourd'hui ; ne pas les ajouter à la sync sans besoin |
| Tests qui mockent la séquence `.from()` | tous les tests de routes | Ajouter les appels DB **en fin** de handler quand possible ; suivre le pattern `rbacService` mocké (voir `docs/DETTE-TESTS-2026-09-26.md`) |
| 68 fichiers modifiés non commités sur `main` | arbre de travail | Commiter/brancher **avant** la Phase 1 |

## H. Dépendances techniques

```text
@forge/shared (devis-calcul.ts, constants) ──► apps/api ──► apps/web (ERP)
                                              │        └─► apps/shop (via proxy Next /app/api/*)
@forge/db (Drizzle types) ────────────────────┘

familles ─┬─► modeles ─┬─► modele_specifications
          │            ├─► fiche_technique ──► fiche_technique_ressources ─┬─► produits (matières)
          │            │                                                     └─► equipements
          │            └─► devis.config_snapshot / devis_lignes.configuration (JSONB, pas de FK)
produits ─► produits_shop ─► commandes_shop ─► commandes ─► commandes_lignes
demandes_devis_web ─► devis ─► commandes ─► jobs_production (─► machines ≠ equipements !)
                                        └─► factures ─► versements_factures
```

Points d'attention :
- **`machines` vs `equipements`** : la fiche technique référence `equipements`, les OF référencent `machines`. Deux référentiels pour les mêmes postes physiques → à clarifier avant la Phase 5.
- **Deux journaux d'audit** : `audit_log` (middleware générique, body brut) et `rbac_audit_logs` (actions métier typées). **Étendre `rbac_audit_logs` / `audit_action_type`**, ne pas en créer un troisième.

## I. Parties réutilisables telles quelles

- `familles` (arbre) + `modeles` + `resolveTypeGamme()` → **porteurs de la hiérarchie et du mode commercial**.
- `packages/shared/src/devis-calcul.ts` → base du *pricing engine* (quantité facturable, arrondis XAF explicites, résultats `ok/erreurs` typés).
- `fiche_technique` versionnée → base de la BOM.
- Snapshots devis / OF, workflow devis, conversion idempotente, timeline, `source_demande`.
- `requirePermission()` + RBAC DB ; `rbac_audit_logs`.
- Validation d'upload de `finance.ts#uploadJustificatif` (liste blanche MIME) → modèle pour les pièces jointes de demande de devis (à durcir : voir J).
- Panier / checkout / paiement / suivi SMS du shop.

## J. Parties nécessitant une évolution

| Élément | Évolution |
|---|---|
| `type_gamme` | Constante partagée `CommercialMode` + mapping `catalogue→STANDARD`, `configuration→CONFIGURABLE`, `sur_mesure→QUOTE`, exposée dans l'API (`commercial_mode`) |
| `familles` | Rendre le niveau explicite (catégorie/famille/sous-famille) ; le mode sur la famille devient une **valeur par défaut**, le modèle fait foi |
| `modeles` | Prix de vente (STANDARD), visibilité web, images ; lien vers le shop |
| Moteur de calcul | Séparer **coût** (existant) et **prix** (nouveau : marge paramétrable), traiter les options, bornes |
| `POST /api/shop/commandes` | Recalcul serveur des prix et frais de livraison |
| `POST /api/shop/devis` | Champs structurés + pièces jointes ; ne plus créer un devis vide automatiquement (le garder en *demande* jusqu'à qualification) |
| Numérotation | Séquences Postgres (ou table de compteurs + `UPDATE … RETURNING`) au lieu de `count + 1` / aléatoire |
| Upload | Vérifier la signature (magic bytes) et la taille, pas seulement `file.type` déclaré par le client |
| RLS shop | Retirer `produits_shop_write_all` et `commandes_shop_select_public` (l'API passe par `service_role`) |

## K. Parties nécessitant une migration de schéma

| Phase | Migration envisagée (additive, `IF NOT EXISTS`) |
|---|---|
| 1 | Aucune obligatoire si on mappe `type_gamme`. Optionnel : `familles.niveau` (ou vue dérivée) ; commentaire de dépréciation sur `produit_familles`/`produit_categories` (**pas de DROP**) |
| 2 | `modeles` : `prix_vente_xaf`, `visible_web`, `images` — **ou** table `modeles_shop` calquée sur `produits_shop` (décision D1) |
| 3 | `modele_parametres` (clé, type, unité, min, max, pas, valeurs autorisées, obligatoire) ; `modele_options` ; `configurations` (numéro `CFG-`, modele_id, valeurs, statut, snapshot, version) |
| 4 | `regles_marge` (portée : modèle/famille/global, taux, période) ; `taux_horaires` (poste MO / machine) ; `frais_indirects` ; colonnes coût/prix séparées dans les snapshots |
| 5 | `gamme_operations` (fiche_technique_id, n° opération, poste, temps, ressource) ; décision `machines`/`equipements` |
| 6 | `demandes_devis_web` enrichie (dimensions, localisation, délai, statuts étendus) + `demandes_devis_documents` |
| 7-8 | Consommations réelles / coût réel par OF |

Protocole à chaque migration (§38-39) : `SELECT count(*)` avant/après sur chaque table touchée, bloc `DO $$ RAISE NOTICE` de vérification (convention déjà en place), pas de `DROP`.

## L. Plan d'implémentation par phases (adapté à l'existant)

| Phase | Contenu réel (vs brief) | Dépend de |
|---|---|---|
| **0 bis — Sécurité (recommandée avant tout)** | Recalcul serveur des prix shop ; RLS shop ; réf web unique | — |
| **1 — Fondations produits** | `CommercialMode` typé dans `@forge/shared` + mapping `type_gamme` ; `commercial_mode` exposé dans `/catalogue/*` ; niveaux de hiérarchie explicites ; dépréciation documentée de `produit_familles`/`produit_categories` ; tests | Décisions D2, D3 |
| **2 — Standard** | Exposer les modèles STANDARD au shop (catalogue, fiche, prix, dispo, panier, commande), à côté des articles de négoce existants | Phase 0 bis, décision D1 |
| **3 — Configurable (pilote P003)** | Paramètres typés + bornes + options, entité `configurations` `CFG-`, validation (valide / invalide / à valider / hors limites → QUOTE), endpoint public d'estimation **sans coûts internes** | Phase 1 |
| **4 — Cost engine** | Coût vs prix, marge paramétrable, taux horaires, consommables, frais indirects, transport, installation | Décision D4 |
| **5 — BOM + routing** | Opérations ordonnées sur la fiche technique, référentiel machines unifié | Décision D5 |
| **6 — Devis** | Enrichir `demandes_devis_web` (déjà reliée à `devis`) : qualification, pièces jointes, statuts ; **pas de nouveau système de devis** | Phase 3 |
| **7 — Production** | Réutiliser `jobs_production` + `ressources_besoin` ; ajouter la consommation réelle | Phases 4-5 |
| **8 — Contrôle des coûts** | Théorique / estimé / réel / écart, dashboard quand les données sont fiables | Phase 7 |

---

## Tableau de synthèse (STEP 6)

| Fonction | Existant | Partiel | Manquant | Action |
|---|:-:|:-:|:-:|---|
| Catégorie / Famille / Sous-famille | | ✅ (arbre `familles`) | | Expliciter les niveaux, déprécier `produit_familles/categories` |
| Modèle produit | ✅ `modeles` | | | Réutiliser |
| Mode commercial STANDARD/CONFIGURABLE/QUOTE | | ✅ `type_gamme` | | Enum partagé + mapping, pas de nouvelle colonne |
| Catalogue web produits finis | | | ✅ | Relier `modeles` au shop (D1) |
| Catalogue web articles de stock | ✅ `produits_shop` | | | Conserver |
| Fiche produit / prix / dispo | ✅ (stock) | | ✅ (modèles) | Étendre |
| Panier / commande web | ✅ | | | Sécuriser le prix |
| Prix calculé côté serveur (shop) | | | ✅ | **P0** |
| Configurateur ERP | ✅ | | | Réutiliser |
| Configurateur shop | | | ✅ | Phase 3 (P003) |
| Paramètres typés + bornes + options | | | ✅ | Phase 3 |
| Configuration persistée `CFG-` | | ✅ (JSONB dans devis) | | Entité dédiée |
| Hors limites → sur devis | | | ✅ | Phase 3 |
| Quantité facturable (m², ml, m³…) | ✅ | | | Réutiliser |
| Conversion d'unités centralisée | | | ✅ | Phase 3 (mm ↔ m) |
| Coût matières / MO / machines | | ✅ (fiche technique) | | Référentiel taux horaires |
| Consommables séparés | | | ✅ | Phase 4 |
| Sous-traitance, transport, installation | | | ✅ | Phase 4 (structure) |
| Frais indirects paramétrables | | | ✅ | Phase 4 |
| Marge paramétrable / coût ≠ prix | | | ✅ | Phase 4 (D4) |
| BOM versionnée | | ✅ (fiche technique) | | Réutiliser |
| Routing / opérations | | | ✅ | Phase 5 |
| Demande de devis | | ✅ `demandes_devis_web` | | Enrichir (Phase 6) |
| Pièces jointes de demande | | | ✅ | Phase 6 (MIME + magic bytes) |
| Devis → commande idempotent | ✅ | | | Réutiliser |
| Snapshot devis / OF | ✅ | | | Étendre au coût/prix/marge |
| Numérotation unique serveur | | ✅ (`count+1`, aléatoire web) | | Séquences |
| Commande → OF | ✅ `jobs_production` | | | Réutiliser |
| Coût réel / écart | | | ✅ | Phases 7-8 |
| RBAC serveur | ✅ | | | Étendre (voir D6) |
| Permission « voir coûts / marges » | | | ✅ | Phase 4 |
| Audit log | ✅ (×2) | | | Étendre `rbac_audit_logs` |
| Tests API | ✅ 473/473 | | | Base de non-régression |
| Tests E2E navigateur | | | ✅ | À outiller (Phase 2) |

---

## Décisions à valider avant la Phase 1

- **D1 — Où vivent les produits STANDARD fabriqués pour le site ?**
  Recommandation : `modeles` reste la source de vérité ; ajouter une couche « vitrine » (`modeles_shop`, calquée sur `produits_shop`) plutôt que de créer des lignes « Portail P001 » dans `produits` (qui est le stock matières). Le shop affiche alors deux types de STANDARD : *négoce* (article de stock) et *fabriqué* (modèle à prix fixe).
- **D2 — Hiérarchie** : garder l'arbre `familles` (niveau 1 = catégorie, 2 = famille, 3 = sous-famille) et **déprécier sans supprimer** `produit_familles`/`produit_categories` ? (recommandé)
- **D3 — Mode commercial** : conserver les valeurs DB `catalogue/configuration/sur_mesure` et les mapper vers `STANDARD/CONFIGURABLE/QUOTE` dans le code (recommandé : zéro migration de données) — ou migrer les valeurs ?
- **D4 — Nature de `cout_unitaire_reference_xaf`** : est-ce un **coût** (achat / taux interne) ? Si oui, le « devis brut » actuel est un coût de revient et **tous les devis calculés jusqu'ici sont sans marge**. Confirmer, et fixer la politique de marge initiale (globale ? par famille ?).
- **D5 — `machines` vs `equipements`** : un seul référentiel à terme ? (à trancher avant la Phase 5, pas bloquant maintenant)
- **D6 — Rôles** : le brief liste CLIENT/COMMERCIAL/TECHNICIEN/PRODUCTION/ACHATS/DIRECTION/ADMIN ; l'existant a SUPER_ADMIN, MANAGER, COMMERCIAL, CAISSIER, MAGASINIER, FORMATEUR, LIVREUR, READONLY. Recommandation : **ne pas créer de rôles maintenant**, ajouter une permission dédiée à la visibilité des coûts/marges en Phase 4 et l'attribuer aux rôles existants.
- **D7 — Phase 0 bis sécurité** : corriger le prix de confiance du shop et les politiques RLS **avant** la Phase 1 ?

## Décisions validées (27/09/2026)

| Décision | Réponse |
|---|---|
| D1 | Oui : `modeles` source de vérité + vitrine `modeles_shop` (Phase 2) |
| D2 | Oui : arbre `familles` (3 niveaux) ; `produit_familles`/`produit_categories` dépréciés sans suppression |
| D3 | Oui : valeurs `type_gamme` conservées, mappées en `CommercialMode` dans le code |
| D4 | `cout_unitaire_reference_xaf` est un **coût** saisi par l'utilisateur ; la marge sera un **taux saisi par l'utilisateur** (paramétrable, Phase 4) |
| D5, D6 | En attente (non bloquantes avant les Phases 4-5) |
| D7 | Oui : fait (Phase 0 bis) |

## Avancement

| Phase | État | Livrables |
|---|---|---|
| 0 — Audit | ✅ | ce document |
| 0 bis — Sécurité shop | ✅ | prix/frais recalculés serveur, auth optionnelle vendeur, audit `VENTE_PRIX_FORCE`, réf web cryptographique, migration `20260930_shop_securite_prix_rls.sql` |
| 1 — Fondations produits | ✅ | `CommercialMode` ([COMMERCIAL_MODES.md](COMMERCIAL_MODES.md)), hiérarchie 3 niveaux contrôlée, dépréciation documentée, migration `20261001_catalogue_hybride_phase1_hierarchie.sql` (métadonnées seules) |
| 2 — Standard | ✅ | vitrine `modeles_shop`, produits finis STANDARD au panier (fabriqués sur commande), onglet ERP « Produits finis », CAS 1 pilote testé, migration `20261002_catalogue_hybride_phase2_modeles_shop.sql` |
| 2 bis — Promotions et images des produits finis | ✅ | migration `20261003_promotions_produits_finis.sql`, envoi d'images vérifié par signature |
| 3 — Configurable (P003) | ✅ | configurateur site + ERP, statuts valide / à valider / hors limites / invalide, coût ≠ prix avec marge saisie (D4), `CFG-XXXXX` figé, CAS 2 et CAS 3 testés ; migrations `20261004_catalogue_hybride_phase3_configurateur.sql` et `20261005_seed_pilote_portail_p003.sql` |
| 4 — Cost engine | ⏳ | attend validation de la Phase 3 |

**Tests** : sur ce poste, la suite complète sature la mémoire avec le parallélisme par défaut (`heap out of memory`). Il faut la lancer avec `npx vitest run --maxWorkers=2 --minWorkers=1`.

**Reste ouvert après la Phase 0 bis** : la lecture publique de `commandes_shop` (`commandes_shop_select_public`) est encore en place, car la page de suivi du shop et l'ERP web (hooks + Realtime) lisent la table directement. Il faut d'abord faire passer ces lectures par le serveur, puis retirer la politique.

## Préalable Git

L'arbre de travail contient 68 fichiers modifiés non commités sur `main` (dont les corrections de tests qui font passer la suite à 473/473). Avant la Phase 1 : commiter ce travail (ou le mettre de côté), puis créer `feat/catalogue-hybride-phase1` — convention `feat/…` déjà utilisée (`feat/master-prompt-v3-phases-1-4`).
