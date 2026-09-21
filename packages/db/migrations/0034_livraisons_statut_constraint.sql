-- Migration 0034 — Normalisation statuts legacy + contrainte étendue livraisons
-- Appliquer APRÈS avoir vérifié la contrainte actuelle avec :
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'livraisons'::regclass AND contype = 'c';

-- ── 1. Supprimer la contrainte existante D'ABORD ─────────────────────────────
-- (la contrainte actuelle contient 'confirmed' mais pas 'planifiee' —
-- l'UPDATE échouerait si la contrainte est encore active)
ALTER TABLE livraisons
  DROP CONSTRAINT IF EXISTS livraisons_statut_check;

-- ── 2. Normaliser les valeurs legacy (migration 0008 jamais appliquée) ────────
UPDATE livraisons SET statut = 'planifiee'  WHERE statut = 'confirmed';
UPDATE livraisons SET statut = 'en_transit' WHERE statut = 'pret';
UPDATE livraisons SET statut = 'livree'     WHERE statut = 'delivered';
UPDATE livraisons SET statut = 'annulee'    WHERE statut = 'cancelled';

-- ── 3. Recréer la contrainte avec les valeurs complètes ───────────────────────

ALTER TABLE livraisons
  ADD CONSTRAINT livraisons_statut_check
  CHECK (statut IN (
    'en_preparation',   -- auto-créée par le workflow bons de sortie
    'planifiee',        -- confirmée, prête à être planifiée
    'en_route',         -- livreur en route (logistique.ts)
    'livree',           -- livrée avec succès
    'echec_livraison',  -- tentative échouée
    'annulee',          -- annulée
    'en_transit'        -- rétro-compatibilité operations.ts
  ));
