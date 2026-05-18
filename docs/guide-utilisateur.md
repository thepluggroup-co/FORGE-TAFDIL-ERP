# Guide Utilisateur FORGE ERP — TAFDIL
> Version 1.0 · Douala, Cameroun · Mai 2026  
> Support : **THE PLUG** — WhatsApp +237 95 88 45 28

---

## Table des matières

1. [Présentation de FORGE](#1-présentation-de-forge)
2. [Profil Directeur](#2-profil-directeur)
3. [Profil Secrétaire / Administrateur](#3-profil-secrétaire--administrateur)
4. [Profil Technicien](#4-profil-technicien)
5. [Agenda de formation — 2 jours](#5-agenda-de-formation--2-jours)
6. [Monitoring post go-live](#6-monitoring-post-go-live)
7. [Erreurs courantes et résolutions](#7-erreurs-courantes-et-résolutions)

---

## 1. Présentation de FORGE

FORGE est le système ERP (Enterprise Resource Planning) de TAFDIL, conçu pour la gestion complète de la microusine métallurgique.

### Accès aux interfaces

| Interface | URL / Accès | Usage |
|---|---|---|
| **Desktop ERP** | Icône FORGE.exe sur le bureau | Travail quotidien (PC bureau) |
| **Web ERP** | `erp.tafdil.cm` | Accès depuis n'importe quel navigateur |
| **Shop Web** | `shop.tafdil.cm` | Catalogue et commandes clients en ligne |
| **Mobile (APK)** | Fichier `FORGE-mobile.apk` | Techniciens sur le terrain |

### Connexion

```
Identifiant : votre adresse email TAFDIL
Mot de passe : remis par le directeur au premier accès
```

> **Important :** Ne partagez jamais votre mot de passe. Chaque action est tracée avec votre identifiant.

---

## 2. Profil Directeur

### 2.1 Modules accessibles

| Module | Accès | Description |
|---|---|---|
| Tableau de bord | ✅ Complet | KPIs en temps réel |
| Intelligence IA | ✅ Complet | Assistant Claude, recommandations stock |
| Stocks | ✅ Complet | Lecture + modification + inventaire |
| Bons de sortie | ✅ Complet | Validation finale |
| Commerce | ✅ Complet | Clients, devis, commandes |
| Finance | ✅ Complet | Factures, crédits, comptabilité |
| RH | ✅ Complet | Employés, présences, paie |
| Rapports | ✅ Complet | Grand livre, bilan, TVA |
| Paramètres | ✅ Complet | Utilisateurs, configuration |

### 2.2 Les 5 actions les plus fréquentes

---

#### ACTION 1 — Lire les KPIs du tableau de bord

**Chemin :** Écran d'accueil → Tableau de bord

```
┌─────────────────────────────────────────────────────┐
│  FORGE ERP · TAFDIL · Douala                        │
├──────────────┬──────────────┬──────────────┬────────┤
│  CA CE MOIS  │  COMMANDES   │  STOCK ALERTE│   IA   │
│  1 250 000   │  En cours: 3 │  8 produits  │  Chat  │
│      XAF     │  Prêtes: 1   │  ⚠ Critique  │  →     │
├──────────────┴──────────────┴──────────────┴────────┤
│  ALERTES URGENTES                                   │
│  🔴 Fil de soudure : RUPTURE                        │
│  🟠 Disque 125mm : 3 unités (seuil : 5)             │
│  🟡 Crédit KOUAM : échéance demain                  │
└─────────────────────────────────────────────────────┘
```

**Étapes :**
1. Ouvrir FORGE (desktop ou navigateur)
2. Le tableau de bord s'affiche automatiquement à la connexion
3. Les alertes rouges nécessitent une action immédiate
4. Cliquer sur un indicateur pour voir le détail

> 📸 *[Capture d'écran : tableau-de-bord-directeur.png]*

---

#### ACTION 2 — Poser une question à l'assistant IA

**Chemin :** Menu gauche → Intelligence → Chat

**Exemples de questions utiles :**
```
"Quel est mon stock critique en ce moment ?"
"Quels clients ont des crédits en retard ?"
"Génère un résumé de la semaine"
"Quels produits dois-je commander en priorité ?"
"Quel est mon chiffre d'affaires du mois ?"
```

**Étapes :**
1. Cliquer sur **Intelligence** dans le menu
2. Taper votre question dans le champ en bas
3. Appuyer sur **Envoyer** ou **Entrée**
4. L'IA répond avec les données réelles de TAFDIL en temps réel

> 📸 *[Capture d'écran : assistant-ia-chat.png]*

> **Astuce :** L'IA reçoit automatiquement un rapport chaque lundi matin à 8h sur WhatsApp. Pas besoin de vous connecter pour la synthèse hebdomadaire.

---

#### ACTION 3 — Valider un bon de sortie depuis le mobile

**Chemin :** App mobile → Bons → En attente de validation

**Étapes :**
1. Ouvrir l'app FORGE sur votre téléphone
2. Aller dans **Bons de sortie** → onglet **À valider**
3. Sélectionner le bon soumis par le technicien
4. Lire le détail : demandeur, motif, matériaux demandés
5. Appuyer sur **Valider** ✅ ou **Refuser** ❌
6. Ajouter un commentaire si refus
7. Le technicien reçoit une notification instantanée

> 📸 *[Capture d'écran : validation-bon-mobile.png]*

---

#### ACTION 4 — Lire le rapport hebdomadaire

**Chemin :** Menu → Intelligence → Rapport hebdo

Le rapport est **généré automatiquement chaque lundi à 8h** et envoyé sur votre WhatsApp. Il contient :
- Chiffre d'affaires de la semaine vs semaine précédente
- Nombre de commandes traitées
- Produits en rupture ou critique
- Crédits clients en retard
- Recommandations prioritaires

**Pour déclencher manuellement :**
1. Menu → Intelligence → **Rapport hebdomadaire**
2. Cliquer **Générer maintenant**
3. Option : cocher **Envoyer sur WhatsApp**

> 📸 *[Capture d'écran : rapport-hebdo.png]*

---

#### ACTION 5 — Consulter et exporter un rapport financier

**Chemin :** Menu → Finance → Rapports → Grand livre / Balance

**Étapes :**
1. Sélectionner la période (mois, trimestre, année)
2. Choisir le type : Grand livre, Balance, Déclaration TVA
3. Cliquer **Générer**
4. Bouton **Télécharger PDF** ou **Exporter Excel**

> 📸 *[Capture d'écran : rapport-financier.png]*

### 2.3 Raccourcis clavier (Desktop)

| Raccourci | Action |
|---|---|
| `Ctrl + D` | Tableau de bord |
| `Ctrl + I` | Assistant IA |
| `Ctrl + S` | Stocks |
| `Ctrl + B` | Bons de sortie |
| `Ctrl + F` | Finance |
| `Ctrl + R` | Rapports |
| `F5` | Actualiser les données |
| `Échap` | Fermer la fenêtre/modal |

---

## 3. Profil Secrétaire / Administrateur

### 3.1 Modules accessibles

| Module | Accès | Description |
|---|---|---|
| Tableau de bord | ✅ Lecture | Alertes et KPIs |
| Stocks | ✅ Complet | Entrées, sorties, ajustements |
| Bons de sortie | ✅ Validation | Valider / refuser les demandes |
| Commerce | ✅ Complet | Clients, devis, commandes, factures |
| Finance | ✅ Complet | Factures, crédits, encaissements |
| RH | ✅ Lecture | Consulter les fiches employés |
| Intelligence IA | ✅ Lecture | Alertes et recommandations stock |
| Rapports | ❌ Restreint | Uniquement les rapports opérationnels |

### 3.2 Les 5 actions les plus fréquentes

---

#### ACTION 1 — Enregistrer une entrée de stock (réapprovisionnement)

**Chemin :** Menu → Stocks → sélectionner le produit → Mouvement

**Étapes :**
1. Aller dans **Stocks** → rechercher le produit (par référence ou nom)
2. Cliquer sur le produit → bouton **Nouveau mouvement**
3. Sélectionner type : **Entrée**
4. Saisir la quantité reçue
5. Saisir la référence du bon de livraison fournisseur
6. Cliquer **Valider**

```
┌─────────────────────────────────┐
│  Nouveau mouvement de stock     │
│  Produit : Fil de soudure       │
│  ─────────────────────────────  │
│  Type :     ● Entrée            │
│             ○ Sortie            │
│             ○ Ajustement        │
│  Quantité : [  50  ]            │
│  Référence: [BL-2026-042      ] │
│  Notes :    [Livraison Fourniss]│
│  ─────────────────────────────  │
│  [ Annuler ]    [ ✓ Valider ]   │
└─────────────────────────────────┘
```

> 📸 *[Capture d'écran : entree-stock.png]*

---

#### ACTION 2 — Valider un bon de sortie

**Chemin :** Menu → Bons de sortie → À valider

**Étapes :**
1. Cliquer sur **Bons de sortie** → onglet **Soumis** (badge rouge = nombre en attente)
2. Ouvrir le bon → vérifier : demandeur, motif, matériaux demandés
3. Vérifier que le stock est suffisant (indicateur vert/rouge sur chaque ligne)
4. Cliquer **Valider** → le technicien reçoit une notification
5. Ou **Refuser** avec commentaire si stock insuffisant ou motif incorrect

> 📸 *[Capture d'écran : validation-bon-secretaire.png]*

> **Important :** Une fois validé, le bon génère un **code unique** (ex: `TAF-20260518-0042`). Le magasinier doit ce code pour exécuter le bon et sortir les matériaux.

---

#### ACTION 3 — Créer et envoyer une facture

**Chemin :** Menu → Finance → Factures → Nouvelle facture

**Étapes :**
1. Cliquer **+ Nouvelle facture**
2. Sélectionner le client (ou créer un nouveau)
3. Ajouter les lignes : description, quantité, prix unitaire XAF
4. La TVA (19,25%) est calculée automatiquement
5. Cliquer **Générer PDF**
6. Bouton **Envoyer WhatsApp** → saisir le numéro du client
7. Ou **Envoyer Email** si le client a une adresse

```
FACTURE N° TFDL-2026-0089
─────────────────────────────────────────
Client    : SONATREL Douala
Date      : 18/05/2026
Échéance  : 18/06/2026

Désignation          Qté   PU XAF    Total
Porte métallique       2   85 000   170 000
Soudure structure      1   45 000    45 000
─────────────────────────────────────────
Sous-total HT                        215 000
TVA 19,25%                            41 388
TOTAL TTC                            256 388 XAF
─────────────────────────────────────────
```

> 📸 *[Capture d'écran : creation-facture.png]*

---

#### ACTION 4 — Enregistrer un crédit client

**Chemin :** Menu → Finance → Crédits → Nouveau crédit

**Étapes :**
1. Cliquer **+ Nouveau crédit**
2. Sélectionner ou créer le client
3. Lier à une facture existante (optionnel)
4. Saisir : montant total, acompte versé, date d'échéance
5. Le solde restant est calculé automatiquement
6. Cliquer **Enregistrer**

**Suivi des crédits :**
- Le tableau de bord alerte 7 jours avant l'échéance (🟡)
- L'IA prévient le directeur des crédits échus (🔴)
- Enregistrer les remboursements partiels via **Ajouter remboursement**

> 📸 *[Capture d'écran : credit-client.png]*

---

#### ACTION 5 — Consulter les alertes de stock

**Chemin :** Menu → Stocks → Alertes

**Niveaux d'alerte :**

| Couleur | Statut | Action requise |
|---|---|---|
| 🔴 Rouge | **Rupture** (stock = 0) | Commander immédiatement |
| 🟠 Orange | **Critique** (stock ≤ seuil critique) | Commander cette semaine |
| 🟡 Jaune | **Alerte** (stock ≤ stock minimum) | Planifier la commande |
| 🟢 Vert | **Normal** | Aucune action |

> 📸 *[Capture d'écran : alertes-stock.png]*

### 3.3 Raccourcis clavier (Desktop)

| Raccourci | Action |
|---|---|
| `Ctrl + N` | Nouveau (facture, bon, client…) |
| `Ctrl + S` | Sauvegarder le formulaire en cours |
| `Ctrl + F` | Rechercher |
| `Ctrl + P` | Imprimer / Générer PDF |
| `Ctrl + W` | Envoyer par WhatsApp |
| `Tab` | Passer au champ suivant |
| `Entrée` | Valider le formulaire |

---

## 4. Profil Technicien

### 4.1 Modules accessibles (App mobile uniquement)

| Module | Accès | Description |
|---|---|---|
| Bons de sortie | ✅ Créer | Soumettre une demande de matériaux |
| Mes bons | ✅ Lecture | Suivre le statut de ses demandes |
| Stocks | ✅ Lecture | Consulter la disponibilité |
| Scanner QR | ✅ Complet | Inventaire et identification produits |
| Signalement | ✅ Complet | Reporter un incident ou une difficulté |

> **Note :** Les techniciens accèdent à FORGE uniquement via l'app mobile Android.

### 4.2 Les 5 actions les plus fréquentes

---

#### ACTION 1 — Installer l'APK sur le téléphone Android

**Prérequis :** Android 8.0 ou supérieur, connexion WiFi TAFDIL

**Étapes :**
1. Sur le téléphone, ouvrir le navigateur
2. Aller sur : `erp.tafdil.cm/download` ou scanner le QR code d'installation
3. Télécharger `FORGE-mobile.apk`
4. Si alerte sécurité → **Paramètres → Sécurité → Sources inconnues → Autoriser**
5. Ouvrir le fichier téléchargé → **Installer**
6. Lancer FORGE → se connecter avec l'email et mot de passe fournis

```
QR Code d'installation :
┌─────────────────────┐
│ █▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█  │
│ █ ▀▄▀ ▄▀▄ █▀▄▀█ █  │
│ █ █▀▄▄▄▄█ ▀▀ ▀ █  │
│ █▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█  │
│  erp.tafdil.cm/apk  │
└─────────────────────┘
```

> 📸 *[Capture d'écran : installation-apk.png]*

---

#### ACTION 2 — Créer un bon de sortie depuis le téléphone

**Chemin :** App → Bons → + Nouveau bon

**Étapes :**
1. Appuyer sur le bouton **+** (en bas à droite)
2. Saisir votre nom ou sélectionner votre profil
3. Saisir le **motif** : ex. *"Maintenance groupe électrogène atelier B"*
4. Ajouter les matériaux nécessaires :
   - Appuyer **+ Ajouter ligne**
   - Rechercher le produit par nom ou référence
   - Saisir la quantité
5. Ajouter des **notes** si besoin
6. Appuyer **Soumettre le bon** 
7. Vous recevrez une notification quand le bon est validé ou refusé

```
┌──────────────────────────────┐
│  NOUVEAU BON DE SORTIE       │
│  ──────────────────────────  │
│  Demandeur : Ali Technicien  │
│  Motif : [Maintenance GE... ]│
│  ──────────────────────────  │
│  MATÉRIAUX DEMANDÉS          │
│  + Fil de soudure    [10]    │
│  + Disque 125mm      [ 5]    │
│  ──────────────────────────  │
│        [ SOUMETTRE ]         │
└──────────────────────────────┘
```

> 📸 *[Capture d'écran : creation-bon-mobile.png]*

---

#### ACTION 3 — Scanner un QR code pour l'inventaire

**Chemin :** App → Scanner (icône caméra)

**Étapes :**
1. Appuyer sur l'icône **Scanner** dans la barre du bas
2. Pointer la caméra sur le QR code collé sur l'étagère ou la caisse
3. La fiche produit s'affiche automatiquement :
   - Référence, désignation, stock actuel
   - Localisation (emplacement dans l'entrepôt)
4. Si vous constatez un écart avec le stock réel :
   - Appuyer **Signaler un écart**
   - Saisir la quantité réelle observée
   - La secrétaire recevra une alerte pour correction

> 📸 *[Capture d'écran : scanner-qr.png]*

---

#### ACTION 4 — Vérifier le statut de son bon de sortie

**Chemin :** App → Mes bons

**Statuts possibles :**

| Icône | Statut | Signification |
|---|---|---|
| 🕐 | **Soumis** | En attente de validation par la secrétaire |
| ✅ | **Validé** | Approuvé — aller au magasin avec le code unique |
| ❌ | **Refusé** | Voir le commentaire de refus → corriger et soumettre à nouveau |
| 📦 | **Exécuté** | Matériaux récupérés — clôturé |

**Comment récupérer les matériaux :**
1. Montrer la notification **Bon validé** à la secrétaire/magasinier
2. Le code unique `TAF-AAAAMMJJ-XXXX` est indiqué
3. Le magasinier saisit ce code dans FORGE pour exécuter la sortie

> 📸 *[Capture d'écran : statut-bon.png]*

---

#### ACTION 5 — Signaler une difficulté

**Chemin :** App → Signalement → + Nouveau

**Types de signalements :**
- Panne machine
- Écart de stock observé
- Problème de sécurité
- Demande d'approvisionnement urgent

**Étapes :**
1. Appuyer sur **Signalement** dans le menu
2. Sélectionner la catégorie
3. Décrire le problème en quelques mots
4. Ajouter une photo si possible (appareil photo intégré)
5. Appuyer **Envoyer**
6. Le directeur et la secrétaire sont notifiés immédiatement

> 📸 *[Capture d'écran : signalement.png]*

### 4.3 Gestes tactiles (App mobile)

| Geste | Action |
|---|---|
| Glisser vers la gauche | Supprimer / Refuser |
| Glisser vers la droite | Valider / Confirmer |
| Appui long | Options supplémentaires |
| Pincer | Zoom sur les détails |
| Rafraîchir | Tirer vers le bas |

---

## 5. Agenda de formation — 2 jours

> **Lieu :** Locaux TAFDIL, Douala  
> **Formateur :** THE PLUG (+237 95 88 45 28)  
> **Matériel requis :** PC bureau (directeur/secrétaire), téléphones Android des techniciens, connexion WiFi

---

### JOUR 1 — Directeur et Secrétaire

#### Matin (9h00 – 12h00) — Profil Directeur

| Horaire | Durée | Session | Objectif |
|---|---|---|---|
| **9h00** | 30 min | Installation FORGE.exe | Le directeur lance FORGE en autonomie |
| **9h30** | 30 min | Tableau de bord et KPIs | Lire les indicateurs en temps réel |
| **10h00** | 30 min | Module Intelligence IA | Poser 5 questions différentes à l'IA |
| **10h30** | 30 min | Contrôle depuis le mobile | Naviguer dans l'app, voir les alertes |
| **11h00** | 30 min | Valider un bon depuis le mobile | Workflow de validation complet |
| **11h30** | 30 min | Rapport hebdomadaire | Lire et déclencher un rapport manuel |

**Exercice pratique 9h00 :**
```
1. Double-cliquer sur l'icône FORGE.exe sur le bureau
2. Se connecter : email + mot de passe provisoire
3. Changer le mot de passe au premier accès
4. Naviguer dans chaque module pendant 2 minutes
→ Validation : le directeur retrouve les alertes du jour sans aide
```

**Exercice pratique 10h00 (IA) :**
```
Questions à poser successivement :
1. "Quels sont mes produits en rupture de stock ?"
2. "Quel client me doit le plus d'argent ?"
3. "Quelles commandes sont en retard ?"
4. "Compare mon CA ce mois vs le mois dernier"
5. Question libre du directeur
→ Validation : le directeur pose une question et comprend la réponse
```

**Exercice pratique 11h00 (validation mobile) :**
```
1. Le formateur soumet un bon de test depuis la tablette
2. Le directeur reçoit la notification sur son téléphone
3. Il ouvre l'app → Bons → À valider
4. Il lit le détail du bon
5. Il valide → notification envoyée au "technicien"
→ Validation : workflow complet en < 2 minutes
```

---

#### Après-midi (14h00 – 17h00) — Profil Secrétaire

| Horaire | Durée | Session | Objectif |
|---|---|---|---|
| **14h00** | 60 min | Gestion des stocks | Entrée, sortie, ajustement, alertes |
| **15h00** | 45 min | Bons de sortie | Valider et refuser des bons |
| **15h45** | 45 min | Créer et envoyer une facture | PDF + envoi WhatsApp |
| **16h30** | 30 min | Crédit client | Enregistrement et suivi |
| **17h00** | — | Questions / Récapitulatif J1 | — |

**Exercice pratique 14h00 (stocks) :**
```
Scénario : livraison de stock reçue
1. Chercher "Fil de soudure" dans les stocks
2. Enregistrer une entrée de 50 unités (réf: BL-042)
3. Vérifier que le statut passe de "critique" à "normal"
4. Aller dans Alertes → voir les produits restants en alerte
→ Validation : la secrétaire effectue le mouvement sans aide
```

**Exercice pratique 15h00 (bons) :**
```
Scénario : bon soumis par un technicien
1. Aller dans Bons → Soumis
2. Ouvrir le bon TAF-test-001
3. Vérifier le stock de chaque matériau
4. Valider le bon → noter le code unique généré
5. Refuser un deuxième bon en ajoutant un commentaire
→ Validation : 2 bons traités en < 5 minutes
```

**Exercice pratique 15h45 (facture) :**
```
Scénario : commande terminée, facturer le client
1. Finance → Nouvelle facture
2. Client : SONATREL (créer s'il n'existe pas)
3. Ajouter 2 lignes de produits avec prix XAF
4. Vérifier le calcul TVA automatique
5. Générer PDF → ouvrir et vérifier
6. Envoyer sur WhatsApp du formateur (test)
→ Validation : facture PDF correcte envoyée par WhatsApp
```

---

### JOUR 2 — Techniciens et Test Grandeur Nature

#### Matin (9h00 – 12h00) — Profil Technicien

| Horaire | Durée | Session | Objectif |
|---|---|---|---|
| **9h00** | 60 min | Installation APK | Chaque technicien installe et se connecte |
| **10h00** | 60 min | Créer un bon de sortie | Soumettre une demande réelle |
| **11h00** | 30 min | Scanner QR code | Identifier un produit en entrepôt |
| **11h30** | 30 min | Signaler une difficulté | Rédiger et envoyer un signalement |

**Exercice pratique 9h00 (installation) :**
```
Chaque technicien sur son téléphone :
1. Connecter le téléphone au WiFi TAFDIL
2. Scanner le QR code d'installation affiché au tableau
3. Télécharger et installer l'APK
4. Se connecter avec ses identifiants
5. Naviguer dans l'app pendant 5 minutes
→ Validation : tous les techniciens sont connectés et voient l'écran d'accueil
```

**Exercice pratique 10h00 (bon de sortie) :**
```
Scénario : chaque technicien soumet une demande réelle
1. Appuyer sur + Nouveau bon
2. Saisir son nom et le motif (travail en cours)
3. Ajouter 2-3 matériaux nécessaires
4. Soumettre
5. La secrétaire (en formation J1) reçoit et valide
6. Le technicien reçoit la notification "Bon validé"
7. Il récupère le code unique
→ Validation : workflow complet technicien ↔ secrétaire fonctionnel
```

---

#### Après-midi — Test Grandeur Nature (14h00 – 17h00)

**Objectif :** Simuler une journée complète de travail TAFDIL avec FORGE

**Scénario complet :**

```
COMMANDE CLIENT → DEVIS → COMMANDE → PRODUCTION → LIVRAISON → FACTURE
```

**Étape 1 — Réception commande client (14h00)**
```
Un client appelle pour commander des portes métalliques.
→ Secrétaire : Commerce → Clients → Nouveau client (si nouveau)
→ Secrétaire : Devis → Nouveau devis → Ajouter les produits + prix
→ Directeur : approuve le devis sur mobile
```

**Étape 2 — Lancement production (14h30)**
```
→ Technicien : crée un bon de sortie pour les matières premières
   (tôle, fil de soudure, disques de découpe)
→ Secrétaire : valide le bon → code unique généré
→ Technicien : récupère les matériaux au magasin
   (la secrétaire exécute le bon avec le code unique)
→ FORGE déduit automatiquement le stock
```

**Étape 3 — Suivi production (15h00)**
```
→ Directeur : vérifie l'état des commandes depuis son téléphone
→ IA : "Quel est l'avancement de la commande en cours ?"
→ Technicien : signale une difficulté (panne petit outillage)
→ Directeur : reçoit la notification → répond via l'app
```

**Étape 4 — Livraison et facturation (15h30)**
```
→ Secrétaire : Commerce → Commandes → Marquer comme "Livrée"
→ Secrétaire : Finance → Factures → Créer la facture depuis la commande
→ Vérifier le PDF → envoyer sur WhatsApp du client (formateur)
→ Enregistrer l'acompte reçu
→ Créer un crédit client si paiement différé
```

**Étape 5 — Clôture journée (16h30)**
```
→ Secrétaire : Stocks → vérifier les alertes générées par la production
→ Directeur : IA → "Résume l'activité d'aujourd'hui"
→ Inventaire rapide : scanner 5 produits avec l'app mobile
→ Questions libres — débriefing avec le formateur
```

---

## 6. Monitoring post go-live

> **Durée du support intensif :** 4 semaines après la mise en production  
> **Contact :** THE PLUG — WhatsApp +237 95 88 45 28 (disponible 7h-22h)

### 6.1 UptimeRobot — Surveillance disponibilité

**Objectif :** Alerter si l'API ou le site web tombe en moins de 5 minutes.

**Configuration (à faire par THE PLUG au go-live) :**

1. Créer un compte sur [uptimerobot.com](https://uptimerobot.com) (gratuit)
2. Ajouter les moniteurs :

| Moniteur | URL | Intervalle | Alerte |
|---|---|---|---|
| FORGE API | `https://api.railway.app/health` | 5 min | SMS + Email |
| FORGE Web ERP | `https://erp.tafdil.cm` | 5 min | SMS + Email |
| FORGE Shop | `https://shop.tafdil.cm` | 5 min | SMS + Email |

3. Configurer les alertes SMS vers : **+237 95 88 45 28** et le numéro du directeur
4. Page de status publique : `https://status.tafdil.cm` (optionnel)

**Que faire si l'alerte se déclenche ?**
```
1. Ne pas paniquer — l'alerte peut être un faux positif réseau
2. Attendre 2 minutes → si l'alerte persiste, appeler THE PLUG
3. En dehors des heures : envoyer un WhatsApp avec le message d'alerte reçu
```

---

### 6.2 Sentry — Capture d'erreurs en temps réel

**Objectif :** Savoir exactement ce qui ne fonctionne pas, avec le contexte technique.

**Installation dans l'API (apps/api/) :**

```bash
pnpm add @sentry/node --filter @forge/api
```

Ajouter dans `apps/api/src/app.ts` :
```typescript
import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
})
```

**Installation dans le Web ERP (apps/web/) :**

```bash
pnpm add @sentry/react --filter @forge/web
```

**Installation dans le Shop (apps/shop/) :**

```bash
pnpm add @sentry/nextjs --filter @forge/shop
```

**Variables d'environnement à ajouter :**

```env
# Dans Railway (API) et Vercel (web, shop)
SENTRY_DSN=https://xxxxxxxx@sentry.io/xxxxxxx
```

**Accès au dashboard Sentry :**
- URL : [sentry.io](https://sentry.io)
- Projet : `forge-tafdil`
- Alertes email : activées pour toute erreur nouvelle

---

### 6.3 Plan de support 4 semaines

| Semaine | Type de support | Disponibilité |
|---|---|---|
| **S1** (go-live) | Support 24/7 — présence physique si besoin | 7h-22h WhatsApp |
| **S2** | Support actif — réponse < 2h | 7h-22h WhatsApp |
| **S3** | Support normal — réponse < 4h | 8h-20h WhatsApp |
| **S4** | Support réduit — vérification hebdo | Lundi-Vendredi |

**Canal de support :**
```
WhatsApp : +237 95 88 45 28 (THE PLUG)
Objet des messages : [FORGE] + description du problème
Exemple : "[FORGE] La facture ne s'envoie pas sur WhatsApp"
```

**Informations à fournir lors d'un incident :**
1. Quel profil est connecté (Directeur / Secrétaire / Technicien)
2. Quelle action était en cours
3. Le message d'erreur exact (screenshot si possible)
4. L'heure de l'incident

---

## 7. Erreurs courantes et résolutions

### Erreurs générales

| Erreur | Cause | Solution |
|---|---|---|
| **"Token invalide"** | Session expirée | Se déconnecter et se reconnecter |
| **"Trop de requêtes"** | Trop de clics rapides | Attendre 1 minute, puis réessayer |
| **"Erreur serveur"** | Problème API temporaire | Actualiser (F5), puis réessayer dans 2 min |
| **L'app ne charge pas** | Connexion internet coupée | Vérifier le WiFi / 4G |

### Erreurs stocks

| Erreur | Cause | Solution |
|---|---|---|
| **"Stock insuffisant"** | Quantité demandée > stock disponible | Réduire la quantité ou attendre réapprovisionnement |
| **"Produit introuvable"** | Référence incorrecte | Chercher par nom plutôt que par référence |

### Erreurs bons de sortie

| Erreur | Cause | Solution |
|---|---|---|
| **"Code unique invalide"** | Mauvais code saisi pour exécuter | Relire le bon validé — le code est `TAF-AAAAMMJJ-XXXX` |
| **"Impossible de valider"** | Bon pas en statut 'soumis' | Vérifier le statut actuel du bon |

### Erreurs paiements (Shop)

| Erreur | Cause | Solution |
|---|---|---|
| **"Notchpay injoignable"** | Service de paiement indisponible | Réessayer dans 5 min, ou appeler THE PLUG |
| **"Commande déjà payée"** | Double clic sur payer | Vérifier le statut de la commande — paiement OK |

### Erreurs factures

| Erreur | Cause | Solution |
|---|---|---|
| **PDF ne s'ouvre pas** | Bloqueur de popup actif | Autoriser les popups pour erp.tafdil.cm |
| **WhatsApp n'envoie pas** | Numéro incorrect | Vérifier le format : +237XXXXXXXXX (sans espace) |

---

*Document généré par THE PLUG — FORGE ERP v1.0 — TAFDIL Douala, Cameroun*  
*Dernière mise à jour : Mai 2026*
