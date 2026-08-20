-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Module Caisse : compléments découverts en écrivant l'API
-- (PROMPT 3 — apps/api/src/routes/caisse.ts)
--
-- Ce fichier vient APRÈS 20260815_caisse_tables.sql et 20260607_rbac_module.sql
-- (déjà en place). Il ajoute, en pur ALTER/CREATE OR REPLACE idempotents :
--   1. tickets_vente.oversell        (flag "vente au-delà du stock dispo")
--   2. caisse_sessions.fond_fermeture_xaf (comptage caissier à la fermeture)
--   3. 'sortie_vente' dans le CHECK de mouvements_stock.type
--   4. fn_mouvement_stock_vente — variante RPC de fn_mouvement_stock qui NE
--      bloque JAMAIS la vente comptoir : le stock peut passer sous 0 mais le
--      flag "oversell" revient dans le résultat pour que l'API puisse alerter.
--      (fn_mouvement_stock existant reste inchangé — il continue à refuser
--      les sorties insuffisantes pour tous les autres flux : bons de sortie,
--      ajustements, etc.)
--   5. Permissions RBAC du module CAISSE (CAISSIER + MANAGER).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. tickets_vente.oversell ────────────────────────────────────────────────

ALTER TABLE public.tickets_vente
  ADD COLUMN IF NOT EXISTS oversell boolean NOT NULL DEFAULT false;

ALTER TABLE public.tickets_vente
  ADD COLUMN IF NOT EXISTS notes text;

-- ── 2. caisse_sessions.fond_fermeture_xaf ────────────────────────────────────

ALTER TABLE public.caisse_sessions
  ADD COLUMN IF NOT EXISTS fond_fermeture_xaf integer;

-- ── 3. mouvements_stock.type — ajout de 'sortie_vente' ───────────────────────
-- Même mécanisme que profiles_role_check (20260815_add_caissier_livreur_role.sql) :
-- DROP puis ADD CONSTRAINT sur la colonne TEXT existante (pas un enum natif —
-- confirmé dans 20260524_core_tables_complete.sql:74).

ALTER TABLE public.mouvements_stock DROP CONSTRAINT IF EXISTS mouvements_stock_type_check;

ALTER TABLE public.mouvements_stock
  ADD CONSTRAINT mouvements_stock_type_check
  CHECK (type IN ('entree', 'sortie', 'ajustement', 'transfert', 'sortie_vente'));

-- ── 4. fn_mouvement_stock_vente ───────────────────────────────────────────────
-- Calqué sur fn_mouvement_stock (20260525_fn_mouvement_stock.sql) : même verrou
-- SELECT ... FOR UPDATE pour éviter les race conditions entre deux caisses qui
-- vendraient le même produit en même temps. Différence volontaire : ne RAISE
-- jamais pour stock insuffisant — la vente au comptoir a déjà eu lieu — mais
-- retourne oversell=true pour que l'appelant marque le ticket et déclenche
-- l'alerte réappro.

