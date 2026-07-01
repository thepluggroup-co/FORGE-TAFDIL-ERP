/**
 * FORGE ERP — Drizzle ORM Schema (PostgreSQL / Supabase)
 * Structure identique à schema.ts — dialecte PostgreSQL.
 * Utilisé pour les migrations Supabase et la génération de types.
 */
import {
  pgTable, uuid, text, integer, real, boolean,
  timestamp, pgEnum,
} from 'drizzle-orm/pg-core'

// ── Helpers ────────────────────────────────────────────────────────────────────

const id  = () => uuid('id').primaryKey().defaultRandom()
const ts  = (col: string) => timestamp(col, { withTimezone: true }).notNull().defaultNow()
const tsN = (col: string) => timestamp(col, { withTimezone: true })

// ── Enums PostgreSQL ───────────────────────────────────────────────────────────

export const roleEnum          = pgEnum('role',           ['admin', 'superviseur', 'operateur', 'apprenant'])
export const syncStatusEnum    = pgEnum('sync_status',    ['synced', 'pending', 'conflict'])
export const clientTypeEnum    = pgEnum('client_type',    ['entreprise', 'particulier', 'institution'])
export const clientStatutEnum  = pgEnum('client_statut',  ['actif', 'inactif', 'bloque'])
export const produitStatutEnum = pgEnum('produit_statut', ['normal', 'alerte', 'critique', 'rupture'])
export const bonStatutEnum     = pgEnum('bon_statut',     ['en_attente', 'soumis', 'valide', 'execute', 'refuse'])
export const bonTypeEnum       = pgEnum('bon_type',       ['commande', 'devis', 'manuel'])
export const devisStatutEnum   = pgEnum('devis_statut',   ['brouillon', 'envoye', 'accepte', 'refuse', 'expire', 'transforme'])
export const commandeStatutEnum = pgEnum('commande_statut', ['confirmed', 'in_production', 'pret', 'delivered', 'cancelled'])
export const factureStatutEnum = pgEnum('facture_statut', ['brouillon', 'valide', 'envoye', 'paye', 'annule'])
export const creditStatutEnum  = pgEnum('credit_statut',  ['en_cours', 'echu', 'rembourse'])
export const contratEnum       = pgEnum('type_contrat',   ['CDI', 'CDD', 'stage', 'freelance'])
export const employeStatutEnum = pgEnum('employe_statut', ['actif', 'inactif', 'conge', 'essai'])
export const presenceStatutEnum = pgEnum('presence_statut', ['present', 'absent', 'conge', 'retard', 'maladie'])
export const paieStatutEnum    = pgEnum('paie_statut',    ['en_attente', 'valide', 'vire'])
export const apprenantStatutEnum = pgEnum('apprenant_statut', ['actif', 'suspendu', 'diplome', 'recrute'])
export const machineStatutEnum = pgEnum('machine_statut', ['actif', 'maintenance', 'panne', 'reserve'])
export const projetStatutEnum  = pgEnum('projet_statut',  ['planifie', 'en_cours', 'suspendu', 'livre', 'annule'])
export const tacheStatutEnum   = pgEnum('tache_statut',   ['todo', 'en_cours', 'done', 'bloque'])
export const prioriteEnum      = pgEnum('priorite',       ['basse', 'normale', 'haute', 'critique'])
export const campagneStatutEnum = pgEnum('campagne_statut', ['planifie', 'active', 'pause', 'termine', 'annule'])
export const incidentStatutEnum = pgEnum('incident_statut', ['ouvert', 'traite', 'corrige', 'resolu'])
export const capteurStatutEnum = pgEnum('capteur_statut', ['actif', 'alerte', 'hors_ligne', 'maintenance'])
export const declStatutEnum    = pgEnum('decl_statut',    ['a_declarer', 'soumis', 'valide'])
export const mvtTypeEnum       = pgEnum('mvt_type',       ['entree', 'sortie', 'ajustement', 'transfert'])
export const categorieDevisEnum = pgEnum('categorie_devis', ['materiaux', 'main_oeuvre', 'equipement', 'autre'])
export const rembTypeEnum           = pgEnum('remb_type',              ['total', 'partiel'])
export const natureTransactionEnum  = pgEnum('nature_transaction_enum', ['comptant', 'credit', 'deduction_acompte'])
export const imputationPayeurEnum   = pgEnum('imputation_payeur_enum',  ['entreprise_tafdil', 'atelier', 'administration'])
export const statutPreparationEnum  = pgEnum('statut_preparation_enum', ['a_preparer', 'en_cours', 'pret'])
export const remiseTypeEnum         = pgEnum('remise_type_enum',        ['pct', 'forfait'])

// ══════════════════════════════════════════════════════════════════════════════
// AUTH / PROFILS
// ══════════════════════════════════════════════════════════════════════════════

export const profilesPg = pgTable('profiles', {
  id:        uuid('id').primaryKey(),           // Supabase Auth UUID (pas defaultRandom)
  email:     text('email').notNull().unique(),
  nom:       text('nom').notNull(),
  role:      roleEnum('role').notNull().default('operateur'),
  telephone: text('telephone'),
  avatarUrl: text('avatar_url'),
  actif:     boolean('actif').notNull().default(true),
  createdAt: ts('created_at'),
  updatedAt: ts('updated_at'),
})

export type ProfilePg       = typeof profilesPg.$inferSelect
export type NouveauProfilePg = typeof profilesPg.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════════════

export const clientsPg = pgTable('clients', {
  id:               id(),
  nom:              text('nom').notNull(),
  type:             clientTypeEnum('type').notNull(),
  telephone:        text('telephone'),
  email:            text('email'),
  adresse:          text('adresse'),
  ville:            text('ville'),
  pays:             text('pays').notNull().default('Cameroun'),
  statut:           clientStatutEnum('statut').notNull().default('actif'),
  scoreFiabilite:   text('score_fiabilite').notNull().default('nouveau'),
  plafondCreditXaf: integer('plafond_credit_xaf').default(0),
  commandesCount:   integer('commandes_count').notNull().default(0),
  totalCaXaf:       real('total_ca_xaf').notNull().default(0),
  encoursCreditXaf: real('encours_credit_xaf').notNull().default(0),
  notes:            text('notes'),
  createdBy:        uuid('created_by').references(() => profilesPg.id),
  createdAt:        ts('created_at'),
  updatedAt:        ts('updated_at'),
  syncStatus:       syncStatusEnum('sync_status').notNull().default('pending'),
})

