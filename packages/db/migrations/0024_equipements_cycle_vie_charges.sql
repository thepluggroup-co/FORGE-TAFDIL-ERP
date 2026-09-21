-- Module Equipements : actifs atelier, cycle de vie, maintenances et lien charges

CREATE TABLE IF NOT EXISTS equipements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  designation text NOT NULL,
  categorie text NOT NULL DEFAULT 'outillage',
  statut text NOT NULL DEFAULT 'disponible',
  numero_serie text,
  fournisseur text,
  marque text,
  modele text,
  date_acquisition date,
  date_fin_garantie date,
  date_remplacement_prevue date,
  valeur_achat_xaf numeric(12,2) NOT NULL DEFAULT 0,
  valeur_residuelle_xaf numeric(12,2) NOT NULL DEFAULT 0,
  criticite text NOT NULL DEFAULT 'moyenne',
  emplacement text,
  responsable_id uuid REFERENCES employes(id) ON DELETE SET NULL,
  prochaine_revision date,
  intervalle_revision_j integer NOT NULL DEFAULT 365,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'synced'
);

CREATE TABLE IF NOT EXISTS maintenances_equipement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipement_id uuid NOT NULL REFERENCES equipements(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'preventive',
  date_maintenance date NOT NULL,
  technicien_id uuid REFERENCES employes(id) ON DELETE SET NULL,
  cout_xaf numeric(12,2) NOT NULL DEFAULT 0,
  description text,
  prochaine_date date,
  statut text NOT NULL DEFAULT 'planifie',
  charge_id uuid REFERENCES charges(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'synced'
);

ALTER TABLE equipements ADD COLUMN IF NOT EXISTS marque text;
ALTER TABLE equipements ADD COLUMN IF NOT EXISTS modele text;
ALTER TABLE equipements ADD COLUMN IF NOT EXISTS date_fin_garantie date;
ALTER TABLE equipements ADD COLUMN IF NOT EXISTS date_remplacement_prevue date;
ALTER TABLE equipements ADD COLUMN IF NOT EXISTS valeur_residuelle_xaf numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE equipements ADD COLUMN IF NOT EXISTS criticite text NOT NULL DEFAULT 'moyenne';
ALTER TABLE equipements ADD COLUMN IF NOT EXISTS sync_status sync_status NOT NULL DEFAULT 'synced';

ALTER TABLE maintenances_equipement ADD COLUMN IF NOT EXISTS charge_id uuid REFERENCES charges(id) ON DELETE SET NULL;
ALTER TABLE maintenances_equipement ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE maintenances_equipement ADD COLUMN IF NOT EXISTS sync_status sync_status NOT NULL DEFAULT 'synced';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'equipements'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%categorie%' OR pg_get_constraintdef(oid) ILIKE '%statut%' OR pg_get_constraintdef(oid) ILIKE '%criticite%')
  LOOP
    EXECUTE format('ALTER TABLE equipements DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'maintenances_equipement'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%type%' OR pg_get_constraintdef(oid) ILIKE '%statut%')
  LOOP
    EXECUTE format('ALTER TABLE maintenances_equipement DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE equipements
  ADD CONSTRAINT equipements_categorie_check CHECK (categorie IN (
    'machine_production', 'outillage', 'informatique', 'logiciel', 'vehicule',
    'securite', 'autre', 'outil', 'machine_legere', 'instrument', 'epi'
  ));

ALTER TABLE equipements
  ADD CONSTRAINT equipements_statut_check CHECK (statut IN (
    'disponible', 'en_service', 'maintenance', 'en_panne', 'hors_service', 'remplacement_prevu', 'cede'
  ));

ALTER TABLE equipements
  ADD CONSTRAINT equipements_criticite_check CHECK (criticite IN ('faible', 'moyenne', 'haute', 'critique'));

ALTER TABLE maintenances_equipement
  ADD CONSTRAINT maintenances_equipement_type_check CHECK (type IN (
    'preventive', 'corrective', 'calibrage', 'remplacement', 'panne', 'reparation', 'installation', 'audit'
  ));

ALTER TABLE maintenances_equipement
  ADD CONSTRAINT maintenances_equipement_statut_check CHECK (statut IN ('planifie', 'en_cours', 'fait', 'annule'));

CREATE INDEX IF NOT EXISTS idx_equipements_statut ON equipements(statut);
CREATE INDEX IF NOT EXISTS idx_equipements_categorie ON equipements(categorie);
CREATE INDEX IF NOT EXISTS idx_equipements_revision ON equipements(prochaine_revision);
CREATE INDEX IF NOT EXISTS idx_equipements_remplacement ON equipements(date_remplacement_prevue);
CREATE INDEX IF NOT EXISTS idx_maintenances_equipement_eq ON maintenances_equipement(equipement_id);
CREATE INDEX IF NOT EXISTS idx_maintenances_equipement_date ON maintenances_equipement(date_maintenance DESC);
CREATE INDEX IF NOT EXISTS idx_maintenances_equipement_charge ON maintenances_equipement(charge_id);
