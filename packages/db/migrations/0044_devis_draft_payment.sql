ALTER TABLE devis ADD COLUMN IF NOT EXISTS note_client TEXT;
CREATE TABLE IF NOT EXISTS devis_reglages (
  id TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  validite_jours INTEGER NOT NULL DEFAULT 30 CHECK (validite_jours > 0),
  conditions_paiement TEXT NOT NULL DEFAULT '',
  condition_paiement_id UUID REFERENCES conditions_paiement(id),
  acompte_pct REAL NOT NULL DEFAULT 30 CHECK (acompte_pct BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO devis_reglages (id) VALUES ('singleton') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS devis_brouillons (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contenu JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE devis_brouillons ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut = 'brouillon');
