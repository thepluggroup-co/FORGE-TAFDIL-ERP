# Addendum — Catalogue hybride à 3 gammes (Standard / Configurable / Sur devis)

> Complète `docs/MASTER-PROMPT-V3.md` (étend les §7-11 et §40-42, ne les
> remplace pas). Validé par l'utilisateur le 27/09/2026. Source : note de
> cadrage commerciale/industrielle transmise par l'utilisateur, retranscrite
> ici intégralement pour que toute session future y ait accès, suivie de
> l'écart mesuré entre cette vision et l'état réel du code (vérifié, pas
> deviné) et des points laissés ouverts.

---

## 1. Le modèle (résumé opérationnel)

Trois gammes, décidées **au niveau du modèle/produit, jamais au niveau de la
catégorie** (§5 — point le plus important) :

| Gamme | Ce que voit le client | Action client | Traitement FORGE |
|---|---|---|---|
| 🟢 STANDARD | Produit fini, modèle défini | Acheter / commander | Commande directe |
| 🟠 CONFIGURABLE | Produit fini avec options | Configurer puis commander/demander prix | Calcul automatique / validation |
| 🔴 SUR DEVIS | Solution technique personnalisée | Décrire le besoin | Qualification + devis |

Une même famille (ex. Portail) contient des modèles dans les trois gammes à
la fois (Portail P001 = standard, P003 = configurable, "portail
personnalisé" = sur devis). **Ne jamais coder ça comme un enum au niveau
famille/catégorie.**

Coût de fabrication complet visé (au-delà de ce que le moteur calcule
aujourd'hui — voir écart §3 ci-dessous) :

```
MATIÈRES + MAIN-D'ŒUVRE + ÉQUIPEMENTS + CONSOMMABLES + SOUS-TRAITANCE
+ FRAIS INDIRECTS + TRANSPORT + INSTALLATION + MARGE = PRIX DE VENTE
```

Hiérarchie de données visée : CATÉGORIE → FAMILLE → SOUS-FAMILLE → MODÈLE →
TYPE DE GAMME → CONFIGURATION → NOMENCLATURE → RESSOURCES → COÛT DE REVIENT
→ PRIX DE VENTE.

Stratégie de lancement recommandée (validée) : Phase 1 catalogue initial
(20-50 produits STANDARD réels) → Phase 2 Configurateur (produits à forte
répétition) → Phase 3 Devis intelligent (produits complexes) → Phase 4
Industrialisation (données réelles → amélioration des modèles de coût).

Le texte intégral de la note originale reste disponible dans l'historique
de la conversation qui a produit cet addendum ; ce document en retient
l'essentiel opérationnel plus l'écart mesuré avec le code.

---

## 2. Ce qui existe déjà dans FORGE, gamme par gamme (vérifié le 27/09/2026)

| Gamme | État réel |
|---|---|
| 🟢 STANDARD | **Construit et fonctionnel.** `apps/shop` + `POST /api/shop/commandes` (panier plat, paiement MoMo/Orange Money via NOKASH, livraison ou retrait boutique). Schéma : `ligneCommandeSchema` = `{product_id, designation, quantite, prix_unitaire}` — pas de dimensions/config. |
| 🔴 SUR DEVIS | **Existe mais sous-structuré.** `POST /api/shop/devis` capture seulement `{nom, telephone, email, description, type_projet, produit_ref}` — aucun champ structuré (matériau, dimensions, localisation, délai) et **aucun upload de fichier/plan**. |
| 🟠 CONFIGURABLE | **Moteur construit, jamais exposé au client.** `POST /api/devis/calculate` (§13/§35 du Master Prompt) calcule dimensions→quantité facturable→ressources→coût. Câblé pour la première fois le 26/09 dans une UI, mais **uniquement côté admin** (`apps/web/src/pages/Devis.tsx` + `apps/web/src/components/devis/Configurateur.tsx`). Rien dans `apps/shop`. |

**Le trou structurel le plus important** : aucun champ "mode de
commercialisation" (standard / configurable / sur_devis) n'existe nulle
part dans `packages/db/src/schema.pg.ts`. Ni sur `produits`, ni ailleurs.
C'est le préalable technique à tout le reste de cet addendum.

---

## 3. Écarts et points laissés ouverts (à trancher avant/pendant l'implémentation, pas après)

1. **Règle de marge non spécifiée.** La note dit "selon les règles
   commerciales" sans donner de règle. Ça touche directement le Master
   Prompt V3 §19 (le devis est une "valeur brute", TVA=0/remise=0 pendant
   son calcul) : où s'insère la marge ? Si elle s'ajoute au niveau devis
   (ce qui semble être l'intention — "coût de revient → marge → prix
   client"), il faut le faire *à côté* du calcul brut existant (un champ
   distinct, jamais mélangé aux totaux `devis_lignes` bruts), pas en le
   polluant. **Ne pas coder de pourcentage de marge en dur** — en faire un
   paramètre configurable (par famille ? par client ? fixe ?) et le
   demander explicitement à l'utilisateur avant d'implémenter cette partie.
2. **Maintenance des nomenclatures = risque opérationnel réel, pas
   seulement technique.** Un configurateur n'est fiable que si les
   `fiche_technique_ressources` sont à jour. Prévoir dans l'écran Admin
   Devis (ou un écran dédié fiche technique) un moyen simple de les
   maintenir — ne pas supposer que la donnée restera juste indéfiniment.
3. **"Passage automatique en sur devis" hors plages prévues** (note §3,
   fin) : fonctionnalité désirable mais coûteuse (validation de plages sur
   chaque modèle configurable + repli UX gracieux). **Reporté après le
   MVP** — voir plan de phases ci-dessous, ce n'est pas dans la Phase 1/2.
4. Le coût de fabrication complet (frais indirects, transport, installation,
   sous-traitance) n'est PAS dans le moteur actuel
   (`packages/shared/src/devis-calcul.ts` ne connaît que
   matériau/main_oeuvre/equipement). Extension à faire, en gardant les
   totaux actuels intacts (compatibilité §46) et en ajoutant ces postes
   comme des lignes supplémentaires optionnelles, pas en modifiant la
   signature du moteur existant sans y réfléchir.

---

## 4. Plan d'intégration progressif (voir prompt de reprise associé)

Voir la séquence de phases donnée dans le prompt Claude Code de reprise
(section "Ce qu'il faut faire, dans l'ordre" du message de handoff du
27/09/2026). Résumé :

**Phase A — Fondation schéma (non destructive)**
Ajouter `mode_commercialisation` (enum : `standard` | `configurable` |
`sur_devis`) sur `produits`, nullable au départ, avec une migration de
compatibilité. Ne rien casser de l'existant (§4.2/§45/§46 du Master
Prompt V3). Classifier les produits existants (script de données, pas de
code applicatif).

**Phase B — Gamme SUR DEVIS structurée (le gap le plus facile, forte
valeur immédiate)**
Étendre `devisWebSchema`/`POST /api/shop/devis` avec les champs structurés
de la note (matériau, dimensions, localisation, délai) + upload de
fichier/plan (vérifier d'abord s'il existe déjà un mécanisme d'upload
réutilisable ailleurs dans le repo — sinon, poser la question à
l'utilisateur avant d'en construire un nouveau).

**Phase C — Gamme CONFIGURABLE côté client**
Exposer `POST /api/devis/calculate` dans `apps/shop` pour les produits
`mode_commercialisation = configurable`. Réutilise le moteur déjà testé
(§47 Tests 1-9) — ne pas le réécrire. Décision à prendre avec
l'utilisateur : "Ajouter au panier" (crée directement une commande/un
devis pré-rempli) vs "Demander validation" (crée un devis en attente de
validation commerciale) — la note propose les deux boutons, à confirmer
lequel est prioritaire pour le MVP.

**Phase D — Coût de revient complet + marge**
Seulement après que la règle de marge (point 1 ci-dessus) est tranchée
avec l'utilisateur. Étendre le moteur de calcul avec les postes manquants
sans casser les totaux existants.

**Phase E — Industrialisation**
Hors scope immédiat — à ne considérer qu'une fois les phases A-D en
production et alimentées par des données réelles.
