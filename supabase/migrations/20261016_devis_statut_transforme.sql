-- ═══════════════════════════════════════════════════════════════════════════
-- Devis : autoriser le statut « transforme » (devis devenu commande)
--
-- La contrainte d'origine (20260524_core_tables_complete.sql) n'acceptait que
-- brouillon / envoye / accepte / refuse / expire. Or POST /devis/:id/
-- transformer-commande marque d'abord le devis « transforme » (verrou contre
-- les doubles commandes) : la base refusait l'opération —
--   new row for relation "devis" violates check constraint "devis_statut_check"
-- — et aucun devis n'a jamais pu devenir une commande.
--
-- APPLICATION — Supabase Dashboard → SQL Editor → coller → Run. Ré-exécutable.
-- Rollback (seulement s'il n'existe aucun devis « transforme ») : recréer la
-- contrainte sans 'transforme'.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.devis DROP CONSTRAINT IF EXISTS devis_statut_check;
ALTER TABLE public.devis
  ADD CONSTRAINT devis_statut_check
  CHECK (statut IN ('brouillon', 'envoye', 'accepte', 'refuse', 'expire', 'transforme'));

-- ── Vérification ──────────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.devis'::regclass AND conname = 'devis_statut_check';
