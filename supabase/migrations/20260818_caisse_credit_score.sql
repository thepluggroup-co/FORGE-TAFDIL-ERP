-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Module Caisse : score de fiabilité crédit comptoir
--
-- Règle métier (demande explicite) :
--   - Tout client démarre avec un score_fiabilite_caisse = 10 (sur 10).
--   - Chaque paiement à crédit (paiements_ticket.mode='credit') non honoré à
--     l'échéance (30 jours, cf. apps/api/src/routes/caisse.ts) fait perdre
--     1 point (checkOverdueCaisseCredits, cron quotidien).
--   - Sous 5/10, le crédit comptoir est bloqué : credit_caisse_bloque_jusqu_au
--     est fixé à now() + 30 jours. Le client doit payer cash jusqu'à cette
--     date. Une fois la date passée, le score est remis à 10 (nouveau départ)
--     à la prochaine tentative de vente à crédit.
--
-- Distinct de clients.score_fiabilite existant (qui a un sens différent et
-- incohérent entre schema.ts/SQLite [integer, defaut 50] et schema.pg.ts/
-- Postgres [text, 'nouveau'/'bon'/...] — pré-existant, hors périmètre ici).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. clients — score et blocage crédit caisse ──────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS score_fiabilite_caisse integer NOT NULL DEFAULT 10;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS credit_caisse_bloque_jusqu_au timestamptz;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_score_fiabilite_caisse_range
  CHECK (score_fiabilite_caisse BETWEEN 0 AND 10);

-- ── 2. paiements_ticket — échéance et statut de remboursement (crédit) ──────

DO $$ BEGIN
  CREATE TYPE remboursement_caisse_statut AS ENUM ('en_attente', 'paye', 'en_retard');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.paiements_ticket
  ADD COLUMN IF NOT EXISTS date_echeance date;

ALTER TABLE public.paiements_ticket
  ADD COLUMN IF NOT EXISTS statut_remboursement remboursement_caisse_statut;

ALTER TABLE public.paiements_ticket
  ADD COLUMN IF NOT EXISTS date_remboursement timestamptz;

CREATE INDEX IF NOT EXISTS idx_paiements_ticket_echeance
  ON public.paiements_ticket(date_echeance)
  WHERE mode = 'credit' AND statut_remboursement = 'en_attente';

-- ── 3. Vérification ───────────────────────────────────────────────────────────

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'clients' AND column_name IN ('score_fiabilite_caisse', 'credit_caisse_bloque_jusqu_au'))
    OR (table_name = 'paiements_ticket' AND column_name IN ('date_echeance', 'statut_remboursement', 'date_remboursement')));

-- ═══════════════════════════════════════════════════════════════════════════
-- APPLICATION — cette migration N'A PAS été exécutée.
-- Supabase Dashboard → SQL Editor → coller le contenu → Run
-- ou : psql "$DATABASE_URL" -f supabase/migrations/20260818_caisse_credit_score.sql
-- ═══════════════════════════════════════════════════════════════════════════