export type ClientPg       = typeof clientsPg.$inferSelect
export type NouveauClientPg = typeof clientsPg.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// PRODUITS / STOCKS
// ══════════════════════════════════════════════════════════════════════════════

export const produitsPg = pgTable('produits', {
  id:             id(),
  ref:            text('ref').notNull().unique(),
  designation:    text('designation').notNull(),
  description:    text('description'),
  categorie:      text('categorie').notNull(),
  unite:          text('unite').notNull().default('unité'),
  stockActuel:    real('stock_actuel').notNull().default(0),
  stockMin:       real('stock_min').notNull().default(5),
  stockCritique:  real('stock_critique').notNull().default(2),
  prixUnitaireXaf: real('prix_unitaire_xaf').notNull().default(0),
  statut:         produitStatutEnum('statut').notNull().default('normal'),
  emplacement:    text('emplacement'),
  fournisseur:    text('fournisseur'),
  createdBy:      uuid('created_by').references(() => profilesPg.id),
  createdAt:      ts('created_at'),
  updatedAt:      ts('updated_at'),
  syncStatus:     syncStatusEnum('sync_status').notNull().default('pending'),
})

export type ProduitPg       = typeof produitsPg.$inferSelect
export type NouveauProduitPg = typeof produitsPg.$inferInsert

export const mouvementsStockPg = pgTable('mouvements_stock', {
  id:         id(),
  produitId:  uuid('produit_id').notNull().references(() => produitsPg.id),
  type:       mvtTypeEnum('type').notNull(),
  quantite:   real('quantite').notNull(),
  reference:  text('reference'),
  notes:      text('notes'),
  createdBy:  uuid('created_by').references(() => profilesPg.id),
  createdAt:  ts('created_at'),
})

export const bonsSortiePg = pgTable('bons_sortie', {
  id:          id(),
  numero:      text('numero').notNull().unique(),
  statut:      bonStatutEnum('statut').notNull().default('soumis'),
  type:        bonTypeEnum('type').notNull().default('manuel'),
  // FK nullable vers commandes/devis — sans .references() (forward ref non supporté sans AnyPgColumn)
  commandeId:  uuid('commande_id'),
  devisId:     uuid('devis_id'),
  demandeur:        text('demandeur').notNull(),
  valideParId:      uuid('valide_par_id').references(() => profilesPg.id),
  motif:            text('motif').notNull(),
  natureTransaction:   natureTransactionEnum('nature_transaction'),
  imputationPayeur:    imputationPayeurEnum('imputation_payeur'),
  preparateurId:       uuid('preparateur_id'),
  statutPreparation:   statutPreparationEnum('statut_preparation'),
  notes:               text('notes'),
  createdBy:   uuid('created_by').references(() => profilesPg.id),
  createdAt:   ts('created_at'),
  updatedAt:   ts('updated_at'),
  syncStatus:  syncStatusEnum('sync_status').notNull().default('pending'),
})

export const bonsSortieLignesPg = pgTable('bons_sortie_lignes', {
  id:               id(),
  bonId:            uuid('bon_id').notNull().references(() => bonsSortiePg.id),
  produitId:        uuid('produit_id').references(() => produitsPg.id),
  designation:      text('designation').notNull(),
  unite:            text('unite').notNull().default('unité'),
  quantiteDemandee: real('quantite_demandee').notNull(),
  quantiteServie:   real('quantite_servie').notNull().default(0),
})

// ══════════════════════════════════════════════════════════════════════════════
// ACHATS — FOURNISSEURS & APPROVISIONNEMENT
// ══════════════════════════════════════════════════════════════════════════════

export const fournisseursPg = pgTable('fournisseurs', {
  id:              id(),
  nom:             text('nom').notNull(),
  telephone:       text('telephone'),
  email:           text('email'),
  adresse:         text('adresse'),
  notes:           text('notes'),
  actif:           boolean('actif').notNull().default(true),
  whatsapp:        text('whatsapp'),
  produitsFournis: text('produits_fournis').array().default([]),
  createdAt:       ts('created_at'),
  updatedAt:       ts('updated_at'),
  syncStatus:      syncStatusEnum('sync_status').notNull().default('synced'),
})

export type FournisseurPg       = typeof fournisseursPg.$inferSelect
export type NouveauFournisseurPg = typeof fournisseursPg.$inferInsert

export const bonsApprovisionnementPg = pgTable('bons_approvisionnement', {
  id:                     id(),
  numero:                 text('numero').notNull().unique(),
  statut:                 text('statut').notNull().default('brouillon'),
  bonSortieId:            uuid('bon_sortie_id').references(() => bonsSortiePg.id),
  notes:                  text('notes'),
  type:                   text('type').notNull().default('auto'),
  fournisseurId:          uuid('fournisseur_id').references(() => fournisseursPg.id),
  fournisseurNom:         text('fournisseur_nom'),
  dateLivraisonSouhaitee: text('date_livraison_souhaitee'),
  quantiteRecue:          real('quantite_recue').default(0),
  createdBy:              uuid('created_by').references(() => profilesPg.id),
  createdAt:              ts('created_at'),
  updatedAt:              ts('updated_at'),
  syncStatus:             syncStatusEnum('sync_status').notNull().default('synced'),
})

export type BonApprovisionnementPg       = typeof bonsApprovisionnementPg.$inferSelect
export type NouveauBonApprovisionnementPg = typeof bonsApprovisionnementPg.$inferInsert

export const bonsApprovisionnementLignesPg = pgTable('bons_approvisionnement_lignes', {
  id:                 id(),
  bonId:              uuid('bon_id').notNull().references(() => bonsApprovisionnementPg.id),
  produitId:          uuid('produit_id').references(() => produitsPg.id),
  designation:        text('designation').notNull(),
  unite:              text('unite').notNull().default('unité'),
  quantiteACommander: real('quantite_a_commander').notNull(),
  stockActuelSnap:    real('stock_actuel_snap').notNull(),
  stockMinSnap:       real('stock_min_snap').notNull(),
  statutAlerte:       text('statut_alerte').notNull().default('alerte'),
  fournisseur:        text('fournisseur'),
  quantiteRecue:      real('quantite_recue').default(0),
})

