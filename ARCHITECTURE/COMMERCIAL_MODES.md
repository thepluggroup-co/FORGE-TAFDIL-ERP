# Modes commerciaux et hiérarchie du catalogue

> Catalogue Hybride — Phase 1 (fondations produits). Décisions D2 et D3 de
> [TAFDIL_FORGE_AUDIT.md](TAFDIL_FORGE_AUDIT.md).
> Code de référence : [packages/shared/src/catalogue-commercial.ts](../packages/shared/src/catalogue-commercial.ts).

## 1. Les trois modes

| Mode (code) | Valeur en base (`type_gamme`) | Libellé ERP | Action proposée au client |
|---|---|---|---|
| `STANDARD` | `catalogue` | Standard | Acheter |
| `CONFIGURABLE` | `configuration` | Configurable | Personnaliser |
| `QUOTE` | `sur_mesure` | Sur devis | Demander un devis |

- **En base**, rien ne change : les colonnes `familles.type_gamme` et `modeles.type_gamme` gardent leurs valeurs (D3, aucune migration de données).
- **Dans le code**, on manipule `CommercialMode.STANDARD` / `CONFIGURABLE` / `QUOTE`, jamais de chaîne littérale. La conversion passe par `modeCommercialDepuisTypeGamme()` / `typeGammeDepuisModeCommercial()`.

## 2. Où vit le mode : sur le modèle

```text
Portail (famille, défaut = CONFIGURABLE)
├── P001  type_gamme = catalogue     → STANDARD
├── P002  type_gamme = catalogue     → STANDARD
├── P003  type_gamme = NULL          → CONFIGURABLE (hérité)
└── Personnalisé  type_gamme = sur_mesure → QUOTE
```

Règle : `mode effectif = mode du modèle ?? mode de la famille` (`resoudreModeCommercial()`).
La famille ne fournit qu'une **valeur par défaut**.

## 3. Hiérarchie

`familles` est un arbre (`parent_id`) limité à **3 niveaux** :

| Profondeur | Niveau |
|---|---|
| 1 (racine) | Catégorie |
| 2 | Famille |
| 3 | Sous-famille |

- Un modèle peut se rattacher à n'importe quel niveau.
- L'API refuse en **422** la création ou le déplacement d'une famille qui :
  - dépasserait 3 niveaux (`PROFONDEUR_MAX_DEPASSEE`) — la hauteur de la branche déplacée est comptée ;
  - créerait un cycle (`CYCLE_HIERARCHIE`).
- Un parent inexistant reste signalé par la base (contrainte FK, `400` code `23503`).
- Les familles déjà trop profondes en production ne sont pas bloquées en lecture ; la migration `20261001` les compte pour qu'on les reclasse à la main.

**Déprécié (D2)** : `produit_familles`, `produit_categories`, `produits.categorie_id` (Master Prompt V3, jamais utilisés). Ils sont conservés, sans suppression ; aucun nouveau code ne doit s'y brancher.

## 4. API

Tous les ajouts sont additifs ; les champs existants ne changent pas.

| Endpoint | Ajout |
|---|---|
| `GET /api/catalogue/familles` | `commercial_mode` sur chaque famille |
| `GET /api/catalogue/modeles` | `commercial_mode_effectif` (à côté de `type_gamme_effectif`) |
| `GET /api/catalogue/modeles/:id/configuration` | `modele.commercial_mode_effectif` |
| `POST /api/catalogue/familles`, `PUT /api/catalogue/familles/:id` | contrôle profondeur / cycle (422) |

Les écritures continuent d'accepter `type_gamme` (`catalogue` / `configuration` / `sur_mesure`).

## 5. Parcours STANDARD (Phase 2)

Deux sortes d'articles STANDARD cohabitent sur le site (`type_article`) :

| `type_article` | Source | Vitrine | Stock | Commande |
|---|---|---|---|---|
| `produit` | `produits` (stock / négoce) | `produits_shop` | plafonné par `stock_actuel`, bon de sortie magasin | `product_id` |
| `modele` | `modeles` (produit fini) | `modeles_shop` | **fabriqué sur commande** (`stock_actuel: null`, `disponibilite: 'sur_commande'`) | `modele_id` |

Règles serveur pour une ligne `modele_id` (`POST /api/shop/commandes`) :
- le modèle doit être actif et de mode effectif `STANDARD`, sinon `422 MODE_NON_STANDARD` ; cette règle vaut **aussi pour le personnel** : un modèle configurable ou sur devis ne passe jamais par le panier ;
- client anonyme : le modèle doit être en vitrine, avec un prix public > 0 et un minimum de commande respecté ; le prix appliqué est celui de `modeles_shop.prix_public` ;
- aucun bon de sortie n'est créé ; une alerte `production.commande_standard_a_fabriquer` est envoyée ; la ligne ERP porte `commandes_lignes.modele_id`.

Gestion ERP : onglet **Boutique → Produits finis**, qui appelle `GET /api/shop-erp/modeles` et `PUT /api/shop-erp/modeles/:id/vitrine`. Seuls les modèles STANDARD y figurent. La mise en vente exige un prix, et chaque changement de prix est tracé (`PRIX_VITRINE_MODIFIE`).

Pas encore couvert : les promotions sur les produits finis (les campagnes ciblent `produits`) et l'envoi d'images pour un modèle depuis l'ERP (l'API accepte des URL).

