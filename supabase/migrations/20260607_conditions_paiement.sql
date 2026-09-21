-- ══════════════════════════════════════════════════════════════════════════════
-- CONDITIONS DE PAIEMENT + colonnes paiement sur commandes
-- ══════════════════════════════════════════════════════════════════════════════

-- Table de référence
CREATE TABLE IF NOT EXISTS public.conditions_paiement (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT        NOT NULL UNIQUE,
  libelle          TEXT        NOT NULL,
  acompte_pct      SMALLINT    NOT NULL DEFAULT 0 CHECK (acompte_pct BETWEEN 0 AND 100),
  delai_solde_jours SMALLINT   NOT NULL DEFAULT 0,
  actif            BOOLEAN     NOT NULL DEFAULT true
);

-- Données de référence
INSERT INTO public.conditions_paiement (code, libelle, acompte_pct, delai_solde_jours) VALUES
  ('P100',    'Comptant intégral',                     100, 0),
  ('P30-45',  '30% commande + solde 45j',               30, 45),
  ('P30-60',  '30% commande + solde 60j',               30, 60),
  ('P0-LIV',  'Paiement à la livraison',                 0, 0),
  ('P30-LIV', '30% commande + solde à livraison',       30, 0)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.conditions_paiement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cp_read" ON public.conditions_paiement;
CREATE POLICY "cp_read" ON public.conditions_paiement FOR SELECT USING (true);

-- Colonnes paiement sur commandes
ALTER TABLE public.commandes
  ADD COLUMN IF NOT EXISTS condition_paiement_id   UUID    REFERENCES public.conditions_paiement(id),
  ADD COLUMN IF NOT EXISTS montant_acompte          NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS date_echeance_solde      DATE,
  ADD COLUMN IF NOT EXISTS statut_paiement          TEXT    NOT NULL DEFAULT 'non_paye'
    CHECK (statut_paiement IN ('non_paye','acompte_recu','solde_recu','solde_en_retard'));
