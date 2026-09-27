# Dette de tests API — état au 26/09/2026

Contexte : en reprenant le Master Prompt V3 pour la Phase 6, la suite de
tests de `apps/api` n'avait apparemment pas tourné depuis un moment. Premier
`vitest run` de la session : **132 tests en échec sur 429, dans 19 fichiers
sur 29** — avant toute intervention. Vérifié en rejouant la même suite sur
le commit d'avant la Phase 5 (audit devis) : échecs identiques, donc ce
n'est pas un effet de bord de cette phase, la dette existait déjà.

## Progrès de cette session

**132 → 66 échecs (297 → 367 / 433 tests verts).** Fichiers entièrement
réparés (0 échec, vérifié) : `rapports.test.ts`, `auth.test.ts`,
`05-inventaire.test.ts`, `01-antisurstock.test.ts`, `paiements.test.ts`
(commit `dff1ba2`), et `livraison-signature.test.ts` (commit ultérieur —
voir correction ci-dessous).

**Correction du 26/09 (soir)** : ce document affirmait plus tôt dans la
session que `livraison-signature.test.ts` était entièrement réparé. C'était
faux — 3 tests sur 6 échouaient encore (500 au lieu du code attendu),
pour la raison exposée plus bas (`checkPermission` mocké mais jamais
configuré). Rectifié ici plutôt que laissé tel quel, conformément à la
consigne de ne jamais présenter un correctif comme acquis sans l'avoir
revérifié. Le fichier est maintenant réellement 6/6 vert (fix appliqué,
voir section suivante).

## Cause dominante identifiée : RBAC non mocké

Les routes utilisent `requirePermission(module, action)` →
`checkPermission()` (`apps/api/src/services/rbacService.ts`), qui interroge
la DB (`rbac_user_profiles`, `rbac_roles`, `rbac_role_permissions`,
`rbac_permissions`) via plusieurs appels `.from()`. Cette RBAC a été
branchée sur les routes après l'écriture de nombreux tests, qui ne mockent
pas ces appels. Deux symptômes selon les cas :
- `checkPermission` tourne pour de vrai contre une DB mockée vide →
  refus d'accès (403) alors que le test attend un succès, ou l'inverse
  selon le rôle legacy mappé (`LEGACY_ROLE_MAP` dans rbacService.ts).
- Les appels `.from()` RBAC (jusqu'à 4 par requête) consomment par erreur
  les mocks en file (`mockReturnValueOnce`) destinés à la logique métier
  réelle du test, décalant tout le reste de la séquence.

**Fix mécanique déjà appliqué et qui marche** (voir `livraison-signature.test.ts`
comme référence) : mocker `../services/rbacService` directement
(`checkPermission: vi.fn()`) et poser un `mockResolvedValueOnce({allowed,
roleName})` avant chaque requête protégée, dans l'ordre exact des requêtes.

## Deux découvertes distinctes, plus sérieuses qu'un problème de mock

En creusant `logistique.test.ts` et `journee-complete.test.ts`, deux
**vraies règles métier ont été ajoutées aux routes sans que les tests
correspondants soient mis à jour** — ce n'est plus un problème RBAC :

1. **`PUT /api/bons/:id/executer`** (`apps/api/src/routes/bons.ts`) exige
   désormais qu'un préparateur soit assigné et que la préparation soit au
   statut `pret` avant d'exécuter le bon (code `PREPARATION_REQUIRED`).
   Les tests narratifs (`journee-complete.test.ts` T07) ne posent pas ces
   champs sur leur fixture `BON_VALIDE` → 422/404 au lieu du 200 attendu.

2. **`PATCH /api/logistique/livraisons/:id/statut`**
   (`apps/api/src/routes/logistique.ts`) appelle désormais
   `verifierCommandeLivrable(commande_id)` avant d'autoriser une transition
   vers `en_route`/`livree` — un appel DB supplémentaire non mocké dans
   `logistique.test.ts`, qui renvoie des 422 (`COMMANDE_NOT_FOUND` ou
   équivalent) sur des transitions que le test attend valides.

**Recommandation** : confirmer que ces deux garde-fous sont bien voulus
tels quels (ça semble être le cas — cohérent avec le reste du système :
`bons_sortie_lignes` et `verifierCommandeLivrable` existent pour de bonnes
raisons métier), puis mettre à jour les fixtures/mocks des tests concernés
en conséquence plutôt que d'assouplir le code de prod pour faire passer les
tests.

**Mise en garde testée en pratique** : le pattern "mocker `rbacService` en
bloc" (`vi.mock('../services/rbacService', ...)` + `checkPermission`
mocké systématiquement) NE marche PAS partout — testé sur
`commerce.test.ts` : l'appliquer à l'aveugle a fait passer les échecs de 8
à 22, parce que ce fichier reposait déjà, pour la plupart de ses tests, sur
le VRAI `checkPermission` qui résout correctement via le fallback
`LEGACY_ROLE_MAP` + l'octroi automatique SUPER_ADMIN (rbacService.ts lignes
~191-197) sans jamais toucher aux mocks DB. Bloquer ce mécanisme en mockant
`checkPermission` a cassé tout ce qui marchait déjà. Pour ce fichier
précis, le bon fix est chirurgical : ajouter les `mockReturnValueOnce`
manquants pour les 1-2 appels `.from()` RBAC (`rbac_user_profiles`,
`rbac_roles`) uniquement sur les tests qui échouent réellement, sans
toucher au reste. Changé d'avis en cours de route, reverté avant commit —
`commerce.test.ts` reste donc à l'état documenté ci-dessous (8 échecs),
non aggravé.

