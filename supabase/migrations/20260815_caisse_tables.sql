-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Module Caisse (vente au comptoir)
-- Cible : PostgreSQL / Supabase
-- Tous les montants en entiers FCFA (integer, pas real/numeric).
--
-- Réutilise les tables existantes : mouvements_stock (décrément stock côté
-- API lors de la validation d'un ticket), clients, produits,
-- conditions_paiement, customer_credit_limits — AUCUNE n'est recréée ici.
--
-- Convention ENUM native (DO $$ ... EXCEPTION WHEN duplicate_object) choisie
-- pour rester cohérente avec 20260607_credit_module.sql (même famille de
-- tables : montants FCFA, mêmes conventions de statut) et avec le miroir
-- Drizzle packages/db/src/schema.pg.ts (pgEnum).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE caisse_session_statut AS ENUM ('ouverte', 'fermee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_vente_statut AS ENUM ('paye', 'annule', 'rembourse');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE paiement_ticket_mode AS ENUM ('espece', 'orange_money', 'mtn_momo', 'credit', 'carte');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── caisse_sessions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.caisse_sessions (
  id                  uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  caissier_id         uuid                  NOT NULL REFERENCES public.profiles(id),
  date_ouverture      timestamptz           NOT NULL DEFAULT now(),
  date_fermeture      timestamptz,
  fond_ouverture_xaf  integer               NOT NULL,
  total_especes_xaf   integer               NOT NULL DEFAULT 0,
  total_om_xaf        integer               NOT NULL DEFAULT 0,
  total_momo_xaf      integer               NOT NULL DEFAULT 0,
  total_credit_xaf    integer               NOT NULL DEFAULT 0,
  ecart_xaf           integer,
  statut              caisse_session_statut NOT NULL DEFAULT 'ouverte',
  notes               text,
  updated_at          timestamptz           NOT NULL DEFAULT now(),
  sync_status         text                  NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_caisse_sessions_caissier
  ON public.caisse_sessions(caissier_id);

ALTER TABLE public.caisse_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "caisse_sessions_all" ON public.caisse_sessions;
CREATE POLICY "caisse_sessions_all" ON public.caisse_sessions FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN
  CREATE TRIGGER trg_caisse_sessions_updated_at
    BEFORE UPDATE ON public.caisse_sessions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── tickets_vente ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tickets_vente (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id           text                NOT NULL UNIQUE,   -- clé d'idempotence générée par le client
  numero_local    text,                                  -- numéro provisoire hors-ligne
  numero_facture  text,                                  -- numéro fiscal, rempli à la synchro serveur
  session_id      uuid                NOT NULL REFERENCES public.caisse_sessions(id),
  caissier_id     uuid                NOT NULL REFERENCES public.profiles(id),
  client_id       uuid                REFERENCES public.clients(id),   -- nullable : vente comptoir anonyme
  client_nom      text,
  total_ht_xaf    integer             NOT NULL,
  tva_xaf         integer             NOT NULL,
  total_ttc_xaf   integer             NOT NULL,
  remise_xaf      integer             NOT NULL DEFAULT 0,
  statut          ticket_vente_statut NOT NULL DEFAULT 'paye',
  created_at      timestamptz         NOT NULL DEFAULT now(),
  updated_at      timestamptz         NOT NULL DEFAULT now(),
  sync_status     text                NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_tickets_vente_session ON public.tickets_vente(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_vente_op_id ON public.tickets_vente(op_id);

ALTER TABLE public.tickets_vente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tickets_vente_all" ON public.tickets_vente;
CREATE POLICY "tickets_vente_all" ON public.tickets_vente FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN
  CREATE TRIGGER trg_tickets_vente_updated_at
    BEFORE UPDATE ON public.tickets_vente
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── lignes_ticket ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lignes_ticket (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          uuid    NOT NULL REFERENCES public.tickets_vente(id) ON DELETE CASCADE,
  produit_id         uuid    REFERENCES public.produits(id),   -- nullable : article libre
  designation        text    NOT NULL,
  unite              text    NOT NULL DEFAULT 'unité',
  quantite           real    NOT NULL,
  prix_unitaire_xaf  integer NOT NULL,
  total_ligne_xaf    integer NOT NULL,
  ordre              integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lignes_ticket_ticket ON public.lignes_ticket(ticket_id);

ALTER TABLE public.lignes_ticket ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lignes_ticket_all" ON public.lignes_ticket;
CREATE POLICY "lignes_ticket_all" ON public.lignes_ticket FOR ALL USING (true) WITH CHECK (true);

-- ── paiements_ticket ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.paiements_ticket (
  id                 uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          uuid                 NOT NULL REFERENCES public.tickets_vente(id) ON DELETE CASCADE,
  mode               paiement_ticket_mode NOT NULL,
  montant_xaf        integer              NOT NULL,
  montant_recu_xaf   integer,             -- pour espèces
  rendu_xaf          integer,
  reference          text,                -- ex. réf transaction mobile money
  created_at         timestamptz          NOT NULL DEFAULT now(),
  sync_status        text                 NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_paiements_ticket_ticket ON public.paiements_ticket(ticket_id);

ALTER TABLE public.paiements_ticket ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paiements_ticket_all" ON public.paiements_ticket;
CREATE POLICY "paiements_ticket_all" ON public.paiements_ticket FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- APPLICATION — cette migration N'A PAS été exécutée.
--
-- Option A (Supabase Dashboard → SQL Editor) :
--   Coller le contenu de ce fichier → Run.
--
-- Option B (CLI Supabase, si le projet est lié) :
--   supabase db push
--
-- Option C (accès direct psql) :
--   psql "$DATABASE_URL" -f supabase/migrations/20260815_caisse_tables.sql
--
-- Point d'arrêt demandé : appliquer d'abord sur une base de TEST, vérifier
-- que les 4 tables se créent sans erreur et sans casser les tables
-- existantes (clients, produits, profiles, mouvements_stock, etc.), avant
-- toute application sur la base de production.
-- ═══════════════════════════════════════════════════════════════════════════
