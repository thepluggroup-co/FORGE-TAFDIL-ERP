-- Module Charges : charges entreprise, sorties d'argent et justificatifs

CREATE TABLE IF NOT EXISTS charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  fournisseur_nom text NOT NULL,
  categorie text NOT NULL,
  compte_charge text NOT NULL,
  compte_charge_label text NOT NULL,
  date_charge date NOT NULL,
  date_echeance date,
  statut text NOT NULL DEFAULT 'brouillon',
  montant_ht_xaf numeric(12,2) NOT NULL DEFAULT 0,
  tva_xaf numeric(12,2) NOT NULL DEFAULT 0,
  montant_ttc_xaf numeric(12,2) NOT NULL DEFAULT 0,
  montant_paye_xaf numeric(12,2) NOT NULL DEFAULT 0,
  mode_paiement text,
  compte_tresorerie text,
  reference_paiement text,
  justificatif_statut text NOT NULL DEFAULT 'manquant',
  description text,
  notes text,
  commande_id uuid REFERENCES commandes(id) ON DELETE SET NULL,
  projet_id uuid REFERENCES projets(id) ON DELETE SET NULL,
  equipement_id uuid,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'pending',
  CONSTRAINT charges_statut_check CHECK (statut IN ('brouillon', 'a_valider', 'validee', 'payee', 'annulee')),
  CONSTRAINT charges_justificatif_statut_check CHECK (justificatif_statut IN ('manquant', 'recu', 'non_requis')),
  CONSTRAINT charges_mode_paiement_check CHECK (mode_paiement IS NULL OR mode_paiement IN ('caisse', 'banque', 'mobile_money', 'credit_fournisseur')),
  CONSTRAINT charges_montants_check CHECK (
    montant_ht_xaf >= 0
    AND tva_xaf >= 0
    AND montant_ttc_xaf >= 0
    AND montant_paye_xaf >= 0
    AND montant_paye_xaf <= montant_ttc_xaf
  )
);

CREATE TABLE IF NOT EXISTS sorties_tresorerie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  charge_id uuid REFERENCES charges(id) ON DELETE SET NULL,
  date_sortie date NOT NULL,
  beneficiaire text NOT NULL,
  motif text NOT NULL,
  montant_xaf numeric(12,2) NOT NULL,
  mode_paiement text NOT NULL,
  compte_tresorerie text NOT NULL,
  reference_paiement text,
  statut text NOT NULL DEFAULT 'validee',
  justificatif_statut text NOT NULL DEFAULT 'manquant',
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status sync_status NOT NULL DEFAULT 'pending',
  CONSTRAINT sorties_tresorerie_statut_check CHECK (statut IN ('brouillon', 'validee', 'annulee')),
  CONSTRAINT sorties_tresorerie_justificatif_statut_check CHECK (justificatif_statut IN ('manquant', 'recu', 'non_requis')),
  CONSTRAINT sorties_tresorerie_mode_paiement_check CHECK (mode_paiement IN ('caisse', 'banque', 'mobile_money')),
  CONSTRAINT sorties_tresorerie_montant_check CHECK (montant_xaf > 0)
);

CREATE TABLE IF NOT EXISTS charges_justificatifs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid REFERENCES charges(id) ON DELETE CASCADE,
  sortie_id uuid REFERENCES sorties_tresorerie(id) ON DELETE CASCADE,
  nom_fichier text NOT NULL,
  type_mime text NOT NULL,
  storage_path text NOT NULL,
  taille_bytes integer NOT NULL DEFAULT 0,
  description text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charges_justificatifs_parent_check CHECK (
    (charge_id IS NOT NULL AND sortie_id IS NULL)
    OR (charge_id IS NULL AND sortie_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_charges_statut ON charges(statut);
CREATE INDEX IF NOT EXISTS idx_charges_date ON charges(date_charge DESC);
CREATE INDEX IF NOT EXISTS idx_charges_fournisseur ON charges(fournisseur_nom);
CREATE INDEX IF NOT EXISTS idx_charges_compte ON charges(compte_charge);
CREATE INDEX IF NOT EXISTS idx_sorties_tresorerie_charge ON sorties_tresorerie(charge_id);
CREATE INDEX IF NOT EXISTS idx_sorties_tresorerie_date ON sorties_tresorerie(date_sortie DESC);
CREATE INDEX IF NOT EXISTS idx_charges_justificatifs_charge ON charges_justificatifs(charge_id);
CREATE INDEX IF NOT EXISTS idx_charges_justificatifs_sortie ON charges_justificatifs(sortie_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('charges-justificatifs', 'charges-justificatifs', true)
ON CONFLICT (id) DO NOTHING;
