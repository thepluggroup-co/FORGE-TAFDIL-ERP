-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — Script complet de création de toutes les tables manquantes
-- SAFE TO RUN MULTIPLE TIMES — utilise IF NOT EXISTS partout
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- PROFILES (table miroir de auth.users)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT        NOT NULL,
  nom        TEXT        NOT NULL DEFAULT '',
  role       TEXT        NOT NULL DEFAULT 'operateur'
               CHECK (role IN ('admin','directeur','operateur','viewer')),
  telephone  TEXT,
  avatar_url TEXT,
  actif      BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_all" ON public.profiles;
CREATE POLICY "profiles_all" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- PRODUITS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.produits (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               TEXT        NOT NULL UNIQUE,
  designation       TEXT        NOT NULL,
  description       TEXT,
  categorie         TEXT        NOT NULL,
  unite             TEXT        NOT NULL DEFAULT 'unité',
  stock_actuel      NUMERIC     NOT NULL DEFAULT 0,
  stock_min         NUMERIC     NOT NULL DEFAULT 5,
  stock_critique    NUMERIC     NOT NULL DEFAULT 2,
  prix_unitaire_xaf NUMERIC     NOT NULL DEFAULT 0,
  statut            TEXT        NOT NULL DEFAULT 'normal'
                      CHECK (statut IN ('normal','alerte','critique','rupture')),
  emplacement       TEXT,
  fournisseur       TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       TEXT        NOT NULL DEFAULT 'synced'
);

CREATE OR REPLACE TRIGGER trg_produits_updated_at
  BEFORE UPDATE ON public.produits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "produits_all"           ON public.produits;
DROP POLICY IF EXISTS "produits_read_public"   ON public.produits;
CREATE POLICY "produits_all"         ON public.produits FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "produits_read_public" ON public.produits FOR SELECT USING (true);

