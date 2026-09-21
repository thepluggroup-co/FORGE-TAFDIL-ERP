-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Migration ciblée
-- Existants (conservés) : clients, devis, produits
-- Manquants (créés)     : commandes + lignes + historique
-- Shop (recréés)        : produits_shop, commandes_shop, demandes_devis_web
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. COMMANDES (manquante)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.commandes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                TEXT        NOT NULL UNIQUE,
  client_id             UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  client_nom            TEXT        NOT NULL,
  devis_id              UUID        REFERENCES public.devis(id) ON DELETE SET NULL,
  statut                TEXT        NOT NULL DEFAULT 'confirmed'
                          CHECK (statut IN ('confirmed','in_production','pret','delivered','cancelled')),
  date_commande         TEXT        NOT NULL,
  date_livraison_prevue TEXT,
  total_ht_xaf          NUMERIC     NOT NULL DEFAULT 0,
  tva_xaf               NUMERIC     NOT NULL DEFAULT 0,
  total_ttc_xaf         NUMERIC     NOT NULL DEFAULT 0,
  acompte_recu_xaf      NUMERIC     NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status           TEXT        NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_commandes_numero  ON public.commandes(numero);
CREATE INDEX IF NOT EXISTS idx_commandes_statut  ON public.commandes(statut);
CREATE INDEX IF NOT EXISTS idx_commandes_created ON public.commandes(created_at DESC);

CREATE OR REPLACE TRIGGER trg_commandes_updated_at
  BEFORE UPDATE ON public.commandes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.commandes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "commandes_all" ON public.commandes;
CREATE POLICY "commandes_all" ON public.commandes FOR ALL USING (true) WITH CHECK (true);

