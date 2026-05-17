-- ============================================================
-- FORGE Shop — Extension catalogue public + commandes web
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- ── produits_shop ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS produits_shop (
  product_id              UUID        PRIMARY KEY REFERENCES produits(id) ON DELETE CASCADE,
  visible_shop            BOOLEAN     NOT NULL DEFAULT false,
  prix_public             DECIMAL(12,2),
  description_longue      TEXT,
  images                  TEXT[]      NOT NULL DEFAULT '{}',
  tags                    TEXT[]      NOT NULL DEFAULT '{}',
  delai_fabrication_jours INT         NOT NULL DEFAULT 7,
  min_commande            DECIMAL(10,2) NOT NULL DEFAULT 1,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour filtrer rapidement les produits visibles
CREATE INDEX IF NOT EXISTS idx_produits_shop_visible ON produits_shop(visible_shop)
  WHERE visible_shop = true;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_produits_shop_updated_at ON produits_shop;
CREATE TRIGGER trg_produits_shop_updated_at
  BEFORE UPDATE ON produits_shop
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── commandes_shop ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commandes_shop (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                 TEXT        NOT NULL UNIQUE,           -- WEB-2026-0542
  client_nom          TEXT        NOT NULL,
  client_telephone    TEXT        NOT NULL,
  client_email        TEXT,
  client_adresse      TEXT        NOT NULL,
  client_ville        TEXT,
  lignes              JSONB       NOT NULL DEFAULT '[]',
  montant_ht          DECIMAL(14,2),
  tva                 DECIMAL(14,2),
  montant_ttc         DECIMAL(14,2),
  frais_livraison     DECIMAL(10,2) NOT NULL DEFAULT 0,
  mode_paiement       TEXT        CHECK (mode_paiement IN ('mtn_momo', 'orange_money', 'livraison')),
  statut_paiement     TEXT        NOT NULL DEFAULT 'en_attente'
                        CHECK (statut_paiement IN ('en_attente', 'paye', 'echec', 'rembourse')),
  statut_commande     TEXT        NOT NULL DEFAULT 'recue'
                        CHECK (statut_commande IN ('recue', 'confirmee', 'en_preparation', 'expediee', 'livree', 'annulee')),
  notes_client        TEXT,
  payment_reference   TEXT,
  erp_commande_id     UUID        REFERENCES commandes(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commandes_shop_ref       ON commandes_shop(ref);
CREATE INDEX IF NOT EXISTS idx_commandes_shop_statut    ON commandes_shop(statut_commande);
CREATE INDEX IF NOT EXISTS idx_commandes_shop_created   ON commandes_shop(created_at DESC);

DROP TRIGGER IF EXISTS trg_commandes_shop_updated_at ON commandes_shop;
CREATE TRIGGER trg_commandes_shop_updated_at
  BEFORE UPDATE ON commandes_shop
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Séquence pour les références WEB-YYYY-XXXX
CREATE SEQUENCE IF NOT EXISTS commandes_shop_seq START 1;

-- ── sessions_panier ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions_panier (
  session_id  TEXT        PRIMARY KEY,
  items       JSONB       NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nettoyage automatique des sessions > 7 jours (pg_cron ou Supabase Edge Function)
CREATE INDEX IF NOT EXISTS idx_sessions_panier_updated ON sessions_panier(updated_at);

DROP TRIGGER IF EXISTS trg_sessions_panier_updated_at ON sessions_panier;
CREATE TRIGGER trg_sessions_panier_updated_at
  BEFORE UPDATE ON sessions_panier
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── demandes_devis_web ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demandes_devis_web (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT        NOT NULL,
  telephone   TEXT        NOT NULL,
  email       TEXT,
  description TEXT        NOT NULL,
  fichiers    TEXT[]      NOT NULL DEFAULT '{}',
  statut      TEXT        NOT NULL DEFAULT 'nouvelle'
                CHECK (statut IN ('nouvelle', 'en_cours', 'traitee', 'refusee')),
  erp_devis_id UUID       REFERENCES devis(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demandes_devis_statut ON demandes_devis_web(statut);

-- ── Row Level Security ────────────────────────────────────────
-- Les tables shop sont en lecture publique pour le catalogue,
-- écriture publique pour les commandes/devis (pas d'auth requise)

ALTER TABLE produits_shop       ENABLE ROW LEVEL SECURITY;
ALTER TABLE commandes_shop      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions_panier     ENABLE ROW LEVEL SECURITY;
ALTER TABLE demandes_devis_web  ENABLE ROW LEVEL SECURITY;

-- produits_shop : lecture publique des visibles
CREATE POLICY "produits_shop_read_public" ON produits_shop
  FOR SELECT USING (visible_shop = true);
CREATE POLICY "produits_shop_write_auth" ON produits_shop
  FOR ALL USING (auth.role() = 'authenticated');

-- commandes_shop : insertion publique, lecture via ref ou auth
CREATE POLICY "commandes_shop_insert_public" ON commandes_shop
  FOR INSERT WITH CHECK (true);
CREATE POLICY "commandes_shop_select_auth" ON commandes_shop
  FOR SELECT USING (auth.role() = 'authenticated');

-- sessions_panier : chaque session ne voit que les siennes
CREATE POLICY "sessions_panier_own" ON sessions_panier
  FOR ALL USING (true);   -- contrôle par session_id côté API

-- demandes_devis : insertion publique
CREATE POLICY "devis_web_insert_public" ON demandes_devis_web
  FOR INSERT WITH CHECK (true);
CREATE POLICY "devis_web_select_auth" ON demandes_devis_web
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── Realtime ──────────────────────────────────────────────────
-- Active Realtime sur commandes_shop pour notifier l'ERP
ALTER PUBLICATION supabase_realtime ADD TABLE commandes_shop;
ALTER PUBLICATION supabase_realtime ADD TABLE demandes_devis_web;
