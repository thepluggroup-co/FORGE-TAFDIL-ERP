-- ============================================================
-- Migration : Suivi des paiements par commande (CMD05)
-- NOTE : IDs UUID pour compatibilité avec Supabase PostgreSQL
-- ============================================================

CREATE TABLE IF NOT EXISTS paiements_commande (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id    UUID    NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  client_id      UUID    REFERENCES clients(id),
  montant_xaf    REAL    NOT NULL CHECK (montant_xaf > 0),
  methode        TEXT    NOT NULL DEFAULT 'mobile_money',
                 -- mobile_money | virement | especes | cheque | notchpay
  reference_ext  TEXT,
  statut         TEXT    NOT NULL DEFAULT 'confirme',
                 -- confirme | rejete | rembourse
  date_paiement  TEXT    NOT NULL,
  notes          TEXT,
  enregistre_par UUID    REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paiements_commande
  ON paiements_commande(commande_id);

ALTER TABLE commandes
  ADD COLUMN IF NOT EXISTS montant_paye_xaf REAL NOT NULL DEFAULT 0;

CREATE OR REPLACE VIEW v_commandes_solde AS
SELECT
  c.id,
  c.numero,
  c.client_nom,
  c.total_ttc_xaf,
  c.montant_paye_xaf,
  GREATEST(0, c.total_ttc_xaf - c.montant_paye_xaf) AS solde_restant_xaf,
  CASE
    WHEN c.montant_paye_xaf >= c.total_ttc_xaf THEN 'solde'
    WHEN c.montant_paye_xaf > 0                THEN 'partiel'
    ELSE                                             'impaye'
  END AS etat_paiement
FROM commandes c;