## Phase 6 — §47 Test 11 et Tests 17/18 (nouveau fichier, isolé)

Ajouté `apps/api/src/__tests__/phase6-devis-commande.test.ts` (4 tests, 4/4
verts, n'affecte aucun des 69 échecs ci-dessous — total suite : 429 → 433
tests, 360 → 364 verts) :

- **Test 11 (§37)** : simule la course entre deux conversions concurrentes
  du même devis. Le SELECT initial résout `statut: 'accepte'` (passe les
  gardes), puis l'UPDATE-claim (`.in('statut', [...]).select('id').maybeSingle()`)
  résout `{ data: null, error: null }` — exactement ce que renverrait
  Supabase si une autre requête avait déjà gagné la course. Vérifie 409
  `ALREADY_TRANSFORMED` ET qu'aucune commande n'est insérée
  (`expect(supabase.from).toHaveBeenCalledTimes(3)`, donc pas d'appel
  `commandes`/`commandes_lignes` supplémentaire). Un second test couvre le
  cas nominal (verrou réclamé avec succès → 201) pour éviter un test qui ne
  vérifierait qu'un chemin d'échec.
- **Tests 17/18 (source_demande)** : POST /devis avec un client connecté
  (`client_id` renseigné) et avec un client hors plateforme (`client_id`
  absent, juste `client_nom` + `source_demande: 'whatsapp'`) — vérifie dans
  les deux cas que le payload d'INSERT porte bien `source_demande` et que la
  réponse le reflète.

Fichier volontairement isolé de `commerce.test.ts` : il mocke
`rbacService.checkPermission` et `client-sync.service.ensureClient`
directement (comme `livraison-signature.test.ts`, mais **en configurant
bien un retour** — voir la note ajoutée à `livraison-signature.test.ts`
ci-dessous) plutôt que de dépendre du fallback RBAC réel dont
`commerce.test.ts` dépend pour ses tests déjà verts.

## Fix mécanique — `livraison-signature.test.ts` (3 → 0 échec)

Cause : `checkPermission` était mocké (`vi.fn()`) mais **jamais configuré**
avec un retour. `await checkPermission(...)` résolvait donc `undefined`, et
`permission.middleware.ts` plantait sur `result.allowed` → 500 sur les 3
tests qui passent par une route protégée sans que le test lui-même ne pose
de mock RBAC explicite (S3, S5, S6).

Fix (un seul ajout, dans le `beforeEach` global du fichier) :

```ts
vi.mocked(checkPermission).mockResolvedValue({ allowed: true, roleName: 'livreur' })
```

Aucun de ces tests n'exerce un refus RBAC (les rejets testés —
`FORBIDDEN_NOT_OWN_LIVRAISON`, `INVALID_STATE` — sont des règles métier
internes à la route, après le middleware), donc un `allowed: true`
systématique en `beforeEach` suffit ; pas besoin de `mockResolvedValueOnce`
par test. Vérifié : 6/6 verts après le fix, aucune régression sur le reste
de la suite (69 → 66 échecs, 364 → 367 verts).

## Fichiers encore en échec (66 tests, 13 fichiers) — au 26/09/2026, l'après-midi
**⚠️ Table obsolète, conservée pour l'historique — voir la table à jour
("42 tests, 5 fichiers") plus bas dans ce document, après la section
"Phase 6 (suite, 26/09 soir)".**

| Fichier | Échecs | Nature (à vérifier au cas par cas) |
|---|---|---|
| `integration/journee-complete.test.ts` | 12 | Narratif, cascade — cause racine = garde préparation (bons.ts) + dérives en aval (état partagé entre tests) |
| `logistique.test.ts` | 9 | RBAC partiellement fait + garde `verifierCommandeLivrable` non mockée |
| `integration/pipeline-invariants.test.ts` | 9 | Narratif — probablement la même famille de causes que journee-complete |
| `commerce.test.ts` | 8 | RBAC non fait (voir aussi bug distinct déjà identifié : mock `offline-fallback` incomplet, export `isNetworkError` manquant) |
| `operations.test.ts` | 5 | RBAC non fait |
| `finance-core.test.ts` | 5 | RBAC non fait |
| `rh.test.ts` | 4 | RBAC non fait |
| `03-pipeline-commande.test.ts` | 4 | RBAC non fait |
| `bons.test.ts` | 3 | RBAC partiellement fait — reste probablement lié à la garde préparation ci-dessus |
| `stocks.test.ts` | 2 | RBAC partiellement fait |
| `inviteRedirect.test.ts` | 2 | Non diagnostiqué |
| `02-workflow-bon.test.ts` | 2 | RBAC non fait |
| `shop.test.ts` | 1 | Non diagnostiqué |

## Phase 6 — UI Configurateur Produit (§40) + canal de la demande (§32/§41.A)

Le moteur de calcul (`POST /devis/calculate`, §13/§35) était complet côté
API depuis une phase précédente mais **n'était appelé par aucune
interface** — aucun écran ne permettait de saisir des dimensions et de
déclencher un calcul automatique. Ajouté :

