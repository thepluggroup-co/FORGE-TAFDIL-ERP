-- FORGE ERP - Paie: champs calcules et avances sur salaire

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS cnps_employeur_xaf double precision NOT NULL DEFAULT 0;

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS irpp_xaf double precision NOT NULL DEFAULT 0;

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS cout_employeur_xaf double precision NOT NULL DEFAULT 0;

ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS avance_deduite_xaf double precision NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bulletins_paie_employe_mois
  ON bulletins_paie(employe_id, mois);

CREATE TABLE IF NOT EXISTS avances_salaire (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id uuid NOT NULL REFERENCES employes(id) ON DELETE RESTRICT,
  sortie_id uuid REFERENCES sorties_tresorerie(id) ON DELETE SET NULL,
  date_avance text NOT NULL,
  mois_deduction text NOT NULL,
  montant_xaf double precision NOT NULL,
  montant_deduit_xaf double precision NOT NULL DEFAULT 0,
  statut text NOT NULL DEFAULT 'payee',
  mode_paiement text NOT NULL,
  compte_tresorerie text NOT NULL,
  reference_paiement text,
  motif text,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'synced',
  CONSTRAINT avances_salaire_mois_check CHECK (mois_deduction ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT avances_salaire_montant_check CHECK (montant_xaf > 0),
  CONSTRAINT avances_salaire_statut_check CHECK (statut IN ('payee', 'deduite', 'annulee')),
  CONSTRAINT avances_salaire_mode_check CHECK (mode_paiement IN ('caisse', 'banque', 'mobile_money')),
  CONSTRAINT avances_salaire_compte_check CHECK (compte_tresorerie IN ('571', '521'))
);

CREATE INDEX IF NOT EXISTS idx_avances_salaire_employe
  ON avances_salaire(employe_id);

CREATE INDEX IF NOT EXISTS idx_avances_salaire_mois
  ON avances_salaire(mois_deduction);

CREATE INDEX IF NOT EXISTS idx_avances_salaire_statut
  ON avances_salaire(statut);