CREATE OR REPLACE FUNCTION public.fn_mouvement_stock_vente(
  p_produit_id UUID,
  p_quantite   NUMERIC,
  p_reference  TEXT DEFAULT NULL,
  p_notes      TEXT DEFAULT NULL,
  p_user_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_produit      produits%ROWTYPE;
  v_nouvelle_qte NUMERIC;
  v_statut       TEXT;
  v_mvt_id       UUID;
  v_oversell     BOOLEAN;
BEGIN
  SELECT * INTO v_produit
  FROM public.produits
  WHERE id = p_produit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUIT_NOT_FOUND: Produit % introuvable', p_produit_id;
  END IF;

  v_nouvelle_qte := v_produit.stock_actuel - p_quantite;
  v_oversell     := v_nouvelle_qte < 0;

  -- Jamais de stock négatif SILENCIEUX : v_oversell remonte dans le résultat,
  -- mais on ne bloque pas — la vente comptoir a déjà eu lieu physiquement.
  v_statut := CASE
    WHEN v_nouvelle_qte <= 0                        THEN 'rupture'
    WHEN v_nouvelle_qte <= v_produit.stock_critique  THEN 'critique'
    WHEN v_nouvelle_qte <= v_produit.stock_min       THEN 'alerte'
    ELSE 'normal'
  END;

  INSERT INTO public.mouvements_stock (produit_id, type, quantite, reference, notes, created_by)
  VALUES (p_produit_id, 'sortie_vente', p_quantite, p_reference, p_notes, p_user_id)
  RETURNING id INTO v_mvt_id;

  UPDATE public.produits
  SET
    stock_actuel = v_nouvelle_qte,
    statut       = v_statut,
    updated_at   = now()
  WHERE id = p_produit_id;

  RETURN jsonb_build_object(
    'success',      true,
    'mouvement_id', v_mvt_id,
    'produit_id',   p_produit_id,
    'quantite',     p_quantite,
    'stock_avant',  v_produit.stock_actuel,
    'stock_apres',  v_nouvelle_qte,
    'statut',       v_statut,
    'oversell',     v_oversell
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mouvement_stock_vente(UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mouvement_stock_vente(UUID, NUMERIC, TEXT, TEXT, UUID) TO service_role;

-- ── 5. RBAC — module CAISSE ───────────────────────────────────────────────────
-- rbac_module_enum n'existe pas (RBAC_MODULES est vérifié uniquement côté
-- TypeScript/Drizzle, cf. packages/db/src/schema-rbac.ts) — rbac_permissions.module
-- est une colonne TEXT libre (20260607_rbac_module.sql), donc l'ajout d'un
-- nouveau module ne nécessite aucune migration de type/enum ici.

INSERT INTO rbac_permissions (module, action, label, is_immutable) VALUES
  ('CAISSE', 'READ',   'Consulter les sessions et tickets de caisse', false),
  ('CAISSE', 'CREATE', 'Ouvrir une session et créer des tickets',     false),
  ('CAISSE', 'UPDATE', 'Fermer une session de caisse',                false)
ON CONFLICT DO NOTHING;

-- CAISSIER : CAISSE READ+CREATE+UPDATE, en plus de RECEIVABLES et STOCK:READ
-- déjà en place (20260607_rbac_module.sql, 20260815_add_caissier_livreur_role.sql).
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'CAISSIER'
  AND p.module = 'CAISSE'
  AND p.action IN ('READ', 'CREATE', 'UPDATE')
ON CONFLICT DO NOTHING;

-- MANAGER ("responsable") : mêmes actions CAISSE — la règle "tout sauf
-- ADMIN:CONFIGURE/DELETE" seedée en 20260607_rbac_module.sql est un snapshot
-- figé à cette date, elle ne couvre pas les permissions créées après.
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac_roles r, rbac_permissions p
WHERE r.name = 'MANAGER'
  AND p.module = 'CAISSE'
  AND p.action IN ('READ', 'CREATE', 'UPDATE')
ON CONFLICT DO NOTHING;

-- SUPER_ADMIN n'a pas besoin d'être seedé ici : rbacService.ts (L191-196)
-- lui donne un accès total en mémoire quel que soit le contenu de la table.

-- ── 6. Vérification ──────────────────────────────────────────────────────────

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tickets_vente', 'caisse_sessions')
  AND column_name IN ('oversell', 'fond_fermeture_xaf');

SELECT r.name, p.module, p.action
FROM rbac_roles r
JOIN rbac_role_permissions rp ON rp.role_id = r.id
JOIN rbac_permissions p       ON p.id = rp.permission_id
WHERE p.module = 'CAISSE'
ORDER BY r.name, p.action;

-- ═══════════════════════════════════════════════════════════════════════════
-- APPLICATION — cette migration N'A PAS été exécutée.
-- À appliquer APRÈS 20260815_caisse_tables.sql (dépend de tickets_vente,
-- caisse_sessions, mouvements_stock, rbac_roles, rbac_permissions).
--
--   Supabase Dashboard → SQL Editor → coller le contenu → Run
--   ou : psql "$DATABASE_URL" -f supabase/migrations/20260815_caisse_module_completions.sql
-- ═══════════════════════════════════════════════════════════════════════════
