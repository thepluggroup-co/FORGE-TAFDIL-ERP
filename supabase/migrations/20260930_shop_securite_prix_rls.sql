-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 0 bis — Catalogue Hybride : sécurité du tunnel de vente web
-- (ARCHITECTURE/TAFDIL_FORGE_AUDIT.md, décision D7)
--
-- 1. Nouvelle action d'audit VENTE_PRIX_FORCE : tracée quand un membre du
--    personnel authentifié fixe un prix différent du prix de référence
--    (POST /api/shop/commandes). Le client anonyme ne peut plus fixer de prix.
--
-- 2. Retrait des politiques RLS d'ÉCRITURE ouvertes à tous (`USING (true)`)
--    héritées de 20260519_shop_tables.sql. Toutes les écritures sur ces tables
--    passent par l'API Hono ou les routes serveur Next.js avec la clé
--    service_role, qui contourne RLS : vérifié dans apps/web, apps/shop,
--    apps/mobile, apps/desktop (aucun insert/update/delete direct avec la clé
--    anonyme ou un JWT utilisateur).
--
--    demandes_devis_web : même la LECTURE publique est retirée — seules des
--    routes serveur (clé service_role) la lisent.
--
-- NON TRAITÉ ICI (volontairement) : `commandes_shop_select_public` et
-- `produits_shop_select_all` restent en place. La page de suivi du shop
-- (apps/shop/app/suivi/[ref]) et l'ERP web (hooks + Realtime sur
-- commandes_shop) lisent encore directement avec la clé anonyme / un JWT
-- utilisateur ; retirer la lecture publique demande d'abord de faire passer
-- ces lectures par le serveur. Suivi dans l'audit, §J.
--
-- Rollback : recréer les politiques supprimées (définitions d'origine dans
-- 20260519_shop_tables.sql, lignes 120 et 165-168 et 188-190).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Comptage avant (§39) ────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Avant : produits_shop=%, commandes_shop=%, demandes_devis_web=%',
    (SELECT count(*) FROM public.produits_shop),
    (SELECT count(*) FROM public.commandes_shop),
    (SELECT count(*) FROM public.demandes_devis_web);
END $$;

-- ── 1. Audit ────────────────────────────────────────────────────────────────
ALTER TYPE audit_action_type ADD VALUE IF NOT EXISTS 'VENTE_PRIX_FORCE';

-- ── 2. RLS : écritures publiques retirées ──────────────────────────────────
DROP POLICY IF EXISTS "produits_shop_write_all"       ON public.produits_shop;

DROP POLICY IF EXISTS "commandes_shop_insert_public"  ON public.commandes_shop;
DROP POLICY IF EXISTS "commandes_shop_update_service" ON public.commandes_shop;
DROP POLICY IF EXISTS "commandes_shop_delete_service" ON public.commandes_shop;

DROP POLICY IF EXISTS "devis_web_insert_public"       ON public.demandes_devis_web;
DROP POLICY IF EXISTS "devis_web_select_service"      ON public.demandes_devis_web;
DROP POLICY IF EXISTS "devis_web_update_service"      ON public.demandes_devis_web;

-- RLS reste ACTIVÉ sur les trois tables : sans politique d'écriture, seule la
-- clé service_role peut écrire.

-- ── Comptage après : aucune donnée n'est touchée par cette migration ───────
DO $$
BEGIN
  RAISE NOTICE 'Après : produits_shop=%, commandes_shop=%, demandes_devis_web=% (identiques attendus)',
    (SELECT count(*) FROM public.produits_shop),
    (SELECT count(*) FROM public.commandes_shop),
    (SELECT count(*) FROM public.demandes_devis_web);
END $$;
