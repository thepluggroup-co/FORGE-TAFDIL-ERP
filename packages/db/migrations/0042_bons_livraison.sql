-- Migration 0042 — Bons de livraison signés (T03)
-- Idempotente : CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- ── 1. Table bons_livraison ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bons_livraison (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          text        NOT NULL UNIQUE,                  -- BL-YYYYMMDD-NNNN
  livraison_id    uuid        NOT NULL REFERENCES livraisons(id) ON DELETE CASCADE,
  commande_id     uuid        REFERENCES commandes(id) ON DELETE SET NULL,
  pdf_path        text        NOT NULL,                        -- storage path
  pdf_signed_url  text,                                         -- URL signée 7j (cache)
  signature_path  text        NOT NULL,                        -- PNG du signataire
  signataire_nom  text        NOT NULL,
  geoloc          text,                                         -- optionnel (lat,lng)
  device_info     text,                                         -- user-agent mobile (audit)
  created_by      uuid        REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bons_livraison_livraison ON bons_livraison(livraison_id);
CREATE INDEX IF NOT EXISTS idx_bons_livraison_commande  ON bons_livraison(commande_id);

-- ── 2. RLS : un livreur lit uniquement les BL de SES livraisons ──────────────
ALTER TABLE bons_livraison ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "livreur_read_own_bl" ON bons_livraison;
CREATE POLICY "livreur_read_own_bl" ON bons_livraison
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM livraisons l
      WHERE l.id = bons_livraison.livraison_id
        AND l.livreur_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_supervisor_read_all_bl" ON bons_livraison;
CREATE POLICY "admin_supervisor_read_all_bl" ON bons_livraison
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'superviseur')
    )
  );

-- ── 3. Bucket Storage privé (signed URL only) ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('bons-livraison', 'bons-livraison', false)
ON CONFLICT (id) DO NOTHING;