export type BonApprovisionnementLignePg       = typeof bonsApprovisionnementLignesPg.$inferSelect
export type NouveauBonApprovisionnementLignePg = typeof bonsApprovisionnementLignesPg.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// COMMERCIAL — DEVIS
// ══════════════════════════════════════════════════════════════════════════════

export const remisesBaremePg = pgTable('remises_bareme', {
  id:                      id(),
  code:                    text('code').notNull().unique(),
  libelle:                 text('libelle').notNull(),
  type:                    remiseTypeEnum('type').notNull().default('pct'),
  valeur:                  real('valeur').notNull(),
  conditionAncienneteMois: integer('condition_anciennete_mois').notNull().default(0),
  scoreMin:                text('score_min').notNull().default('nouveau'),
  accordDgRequis:          boolean('accord_dg_requis').notNull().default(false),
  actif:                   boolean('actif').notNull().default(true),
  createdAt:               tsN('created_at'),
})

export const devisPg = pgTable('devis', {
  id:                  id(),
  numero:              text('numero').notNull().unique(),
  clientId:            uuid('client_id').references(() => clientsPg.id),
  clientNom:           text('client_nom').notNull(),
  statut:              devisStatutEnum('statut').notNull().default('brouillon'),
  dateEmission:        text('date_emission').notNull(),
  dateValidite:        text('date_validite').notNull(),
  validitJours:        integer('validite_jours').notNull().default(30),
  acomptePct:          real('acompte_pct').notNull().default(0),
  conditionPaiementId: uuid('condition_paiement_id'),
  remiseGlobaleXaf:    real('remise_globale_xaf').default(0),
  remiseGlobaleMotif:  text('remise_globale_motif'),
  totalHtXaf:          real('total_ht_xaf').notNull().default(0),
  tvaXaf:              real('tva_xaf').notNull().default(0),
  totalTtcXaf:         real('total_ttc_xaf').notNull().default(0),
  netAPayerXaf:        real('net_a_payer_xaf'),
  notes:               text('notes'),
  createdBy:           uuid('created_by').references(() => profilesPg.id),
  createdAt:           ts('created_at'),
  updatedAt:           ts('updated_at'),
  syncStatus:          syncStatusEnum('sync_status').notNull().default('pending'),
})

export const devisLignesPg = pgTable('devis_lignes', {
  id:                id(),
  devisId:           uuid('devis_id').notNull().references(() => devisPg.id),
  produitId:         uuid('produit_id').references(() => produitsPg.id),
  designation:       text('designation').notNull(),
  description:       text('description'),
  categorie:         categorieDevisEnum('categorie').notNull().default('materiaux'),
  unite:             text('unite').notNull().default('unité'),
  quantite:          real('quantite').notNull(),
  prixUnitaireHtXaf: real('prix_unitaire_ht_xaf').notNull(),
  totalHtXaf:        real('total_ht_xaf').notNull(),
  remiseType:        text('remise_type'),
  remiseValeur:      real('remise_valeur'),
  remiseXaf:         real('remise_xaf').default(0),
  remiseMotif:       text('remise_motif'),
  appliqueParId:     uuid('applique_par_id'),
  ordre:             integer('ordre').notNull().default(0),
})

// ══════════════════════════════════════════════════════════════════════════════
// COMMERCIAL — CONDITIONS DE PAIEMENT
// ══════════════════════════════════════════════════════════════════════════════

export const conditionsPaiementPg = pgTable('conditions_paiement', {
  id:              id(),
  code:            text('code').notNull().unique(),
  libelle:         text('libelle').notNull(),
  acomptePct:      real('acompte_pct').notNull().default(100),
  delaiSoldeJours: integer('delai_solde_jours').notNull().default(0),
  actif:           boolean('actif').notNull().default(true),
})

export type ConditionPaiementPg        = typeof conditionsPaiementPg.$inferSelect
export type NouvelleConditionPaiementPg = typeof conditionsPaiementPg.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// COMMERCIAL — COMMANDES
// ══════════════════════════════════════════════════════════════════════════════

export const commandesPg = pgTable('commandes', {
  id:                  id(),
  numero:              text('numero').notNull().unique(),
  clientId:            uuid('client_id').references(() => clientsPg.id),
  clientNom:           text('client_nom').notNull(),
  devisId:             uuid('devis_id').references(() => devisPg.id),
  statut:              commandeStatutEnum('statut').notNull().default('confirmed'),
  dateCommande:        text('date_commande').notNull(),
  dateLivraisonPrevue: text('date_livraison_prevue'),
  remiseGlobaleXaf:    real('remise_globale_xaf').default(0),
  remiseGlobaleMotif:  text('remise_globale_motif'),
  totalHtXaf:          real('total_ht_xaf').notNull().default(0),
  tvaXaf:              real('tva_xaf').notNull().default(0),
  fraisLivraisonXaf:   real('frais_livraison_xaf').notNull().default(0),
  totalTtcXaf:         real('total_ttc_xaf').notNull().default(0),
  netAPayerXaf:        real('net_a_payer_xaf'),
  acompteRecu:         real('acompte_recu_xaf').notNull().default(0),
  conditionPaiementId: uuid('condition_paiement_id').references(() => conditionsPaiementPg.id),
  montantAcompteXaf:   integer('montant_acompte_xaf').default(0),
  dateEcheanceSolde:   text('date_echeance_solde'),
  statutPaiement:      text('statut_paiement').default('non_paye'),
  notes:               text('notes'),
  createdBy:           uuid('created_by').references(() => profilesPg.id),
  createdAt:           ts('created_at'),
  updatedAt:           ts('updated_at'),
  syncStatus:          syncStatusEnum('sync_status').notNull().default('pending'),
})

