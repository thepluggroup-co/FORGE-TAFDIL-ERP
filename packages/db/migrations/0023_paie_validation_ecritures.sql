-- FORGE ERP - Paie: validation mensuelle et ecritures comptables

CREATE TABLE IF NOT EXISTS paie_periodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mois text NOT NULL UNIQUE,
  sortie_id uuid REFERENCES sorties_tresorerie(id) ON DELETE SET NULL,
  statut text NOT NULL DEFAULT 'calculee',
  nb_bulletins integer NOT NULL DEFAULT 0,
  total_brut_xaf double precision NOT NULL DEFAULT 0,
  cnps_salarie_xaf double precision NOT NULL DEFAULT 0,
  cnps_employeur_xaf double precision NOT NULL DEFAULT 0,
  irpp_xaf double precision NOT NULL DEFAULT 0,
  total_avances_deduites_xaf double precision NOT NULL DEFAULT 0,
  total_retenues_deduites_xaf double precision NOT NULL DEFAULT 0,
  total_autres_deductions_xaf double precision NOT NULL DEFAULT 0,
  net_a_payer_xaf double precision NOT NULL DEFAULT 0,
  cout_total_employeur_xaf double precision NOT NULL DEFAULT 0,
  mode_paiement text,
  compte_tresorerie text,
  reference_paiement text,
  notes text,
  validated_by uuid REFERENCES profiles(id),
  validated_at timestamptz,
  paid_by uuid REFERENCES profiles(id),
  paid_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'synced',
  CONSTRAINT paie_periodes_mois_check CHECK (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT paie_periodes_statut_check CHECK (statut IN ('calculee', 'validee', 'viree')),
  CONSTRAINT paie_periodes_mode_check CHECK (mode_paiement IS NULL OR mode_paiement IN ('caisse', 'banque', 'mobile_money')),
  CONSTRAINT paie_periodes_compte_check CHECK (compte_tresorerie IS NULL OR compte_tresorerie IN ('571', '521'))
);

CREATE INDEX IF NOT EXISTS idx_paie_periodes_statut
  ON paie_periodes(statut);

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES profiles(id);

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES profiles(id);

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
