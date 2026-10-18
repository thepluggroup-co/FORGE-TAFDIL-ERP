-- ═══════════════════════════════════════════════════════════════════════════
-- Sécurisation de la passerelle de paiement NOKASH (Mobile Money)
--
-- 1. paiement_tentatives — chaque demande de paiement envoyée à NOKASH est
--    gardée ici (transaction → commande). Avant, une seule colonne
--    commandes_shop.payment_reference était ÉCRASÉE à chaque nouvelle demande :
--    si quelqu'un relançait un paiement sur une commande pendant que le client
--    payait, le webhook du vrai paiement ne retrouvait plus la commande — le
--    client avait payé mais la commande restait impayée.
--    Sert aussi à limiter les demandes par commande et par numéro (harcèlement
--    par notifications de paiement Mobile Money).
--
-- 2. Unicité des paiements NOKASH en finance — deux webhooks simultanés
--    (NOKASH rejoue ses appels) ne peuvent plus enregistrer deux fois le même
--    paiement.
--
-- Tant que cette migration n'est pas appliquée, l'API reste fonctionnelle avec
-- l'ancien comportement (et le signale dans ses logs).
--
-- APPLICATION — Supabase Dashboard → SQL Editor → coller → Run. Ré-exécutable.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.paiement_tentatives (
  transaction_id  text        PRIMARY KEY,           -- id NOKASH de la transaction
  commande_id     uuid        NOT NULL REFERENCES public.commandes_shop(id) ON DELETE CASCADE,
  commande_ref    text        NOT NULL,
  montant         integer     NOT NULL CHECK (montant > 0),
  telephone       text        NOT NULL,
  canal           text        NOT NULL,
  -- pending → complete | failed. Le passage à « complete » sert de verrou :
  -- un webhook rejoué ne peut le faire qu'une fois.
  statut          text        NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending', 'complete', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paiement_tentatives_commande_idx  ON public.paiement_tentatives (commande_id, created_at);
CREATE INDEX IF NOT EXISTS paiement_tentatives_telephone_idx ON public.paiement_tentatives (telephone, created_at);

-- Accès réservé à l'API (service_role contourne RLS) : RLS sans policy.
ALTER TABLE public.paiement_tentatives ENABLE ROW LEVEL SECURITY;

-- ── Unicité des paiements NOKASH ──────────────────────────────────────────────
-- Créée seulement s'il n'existe pas déjà de doublon (sinon la création
-- échouerait) : dans ce cas la requête de vérification en bas les liste, à
-- corriger à la main avant de relancer ce script.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.paiements_commande
    WHERE methode = 'NOKASH' AND reference_ext IS NOT NULL
    GROUP BY reference_ext HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS paiements_commande_nokash_ref_unique
      ON public.paiements_commande (reference_ext)
      WHERE methode = 'NOKASH' AND reference_ext IS NOT NULL;
  ELSE
    RAISE NOTICE 'Doublons NOKASH présents dans paiements_commande : index d''unicité NON créé (voir la requête ci-dessous).';
  END IF;
END $$;

-- ── Vérification ──────────────────────────────────────────────────────────────
-- 1) la table existe, RLS actif
SELECT relname, relrowsecurity FROM pg_class WHERE oid = 'public.paiement_tentatives'::regclass;
-- 2) l'index d'unicité existe (1 ligne attendue)
SELECT indexname FROM pg_indexes WHERE indexname = 'paiements_commande_nokash_ref_unique';
-- 3) doublons éventuels (0 ligne attendue)
SELECT reference_ext, count(*) FROM public.paiements_commande
WHERE methode = 'NOKASH' AND reference_ext IS NOT NULL
GROUP BY reference_ext HAVING count(*) > 1;
