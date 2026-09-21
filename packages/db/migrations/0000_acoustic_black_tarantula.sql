CREATE TABLE `apprenants` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`specialite` text NOT NULL,
	`niveau` integer DEFAULT 1 NOT NULL,
	`duree_mois` integer DEFAULT 0 NOT NULL,
	`statut` text DEFAULT 'actif' NOT NULL,
	`employe_id` text,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`employe_id`) REFERENCES `employes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bons_sortie` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`statut` text DEFAULT 'soumis' NOT NULL,
	`demandeur` text NOT NULL,
	`valide_par_id` text,
	`motif` text NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`valide_par_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bons_sortie_lignes` (
	`id` text PRIMARY KEY NOT NULL,
	`bon_id` text NOT NULL,
	`produit_id` text,
	`designation` text NOT NULL,
	`unite` text DEFAULT 'unité' NOT NULL,
	`quantite_demandee` real NOT NULL,
	`quantite_servie` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bon_id`) REFERENCES `bons_sortie`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`produit_id`) REFERENCES `produits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bulletins_paie` (
	`id` text PRIMARY KEY NOT NULL,
	`employe_id` text NOT NULL,
	`mois` text NOT NULL,
	`salaire_base_xaf` real NOT NULL,
	`heures_sup_xaf` real DEFAULT 0 NOT NULL,
	`primes_xaf` real DEFAULT 0 NOT NULL,
	`deductions_xaf` real DEFAULT 0 NOT NULL,
	`cotisation_cnps_xaf` real DEFAULT 0 NOT NULL,
	`net_xaf` real NOT NULL,
	`statut` text DEFAULT 'en_attente' NOT NULL,
	`genere_le` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`employe_id`) REFERENCES `employes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campagnes_marketing` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`description` text,
	`canal` text NOT NULL,
	`budget_xaf` real DEFAULT 0 NOT NULL,
	`reach` integer DEFAULT 0 NOT NULL,
	`leads_count` integer DEFAULT 0 NOT NULL,
	`conversions_count` integer DEFAULT 0 NOT NULL,
	`statut` text DEFAULT 'planifie' NOT NULL,
	`date_debut` text NOT NULL,
	`date_fin` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `capteurs_iot` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`type` text NOT NULL,
	`zone` text NOT NULL,
	`unite` text NOT NULL,
	`seuil_alerte` real,
	`seuil_critique` real,
	`batterie_pct` integer DEFAULT 100 NOT NULL,
	`statut` text DEFAULT 'actif' NOT NULL,
	`derniere_synchro` text,
	`firmware` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`type` text NOT NULL,
	`telephone` text,
	`email` text,
	`adresse` text,
	`ville` text,
	`pays` text DEFAULT 'Cameroun' NOT NULL,
	`statut` text DEFAULT 'actif' NOT NULL,
	`score_fiabilite` integer DEFAULT 50 NOT NULL,
	`commandes_count` integer DEFAULT 0 NOT NULL,
	`total_ca_xaf` real DEFAULT 0 NOT NULL,
	`encours_credit_xaf` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `commandes` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`client_id` text,
	`client_nom` text NOT NULL,
	`devis_id` text,
	`statut` text DEFAULT 'confirmed' NOT NULL,
	`date_commande` text NOT NULL,
	`date_livraison_prevue` text,
	`total_ht_xaf` real DEFAULT 0 NOT NULL,
	`tva_xaf` real DEFAULT 0 NOT NULL,
	`total_ttc_xaf` real DEFAULT 0 NOT NULL,
	`acompte_recu_xaf` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`devis_id`) REFERENCES `devis`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `commandes_lignes` (
	`id` text PRIMARY KEY NOT NULL,
	`commande_id` text NOT NULL,
	`produit_id` text,
	`designation` text NOT NULL,
	`unite` text DEFAULT 'unité' NOT NULL,
	`quantite` real NOT NULL,
	`prix_unitaire_ht_xaf` real NOT NULL,
	`total_ht_xaf` real NOT NULL,
	`ordre` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`commande_id`) REFERENCES `commandes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`produit_id`) REFERENCES `produits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `credits` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`client_id` text,
	`client_nom` text NOT NULL,
	`commande_id` text,
	`montant_xaf` real NOT NULL,
	`solde_restant_xaf` real NOT NULL,
	`date_debut` text NOT NULL,
	`echeance` text NOT NULL,
	`statut` text DEFAULT 'en_cours' NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commande_id`) REFERENCES `commandes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `declarations_fiscales` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`periode` text NOT NULL,
	`statut` text DEFAULT 'a_declarer' NOT NULL,
	`montant_xaf` real DEFAULT 0 NOT NULL,
	`echeance` text NOT NULL,
	`soumis_le` text,
	`valide_by` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`valide_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devis` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`client_id` text,
	`client_nom` text NOT NULL,
	`statut` text DEFAULT 'brouillon' NOT NULL,
	`date_emission` text NOT NULL,
	`date_validite` text NOT NULL,
	`validite_jours` integer DEFAULT 30 NOT NULL,
	`acompte_pct` real DEFAULT 0 NOT NULL,
	`conditions_paiement` text DEFAULT 'Virement bancaire' NOT NULL,
	`total_ht_xaf` real DEFAULT 0 NOT NULL,
	`tva_xaf` real DEFAULT 0 NOT NULL,
	`total_ttc_xaf` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devis_lignes` (
	`id` text PRIMARY KEY NOT NULL,
	`devis_id` text NOT NULL,
	`designation` text NOT NULL,
	`description` text,
	`categorie` text DEFAULT 'materiaux' NOT NULL,
	`unite` text DEFAULT 'unité' NOT NULL,
	`quantite` real NOT NULL,
	`prix_unitaire_ht_xaf` real NOT NULL,
	`total_ht_xaf` real NOT NULL,
	`ordre` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`devis_id`) REFERENCES `devis`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ecritures_comptables` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`libelle` text NOT NULL,
	`compte_syscohada` text NOT NULL,
	`compte_label` text NOT NULL,
	`debit_xaf` real DEFAULT 0 NOT NULL,
	`credit_xaf` real DEFAULT 0 NOT NULL,
	`reference_doc` text,
	`facture_id` text,
	`commande_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`facture_id`) REFERENCES `factures`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commande_id`) REFERENCES `commandes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employes` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`poste` text NOT NULL,
	`departement` text NOT NULL,
	`type_contrat` text NOT NULL,
	`date_entree` text NOT NULL,
	`date_sortie` text,
	`salaire_base_xaf` real NOT NULL,
	`telephone` text,
	`email` text,
	`cin` text,
	`cnps` text,
	`statut` text DEFAULT 'actif' NOT NULL,
	`user_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `epi_items` (
	`id` text PRIMARY KEY NOT NULL,
	`designation` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`conformes` integer DEFAULT 0 NOT NULL,
	`derniere_verification` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `factures` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`commande_id` text,
	`client_id` text,
	`client_nom` text NOT NULL,
	`statut` text DEFAULT 'brouillon' NOT NULL,
	`date_emission` text NOT NULL,
	`date_echeance` text NOT NULL,
	`total_ht_xaf` real DEFAULT 0 NOT NULL,
	`tva_xaf` real DEFAULT 0 NOT NULL,
	`total_ttc_xaf` real DEFAULT 0 NOT NULL,
	`montant_paye_xaf` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`commande_id`) REFERENCES `commandes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `factures_lignes` (
	`id` text PRIMARY KEY NOT NULL,
	`facture_id` text NOT NULL,
	`designation` text NOT NULL,
	`unite` text DEFAULT 'unité' NOT NULL,
	`quantite` real NOT NULL,
	`prix_unitaire_ht_xaf` real NOT NULL,
	`total_ht_xaf` real NOT NULL,
	`ordre` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facture_id`) REFERENCES `factures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `historique_commandes` (
	`id` text PRIMARY KEY NOT NULL,
	`commande_id` text NOT NULL,
	`ancien_statut` text,
	`nouveau_statut` text NOT NULL,
	`commentaire` text,
	`changed_by` text,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`commande_id`) REFERENCES `commandes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `incidents_securite` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`zone` text NOT NULL,
	`signale_par` text NOT NULL,
	`statut` text DEFAULT 'ouvert' NOT NULL,
	`date_incident` text NOT NULL,
	`date_resolution` text,
	`actions_correctices` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs_production` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`commande_id` text,
	`produit_designation` text NOT NULL,
	`machine_id` text,
	`machine_nom` text,
	`technicien_id` text,
	`technicien_nom` text,
	`avancement_pct` integer DEFAULT 0 NOT NULL,
	`statut` text DEFAULT 'confirmed' NOT NULL,
	`date_debut` text,
	`date_fin_prevue` text,
	`date_fin_reelle` text,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`commande_id`) REFERENCES `commandes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`machine_id`) REFERENCES `machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`technicien_id`) REFERENCES `employes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `livraisons` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`commande_id` text,
	`client_id` text,
	`client_nom` text NOT NULL,
	`destination` text NOT NULL,
	`transporteur` text,
	`statut` text DEFAULT 'confirmed' NOT NULL,
	`date_depart` text,
	`date_livraison_prevue` text,
	`date_livraison_reelle` text,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`commande_id`) REFERENCES `commandes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`type` text NOT NULL,
	`zone` text NOT NULL,
	`numero_serie` text,
	`statut` text DEFAULT 'actif' NOT NULL,
	`derniere_maintenance` text,
	`prochaine_maintenance` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mesures_iot` (
	`id` text PRIMARY KEY NOT NULL,
	`capteur_id` text NOT NULL,
	`valeur` real NOT NULL,
	`unite` text NOT NULL,
	`timestamp` text NOT NULL,
	`est_alerte` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`capteur_id`) REFERENCES `capteurs_iot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mouvements_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`produit_id` text NOT NULL,
	`type` text NOT NULL,
	`quantite` real NOT NULL,
	`reference` text,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`produit_id`) REFERENCES `produits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `presences` (
	`id` text PRIMARY KEY NOT NULL,
	`employe_id` text NOT NULL,
	`date` text NOT NULL,
	`arrivee` text,
	`depart` text,
	`heures` real DEFAULT 0 NOT NULL,
	`statut` text NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`employe_id`) REFERENCES `employes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `produits` (
	`id` text PRIMARY KEY NOT NULL,
	`ref` text NOT NULL,
	`designation` text NOT NULL,
	`description` text,
	`categorie` text NOT NULL,
	`unite` text DEFAULT 'unité' NOT NULL,
	`stock_actuel` real DEFAULT 0 NOT NULL,
	`stock_min` real DEFAULT 5 NOT NULL,
	`stock_critique` real DEFAULT 2 NOT NULL,
	`prix_unitaire_xaf` real DEFAULT 0 NOT NULL,
	`statut` text DEFAULT 'normal' NOT NULL,
	`emplacement` text,
	`fournisseur` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`nom` text NOT NULL,
	`role` text DEFAULT 'operateur' NOT NULL,
	`telephone` text,
	`avatar_url` text,
	`actif` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projets` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`description` text,
	`client_id` text,
	`client_nom` text,
	`chef_projet_id` text,
	`chef_projet_nom` text,
	`budget_xaf` real DEFAULT 0 NOT NULL,
	`depense_xaf` real DEFAULT 0 NOT NULL,
	`avancement_pct` integer DEFAULT 0 NOT NULL,
	`statut` text DEFAULT 'planifie' NOT NULL,
	`date_debut` text,
	`deadline` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chef_projet_id`) REFERENCES `employes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `remboursements_credit` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_id` text NOT NULL,
	`montant_xaf` real NOT NULL,
	`date_paiement` text NOT NULL,
	`type` text NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`credit_id`) REFERENCES `credits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `taches_projet` (
	`id` text PRIMARY KEY NOT NULL,
	`projet_id` text NOT NULL,
	`titre` text NOT NULL,
	`description` text,
	`responsable_id` text,
	`statut` text DEFAULT 'todo' NOT NULL,
	`priorite` text DEFAULT 'normale' NOT NULL,
	`date_echeance` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`projet_id`) REFERENCES `projets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsable_id`) REFERENCES `employes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `validations_niveau` (
	`id` text PRIMARY KEY NOT NULL,
	`apprenant_id` text NOT NULL,
	`niveau` integer NOT NULL,
	`valide_by` text,
	`date_validation` text NOT NULL,
	`commentaire` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`apprenant_id`) REFERENCES `apprenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`valide_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bons_sortie_numero_unique` ON `bons_sortie` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `capteurs_iot_nom_unique` ON `capteurs_iot` (`nom`);--> statement-breakpoint
CREATE UNIQUE INDEX `commandes_numero_unique` ON `commandes` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `credits_numero_unique` ON `credits` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `devis_numero_unique` ON `devis` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `factures_numero_unique` ON `factures` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_production_numero_unique` ON `jobs_production` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `livraisons_numero_unique` ON `livraisons` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `produits_ref_unique` ON `produits` (`ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_email_unique` ON `profiles` (`email`);