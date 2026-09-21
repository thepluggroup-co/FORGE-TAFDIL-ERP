-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Téléphone + PIN : table des codes OTP de confirmation
--
-- Usage : un utilisateur DÉJÀ authentifié (email + mot de passe, via
-- l'invitation classique) demande à activer la connexion par téléphone.
-- On envoie un code via Africa's Talking (déjà intégré, sms.service.ts) pour
-- vérifier qu'il possède bien ce numéro, puis on l'attache et le confirme
-- sur son compte Supabase Auth (auth.admin.updateUserById phone_confirm).
-- Une fois confirmé, signInWithPassword({ phone, password }) fonctionne avec
-- le même mot de passe/PIN que la connexion par email — un seul compte, deux
-- portes d'entrée.
--
-- Volontairement PAS de flux anonyme "OTP pour se connecter la toute première
-- fois sans compte" : ça éviterait un vecteur d'abus (bombardement SMS sur un
-- numéro arbitraire) et n'est pas ce qui a été demandé — les comptes sont
-- créés par un admin, pas auto-inscrits.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.phone_otp_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone       text        NOT NULL,       -- format normalisé (+237...), cf. normalizePhone()
  code_hash   text        NOT NULL,       -- sha256 du code — jamais le code en clair en base
  attempts    integer     NOT NULL DEFAULT 0,
  consumed    boolean     NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_otp_user_pending
  ON public.phone_otp_codes(user_id)
  WHERE consumed = false;

-- Nettoyage : purge best-effort des codes expirés > 1h (appelée par le service,
-- pas de cron dédié — volume négligeable, pas besoin de plus pour l'instant).
CREATE INDEX IF NOT EXISTS idx_phone_otp_expires ON public.phone_otp_codes(expires_at);

ALTER TABLE public.phone_otp_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "phone_otp_codes_all" ON public.phone_otp_codes;
CREATE POLICY "phone_otp_codes_all" ON public.phone_otp_codes FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- APPLICATION — cette migration N'A PAS été exécutée.
-- Supabase Dashboard → SQL Editor → coller le contenu → Run
-- ═══════════════════════════════════════════════════════════════════════════
