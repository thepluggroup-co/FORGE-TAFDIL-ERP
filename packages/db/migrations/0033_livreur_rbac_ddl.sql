-- Migration 0033 — LIVREUR : rôle RBAC + permissions + géoloc historique + contrainte statut étendue
-- Exécuter APRÈS 0032 (la valeur 'LIVREUR' de l'enum doit être commitée)
-- Idempotente : ON CONFLICT DO NOTHING / ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS

-- ── 1. Rôle LIVREUR dans rbac_roles ──────────────────────────────────────────
INSERT INTO rbac_roles (name, label, description, is_system)
VALUES ('LIVREUR', 'Livreur', 'Accès en lecture aux livraisons qui lui sont assignées', true)
ON CONFLICT (name) DO NOTHING;

-- ── 2. Permission LOGISTICS:READ pour LIVREUR ────────────────────────────────
DO $$
DECLARE
  livreur_role_id     uuid;
  logistics_read_perm uuid;
BEGIN
  SELECT id INTO livreur_role_id     FROM rbac_roles       WHERE name   = 'LIVREUR';
  SELECT id INTO logistics_read_perm FROM rbac_permissions WHERE module = 'LOGISTICS' AND action = 'READ';

  IF livreur_role_id IS NOT NULL AND logistics_read_perm IS NOT NULL THEN
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    VALUES (livreur_role_id, logistics_read_perm)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── 3. Créer livraisons_historique si elle n'existe pas encore ───────────────
-- (normalement créée par migration 0008 ; cette migration la recrée de façon
-- idempotente au cas où 0008 n'aurait pas encore été appliquée)
CREATE TABLE IF NOT EXISTS livraisons_historique (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  livraison_id  uuid        NOT NULL REFERENCES livraisons(id) ON DELETE CASCADE,
  ancien_statut text,
  nouveau_statut text       NOT NULL,
  commentaire   text,
  changed_by    uuid        REFERENCES profiles(id),
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_livraisons_historique_livraison
  ON livraisons_historique(livraison_id, changed_at DESC);

-- ── 4. Colonne géolocalisation ────────────────────────────────────────────────
ALTER TABLE livraisons_historique
  ADD COLUMN IF NOT EXISTS geoloc text;

-- NOTE : la normalisation des statuts legacy et la mise à jour de la contrainte
-- sont déplacées dans 0034_livraisons_statut_constraint.sql pour éviter les
-- conflits avec la contrainte existante. Appliquer 0034 séparément.