export const commandesLignesPg = pgTable('commandes_lignes', {
  id:                id(),
  commandeId:        uuid('commande_id').notNull().references(() => commandesPg.id),
  produitId:         uuid('produit_id').references(() => produitsPg.id),
  designation:       text('designation').notNull(),
  unite:             text('unite').notNull().default('unité'),
  quantite:          real('quantite').notNull(),
  prixUnitaireHtXaf: real('prix_unitaire_ht_xaf').notNull(),
  totalHtXaf:        real('total_ht_xaf').notNull(),
  remiseType:        text('remise_type'),
  remiseValeur:      real('remise_valeur'),
  remiseXaf:         real('remise_xaf').default(0),
  remiseMotif:       text('remise_motif'),
  appliqueParId:     uuid('applique_par_id'),
  ordre:             integer('ordre').notNull().default(0),
})

export const historiqueCommandesPg = pgTable('historique_commandes', {
  id:             id(),
  commandeId:     uuid('commande_id').notNull().references(() => commandesPg.id),
  ancienStatut:   text('ancien_statut'),
  nouveauStatut:  text('nouveau_statut').notNull(),
  commentaire:    text('commentaire'),
  changedBy:      uuid('changed_by').references(() => profilesPg.id),
  changedAt:      ts('changed_at'),
})

// ══════════════════════════════════════════════════════════════════════════════
// FINANCE
// ══════════════════════════════════════════════════════════════════════════════

export const facturesPg = pgTable('factures', {
  id:                  id(),
  numero:              text('numero').notNull().unique(),
  commandeId:          uuid('commande_id').references(() => commandesPg.id),
  conditionPaiementId: uuid('condition_paiement_id').references(() => conditionsPaiementPg.id),
  clientId:            uuid('client_id').references(() => clientsPg.id),
  clientNom:           text('client_nom').notNull(),
  statut:              factureStatutEnum('statut').notNull().default('brouillon'),
  acompteRecuXaf:      real('acompte_recu_xaf').default(0),
  dateEmission:        text('date_emission').notNull(),
  dateEcheance:        text('date_echeance').notNull(),
  remiseGlobaleXaf:    real('remise_globale_xaf').default(0),
  remiseGlobaleMotif:  text('remise_globale_motif'),
  totalHtXaf:          real('total_ht_xaf').notNull().default(0),
  tvaXaf:              real('tva_xaf').notNull().default(0),
  fraisLivraisonXaf:   real('frais_livraison_xaf').notNull().default(0),
  totalTtcXaf:         real('total_ttc_xaf').notNull().default(0),
  netAPayerXaf:        real('net_a_payer_xaf'),
  montantPayeXaf:      real('montant_paye_xaf').notNull().default(0),
  notes:               text('notes'),
  createdBy:           uuid('created_by').references(() => profilesPg.id),
  createdAt:           ts('created_at'),
  updatedAt:           ts('updated_at'),
  syncStatus:          syncStatusEnum('sync_status').notNull().default('pending'),
})

export const facturesLignesPg = pgTable('factures_lignes', {
  id:                id(),
  factureId:         uuid('facture_id').notNull().references(() => facturesPg.id),
  designation:       text('designation').notNull(),
  unite:             text('unite').notNull().default('unité'),
  quantite:          real('quantite').notNull(),
  prixUnitaireHtXaf: real('prix_unitaire_ht_xaf').notNull(),
  totalHtXaf:        real('total_ht_xaf').notNull(),
  remiseType:        text('remise_type'),
  remiseValeur:      real('remise_valeur'),
  remiseXaf:         real('remise_xaf').default(0),
  remiseMotif:       text('remise_motif'),
  appliqueParId:     uuid('applique_par_id'),
  ordre:             integer('ordre').notNull().default(0),
})

export const versementsFacturesPg = pgTable('versements_factures', {
  id:            id(),
  factureId:     uuid('facture_id').notNull().references(() => facturesPg.id),
  montantXaf:    integer('montant_xaf').notNull(),
  dateVersement: text('date_versement').notNull(),
  modePaiement:  text('mode_paiement'),
  reference:     text('reference'),
  note:          text('note'),
  enregistrePar: text('enregistre_par'),
  createdAt:     tsN('created_at'),
})

export type VersementFacturePg       = typeof versementsFacturesPg.$inferSelect
export type NouveauVersementFacturePg = typeof versementsFacturesPg.$inferInsert

export const creditsPg = pgTable('credits', {
  id:              id(),
  numero:          text('numero').notNull().unique(),
  clientId:        uuid('client_id').references(() => clientsPg.id),
  clientNom:       text('client_nom').notNull(),
  factureId:       uuid('facture_id').references(() => facturesPg.id),
  commandeId:      uuid('commande_id').references(() => commandesPg.id),
  montantXaf:      real('montant_xaf').notNull(),
  soldeRestantXaf: real('solde_restant_xaf').notNull(),
  dateDebut:       text('date_debut').notNull(),
  echeance:        text('echeance').notNull(),
  statut:          creditStatutEnum('statut').notNull().default('en_cours'),
  notes:           text('notes'),
  createdBy:       uuid('created_by').references(() => profilesPg.id),
  createdAt:       ts('created_at'),
  updatedAt:       ts('updated_at'),
  syncStatus:      syncStatusEnum('sync_status').notNull().default('pending'),
})

export const remboursementsCreditPg = pgTable('remboursements_credit', {
  id:           id(),
  creditId:     uuid('credit_id').notNull().references(() => creditsPg.id),
  montantXaf:   real('montant_xaf').notNull(),
  datePaiement: text('date_paiement').notNull(),
  type:         rembTypeEnum('type').notNull(),
  notes:        text('notes'),
  createdBy:    uuid('created_by').references(() => profilesPg.id),
  createdAt:    ts('created_at'),
})

export const ecrituresComptablesPg = pgTable('ecritures_comptables', {
  id:            id(),
  date:          text('date').notNull(),
  libelle:       text('libelle').notNull(),
  compteSysco:   text('compte_syscohada').notNull(),
  compteLabel:   text('compte_label').notNull(),
  debitXaf:      real('debit_xaf').notNull().default(0),
  creditXaf:     real('credit_xaf').notNull().default(0),
  referenceDoc:  text('reference_doc'),
  factureId:     uuid('facture_id').references(() => facturesPg.id),
  commandeId:    uuid('commande_id').references(() => commandesPg.id),
  createdBy:     uuid('created_by').references(() => profilesPg.id),
  createdAt:     ts('created_at'),
  syncStatus:    syncStatusEnum('sync_status').notNull().default('pending'),
})