-- ── Lignes de commande ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.commandes_lignes (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id          UUID    NOT NULL REFERENCES public.commandes(id) ON DELETE CASCADE,
  produit_id           UUID    REFERENCES public.produits(id) ON DELETE SET NULL,
  designation          TEXT    NOT NULL,
  unite                TEXT    NOT NULL DEFAULT 'unité',
  quantite             NUMERIC NOT NULL,
  prix_unitaire_ht_xaf NUMERIC NOT NULL,
  total_ht_xaf         NUMERIC NOT NULL,
  ordre                INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_commandes_lignes_cmd ON public.commandes_lignes(commande_id);

ALTER TABLE public.commandes_lignes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "commandes_lignes_all" ON public.commandes_lignes;
CREATE POLICY "commandes_lignes_all" ON public.commandes_lignes FOR ALL USING (true) WITH CHECK (true);

-- ── Historique statuts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.historique_commandes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id    UUID        NOT NULL REFERENCES public.commandes(id) ON DELETE CASCADE,
  ancien_statut  TEXT,
  nouveau_statut TEXT        NOT NULL,
  commentaire    TEXT,
  changed_by     UUID,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historique_cmd ON public.historique_commandes(commande_id);

ALTER TABLE public.historique_commandes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "historique_commandes_all" ON public.historique_commandes;
CREATE POLICY "historique_commandes_all" ON public.historique_commandes FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- 2. BOUTIQUE — drop propre puis recréation
-- ══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.demandes_devis_web CASCADE;
DROP TABLE IF EXISTS public.commandes_shop      CASCADE;
DROP TABLE IF EXISTS public.produits_shop       CASCADE;

-- ── produits_shop ──────────────────────────────────────────────────────────

CREATE TABLE public.produits_shop (
  product_id              UUID        PRIMARY KEY
                            REFERENCES public.produits(id) ON DELETE CASCADE,
  visible_shop            BOOLEAN     NOT NULL DEFAULT false,
  prix_public             INTEGER     NOT NULL DEFAULT 0,
  description_longue      TEXT,
  images                  JSONB       NOT NULL DEFAULT '[]',
  tags                    JSONB       NOT NULL DEFAULT '[]',
  delai_fabrication_jours INTEGER,
  min_commande            INTEGER     NOT NULL DEFAULT 1,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_produits_shop_visible ON public.produits_shop(visible_shop);
CREATE INDEX idx_produits_shop_updated ON public.produits_shop(updated_at DESC);

CREATE OR REPLACE TRIGGER trg_produits_shop_updated_at
  BEFORE UPDATE ON public.produits_shop
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.produits_shop ENABLE ROW LEVEL SECURITY;
CREATE POLICY "produits_shop_select_all" ON public.produits_shop FOR SELECT USING (true);
CREATE POLICY "produits_shop_write_all"  ON public.produits_shop FOR ALL   USING (true) WITH CHECK (true);

-- ── commandes_shop ─────────────────────────────────────────────────────────

CREATE TABLE public.commandes_shop (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               TEXT        NOT NULL UNIQUE,
  client_nom        TEXT        NOT NULL,
  client_telephone  TEXT        NOT NULL,
  client_email      TEXT,
  client_adresse    TEXT        NOT NULL,
  client_ville      TEXT,
  lignes            JSONB       NOT NULL DEFAULT '[]',
  montant_ht        INTEGER     NOT NULL DEFAULT 0,
  tva               INTEGER     NOT NULL DEFAULT 0,
  montant_ttc       INTEGER     NOT NULL DEFAULT 0,
  frais_livraison   INTEGER     NOT NULL DEFAULT 0,
  mode_paiement     TEXT        NOT NULL
                      CHECK (mode_paiement IN ('mtn_momo','orange_money','livraison')),
  notes_client      TEXT,
  statut_commande   TEXT        NOT NULL DEFAULT 'recue'
                      CHECK (statut_commande IN (
                        'recue','confirmee','en_preparation','prete','expediee','livree','annulee'
                      )),
  statut_paiement   TEXT        NOT NULL DEFAULT 'en_attente'
                      CHECK (statut_paiement IN ('en_attente','paye','echoue','rembourse')),
  payment_reference TEXT,
  erp_commande_id   UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  photos_livraison  JSONB       NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commandes_shop_ref      ON public.commandes_shop(ref);
CREATE INDEX idx_commandes_shop_statut   ON public.commandes_shop(statut_commande);
CREATE INDEX idx_commandes_shop_paiement ON public.commandes_shop(statut_paiement);
CREATE INDEX idx_commandes_shop_created  ON public.commandes_shop(created_at DESC);
CREATE INDEX idx_commandes_shop_tel      ON public.commandes_shop(client_telephone);
CREATE INDEX idx_commandes_shop_erp      ON public.commandes_shop(erp_commande_id);

CREATE OR REPLACE TRIGGER trg_commandes_shop_updated_at
  BEFORE UPDATE ON public.commandes_shop
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.commandes_shop ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commandes_shop_insert_public"  ON public.commandes_shop FOR INSERT WITH CHECK (true);
CREATE POLICY "commandes_shop_select_public"  ON public.commandes_shop FOR SELECT USING (true);
CREATE POLICY "commandes_shop_update_service" ON public.commandes_shop FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "commandes_shop_delete_service" ON public.commandes_shop FOR DELETE USING (true);

-- ── demandes_devis_web ─────────────────────────────────────────────────────

CREATE TABLE public.demandes_devis_web (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom          TEXT        NOT NULL,
  telephone    TEXT        NOT NULL,
  email        TEXT,
  description  TEXT        NOT NULL,
  statut       TEXT        NOT NULL DEFAULT 'nouvelle'
                 CHECK (statut IN ('nouvelle','vue','traitee','refusee')),
  erp_devis_id UUID        REFERENCES public.devis(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_devis_web_statut  ON public.demandes_devis_web(statut);
CREATE INDEX idx_devis_web_created ON public.demandes_devis_web(created_at DESC);

ALTER TABLE public.demandes_devis_web ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devis_web_insert_public"  ON public.demandes_devis_web FOR INSERT WITH CHECK (true);
CREATE POLICY "devis_web_select_service" ON public.demandes_devis_web FOR SELECT USING (true);
CREATE POLICY "devis_web_update_service" ON public.demandes_devis_web FOR UPDATE USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- Vérification
-- ══════════════════════════════════════════════════════════════════════════

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'commandes','commandes_lignes','historique_commandes',
    'produits_shop','commandes_shop','demandes_devis_web'
  )
ORDER BY table_name;
