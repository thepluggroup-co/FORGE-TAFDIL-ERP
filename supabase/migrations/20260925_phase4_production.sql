-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4 — Production (§27/§28/§30/§31 Master Prompt V3)
--
-- IMPORTANT : cette migration corrige un bug PRÉ-EXISTANT, indépendant des
-- Phases 1 à 3. `creerJobsProductionCommande` (apps/api/src/routes/commerce.ts)
-- insère depuis longtemps des lignes dans `jobs_production` avec les colonnes
-- `type_job`, `produit_id`, `unite`, `quantite_prevue`, `prix_unitaire_xaf`.
-- Aucune de ces colonnes n'existe dans le schéma réel (vérifié dans les 3
-- fichiers qui définissent `jobs_production` : 20260519_operations_tables.sql,
-- 20260524_core_tables_complete.sql, MASTER_MIGRATION.sql). L'appel est
-- entouré d'un `.catch()` qui avale l'erreur et logue seulement en console
-- (`console.error('[commerce] auto-jobs-production:', ...)`) — en pratique,
-- AUCUN job de production n'est donc jamais créé automatiquement aujourd'hui
-- quand une commande passe en 'in_production', silencieusement.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.jobs_production
  ADD COLUMN IF NOT EXISTS type_job          TEXT,
  ADD COLUMN IF NOT EXISTS produit_id        UUID REFERENCES public.produits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unite             TEXT,
  ADD COLUMN IF NOT EXISTS quantite_prevue   NUMERIC,
  ADD COLUMN IF NOT EXISTS prix_unitaire_xaf NUMERIC,
  -- §27 — Le job doit pouvoir récupérer matériaux/main-d'œuvre/équipements, pas
  -- seulement la quantité vendue. On stocke ici le détail déjà calculé par le
  -- moteur de devis (Phase 2), figé au moment de la création du devis
  -- (devis.ressources_snapshot, Phase 3) — même logique de snapshot qu'ailleurs :
  -- si la fiche technique change demain, un job déjà lancé n'est pas affecté.
  ADD COLUMN IF NOT EXISTS ressources_besoin JSONB;

CREATE INDEX IF NOT EXISTS idx_jobs_production_produit ON public.jobs_production(produit_id);

DO $$
BEGIN
  RAISE NOTICE 'Phase 4 appliquée : jobs_production complété (type_job, produit_id, unite, quantite_prevue, prix_unitaire_xaf, ressources_besoin)';
END $$;