export const declarationsFiscalesPg = pgTable('declarations_fiscales', {
  id:          id(),
  type:        text('type').notNull(),
  periode:     text('periode').notNull(),
  statut:      declStatutEnum('statut').notNull().default('a_declarer'),
  montantXaf:  real('montant_xaf').notNull().default(0),
  echeance:    text('echeance').notNull(),
  soumisLe:    tsN('soumis_le'),
  valideBy:    uuid('valide_by').references(() => profilesPg.id),
  notes:       text('notes'),
  createdAt:   ts('created_at'),
  updatedAt:   ts('updated_at'),
  syncStatus:  syncStatusEnum('sync_status').notNull().default('pending'),
})

// ══════════════════════════════════════════════════════════════════════════════
// RH
// ══════════════════════════════════════════════════════════════════════════════

export const chargesPg = pgTable('charges', {
  id:                  id(),
  numero:              text('numero').notNull().unique(),
  fournisseurNom:      text('fournisseur_nom').notNull(),
  categorie:           text('categorie').notNull(),
  compteCharge:        text('compte_charge').notNull(),
  compteChargeLabel:   text('compte_charge_label').notNull(),
  dateCharge:          text('date_charge').notNull(),
  dateEcheance:        text('date_echeance'),
  statut:              text('statut').notNull().default('brouillon'),
  montantHtXaf:        real('montant_ht_xaf').notNull().default(0),
  tvaXaf:              real('tva_xaf').notNull().default(0),
  montantTtcXaf:       real('montant_ttc_xaf').notNull().default(0),
  montantPayeXaf:      real('montant_paye_xaf').notNull().default(0),
  modePaiement:        text('mode_paiement'),
  compteTresorerie:    text('compte_tresorerie'),
  referencePaiement:   text('reference_paiement'),
  justificatifStatut:  text('justificatif_statut').notNull().default('manquant'),
  description:         text('description'),
  notes:               text('notes'),
  commandeId:          uuid('commande_id').references(() => commandesPg.id),
  projetId:            uuid('projet_id').references(() => projetsPg.id),
  equipementId:        uuid('equipement_id'),
  createdBy:           uuid('created_by').references(() => profilesPg.id),
  validatedBy:         uuid('validated_by').references(() => profilesPg.id),
  validatedAt:         tsN('validated_at'),
  createdAt:           ts('created_at'),
  updatedAt:           ts('updated_at'),
  syncStatus:          syncStatusEnum('sync_status').notNull().default('pending'),
})

export const sortiesTresoreriePg = pgTable('sorties_tresorerie', {
  id:                 id(),
  numero:             text('numero').notNull().unique(),
  chargeId:           uuid('charge_id').references(() => chargesPg.id),
  dateSortie:         text('date_sortie').notNull(),
  beneficiaire:       text('beneficiaire').notNull(),
  motif:              text('motif').notNull(),
  montantXaf:         real('montant_xaf').notNull(),
  modePaiement:       text('mode_paiement').notNull(),
  compteTresorerie:   text('compte_tresorerie').notNull(),
  referencePaiement:  text('reference_paiement'),
  statut:             text('statut').notNull().default('validee'),
  justificatifStatut: text('justificatif_statut').notNull().default('manquant'),
  notes:              text('notes'),
  createdBy:          uuid('created_by').references(() => profilesPg.id),
  createdAt:          ts('created_at'),
  updatedAt:          ts('updated_at'),
  syncStatus:         syncStatusEnum('sync_status').notNull().default('pending'),
})

export const chargesJustificatifsPg = pgTable('charges_justificatifs', {
  id:           id(),
  chargeId:     uuid('charge_id').references(() => chargesPg.id),
  sortieId:     uuid('sortie_id').references(() => sortiesTresoreriePg.id),
  nomFichier:   text('nom_fichier').notNull(),
  typeMime:     text('type_mime').notNull(),
  storagePath:  text('storage_path').notNull(),
  tailleBytes:  integer('taille_bytes').notNull().default(0),
  description:  text('description'),
  createdBy:    uuid('created_by').references(() => profilesPg.id),
  createdAt:    ts('created_at'),
})

export const employesPg = pgTable('employes', {
  id:             id(),
  nom:            text('nom').notNull(),
  poste:          text('poste').notNull(),
  departement:    text('departement').notNull(),
  typeContrat:    contratEnum('type_contrat').notNull(),
  dateEntree:     text('date_entree').notNull(),
  dateSortie:     text('date_sortie'),
  salaireBaseXaf: real('salaire_base_xaf').notNull(),
  telephone:      text('telephone'),
  email:          text('email'),
  cin:            text('cin'),
  cnps:           text('cnps'),
  statut:         employeStatutEnum('statut').notNull().default('actif'),
  userId:         uuid('user_id').references(() => profilesPg.id),
  createdBy:      uuid('created_by').references(() => profilesPg.id),
  createdAt:      ts('created_at'),
  updatedAt:      ts('updated_at'),
  syncStatus:     syncStatusEnum('sync_status').notNull().default('pending'),
})

export const presencesPg = pgTable('presences', {
  id:        id(),
  employeId: uuid('employe_id').notNull().references(() => employesPg.id),
  date:      text('date').notNull(),
  arrivee:   text('arrivee'),
  depart:    text('depart'),
  heures:    real('heures').notNull().default(0),
  statut:    presenceStatutEnum('statut').notNull(),
  notes:     text('notes'),
  createdBy: uuid('created_by').references(() => profilesPg.id),
  createdAt: ts('created_at'),
  syncStatus: syncStatusEnum('sync_status').notNull().default('pending'),
})

