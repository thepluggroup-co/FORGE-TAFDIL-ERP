-- ============================================================
-- FORGE ERP — Script d'application des migrations manquantes
-- IMPORTANT : Tous les IDs sont UUID dans Supabase PostgreSQL
-- Utilise IF NOT EXISTS / IF NOT EXISTS — IDEMPOTENT (safe à relancer)
-- ============================================================

-- ============================================================
-- 1. Colonnes manquantes sur PROJETS
--    (la table a été créée par 20260519 sans client_id / chef_projet_id)
-- ============================================================
ALTER TABLE projets
  ADD COLUMN IF NOT EXISTS client_id      UUID REFERENCES clients(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chef_projet_id UUID REFERENCES employes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assistant_id   UUID REFERENCES employes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projets_client_id
  ON projets(client_id) WHERE client_id IS NOT NULL;

-- 2. Table membres équipe projet
CREATE TABLE IF NOT EXISTS projets_membres (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id         UUID    NOT NULL REFERENCES projets(id)  ON DELETE CASCADE,
  employe_id        UUID    NOT NULL REFERENCES employes(id),
  role_projet       TEXT    NOT NULL DEFAULT 'technicien',
  date_debut        TEXT,
  date_fin          TEXT,
  heures_planifiees REAL    NOT NULL DEFAULT 0,
  heures_reelles    REAL    NOT NULL DEFAULT 0,
  created_by        UUID    REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(projet_id, employe_id)
);
CREATE INDEX IF NOT EXISTS idx_projets_membres_projet  ON projets_membres(projet_id);
CREATE INDEX IF NOT EXISTS idx_projets_membres_employe ON projets_membres(employe_id);

-- 3. Table équipements
CREATE TABLE IF NOT EXISTS equipements (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT    UNIQUE NOT NULL,
  designation           TEXT    NOT NULL,
  categorie             TEXT    NOT NULL DEFAULT 'outil',
  numero_serie          TEXT,
  fournisseur           TEXT,
  date_acquisition      TEXT,
  valeur_achat_xaf      REAL    NOT NULL DEFAULT 0,
  emplacement           TEXT,
  responsable_id        UUID    REFERENCES employes(id),
  statut                TEXT    NOT NULL DEFAULT 'disponible',
  prochaine_revision    TEXT,
  intervalle_revision_j INTEGER NOT NULL DEFAULT 365,
  notes                 TEXT,
  created_by            UUID    REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipements_statut    ON equipements(statut);
CREATE INDEX IF NOT EXISTS idx_equipements_revision  ON equipements(prochaine_revision);
CREATE INDEX IF NOT EXISTS idx_equipements_categorie ON equipements(categorie);

-- 4. Table maintenances équipements
CREATE TABLE IF NOT EXISTS maintenances_equipement (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  equipement_id    UUID    NOT NULL REFERENCES equipements(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL DEFAULT 'preventive',
  date_maintenance TEXT    NOT NULL,
  technicien_id    UUID    REFERENCES employes(id),
  cout_xaf         REAL    NOT NULL DEFAULT 0,
  description      TEXT,
  prochaine_date   TEXT,
  statut           TEXT    NOT NULL DEFAULT 'planifie',
  created_by       UUID    REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_maintenances_equipement ON maintenances_equipement(equipement_id);

-- 5. Table ressources projet
CREATE TABLE IF NOT EXISTS projets_ressources (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id         UUID    NOT NULL REFERENCES projets(id) ON DELETE CASCADE,
  type              TEXT    NOT NULL DEFAULT 'main_oeuvre',
  designation       TEXT    NOT NULL,
  employe_id        UUID    REFERENCES employes(id),
  produit_id        UUID    REFERENCES produits(id),
  equipement_id     UUID    REFERENCES equipements(id),
  quantite          REAL    NOT NULL DEFAULT 1 CHECK (quantite > 0),
  unite             TEXT    NOT NULL DEFAULT 'unité',
  cout_unitaire_xaf REAL    NOT NULL DEFAULT 0 CHECK (cout_unitaire_xaf >= 0),
  statut            TEXT    NOT NULL DEFAULT 'planifie',
  notes             TEXT,
  created_by        UUID    REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projets_ressources_projet ON projets_ressources(projet_id);
CREATE INDEX IF NOT EXISTS idx_projets_ressources_type   ON projets_ressources(projet_id, type);

-- 6. Colonne approbation client sur devis
ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS token_approbation   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS token_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approuve_par_client BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approuve_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commentaire_client  TEXT;

-- FK bon_sortie_id sur devis (UUID car bons_sortie.id est UUID)
ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS bon_sortie_id UUID REFERENCES bons_sortie(id);

-- 7. Colonne montant_paye sur commandes
ALTER TABLE commandes
  ADD COLUMN IF NOT EXISTS montant_paye_xaf REAL NOT NULL DEFAULT 0;

-- 8. Table paiements commande (CMD05)
CREATE TABLE IF NOT EXISTS paiements_commande (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  commande_id    UUID    NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  client_id      UUID    REFERENCES clients(id),
  montant_xaf    REAL    NOT NULL CHECK (montant_xaf > 0),
  methode        TEXT    NOT NULL DEFAULT 'mobile_money',
  reference_ext  TEXT,
  statut         TEXT    NOT NULL DEFAULT 'confirme',
  date_paiement  TEXT    NOT NULL,
  notes          TEXT,
  enregistre_par UUID    REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_paiements_commande ON paiements_commande(commande_id);

-- 9. Table congés (RH02)
CREATE TABLE IF NOT EXISTS conges (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id      UUID    NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL DEFAULT 'conge_paye',
  date_debut      TEXT    NOT NULL,
  date_fin        TEXT    NOT NULL,
  jours_ouvres    INTEGER NOT NULL DEFAULT 1 CHECK (jours_ouvres > 0),
  statut          TEXT    NOT NULL DEFAULT 'en_attente',
  motif           TEXT,
  approuve_par    UUID    REFERENCES profiles(id),
  approuve_at     TIMESTAMPTZ,
  commentaire_rh  TEXT,
  created_by      UUID    REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conges_employe_id ON conges(employe_id);
CREATE INDEX IF NOT EXISTS idx_conges_statut     ON conges(statut);
CREATE INDEX IF NOT EXISTS idx_conges_dates      ON conges(date_debut, date_fin);

-- 10. Colonnes enrichissement bulletins_paie
ALTER TABLE bulletins_paie
  ADD COLUMN IF NOT EXISTS jours_travailles   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jours_conge        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jours_absence      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jours_maladie      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heures_sup_nb      REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS irpp_xaf           REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cnps_employeur_xaf REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cout_employeur_xaf REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mode_generation    TEXT    NOT NULL DEFAULT 'manuel';

-- ============================================================
-- 11. Colonnes manquantes sur LIVRAISONS
--    (créée par 20260519 sans client_id ni commande_id)
-- ============================================================
ALTER TABLE livraisons
  ADD COLUMN IF NOT EXISTS client_id   UUID REFERENCES clients(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commande_id UUID REFERENCES commandes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_livraisons_client_id
  ON livraisons(client_id) WHERE client_id IS NOT NULL;

-- ============================================================
-- 12. Index FK clients (après ajout des colonnes ci-dessus)
-- ============================================================
-- devis.client_id existe depuis 20260524 ✓
CREATE INDEX IF NOT EXISTS idx_devis_client_id
  ON devis(client_id) WHERE client_id IS NOT NULL;
-- commandes.client_id existe depuis 20260524 ✓
CREATE INDEX IF NOT EXISTS idx_commandes_client_id
  ON commandes(client_id) WHERE client_id IS NOT NULL;
-- factures.client_id existe depuis 20260524 ✓
CREATE INDEX IF NOT EXISTS idx_factures_client_id
  ON factures(client_id) WHERE client_id IS NOT NULL;
-- credits.client_id existe depuis 20260524 ✓
CREATE INDEX IF NOT EXISTS idx_credits_client_id
  ON credits(client_id) WHERE client_id IS NOT NULL;
-- projets.client_id : index créé en section 1 ci-dessus ✓
-- livraisons.client_id : index créé en section 11 ci-dessus ✓

-- 13. Table email_queue
CREATE TABLE IF NOT EXISTS email_queue (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  destinataire    TEXT    NOT NULL,
  sujet           TEXT    NOT NULL,
  corps_html      TEXT    NOT NULL,
  statut          TEXT    NOT NULL DEFAULT 'en_attente',
  priorite        TEXT    NOT NULL DEFAULT 'normale',
  tentatives      INTEGER NOT NULL DEFAULT 0,
  max_tentatives  INTEGER NOT NULL DEFAULT 3,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  erreur          TEXT,
  reference_type  TEXT,
  reference_id    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_queue_statut
  ON email_queue(statut, scheduled_at) WHERE statut = 'en_attente';

-- 14. Vue récap coûts projet
CREATE OR REPLACE VIEW v_projets_couts AS
SELECT
  p.id                                                                      AS projet_id,
  p.nom                                                                     AS projet_nom,
  p.budget_xaf,
  COALESCE(SUM(r.quantite * r.cout_unitaire_xaf), 0)                       AS cout_ressources_xaf,
  COALESCE(SUM(r.quantite * r.cout_unitaire_xaf)
    FILTER (WHERE r.type = 'main_oeuvre'), 0)                              AS cout_main_oeuvre_xaf,
  COALESCE(SUM(r.quantite * r.cout_unitaire_xaf)
    FILTER (WHERE r.type IN ('intrant','consommable')), 0)                 AS cout_materiaux_xaf,
  GREATEST(0, p.budget_xaf -
    COALESCE(SUM(r.quantite * r.cout_unitaire_xaf), 0))                   AS budget_restant_xaf
FROM projets p
LEFT JOIN projets_ressources r ON r.projet_id = p.id
GROUP BY p.id, p.nom, p.budget_xaf;

-- 15. Vue solde congés
-- date - date returns integer days in PostgreSQL, no need for EXTRACT(EPOCH)
CREATE OR REPLACE VIEW v_solde_conges AS
SELECT
  e.id                                                                      AS employe_id,
  e.nom                                                                     AS employe_nom,
  GREATEST(0,
    FLOOR((CURRENT_DATE - e.date_entree::date) / 30.0 * 1.5)
  )::INTEGER                                                                AS jours_acquis,
  COALESCE(SUM(c.jours_ouvres)
    FILTER (WHERE c.statut = 'approuve' AND c.type = 'conge_paye'), 0)     AS jours_pris,
  GREATEST(0,
    FLOOR((CURRENT_DATE - e.date_entree::date) / 30.0 * 1.5)::INTEGER -
    COALESCE(SUM(c.jours_ouvres)
      FILTER (WHERE c.statut = 'approuve' AND c.type = 'conge_paye'), 0)
  )                                                                         AS jours_restants
FROM employes e
LEFT JOIN conges c ON c.employe_id = e.id
WHERE e.statut != 'inactif'
GROUP BY e.id, e.nom, e.date_entree;

-- ============================================================
-- Rafraîchir le cache schéma PostgREST (IMPORTANT)
-- ============================================================
NOTIFY pgrst, 'reload schema';
