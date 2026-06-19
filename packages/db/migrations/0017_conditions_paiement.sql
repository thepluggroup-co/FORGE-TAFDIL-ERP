-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0016 : Conditions de paiement + champs clients/commandes
--
-- 1. Crée la table conditions_paiement (référentiel)
-- 2. Ajoute score_fiabilite + plafond_credit_xaf sur clients
-- 3. Ajoute condition_paiement_id, montant_acompte_xaf,
--    date_echeance_solde, statut_paiement sur commandes
-- 4. Insère les 6 conditions de référence TAFDIL
--
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / DO blocks).
-- Nom de colonne : delai_solde_jours (cohérent avec commerce.ts)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table conditions_paiement ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conditions_paiement (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT         NOT NULL UNIQUE,
  libelle           TEXT         NOT NULL,
  acompte_pct       NUMERIC(5,2) NOT NULL DEFAULT 100,
  delai_solde_jours INTEGER      NOT NULL DEFAULT 0,
  actif             BOOLEAN      NOT NULL DEFAULT true
);

-- Renommer delai_jours → delai_solde_jours si la table a été créée avec l'ancien nom
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name  = 'conditions_paiement'
      AND column_name = 'delai_jours'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name  = 'conditions_paiement'
      AND column_name = 'delai_solde_jours'
  ) THEN
    ALTER TABLE conditions_paiement RENAME COLUMN delai_jours TO delai_solde_jours;
  END IF;
END $$;

-- Ajouter la colonne si elle manque encore (table créée sans aucun des deux noms)
ALTER TABLE conditions_paiement
  ADD COLUMN IF NOT EXISTS delai_solde_jours INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE conditions_paiement
    ADD CONSTRAINT chk_conditions_paiement_acompte
    CHECK (acompte_pct >= 0 AND acompte_pct <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_conditions_paiement_actif ON conditions_paiement(actif);

-- RLS
ALTER TABLE conditions_paiement ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "authenticated full access" ON conditions_paiement
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Colonnes supplémentaires sur clients ───────────────────────────────────

-- Si score_fiabilite existe déjà en INTEGER (ancienne version), convertir en TEXT
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name   = 'clients'
      AND column_name  = 'score_fiabilite'
      AND data_type    = 'integer'
  ) THEN
    ALTER TABLE clients
      ALTER COLUMN score_fiabilite TYPE TEXT USING 'nouveau',
      ALTER COLUMN score_fiabilite SET DEFAULT 'nouveau';
  END IF;
END $$;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS score_fiabilite    TEXT    DEFAULT 'nouveau',
  ADD COLUMN IF NOT EXISTS plafond_credit_xaf INTEGER DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE clients
    ADD CONSTRAINT chk_clients_score_fiabilite
    CHECK (score_fiabilite IN ('nouveau', 'bon', 'tres_bon', 'vip', 'bloque'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_score_fiabilite ON clients(score_fiabilite);

-- ── 3. Colonnes supplémentaires sur commandes ─────────────────────────────────

ALTER TABLE commandes
  ADD COLUMN IF NOT EXISTS condition_paiement_id UUID    REFERENCES conditions_paiement(id),
  ADD COLUMN IF NOT EXISTS montant_acompte_xaf   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS date_echeance_solde   DATE,
  ADD COLUMN IF NOT EXISTS statut_paiement       TEXT    DEFAULT 'non_paye';

DO $$ BEGIN
  ALTER TABLE commandes
    ADD CONSTRAINT chk_commandes_statut_paiement
    CHECK (statut_paiement IN ('non_paye', 'acompte_recu', 'solde_recu', 'solde_en_retard'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_commandes_condition_paiement ON commandes(condition_paiement_id);
CREATE INDEX IF NOT EXISTS idx_commandes_statut_paiement    ON commandes(statut_paiement);
CREATE INDEX IF NOT EXISTS idx_commandes_date_echeance      ON commandes(date_echeance_solde);

-- ── 4. Données de référence ───────────────────────────────────────────────────

INSERT INTO conditions_paiement (code, libelle, acompte_pct, delai_solde_jours) VALUES
  ('P100',    'Comptant intégral',                                          100,  0),
  ('P30-LIV', '30% commande + solde à livraison',                           30,  0),
  ('P30-45',  '30% commande + crédit 45 jours',                             30, 45),
  ('P30-60',  '30% commande + crédit 60 jours',                             30, 60),
  ('PROJ-3T', '30% signature + 40% mi-chantier + 30% réception',            30,  0),
  ('PROJ-DG', 'Conditions spéciales — accord DG requis',                     0, 90)
ON CONFLICT (code) DO NOTHING;