export const bulletinsPaiePg = pgTable('bulletins_paie', {
  id:             id(),
  employeId:      uuid('employe_id').notNull().references(() => employesPg.id),
  mois:           text('mois').notNull(),
  salaireBaseXaf: real('salaire_base_xaf').notNull(),
  heuresSupXaf:   real('heures_sup_xaf').notNull().default(0),
  primes:         real('primes_xaf').notNull().default(0),
  deductions:     real('deductions_xaf').notNull().default(0),
  cotisationCnps: real('cotisation_cnps_xaf').notNull().default(0),
  cnpsEmployeurXaf: real('cnps_employeur_xaf').notNull().default(0),
  irppXaf:        real('irpp_xaf').notNull().default(0),
  coutEmployeurXaf: real('cout_employeur_xaf').notNull().default(0),
  avanceDeduiteXaf: real('avance_deduite_xaf').notNull().default(0),
  retenueDeduiteXaf: real('retenue_deduite_xaf').notNull().default(0),
  netXaf:         real('net_xaf').notNull(),
  statut:         paieStatutEnum('statut').notNull().default('en_attente'),
  pdfUrl:         text('pdf_url'),
  pdfGeneratedAt: tsN('pdf_generated_at'),
  genereLe:       tsN('genere_le'),
  validatedBy:    uuid('validated_by').references(() => profilesPg.id),
  validatedAt:    tsN('validated_at'),
  paidBy:         uuid('paid_by').references(() => profilesPg.id),
  paidAt:         tsN('paid_at'),
  createdBy:      uuid('created_by').references(() => profilesPg.id),
  createdAt:      ts('created_at'),
  updatedAt:      ts('updated_at'),
  syncStatus:     syncStatusEnum('sync_status').notNull().default('pending'),
})

export const avancesSalairePg = pgTable('avances_salaire', {
  id:                 id(),
  employeId:          uuid('employe_id').notNull().references(() => employesPg.id),
  sortieId:           uuid('sortie_id').references(() => sortiesTresoreriePg.id),
  dateAvance:         text('date_avance').notNull(),
  moisDeduction:      text('mois_deduction').notNull(),
  montantXaf:         real('montant_xaf').notNull(),
  montantDeduitXaf:   real('montant_deduit_xaf').notNull().default(0),
  statut:             text('statut').notNull().default('payee'),
  modePaiement:       text('mode_paiement').notNull(),
  compteTresorerie:   text('compte_tresorerie').notNull(),
  referencePaiement:  text('reference_paiement'),
  motif:              text('motif'),
  notes:              text('notes'),
  createdBy:          uuid('created_by').references(() => profilesPg.id),
  createdAt:          ts('created_at'),
  updatedAt:          ts('updated_at'),
  syncStatus:         syncStatusEnum('sync_status').notNull().default('pending'),
})

export const retenuesSalairePg = pgTable('retenues_salaire', {
  id:               id(),
  employeId:        uuid('employe_id').notNull().references(() => employesPg.id),
  moisDeduction:    text('mois_deduction').notNull(),
  type:             text('type').notNull().default('autre'),
  libelle:          text('libelle').notNull(),
  montantXaf:       real('montant_xaf').notNull(),
  montantDeduitXaf: real('montant_deduit_xaf').notNull().default(0),
  statut:           text('statut').notNull().default('active'),
  notes:            text('notes'),
  createdBy:        uuid('created_by').references(() => profilesPg.id),
  createdAt:        ts('created_at'),
  updatedAt:        ts('updated_at'),
  syncStatus:       syncStatusEnum('sync_status').notNull().default('pending'),
})

export const cotisationsSocialesPg = pgTable('cotisations_sociales', {
  id:                       id(),
  mois:                     text('mois').notNull().unique(),
  nbBulletins:              integer('nb_bulletins').notNull().default(0),
  totalBrutXaf:             real('total_brut_xaf').notNull().default(0),
  cnpsSalarieXaf:           real('cnps_salarie_xaf').notNull().default(0),
  cnpsEmployeurXaf:         real('cnps_employeur_xaf').notNull().default(0),
  totalCnpsXaf:             real('total_cnps_xaf').notNull().default(0),
  irppXaf:                  real('irpp_xaf').notNull().default(0),
  totalAvancesDeduitesXaf:  real('total_avances_deduites_xaf').notNull().default(0),
  totalRetenuesDeduitesXaf: real('total_retenues_deduites_xaf').notNull().default(0),
  netAPayerXaf:             real('net_a_payer_xaf').notNull().default(0),
  coutTotalEmployeurXaf:    real('cout_total_employeur_xaf').notNull().default(0),
  statut:                   text('statut').notNull().default('calculee'),
  notes:                    text('notes'),
  createdBy:                uuid('created_by').references(() => profilesPg.id),
  validatedBy:              uuid('validated_by').references(() => profilesPg.id),
  validatedAt:              tsN('validated_at'),
  paidAt:                   tsN('paid_at'),
  createdAt:                ts('created_at'),
  updatedAt:                ts('updated_at'),
  syncStatus:               syncStatusEnum('sync_status').notNull().default('pending'),
})

export const paiePeriodesPg = pgTable('paie_periodes', {
  id:                       id(),
  mois:                     text('mois').notNull().unique(),
  sortieId:                 uuid('sortie_id').references(() => sortiesTresoreriePg.id),
  statut:                   text('statut').notNull().default('calculee'),
  nbBulletins:              integer('nb_bulletins').notNull().default(0),
  totalBrutXaf:             real('total_brut_xaf').notNull().default(0),
  cnpsSalarieXaf:           real('cnps_salarie_xaf').notNull().default(0),
  cnpsEmployeurXaf:         real('cnps_employeur_xaf').notNull().default(0),
  irppXaf:                  real('irpp_xaf').notNull().default(0),
  totalAvancesDeduitesXaf:  real('total_avances_deduites_xaf').notNull().default(0),
  totalRetenuesDeduitesXaf: real('total_retenues_deduites_xaf').notNull().default(0),
  totalAutresDeductionsXaf: real('total_autres_deductions_xaf').notNull().default(0),
  netAPayerXaf:             real('net_a_payer_xaf').notNull().default(0),
  coutTotalEmployeurXaf:    real('cout_total_employeur_xaf').notNull().default(0),
  modePaiement:             text('mode_paiement'),
  compteTresorerie:         text('compte_tresorerie'),
  referencePaiement:        text('reference_paiement'),
  notes:                    text('notes'),
  validatedBy:              uuid('validated_by').references(() => profilesPg.id),
  validatedAt:              tsN('validated_at'),
  paidBy:                   uuid('paid_by').references(() => profilesPg.id),
  paidAt:                   tsN('paid_at'),
  createdBy:                uuid('created_by').references(() => profilesPg.id),
  createdAt:                ts('created_at'),
  updatedAt:                ts('updated_at'),
  syncStatus:               syncStatusEnum('sync_status').notNull().default('pending'),
})

