-- ═══════════════════════════════════════════════════════════════════════════
-- RÉPARATION — jobs_production : lien commande et colonnes écrites par l'API
--
-- Constat (diagnostic supabase/diagnostics/verifier_schema_reel.sql, 28/09/2026) :
-- jobs_production.commande_id N'EXISTE PAS en production, alors que
-- 20260524_core_tables_complete la déclare. Conséquences :
--   - passage d'une commande « en production » : les OF ne sont PAS créés
--     (insertion en échec, erreur seulement journalisée) ;
--   - création manuelle d'un OF : l'API retombait sur une insertion minimale
--     qui perdait silencieusement le lien commande, le produit, la quantité, le prix ;
--   - timeline / production d'une commande, passage OF « prêt » → facture et
--     statut commande : le lien OF → commande introuvable.
--
-- Cette migration ajoute, SEULEMENT SI ABSENTES, toutes les colonnes que l'API
-- lit ou écrit sur jobs_production. Aucune colonne existante n'est modifiée,
-- aucune ligne supprimée. Rejouable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Avant : quelles colonnes manquent ? ─────────────────────────────────────
DO $$
DECLARE
  attendues TEXT[] := ARRAY['commande_id','produit_ref','categorie','prix_public_xaf','publier_shop',
                            'description_produit','quantite_produite','created_by','sync_status',
                            'created_at','updated_at'];
  manquantes TEXT[];
BEGIN
  SELECT array_agg(c ORDER BY c) INTO manquantes
    FROM unnest(attendues) AS c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'jobs_production' AND column_name = c);
  RAISE NOTICE 'Avant : jobs_production=% lignes ; colonnes manquantes : %',
    (SELECT count(*) FROM public.jobs_production), coalesce(array_to_string(manquantes, ', '), 'aucune');
END $$;

-- ── Colonnes (ajoutées uniquement si absentes) ─────────────────────────────
ALTER TABLE public.jobs_production
  ADD COLUMN IF NOT EXISTS commande_id         UUID REFERENCES public.commandes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS produit_ref         TEXT,          -- réf. du produit créé en fin de production (OF « stock »)
  ADD COLUMN IF NOT EXISTS categorie           TEXT,
  ADD COLUMN IF NOT EXISTS prix_public_xaf     NUMERIC,       -- prix boutique si publication après production
  ADD COLUMN IF NOT EXISTS publier_shop        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS description_produit TEXT,
  ADD COLUMN IF NOT EXISTS quantite_produite   NUMERIC,
  ADD COLUMN IF NOT EXISTS created_by          UUID,
  ADD COLUMN IF NOT EXISTS sync_status         TEXT NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_jobs_production_commande ON public.jobs_production(commande_id);

-- ── Rattachement des OF existants dont le numéro suit OF-<n° commande>-NN ──
-- (format de creerJobsProductionCommande). Correspondance exacte uniquement :
-- rien n'est deviné pour les OF saisis à la main.
DO $$
DECLARE n BIGINT;
BEGIN
  UPDATE public.jobs_production j
     SET commande_id = c.id
    FROM public.commandes c
   WHERE j.commande_id IS NULL
     AND j.numero ~ '^OF-.+-[0-9]{2}$'
     AND regexp_replace(j.numero, '^OF-(.+)-[0-9]{2}$', '\1') = c.numero;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'OF rattachés à leur commande d''après leur numéro : %', n;
END $$;

-- ── Après : état et commandes à réparer ────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Après : jobs_production=% lignes (identique attendu), dont % liées à une commande',
    (SELECT count(*) FROM public.jobs_production),
    (SELECT count(*) FROM public.jobs_production WHERE commande_id IS NOT NULL);
  RAISE NOTICE 'Commandes en production / prêtes SANS aucun OF (à régénérer depuis l''ERP) : %',
    (SELECT count(*) FROM public.commandes c
      WHERE c.statut IN ('in_production', 'pret')
        AND NOT EXISTS (SELECT 1 FROM public.jobs_production j WHERE j.commande_id = c.id));
END $$;

-- Liste des commandes concernées (lecture seule, à exécuter séparément si besoin) :
-- SELECT c.numero, c.client_nom, c.statut, c.date_commande
--   FROM public.commandes c
--  WHERE c.statut IN ('in_production', 'pret')
--    AND NOT EXISTS (SELECT 1 FROM public.jobs_production j WHERE j.commande_id = c.id)
--  ORDER BY c.date_commande;
