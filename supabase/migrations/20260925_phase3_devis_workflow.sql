-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3 — Ajustement manuel des lignes de devis (§18/§39 Master Prompt V3)
--
-- Purement additive. Les colonnes `configuration`/`formule_utilisee` existent
-- déjà (migration Phase 1, 20260925_phase1_gamme_fiche_technique.sql).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.devis_lignes
  ADD COLUMN IF NOT EXISTS quantite_calculee   NUMERIC,
  ADD COLUMN IF NOT EXISTS cout_calcule_xaf    NUMERIC,
  ADD COLUMN IF NOT EXISTS ajuste_manuellement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ajuste_par_id       UUID,
  ADD COLUMN IF NOT EXISTS ajuste_le           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motif_ajustement    TEXT;

-- Vérification
DO $$
BEGIN
  RAISE NOTICE 'Phase 3 appliquée : colonnes d''ajustement manuel ajoutées à devis_lignes';
END $$;