export const apprenantsPg = pgTable('apprenants', {
  id:         id(),
  nom:        text('nom').notNull(),
  specialite: text('specialite').notNull(),
  niveau:     integer('niveau').notNull().default(1),
  dureeMois:  integer('duree_mois').notNull().default(0),
  statut:     apprenantStatutEnum('statut').notNull().default('actif'),
  employeId:  uuid('employe_id').references(() => employesPg.id),
  notes:      text('notes'),
  createdBy:  uuid('created_by').references(() => profilesPg.id),
  createdAt:  ts('created_at'),
  updatedAt:  ts('updated_at'),
  syncStatus: syncStatusEnum('sync_status').notNull().default('pending'),
})

export const validationsNiveauPg = pgTable('validations_niveau', {
  id:             id(),
  apprenantId:    uuid('apprenant_id').notNull().references(() => apprenantsPg.id),
  niveau:         integer('niveau').notNull(),
  valideBy:       uuid('valide_by').references(() => profilesPg.id),
  dateValidation: text('date_validation').notNull(),
  commentaire:    text('commentaire'),
  createdAt:      ts('created_at'),
})

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION
// ══════════════════════════════════════════════════════════════════════════════

export const machinesPg = pgTable('machines', {
  id:                   id(),
  nom:                  text('nom').notNull(),
  type:                 text('type').notNull(),
  zone:                 text('zone').notNull(),
  numeroSerie:          text('numero_serie'),
  statut:               machineStatutEnum('statut').notNull().default('actif'),
  derniereMaintenance:  tsN('derniere_maintenance'),
  prochaineMaintenance: tsN('prochaine_maintenance'),
  createdAt:            ts('created_at'),
  updatedAt:            ts('updated_at'),
  syncStatus:           syncStatusEnum('sync_status').notNull().default('pending'),
})

export const jobsProductionPg = pgTable('jobs_production', {
  id:                 id(),
  numero:             text('numero').notNull().unique(),
  commandeId:         uuid('commande_id').references(() => commandesPg.id),
  produitDesignation: text('produit_designation').notNull(),
  machineId:          uuid('machine_id').references(() => machinesPg.id),
  machineNom:         text('machine_nom'),
  technicienId:       uuid('technicien_id').references(() => employesPg.id),
  technicienNom:      text('technicien_nom'),
  avancementPct:      integer('avancement_pct').notNull().default(0),
  statut:             commandeStatutEnum('statut').notNull().default('confirmed'),
  dateDebut:          tsN('date_debut'),
  dateFinPrevue:      tsN('date_fin_prevue'),
  dateFinReelle:      tsN('date_fin_reelle'),
  notes:              text('notes'),
  createdBy:          uuid('created_by').references(() => profilesPg.id),
  createdAt:          ts('created_at'),
  updatedAt:          ts('updated_at'),
  syncStatus:         syncStatusEnum('sync_status').notNull().default('pending'),
})

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

export const projetsPg = pgTable('projets', {
  id:             id(),
  nom:            text('nom').notNull(),
  description:    text('description'),
  clientId:       uuid('client_id').references(() => clientsPg.id),
  clientNom:      text('client_nom'),
  chefProjetId:   uuid('chef_projet_id').references(() => employesPg.id),
  chefProjetNom:  text('chef_projet_nom'),
  budgetXaf:      real('budget_xaf').notNull().default(0),
  depenseXaf:     real('depense_xaf').notNull().default(0),
  avancementPct:  integer('avancement_pct').notNull().default(0),
  statut:         projetStatutEnum('statut').notNull().default('planifie'),
  dateDebut:      tsN('date_debut'),
  deadline:       tsN('deadline'),
  createdBy:      uuid('created_by').references(() => profilesPg.id),
  createdAt:      ts('created_at'),
  updatedAt:      ts('updated_at'),
  syncStatus:     syncStatusEnum('sync_status').notNull().default('pending'),
})

export const tachesProjetPg = pgTable('taches_projet', {
  id:            id(),
  projetId:      uuid('projet_id').notNull().references(() => projetsPg.id),
  titre:         text('titre').notNull(),
  description:   text('description'),
  responsableId: uuid('responsable_id').references(() => employesPg.id),
  statut:        tacheStatutEnum('statut').notNull().default('todo'),
  priorite:      prioriteEnum('priorite').notNull().default('normale'),
  dateEcheance:  tsN('date_echeance'),
  createdAt:     ts('created_at'),
  updatedAt:     ts('updated_at'),
})

// ══════════════════════════════════════════════════════════════════════════════
// LOGISTIQUE
// ══════════════════════════════════════════════════════════════════════════════

export const livraisonsPg = pgTable('livraisons', {
  id:                   id(),
  numero:               text('numero').notNull().unique(),
  commandeId:           uuid('commande_id').references(() => commandesPg.id),
  clientId:             uuid('client_id').references(() => clientsPg.id),
  clientNom:            text('client_nom').notNull(),
  destination:          text('destination').notNull(),
  transporteur:         text('transporteur'),
  statut:               text('statut').notNull().default('planifiee'),
  dateDepart:           tsN('date_depart'),
  dateLivraisonPrevue:  tsN('date_livraison_prevue'),
  dateLivraisonReelle:  tsN('date_livraison_reelle'),
  notes:                text('notes'),
  createdBy:            uuid('created_by').references(() => profilesPg.id),
  createdAt:            ts('created_at'),
  updatedAt:            ts('updated_at'),
  syncStatus:           syncStatusEnum('sync_status').notNull().default('pending'),
})

export const livraisonsHistoriquePg = pgTable('livraisons_historique', {
  id:            id(),
  livraisonId:   uuid('livraison_id').notNull().references(() => livraisonsPg.id),
  ancienStatut:  text('ancien_statut'),
  nouveauStatut: text('nouveau_statut').notNull(),
  commentaire:   text('commentaire'),
  changedBy:     uuid('changed_by').references(() => profilesPg.id),
  changedAt:     ts('changed_at'),
})

