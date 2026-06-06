CREATE TABLE IF NOT EXISTS relances_factures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id uuid NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id),
  canal text NOT NULL DEFAULT 'whatsapp',
  message text NOT NULL,
  statut text NOT NULL DEFAULT 'preparee' CHECK (statut IN ('preparee', 'envoyee')),
  relance_par uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relances_factures_facture
  ON relances_factures(facture_id, created_at DESC);
