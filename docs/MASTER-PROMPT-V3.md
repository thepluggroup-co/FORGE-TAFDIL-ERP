# MASTER PROMPT V3 — FORGE TAFDIL ERP : moteur intelligent de devis, configuration & production

> Spécification de référence de l'évolution en cours de FORGE. Sauvegardée ici le
> 26/09/2026 pour qu'elle reste accessible à toute session future (elle n'existait
> jusque-là que comme pièce jointe d'une conversation, donc invisible depuis
> VS Code / un nouveau clone). **Légèrement tronquée** : la fin de la section 49
> (Acceptance Criteria, à partir d'AC05) n'a pas pu être récupérée intégralement —
> à compléter si le document source original est retrouvé.

---

## 0. MISSION

Tu es un Senior Full-Stack Architect + ERP Engineer + PostgreSQL/Supabase Engineer + Business Process Analyst + QA Engineer.

Tu travailles directement sur le dépôt GitHub : `thepluggroup-co/FORGE-TAFDIL-ERP`.

Objectif : « Faire évoluer FORGE afin qu'il puisse transformer une demande client en un devis techniquement calculé, puis transmettre automatiquement les données nécessaires à la commande, la facturation, le paiement, l'approvisionnement, la production et la livraison. »

Le système doit devenir un véritable moteur de calcul métier pour TAFDIL, et non simplement un ERP CRUD.

---

## 1. RÈGLE MÉTIER ABSOLUE — À NE PAS VIOLER

**IMPORTANT : « DÉBIT » = « DEVIS »**

Dans le vocabulaire utilisé par le promoteur TAFDIL dans le brief, « DÉBIT signifie DEVIS ».

Il ne faut donc :
- NI créer une table "debits"
- NI créer "debit_lignes"
- NI créer un module "/debits"
- NI créer une API "/debits"
- NI créer un domaine métier séparé "Debit"

Le domaine technique doit rester : `devis`, `devis_lignes`.

Toute mention de « débit » dans le brief doit être interprétée comme le devis TAFDIL.

Le devis est distinct de : commande, facture, paiement, production, livraison.

---

## 2. SOURCE MÉTIER À RESPECTER

Le devis doit déterminer, pour chaque ouvrage ou produit : MATÉRIAUX, MAIN-D'ŒUVRE, ÉQUIPEMENTS — avec unité, quantité, valeur, valeur totale.

Le devis constitue la valeur brute du travail demandé. La TVA et la remise ne doivent pas intervenir dans le calcul brut du devis.

Après validation du devis par le client :
DEVIS → COMMANDE → CONDITIONS DE COMMANDE → FACTURE → TVA / REMISE / AUTRES → PAIEMENT / ACOMPTE → LANCEMENT PRODUCTION

Le système doit fonctionner pour : clients utilisant la plateforme, clients WhatsApp, clients téléphone, clients boutique, clients bureau, clients non connectés — toutes ces origines convergent vers le même processus interne Forge.

---

## 3. OBJECTIF ARCHITECTURAL

```
CATALOGUE
  ↓ FAMILLE / CATÉGORIE
  ↓ MODÈLE / RÉFÉRENCE
  ↓ CONFIGURATION (dimensions, quantité, options, unité de facturation)
  ↓ MOTEUR DE CALCUL
  ↓ RESSOURCES (matériaux, main-d'œuvre, équipements)
  ↓ DEVIS BRUT
  ↓ VALIDATION CLIENT
  ↓ COMMANDE
  ↓ FACTURE (TVA, remise, autres frais)
  ↓ PAIEMENT / ACOMPTE
  ↓ PRODUCTION
  ↓ STOCK / APPROVISIONNEMENT / MACHINES
  ↓ LIVRAISON
  ↓ SUIVI CLIENT
```

---

## 4. PRINCIPES DE DÉVELOPPEMENT

### 4.1 Ne pas réécrire Forge

Réutiliser et étendre les domaines existants : produits, devis, devis_lignes, commandes, commandes_lignes, factures, factures_lignes, versements_factures, mouvements_stock, bons_sortie, bons_sortie_lignes, bons_approvisionnement, bons_approvisionnement_lignes, machines, jobs_production, livraisons, clients, fournisseurs, conditions_paiement. **Ne pas recréer ces domaines.**

### 4.2 Ne pas casser l'existant

Avant toute modification : (1) inspecter le repo, (2) identifier les relations existantes, (3) identifier les API existantes, (4) identifier les composants UI existants, (5) identifier les migrations existantes, (6) identifier les tests existants, (7) établir une carte de dépendances.

Ne supprimer aucune colonne/table existante sans démontrer qu'elle est inutilisée et sans migration de compatibilité.

---

## 5. INSPECTION OBLIGATOIRE AVANT CODAGE

Avant d'écrire du code, analyser au minimum : `packages/db/src/schema.pg.ts`, `packages/db/`, `supabase/migrations/`, `apps/api/`, `apps/web/`, `apps/shop/`, `apps/mobile/`, `apps/desktop/`.

Ne pas commencer les migrations avant cette inspection.

---

## 6. ÉTAT ACTUEL À PRÉSERVER

`produits` (unite, prix_unitaire_xaf), `devis`/`devis_lignes` avec `categorie` = materiaux / main_oeuvre / equipement / autre. Le modèle existant de "devis_lignes" doit être conservé comme compatibilité de base — enrichi, pas remplacé.

---

## 7-10. NOUVEAU MODÈLE PRODUIT, GAMME, UNITÉS

Catalogue : FAMILLE → CATÉGORIE → MODÈLE → VARIANTE/CONFIGURATION. Ne pas créer un produit distinct par dimension (mauvais : "Porte 80x200", "Porte 90x200"... ; bon : un modèle "PM-01" avec des paramètres largeur/hauteur/épaisseur/quantité/options).

Unités de facturation à gérer au minimum : unité, m², mètre linéaire, m³, kg, litre, heure, forfait, qualitatif, quantitatif — via un mécanisme centralisé, pas codées en dur. Distinguer conceptuellement unité de vente / facturation / stock / production (ex. peinture : toutes en litre ; barrière : facturation et production en m²).

---

## 11-16. CONFIGURATION & MOTEUR DE CALCUL

Structure de configuration flexible : `{ largeur, hauteur, longueur, epaisseur, diametre, poids, quantite, options }`.

Formules minimales : QUANTITATIF (saisie), MÈTRE CARRÉ (largeur×hauteur), MÈTRE LINÉAIRE, MÈTRE CUBE (L×l×h), POIDS, FORFAIT (quantité=1), QUALITATIF.

Service métier indépendant : `QuoteCalculationEngine` / `DevisCalculationService` — jamais la logique de calcul dans les composants React.

Input : `{ productModelId, quantity, dimensions, options, calculationMode }`.

Processus : charger modèle → charger unité de facturation → charger formule → calculer quantité facturable → charger fiche technique active → charger ressources → calculer matériaux → calculer main-d'œuvre → calculer équipements → calculer coûts → retourner proposition de devis.

`fiche_technique` liée au modèle, versionnée (une nouvelle version ne modifie pas rétroactivement les anciens devis). `fiche_technique_ressources` : id, fiche_technique_id, type (materiau/main_oeuvre/equipement), ressource_id, designation, unite, quantite_par_unite, cout_unitaire_reference, temps_reference, ordre, actif.

Exemple de calcul (Barrière B-01, m², largeur=3, hauteur=1.8, quantité=2) : surface unitaire 5.4 m², surface totale 10.8 m² ; si fiche technique acier=4kg/m², peinture=0.2L/m², MO=0.8h/m², machine=0.3h/m² → acier=43.2kg, peinture=2.16L, MO=8.64h, machine=3.24h.

---

## 17-19. DÉTAIL DU DEVIS, AJUSTEMENT MANUEL, DEVIS BRUT

Le devis affiche : PRODUIT/MODÈLE/CONFIGURATION/QUANTITÉ FACTURABLE/UNITÉ puis MATÉRIAUX/MAIN-D'ŒUVRE/ÉQUIPEMENTS (désignation, unité, quantité, coût unitaire, total par ligne).

Le système produit `quantité calculée`/`coût calculé` mais permet `quantité retenue`/`coût retenu`, avec `ajuste_manuellement`, `ajuste_par`, `ajuste_le`, `motif_ajustement`. Toute modification significative doit être traçable.

Le devis est la VALEUR BRUTE DU TRAVAIL : pendant son calcul, TVA=0 et remise=0/non appliquée. Si les champs historiques `remiseGlobaleXaf`/`tvaXaf`/`totalTtcXaf`/`netAPayerXaf` sont utilisés, conserver leur compatibilité mais adapter le workflow pour qu'ils ne polluent pas le calcul métier du devis brut.

---

## 20-21. FACTURE & SNAPSHOT

La facture reste distincte : DEVIS → COMMANDE → FACTURE. La facture applique TVA/remise/frais/conditions de paiement/acompte/solde. **Ne jamais calculer la facture en modifiant le devis original.**

Snapshot obligatoire à la validation du devis : la fiche technique peut changer demain, un devis validé aujourd'hui doit conserver le calcul réalisé aujourd'hui (une future version de fiche technique ne doit jamais modifier rétroactivement un devis/commande déjà créé).

---

## 22-23. WORKFLOW DES STATUTS & VALIDATION CLIENT

Workflow cible : brouillon → envoye → accepte → transforme, avec possibilités refuse/expire. Si "calcule" n'est pas nécessaire dans le système actuel, ne pas l'ajouter artificiellement.

À la validation client : `devis.statut = accepte` puis `commande créée` avec `commande.devis_id = devis.id`. **Le système doit empêcher une double conversion.**

---

## 24-31. COMMANDE → FACTURATION → PRODUCTION → STOCK → ÉQUIPEMENTS → MAIN-D'ŒUVRE → SUIVI CLIENT

La commande récupère client/devis/produits/quantités/configuration/montants, et permet conditions de paiement/modalités de livraison/visite de chantier/notes/délai — **ne jamais faire ressaisir des données déjà calculées**.

Facturation : une fois les conditions de commande validées, générer la facture à partir du montant devis/commande, puis appliquer TVA/remise/autres frais.

Acompte : facture → paiement → confirmation acompte → autorisation lancement production. Réutiliser `versements_factures`/`conditions_paiement` — pas de système de paiement parallèle.

Production : commande → job production, récupérant produit/configuration/quantité/ressources/main-d'œuvre/équipements/matériaux.

Stock : pour chaque matériau calculé, besoin → stock disponible ? Oui → bon de sortie → atelier. Non → quantité manquante → approvisionnement → fournisseur → réception → atelier. Réutiliser `bons_sortie`, `bons_sortie_lignes`, `mouvements_stock`, `bons_approvisionnement`, `bons_approvisionnement_lignes`, `fournisseurs`.

Équipements/machines : pas des consommables — réutiliser `machines`/`jobs_production`. Le moteur de devis calcule machine/temps d'utilisation/coût imputé ; l'amortissement comptable reste séparé.

Main-d'œuvre : fiche technique indique type/temps/coût horaire/coût total ; le job de production affecte technicien/équipe/machine/temps. Réutiliser les structures RH existantes.

Suivi client (timeline) : Demande reçue → Devis en préparation → Devis envoyé → Devis validé → Commande confirmée → Acompte reçu → Production lancée → Production en cours → Production terminée → Livraison en préparation → Livré. Alimentée par les événements métier réels, pas un deuxième statut parallèle.

---

## 32-33. CLIENTS HORS PLATEFORME / NON CONNECTÉS

Le client n'a pas besoin d'être connecté pour exister dans Forge. Canaux possibles : web, mobile, WhatsApp, téléphone, boutique, bureau, commercial. Champ `source_demande` (valeurs extensibles) pour tracer la provenance.

Un client non connecté doit pouvoir recevoir SMS/lien de suivi/référence commande sans logique métier parallèle — les SMS sont une interface de communication, pas un deuxième ERP.

---

## 34-39. API, SERVICE LAYER, TRANSACTIONNALITÉ, IDEMPOTENCE, AUTORISATIONS, AUDIT

API minimale logique (étendre l'existant, ne pas dupliquer) :
```
GET    /products/:id/configuration
POST   /devis/calculate
POST   /devis
GET    /devis/:id
PATCH  /devis/:id
POST   /devis/:id/send
POST   /devis/:id/accept
POST   /devis/:id/convert-to-order
GET    /commandes/:id/production
GET    /commandes/:id/timeline
```

Le calcul doit vivre dans un service métier testable, indépendant de React/UI, déterministe, réutilisable web/mobile/API.

Transactionnalité requise pour : acceptation devis→création commande, commande→création facture, lancement production→création job, préparation matériaux→bon de sortie. Éviter les états partiellement créés.

**Idempotence requise** pour : convertir devis, générer commande, générer facture, créer job production — un double clic ne doit jamais créer deux commandes/factures.

Rôles : admin (tout), superviseur (validation/supervision), operateur (création/modification devis selon droits), atelier (accès données production). **Ne jamais faire confiance uniquement au frontend pour les autorisations.**

Audit : qui/quoi/quand/ancienne valeur/nouvelle valeur/motif — priorité devis/prix/quantités/ajustements/validation/conversion commande/facture/lancement production.

---

## 40. UI — CONFIGURATEUR PRODUIT

Choisir le modèle → Saisir dimensions → Saisir quantité → Choisir options → Calculer. Afficher immédiatement unité de facturation + quantité calculée, puis "Voir le détail technique".

## 41. UI — ADMIN DEVIS

L'écran devis doit comporter :
- **A. Informations client** : Client, Téléphone, Canal
- **B. Produit** : Famille, Catégorie, Modèle, Référence
- **C. Configuration** : Dimensions, Quantité, Options
- **D. Calcul** : Quantité facturable, Unité, Formule
- **E. Ressources** : MATÉRIAUX, MAIN-D'ŒUVRE, ÉQUIPEMENTS
- **F. Ajustement manuel** : Valeur calculée, Valeur retenue, Motif
- **G. Total** : MONTANT BRUT DU DEVIS
- **H. Actions** : Enregistrer, Calculer, Envoyer, Modifier, Valider, Convertir en commande

## 42. UI — DEVIS CLIENT

Le client doit comprendre ce qu'il demande / comment il est dimensionné / combien coûte le travail — sans nécessairement exposer coûts internes/marge si la politique commerciale ne le souhaite pas. Deux niveaux : vue interne / vue client. Ne jamais exposer accidentellement coûts internes, marge, coûts fournisseurs, informations comptables.

---

## 43-46. SÉCURITÉ, PRÉCISION MONÉTAIRE, MIGRATIONS, RÉTROCOMPATIBILITÉ

Toutes les nouvelles données respectent Supabase RLS : accès client à ses devis/commandes/factures, accès interne aux données de coûts, séparation des rôles, protection des endpoints. Un client ne doit jamais pouvoir modifier coût interne/fiche technique/prix de revient/ressources/stock.

Précision monétaire : ne pas utiliser naïvement "float" pour les calculs financiers critiques ; analyser la convention actuelle (si "real" est déjà utilisé, ne pas provoquer une migration massive non nécessaire) ; pour les nouveaux calculs, arrondi explicite et testé aux cas limites.

Migrations DB versionnées, non destructives, compatibles avec les données existantes ; backup/vérification avant, schema validation après.

Rétrocompatibilité : les anciens devis doivent rester consultables même sans fiche technique — prévoir un mode "legacy/manual quote" si nécessaire. Ne jamais supposer que tous les anciens devis possèdent les nouvelles données.

---

## 47. TESTS OBLIGATOIRES (§47 — référence pour tout le futur travail de tests)

Test 1 : 3 unités · Test 2 : m² · Test 3 : mètre linéaire · Test 4 : m³ · Test 5 : poids · Test 6 : dimensions invalides · Test 7 : quantité = 0 · Test 8 : ressource manquante · Test 9 : ajustement manuel · Test 10 : conversion devis → commande · **Test 11 : double conversion** [✅ couvert, `apps/api/src/__tests__/phase6-devis-commande.test.ts`] · Test 12 : commande → facture · Test 13 : facture → paiement · Test 14 : commande → production · Test 15 : stock insuffisant → approvisionnement · Test 16 : stock suffisant → bon de sortie · **Test 17 : client connecté** [✅ couvert, même fichier] · **Test 18 : client hors plateforme** [✅ couvert, même fichier].

## 48. TEST CRITIQUE DE NON-RÉGRESSION

Scénario complet : CLIENT → choisit produit → saisit dimensions → calcul automatique → devis → validation → commande → facture → acompte → production → stock → bon sortie → job production → livraison → timeline client. Le test doit vérifier les IDs et relations entre les objets. **[Pas encore écrit — voir section "Ce qu'il reste à faire" ci-dessous.]**

## 49. ACCEPTANCE CRITERIA (partiel — document source tronqué au-delà d'AC05)

- AC01 : Aucune table "debits" n'existe.
- AC02 : Le devis reste le domaine métier officiel.
- AC03 : Un modèle peut avoir des dimensions variables.
- AC04 : Le système calcule automatiquement une quantité en m².
- AC05 : Le sys[tème...] *(texte source coupé ici — à compléter si le document original est retrouvé)*
