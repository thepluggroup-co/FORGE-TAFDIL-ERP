-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 5 — Audit métier du devis (§39 Master Prompt V3)
--
-- L'infrastructure d'audit (table rbac_audit_logs + fonction writeAuditLog)
-- existe déjà mais son enum audit_action_type ne couvrait que des événements
-- de sécurité/accès (login, permissions...) — aucune valeur pour les
-- événements métier demandés en §39 (devis créé, prix/quantité modifiés,
-- ajustement manuel, validation client, conversion en commande). On étend
-- l'enum plutôt que de créer une deuxième table d'audit (principe §4.1).
--
-- ALTER TYPE ... ADD VALUE ne peut pas s'exécuter dans le même bloc de
-- transaction qu'une utilisation de cette valeur — chaque ajout est donc une
-- instruction autonome. Idempotent : IF NOT EXISTS évite l'erreur si cette
-- migration est rejouée.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'DEVIS_CREATED';
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'DEVIS_UPDATED';
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'DEVIS_LIGNE_AJUSTEE';
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'DEVIS_VALIDATION_CLIENT';
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'DEVIS_CONVERTI_COMMANDE';
