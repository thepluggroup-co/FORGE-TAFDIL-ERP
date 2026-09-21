-- Trace des exécutions du cron de réapprovisionnement stock
-- Pattern : même structure que relances_log (voir 0011_relances_factures.sql)

CREATE TABLE IF NOT EXISTS reappro_cron_log (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  bon_appro_id     UUID         REFERENCES bons_approvisionnement(id) ON DELETE SET NULL,
  numero           TEXT,
  nb_produits      INT          NOT NULL DEFAULT 0,
  produits_alertes JSONB,
  notification_ok  BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reappro_cron_log_created ON reappro_cron_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reappro_cron_log_bon     ON reappro_cron_log(bon_appro_id);
