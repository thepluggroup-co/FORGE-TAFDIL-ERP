-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Fix table produits : colonne designation
-- À exécuter dans Supabase → SQL Editor
-- Sûr à relancer plusieurs fois (IF NOT EXISTS / IF EXISTS)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Créer les enums s'ils n'existent pas encore
DO $$ BEGIN
  CREATE TYPE produit_statut AS ENUM ('normal', 'alerte', 'critique', 'rupture');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_status AS ENUM ('synced', 'pending', 'conflict');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Créer la table produits complète si elle n'existe pas
CREATE TABLE IF NOT EXISTS public.produits (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               TEXT        NOT NULL UNIQUE,
  designation       TEXT        NOT NULL,
  description       TEXT,
  categorie         TEXT        NOT NULL,
  unite             TEXT        NOT NULL DEFAULT 'unité',
  stock_actuel      REAL        NOT NULL DEFAULT 0,
  stock_min         REAL        NOT NULL DEFAULT 5,
  stock_critique    REAL        NOT NULL DEFAULT 2,
  prix_unitaire_xaf REAL        NOT NULL DEFAULT 0,
  statut            produit_statut NOT NULL DEFAULT 'normal',
  emplacement       TEXT,
  fournisseur       TEXT,
  created_by        UUID        REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       sync_status NOT NULL DEFAULT 'pending'
);

-- 3. Si la table existait déjà avec une colonne "nom" → ajouter "designation"
--    et copier les données, puis supprimer "nom"
DO $$
BEGIN
  -- Cas A : colonne "nom" existe, "designation" n'existe pas → renommer
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'produits' AND column_name = 'nom'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'produits' AND column_name = 'designation'
  ) THEN
    ALTER TABLE public.produits RENAME COLUMN nom TO designation;
    RAISE NOTICE 'Colonne nom renommée en designation';

  -- Cas B : ni "nom" ni "designation" → ajouter "designation"
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'produits' AND column_name = 'designation'
  ) THEN
    ALTER TABLE public.produits ADD COLUMN designation TEXT NOT NULL DEFAULT '';
    RAISE NOTICE 'Colonne designation ajoutée';

  ELSE
    RAISE NOTICE 'Colonne designation déjà présente — rien à faire';
  END IF;
END $$;

-- 4. Colonnes manquantes éventuelles (migration additive sûre)
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS emplacement       TEXT;
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS fournisseur       TEXT;
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS stock_critique    REAL NOT NULL DEFAULT 2;
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS sync_status       TEXT NOT NULL DEFAULT 'pending';

-- 5. RLS — activer et ajouter politiques de base
ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;

-- Lecture : utilisateurs authentifiés
DROP POLICY IF EXISTS "produits_select" ON public.produits;
CREATE POLICY "produits_select" ON public.produits
  FOR SELECT TO authenticated USING (true);

-- Écriture : service_role uniquement (API backend)
DROP POLICY IF EXISTS "produits_all_service" ON public.produits;
CREATE POLICY "produits_all_service" ON public.produits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. Trigger updated_at
DROP TRIGGER IF EXISTS set_produits_updated_at ON public.produits;
CREATE TRIGGER set_produits_updated_at
  BEFORE UPDATE ON public.produits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
