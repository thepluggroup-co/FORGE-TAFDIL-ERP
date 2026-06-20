-- Migration 0035 — Sync clients boutique → module clients
-- Insère dans la table clients les acheteurs boutique absents
-- et lie les commandes ERP existantes à leur client.

-- ── 1. Backfill : créer les clients manquants ─────────────────────────────────
-- DISTINCT ON garantit un seul enregistrement par numéro de téléphone.
-- NOT EXISTS évite les doublons si un client a déjà été saisi manuellement
-- avec le même téléphone.

INSERT INTO clients (
  nom, type, telephone, email, adresse, ville, pays, statut, sync_status, created_at, updated_at
)
SELECT DISTINCT ON (cs.client_telephone)
  cs.client_nom,
  'particulier',
  cs.client_telephone,
  cs.client_email,
  cs.client_adresse,
  cs.client_ville,
  'Cameroun',
  'actif',
  'synced',
  cs.created_at,
  NOW()
FROM commandes_shop cs
WHERE cs.client_telephone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM clients c WHERE c.telephone = cs.client_telephone
  )
ORDER BY cs.client_telephone, cs.created_at ASC;

-- ── 2. Rétrolier les commandes ERP au client correspondant ────────────────────
-- Met à jour client_id sur les commandes ERP dont le client boutique est
-- maintenant identifiable par téléphone.

UPDATE commandes erp
SET client_id = cl.id
FROM commandes_shop cs
JOIN clients cl ON cl.telephone = cs.client_telephone
WHERE cs.erp_commande_id = erp.id
  AND erp.client_id IS NULL;