- `apps/web/src/hooks/useDevis.ts` : hook `useCalculerDevis()` +
  types `CalculerDevisInput`/`PropositionDevis` (typage 1:1 du contrat
  retourné par la route), et extension de `CreateDevisPayload` avec les
  champs déjà supportés côté API mais jusqu'ici jamais envoyés par l'UI :
  `source_demande`, `fiche_technique_id`, `config_snapshot`,
  et par ligne `configuration`/`formule_utilisee`/`quantite_calculee`/
  `cout_calcule_xaf`/`ajuste_manuellement`/`motif_ajustement`.
- `apps/web/src/components/devis/Configurateur.tsx` : modale §40 —
  dimensions → quantité → Calculer → quantité facturable + montant brut +
  détail technique (matériaux/main-d'œuvre/équipements) dépliable. Gère
  explicitement le cas `FICHE_TECHNIQUE_INTROUVABLE` (422) comme une
  invitation à la saisie manuelle (§46), pas comme une erreur.
- `apps/web/src/pages/Devis.tsx` : bouton "Configurer" par ligne (visible
  dès qu'un produit du catalogue est sélectionné) qui ouvre la modale et,
  au clic sur "Appliquer", renseigne quantité/prix unitaire ET les champs
  de traçabilité de la ligne. Ajout aussi d'un sélecteur **Canal de la
  demande** (§32/§41.A : web/whatsapp/téléphone/boutique/bureau/commercial)
  à l'étape Client, absent jusqu'ici de l'écran alors que l'API le
  supportait déjà (voir Tests 17/18 ci-dessus). Ajout du §18 (ajustement
  manuel) : modifier quantité/prix après un calcul automatique marque la
  ligne `ajuste_manuellement` et exige un motif avant de pouvoir valider.

**Portée volontairement limitée** — honnêteté sur ce qui n'est PAS fait :
ceci couvre le Configurateur (§40) et une partie de l'écran Admin Devis
(§41.A — canal ; §41.F — ajustement manuel). Ça ne couvre PAS §41 dans son
ensemble : pas de navigation Famille→Catégorie→Modèle (aucune API
`GET /products/:id/configuration` ni de CRUD familles/catégories n'existe
encore côté backend — seul `POST /devis/calculate` avec un `produitId`
déjà connu existe), pas de refonte visuelle des sections B/C/D/E de
l'écran (produit/configuration/calcul/ressources affichés en un bloc
plutôt qu'en sections distinctes), pas de vue client simplifiée (§42). Le
snapshot devis figé (`fiche_technique_id`/`config_snapshot`) n'est envoyé
que quand le devis ne contient qu'UNE ligne calculée — un devis
multi-lignes garde sa traçabilité complète au niveau de chaque ligne mais
pas au niveau du snapshot devis (limitation du schéma existant, pas
contournée ici). Vérifié : `tsc --noEmit` et `vite build` passent sans
nouvelle erreur (comparé à la baseline avant ce changement).

## Phase 6 (suite) — Écran Admin Devis §41 (sections B-E) + Vue client §42

Repris après le point de priorisation avec l'utilisateur (4 options proposées :
dette de tests / API catalogue / test §48 / finir §41-§42 — ce dernier choisi).
Portée : uniquement la réorganisation visuelle et le câblage du détail des
ressources déjà prévu par le schéma mais jamais branché côté UI — **pas**
de navigation catalogue Famille→Catégorie→Modèle (toujours hors scope, cf.
limites assumées plus haut).

- **Découverte en inspectant avant de coder (§5)** : la table `devis` a
  déjà une colonne `ressources_snapshot` (jsonb) et l'API accepte déjà
  `ressources_snapshot` en entrée de `POST /devis` (`commerce.ts`, schéma
  Zod + insert) — mais **rien côté frontend ne l'a jamais renseignée**. Le
  détail matériaux/MO/équipements calculé par le Configurateur (§40) était
  donc silencieusement perdu dès la fermeture de la modale : une fois
  appliqué à la ligne, seul le total agrégé restait, jamais le détail par
  ressource. C'était le vrai trou derrière « §41.E manquant », pas un
  problème d'affichage.

- **`apps/web/src/pages/Devis.tsx`** — Step "Lignes" du formulaire de
  création/édition restructuré en 4 blocs étiquetés et visuellement
  distincts par ligne : **B. Produit** (sélection catalogue + désignation +
  catégorie), **C. Configuration** (résumé des dimensions saisies si
  calculé, sinon quantité/unité manuelles), **D. Calcul** (bandeau
  "calculé automatiquement" / "ajusté", formule utilisée, prix unitaire,
  sous-total), **E. Ressources** (détail matériaux/MO/équipements,
  repliable, affiché seulement si la ligne a été calculée via le
  Configurateur). `LocalLigne` étendue avec `ressourcesDetail` +
  totaux par type ; `applyConfigurateur()` les persiste désormais ;
  `handleSubmit()` construit et envoie `ressources_snapshot` (miroir de
  `config_snapshot`, même contrainte : uniquement quand un seul calcul
  automatique compose le devis, §21). Édition d'un devis existant :
  restaure aussi ces champs depuis les lignes déjà persistées.
- **`DevisDetailPanel`** (vue d'un devis existant) : ajoute une section
  E repliable ("Voir le détail") quand `ressources_snapshot` est présent,
  et une légende dimensions/formule sous la désignation de chaque ligne
  quand `configuration` est renseignée — même lecture pour l'écran de
  visualisation que pour le formulaire de création.
- **§42 — vue client séparée** : la vue client (`ApprouverDevis.tsx` via
  `GET /api/devis/approuver/:token`, public, sans auth) et la vue interne
  partagent déjà le même composant `DevisPreview` — ce qui garantissait
  déjà l'absence de fuite de coûts/marge, la route publique ne
  sélectionnant jamais `ressources_snapshot`/`cout_calcule_xaf`/
  `formule_utilisee`. Ce qui manquait : le client ne voyait aucune
  dimension, donc ne pouvait pas « comprendre comment c'est dimensionné »
  (exigence explicite du §42). Fix minimal et sûr : la route publique
  expose désormais aussi `configuration` (dimensions/quantité/options —
  aucune donnée de coût) par ligne ; `DevisPreview` affiche cette
  configuration en légende sous la désignation, pour les deux vues (client
  ET interne, données identiques mais route différente qui filtre déjà ce
  qui est renvoyé). Aucune nouvelle route, aucun nouveau composant : la
  séparation vue interne/vue client reste portée par ce que l'API publique
  choisit de sélectionner, pas par un composant dupliqué.
- **Vérifié** : `tsc --noEmit` sur `apps/web` — aucune nouvelle erreur
  (liste identique avant/après, confirmée par comparaison directe avec le
  stash du commit de départ) ; `vite build` — succès ; suite complète
  `apps/api` — toujours 367/433 verts, aucune régression (le seul fichier
  API touché, `commerce.ts`, ne change qu'un `.select()` de lecture
  publique ; `commerce.test.ts` reste à 21/29, exactement comme avant).
- **Non fait, assumé** : pas de UI pour éditer manuellement le détail des
  ressources (§41.E reste un affichage, pas un formulaire — cohérent avec
  le fait que ce sont des valeurs calculées, pas saisies) ; le snapshot
  ressources reste limité au cas un-seul-calcul-automatique comme
  `config_snapshot` (même limitation de schéma documentée en Phase 6
  précédente, pas contournée) ; toujours pas de §41 B avec vraie hiérarchie
  Famille→Catégorie→Modèle (nécessite l'API catalogue, option 2 déclinée
  pour cette session).

## Phase 6 (suite, 26/09 soir) — Réduction mécanique de la dette de tests

Repris après §41/§42, deuxième point de priorisation avec l'utilisateur
(option 1 choisie : réduire les 66 échecs plutôt que l'API catalogue ou le
test §48). **66 → 42 échecs (367 → 391/433 verts)**, fichiers repris un par
un, chacun revérifié à 100% avant de passer au suivant (aucun fichier
"corrigé" sans l'avoir vu passer en entier — cf. consigne de fin de fichier).

Note d'exécution : `pnpm exec vitest run` seul plante parfois en cours de
route sur cette machine (« Worker exited unexpectedly », pool tinypool) —
pas un effet des changements ci-dessous (déjà observé sur des runs sans
aucune modification). `pnpm exec vitest run --no-file-parallelism` est
stable et a servi de référence pour tous les comptages ci-dessous.

**Fichiers entièrement réparés cette session (0 échec, vérifié)** :
`operations.test.ts`, `finance-core.test.ts`, `rh.test.ts`,
`02-workflow-bon.test.ts`, `stocks.test.ts`, `inviteRedirect.test.ts`,
`shop.test.ts`, `bons.test.ts`.

### Découverte n°1 — cache RBAC partagé entre tests (pas juste "RBAC non mocké")

Au-delà de la cause déjà documentée (RBAC réel consommant les
`mockReturnValueOnce` métier), une **deuxième cause distincte** existe dans
les fichiers qui laissent tourner le vrai `checkPermission` (pas de mock de
`rbacService`) : `rbacService` garde un cache mémoire `_permCache` **keyé par
userId**, TTL 5 min, qui **survit entre tests** (module non réinitialisé par
`vi.clearAllMocks()`). Or `authHeaders(role)` (helpers.ts) réutilise par
défaut le **même userId** (`test-user-uid-001`) quel que soit le rôle testé.
Résultat : le premier test qui résout avec succès un rôle (typiquement
`admin` → `SUPER_ADMIN`, auto-accordé sans données DB) **pollue le cache
pour tout le reste du fichier** — les requêtes suivantes sont traitées comme
`SUPER_ADMIN` **quel que soit le rôle réellement envoyé dans leur JWT**.

Piège vérifié en pratique sur `rh.test.ts` : purger ce cache globalement
(`beforeEach(() => invalidateAllPermissionCaches())`) semblait être LA
solution évidente — mais ça a fait passer les échecs de **4 à 21**, parce
que 70 des 74 tests alors verts ne le sont QUE grâce à cette pollution
« bénéfique » (aucune permission n'est réellement peuplée côté DB mock, donc
sans elle, seul `SUPER_ADMIN` passe). Le bon fix est donc **chirurgical, par
test qui échoue réellement** :
- si le test est en tout début de fichier (cache froid) et échoue par
  consommation de mock : ajouter les 1-2 `mockReturnValueOnce` manquants
  pour `rbac_user_profiles`/`rbac_roles` (l'un ou l'autre suffit si le rôle
  attendu est `SUPER_ADMIN`, auto-accordé sans lire `rbac_role_permissions`).
- si le test attend un **403** pour un rôle faible mais hérite à tort du
  cache `SUPER_ADMIN` d'un test antérieur : donner à CE test précis un
  **userId dédié** (`authHeaders('operateur', 'test-uid-xxx-deny')`) — évite
  la pollution sans toucher au cache partagé dont dépendent les autres tests.

Cette découverte s'ajoute à la mise en garde déjà connue sur
`commerce.test.ts` (mocker `checkPermission` en bloc casse le fallback réel)
— les deux pointent vers la même règle : **ne jamais faire de changement
global sur le mécanisme RBAC d'un fichier de test sans revérifier l'intégralité
du fichier**, un fix qui répare 4 tests peut en casser 20 autres qui
dépendaient du même mécanisme par accident.

### Découverte n°2 — `finance-core.service.ts` a gagné un moteur de crédit client

`ensureFactureForCommande` et `enregistrerPaiementCommande` appellent
désormais automatiquement `syncCreditForFacture`/`getCreditByFactureOrCommande`
dès qu'une facture est "engageante" (valide/envoyee/payee) — création/mise à
jour d'une créance (`credits`) et resynchronisation de l'encours client. Ces
appels `.from('credits')` supplémentaires, en nombre variable selon l'état de
la facture, cassaient la file positionnelle de mocks (`mockImplementationOnce`
en séquence) de `finance-core.test.ts`. **Fix structurel** (pas un patch
ponctuel) : le mock DB de ce fichier route maintenant **par nom de table**
plutôt que par position (`queueFrom(table, response)`), avec une réponse par
défaut sûre (« aucun crédit existant ») pour toute table non explicitement
enfilée — les appels `credits` imprévus ne consomment plus jamais un slot
destiné à `commandes`/`factures`/`paiements_commande`. Plus robuste que
recompter les appels à la main, et résiste aux futurs appels ajoutés au
moteur de crédit sans casser le fichier.

### Découverte n°3 — la garde préparateur (bons.ts) affecte plus de fichiers que prévu

Le tableau ci-dessous attribuait `journee-complete.test.ts` et
`pipeline-invariants.test.ts` à la garde `PREPARATION_REQUIRED` (préparateur
assigné + `statut_preparation: 'pret'` avant `PUT /bons/:id/executer`) — elle
touchait **aussi** `02-workflow-bon.test.ts` et `bons.test.ts` (Test 8), déjà
corrigés ici en ajoutant `preparateur_id`/`statut_preparation: 'pret'` aux
fixtures de bon "prêt à exécuter". Le même correctif reste à appliquer aux
deux fichiers narratifs restants (voir tableau mis à jour plus bas).

`02-workflow-bon.test.ts` avait aussi un bug de comptage positionnel
classique : son commentaire supposait un appel `resolveCommandeIdForBon` lors
de la validation qui n'existe plus dans `routes/bons.ts` (fonction retirée
depuis) — la queue avait un slot fantôme en trop, décalant tout ce qui suit.

### Découverte n°4 — deux vrais bugs de production trouvés en creusant les tests

Pas des soucis de mock : les tests exposaient un vrai bug métier de la route.

1. **`shop.ts`, `PUT /produits/:id/visibilite` et `PUT /produits/:id/prix`** :
   l'ordre des checks était `if (error) return 500` **avant** `if (!data)
   return 404`. Or `.update(...).eq(...).single()` sur un produit inexistant
   renvoie `error.code === 'PGRST116'` avec `data: null` — un produit
   introuvable retournait donc **500 au lieu de 404 en production**, pas
   seulement dans le test. Fix : vérifier `!data` (et `PGRST116`) avant le
   cas d'erreur générique, dans les deux routes.
2. **`utils/inviteRedirect.ts`** : ce n'était pas un bug — `resolveInviteRedirectUrl()`
   redirige intentionnellement vers `/set-password` et non `/login` (un
   invité n'a pas encore de mot de passe), changement déjà documenté en
   commentaire dans le fichier source. Les 2 tests de `inviteRedirect.test.ts`
   asserttaient encore l'ancien comportement `/login` — mis à jour pour
   refléter le comportement actuel, volontaire.

### Découverte n°5 — `03-pipeline-commande.test.ts` teste une intégration de paiement obsolète

**Pas touché cette session — nécessite un travail dédié, pas une correction
mécanique.** `routes/paiements.ts` a été entièrement réécrit depuis l'écriture
de ce fichier de test : l'intégration est passée d'un stub générique
mock-friendly (`transaction.reference`/`checkout_url`, signature `x-notch-signature`)
à une vraie intégration NOKASH (`i_space_key`/`app_space_key`, signature HMAC
`hmac-signature` sur l'INIT, appel réseau réel vers `api.nokash.app`). Le
webhook ne vérifie **plus aucune signature** par choix de conception
assumé (commentaire du code : NOKASH ne documente aucune signature sur son
callback, donc la route revérifie systématiquement le statut réel via l'API
NOKASH avant de considérer un paiement comme confirmé) — le test "signature
invalide → 401" teste donc un comportement qui n'existe plus intentionnellement.
Réécrire ces 4 tests correctement demande de mocker `fetch` selon le contrat
réel NOKASH (deux endpoints, format de requête/réponse différent) — à traiter
comme son propre chantier, pas comme de la dette RBAC.

## Phase 6 (suite, 26/09 nuit) — Fin de la dette mécanique : 42 → 4 échecs

Reprise immédiate après la session précédente (utilisateur : « continue »).
**42 → 4 échecs (391 → 447/451 verts)**. Les 4 fichiers restants de la table
ci-dessus sont TOUS réparés à 100%, sauf `03-pipeline-commande.test.ts`
(déjà identifié comme un chantier séparé, non touché — voir Découverte n°5).
Comme précédemment, chaque fichier revérifié à 100% avant de passer au
suivant. `pnpm exec vitest run --no-file-parallelism` reste la référence
stable (le mode par défaut plante parfois le pool de workers sur cette
machine, sans lien avec ces changements).

**Fichiers réparés cette reprise (0 échec, vérifié)** : `logistique.test.ts`,
`integration/journee-complete.test.ts`, `integration/pipeline-invariants.test.ts`,
`commerce.test.ts`.

### `logistique.test.ts` (9 → 0)

Confirmait exactement la Découverte n°3 : `verifierCommandeLivrable` (via
`resolveBonSortieLivrableForCommande` + `getFactureActiveByCommande`,
mockées directement) gate désormais `PATCH /livraisons/:id/statut` vers
en_route/livree, ET `POST /livraisons` à la création — ce deuxième point
n'était pas encore documenté. Autre garde nouvelle découverte au passage :
`PLANNING_DATES_REQUIRED` — une transition vers `planifiee` exige désormais
`date_depart`/`date_livraison_prevue` dans le body. Une fois ces 4 tests
(L4 création, et les 3 transitions L5 vers en_route/planifiee/livree)
corrigés, les échecs en cascade plus loin dans le fichier (L5 négatifs, L6
assigner) ont disparu tout seuls — confirmation que c'étaient des mocks
`.from()` non consommés qui décalaient tout le reste (même mécanisme que
`02-workflow-bon.test.ts`, cf. Découverte n°3), pas des causes indépendantes.

### `integration/journee-complete.test.ts` (12 → 0) et `pipeline-invariants.test.ts` (9 → 0)

Ces deux fichiers narratifs enchaînent de nombreuses requêtes qui partagent
le même mock `supabase.from` : dès qu'UN test au milieu de la chaîne
consomme le mauvais nombre de mocks, tout ce qui suit reçoit des données
désynchronisées et échoue en cascade avec des symptômes qui n'ont souvent
aucun rapport apparent avec la vraie cause (ex. un `numero` de facture qui
affiche en fait le `numero` d'une commande). Corriger le POINT DE DÉPART
exact de la désynchronisation a suffi à faire retomber presque toute la
cascade — la vraie difficulté était de le localiser, pas de le corriger.

Causes distinctes trouvées dans ces deux fichiers :
- **`POST /devis` (`ensureClient`)** : quand `client_id` est fourni, le
  handler appelle désormais `ensureClient(...)` (client-sync.service),
  jusque-là absent des séquences de mocks. Si le client mocké n'a pas de
  champ `updated_at` (ou `pays`), `mergeMissing()` les juge manquants et
  déclenche un `UPDATE` — 2 appels `.from('clients')` supplémentaires
  (lookup + update), pas 0.
- **`POST /devis/:id/transformer-commande` (§37 + moteur de crédit)** :
  l'ordre a changé — le verrou d'idempotence (`UPDATE devis SET
  statut='transforme' ... WHERE statut IN (...)`) a lieu AVANT la création
  de la commande, pas après comme l'ancien code (et les commentaires de
  test) le supposaient. Ensuite, `ensureFactureForCommande()` et
  `syncCreditForCommande()` sont appelés systématiquement — mockés
  directement (`vi.mock('.../finance-core.service', ...)`) plutôt que
  rejouée leur cascade.
- **Devis Zod schema** : `condition_paiement_id` (UUID) est désormais
  requis à la création — les payloads de test qui envoyaient encore
  `conditions_paiement` (libellé libre, champ disparu) échouaient au 400
  Zod avant même d'atteindre la logique métier.
- **`PATCH /bons/:id/preparateur` lit `employes`, plus `profiles`** — et
  exige `statut: 'actif'` sur l'employé. Le fixture `PREP_PROFILE` utilisait
  encore la forme `{full_name, phone}` d'un ancien schéma ; corrigé en
  `{nom, poste, departement, telephone, statut: 'actif'}`.
- **Refactor architectural plus large — création de livraison auto après
  préparation** : la logique qui créait la livraison "en_preparation"
  (autrefois en ligne dans les routes) vit maintenant dans
  `ensureWorkflowApresPreparationBon()` (commande-workflow.service),
  elle-même dérivée de `resolveCommandeContext()` +
  `ensureLivraisonEnPreparationForCommande()`. Conséquence pour les tests :
  compter les appels `.from()` bruts (I8/I9 dans pipeline-invariants) ne
  permet plus de distinguer "livraison créée" de "livraison déjà
  existante", puisque cette logique est encapsulée dans une fonction de
  service qu'on mocke à la frontière. **Décision assumée** : P05/P06 ont
  été réécrits pour vérifier que `ensureWorkflowApresPreparationBon` est
  appelée (ou non) avec les bons paramètres, plutôt que de compter des
  appels DB — un test plus précis sur l'invariant réel (le déclenchement),
  mais qui ne peut plus vérifier l'idempotence interne à ce service (elle
  mériterait son propre test unitaire dans un fichier dédié à
  `commande-workflow.service`, pas ici).

### `commerce.test.ts` (8 → 0) — la mise en garde n'a pas empêché le fix chirurgical

Confirme et étend le mécanisme de la Découverte n°1 (cache RBAC partagé,
vu sur `rh.test.ts`) :
- **C1** (premier test du fichier, cache froid) échouait par consommation
  de mock — fix identique à RH1 : 2 mocks RBAC ajoutés en tête de la queue.
- **C6 "403 opérateur"** et **C10 "403 apprenant"** héritaient à tort du
  cache SUPER_ADMIN posé par un test 'admin' antérieur — fix identique :
  userId dédié (`authHeaders(role, 'test-uid-xxx-deny')`).
- **Mock `offline-fallback` incomplet** (déjà repéré dans la session
  précédente comme cause de C7) : `isNetworkError` manquait de l'export
  mocké, provoquant un crash dans le error handler global de `app.ts` dès
  qu'une route jetait une erreur. Ajouté (`vi.fn().mockReturnValue(false)`).
- **Mock `finance-core.service` incomplet** : ne fournissait que
  `enregistrerPaiementCommande`/`ensureFactureForCommande`, alors que
  `commerce.ts` importe aussi `getFactureActiveByCommande`,
  `solderCreditsForCommande`, `syncCreditForCommande` (moteur de crédit,
  §37) — undefined à l'appel. Complété.
- **Bug de fixture le plus subtil de la session** : `GET /devis` (liste)
  auto-expire en base les devis dont `date_validite` est dépassée, et
  **mute directement en mémoire l'objet reçu** (`(d as
  {statut}).statut = 'expire'`) avant de répondre — cf. `routes/commerce.ts`
  ligne ~942. Le test C4 (liste) réutilisait la constante partagée `DEVIS`
  (référence unique, pas une copie) comme donnée mockée, avec une
  `date_validite` figée à '2026-06-30' — devenue une date PASSÉE au moment
  où cette session tourne (26/09/2026). Résultat : C4 mutait
  silencieusement `DEVIS.statut` à `'expire'` pour le reste de l'exécution
  du fichier, et C5 (création, plus loin dans le fichier) recevait cette
  même constante corrompue comme valeur de retour de son `INSERT` mocké —
  échouant sur une assertion de statut totalement sans rapport apparent
  avec la vraie cause. Fix : `date_validite` de la fixture calculée
  dynamiquement dans le futur (`${anneeCourante + 1}-06-30`) plutôt que
  codée en dur — le genre de piège qui réapparaîtra ailleurs si d'autres
  fixtures partagées gardent des dates figées.
- **Devis Zod schema** : même ajout `condition_paiement_id` que dans
  journee-complete/pipeline-invariants (`DEVIS_CREATE_BODY`).

## Phase 6 (suite, 26/09 nuit — suite 2) — Dernier fichier : `03-pipeline-commande.test.ts` (4 → 0)

Réécrit en entier plutôt que corrigé, comme prévu en Découverte n°5.
Changements par rapport à l'ancien stub générique :
- **`POST /initier`** : mock `fetch` retournant le contrat réel
  `{status:'REQUEST_OK', data:{id, status}}` (pas `{transaction:{...}}`) ;
  `NOKASH_APPLICATION_KEY`/`NOKASH_INTEGRATION_KEY` positionnés dans
  `process.env` (sinon 503 `PAYMENT_NOT_CONFIGURED` avant tout appel
  réseau) ; assertion que l'appel sortant porte bien un header
  `hmac-signature` ; `checkout_url` attendu à `null` (Mobile Money direct,
  pas de redirection — le stub imaginait un flux checkout web).
- **Webhook "payment.complete"** renommé et corrigé : le corps du webhook
  (`payload.status`) n'est PAS ce qui déclenche la confirmation — c'est le
  résultat d'un second appel `fetch` séparé (revérification via
  `status-request`) qui fait foi. Le test mocke maintenant CET appel, pas
  le payload. Titre débarrassé de l'affirmation "stock déduit" : le code
  précise explicitement que le paiement ne touche jamais le stock (seule
  l'exécution du bon de sortie le fait) — l'ancien titre affirmait un
  comportement que le code n'a jamais eu.
- **Webhook "payment.failed"** : même correction (mock de la
  revérification, pas du payload entrant).
- **Remplacement du test "signature invalide → 401"** (comportement qui
  n'existe plus) par un test de la propriété de sécurité qui l'a
  remplacée : si la revérification NOKASH échoue (réseau injoignable),
  la route renvoie 200 `{received:true}` SANS jamais toucher la DB
  (`expect(mockFrom).not.toHaveBeenCalled()`) — aucune confirmation
  prématurée sur la seule foi du corps reçu, le prochain poll client
  retentera. C'est exactement l'invariant que le choix "pas de signature,
  revérification systématique" est censé garantir.
- `resolveCommandeContext` (commande-workflow.service) et
  `enregistrerPaiementCommande` (finance-core.service) mockés directement
  (hors scope : ces tests couvrent une commande web pure, sans commande
  ERP liée) — même pattern que le reste de cette session.

## Dette de tests — soldée

**Suite `apps/api` complète : 451/451 verts.** Partie de 66 échecs répartis
sur 13 fichiers au début de cette journée (26/09/2026) ; zéro fichier
restant. Les enseignements durables de cette dette (cache RBAC partagé
entre tests, pattern de mock par table plutôt que par position, ne jamais
mocker `checkPermission` en bloc sur un fichier qui dépend du vrai
fallback, vérifier les invariants à la frontière de service plutôt qu'en
comptant des appels DB bruts quand la logique est déplacée vers un
service dédié) restent documentés plus haut dans ce fichier pour la
prochaine fois qu'une dette de ce genre s'accumule ailleurs dans le projet.

## Comment reprendre — s'il y a une prochaine fois

Il n'y a plus de fichier en échec dans `apps/api` au moment d'écrire ceci.
Pour tout futur fichier de dette RBAC qui réapparaîtrait ailleurs dans le
projet, le pattern qui a marché systématiquement cette session est :
mocker `rbacService` directement (`checkPermission: vi.fn()`) plutôt que
laisser tourner le vrai fallback — SAUF si le fichier a déjà une majorité
de tests verts qui dépendent de ce fallback réel (repérable : pas de
`vi.mock('.../rbacService', ...)` dans le fichier), auquel cas un fix
chirurgical par test qui échoue vraiment est obligatoire (jamais de mock
en bloc a posteriori — cf. Découverte n°1, testé et confirmé deux fois
cette session sur `rh.test.ts` et `commerce.test.ts`).

## 27/09/2026 — "Fix all gaps, real and partial" (RLS explicitement exclu)

Suite au rapport d'état contre le Master Prompt V3, l'utilisateur a
demandé de combler tous les écarts ❌/🟡 identifiés, sauf RLS sur
familles/modeles/modele_specifications (laissé de côté explicitement).
Cinq chantiers, tous vérifiés à 100% (suite complète `apps/api` :
**473/473 verts**, aucune régression, aucune nouvelle erreur `tsc`) :

- **A. `modeles.unite_facturation_id`** (§9/10) — migration
  `20260928_modeles_unite_facturation_fk.sql` : nouvelle colonne FK
  nullable vers `unites_facturation`, backfill par correspondance de code.
  Bug latent découvert au passage : le défaut Zod appliqué à la création
  d'un modèle était `'unité'` (avec accent) alors que le code réel seedé
  est `'unite'` (sans accent) — aucun modèle créé sans unité explicite ne
  pouvait donc jamais être rattaché au référentiel. Corrigé (défaut Zod +
  normalisation des données existantes). La FK est désormais résolue et
  écrite automatiquement côté API (`resolveUniteFacturationId` dans
  `catalogue.ts`) à chaque création/modification de modèle, sans changer
  le contrat de la route (le front continue d'envoyer du texte libre).
- **B. `GET /commandes/:id/production`** (§34) — manquait entièrement sous
  ce nom. Plutôt que dupliquer la requête déjà écrite pour
  `GET /production/historique/:commande_id` (operations.ts), la logique a
  été extraite dans `chargerJobsProductionCommande()`
  (`commande-workflow.service.ts`) et les deux routes l'appellent
  désormais — conforme à la consigne du Master Prompt "étendre l'existant,
  ne pas dupliquer".
- **C. Test §48** (`__tests__/integration/48-pipeline-e2e.test.ts`) — le
  test critique de non-régression marqué "pas encore écrit" dans le
  document source. Portée assumée et documentée en tête de fichier : la
  chaîne neuve des Phases 1-4 (calcul auto → devis → commande → production)
  est testée bout en bout avec propagation réelle des IDs d'une étape à
  l'autre (aucun ID deviné) ; facture/acompte et le module Livraison, déjà
  couverts ailleurs (`commerce.test.ts` C10, `finance-core.test.ts`,
  `logistique.test.ts`), ne sont pas re-détaillés — seule la jonction
  (ensureFactureForCommande appelé avec le bon commande_id) est vérifiée.
- **D. Auto-création jobs_production** — le déclencheur réel
  (`PATCH /commandes/:id/statut` → `in_production`) n'était couvert que
  via la route manuelle `POST /production/jobs`. Deux tests ajoutés dans
  `commerce.test.ts` (C8c) : création d'un job par ligne réelle de la
  commande, et non-recréation si des jobs existent déjà (idempotence).
- **E. Sélecteur Famille → Modèle** (§41.B, `Devis.tsx`) — la liste plate
  de modèles a été regroupée par famille (`<optgroup>`, via `useFamilles()`
  déjà existant côté peer) plutôt que remplacée par un système de
  sélection en cascade à deux contrôles séparés : un seul appel réseau,
  aucun nouvel état par ligne, modèles orphelins (famille inactive/absente)
  toujours visibles sous "Autres" pour ne pas faire disparaître une
  sélection existante. Aucun test frontend n'existe pour `Devis.tsx` dans
  ce projet (aucune infra de test côté `apps/web`) — vérifié uniquement
  par `tsc --noEmit` (aucune nouvelle erreur).

RLS sur `familles`/`modeles`/`modele_specifications` reste un écart connu,
volontairement non traité — voir le rapport d'état pour le détail.