-- ══════════════════════════════════════════════════════════════════════════
-- MOUVEMENTS STOCK
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mouvements_stock (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id UUID        NOT NULL REFERENCES public.produits(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL CHECK (type IN ('entree','sortie','ajustement','transfert')),
  quantite   NUMERIC     NOT NULL,
  reference  TEXT,
  notes      TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mouvements_produit ON public.mouvements_stock(produit_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_created ON public.mouvements_stock(created_at DESC);

ALTER TABLE public.mouvements_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mouvements_all" ON public.mouvements_stock;
CREATE POLICY "mouvements_all" ON public.mouvements_stock FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- CLIENTS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.clients (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                 TEXT        NOT NULL,
  type                TEXT        NOT NULL DEFAULT 'entreprise'
                        CHECK (type IN ('particulier','entreprise','administration')),
  telephone           TEXT,
  email               TEXT,
  adresse             TEXT,
  ville               TEXT,
  pays                TEXT        NOT NULL DEFAULT 'Cameroun',
  statut              TEXT        NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','inactif','bloque')),
  score_fiabilite     INTEGER     NOT NULL DEFAULT 50,
  commandes_count     INTEGER     NOT NULL DEFAULT 0,
  total_ca_xaf        NUMERIC     NOT NULL DEFAULT 0,
  encours_credit_xaf  NUMERIC     NOT NULL DEFAULT 0,
  notes               TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status         TEXT        NOT NULL DEFAULT 'synced'
);

CREATE OR REPLACE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clients_all" ON public.clients;
CREATE POLICY "clients_all" ON public.clients FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- DEVIS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.devis (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               TEXT        NOT NULL UNIQUE,
  client_id            UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  client_nom           TEXT        NOT NULL,
  statut               TEXT        NOT NULL DEFAULT 'brouillon'
                         CHECK (statut IN ('brouillon','envoye','accepte','refuse','expire')),
  date_emission        TEXT        NOT NULL,
  date_validite        TEXT        NOT NULL,
  validite_jours       INTEGER     NOT NULL DEFAULT 30,
  acompte_pct          NUMERIC     NOT NULL DEFAULT 0,
  conditions_paiement  TEXT        NOT NULL DEFAULT 'Virement bancaire',
  total_ht_xaf         NUMERIC     NOT NULL DEFAULT 0,
  tva_xaf              NUMERIC     NOT NULL DEFAULT 0,
  total_ttc_xaf        NUMERIC     NOT NULL DEFAULT 0,
  notes                TEXT,
  pdf_url              TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status          TEXT        NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_devis_numero  ON public.devis(numero);
CREATE INDEX IF NOT EXISTS idx_devis_statut  ON public.devis(statut);
CREATE INDEX IF NOT EXISTS idx_devis_created ON public.devis(created_at DESC);

CREATE OR REPLACE TRIGGER trg_devis_updated_at
  BEFORE UPDATE ON public.devis
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.devis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "devis_all" ON public.devis;
CREATE POLICY "devis_all" ON public.devis FOR ALL USING (true) WITH CHECK (true);

-- ── Lignes de devis ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.devis_lignes (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  devis_id             UUID    NOT NULL REFERENCES public.devis(id) ON DELETE CASCADE,
  designation          TEXT    NOT NULL,
  description          TEXT,
  categorie            TEXT    NOT NULL DEFAULT 'materiaux',
  unite                TEXT    NOT NULL DEFAULT 'unité',
  quantite             NUMERIC NOT NULL,
  prix_unitaire_ht_xaf NUMERIC NOT NULL,
  total_ht_xaf         NUMERIC NOT NULL,
  ordre                INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.devis_lignes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "devis_lignes_all" ON public.devis_lignes;
CREATE POLICY "devis_lignes_all" ON public.devis_lignes FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- BONS DE SORTIE
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.bons_sortie (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        TEXT        NOT NULL UNIQUE,
  statut        TEXT        NOT NULL DEFAULT 'soumis'
                  CHECK (statut IN ('soumis','valide','refuse','execute')),
  demandeur     TEXT        NOT NULL,
  valide_par_id UUID,
  motif         TEXT        NOT NULL,
  notes         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status   TEXT        NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_bons_numero  ON public.bons_sortie(numero);
CREATE INDEX IF NOT EXISTS idx_bons_statut  ON public.bons_sortie(statut);
CREATE INDEX IF NOT EXISTS idx_bons_created ON public.bons_sortie(created_at DESC);

CREATE OR REPLACE TRIGGER trg_bons_updated_at
  BEFORE UPDATE ON public.bons_sortie
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bons_sortie ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bons_all" ON public.bons_sortie;
CREATE POLICY "bons_all" ON public.bons_sortie FOR ALL USING (true) WITH CHECK (true);

-- ── Lignes de bon ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bons_sortie_lignes (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  bon_id             UUID    NOT NULL REFERENCES public.bons_sortie(id) ON DELETE CASCADE,
  produit_id         UUID    REFERENCES public.produits(id) ON DELETE SET NULL,
  designation        TEXT    NOT NULL,
  unite              TEXT    NOT NULL DEFAULT 'unité',
  quantite_demandee  NUMERIC NOT NULL,
  quantite_servie    NUMERIC NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bons_lignes_bon ON public.bons_sortie_lignes(bon_id);

ALTER TABLE public.bons_sortie_lignes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bons_lignes_all" ON public.bons_sortie_lignes;
CREATE POLICY "bons_lignes_all" ON public.bons_sortie_lignes FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- FACTURES
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.factures (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           TEXT        NOT NULL UNIQUE,
  commande_id      UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  client_id        UUID        REFERENCES public.clients(id)   ON DELETE SET NULL,
  client_nom       TEXT        NOT NULL,
  statut           TEXT        NOT NULL DEFAULT 'brouillon'
                     CHECK (statut IN ('brouillon','envoyee','payee','partiellement_payee','en_retard','annulee')),
  date_emission    TEXT        NOT NULL,
  date_echeance    TEXT        NOT NULL,
  total_ht_xaf     NUMERIC     NOT NULL DEFAULT 0,
  tva_xaf          NUMERIC     NOT NULL DEFAULT 0,
  total_ttc_xaf    NUMERIC     NOT NULL DEFAULT 0,
  montant_paye_xaf NUMERIC     NOT NULL DEFAULT 0,
  notes            TEXT,
  pdf_url          TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status      TEXT        NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_factures_numero  ON public.factures(numero);
CREATE INDEX IF NOT EXISTS idx_factures_statut  ON public.factures(statut);
CREATE INDEX IF NOT EXISTS idx_factures_created ON public.factures(created_at DESC);

CREATE OR REPLACE TRIGGER trg_factures_updated_at
  BEFORE UPDATE ON public.factures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.factures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "factures_all" ON public.factures;
CREATE POLICY "factures_all" ON public.factures FOR ALL USING (true) WITH CHECK (true);

-- ── Lignes de facture ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.factures_lignes (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id           UUID    NOT NULL REFERENCES public.factures(id) ON DELETE CASCADE,
  designation          TEXT    NOT NULL,
  unite                TEXT    NOT NULL DEFAULT 'unité',
  quantite             NUMERIC NOT NULL,
  prix_unitaire_ht_xaf NUMERIC NOT NULL,
  total_ht_xaf         NUMERIC NOT NULL,
  ordre                INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.factures_lignes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "factures_lignes_all" ON public.factures_lignes;
CREATE POLICY "factures_lignes_all" ON public.factures_lignes FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- CRÉDITS & REMBOURSEMENTS
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.credits (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           TEXT        NOT NULL UNIQUE,
  client_id        UUID        REFERENCES public.clients(id)   ON DELETE SET NULL,
  client_nom       TEXT        NOT NULL,
  commande_id      UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  montant_xaf      NUMERIC     NOT NULL,
  solde_restant_xaf NUMERIC    NOT NULL,
  date_debut       TEXT        NOT NULL,
  echeance         TEXT        NOT NULL,
  statut           TEXT        NOT NULL DEFAULT 'en_cours'
                     CHECK (statut IN ('en_cours','en_retard','echu','solde')),
  notes            TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status      TEXT        NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_credits_statut  ON public.credits(statut);
CREATE INDEX IF NOT EXISTS idx_credits_created ON public.credits(created_at DESC);

CREATE OR REPLACE TRIGGER trg_credits_updated_at
  BEFORE UPDATE ON public.credits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credits_all" ON public.credits;
CREATE POLICY "credits_all" ON public.credits FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.remboursements_credit (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id      UUID        NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  montant_xaf    NUMERIC     NOT NULL,
  date_paiement  TEXT        NOT NULL,
  type           TEXT        NOT NULL CHECK (type IN ('total','partiel')),
  notes          TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.remboursements_credit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "remboursements_all" ON public.remboursements_credit;
CREATE POLICY "remboursements_all" ON public.remboursements_credit FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- ÉCRITURES COMPTABLES
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ecritures_comptables (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  date              TEXT        NOT NULL,
  libelle           TEXT        NOT NULL,
  compte_syscohada  TEXT        NOT NULL,
  compte_label      TEXT        NOT NULL,
  debit_xaf         NUMERIC     NOT NULL DEFAULT 0,
  credit_xaf        NUMERIC     NOT NULL DEFAULT 0,
  reference_doc     TEXT,
  facture_id        UUID        REFERENCES public.factures(id) ON DELETE SET NULL,
  commande_id       UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       TEXT        NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_ecritures_compte  ON public.ecritures_comptables(compte_syscohada);
CREATE INDEX IF NOT EXISTS idx_ecritures_date    ON public.ecritures_comptables(date DESC);
CREATE INDEX IF NOT EXISTS idx_ecritures_created ON public.ecritures_comptables(created_at DESC);

ALTER TABLE public.ecritures_comptables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ecritures_all" ON public.ecritures_comptables;
CREATE POLICY "ecritures_all" ON public.ecritures_comptables FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- DÉCLARATIONS FISCALES
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.declarations_fiscales (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT        NOT NULL,
  periode     TEXT        NOT NULL,
  statut      TEXT        NOT NULL DEFAULT 'a_declarer',
  montant_xaf NUMERIC     NOT NULL DEFAULT 0,
  echeance    TEXT        NOT NULL,
  soumis_le   TEXT,
  valide_by   UUID,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT        NOT NULL DEFAULT 'synced'
);

ALTER TABLE public.declarations_fiscales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "declarations_all" ON public.declarations_fiscales;
CREATE POLICY "declarations_all" ON public.declarations_fiscales FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- MACHINES & IOT
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.machines (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                  TEXT        NOT NULL,
  type                 TEXT        NOT NULL,
  zone                 TEXT        NOT NULL,
  numero_serie         TEXT,
  statut               TEXT        NOT NULL DEFAULT 'actif'
                         CHECK (statut IN ('actif','maintenance','panne','inactif')),
  derniere_maintenance TEXT,
  prochaine_maintenance TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status          TEXT        NOT NULL DEFAULT 'synced'
);

ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "machines_all" ON public.machines;
CREATE POLICY "machines_all" ON public.machines FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.capteurs_iot (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom              TEXT        NOT NULL UNIQUE,
  type             TEXT        NOT NULL,
  zone             TEXT        NOT NULL,
  unite            TEXT        NOT NULL,
  seuil_alerte     NUMERIC,
  seuil_critique   NUMERIC,
  batterie_pct     INTEGER     NOT NULL DEFAULT 100,
  statut           TEXT        NOT NULL DEFAULT 'actif',
  derniere_synchro TIMESTAMPTZ,
  firmware         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status      TEXT        NOT NULL DEFAULT 'synced'
);

ALTER TABLE public.capteurs_iot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "capteurs_all" ON public.capteurs_iot;
CREATE POLICY "capteurs_all" ON public.capteurs_iot FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.mesures_iot (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  capteur_id  UUID        NOT NULL REFERENCES public.capteurs_iot(id) ON DELETE CASCADE,
  valeur      NUMERIC     NOT NULL,
  unite       TEXT        NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  est_alerte  BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_mesures_capteur   ON public.mesures_iot(capteur_id);
CREATE INDEX IF NOT EXISTS idx_mesures_timestamp ON public.mesures_iot(timestamp DESC);

ALTER TABLE public.mesures_iot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mesures_all" ON public.mesures_iot;
CREATE POLICY "mesures_all" ON public.mesures_iot FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- EPI
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.epi_items (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  designation           TEXT        NOT NULL,
  total                 INTEGER     NOT NULL DEFAULT 0,
  conformes             INTEGER     NOT NULL DEFAULT 0,
  derniere_verification TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.epi_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "epi_all" ON public.epi_items;
CREATE POLICY "epi_all" ON public.epi_items FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- TÂCHES PROJET
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.taches_projet (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id       UUID        NOT NULL REFERENCES public.projets(id) ON DELETE CASCADE,
  titre           TEXT        NOT NULL,
  description     TEXT,
  responsable_id  UUID        REFERENCES public.employes(id) ON DELETE SET NULL,
  statut          TEXT        NOT NULL DEFAULT 'todo'
                    CHECK (statut IN ('todo','en_cours','bloque','termine')),
  priorite        TEXT        NOT NULL DEFAULT 'normale'
                    CHECK (priorite IN ('basse','normale','haute','critique')),
  date_echeance   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.taches_projet ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "taches_all" ON public.taches_projet;
CREATE POLICY "taches_all" ON public.taches_projet FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- AUDIT LOG (utilisé par le middleware audit.ts)
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  action      TEXT        NOT NULL,
  table_name  TEXT        NOT NULL,
  record_id   TEXT,
  new_data    JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user    ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_table   ON public.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_all" ON public.audit_log;
CREATE POLICY "audit_all" ON public.audit_log FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- COLONNES MANQUANTES sur tables existantes
-- ══════════════════════════════════════════════════════════════════════════

-- produits
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced';
ALTER TABLE public.produits ADD COLUMN IF NOT EXISTS created_by  UUID;

-- bons_sortie
ALTER TABLE public.bons_sortie ADD COLUMN IF NOT EXISTS sync_status    TEXT NOT NULL DEFAULT 'synced';
ALTER TABLE public.bons_sortie ADD COLUMN IF NOT EXISTS created_by     UUID;
ALTER TABLE public.bons_sortie ADD COLUMN IF NOT EXISTS valide_par_id  UUID;
ALTER TABLE public.bons_sortie ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();

-- commandes
ALTER TABLE public.commandes ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced';
ALTER TABLE public.commandes ADD COLUMN IF NOT EXISTS created_by  UUID;

-- devis
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced';
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS created_by  UUID;
ALTER TABLE public.devis ADD COLUMN IF NOT EXISTS pdf_url     TEXT;

-- factures
ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS sync_status      TEXT    NOT NULL DEFAULT 'synced';
ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS created_by       UUID;
ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS pdf_url          TEXT;
ALTER TABLE public.factures ADD COLUMN IF NOT EXISTS montant_paye_xaf NUMERIC NOT NULL DEFAULT 0;

-- clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sync_status          TEXT    NOT NULL DEFAULT 'synced';
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS created_by           UUID;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS score_fiabilite      INTEGER NOT NULL DEFAULT 50;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS commandes_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS total_ca_xaf         NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS encours_credit_xaf   NUMERIC NOT NULL DEFAULT 0;

-- employes
ALTER TABLE public.employes ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.employes ADD COLUMN IF NOT EXISTS cnps_employeur_xaf NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.employes ADD COLUMN IF NOT EXISTS irpp_xaf           NUMERIC NOT NULL DEFAULT 0;

-- bulletins_paie
ALTER TABLE public.bulletins_paie ADD COLUMN IF NOT EXISTS cnps_employeur_xaf NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.bulletins_paie ADD COLUMN IF NOT EXISTS irpp_xaf           NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.bulletins_paie ADD COLUMN IF NOT EXISTS cout_employeur_xaf NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.bulletins_paie ADD COLUMN IF NOT EXISTS heures_sup_xaf     NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.bulletins_paie ADD COLUMN IF NOT EXISTS primes_xaf         NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.bulletins_paie ADD COLUMN IF NOT EXISTS deductions_xaf     NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.bulletins_paie ADD COLUMN IF NOT EXISTS cotisation_cnps_xaf NUMERIC NOT NULL DEFAULT 0;

-- jobs_production
ALTER TABLE public.jobs_production ADD COLUMN IF NOT EXISTS commande_id    UUID REFERENCES public.commandes(id) ON DELETE SET NULL;
ALTER TABLE public.jobs_production ADD COLUMN IF NOT EXISTS machine_id     UUID REFERENCES public.machines(id)  ON DELETE SET NULL;
ALTER TABLE public.jobs_production ADD COLUMN IF NOT EXISTS technicien_id  UUID REFERENCES public.employes(id)  ON DELETE SET NULL;
ALTER TABLE public.jobs_production ADD COLUMN IF NOT EXISTS sync_status    TEXT NOT NULL DEFAULT 'synced';

-- livraisons
ALTER TABLE public.livraisons ADD COLUMN IF NOT EXISTS commande_id UUID REFERENCES public.commandes(id) ON DELETE SET NULL;
ALTER TABLE public.livraisons ADD COLUMN IF NOT EXISTS client_id   UUID REFERENCES public.clients(id)   ON DELETE SET NULL;
ALTER TABLE public.livraisons ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced';

-- projets
ALTER TABLE public.projets ADD COLUMN IF NOT EXISTS client_id       UUID REFERENCES public.clients(id)   ON DELETE SET NULL;
ALTER TABLE public.projets ADD COLUMN IF NOT EXISTS chef_projet_id  UUID REFERENCES public.employes(id)  ON DELETE SET NULL;
ALTER TABLE public.projets ADD COLUMN IF NOT EXISTS sync_status     TEXT NOT NULL DEFAULT 'synced';

-- ══════════════════════════════════════════════════════════════════════════
-- DÉSACTIVER RLS sur toutes les tables (service role bypasse RLS de toute façon)
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION FINALE
-- ══════════════════════════════════════════════════════════════════════════

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
