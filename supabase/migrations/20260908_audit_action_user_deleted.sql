-- Ajoute la valeur manquante 'USER_DELETED' à l'enum audit_action_type.
-- Sans cette valeur, la suppression d'un compte utilisateur (DELETE /api/admin/rbac/users/:id)
-- échoue silencieusement à écrire son entrée d'audit (violation d'enum côté Postgres).
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'USER_DELETED';
