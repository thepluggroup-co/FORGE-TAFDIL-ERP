-- Table de log des relances WhatsApp automatiques (MOD-04 CDC)
CREATE TABLE IF NOT EXISTS relances_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id    UUID NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  type_relance TEXT NOT NULL CHECK (type_relance IN ('j_moins_7', 'echeance_aujourdhui', 'echu', 'manuel')),
  telephone    TEXT,
  message      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE relances_log ENABLE ROW LEVEL SECURITY;

-- Lecture : directeur et admin
CREATE POLICY "relances_log_select" ON relances_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('directeur', 'admin')
    )
  );

-- Insertion : autorisée (inséré par l'API avec service role)
CREATE POLICY "relances_log_insert" ON relances_log
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_relances_log_credit_id ON relances_log(credit_id);
CREATE INDEX IF NOT EXISTS idx_relances_log_created_at ON relances_log(created_at DESC);
