-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — PHASE 1 : fondations produits
-- (ARCHITECTURE/TAFDIL_FORGE_AUDIT.md, décisions D2 et D3)
--
-- MÉTADONNÉES UNIQUEMENT : aucun schéma ni aucune donnée modifiés.
--
-- D3 — Le mode commercial STANDARD / CONFIGURABLE / QUOTE est une lecture
--      typée de la colonne existante type_gamme ('catalogue' / 'configuration'
--      / 'sur_mesure'), faite dans @forge/shared. Aucune valeur n'est migrée.
-- D2 — La hiérarchie officielle est l'arbre `familles` (Catégorie → Famille →
--      Sous-famille, 3 niveaux max, contrôlé par l'API à l'écriture).
--      produit_familles / produit_categories / produits.categorie_id (V3 Phase 1)
--      sont DÉPRÉCIÉS : jamais utilisés par le code, conservés sans DROP.
--
-- Rollback : COMMENT ON ... IS NULL sur les mêmes objets.
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN public.familles.type_gamme IS
  'Mode commercial PAR DÉFAUT des modèles de la famille : catalogue=STANDARD, configuration=CONFIGURABLE, sur_mesure=QUOTE (@forge/shared catalogue-commercial.ts).';
COMMENT ON COLUMN public.modeles.type_gamme IS
  'Mode commercial du modèle (prioritaire sur la famille ; NULL = hérite) : catalogue=STANDARD, configuration=CONFIGURABLE, sur_mesure=QUOTE.';
COMMENT ON COLUMN public.familles.parent_id IS
  'Hiérarchie Catégorie (racine) → Famille → Sous-famille, 3 niveaux maximum (contrôlé par l''API).';

COMMENT ON TABLE public.produit_familles IS
  'DÉPRÉCIÉ (Catalogue Hybride D2) — remplacé par l''arbre familles. Non utilisé ; conservé sans suppression.';
COMMENT ON TABLE public.produit_categories IS
  'DÉPRÉCIÉ (Catalogue Hybride D2) — remplacé par l''arbre familles. Non utilisé ; conservé sans suppression.';
COMMENT ON COLUMN public.produits.categorie_id IS
  'DÉPRÉCIÉ (Catalogue Hybride D2) — pointe vers produit_categories, non utilisé.';

-- ── Vérification : état de la hiérarchie existante (lecture seule) ─────────
DO $$
DECLARE
  trop_profondes INTEGER;
BEGIN
  WITH RECURSIVE arbre AS (
    SELECT id, parent_id, 1 AS profondeur FROM public.familles WHERE parent_id IS NULL
    UNION ALL
    SELECT f.id, f.parent_id, a.profondeur + 1
    FROM public.familles f JOIN arbre a ON f.parent_id = a.id
    WHERE a.profondeur < 10
  )
  SELECT count(*) INTO trop_profondes FROM arbre WHERE profondeur > 3;

  RAISE NOTICE 'Phase 1 : % familles, % modèles, % famille(s) au-delà de 3 niveaux (à reclasser manuellement si > 0)',
    (SELECT count(*) FROM public.familles),
    (SELECT count(*) FROM public.modeles),
    trop_profondes;
END $$;
