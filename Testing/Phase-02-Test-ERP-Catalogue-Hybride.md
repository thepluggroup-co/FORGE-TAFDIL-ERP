# ROADMAP DE TEST — PHASE 02 — FORGE ERP TAFDIL

**Périmètre :** livraisons « Catalogue hybride » Phases 1 → 8 (commits `a0af2b0` → `87cf349`, branche `feat/catalogue-hybride-phase1`, PR #8 et #9) et non-régression des circuits existants.
**Contexte :** micro-usine métallurgique, Douala — devise FCFA (XAF).
**Suite de :** `Testing/Phase 01 Test ERP.docx` (fondations, modules historiques). Ce document ne répète pas la Phase 01. Il couvre ce qui a changé et les circuits de bout en bout, **profil par profil**.

> **Règle de lecture.** Chaque « Attendu » est tiré du code (routes API, règles partagées `packages/shared`, migrations), pas d'une spécification. Si le comportement observé diffère, notez **FAIL** et joignez une capture d'écran. Ne « corrigez » pas l'attendu pour qu'il colle au résultat.

---

## 0. Ce qui a changé (synthèse des commits récents)

| Phase | Livraison | Écrans / points d'entrée |
|---|---|---|
| 1 | Modes commerciaux `STANDARD` / `CONFIGURABLE` / `QUOTE`, arbre de familles limité à **3 niveaux**, refus des cycles (422) | ERP → Catalogue |
| 2 | Vente en ligne des **produits finis STANDARD** (fabriqués sur commande), vitrine, promotions, images (type vérifié par signature) | Site → Catalogue/Panier ; ERP → Boutique → *Produits finis* |
| 3 | **Configurateur** client (pilote Portail P003), estimation HT, configuration figée `CFG-XXXXX`, règles de marge | Site → `/configurateur/[id]` ; ERP → Catalogue → *Configurateur*, *Taux de marge* |
| 4 | **Coût de revient complet** : consommables, sous-traitance, frais indirects, transport, installation | ERP → Catalogue → fiche technique, *Frais indirects* ; PDF devis |
| 5 | **Gamme opératoire**, postes de travail et taux horaires, `equipements` = référentiel unique des machines | ERP → Catalogue → *Gamme opératoire*, *Postes & taux* ; Équipements → *Coût horaire* |
| 5 bis | Techniciens des OF = **employés RH** ; réparation `jobs_production.commande_id` / `machine_id` | ERP → Production |
| 6 | **Demandes de devis** structurées (`DEM-XXXXX`), pièces jointes (5 × 10 Mo max, bucket privé), workflow tracé | Site → `/devis` ; ERP → Boutique → *Demandes devis* |
| 7 | L'**OF reprend la gamme figée au devis** (`of_operations`, `of_consommations`), écran « Étapes » | ERP → Production → *Étapes* |
| 8 | **Contrôle des coûts** prévu/réel, marge réelle par commande, indicateurs Production réels | ERP → Production → *Contrôle des coûts* |
| 03/10 | Formulaire devis : liens « Voir la famille … » vers le catalogue ; écran Paramètres de configuration clarifié | Site → `/devis` ; ERP → Catalogue → *Configurateur* |

**Base automatisée constatée le 03/10/2026, sur `87cf349` :**
- `apps/api` : **625 / 625 tests verts** (41 fichiers). La dette décrite dans `docs/DETTE-TESTS-2026-09-26.md` est résorbée.
- `apps/web` : **4 échecs sur 49 tests**. `BonSortie.test.tsx` (×3) cherche le libellé « En attente », qui n'existe plus. `Login.test.tsx` (×1) attend une redirection vers `/production`. Vitest ramasse aussi `e2e/auth.spec.ts`, qui est un test Playwright. Ces échecs ne touchent pas les phases 1 à 8, mais la suite web n'est pas fiable comme filet de sécurité.
- **Aucun test automatisé de bout en bout** ne couvre les circuits ci-dessous. Cette recette manuelle est donc le seul contrôle des enchaînements entre modules.

---

## 1. Profils à tester

### 1.1 Comptes de test à créer

| ID | Rôle legacy (`profiles.role`) | Rôle RBAC effectif | Canal principal | Compte de test |
|---|---|---|---|---|
| **P-ADM** | `admin` (ou `directeur`) | `SUPER_ADMIN` | ERP web / desktop | `test.admin` |
| **P-SUP** | `superviseur` | `MANAGER` | ERP web, mobile | `test.superviseur` |
| **P-OPE** | `operateur` | `COMMERCIAL` | ERP web | `test.operateur` |
| **P-TEC** | `technicien` | `READONLY` | ERP web | `test.technicien` |
| **P-VIEW** | `viewer` | ⚠️ aucun (voir V-04) | ERP web | `test.viewer` |
| **P-CAI** | `caissier` | `CAISSIER` | ERP web, mobile | `test.caissier` |
| **P-LIV** | `livreur` | `LIVREUR` | mobile | `test.livreur` |
| **P-MAG** | *(aucun)* + `rbac_user_profiles` → `MAGASINIER` | `MAGASINIER` | ERP web | `test.magasinier` |
| **P-FOR** | *(aucun)* + `rbac_user_profiles` → `FORMATEUR` | `FORMATEUR` | ERP web | `test.formateur` |
| **C-ANO** | — | client anonyme | site boutique | navigateur privé |
| **C-CLI** | — | client connecté (OTP SMS) | site boutique `/compte` | numéro de test |

Le rôle effectif vient de `rbac_user_profiles` s'il existe. Sinon, l'API applique `LEGACY_ROLE_MAP` (`apps/api/src/services/rbacService.ts`).

### 1.2 Matrice de permissions théorique (d'après les migrations)

Légende : R = READ, C = CREATE, U = UPDATE, D = DELETE, V = VALIDATE, K = CONFIGURE, E = EXPORT.

| Module RBAC | SUPER_ADMIN | MANAGER | COMMERCIAL | READONLY | CAISSIER | LIVREUR | MAGASINIER | FORMATEUR |
|---|---|---|---|---|---|---|---|---|
| COMMERCIAL | tout | tout | R C U V | R | R | — | — | — |
| PRODUCTION | tout | tout | **C U V (pas R)** | R | — | — | — | — |
| STOCK | tout | tout | R C U V | R | R | — | R C U | — |
| LOGISTICS | tout | tout | R C U V E | R | — | R U V E | R C U | — |
| RECEIVABLES | tout | tout | **C (pas R)** | R | R C | — | — | — |
| HR | tout | tout | **C (pas R)** | R | ⛔ | — | — | R C U |
| FINANCE | tout | tout | — | R | ⛔ | — | — | — |
| REPORTS | tout | tout | R | R | — | — | — | R |
| CAISSE | tout | R C U | — | (R ?) | R C U | — | — | — |
| ADMIN | tout | sauf K, D | — | R | — | — | — | — |

⛔ : refus forcé par une règle immuable du code (le caissier n'accède jamais à RH ni à Finance). READONLY ne peut jamais écrire, quelle que soit la base.

> **TEST 0 (obligatoire avant toute autre série).** Les migrations disent elles-mêmes que des droits ont été appliqués « en direct via script » (voir `20260903_rbac_expand_…sql`). La base de production peut donc différer de ce tableau. Exécutez la requête suivante en lecture seule et comparez le résultat au tableau. Tout écart est une anomalie à classer avant de dérouler les profils.
>
> ```sql
> SELECT r.name, p.module, string_agg(p.action, ',' ORDER BY p.action) AS actions
> FROM rbac_roles r
> JOIN rbac_role_permissions rp ON rp.role_id = r.id
> JOIN rbac_permissions p ON p.id = rp.permission_id
> GROUP BY r.name, p.module ORDER BY r.name, p.module;
> ```

### 1.3 Ce que chaque profil doit voir : nouveaux écrans

Ce tableau découle de la matrice ci-dessus et des garde-fous des routes. **OUI** = écran visible et action réussie. **403** = l'API refuse. **masqué** = absent du menu.

| Écran / action | ADM | SUP | OPE | TEC | CAI | LIV | MAG | FOR |
|---|---|---|---|---|---|---|---|---|
| Menu **Catalogue** (`PRODUCTION:R`) | OUI | OUI | **masqué** | OUI (lecture) | masqué | masqué | masqué | masqué |
| Créer / déplacer une famille, un modèle (`PRODUCTION:C/U`) | OUI | OUI | 403 sur la lecture préalable | 403 | — | — | — | — |
| Configurateur ERP : paramètres (`PRODUCTION:U`) | OUI | OUI | idem | 403 | — | — | — | — |
| **Taux de marge**, **Frais indirects** (`COMMERCIAL:K`) | OUI | OUI | 403 | **bouton visible, 403** | — | — | — | — |
| Gamme opératoire, postes et taux (`PRODUCTION:U`) | OUI | OUI | — | 403 | — | — | — | — |
| Menu **Boutique** (`COMMERCIAL:R`) | OUI | OUI | OUI | OUI (lecture) | **OUI (lecture)** | masqué | masqué | masqué |
| Boutique → Produits finis : mise en vente, prix (`COMMERCIAL:U`) | OUI | OUI | OUI | 403 | 403 | — | — | — |
| Boutique → Demandes devis : lecture, pièces jointes | OUI | OUI | OUI | OUI | **OUI** | — | — | — |
| Demandes devis : qualifier, changer le statut, créer le devis | OUI | OUI | OUI | 403 | 403 | — | — | — |
| Menu **Production** (`PRODUCTION:R`) | OUI | OUI | **masqué** | OUI (lecture) | masqué | masqué | masqué | masqué |
| Créer un OF, charger la gamme (`PRODUCTION:C`) | OUI | OUI | API OK, écran absent | 403 | — | — | — | — |
| Étapes : démarrer, terminer, saisir les consommations (`PRODUCTION:U`) | OUI | OUI | API OK, écran absent | **403** | — | — | — | — |
| **Contrôle des coûts**, coût de fabrication (`COMMERCIAL:K`) | OUI | OUI | 403 | carte masquée | — | — | — | — |
| Indicateurs Production | OUI | OUI | — | OUI | — | — | — | — |

---

## 2. Préparation du jeu de données

| Réf. | Donnée | Détail |
|---|---|---|
| D-01 | Arbre catalogue | Catégorie « Construction metallique » → Famille « Portails » → Sous-famille « Portails battants » ; Catégorie « Ferronnerie » ; Catégorie « Outils & Accessoires » |
| D-02 | Modèles STANDARD | 2 produits finis `type_gamme = catalogue` (ex. P001, P002), avec fiche technique active et prix vitrine |
| D-03 | Modèle CONFIGURABLE | Pilote **Portail P003** (migration `20261005`) : largeur 2000–6000 mm, hauteur 1500–2500 mm, ouverture battant/coulissant, couleur noir/blanc/**autre (validation requise)**, motorisation, serrure |
| D-04 | Modèle QUOTE | « Personnalisé », `type_gamme = sur_mesure` |
| D-05 | Fiche technique P003 | Matières + 1 consommable (électrodes, lié au stock) + 1 sous-traitance (galvanisation, délai 5 j) |
| D-06 | Gamme P003 | Op. 10 Découpe (poste Découpeur + Plasma, 0,2 h/m² + 0,5 h) ; Op. 20 Soudage (Soudeur + MIG, 1,5 h/m²) ; Op. 30 Peinture (Peintre, 0,3 h/m² + 1 h) |
| D-07 | Postes et taux | Découpeur, Soudeur, Peintre avec coût horaire ; **un poste volontairement sans taux** pour le test G-05 |
| D-08 | Équipements | Plasma (opérationnel), MIG (opérationnel), 1 équipement **en panne**, 1 **en maintenance**, 1 **hors service** |
| D-09 | Règles de marge | Globale 25 % ; famille « Portails » 30 % ; modèle P003 20 % (pour tester la priorité) |
| D-10 | Frais indirects | 1 règle globale (% du coût direct), 1 règle famille (montant fixe par commande) |
| D-11 | Employés RH | 2 techniciens `actif`, 1 en `essai`, 1 `suspendu` ou en congé |
| D-12 | Stock | Électrodes et tôles avec stock suffisant ; 1 produit négoce STANDARD |
| D-13 | Fichiers | 1 PDF valide < 10 Mo ; 1 JPG ; 1 PDF > 10 Mo ; 1 `.exe` renommé en `.pdf` ; 6 fichiers pour tester la limite de 5 |

---

## 3. Tests unitaires de fonction (par phase)

### 3.1 Phase 1 — Modes commerciaux et hiérarchie (ERP → Catalogue)

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| CAT-01 | Créer une famille de niveau 3 (sous-famille) | ADM | Créée |
| CAT-02 | Créer une famille sous une sous-famille (niveau 4) | ADM | **422 `PROFONDEUR_MAX_DEPASSEE`**, message clair |
| CAT-03 | Déplacer une famille à 2 niveaux sous une famille de niveau 2 | SUP | 422 : la hauteur de la branche déplacée est comptée |
| CAT-04 | Rendre une famille parente de son propre ancêtre | ADM | **422 `CYCLE_HIERARCHIE`** |
| CAT-05 | Parent inexistant (appel API) | ADM | 400, code `23503` |
| CAT-06 | Modèle sans `type_gamme`, famille en `configuration` | ADM | Libellé « Configurable » (hérité) |
| CAT-07 | Modèle `catalogue` dans une famille `configuration` | ADM | Libellé « Standard » : le modèle l'emporte sur la famille |
| CAT-08 | Les libellés ERP affichent Standard / Configurable / Sur devis | TEC | Jamais « catalogue / configuration / sur_mesure » à l'écran |
| CAT-09 | Créer une famille | TEC | 403 |
| CAT-10 | Ouvrir le Catalogue | OPE | Menu absent (voir V-01). Noter le comportement réel |

### 3.2 Phase 2 — Produits finis STANDARD (site et ERP)

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| STD-01 | Boutique → Produits finis : seuls les modèles STANDARD sont listés | SUP | P003 et « Personnalisé » sont absents |
| STD-02 | Mettre en vente sans prix public | OPE | Refusé |
| STD-03 | Changer le prix vitrine | OPE | Enregistré, audit `PRIX_VITRINE_MODIFIE` |
| STD-04 | Site : la fiche d'un produit fini affiche « sur commande » | C-ANO | Pas de stock affiché, `disponibilite: sur_commande` |
| STD-05 | Panier : produit fini sous le minimum de commande | C-ANO | Refusé |
| STD-06 | Commande d'un produit fini | C-ANO | Ligne ERP avec `modele_id`, **aucun bon de sortie**, alerte `production.commande_standard_a_fabriquer` |
| STD-07 | Prix manipulé côté client (requête modifiée) | C-ANO | Le serveur applique `modeles_shop.prix_public` |
| STD-08 | Ligne `modele_id` pointant vers P003 (configurable) | C-ANO **et** ADM | **422 `MODE_NON_STANDARD`**, aussi pour le personnel |
| STD-09 | Promotion sur un produit fini (`campagnes_produits.modele_id`) | OPE | Prix promotionnel visible sur le site |
| STD-10 | Image JPG valide sur un modèle | OPE | Acceptée |
| STD-11 | `.exe` renommé en `.jpg` | OPE | **Refusé** (signature du fichier) |
| STD-12 | Mise en vente d'un produit fini | CAI | 403 |
| STD-13 | Commande d'un produit négoce (non-régression) | C-CLI | Stock plafonné, bon de sortie magasin créé |

### 3.3 Phase 3 — Configurateur (pilote P003)

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| CFG-01 | Site : « Personnaliser » sur P003 | C-ANO | Ouvre `/configurateur/[id]` avec les 8 paramètres |
| CFG-02 | 3000 × 2000 mm, battant, noir → Calculer | C-ANO | Statut `valide`, estimation HT affichée, mention « non contractuelle » |
| CFG-03 | La réponse publique (onglet Réseau) ne contient aucun coût | C-ANO | Ni coût de revient, ni marge, ni coût d'option, ni ressource (§27) |
| CFG-04 | Couleur « autre » | C-ANO | Statut `a_valider`, prix affiché « à confirmer » |
| CFG-05 | Largeur 7000 mm | C-ANO | Statut `hors_limites`, **aucun prix**, orientation vers une demande de devis |
| CFG-06 | Champ obligatoire vide | C-ANO | 422 `invalide`, rien n'est enregistré |
| CFG-07 | Saisie en cm ou en m si le paramètre le prévoit | ADM | Conversion explicite en mètres, même prix qu'en mm |
| CFG-08 | « Demander validation » sur un cas `valide` | C-CLI | Configuration `CFG-XXXXX` figée + devis brouillon dans l'ERP au prix estimé + demande « en chiffrage », source `configurateur` |
| CFG-09 | Modifier une configuration figée (SQL ou API) | ADM | Refusé par le trigger |
| CFG-10 | Priorité des marges : modèle 20 % > famille 30 % > globale 25 % | SUP | Le prix utilise **20 %** ; supprimer la règle modèle → 30 % ; supprimer la règle famille → 25 % |
| CFG-11 | Aucune règle de marge | SUP | Pas de prix automatique |
| CFG-12 | Zone de test ERP du configurateur | SUP | Coût, marge et prix visibles (ERP uniquement) |
| CFG-13 | Écran « Paramètres de configuration » (commit 03/10) | SUP | En-têtes de colonnes Code client / Libellé / Type / Requis ; enregistrement inchangé |
| CFG-14 | Liste des configurations (`COMMERCIAL:R`) | OPE | Lisible |

### 3.4 Phase 4 — Coût de revient complet

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| CR-01 | Ajouter un consommable lié au stock à la fiche | SUP | Compté dans le coût direct |
| CR-02 | Ajouter une sous-traitance (délai 5 j) | SUP | Comptée ; le délai le plus long est remonté |
| CR-03 | Option « forfait par commande » × quantité 3 | SUP | Comptée **une seule fois** |
| CR-04 | Transport et installation | SUP | Hors assiette « coût direct » des frais indirects |
| CR-05 | 2 règles de frais indirects applicables | SUP | **Elles s'additionnent** (la marge, elle, ne retient qu'un taux) |
| CR-06 | Règle hors de sa période de validité | SUP | Ignorée |
| CR-07 | Fiche « style Phase 3 » (sans consommable, sous-traitance ni frais) | SUP | Prix identique à celui de la Phase 3 |
| CR-08 | Cas de référence `cost-engine.test.ts` reproduit à l'écran | SUP | Coût de revient **961 948 FCFA**, prix **1 202 436 FCFA** à 25 % |
| CR-09 | PDF du devis | OPE | Groupes « Consommables » et « Sous-traitance » présents, **aucun coût interne** visible |
| CR-10 | Accès aux Frais indirects | OPE / TEC | 403 |

### 3.5 Phase 5 — Gamme, postes, référentiel équipements

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| G-01 | Saisir la gamme D-06 sur la fiche P003 | SUP | 3 opérations ordonnées 10/20/30 |
| G-02 | Calcul à 13,2 m² (cas `gamme.test.ts`) | SUP | Main-d'œuvre **65 700 FCFA**, machines **39 120 FCFA** |
| G-03 | Temps de préparation pour une quantité de 3 | SUP | Compté **une seule fois** par commande |
| G-04 | Modifier le taux horaire d'un poste | SUP | Audit `TAUX_HORAIRE_MODIFIE` |
| G-05 | Opération sur un poste **sans taux** | SUP / C-ANO | Prix automatique bloqué. Le client lit un message générique ; la zone de test ERP affiche la cause exacte. **Jamais compté à 0** |
| G-06 | Nouvelle version de la fiche | SUP | La gamme est versionnée avec la fiche |
| G-07 | Équipements → anciennes machines migrées | TEC | Codes `MAC-…`, statuts traduits, `ancienne_machine_id` renseigné |
| G-08 | Créer un OF sur l'équipement **en panne**, **en maintenance**, **hors service** | SUP | 422 (`MACHINE_PANNE` / `MACHINE_MAINTENANCE` / `EQUIPEMENT_HORS_SERVICE`) |
| G-09 | Créer un OF avec un ancien `machine_id` (API) | ADM | Résolu automatiquement vers l'équipement |
| G-10 | Liste des techniciens de l'OF | SUP | Employés RH en activité (`actif`, `essai`) ; le suspendu est absent |

### 3.6 Phase 6 — Demandes de devis

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| DEM-01 | Formulaire `/devis` complet (quantité, dimensions, matériau, lieu, délai) + 1 PDF + 1 JPG | C-ANO | Numéro **`DEM-XXXXX`** affiché ; **aucun devis vide** créé dans l'ERP |
| DEM-02 | 6 fichiers | C-ANO | Refusé au-delà de 5 |
| DEM-03 | PDF > 10 Mo | C-ANO | Refusé |
| DEM-04 | `.exe` renommé en `.pdf` | C-ANO | **Refusé** (signature) |
| DEM-05 | Lien « Voir la famille … » après le choix d'un type de projet (commit 03/10) | C-ANO | Mène à `/catalogue?categorie=…` et filtre une catégorie **non vide**. À vérifier pour « Construction metallique », « Ferronnerie » et « Outils & Accessoires » (V-09) |
| DEM-06 | ERP → Demandes devis : filtre par statut | OPE | Fonctionne |
| DEM-07 | Ouvrir une pièce jointe | OPE | Lien signé ; **expiré après 1 h** ; l'URL directe du bucket est refusée (bucket privé) |
| DEM-08 | Transition `nouvelle → en_qualification → infos_requises` sans motif | OPE | **Motif obligatoire** pour « infos requises » et « refusée » |
| DEM-09 | Transition interdite (ex. `nouvelle → acceptee`) | OPE | Bouton absent ; l'API refuse |
| DEM-10 | Qualification (famille, modèle, quantités, notes internes) | OPE | Enregistrée |
| DEM-11 | « Créer le devis » | OPE | Devis brouillon, besoin repris dans les notes, **sans TVA**, demande en « en chiffrage » |
| DEM-12 | Historique de la demande | SUP | Chaque transition avec auteur, date et motif (`demandes_devis_historique`) |
| DEM-13 | Envoyer le devis lié → la demande suit | OPE | `devis_envoye`, puis `acceptee` et `convertie` selon le devis |
| DEM-14 | Demande `convertie`, puis action sur le devis | OPE | Jamais rouverte |
| DEM-15 | Anciens statuts `vue` / `en_cours` / `traitee` en base | SUP | Affichés comme « en qualification » ou « en chiffrage », avec des transitions cohérentes |
| DEM-16 | Changer le statut d'une demande | CAI / TEC | 403 |

### 3.7 Phase 7 — Fabrication d'un OF (Production → Étapes)

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| OF-01 | Commande à une ligne issue d'un devis avec fiche technique | SUP | OF créé **avec la gamme chargée automatiquement** |
| OF-02 | Commande à plusieurs lignes | SUP | Pas de chargement automatique ; chargement manuel possible depuis « Étapes » |
| OF-03 | Charger depuis un modèle (fiche active) et une quantité facturable | SUP | Opérations et consommations créées |
| OF-04 | Recharger une gamme déjà chargée | SUP | **409 `GAMME_DEJA_CHARGEE`** : jamais rechargée |
| OF-05 | Activer une nouvelle version de la fiche **après** le devis | SUP | L'OF garde la version figée au devis |
| OF-06 | Changer un taux horaire après la planification | SUP | Les taux de l'OF ne bougent pas |
| OF-07 | Démarrer une étape sur un OF non lancé | SUP | **422 `OF_NON_LANCE`** |
| OF-08 | Terminer une étape sans temps réel | SUP | **422 `TEMPS_REEL_REQUIS`** |
| OF-09 | Transition interdite (`a_faire → terminee`) | SUP | 422 `INVALID_TRANSITION` + transitions autorisées |
| OF-10 | Affecter un technicien suspendu | SUP | 422 `TECHNICIEN_INDISPONIBLE` |
| OF-11 | Avancement après 2 étapes sur 3 | SUP | **Pondéré par les temps prévus** ; les étapes sautées sont exclues |
| OF-12 | Toutes les étapes terminées | SUP | Avancement 100 %, **statut inchangé** : le passage à « Prêt » reste manuel |
| OF-13 | Lancer un OF | SUP | Plus de 25 % d'avancement fictif |
| OF-14 | Consommation réelle + « sortir du stock », saisie deux fois | SUP | Seul l'écart est mouvementé ; **jamais de double déstockage** |
| OF-15 | Consommation réelle inférieure à ce qui a déjà été déstocké | SUP | Mouvement de **retour** en stock |
| OF-16 | Consommation imprévue | SUP | Ajoutée avec un prévu de 0 |
| OF-17 | OF « Prêt » | SUP | Entrée en stock + **facture créée** (contrôle dans Finance) + commande « prête » ; `date_fin_reelle` exigée |
| OF-18 | Saisie sur un OF clos | SUP | 422 `OF_CLOS` |
| OF-19 | Saisir une étape | **TEC** | **403** (voir V-02) |

### 3.8 Phase 8 — Contrôle des coûts et indicateurs

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| CC-01 | OF en cours | SUP | Colonne « Réel (estimé) » : une étape non terminée compte pour max(temps passé, prévu) ; une consommation non saisie compte pour le prévu |
| CC-02 | OF terminé | SUP | Réel = temps et quantités réels **aux taux figés** |
| CC-03 | Étape avec un taux inconnu | SUP | Exclue des deux côtés et **signalée**, jamais comptée à 0 |
| CC-04 | Marge d'une commande | SUP | Prix HT − (coût réel des OF + coûts hors atelier prévus au devis) |
| CC-05 | Devis manuel sans estimation figée | SUP | Seuls les coûts de fabrication sont comptés, avec un signalement visible |
| CC-06 | Filtre 30 j / 90 j / 12 mois | SUP | Les moins rentables d'abord, totaux et déficitaires |
| CC-07 | Carte « Contrôle des coûts » | TEC | **Masquée** ; appel API direct → 403 |
| CC-08 | Indicateurs : OF en cours / à lancer / en retard | TEC | Cohérents avec la liste des OF |
| CC-09 | Machines actives | TEC | Opérationnelles ÷ en service, hors cédées et hors service |
| CC-10 | Rendement sans étape mesurée | TEC | « — » |
| CC-11 | Anomalies | TEC | OF en retard + machines en panne |

---

## 4. Circuits de bout en bout

Chaque circuit se déroule **d'un seul tenant** avec les profils indiqués à chaque étape. Notez la référence produite à chaque étape (n° de demande, de devis, de commande, d'OF, de facture) : c'est elle qui prouve l'enchaînement.

### E2E-A — STANDARD négoce (non-régression)
`C-CLI` commande un produit négoce (D-12) sur le site → paiement (Mobile Money ou partiel) → `P-OPE` voit la commande web → bon de sortie → `P-SUP` le valide (web ou mobile → *Approbation*) → `P-MAG` prépare → bon exécuté (préparateur assigné et préparation « prête », sinon `PREPARATION_REQUIRED`) → `P-LIV` livre et fait signer sur mobile → `P-CAI` encaisse le solde → facture soldée.
**Vérifier :** stock décrémenté une seule fois, suivi `/suivi/[ref]` cohérent, SMS reçus, aucune étape possible avant la précédente.

### E2E-B — STANDARD produit fini fabriqué sur commande
`P-OPE` met P001 en vitrine (prix) → `C-ANO` commande 2 × P001 → la commande ERP porte `modele_id`, **sans bon de sortie** → alerte production → `P-SUP` crée l'OF, charge la gamme depuis le modèle → lance → étapes → consommations → « Prêt » → facture → `P-LIV` livre → paiement.
**Vérifier :** aucun mouvement de stock produit fini avant « Prêt », marge visible dans Contrôle des coûts (avec la mention « devis sans estimation figée » si la commande ne vient pas d'un devis).

### E2E-C — CONFIGURABLE (circuit complet, cas nominal)
`C-CLI` configure P003 en 3000 × 2000, battant, noir, motorisation → Calculer → Demander validation → `CFG-XXXXX`, devis brouillon et demande « en chiffrage » → `P-OPE` relit le devis (PDF sans coûts internes) → envoi pour approbation → `C-CLI` approuve via le lien → la demande passe « acceptée » → `P-OPE` transforme en commande → la demande passe « convertie » → **OF créé avec la gamme figée** → `P-SUP` lance, affecte des techniciens RH, termine les 3 étapes avec les temps réels, saisit les consommations (sortie de stock) → « Prêt » → facture → livraison → paiement → `P-SUP` ouvre Contrôle des coûts.
**Vérifier :** le prix du devis est égal à l'estimation du site ; la gamme de l'OF correspond à la fiche figée ; la marge réelle est calculable ; une deuxième conversion simultanée du même devis renvoie 409 `ALREADY_TRANSFORMED` sans créer de seconde commande.

### E2E-C2 — CONFIGURABLE à valider
Identique à E2E-C avec la couleur « autre ».
**Vérifier :** le devis brouillon porte la mention « validation requise » ; le prix reste modifiable par `P-OPE` ; un ajustement manuel exige un **motif** (`ajuste_manuellement`).

### E2E-C3 — CONFIGURABLE hors limites → sur devis
P003 en largeur 7000 mm → aucun prix → demande de devis → `P-OPE` qualifie et chiffre à la main → la suite reprend E2E-D à partir de l'étape « devis envoyé ».

### E2E-D — QUOTE / sur mesure avec pièces jointes
`C-ANO` envoie le formulaire `/devis` (« Charpente / Hangar métallique », plan PDF et photo) → `DEM-XXXXX` → `P-OPE` : en qualification → informations requises (motif) → retour en qualification → qualification (famille, modèle « Personnalisé », quantités) → créer le devis (sans TVA) → chiffrer les lignes (bouton « Configurer » ou saisie manuelle) → envoyer → le client accepte → transformer en commande → **OF sans gamme automatique** (pas de fiche) → `P-SUP` charge la gamme depuis un modèle ou travaille sans gamme → fabrication → Prêt → facture → livraison.
**Vérifier :** l'historique de la demande est complet de bout en bout ; les pièces jointes restent accessibles par lien signé pendant tout le cycle ; une demande refusée ou expirée est terminale.

### E2E-E — Paramétrage d'un nouveau produit configurable (de zéro)
`P-SUP` crée la catégorie, la famille et la sous-famille → un modèle CONFIGURABLE → les paramètres (unités, min, max, rôle de calcul) → la fiche technique (matières, consommable, sous-traitance) → la gamme et les taux → la règle de marge → les frais indirects → contrôle dans la zone de test → activation → mise en ligne → `C-ANO` le configure sur le site.
**Vérifier :** sans taux ou sans marge, aucun prix public ; le prix du site est égal à celui de la zone de test.

### E2E-F — Incident machine en cours de fabrication
OF lancé sur Plasma → `P-SUP` passe Plasma « en panne » (Équipements) → création d'un nouvel OF sur Plasma → 422 → indicateurs : anomalies +1, machines actives −1 → maintenance clôturée → équipement réactivé → l'OF reprend.
**Vérifier :** l'OF déjà lancé n'est pas bloqué rétroactivement ; noter le comportement observé, la règle n'est pas spécifiée.

### E2E-G — Parcours mobile (non-régression rôle par rôle)
`P-LIV` : seul l'onglet *Livraisons* est en plus ; signature et bon de livraison. `P-CAI` : onglet *Caisse*. `P-SUP` : *Caisse* et *Approbation* des bons soumis. `P-OPE` / `P-TEC` : pas de *Caisse* ni de *Livraisons*. Vérifier que l'app Capacitor joint l'API (CORS, commit `288cbb7`).

---

## 5. Tests de profil : refus et fuites

| ID | Scénario | Profil | Attendu |
|---|---|---|---|
| RB-01 | Appeler `GET /api/production/couts/synthese` directement | OPE, TEC, CAI | 403 |
| RB-02 | Appeler `PUT /api/catalogue/modeles/:id/parametres` | TEC | 403 (READONLY n'écrit jamais) |
| RB-03 | Appeler `GET /api/shop-erp/devis-web/:id` | LIV, MAG, FOR | 403 |
| RB-04 | Pièce jointe de demande de devis | CAI | Décision métier à prendre (V-03) ; noter le résultat |
| RB-05 | Compte désactivé dans `rbac_user_profiles` | tout profil | Refus à la requête suivante (cache de 5 min maximum, à mesurer) |
| RB-06 | Changer le rôle d'un utilisateur connecté | ADM | Nouvelle permission effective au plus tard 5 min après (cache) |
| RB-07 | Connexion d'un compte `viewer` | VIEW | L'UI le traite en technicien ; l'API refuse tout (V-04). Noter |
| RB-08 | Réponses publiques du configurateur et du catalogue | C-ANO | Aucun coût, aucune marge, aucune ressource interne |
| RB-09 | `/compte` sans session | C-ANO | Redirection vers `/compte/login` |
| RB-10 | Accès à l'Administration | SUP | Menu absent (`ADMIN:CONFIGURE` réservé à SUPER_ADMIN) |

---

## 6. Points de vigilance relevés dans le code

Le code les révèle ; seule la recette tranchera s'il s'agit de bugs ou de choix assumés. Ils sont classés par impact métier attendu.

| Réf. | Constat | Où | Risque | Priorité proposée |
|---|---|---|---|---|
| **V-01** | Le rôle COMMERCIAL (`operateur`) a `PRODUCTION:C/U/V` mais **pas `PRODUCTION:R`**, et `HR:C` / `RECEIVABLES:C` sans lecture. Les menus Catalogue et Production lui sont masqués, et toutes les lectures du catalogue lui renvoient 403 | `20260607_rbac_module.sql`, `20260903_rbac_expand_…sql`, `Sidebar.tsx` | L'opérateur ne peut ni configurer un produit, ni suivre un OF. Il crée sans pouvoir relire | **P1** si l'opérateur doit gérer le catalogue ou la production |
| **V-02** | Le technicien (`READONLY`) **ne peut pas saisir les étapes** de l'écran Étapes, conçu pour l'atelier : la règle immuable interdit toute écriture | `rbacService.ts`, `operations.ts` | Les temps réels seront saisis a posteriori par un superviseur. Le contrôle des coûts (Phase 8) repose alors sur des données de seconde main | **P1, décision métier** |
| **V-03** | Le caissier a `COMMERCIAL:R` (ajouté pour la recherche client). Il voit donc Boutique, Demandes devis (coordonnées, plans, pièces jointes), Devis, Commandes et Clients | `20260903_…sql`, `Sidebar.tsx` | Exposition de données clients au-delà du besoin de caisse | P2 |
| **V-04** | `viewer` est accepté en base et mappé « technicien » par le web, mais **absent du `LEGACY_ROLE_MAP` de l'API** → `NO_RBAC_PROFILE` | `rbacService.ts`, `AuthContext.tsx` | Compte qui voit des menus mais reçoit des erreurs partout | P2 |
| **V-05** | `PATCH /production/jobs/:id/avancement` à 100 % fait **passer l'OF en « Prêt » automatiquement** (et donc déclenche facture et stock), alors que la Phase 7 pose que « Prêt » est une décision explicite. Aucun écran web n'appelle cette route aujourd'hui | `operations.ts` (~l. 1036-1100) | Facturation déclenchée par un appel API ou un futur écran | P2 |
| **V-06** | Les boutons « Taux de marge » et « Frais indirects » ne sont pas masqués selon les droits | `Catalogue.tsx` | Le technicien clique et obtient un 403 brut | P3 |
| **V-07** | La base de production peut différer des migrations (droits appliqués « en direct ») | migrations RBAC | Toute la matrice §1.2 est théorique tant que le TEST 0 n'est pas passé | **Prérequis** |
| **V-08** | Suite web : 4 tests rouges, et un spec Playwright exécuté par Vitest | `apps/web` | La CI web ne protège pas les écrans | P3 |
| **V-09** | Les catégories du formulaire devis sont codées en dur (« Construction metallique », « Ferronnerie », « Outils & Accessoires ») et doivent correspondre aux catégories réelles | `DevisClient.tsx` | Lien vers une catégorie vide | P3 |

---

## 7. Planning et livrables

| Jour | Contenu |
|---|---|
| J1 | TEST 0, création des comptes §1.1, jeu de données §2 |
| J2-J4 | Tests unitaires §3 (Phases 1-8), avec P-ADM et P-SUP d'abord |
| J5 | Matrice §1.3 rejouée **pour chaque profil**, tests de refus §5 |
| J6-J8 | Circuits E2E-A → E2E-G |
| J9 | Arbitrage des points V-01 à V-09, classement des bugs P0-P3 (même grille que la Phase 01) |

**Livrables :** ce document rempli (PASS / FAIL / PARTIEL et n° de référence par ligne), le journal des bugs avec captures, la matrice profils × écrans constatée, et la décision écrite sur V-01, V-02 et V-03.

**Critère de sortie proposé :** aucun P0 ; E2E-C et E2E-D en PASS de bout en bout ; matrice des profils constatée identique à la matrice validée par la direction.
