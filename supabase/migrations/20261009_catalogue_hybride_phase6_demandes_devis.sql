-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — PHASE 6 : demandes de devis structurées (§22/§23/§46)
--
-- On ENRICHIT demandes_devis_web (déjà reliée aux devis ERP) — aucun second
-- système de devis (§49).
--   1. numéro DEM-XXXXX attribué par la base, champs structurés du besoin
--   2. statuts du workflow (les valeurs historiques restent acceptées)
--   3. demandes_devis_documents : plans, photos, PDF (fichiers en stockage PRIVÉ)
--   4. demandes_devis_historique : chaque transition (qui, quand, motif)
--
-- Additif et rejouable. La contrainte de statut existante (quel que soit son
-- nom réel) est remplacée par une contrainte qui accepte TOUTES les valeurs
-- anciennes et nouvelles : aucune ligne existante ne devient invalide.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'Avant : demandes_devis_web=% ; répartition des statuts : %',
    (SELECT count(*) FROM public.demandes_devis_web),
    (SELECT coalesce(string_agg(statut || '=' || n, ', '), 'aucune')
       FROM (SELECT statut, count(*) AS n FROM public.demandes_devis_web GROUP BY statut) s);
END $$;

-- ── 1. Numéro et champs structurés ─────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.demandes_devis_numero_seq;

ALTER TABLE public.demandes_devis_web
  ADD COLUMN IF NOT EXISTS numero            TEXT,
  ADD COLUMN IF NOT EXISTS type_projet       TEXT,
  ADD COLUMN IF NOT EXISTS produit_ref       TEXT,
  ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS famille_id        UUID REFERENCES public.familles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modele_id         UUID REFERENCES public.modeles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantite          NUMERIC CHECK (quantite IS NULL OR quantite > 0),
  ADD COLUMN IF NOT EXISTS dimensions        TEXT,
  ADD COLUMN IF NOT EXISTS materiau          TEXT,
  ADD COLUMN IF NOT EXISTS localisation      TEXT,
  ADD COLUMN IF NOT EXISTS delai_souhaite    DATE,
  ADD COLUMN IF NOT EXISTS notes_internes    TEXT,
  ADD COLUMN IF NOT EXISTS qualifie_par      UUID,
  ADD COLUMN IF NOT EXISTS qualifie_le       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- Numérotation des demandes existantes, dans l'ordre d'arrivée, puis défaut serveur.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.demandes_devis_web WHERE numero IS NULL ORDER BY created_at, id LOOP
    UPDATE public.demandes_devis_web
       SET numero = 'DEM-' || lpad(nextval('public.demandes_devis_numero_seq')::text, 5, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.demandes_devis_web
  ALTER COLUMN numero SET DEFAULT ('DEM-' || lpad(nextval('public.demandes_devis_numero_seq')::text, 5, '0'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'demandes_devis_web_numero_key') THEN
    ALTER TABLE public.demandes_devis_web ADD CONSTRAINT demandes_devis_web_numero_key UNIQUE (numero);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_demandes_devis_web_client ON public.demandes_devis_web(client_id);

-- ── 2. Statuts : remplace toute contrainte de statut existante ─────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.demandes_devis_web'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%statut%'
  LOOP
    EXECUTE format('ALTER TABLE public.demandes_devis_web DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.demandes_devis_web
  ADD CONSTRAINT demandes_devis_web_statut_check CHECK (statut IN (
    'nouvelle', 'en_qualification', 'infos_requises', 'en_chiffrage',
    'devis_envoye', 'acceptee', 'refusee', 'expiree', 'convertie',
    'vue', 'en_cours', 'traitee'          -- valeurs historiques, conservées
  ));

-- ── 3. Documents joints (plans, photos, PDF) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.demandes_devis_documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id     UUID        NOT NULL REFERENCES public.demandes_devis_web(id) ON DELETE CASCADE,
  nom_fichier    TEXT        NOT NULL,
  type_mime      TEXT        NOT NULL,           -- déterminé par signature, jamais par l'extension
  taille_octets  INTEGER     NOT NULL CHECK (taille_octets > 0),
  storage_path   TEXT        NOT NULL UNIQUE,    -- bucket PRIVÉ « demandes-devis »
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demandes_devis_documents_demande ON public.demandes_devis_documents(demande_id);

-- ── 4. Historique des transitions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demandes_devis_historique (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id      UUID        NOT NULL REFERENCES public.demandes_devis_web(id) ON DELETE CASCADE,
  ancien_statut   TEXT,
  nouveau_statut  TEXT        NOT NULL,
  commentaire     TEXT,
  par             UUID,                          -- NULL = automatique (site, synchronisation devis)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_demandes_devis_historique_demande ON public.demandes_devis_historique(demande_id, created_at);

CREATE OR REPLACE TRIGGER trg_demandes_devis_web_updated_at
  BEFORE UPDATE ON public.demandes_devis_web FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Données clients et plans : API seule (clé service_role).
ALTER TABLE public.demandes_devis_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demandes_devis_historique ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  RAISE NOTICE 'Après : demandes_devis_web=% (identique attendu), toutes numérotées : %',
    (SELECT count(*) FROM public.demandes_devis_web),
    (SELECT count(*) = 0 FROM public.demandes_devis_web WHERE numero IS NULL);
END $$;
