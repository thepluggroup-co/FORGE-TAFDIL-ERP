-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Téléphone + PIN : la vraie table de PIN (4 chiffres)
--
-- Remplace l'hypothèse initiale "le PIN = le mot de passe Supabase du compte"
-- (rejetée : un compte avec email + téléphone aurait eu un mot de passe email
-- affaibli à 4 chiffres). Le PIN est maintenant un credential SÉPARÉ, jamais
-- transmis à auth.users. La connexion par PIN passe par un échange
-- magic-link généré côté serveur (apps/api/src/routes/auth-phone-pin.ts) —
-- jamais par signInWithPassword.
--
-- Cycle de vie :
--   1. Admin invite avec un téléphone → PIN aléatoire généré, envoyé par
--      SMS/WhatsApp, must_change=true.
--   2. Première connexion par PIN → forcé de choisir son propre PIN
--      (apps/web/src/pages/SetPin.tsx) → must_change=false.
--   3. Un utilisateur peut aussi activer lui-même le téléphone+PIN plus tard
--      depuis Mon compte, sans passer par un admin.
--
-- Sécurité : espace 4 chiffres = 10 000 combinaisons, donc PAS une défense en
-- profondeur suffisante par elle-même — le verrouillage après échecs répétés
-- (failed_attempts/locked_until, même mécanisme que rbac_login_attempts) est
-- ce qui protège réellement, pas le hash.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_pins (
  user_id         uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash        text        NOT NULL,   -- sha256(salt || pin), jamais le PIN en clair
  salt            text        NOT NULL,
  must_change     boolean     NOT NULL DEFAULT true,
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_pins_all" ON public.user_pins;
CREATE POLICY "user_pins_all" ON public.user_pins FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  CREATE TRIGGER trg_user_pins_updated_at
    BEFORE UPDATE ON public.user_pins
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- APPLICATION — cette migration N'A PAS été exécutée.
-- Supabase Dashboard → SQL Editor → coller le contenu → Run
-- (Dépend de public.profiles, déjà en place.)
-- ═══════════════════════════════════════════════════════════════════════════
