-- FORGE ERP - Paie: fiches, cotisations sociales et retenues

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS retenue_deduite_xaf double precision NOT NULL DEFAULT 0;

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS pdf_url text;

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;

CREATE TABLE IF NOT EXISTS retenues_salaire (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id uuid NOT NULL REFERENCES employes(id) ON DELETE RESTRICT,
  mois_deduction text NOT NULL,
  type text NOT NULL DEFAULT 'autre',
  libelle text NOT NULL,
  montant_xaf double precision NOT NULL,
  montant_deduit_xaf double precision NOT NULL DEFAULT 0,
  statut text NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'synced',
  CONSTRAINT retenues_salaire_mois_check CHECK (mois_deduction ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT retenues_salaire_montant_check CHECK (montant_xaf > 0),
  CONSTRAINT retenues_salaire_type_check CHECK (type IN ('absence', 'materiel', 'pret_interne', 'discipline', 'autre')),
  CONSTRAINT retenues_salaire_statut_check CHECK (statut IN ('active', 'deduite', 'annulee'))
);

CREATE INDEX IF NOT EXISTS idx_retenues_salaire_employe
  ON retenues_salaire(employe_id);

CREATE INDEX IF NOT EXISTS idx_retenues_salaire_mois
  ON retenues_salaire(mois_deduction);

CREATE TABLE IF NOT EXISTS cotisations_sociales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mois text NOT NULL UNIQUE,
  nb_bulletins integer NOT NULL DEFAULT 0,
  total_brut_xaf double precision NOT NULL DEFAULT 0,
  cnps_salarie_xaf double precision NOT NULL DEFAULT 0,
  cnps_employeur_xaf double precision NOT NULL DEFAULT 0,
  total_cnps_xaf double precision NOT NULL DEFAULT 0,
  irpp_xaf double precision NOT NULL DEFAULT 0,
  total_avances_deduites_xaf double precision NOT NULL DEFAULT 0,
  total_retenues_deduites_xaf double precision NOT NULL DEFAULT 0,
  net_a_payer_xaf double precision NOT NULL DEFAULT 0,
  cout_total_employeur_xaf double precision NOT NULL DEFAULT 0,
  statut text NOT NULL DEFAULT 'calculee',
  notes text,
  created_by uuid REFERENCES profiles(id),
  validated_by uuid REFERENCES profiles(id),
  validated_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'synced',
  CONSTRAINT cotisations_sociales_mois_check CHECK (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT cotisations_sociales_statut_check CHECK (statut IN ('calculee', 'validee', 'payee'))
);

CREATE INDEX IF NOT EXISTS idx_cotisations_sociales_statut
  ON cotisations_sociales(statut);
