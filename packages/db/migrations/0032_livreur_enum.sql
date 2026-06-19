-- Migration 0032 — Ajouter 'LIVREUR' au type enum rbac_role_name
-- Cette migration doit être appliquée SEULE (dans sa propre transaction)
-- avant 0033, car PostgreSQL interdit d'utiliser une nouvelle valeur d'enum
-- dans la même transaction que son ALTER TYPE … ADD VALUE.

ALTER TYPE rbac_role_name ADD VALUE IF NOT EXISTS 'LIVREUR';
