-- Finance core: command payments and invoice synchronization.

ALTER TABLE commandes
  ADD COLUMN IF NOT EXISTS montant_paye_xaf numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS paiements_commande (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id uuid NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id),
  facture_id uuid REFERENCES factures(id),
  montant_xaf numeric(12,2) NOT NULL,
  methode text NOT NULL DEFAULT 'mobile_money',
  reference_ext text,
  statut text NOT NULL DEFAULT 'confirme',
  date_paiement date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  enregistre_par uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_paiements_commande_commande
  ON paiements_commande(commande_id);

CREATE INDEX IF NOT EXISTS idx_paiements_commande_facture
  ON paiements_commande(facture_id);
