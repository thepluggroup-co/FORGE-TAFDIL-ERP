-- 0027 : Système de remises — barème, colonnes lignes et entêtes

DO $$ BEGIN
  CREATE TYPE remise_type_enum AS ENUM ('pct', 'forfait');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS remises_bareme (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      TEXT NOT NULL UNIQUE,
  libelle                   TEXT NOT NULL,
  type                      remise_type_enum NOT NULL DEFAULT 'pct',
  valeur                    REAL NOT NULL,
  condition_anciennete_mois INTEGER NOT NULL DEFAULT 0,
  score_min                 TEXT NOT NULL DEFAULT 'nouveau',
  accord_dg_requis          BOOLEAN NOT NULL DEFAULT false,
  actif                     BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Colonnes remise sur les lignes
ALTER TABLE devis_lignes
  ADD COLUMN IF NOT EXISTS remise_type     TEXT,
  ADD COLUMN IF NOT EXISTS remise_valeur   REAL,
  ADD COLUMN IF NOT EXISTS remise_xaf      REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_motif    TEXT,
  ADD COLUMN IF NOT EXISTS applique_par_id UUID REFERENCES profiles(id);

ALTER TABLE commandes_lignes
  ADD COLUMN IF NOT EXISTS remise_type     TEXT,
  ADD COLUMN IF NOT EXISTS remise_valeur   REAL,
  ADD COLUMN IF NOT EXISTS remise_xaf      REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_motif    TEXT,
  ADD COLUMN IF NOT EXISTS applique_par_id UUID REFERENCES profiles(id);

ALTER TABLE factures_lignes
  ADD COLUMN IF NOT EXISTS remise_type     TEXT,
  ADD COLUMN IF NOT EXISTS remise_valeur   REAL,
  ADD COLUMN IF NOT EXISTS remise_xaf      REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_motif    TEXT,
  ADD COLUMN IF NOT EXISTS applique_par_id UUID REFERENCES profiles(id);

-- Colonnes remise sur les entêtes
ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS remise_globale_xaf   REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_globale_motif TEXT,
  ADD COLUMN IF NOT EXISTS net_a_payer_xaf      REAL;

ALTER TABLE commandes
  ADD COLUMN IF NOT EXISTS remise_globale_xaf   REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_globale_motif TEXT,
  ADD COLUMN IF NOT EXISTS net_a_payer_xaf      REAL;

ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS remise_globale_xaf   REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remise_globale_motif TEXT,
  ADD COLUMN IF NOT EXISTS net_a_payer_xaf      REAL;

-- Indices pour les rapports de remises
CREATE INDEX IF NOT EXISTS idx_devis_lignes_remise     ON devis_lignes(remise_xaf)     WHERE remise_xaf > 0;
CREATE INDEX IF NOT EXISTS idx_commandes_lignes_remise ON commandes_lignes(remise_xaf) WHERE remise_xaf > 0;

-- Barème initial (idempotent)
INSERT INTO remises_bareme (code, libelle, type, valeur, condition_anciennete_mois, score_min, accord_dg_requis)
VALUES
  ('FIDEL-5',   'Fidélité 5 %',         'pct',     5,    0, 'nouveau',  false),
  ('FIDEL-10',  'Fidélité 10 %',        'pct',    10,    0, 'nouveau',  false),
  ('FIDEL-15',  'Fidélité 15 %',        'pct',    15,    3, 'standard', false),
  ('FIDEL-20',  'Fidélité 20 %',        'pct',    20,    6, 'fiable',   false),
  ('NEGOC-25',  'Négociation 25 %',     'pct',    25,    6, 'fiable',   false),
  ('NEGOC-35',  'Négociation 35 %',     'pct',    35,    6, 'fiable',   false),
  ('DG-50',     'Accord DG 50 %',       'pct',    50,   12, 'premium',  true),
  ('FORC-100K', 'Forfait 100 000 XAF',  'forfait', 100000, 0, 'nouveau', false),
  ('FORC-500K', 'Forfait 500 000 XAF',  'forfait', 500000, 6, 'fiable',  false)
ON CONFLICT (code) DO NOTHING;