// ══════════════════════════════════════════════════════════════════════════════
// MARKETING
// ══════════════════════════════════════════════════════════════════════════════

export const campagnesMarketingPg = pgTable('campagnes_marketing', {
  id:               id(),
  nom:              text('nom').notNull(),
  description:      text('description'),
  canal:            text('canal').notNull(),
  budgetXaf:        real('budget_xaf').notNull().default(0),
  reach:            integer('reach').notNull().default(0),
  leadsCount:       integer('leads_count').notNull().default(0),
  conversionsCount: integer('conversions_count').notNull().default(0),
  statut:           campagneStatutEnum('statut').notNull().default('planifie'),
  dateDebut:        text('date_debut').notNull(),
  dateFin:          text('date_fin').notNull(),
  createdBy:        uuid('created_by').references(() => profilesPg.id),
  createdAt:        ts('created_at'),
  updatedAt:        ts('updated_at'),
  syncStatus:       syncStatusEnum('sync_status').notNull().default('pending'),
})

// ══════════════════════════════════════════════════════════════════════════════
// SÉCURITÉ
// ══════════════════════════════════════════════════════════════════════════════

export const incidentsSecuritePg = pgTable('incidents_securite', {
  id:                  id(),
  type:                text('type').notNull(),
  description:         text('description').notNull(),
  zone:                text('zone').notNull(),
  signalePar:          text('signale_par').notNull(),
  statut:              incidentStatutEnum('statut').notNull().default('ouvert'),
  dateIncident:        text('date_incident').notNull(),
  dateResolution:      tsN('date_resolution'),
  actionsCorrectices:  text('actions_correctices'),
  createdBy:           uuid('created_by').references(() => profilesPg.id),
  createdAt:           ts('created_at'),
  updatedAt:           ts('updated_at'),
  syncStatus:          syncStatusEnum('sync_status').notNull().default('pending'),
})

export const epiItemsPg = pgTable('epi_items', {
  id:                   id(),
  designation:          text('designation').notNull(),
  total:                integer('total').notNull().default(0),
  conformes:            integer('conformes').notNull().default(0),
  derniereVerification: tsN('derniere_verification'),
  notes:                text('notes'),
  createdAt:            ts('created_at'),
  updatedAt:            ts('updated_at'),
})

// ══════════════════════════════════════════════════════════════════════════════
// ÉQUIPEMENTS
// ══════════════════════════════════════════════════════════════════════════════

export const equipementsPg = pgTable('equipements', {
  id:                     id(),
  code:                   text('code').notNull().unique(),
  designation:            text('designation').notNull(),
  categorie:              text('categorie').notNull().default('outillage'),
  statut:                 text('statut').notNull().default('disponible'),
  numeroSerie:            text('numero_serie'),
  fournisseur:            text('fournisseur'),
  marque:                 text('marque'),
  modele:                 text('modele'),
  dateAcquisition:        text('date_acquisition'),
  dateFinGarantie:        text('date_fin_garantie'),
  dateRemplacementPrevue: text('date_remplacement_prevue'),
  valeurAchatXaf:         real('valeur_achat_xaf').notNull().default(0),
  valeurResiduellexaf:    real('valeur_residuelle_xaf').notNull().default(0),
  criticite:              text('criticite').notNull().default('moyenne'),
  emplacement:            text('emplacement'),
  responsableId:          uuid('responsable_id').references(() => employesPg.id),
  prochaineRevision:      text('prochaine_revision'),
  intervalleRevisionJ:    integer('intervalle_revision_j').notNull().default(365),
  notes:                  text('notes'),
  createdBy:              uuid('created_by').references(() => profilesPg.id),
  createdAt:              ts('created_at'),
  updatedAt:              ts('updated_at'),
  syncStatus:             syncStatusEnum('sync_status').notNull().default('synced'),
})

export type EquipementPg       = typeof equipementsPg.$inferSelect
export type NouveauEquipementPg = typeof equipementsPg.$inferInsert

export const maintenancesEquipementPg = pgTable('maintenances_equipement', {
  id:              id(),
  equipementId:    uuid('equipement_id').notNull().references(() => equipementsPg.id),
  type:            text('type').notNull().default('preventive'),
  dateMaintenance: text('date_maintenance').notNull(),
  technicienId:    uuid('technicien_id').references(() => employesPg.id),
  coutXaf:         real('cout_xaf').notNull().default(0),
  description:     text('description'),
  prochaineDate:   text('prochaine_date'),
  statut:          text('statut').notNull().default('planifie'),
  chargeId:        uuid('charge_id').references(() => chargesPg.id),
  createdBy:       uuid('created_by').references(() => profilesPg.id),
  createdAt:       ts('created_at'),
  updatedAt:       ts('updated_at'),
  syncStatus:      syncStatusEnum('sync_status').notNull().default('synced'),
})

export type MaintenanceEquipementPg       = typeof maintenancesEquipementPg.$inferSelect
export type NouvelleMaintenanceEquipementPg = typeof maintenancesEquipementPg.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// IOT
// ══════════════════════════════════════════════════════════════════════════════

export const capteursIoTPg = pgTable('capteurs_iot', {
  id:              id(),
  nom:             text('nom').notNull().unique(),
  type:            text('type').notNull(),
  zone:            text('zone').notNull(),
  unite:           text('unite').notNull(),
  seuilAlerte:     real('seuil_alerte'),
  seuilCritique:   real('seuil_critique'),
  batteriePct:     integer('batterie_pct').notNull().default(100),
  statut:          capteurStatutEnum('statut').notNull().default('actif'),
  derniereSynchro: tsN('derniere_synchro'),
  firmware:        text('firmware'),
  createdAt:       ts('created_at'),
  updatedAt:       ts('updated_at'),
  syncStatus:      syncStatusEnum('sync_status').notNull().default('pending'),
})

export const mesuresIoTPg = pgTable('mesures_iot', {
  id:        id(),
  capteurId: uuid('capteur_id').notNull().references(() => capteursIoTPg.id),
  valeur:    real('valeur').notNull(),
  unite:     text('unite').notNull(),
  timestamp: ts('timestamp'),
  estAlerte: boolean('est_alerte').notNull().default(false),
})

export type MesureIoTPg = typeof mesuresIoTPg.$inferSelect
