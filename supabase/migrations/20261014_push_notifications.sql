-- ═══════════════════════════════════════════════════════════════════════════
-- PUSH NOTIFICATIONS — apps/mobile (staff, Capacitor/FCM)
--
-- Une ligne par (profile_id, token) : un utilisateur peut avoir plusieurs
-- appareils. Le token FCM est régénéré périodiquement par Android ; on le
-- met à jour (upsert) plutôt que d'en accumuler des périmés.
--
-- RLS : aucune policy — accès service_role uniquement (API backend via
-- supabaseAdmin), même convention que fiche_technique/fiche_technique_ressources
-- (20260925_phase1_gamme_fiche_technique.sql). Le mobile ne touche jamais
-- Supabase directement pour ces tokens, toujours via l'API.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL,
  platform    TEXT        NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios')),
  app_version TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_profile ON public.push_tokens(profile_id);

CREATE OR REPLACE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
