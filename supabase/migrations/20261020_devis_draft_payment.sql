ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS note_client TEXT;
CREATE TABLE IF NOT EXISTS public.devis_reglages (
  id TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  validite_jours INTEGER NOT NULL DEFAULT 30 CHECK (validite_jours > 0),
  conditions_paiement TEXT NOT NULL DEFAULT '',
  condition_paiement_id UUID REFERENCES public.conditions_paiement(id),
  acompte_pct REAL NOT NULL DEFAULT 30 CHECK (acompte_pct BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.devis_reglages (id) VALUES ('singleton') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.devis_brouillons (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contenu JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.devis_brouillons ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut = 'brouillon');
ALTER TABLE public.devis_brouillons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devis_reglages ENABLE ROW LEVEL SECURITY;
