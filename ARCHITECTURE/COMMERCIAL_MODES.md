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

## 5. Ce qui vient ensuite

- **Phase 2 (STANDARD)** : exposer au site TAFDIL les modèles dont le mode effectif est `STANDARD`, via une vitrine `modeles_shop` calquée sur `produits_shop` (D1).
- **Phase 3 (CONFIGURABLE)** : produit pilote P003 — paramètres bornés ; au-delà des bornes, bascule en `QUOTE`.
