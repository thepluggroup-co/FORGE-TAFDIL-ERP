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

## Fichiers encore en échec (66 tests, 13 fichiers) — au 26/09/2026

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

## Comment reprendre

1. Ne jamais assouplir une route pour faire passer un test sans confirmer
   d'abord que la règle métier testée n'est plus voulue.
2. Pour les fichiers "RBAC non fait" : appliquer le pattern de
   `livraison-signature.test.ts` (mock direct de `checkPermission`).
3. Pour `bons.test.ts`, `logistique.test.ts` et les deux fichiers narratifs
   (`journee-complete`, `pipeline-invariants`) : d'abord ajouter aux
   fixtures les champs désormais exigés (`preparateur_id`,
   `statut_preparation: 'pret'` pour les bons ; mocker
   `verifierCommandeLivrable` ou son appel DB sous-jacent pour les
   livraisons), PUIS seulement s'attaquer au RBAC restant.
4. Relancer `pnpm exec vitest run` dans `apps/api` après chaque fichier —
   ne jamais committer un fichier "corrigé" sans l'avoir vu passer à 100%.
