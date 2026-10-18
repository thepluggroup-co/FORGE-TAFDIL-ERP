-- Gammes explicites par variante et réglages société utilisés sur les documents.
ALTER TABLE fiche_technique_ressources
  ADD COLUMN IF NOT EXISTS gamme_section TEXT;

CREATE TABLE IF NOT EXISTS fiche_technique_variantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiche_technique_id UUID NOT NULL REFERENCES fiche_technique(id) ON DELETE CASCADE,
  variante TEXT NOT NULL,
  ressource_produit_id UUID NOT NULL REFERENCES produits(id),
  designation TEXT NOT NULL,
  unite TEXT NOT NULL DEFAULT 'unité',
  quantite_par_unite NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (quantite_par_unite > 0),
  gamme_section TEXT,
  ordre INTEGER NOT NULL DEFAULT 0,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fiche_technique_id, variante, ressource_produit_id)
);

CREATE TABLE IF NOT EXISTS societe_reglages (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nom TEXT NOT NULL DEFAULT 'TAFDIL SARL',
  activite TEXT NOT NULL DEFAULT 'Étude, conception, réalisation, conseil, formation, entretien, menuiserie métallique et aluminium, vente de matériel et accessoires',
  directeur TEXT NOT NULL DEFAULT 'Carmel TANEKEU',
  telephones TEXT NOT NULL DEFAULT '+237 695 88 45 28 / +237 676 39 76 91',
  site TEXT NOT NULL DEFAULT 'www.tafdil.com',
  adresse TEXT NOT NULL DEFAULT 'Kotto, face école Mauryvanas',
  email TEXT NOT NULL DEFAULT 'tafdilsarl@gmail.com',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO societe_reglages (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
