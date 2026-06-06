DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'decl_statut') THEN
    CREATE TYPE decl_statut AS ENUM ('a_declarer', 'soumis', 'valide');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS declarations_fiscales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  periode text NOT NULL,
  statut decl_statut NOT NULL DEFAULT 'a_declarer',
  montant_xaf numeric(14,2) NOT NULL DEFAULT 0,
  echeance text NOT NULL,
  soumis_le timestamptz,
  valide_by uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'synced',
  UNIQUE (type, periode)
);

CREATE INDEX IF NOT EXISTS idx_declarations_fiscales_type_periode
  ON declarations_fiscales(type, periode);

CREATE INDEX IF NOT EXISTS idx_declarations_fiscales_statut
  ON declarations_fiscales(statut);
