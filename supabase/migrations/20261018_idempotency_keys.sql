-- ═══════════════════════════════════════════════════════════════════════════
-- Anti-doublon des écritures (mode hors ligne desktop / mobile)
--
-- Une action faite sans réseau est gardée sur l'appareil puis rejouée à la
-- reconnexion. Si la connexion tombe juste APRÈS que le serveur a traité la
-- requête mais AVANT que l'appareil reçoive la réponse, l'appareil la renvoie :
-- sans cette table, on créerait deux clients, deux factures, deux paiements.
--
-- Chaque écriture porte un en-tête « Idempotency-Key » (UUID généré par
-- l'appareil). L'API (apps/api/src/middleware/idempotency.ts) enregistre la
-- clé ici avant d'exécuter, puis la réponse ; une clé déjà vue renvoie la
-- réponse enregistrée sans rien réexécuter.
--
-- Tant que cette migration n'est pas appliquée, l'API fonctionne normalement
-- mais SANS protection anti-doublon (elle le signale dans ses logs).
--
-- APPLICATION — Supabase Dashboard → SQL Editor → coller → Run. Ré-exécutable.
-- Rollback : DROP TABLE public.idempotency_keys;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key         text        PRIMARY KEY,
  user_id     uuid        NOT NULL,
  method      text        NOT NULL,
  path        text        NOT NULL,
  -- NULL tant que la requête est en cours ; renseigné une fois traitée (2xx).
  status      integer,
  response    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx
  ON public.idempotency_keys (created_at);

-- Accès réservé à l'API (clé service_role, qui contourne RLS) : RLS activé
-- sans aucune policy = aucun accès pour anon / authenticated.
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- ── Vérification ──────────────────────────────────────────────────────────────
SELECT relname, relrowsecurity FROM pg_class WHERE oid = 'public.idempotency_keys'::regclass;
