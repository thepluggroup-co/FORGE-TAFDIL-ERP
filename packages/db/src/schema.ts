/**
 * FORGE ERP — Drizzle ORM Schema (SQLite / LibSQL / Turso)
 * Utilisé pour la base locale offline et Turso cloud.
 * Le schéma PostgreSQL miroir est dans schema.pg.ts.
 */
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { createId } from '@paralleldrive/cuid2'

const now = () => new Date().toISOString()

// ── Helpers ────────────────────────────────────────────────────────────────────

const id   = () => text('id').primaryKey().$defaultFn(() => createId())
const ts   = (col: string) => text(col).notNull().$defaultFn(now)
const tsUp = (col: string) => text(col).notNull().$defaultFn(now)
const sync = () => text('sync_status', { enum: ['synced', 'pending', 'conflict'] }).notNull().default('pending')

// ══════════════════════════════════════════════════════════════════════════════
// AUTH / PROFILS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Profils utilisateurs — étend auth.users de Supabase.
 * Le champ `id` correspond à l'UUID Supabase Auth.
 */
export const profiles = sqliteTable('profiles', {
  id:        text('id').primaryKey(), // Supabase Auth UUID
  email:     text('email').notNull().unique(),
  nom:       text('nom').notNull(),
  role:      text('role', { enum: ['directeur', 'admin', 'operateur', 'viewer'] }).notNull().default('operateur'),
  telephone: text('telephone'),
  avatarUrl: text('avatar_url'),
  actif:     integer('actif', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at'),
  updatedAt: tsUp('updated_at'),
})

export type Profile          = typeof profiles.$inferSelect
export type NouveauProfile   = typeof profiles.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════════════

export const clients = sqliteTable('clients', {
  id:               id(),
  nom:              text('nom').notNull(),
  type:             text('type', { enum: ['entreprise', 'particulier', 'institution'] }).notNull(),
  telephone:        text('telephone'),
  email:            text('email'),
  adresse:          text('adresse'),
  ville:            text('ville'),
  pays:             text('pays').notNull().default('Cameroun'),
  statut:           text('statut', { enum: ['actif', 'inactif', 'bloque'] }).notNull().default('actif'),
  scoreFiabilite:   integer('score_fiabilite').notNull().default(50),
  commandesCount:   integer('commandes_count').notNull().default(0),
  totalCaXaf:       real('total_ca_xaf').notNull().default(0),
  encoursCreditXaf: real('encours_credit_xaf').notNull().default(0),
  notes:            text('notes'),
  createdBy:        text('created_by').references(() => profiles.id),
  createdAt:        ts('created_at'),
  updatedAt:        tsUp('updated_at'),
  syncStatus:       sync(),
})

export type Client       = typeof clients.$inferSelect
export type NouveauClient = typeof clients.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// PRODUITS / STOCKS
// ══════════════════════════════════════════════════════════════════════════════

export const produits = sqliteTable('produits', {
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
  statut:         text('statut', { enum: ['normal', 'alerte', 'critique', 'rupture'] }).notNull().default('normal'),
  emplacement:    text('emplacement'),
  fournisseur:    text('fournisseur'),
  createdBy:      text('created_by').references(() => profiles.id),
  createdAt:      ts('created_at'),
  updatedAt:      tsUp('updated_at'),
  syncStatus:     sync(),
})

export type Produit       = typeof produits.$inferSelect
export type NouveauProduit = typeof produits.$inferInsert

export const mouvementsStock = sqliteTable('mouvements_stock', {
  id:         id(),
  produitId:  text('produit_id').notNull().references(() => produits.id),
  type:       text('type', { enum: ['entree', 'sortie', 'ajustement', 'transfert'] }).notNull(),
  quantite:   real('quantite').notNull(),
  reference:  text('reference'),
  notes:      text('notes'),
  createdBy:  text('created_by').references(() => profiles.id),
  createdAt:  ts('created_at'),
})

export type MouvementStock       = typeof mouvementsStock.$inferSelect
export type NouveauMouvementStock = typeof mouvementsStock.$inferInsert

export const bonsSortie = sqliteTable('bons_sortie', {
  id:          id(),
  numero:      text('numero').notNull().unique(),
  statut:      text('statut', { enum: ['en_attente', 'soumis', 'valide', 'execute', 'refuse'] }).notNull().default('soumis'),
  type:        text('type', { enum: ['commande', 'devis', 'manuel'] }).notNull().default('manuel'),
  // FK nullable vers commandes/devis — définie sans .references() (forward ref SQLite)
  commandeId:  text('commande_id'),
  devisId:     text('devis_id'),
  demandeur:   text('demandeur').notNull(),
  valideParId: text('valide_par_id').references(() => profiles.id),
  motif:       text('motif').notNull(),
  notes:       text('notes'),
  createdBy:   text('created_by').references(() => profiles.id),
  createdAt:   ts('created_at'),
  updatedAt:   tsUp('updated_at'),
  syncStatus:  sync(),
})

export type BonSortie       = typeof bonsSortie.$inferSelect
export type NouveauBonSortie = typeof bonsSortie.$inferInsert

export const bonsSortieLignes = sqliteTable('bons_sortie_lignes', {
  id:               id(),
  bonId:            text('bon_id').notNull().references(() => bonsSortie.id),
  produitId:        text('produit_id').references(() => produits.id),
  designation:      text('designation').notNull(),
  unite:            text('unite').notNull().default('unité'),
  quantiteDemandee: real('quantite_demandee').notNull(),
  quantiteServie:   real('quantite_servie').notNull().default(0),
})

export type BonSortieLigne       = typeof bonsSortieLignes.$inferSelect
export type NouveauBonSortieLigne = typeof bonsSortieLignes.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// COMMERCIAL — DEVIS
// ══════════════════════════════════════════════════════════════════════════════

export const devis = sqliteTable('devis', {
  id:                  id(),
  numero:              text('numero').notNull().unique(),
  clientId:            text('client_id').references(() => clients.id),
  clientNom:           text('client_nom').notNull(),
  statut:              text('statut', { enum: ['brouillon', 'envoye', 'accepte', 'refuse', 'expire', 'transforme'] }).notNull().default('brouillon'),
  dateEmission:        text('date_emission').notNull(),
  dateValidite:        text('date_validite').notNull(),
  validitJours:        integer('validite_jours').notNull().default(30),
  acomptePct:          real('acompte_pct').notNull().default(0),
  conditionsPaiement:  text('conditions_paiement').notNull().default('Virement bancaire'),
  totalHtXaf:          real('total_ht_xaf').notNull().default(0),
  tvaXaf:              real('tva_xaf').notNull().default(0),
  fraisLivraisonXaf:   real('frais_livraison_xaf').notNull().default(0),
  totalTtcXaf:         real('total_ttc_xaf').notNull().default(0),
  notes:               text('notes'),
  createdBy:           text('created_by').references(() => profiles.id),
  createdAt:           ts('created_at'),
  updatedAt:           tsUp('updated_at'),
  syncStatus:          sync(),
})

export type Devis       = typeof devis.$inferSelect
export type NouveauDevis = typeof devis.$inferInsert

export const devisLignes = sqliteTable('devis_lignes', {
  id:             id(),
  devisId:        text('devis_id').notNull().references(() => devis.id),
  designation:    text('designation').notNull(),
  description:    text('description'),
  categorie:      text('categorie', { enum: ['materiaux', 'main_oeuvre', 'equipement', 'autre'] }).notNull().default('materiaux'),
  unite:          text('unite').notNull().default('unité'),
  quantite:       real('quantite').notNull(),
  prixUnitaireHtXaf: real('prix_unitaire_ht_xaf').notNull(),
  totalHtXaf:     real('total_ht_xaf').notNull(),
  ordre:          integer('ordre').notNull().default(0),
})

export type DevisLigne       = typeof devisLignes.$inferSelect
export type NouveauDevisLigne = typeof devisLignes.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// COMMERCIAL — CONDITIONS DE PAIEMENT
// ══════════════════════════════════════════════════════════════════════════════

export const conditionsPaiement = sqliteTable('conditions_paiement', {
  id:               id(),
  code:             text('code').notNull().unique(),
  libelle:          text('libelle').notNull(),
  acomptePct:       integer('acompte_pct').notNull().default(0),
  delaiSoldeJours:  integer('delai_solde_jours').notNull().default(0),
  actif:            integer('actif', { mode: 'boolean' }).notNull().default(true),
})

export type ConditionPaiement       = typeof conditionsPaiement.$inferSelect
export type NouvelleConditionPaiement = typeof conditionsPaiement.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// COMMERCIAL — COMMANDES
// ══════════════════════════════════════════════════════════════════════════════

export const commandes = sqliteTable('commandes', {
  id:                  id(),
  numero:              text('numero').notNull().unique(),
  clientId:            text('client_id').references(() => clients.id),
  clientNom:           text('client_nom').notNull(),
  devisId:             text('devis_id').references(() => devis.id),
  statut:              text('statut', { enum: ['confirmed', 'in_production', 'pret', 'delivered', 'cancelled'] }).notNull().default('confirmed'),
  dateCommande:        text('date_commande').notNull(),
  dateLivraisonPrevue: text('date_livraison_prevue'),
  totalHtXaf:          real('total_ht_xaf').notNull().default(0),
  tvaXaf:              real('tva_xaf').notNull().default(0),
  totalTtcXaf:         real('total_ttc_xaf').notNull().default(0),
  acompteRecu:            real('acompte_recu_xaf').notNull().default(0),
  conditionPaiementId:    text('condition_paiement_id').references(() => conditionsPaiement.id),
  montantAcompte:         real('montant_acompte').notNull().default(0),
  dateEcheanceSolde:      text('date_echeance_solde'),
  statutPaiement:         text('statut_paiement', {
    enum: ['non_paye', 'acompte_recu', 'solde_recu', 'solde_en_retard'],
  }).notNull().default('non_paye'),
  notes:               text('notes'),
  createdBy:           text('created_by').references(() => profiles.id),
  createdAt:           ts('created_at'),
  updatedAt:           tsUp('updated_at'),
  syncStatus:          sync(),
})

export type Commande       = typeof commandes.$inferSelect
export type NouvelleCommande = typeof commandes.$inferInsert

export const commandesLignes = sqliteTable('commandes_lignes', {
  id:               id(),
  commandeId:       text('commande_id').notNull().references(() => commandes.id),
  produitId:        text('produit_id').references(() => produits.id),
  designation:      text('designation').notNull(),
  unite:            text('unite').notNull().default('unité'),
  quantite:         real('quantite').notNull(),
  prixUnitaireHtXaf: real('prix_unitaire_ht_xaf').notNull(),
  totalHtXaf:       real('total_ht_xaf').notNull(),
  ordre:            integer('ordre').notNull().default(0),
})

export type CommandeLigne       = typeof commandesLignes.$inferSelect
export type NouvelleCommandeLigne = typeof commandesLignes.$inferInsert

export const historiqueCommandes = sqliteTable('historique_commandes', {
  id:          id(),
  commandeId:  text('commande_id').notNull().references(() => commandes.id),
  ancienStatut: text('ancien_statut'),
  nouveauStatut: text('nouveau_statut').notNull(),
  commentaire: text('commentaire'),
  changedBy:   text('changed_by').references(() => profiles.id),
  changedAt:   ts('changed_at'),
})

export type HistoriqueCommande       = typeof historiqueCommandes.$inferSelect
export type NouvelHistoriqueCommande = typeof historiqueCommandes.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// FINANCE — FACTURES
// ══════════════════════════════════════════════════════════════════════════════

export const factures = sqliteTable('factures', {
  id:            id(),
  numero:        text('numero').notNull().unique(),
  commandeId:    text('commande_id').references(() => commandes.id),
  clientId:      text('client_id').references(() => clients.id),
  clientNom:     text('client_nom').notNull(),
  statut:        text('statut', { enum: ['brouillon', 'valide', 'envoye', 'paye', 'annule'] }).notNull().default('brouillon'),
  dateEmission:  text('date_emission').notNull(),
  dateEcheance:  text('date_echeance').notNull(),
  totalHtXaf:    real('total_ht_xaf').notNull().default(0),
  tvaXaf:        real('tva_xaf').notNull().default(0),
  fraisLivraisonXaf: real('frais_livraison_xaf').notNull().default(0),
  totalTtcXaf:   real('total_ttc_xaf').notNull().default(0),
  montantPayeXaf: real('montant_paye_xaf').notNull().default(0),
  notes:         text('notes'),
  createdBy:     text('created_by').references(() => profiles.id),
  createdAt:     ts('created_at'),
  updatedAt:     tsUp('updated_at'),
  syncStatus:    sync(),
})

export type Facture       = typeof factures.$inferSelect
export type NouvelleFacture = typeof factures.$inferInsert

export const facturesLignes = sqliteTable('factures_lignes', {
  id:               id(),
  factureId:        text('facture_id').notNull().references(() => factures.id),
  designation:      text('designation').notNull(),
  unite:            text('unite').notNull().default('unité'),
  quantite:         real('quantite').notNull(),
  prixUnitaireHtXaf: real('prix_unitaire_ht_xaf').notNull(),
  totalHtXaf:       real('total_ht_xaf').notNull(),
  ordre:            integer('ordre').notNull().default(0),
})

export type FactureLigne       = typeof facturesLignes.$inferSelect
export type NouvelleFactureLigne = typeof facturesLignes.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// FINANCE — CRÉDITS
// ══════════════════════════════════════════════════════════════════════════════

export const credits = sqliteTable('credits', {
  id:              id(),
  numero:          text('numero').notNull().unique(),
  clientId:        text('client_id').references(() => clients.id),
  clientNom:       text('client_nom').notNull(),
  commandeId:      text('commande_id').references(() => commandes.id),
  montantXaf:      real('montant_xaf').notNull(),
  soldeRestantXaf: real('solde_restant_xaf').notNull(),
  dateDebut:       text('date_debut').notNull(),
  echeance:        text('echeance').notNull(),
  statut:          text('statut', { enum: ['en_cours', 'echu', 'rembourse'] }).notNull().default('en_cours'),
  notes:           text('notes'),
  createdBy:       text('created_by').references(() => profiles.id),
  createdAt:       ts('created_at'),
  updatedAt:       tsUp('updated_at'),
  syncStatus:      sync(),
})

export type Credit       = typeof credits.$inferSelect
export type NouveauCredit = typeof credits.$inferInsert

export const remboursementsCredit = sqliteTable('remboursements_credit', {
  id:          id(),
  creditId:    text('credit_id').notNull().references(() => credits.id),
  montantXaf:  real('montant_xaf').notNull(),
  datePaiement: text('date_paiement').notNull(),
  type:        text('type', { enum: ['total', 'partiel'] }).notNull(),
  notes:       text('notes'),
  createdBy:   text('created_by').references(() => profiles.id),
  createdAt:   ts('created_at'),
})

export type RemboursementCredit       = typeof remboursementsCredit.$inferSelect
export type NouveauRemboursementCredit = typeof remboursementsCredit.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// FINANCE — COMPTABILITÉ SYSCOHADA
// ══════════════════════════════════════════════════════════════════════════════

export const ecrituresComptables = sqliteTable('ecritures_comptables', {
  id:              id(),
  date:            text('date').notNull(),
  libelle:         text('libelle').notNull(),
  compteSysco:     text('compte_syscohada').notNull(),
  compteLabel:     text('compte_label').notNull(),
  debitXaf:        real('debit_xaf').notNull().default(0),
  creditXaf:       real('credit_xaf').notNull().default(0),
  referenceDoc:    text('reference_doc'),
  factureId:       text('facture_id').references(() => factures.id),
  commandeId:      text('commande_id').references(() => commandes.id),
  createdBy:       text('created_by').references(() => profiles.id),
  createdAt:       ts('created_at'),
  syncStatus:      sync(),
})

export type EcritureComptable       = typeof ecrituresComptables.$inferSelect
export type NouvelleEcritureComptable = typeof ecrituresComptables.$inferInsert

export const declarationsFiscales = sqliteTable('declarations_fiscales', {
  id:          id(),
  type:        text('type').notNull(),
  periode:     text('periode').notNull(),
  statut:      text('statut', { enum: ['a_declarer', 'soumis', 'valide'] }).notNull().default('a_declarer'),
  montantXaf:  real('montant_xaf').notNull().default(0),
  echeance:    text('echeance').notNull(),
  soumisLe:    text('soumis_le'),
  valideBy:    text('valide_by').references(() => profiles.id),
  notes:       text('notes'),
  createdAt:   ts('created_at'),
  updatedAt:   tsUp('updated_at'),
  syncStatus:  sync(),
})

export type DeclarationFiscale       = typeof declarationsFiscales.$inferSelect
export type NouvelleDeclarationFiscale = typeof declarationsFiscales.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// RH — EMPLOYÉS
// ══════════════════════════════════════════════════════════════════════════════

export const employes = sqliteTable('employes', {
  id:              id(),
  nom:             text('nom').notNull(),
  poste:           text('poste').notNull(),
  departement:     text('departement').notNull(),
  typeContrat:     text('type_contrat', { enum: ['CDI', 'CDD', 'stage', 'freelance'] }).notNull(),
  dateEntree:      text('date_entree').notNull(),
  dateSortie:      text('date_sortie'),
  salaireBaseXaf:  real('salaire_base_xaf').notNull(),
  telephone:       text('telephone'),
  email:           text('email'),
  cin:             text('cin'),
  cnps:            text('cnps'),
  statut:          text('statut', { enum: ['actif', 'inactif', 'conge', 'essai'] }).notNull().default('actif'),
  userId:          text('user_id').references(() => profiles.id),
  createdBy:       text('created_by').references(() => profiles.id),
  createdAt:       ts('created_at'),
  updatedAt:       tsUp('updated_at'),
  syncStatus:      sync(),
})

export type Employe       = typeof employes.$inferSelect
export type NouvelEmploye = typeof employes.$inferInsert

export const presences = sqliteTable('presences', {
  id:        id(),
  employeId: text('employe_id').notNull().references(() => employes.id),
  date:      text('date').notNull(),
  arrivee:   text('arrivee'),
  depart:    text('depart'),
  heures:    real('heures').notNull().default(0),
  statut:    text('statut', { enum: ['present', 'absent', 'conge', 'retard', 'maladie'] }).notNull(),
  notes:     text('notes'),
  createdBy: text('created_by').references(() => profiles.id),
  createdAt: ts('created_at'),
  syncStatus: sync(),
})

export type Presence       = typeof presences.$inferSelect
export type NouvellePresence = typeof presences.$inferInsert

export const bulletinsPaie = sqliteTable('bulletins_paie', {
  id:            id(),
  employeId:     text('employe_id').notNull().references(() => employes.id),
  mois:          text('mois').notNull(),
  salaireBaseXaf: real('salaire_base_xaf').notNull(),
  heuresSupXaf:  real('heures_sup_xaf').notNull().default(0),
  primes:        real('primes_xaf').notNull().default(0),
  deductions:    real('deductions_xaf').notNull().default(0),
  cotisationCnps: real('cotisation_cnps_xaf').notNull().default(0),
  netXaf:        real('net_xaf').notNull(),
  statut:        text('statut', { enum: ['en_attente', 'valide', 'vire'] }).notNull().default('en_attente'),
  genereLe:      text('genere_le'),
  createdBy:     text('created_by').references(() => profiles.id),
  createdAt:     ts('created_at'),
  updatedAt:     tsUp('updated_at'),
  syncStatus:    sync(),
})

export type BulletinPaie       = typeof bulletinsPaie.$inferSelect
export type NouveauBulletinPaie = typeof bulletinsPaie.$inferInsert

export const apprenants = sqliteTable('apprenants', {
  id:          id(),
  nom:         text('nom').notNull(),
  specialite:  text('specialite').notNull(),
  niveau:      integer('niveau').notNull().default(1),
  dureeMois:   integer('duree_mois').notNull().default(0),
  statut:      text('statut', { enum: ['actif', 'suspendu', 'diplome', 'recrute'] }).notNull().default('actif'),
  employeId:   text('employe_id').references(() => employes.id),
  notes:       text('notes'),
  createdBy:   text('created_by').references(() => profiles.id),
  createdAt:   ts('created_at'),
  updatedAt:   tsUp('updated_at'),
  syncStatus:  sync(),
})

export type Apprenant       = typeof apprenants.$inferSelect
export type NouvelApprenant = typeof apprenants.$inferInsert

export const validationsNiveau = sqliteTable('validations_niveau', {
  id:          id(),
  apprenantId: text('apprenant_id').notNull().references(() => apprenants.id),
  niveau:      integer('niveau').notNull(),
  valideBy:    text('valide_by').references(() => profiles.id),
  dateValidation: text('date_validation').notNull(),
  commentaire: text('commentaire'),
  createdAt:   ts('created_at'),
})

export type ValidationNiveau       = typeof validationsNiveau.$inferSelect
export type NouvelleValidationNiveau = typeof validationsNiveau.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION
// ══════════════════════════════════════════════════════════════════════════════

export const machines = sqliteTable('machines', {
  id:                  id(),
  nom:                 text('nom').notNull(),
  type:                text('type').notNull(),
  zone:                text('zone').notNull(),
  numeroSerie:         text('numero_serie'),
  statut:              text('statut', { enum: ['actif', 'maintenance', 'panne', 'reserve'] }).notNull().default('actif'),
  derniereMaintenance: text('derniere_maintenance'),
  prochaineMaintenance: text('prochaine_maintenance'),
  createdAt:           ts('created_at'),
  updatedAt:           tsUp('updated_at'),
  syncStatus:          sync(),
})

export type Machine       = typeof machines.$inferSelect
export type NouvelleMachine = typeof machines.$inferInsert

export const jobsProduction = sqliteTable('jobs_production', {
  id:               id(),
  numero:           text('numero').notNull().unique(),
  commandeId:       text('commande_id').references(() => commandes.id),
  produitDesignation: text('produit_designation').notNull(),
  machineId:        text('machine_id').references(() => machines.id),
  machineNom:       text('machine_nom'),
  technicienId:     text('technicien_id').references(() => employes.id),
  technicienNom:    text('technicien_nom'),
  avancementPct:    integer('avancement_pct').notNull().default(0),
  statut:           text('statut', { enum: ['confirmed', 'in_production', 'pret', 'delivered', 'cancelled'] }).notNull().default('confirmed'),
  dateDebut:        text('date_debut'),
  dateFinPrevue:    text('date_fin_prevue'),
  dateFinReelle:    text('date_fin_reelle'),
  notes:            text('notes'),
  createdBy:        text('created_by').references(() => profiles.id),
  createdAt:        ts('created_at'),
  updatedAt:        tsUp('updated_at'),
  syncStatus:       sync(),
})

export type JobProduction       = typeof jobsProduction.$inferSelect
export type NouveauJobProduction = typeof jobsProduction.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

export const projets = sqliteTable('projets', {
  id:             id(),
  nom:            text('nom').notNull(),
  description:    text('description'),
  clientId:       text('client_id').references(() => clients.id),
  clientNom:      text('client_nom'),
  chefProjetId:   text('chef_projet_id').references(() => employes.id),
  chefProjetNom:  text('chef_projet_nom'),
  budgetXaf:      real('budget_xaf').notNull().default(0),
  depenseXaf:     real('depense_xaf').notNull().default(0),
  avancementPct:  integer('avancement_pct').notNull().default(0),
  statut:         text('statut', { enum: ['planifie', 'en_cours', 'suspendu', 'livre', 'annule'] }).notNull().default('planifie'),
  dateDebut:      text('date_debut'),
  deadline:       text('deadline'),
  createdBy:      text('created_by').references(() => profiles.id),
  createdAt:      ts('created_at'),
  updatedAt:      tsUp('updated_at'),
  syncStatus:     sync(),
})

export type Projet       = typeof projets.$inferSelect
export type NouveauProjet = typeof projets.$inferInsert

export const tachesProjet = sqliteTable('taches_projet', {
  id:            id(),
  projetId:      text('projet_id').notNull().references(() => projets.id),
  titre:         text('titre').notNull(),
  description:   text('description'),
  responsableId: text('responsable_id').references(() => employes.id),
  statut:        text('statut', { enum: ['todo', 'en_cours', 'done', 'bloque'] }).notNull().default('todo'),
  priorite:      text('priorite', { enum: ['basse', 'normale', 'haute', 'critique'] }).notNull().default('normale'),
  dateEcheance:  text('date_echeance'),
  createdAt:     ts('created_at'),
  updatedAt:     tsUp('updated_at'),
})

export type TacheProjet       = typeof tachesProjet.$inferSelect
export type NouvelleTacheProjet = typeof tachesProjet.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// LOGISTIQUE
// ══════════════════════════════════════════════════════════════════════════════

export const livraisons = sqliteTable('livraisons', {
  id:                    id(),
  numero:                text('numero').notNull().unique(),
  commandeId:            text('commande_id').references(() => commandes.id),
  clientId:              text('client_id').references(() => clients.id),
  clientNom:             text('client_nom').notNull(),
  destination:           text('destination').notNull(),
  transporteur:          text('transporteur'),
  statut:                text('statut', { enum: ['confirmed', 'in_production', 'pret', 'delivered', 'cancelled'] }).notNull().default('confirmed'),
  dateDepart:            text('date_depart'),
  dateLivraisonPrevue:   text('date_livraison_prevue'),
  dateLivraisonReelle:   text('date_livraison_reelle'),
  notes:                 text('notes'),
  createdBy:             text('created_by').references(() => profiles.id),
  createdAt:             ts('created_at'),
  updatedAt:             tsUp('updated_at'),
  syncStatus:            sync(),
})

export type Livraison       = typeof livraisons.$inferSelect
export type NouvelleLivraison = typeof livraisons.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// MARKETING
// ══════════════════════════════════════════════════════════════════════════════

export const campagnesMarketing = sqliteTable('campagnes_marketing', {
  id:               id(),
  nom:              text('nom').notNull(),
  description:      text('description'),
  canal:            text('canal').notNull(),
  budgetXaf:        real('budget_xaf').notNull().default(0),
  reach:            integer('reach').notNull().default(0),
  leadsCount:       integer('leads_count').notNull().default(0),
  conversionsCount: integer('conversions_count').notNull().default(0),
  statut:           text('statut', { enum: ['planifie', 'active', 'pause', 'termine', 'annule'] }).notNull().default('planifie'),
  dateDebut:        text('date_debut').notNull(),
  dateFin:          text('date_fin').notNull(),
  createdBy:        text('created_by').references(() => profiles.id),
  createdAt:        ts('created_at'),
  updatedAt:        tsUp('updated_at'),
  syncStatus:       sync(),
})

export type CampagneMarketing       = typeof campagnesMarketing.$inferSelect
export type NouvelleCampagneMarketing = typeof campagnesMarketing.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// SÉCURITÉ
// ══════════════════════════════════════════════════════════════════════════════

export const incidentsSecurite = sqliteTable('incidents_securite', {
  id:          id(),
  type:        text('type').notNull(),
  description: text('description').notNull(),
  zone:        text('zone').notNull(),
  signalePar:  text('signale_par').notNull(),
  statut:      text('statut', { enum: ['ouvert', 'traite', 'corrige', 'resolu'] }).notNull().default('ouvert'),
  dateIncident: text('date_incident').notNull(),
  dateResolution: text('date_resolution'),
  actionsCorrectices: text('actions_correctices'),
  createdBy:   text('created_by').references(() => profiles.id),
  createdAt:   ts('created_at'),
  updatedAt:   tsUp('updated_at'),
  syncStatus:  sync(),
})

export type IncidentSecurite       = typeof incidentsSecurite.$inferSelect
export type NouvelIncidentSecurite = typeof incidentsSecurite.$inferInsert

export const epiItems = sqliteTable('epi_items', {
  id:                   id(),
  designation:          text('designation').notNull(),
  total:                integer('total').notNull().default(0),
  conformes:            integer('conformes').notNull().default(0),
  derniereVerification: text('derniere_verification'),
  notes:                text('notes'),
  createdAt:            ts('created_at'),
  updatedAt:            tsUp('updated_at'),
})

export type EpiItem       = typeof epiItems.$inferSelect
export type NouvelEpiItem = typeof epiItems.$inferInsert

// ══════════════════════════════════════════════════════════════════════════════
// IOT
// ══════════════════════════════════════════════════════════════════════════════

export const capteursIoT = sqliteTable('capteurs_iot', {
  id:              id(),
  nom:             text('nom').notNull().unique(),
  type:            text('type').notNull(),
  zone:            text('zone').notNull(),
  unite:           text('unite').notNull(),
  seuilAlerte:     real('seuil_alerte'),
  seuilCritique:   real('seuil_critique'),
  batteriePct:     integer('batterie_pct').notNull().default(100),
  statut:          text('statut', { enum: ['actif', 'alerte', 'hors_ligne', 'maintenance'] }).notNull().default('actif'),
  derniereSynchro: text('derniere_synchro'),
  firmware:        text('firmware'),
  createdAt:       ts('created_at'),
  updatedAt:       tsUp('updated_at'),
  syncStatus:      sync(),
})

export type CapteurIoT       = typeof capteursIoT.$inferSelect
export type NouveauCapteurIoT = typeof capteursIoT.$inferInsert

export const mesuresIoT = sqliteTable('mesures_iot', {
  id:         id(),
  capteurId:  text('capteur_id').notNull().references(() => capteursIoT.id),
  valeur:     real('valeur').notNull(),
  unite:      text('unite').notNull(),
  timestamp:  text('timestamp').notNull().$defaultFn(now),
  estAlerte:  integer('est_alerte', { mode: 'boolean' }).notNull().default(false),
})

export type MesureIoT       = typeof mesuresIoT.$inferSelect
export type NouvelleMesureIoT = typeof mesuresIoT.$inferInsert
