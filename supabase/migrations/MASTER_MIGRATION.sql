-- ═══════════════════════════════════════════════════════════════════════════
-- FORGE ERP — MASTER MIGRATION (run this single file on a fresh Supabase project)
-- Safe to run multiple times — uses IF NOT EXISTS / OR REPLACE everywhere
-- Tables are created in correct dependency order
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Shared trigger function ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── Auto-create profile on auth.users insert ──────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_app_meta_data->>'role', 'operateur')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role  = COALESCE(NEW.raw_app_meta_data->>'role', profiles.role);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ══════════════════════════════════════════════════════════════════════════
-- 1. PROFILES (mirror of auth.users)
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
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. PRODUITS
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
  BEFORE UPDATE ON public.produits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.produits DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. MOUVEMENTS STOCK
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
ALTER TABLE public.mouvements_stock DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. CLIENTS
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.clients (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                TEXT        NOT NULL,
  type               TEXT        NOT NULL DEFAULT 'entreprise'
                       CHECK (type IN ('particulier','entreprise','administration')),
  telephone          TEXT,
  email              TEXT,
  adresse            TEXT,
  ville              TEXT,
  pays               TEXT        NOT NULL DEFAULT 'Cameroun',
  statut             TEXT        NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','inactif','bloque')),
  score_fiabilite    INTEGER     NOT NULL DEFAULT 50,
  commandes_count    INTEGER     NOT NULL DEFAULT 0,
  total_ca_xaf       NUMERIC     NOT NULL DEFAULT 0,
  encours_credit_xaf NUMERIC     NOT NULL DEFAULT 0,
  notes              TEXT,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status        TEXT        NOT NULL DEFAULT 'synced'
);
CREATE OR REPLACE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.clients DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. DEVIS + LIGNES
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.devis (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              TEXT        NOT NULL UNIQUE,
  client_id           UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  client_nom          TEXT        NOT NULL,
  statut              TEXT        NOT NULL DEFAULT 'brouillon'
                        CHECK (statut IN ('brouillon','envoye','accepte','refuse','expire')),
  date_emission       TEXT        NOT NULL,
  date_validite       TEXT        NOT NULL,
  validite_jours      INTEGER     NOT NULL DEFAULT 30,
  acompte_pct         NUMERIC     NOT NULL DEFAULT 0,
  conditions_paiement TEXT        NOT NULL DEFAULT 'Virement bancaire',
  total_ht_xaf        NUMERIC     NOT NULL DEFAULT 0,
  tva_xaf             NUMERIC     NOT NULL DEFAULT 0,
  total_ttc_xaf       NUMERIC     NOT NULL DEFAULT 0,
  notes               TEXT,
  pdf_url             TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status         TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_devis_statut  ON public.devis(statut);
CREATE INDEX IF NOT EXISTS idx_devis_created ON public.devis(created_at DESC);
CREATE OR REPLACE TRIGGER trg_devis_updated_at
  BEFORE UPDATE ON public.devis FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.devis DISABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.devis_lignes DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. EMPLOYÉS + RH
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.employes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom               TEXT        NOT NULL,
  poste             TEXT        NOT NULL,
  departement       TEXT        NOT NULL,
  type_contrat      TEXT        NOT NULL DEFAULT 'CDI'
                      CHECK (type_contrat IN ('CDI','CDD','stage','freelance')),
  date_entree       TEXT        NOT NULL,
  date_sortie       TEXT,
  salaire_base_xaf  NUMERIC     NOT NULL DEFAULT 0,
  telephone         TEXT,
  email             TEXT,
  cin               TEXT,
  cnps              TEXT,
  statut            TEXT        NOT NULL DEFAULT 'actif'
                      CHECK (statut IN ('actif','inactif','conge','essai')),
  user_id           UUID,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       TEXT        NOT NULL DEFAULT 'synced'
);
CREATE OR REPLACE TRIGGER trg_employes_updated_at
  BEFORE UPDATE ON public.employes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.employes DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.presences (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id  UUID        NOT NULL REFERENCES public.employes(id) ON DELETE CASCADE,
  date        TEXT        NOT NULL,
  arrivee     TEXT,
  depart      TEXT,
  heures      NUMERIC     NOT NULL DEFAULT 0,
  statut      TEXT        NOT NULL CHECK (statut IN ('present','absent','conge','retard','maladie')),
  notes       TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_presences_employe ON public.presences(employe_id);
CREATE INDEX IF NOT EXISTS idx_presences_date    ON public.presences(date DESC);
ALTER TABLE public.presences DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bulletins_paie (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id           UUID        NOT NULL REFERENCES public.employes(id) ON DELETE CASCADE,
  mois                 TEXT        NOT NULL,
  salaire_base_xaf     NUMERIC     NOT NULL,
  heures_sup_xaf       NUMERIC     NOT NULL DEFAULT 0,
  primes_xaf           NUMERIC     NOT NULL DEFAULT 0,
  deductions_xaf       NUMERIC     NOT NULL DEFAULT 0,
  cotisation_cnps_xaf  NUMERIC     NOT NULL DEFAULT 0,
  cnps_employeur_xaf   NUMERIC     NOT NULL DEFAULT 0,
  irpp_xaf             NUMERIC     NOT NULL DEFAULT 0,
  net_xaf              NUMERIC     NOT NULL,
  cout_employeur_xaf   NUMERIC     NOT NULL DEFAULT 0,
  statut               TEXT        NOT NULL DEFAULT 'en_attente'
                         CHECK (statut IN ('en_attente','valide','vire')),
  genere_le            TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status          TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_bulletins_employe ON public.bulletins_paie(employe_id);
CREATE OR REPLACE TRIGGER trg_bulletins_updated_at
  BEFORE UPDATE ON public.bulletins_paie FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.bulletins_paie DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.apprenants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT        NOT NULL,
  specialite  TEXT        NOT NULL,
  niveau      INTEGER     NOT NULL DEFAULT 1,
  duree_mois  INTEGER     NOT NULL DEFAULT 0,
  statut      TEXT        NOT NULL DEFAULT 'actif'
                CHECK (statut IN ('actif','suspendu','diplome','recrute')),
  employe_id  UUID        REFERENCES public.employes(id) ON DELETE SET NULL,
  notes       TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_apprenants_statut ON public.apprenants(statut);
CREATE OR REPLACE TRIGGER trg_apprenants_updated_at
  BEFORE UPDATE ON public.apprenants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.apprenants DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.validations_niveau (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  apprenant_id    UUID        NOT NULL REFERENCES public.apprenants(id) ON DELETE CASCADE,
  niveau          INTEGER     NOT NULL,
  valide_by       UUID,
  date_validation TEXT        NOT NULL,
  commentaire     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.validations_niveau DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 7. COMMANDES + LIGNES + HISTORIQUE
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.commandes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                TEXT        NOT NULL UNIQUE,
  client_id             UUID        REFERENCES public.clients(id)  ON DELETE SET NULL,
  client_nom            TEXT        NOT NULL,
  devis_id              UUID        REFERENCES public.devis(id)    ON DELETE SET NULL,
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
  sync_status           TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_commandes_statut  ON public.commandes(statut);
CREATE INDEX IF NOT EXISTS idx_commandes_created ON public.commandes(created_at DESC);
CREATE OR REPLACE TRIGGER trg_commandes_updated_at
  BEFORE UPDATE ON public.commandes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.commandes DISABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.commandes_lignes DISABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.historique_commandes DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 8. FACTURES + LIGNES
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
CREATE INDEX IF NOT EXISTS idx_factures_statut  ON public.factures(statut);
CREATE INDEX IF NOT EXISTS idx_factures_created ON public.factures(created_at DESC);
CREATE OR REPLACE TRIGGER trg_factures_updated_at
  BEFORE UPDATE ON public.factures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.factures DISABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.factures_lignes DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 9. BONS DE SORTIE + LIGNES
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
CREATE INDEX IF NOT EXISTS idx_bons_statut  ON public.bons_sortie(statut);
CREATE INDEX IF NOT EXISTS idx_bons_created ON public.bons_sortie(created_at DESC);
CREATE OR REPLACE TRIGGER trg_bons_updated_at
  BEFORE UPDATE ON public.bons_sortie FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.bons_sortie DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bons_sortie_lignes (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  bon_id            UUID    NOT NULL REFERENCES public.bons_sortie(id) ON DELETE CASCADE,
  produit_id        UUID    REFERENCES public.produits(id) ON DELETE SET NULL,
  designation       TEXT    NOT NULL,
  unite             TEXT    NOT NULL DEFAULT 'unité',
  quantite_demandee NUMERIC NOT NULL,
  quantite_servie   NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bons_lignes_bon ON public.bons_sortie_lignes(bon_id);
ALTER TABLE public.bons_sortie_lignes DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 10. CRÉDITS + REMBOURSEMENTS
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.credits (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            TEXT        NOT NULL UNIQUE,
  client_id         UUID        REFERENCES public.clients(id)   ON DELETE SET NULL,
  client_nom        TEXT        NOT NULL,
  commande_id       UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  montant_xaf       NUMERIC     NOT NULL,
  solde_restant_xaf NUMERIC     NOT NULL,
  date_debut        TEXT        NOT NULL,
  echeance          TEXT        NOT NULL,
  statut            TEXT        NOT NULL DEFAULT 'en_cours'
                      CHECK (statut IN ('en_cours','en_retard','echu','solde')),
  notes             TEXT,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_credits_statut  ON public.credits(statut);
CREATE INDEX IF NOT EXISTS idx_credits_created ON public.credits(created_at DESC);
CREATE OR REPLACE TRIGGER trg_credits_updated_at
  BEFORE UPDATE ON public.credits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.credits DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.remboursements_credit (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id     UUID        NOT NULL REFERENCES public.credits(id) ON DELETE CASCADE,
  montant_xaf   NUMERIC     NOT NULL,
  date_paiement TEXT        NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('total','partiel')),
  notes         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.remboursements_credit DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 11. ÉCRITURES COMPTABLES
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ecritures_comptables (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  date             TEXT        NOT NULL,
  libelle          TEXT        NOT NULL,
  compte_syscohada TEXT        NOT NULL,
  compte_label     TEXT        NOT NULL,
  debit_xaf        NUMERIC     NOT NULL DEFAULT 0,
  credit_xaf       NUMERIC     NOT NULL DEFAULT 0,
  reference_doc    TEXT,
  facture_id       UUID        REFERENCES public.factures(id)  ON DELETE SET NULL,
  commande_id      UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status      TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_ecritures_compte  ON public.ecritures_comptables(compte_syscohada);
CREATE INDEX IF NOT EXISTS idx_ecritures_date    ON public.ecritures_comptables(date DESC);
ALTER TABLE public.ecritures_comptables DISABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.declarations_fiscales DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 12. MACHINES & IOT
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.machines (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                   TEXT        NOT NULL,
  type                  TEXT        NOT NULL,
  zone                  TEXT        NOT NULL,
  numero_serie          TEXT,
  statut                TEXT        NOT NULL DEFAULT 'actif'
                          CHECK (statut IN ('actif','maintenance','panne','inactif')),
  derniere_maintenance  TEXT,
  prochaine_maintenance TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status           TEXT        NOT NULL DEFAULT 'synced'
);
ALTER TABLE public.machines DISABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.capteurs_iot DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.mesures_iot (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  capteur_id UUID        NOT NULL REFERENCES public.capteurs_iot(id) ON DELETE CASCADE,
  valeur     NUMERIC     NOT NULL,
  unite      TEXT        NOT NULL,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  est_alerte BOOLEAN     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_mesures_capteur   ON public.mesures_iot(capteur_id);
CREATE INDEX IF NOT EXISTS idx_mesures_timestamp ON public.mesures_iot(timestamp DESC);
ALTER TABLE public.mesures_iot DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 13. PRODUCTION — JOBS
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.jobs_production (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              TEXT        NOT NULL UNIQUE,
  commande_id         UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  produit_designation TEXT        NOT NULL,
  machine_id          UUID        REFERENCES public.machines(id)  ON DELETE SET NULL,
  machine_nom         TEXT,
  technicien_id       UUID        REFERENCES public.employes(id)  ON DELETE SET NULL,
  technicien_nom      TEXT,
  avancement_pct      INTEGER     NOT NULL DEFAULT 0,
  statut              TEXT        NOT NULL DEFAULT 'confirmed'
                        CHECK (statut IN ('confirmed','in_production','pret','delivered','cancelled')),
  date_debut          TEXT,
  date_fin_prevue     TEXT,
  date_fin_reelle     TEXT,
  notes               TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status         TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_jobs_statut  ON public.jobs_production(statut);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON public.jobs_production(created_at DESC);
CREATE OR REPLACE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON public.jobs_production FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.jobs_production DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 14. PROJETS + TÂCHES
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.projets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom            TEXT        NOT NULL,
  description    TEXT,
  client_id      UUID        REFERENCES public.clients(id)  ON DELETE SET NULL,
  client_nom     TEXT,
  chef_projet_id UUID        REFERENCES public.employes(id) ON DELETE SET NULL,
  chef_projet_nom TEXT,
  budget_xaf     NUMERIC     NOT NULL DEFAULT 0,
  depense_xaf    NUMERIC     NOT NULL DEFAULT 0,
  avancement_pct INTEGER     NOT NULL DEFAULT 0,
  statut         TEXT        NOT NULL DEFAULT 'planifie'
                   CHECK (statut IN ('planifie','en_cours','suspendu','livre','annule')),
  date_debut     TEXT,
  deadline       TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status    TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_projets_statut  ON public.projets(statut);
CREATE INDEX IF NOT EXISTS idx_projets_created ON public.projets(created_at DESC);
CREATE OR REPLACE TRIGGER trg_projets_updated_at
  BEFORE UPDATE ON public.projets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.projets DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.taches_projet (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id      UUID        NOT NULL REFERENCES public.projets(id)  ON DELETE CASCADE,
  titre          TEXT        NOT NULL,
  description    TEXT,
  responsable_id UUID        REFERENCES public.employes(id) ON DELETE SET NULL,
  statut         TEXT        NOT NULL DEFAULT 'todo'
                   CHECK (statut IN ('todo','en_cours','bloque','termine')),
  priorite       TEXT        NOT NULL DEFAULT 'normale'
                   CHECK (priorite IN ('basse','normale','haute','critique')),
  date_echeance  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.taches_projet DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 15. LIVRAISONS
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.livraisons (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                TEXT        NOT NULL UNIQUE,
  commande_id           UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  client_id             UUID        REFERENCES public.clients(id)   ON DELETE SET NULL,
  client_nom            TEXT        NOT NULL,
  destination           TEXT        NOT NULL,
  transporteur          TEXT,
  statut                TEXT        NOT NULL DEFAULT 'confirmed'
                          CHECK (statut IN ('confirmed','in_production','pret','delivered','cancelled')),
  date_depart           TEXT,
  date_livraison_prevue TEXT,
  date_livraison_reelle TEXT,
  notes                 TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status           TEXT        NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_livraisons_statut  ON public.livraisons(statut);
CREATE INDEX IF NOT EXISTS idx_livraisons_created ON public.livraisons(created_at DESC);
CREATE OR REPLACE TRIGGER trg_livraisons_updated_at
  BEFORE UPDATE ON public.livraisons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.livraisons DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 16. MARKETING + SÉCURITÉ + EPI
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.campagnes_marketing (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom               TEXT        NOT NULL,
  description       TEXT,
  canal             TEXT        NOT NULL,
  budget_xaf        NUMERIC     NOT NULL DEFAULT 0,
  reach             INTEGER     NOT NULL DEFAULT 0,
  leads_count       INTEGER     NOT NULL DEFAULT 0,
  conversions_count INTEGER     NOT NULL DEFAULT 0,
  statut            TEXT        NOT NULL DEFAULT 'planifie'
                      CHECK (statut IN ('planifie','active','pause','termine','annule')),
  date_debut        TEXT        NOT NULL,
  date_fin          TEXT        NOT NULL,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status       TEXT        NOT NULL DEFAULT 'synced'
);
CREATE OR REPLACE TRIGGER trg_campagnes_updated_at
  BEFORE UPDATE ON public.campagnes_marketing FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.campagnes_marketing DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.incidents_securite (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 TEXT        NOT NULL,
  description          TEXT        NOT NULL,
  zone                 TEXT        NOT NULL,
  signale_par          TEXT        NOT NULL,
  statut               TEXT        NOT NULL DEFAULT 'ouvert'
                         CHECK (statut IN ('ouvert','traite','corrige','resolu')),
  date_incident        TEXT        NOT NULL,
  date_resolution      TEXT,
  actions_correctrices TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status          TEXT        NOT NULL DEFAULT 'synced'
);
CREATE OR REPLACE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON public.incidents_securite FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.incidents_securite DISABLE ROW LEVEL SECURITY;

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
ALTER TABLE public.epi_items DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 17. SHOP (produits_shop, commandes_shop, demandes_devis_web)
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.produits_shop (
  product_id              UUID        PRIMARY KEY REFERENCES public.produits(id) ON DELETE CASCADE,
  visible_shop            BOOLEAN     NOT NULL DEFAULT false,
  prix_public             INTEGER     NOT NULL DEFAULT 0,
  description_longue      TEXT,
  images                  JSONB       NOT NULL DEFAULT '[]',
  tags                    JSONB       NOT NULL DEFAULT '[]',
  delai_fabrication_jours INTEGER,
  min_commande            INTEGER     NOT NULL DEFAULT 1,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_produits_shop_visible ON public.produits_shop(visible_shop);
CREATE OR REPLACE TRIGGER trg_produits_shop_updated_at
  BEFORE UPDATE ON public.produits_shop FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.produits_shop DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.commandes_shop (
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
                      CHECK (statut_commande IN ('recue','confirmee','en_preparation','prete','expediee','livree','annulee')),
  statut_paiement   TEXT        NOT NULL DEFAULT 'en_attente'
                      CHECK (statut_paiement IN ('en_attente','paye','echoue','rembourse')),
  payment_reference TEXT,
  erp_commande_id   UUID        REFERENCES public.commandes(id) ON DELETE SET NULL,
  photos_livraison  JSONB       NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commandes_shop_statut   ON public.commandes_shop(statut_commande);
CREATE INDEX IF NOT EXISTS idx_commandes_shop_created  ON public.commandes_shop(created_at DESC);
CREATE OR REPLACE TRIGGER trg_commandes_shop_updated_at
  BEFORE UPDATE ON public.commandes_shop FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.commandes_shop DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.demandes_devis_web (
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
ALTER TABLE public.demandes_devis_web DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 18. AUDIT LOG
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID,
  action     TEXT        NOT NULL,
  table_name TEXT        NOT NULL,
  record_id  TEXT,
  new_data   JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_table   ON public.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log(created_at DESC);
ALTER TABLE public.audit_log DISABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════
-- 19. FONCTION fn_executer_bon (transaction atomique stock)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_executer_bon(
  p_bon_id  UUID,
  p_user_id UUID,
  p_quantites_reelles JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bon        RECORD;
  v_ligne      RECORD;
  v_stock      NUMERIC;
  v_qte_servie NUMERIC;
BEGIN
  SELECT * INTO v_bon FROM public.bons_sortie WHERE id = p_bon_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BON_NOT_FOUND: Bon introuvable';
  END IF;
  IF v_bon.statut <> 'valide' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: Statut actuel % — seul "valide" peut être exécuté', v_bon.statut;
  END IF;

  FOR v_ligne IN
    SELECT * FROM public.bons_sortie_lignes WHERE bon_id = p_bon_id
  LOOP
    v_qte_servie := v_ligne.quantite_demandee;
    IF p_quantites_reelles IS NOT NULL THEN
      SELECT (el->>'quantite_servie')::NUMERIC INTO v_qte_servie
      FROM jsonb_array_elements(p_quantites_reelles) el
      WHERE el->>'ligne_id' = v_ligne.id::TEXT;
      IF v_qte_servie IS NULL THEN
        v_qte_servie := v_ligne.quantite_demandee;
      END IF;
    END IF;

    IF v_ligne.produit_id IS NOT NULL AND v_qte_servie > 0 THEN
      SELECT stock_actuel INTO v_stock FROM public.produits WHERE id = v_ligne.produit_id FOR UPDATE;
      IF v_stock < v_qte_servie THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock insuffisant pour % (dispo: %, demandé: %)',
          v_ligne.designation, v_stock, v_qte_servie;
      END IF;
      UPDATE public.produits
        SET stock_actuel = stock_actuel - v_qte_servie,
            statut = CASE
              WHEN stock_actuel - v_qte_servie = 0             THEN 'rupture'
              WHEN stock_actuel - v_qte_servie <= stock_critique THEN 'critique'
              WHEN stock_actuel - v_qte_servie <= stock_min      THEN 'alerte'
              ELSE 'normal'
            END,
            updated_at = now()
        WHERE id = v_ligne.produit_id;
      INSERT INTO public.mouvements_stock(produit_id, type, quantite, reference, created_by)
        VALUES(v_ligne.produit_id, 'sortie', v_qte_servie, v_bon.numero, p_user_id);
    END IF;

    UPDATE public.bons_sortie_lignes
      SET quantite_servie = v_qte_servie
      WHERE id = v_ligne.id;
  END LOOP;

  UPDATE public.bons_sortie
    SET statut = 'execute', updated_at = now()
    WHERE id = p_bon_id;

  RETURN jsonb_build_object('success', true, 'bon_id', p_bon_id);
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 20. VÉRIFICATION FINALE — liste toutes les tables créées
-- ══════════════════════════════════════════════════════════════════════════
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
