-- ============================================================
-- Migration : Index FK clients sur tous modules + table email_queue
-- NOTE : IDs UUID pour compatibilité avec Supabase PostgreSQL
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_devis_client_id
  ON devis(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commandes_client_id
  ON commandes(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_factures_client_id
  ON factures(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credits_client_id
  ON credits(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projets_client_id
  ON projets(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_livraisons_client_id
  ON livraisons(client_id) WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_nom_lower
  ON clients(lower(nom));

CREATE TABLE IF NOT EXISTS email_queue (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  destinataire    TEXT    NOT NULL,
  sujet           TEXT    NOT NULL,
  corps_html      TEXT    NOT NULL,
  statut          TEXT    NOT NULL DEFAULT 'en_attente',
  priorite        TEXT    NOT NULL DEFAULT 'normale',
  tentatives      INTEGER NOT NULL DEFAULT 0,
  max_tentatives  INTEGER NOT NULL DEFAULT 3,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  erreur          TEXT,
  reference_type  TEXT,
  reference_id    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_queue_statut
  ON email_queue(statut, scheduled_at) WHERE statut = 'en_attente';