Les promotions (`campagnes_produits.modele_id`) et les images (`POST /api/shop-erp/modeles/:id/images`, dont le type est vérifié par la signature du fichier) couvrent désormais aussi les produits finis.

## 6. Parcours CONFIGURABLE (Phase 3, pilote Portail P003)

```text
Site : Personnaliser → /configurateur/[id] → Calculer (estimation HT, non contractuelle)
     → Demander validation → configuration CFG-XXXXX figée + devis brouillon (ERP)
     → hors limites : aucun prix, demande de devis (demandes_devis_web + devis brouillon)
```

| Statut | Signification | Prix automatique | Suite |
|---|---|---|---|
| `valide` | dans les limites | oui (si fiche technique + marge) | devis brouillon au prix estimé |
| `a_valider` | un choix exige un avis humain (ex. couleur « autre ») | oui, à confirmer | devis brouillon + mention « validation requise » |
| `hors_limites` | dimension hors de la gamme fabricable | **non** | demande de devis |
| `invalide` | champ manquant ou erroné | non | rien n'est enregistré (422) |

**Coût ≠ prix (§13, D4)** :
- coût de revient = fiche technique active (matériaux + main-d'œuvre + équipements) + options × quantité ;
- prix unitaire HT = arrondi(coût unitaire × (1 + taux)) ;
- le taux vient de `regles_marge`, avec la priorité modèle > famille la plus proche > global. Sans taux, pas de prix automatique.

**Ce que le client ne voit jamais (§27)** : le coût de revient, la marge, les coûts d'options et les ressources. Les réponses publiques sont testées pour ne contenir aucun de ces termes.

**Figé (§11/§25)** : `configurations` conserve la saisie, le schéma appliqué et le détail interne de l'estimation. Un trigger refuse toute modification ultérieure.

**Unités (§44)** : les dimensions sont saisies en mm, cm ou m selon le paramètre, puis converties explicitement en mètres pour le moteur.

**ERP** :
- Catalogue → bouton « Configurateur » sur un modèle configurable : champs, limites et coûts d'options, avec une zone de test qui montre coût, marge et prix ;
- Catalogue → « Taux de marge » ;
- Boutique → Produits finis : mise en ligne sans prix public.

**API** :
- publique : `GET /api/shop/configurateur/:id`, `POST …/estimer`, `POST …/demande` ;
- interne : `GET|PUT /api/catalogue/modeles/:id/parametres`, `POST /api/catalogue/modeles/:id/estimer`, `GET|POST|DELETE /api/catalogue/regles-marge`, `GET /api/catalogue/configurations`.

**Reporté** : le bouton « Ajouter au panier » pour un produit configurable. Une estimation n'est pas contractuelle (§49), elle passe donc d'abord par la validation d'un conseiller.

## 7. Coût de revient complet (Phase 4)

```text
COÛT DIRECT     = matières + consommables + main-d'œuvre + équipements + sous-traitance   (fiche technique)
                + options                                                                   (configurateur)
FRAIS INDIRECTS = Σ règles applicables (sur leur assiette)
COÛT DE REVIENT = coût direct + frais indirects + transport + installation
PRIX DE VENTE   = coût de revient × (1 + marge)          — arrondi XAF à l'unité, par pièce
```

| Poste | Où le saisir | Assiette |
|---|---|---|
| Matières, main-d'œuvre, équipements | fiche technique | par unité facturable (m², ml…) |
| **Consommables** (électrodes, disques, gaz…) | fiche technique, type « Consommable », lié au stock | idem |
| **Sous-traitance** (galvanisation, découpe laser…) | fiche technique, type « Sous-traitance » + sous-traitant + délai | idem ; le délai le plus long est remonté |
| Options produit | configurateur, nature « Option » | par unité commandée, ou forfait par commande |
| **Transport**, **installation** | configurateur, nature « Transport » / « Installation » | idem (ex. zone de livraison = forfait par commande) |
| **Frais indirects** | Catalogue → « Frais indirects » | % du coût direct, de la main-d'œuvre ou des matières + consommables ; ou montant fixe par unité / par commande |

**Frais indirects** : ils ont un centre de coût, une période de validité et une portée (global, famille, modèle). Toutes les règles applicables **s'additionnent**, alors que la marge ne retient qu'un seul taux. Le transport et l'installation n'entrent pas dans l'assiette « coût direct ».

**Rétrocompatibilité** : une fiche technique sans consommable ni sous-traitance, sans frais indirects et dont les options sont de nature « option », donne exactement le même prix qu'en Phase 3 (c'est testé).

**Cas connu** (`cost-engine.test.ts`) : coût de revient 961 948 FCFA, prix de vente 1 202 436 FCFA avec une marge de 25 %.

**Pas encore couvert** :
- le PDF de devis n'affiche pas encore les groupes « Consommables » et « Sous-traitance », car le fichier est en cours de refonte en parallèle (voir ci-dessous) ;
- le référentiel de taux horaires par poste ou machine sera fait avec la gamme opératoire (Phase 5).

## 8. Ce qui vient ensuite

- **Phase 5 (BOM + routing)** : opérations ordonnées (10 Découpe, 20 Assemblage…), postes et machines avec leur taux horaire, référentiel unique `machines` / `equipements` (décision D5 à trancher).
- **PDF de devis** : à étendre aux nouveaux types quand la refonte en cours de `pdf.service.ts` sera commitée.
