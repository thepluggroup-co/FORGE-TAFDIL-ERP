-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Élargissement des permissions RBAC : COMMERCIAL, LIVREUR, CAISSIER
--
-- CONTEXTE — migration de tous les endpoints backend de requireRole([...])
-- (rôle legacy) vers requirePermission(module, action) (RBAC granulaire, cf.
-- 20260815_caisse_module_completions.sql pour le précédent avec CAISSE).
--
-- Découvert en auditant chaque route : le rôle RBAC COMMERCIAL (mappé depuis
-- le rôle legacy 'operateur') n'avait que COMMERCIAL(CRU) + REPORTS:READ +
-- STOCK:READ — largement insuffisant face à ce qu'un compte 'operateur'
-- legacy fait réellement aujourd'hui (mouvements de stock, jobs de
-- production, livraisons, congés/présences, plans de crédit). Sans cet
-- élargissement, migrer ces routes vers requirePermission aurait bloqué
-- l'accès à la majorité du travail quotidien d'un compte operateur.
--
-- LIVREUR manquait LOGISTICS:VALIDATE/EXPORT, nécessaires pour qu'un livreur
-- marque une livraison effectuée, signe le bon de livraison, ou l'imprime.
--
-- CAISSIER manquait COMMERCIAL:READ, nécessaire pour que la recherche client
-- de l'écran Caisse continue de fonctionner une fois GET /clients et
-- GET /clients/recherche (auparavant ouverts à tout utilisateur authentifié)
-- protégés par requirePermission('COMMERCIAL', 'READ').
--
-- Ces ajouts sont purs (aucun retrait) — appliqués en direct via script au
-- moment de la migration (2026-09-03) ; ce fichier documente le changement
-- pour la trace des migrations, ré-exécutable sans risque (ON CONFLICT DO
-- NOTHING) si le projet est reconstruit depuis zéro.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'COMMERCIAL'
  AND (p.module, p.action) IN (
    ('STOCK', 'CREATE'), ('STOCK', 'UPDATE'), ('STOCK', 'VALIDATE'),
    ('COMMERCIAL', 'VALIDATE'),
    ('RECEIVABLES', 'CREATE'),
    ('LOGISTICS', 'READ'), ('LOGISTICS', 'CREATE'), ('LOGISTICS', 'UPDATE'),
    ('LOGISTICS', 'VALIDATE'), ('LOGISTICS', 'EXPORT'),
    ('HR', 'CREATE'),
    ('PRODUCTION', 'CREATE'), ('PRODUCTION', 'UPDATE'), ('PRODUCTION', 'VALIDATE')
  )
ON CONFLICT DO NOTHING;

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'LIVREUR'
  AND (p.module, p.action) IN (
    ('LOGISTICS', 'VALIDATE'), ('LOGISTICS', 'EXPORT')
  )
ON CONFLICT DO NOTHING;

INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'CAISSIER'
  AND (p.module, p.action) IN (
    ('COMMERCIAL', 'READ')
  )
ON CONFLICT DO NOTHING;

-- ── Vérification ──────────────────────────────────────────────────────────────

SELECT r.name, p.module, p.action
FROM rbac_roles r
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions p       ON p.id = rp.permission_id
WHERE r.name IN ('COMMERCIAL', 'LIVREUR', 'CAISSIER')
ORDER BY r.name, p.module, p.action;

-- ═══════════════════════════════════════════════════════════════════════════
-- APPLICATION — déjà appliquée en direct via script le 2026-09-03 (INSERT pur,
-- pas de DDL, donc pas besoin du SQL Editor). Ce fichier est fourni pour la
-- traçabilité et pour un projet reconstruit depuis zéro (Supabase Dashboard →
-- SQL Editor → coller → Run, comme les autres migrations de ce dossier).
-- ═══════════════════════════════════════════════════════════════════════════
