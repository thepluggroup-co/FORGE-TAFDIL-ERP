-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0018 : Extension table fournisseurs
--
-- Ajoute les colonnes whatsapp et produits_fournis à la table fournisseurs
-- créée en 0017. Toutes les instructions sont idempotentes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fournisseurs
  ADD COLUMN IF NOT EXISTS whatsapp         TEXT,
  ADD COLUMN IF NOT EXISTS produits_fournis TEXT[] DEFAULT '{}';

COMMENT ON COLUMN fournisseurs.whatsapp         IS 'Numéro WhatsApp avec indicatif (ex: +237695884528)';
COMMENT ON COLUMN fournisseurs.produits_fournis IS 'Liste des catégories ou articles fournis';
