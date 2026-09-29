-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 — Moteur de calcul : rebrancher fiche_technique sur `modeles`
-- (catalogue produits finis, Phase 1) au lieu de `produits`.
--
-- Contexte : fiche_technique a été créée le 25/09 (Master Prompt V3 Phases 1-4)
-- en pointant sur `produits.id`, avant que la Phase 1 du 26/09 ne sépare
-- proprement le catalogue produits finis (familles/modeles) du stock de
-- matières premières (produits). Aucune ligne n'a jamais été insérée dans
-- fiche_technique (vérifié : aucune migration ne la seed, table neuve non
-- utilisée en production) — un simple renommage de colonne suffit, sans
-- migration de données.
--
-- `fiche_technique_ressources.ressource_produit_id` N'EST PAS touché : les
-- ressources (matériaux/consommables) restent correctement rattachées à
-- `produits` (le stock existant, 328 lignes). Seule l'entité "de quel modèle
-- s'agit-il" change, pas "avec quelles matières premières on le fabrique".
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.fiche_technique RENAME COLUMN produit_id TO modele_id;

-- Le renommage de colonne préserve la contrainte UNIQUE(produit_id, version)
-- (Postgres suit les colonnes par attnum, pas par nom) — elle s'applique
-- désormais correctement à (modele_id, version), seul son nom généré
-- automatiquement (fiche_technique_produit_id_version_key) reste cosmétique-
-- ment obsolète. Non renommé ici : aucun impact fonctionnel, risque de
-- casser une migration sur un nom de contrainte deviné à tort.

-- La FK, elle, DOIT être recréée : le renommage de colonne ne change pas la
-- table référencée (produits), qui est maintenant fausse pour cette colonne.
-- Nom de la contrainte retrouvé dynamiquement plutôt que deviné, pour rester
-- robuste si Postgres l'a nommée différemment de la convention par défaut.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'fiche_technique'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'modele_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.fiche_technique DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE public.fiche_technique
  ADD CONSTRAINT fiche_technique_modele_id_fkey
  FOREIGN KEY (modele_id) REFERENCES public.modeles(id);

-- Index : renommés pour rester lisibles (contrairement à la contrainte UNIQUE
-- ci-dessus, un DROP/CREATE d'index est sans risque, pas de données à perdre).
DROP INDEX IF EXISTS idx_fiche_technique_produit;
CREATE INDEX IF NOT EXISTS idx_fiche_technique_modele ON public.fiche_technique(modele_id);

DROP INDEX IF EXISTS idx_fiche_technique_une_active_par_produit;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fiche_technique_une_active_par_modele
  ON public.fiche_technique(modele_id) WHERE statut = 'active';

-- ── Vérification ─────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Phase 2 (rebranchement modele) appliquée : % fiches techniques',
    (SELECT count(*) FROM public.fiche_technique);
END $$;
