-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNOSTIC — schéma réel de la base vs ce qu'attend le code (LECTURE SEULE)
--
-- À coller dans le SQL Editor de Supabase. Ne modifie RIEN (uniquement des
-- SELECT). Ce n'est PAS une migration : ne pas le ranger dans migrations/.
--
-- Pourquoi : la base de production ne contient pas toujours ce que déclarent
-- les anciennes migrations du dépôt (ex. jobs_production.machine_id absente,
-- constaté le 28/09/2026). Ce diagnostic liste, pour chaque table et colonne
-- utilisée par l'API (catalogue, boutique, devis, commandes, production,
-- configurateur, coûts), si elle existe réellement.
--
-- Lecture du résultat :
--   statut = 'OK'               → présent
--   statut = 'TABLE ABSENTE'    → la table n'existe pas
--   statut = 'COLONNE ABSENTE'  → la table existe, pas la colonne
--   statut = 'VALEUR ABSENTE'   → valeur manquante dans l'enum audit_action_type
--   origine                     → migration du dépôt censée l'avoir créée
--                                  ('schéma historique' = tables d'avant le chantier)
-- Les lignes en écart sont listées en premier. Pour un résumé seulement,
-- décommentez le filtre « WHERE statut <> 'OK' » en bas de la requête.
-- ═══════════════════════════════════════════════════════════════════════════

WITH attendu (table_nom, colonne, origine) AS (
  VALUES
  -- ── Stock et boutique (schéma historique) ────────────────────────────────
  ('produits', 'id', 'schéma historique'), ('produits', 'ref', 'schéma historique'),
  ('produits', 'designation', 'schéma historique'), ('produits', 'description', 'schéma historique'),
  ('produits', 'categorie', 'schéma historique'), ('produits', 'unite', 'schéma historique'),
  ('produits', 'stock_actuel', 'schéma historique'), ('produits', 'stock_min', 'schéma historique'),
  ('produits', 'stock_critique', 'schéma historique'), ('produits', 'prix_unitaire_xaf', 'schéma historique'),
  ('produits', 'statut', 'schéma historique'), ('produits', 'fournisseur', 'schéma historique'),

  ('produits_shop', 'product_id', '20260519_shop_tables'), ('produits_shop', 'visible_shop', '20260519_shop_tables'),
  ('produits_shop', 'prix_public', '20260519_shop_tables'), ('produits_shop', 'description_longue', '20260519_shop_tables'),
  ('produits_shop', 'images', '20260519_shop_tables'), ('produits_shop', 'tags', '20260519_shop_tables'),
  ('produits_shop', 'delai_fabrication_jours', '20260519_shop_tables'), ('produits_shop', 'min_commande', '20260519_shop_tables'),

  ('commandes_shop', 'id', '20260519_shop_tables'), ('commandes_shop', 'ref', '20260519_shop_tables'),
  ('commandes_shop', 'source', 'schéma historique'), ('commandes_shop', 'client_nom', '20260519_shop_tables'),
  ('commandes_shop', 'client_telephone', '20260519_shop_tables'), ('commandes_shop', 'client_email', '20260519_shop_tables'),
  ('commandes_shop', 'client_adresse', '20260519_shop_tables'), ('commandes_shop', 'client_ville', '20260519_shop_tables'),
  ('commandes_shop', 'lignes', '20260519_shop_tables'), ('commandes_shop', 'montant_ht', '20260519_shop_tables'),
  ('commandes_shop', 'tva', '20260519_shop_tables'), ('commandes_shop', 'montant_ttc', '20260519_shop_tables'),
  ('commandes_shop', 'frais_livraison', '20260519_shop_tables'), ('commandes_shop', 'mode_paiement', '20260519_shop_tables'),
  ('commandes_shop', 'mode_livraison', 'schéma historique'), ('commandes_shop', 'notes_client', '20260519_shop_tables'),
  ('commandes_shop', 'statut_commande', '20260519_shop_tables'), ('commandes_shop', 'statut_paiement', '20260519_shop_tables'),
  ('commandes_shop', 'erp_commande_id', '20260519_shop_tables'),

  ('demandes_devis_web', 'id', '20260519_shop_tables'), ('demandes_devis_web', 'nom', '20260519_shop_tables'),
  ('demandes_devis_web', 'telephone', '20260519_shop_tables'), ('demandes_devis_web', 'email', '20260519_shop_tables'),
  ('demandes_devis_web', 'description', '20260519_shop_tables'), ('demandes_devis_web', 'type_projet', '20260519_shop_tables'),
  ('demandes_devis_web', 'produit_ref', '20260519_shop_tables'), ('demandes_devis_web', 'statut', '20260519_shop_tables'),
  ('demandes_devis_web', 'erp_devis_id', '20260519_shop_tables'),

  ('campagnes_marketing', 'nom', 'schéma historique'), ('campagnes_marketing', 'statut', 'schéma historique'),
  ('campagnes_marketing', 'date_debut', 'schéma historique'), ('campagnes_marketing', 'date_fin', 'schéma historique'),
  ('campagnes_produits', 'campagne_id', '20260709_campaign_products'), ('campagnes_produits', 'product_id', '20260709_campaign_products'),
  ('campagnes_produits', 'remise_type', '20260709_campaign_products'), ('campagnes_produits', 'remise_valeur', '20260709_campaign_products'),
  ('campagnes_produits', 'prix_promo_xaf', '20260709_campaign_products'), ('campagnes_produits', 'priorite', '20260709_campaign_products'),
  ('campagnes_produits', 'modele_id', '20261003_promotions_produits_finis'),

  -- ── Commercial (schéma historique + V3) ──────────────────────────────────
  ('conditions_paiement', 'id', 'schéma historique'), ('conditions_paiement', 'code', 'schéma historique'),
  ('conditions_paiement', 'acompte_pct', 'schéma historique'), ('conditions_paiement', 'delai_solde_jours', 'schéma historique'),

  ('devis', 'id', 'schéma historique'), ('devis', 'numero', 'schéma historique'),
  ('devis', 'client_id', 'schéma historique'), ('devis', 'client_nom', 'schéma historique'),
  ('devis', 'statut', 'schéma historique'), ('devis', 'date_emission', 'schéma historique'),
  ('devis', 'date_validite', 'schéma historique'), ('devis', 'validite_jours', 'schéma historique'),
  ('devis', 'condition_paiement_id', '20260607_conditions_paiement'), ('devis', 'notes', 'schéma historique'),
  ('devis', 'total_ht_xaf', 'schéma historique'), ('devis', 'tva_xaf', 'schéma historique'),
  ('devis', 'total_ttc_xaf', 'schéma historique'), ('devis', 'sync_status', 'schéma historique'),
  ('devis', 'source_demande', '20260925_phase1_gamme_fiche_technique'), ('devis', 'fiche_technique_id', '20260925_phase1_gamme_fiche_technique'),
  ('devis', 'config_snapshot', '20260925_phase1_gamme_fiche_technique'), ('devis', 'ressources_snapshot', '20260925_phase1_gamme_fiche_technique'),

  ('devis_lignes', 'devis_id', 'schéma historique'), ('devis_lignes', 'produit_id', '20260630_devis_lignes_produit_id'),
  ('devis_lignes', 'designation', 'schéma historique'), ('devis_lignes', 'description', 'schéma historique'),
  ('devis_lignes', 'categorie', 'schéma historique'), ('devis_lignes', 'unite', 'schéma historique'),
  ('devis_lignes', 'quantite', 'schéma historique'), ('devis_lignes', 'prix_unitaire_ht_xaf', 'schéma historique'),
  ('devis_lignes', 'total_ht_xaf', 'schéma historique'), ('devis_lignes', 'ordre', 'schéma historique'),
  ('devis_lignes', 'configuration', '20260925_phase1_gamme_fiche_technique'), ('devis_lignes', 'formule_utilisee', '20260925_phase1_gamme_fiche_technique'),
  ('devis_lignes', 'quantite_calculee', '20260925_phase3_devis_workflow'), ('devis_lignes', 'cout_calcule_xaf', '20260925_phase3_devis_workflow'),

  ('commandes', 'id', 'schéma historique'), ('commandes', 'numero', 'schéma historique'),
  ('commandes', 'client_id', 'schéma historique'), ('commandes', 'client_nom', 'schéma historique'),
  ('commandes', 'devis_id', 'schéma historique'), ('commandes', 'statut', 'schéma historique'),
  ('commandes', 'date_commande', 'schéma historique'), ('commandes', 'total_ht_xaf', 'schéma historique'),
  ('commandes', 'tva_xaf', 'schéma historique'), ('commandes', 'frais_livraison_xaf', 'schéma historique'),
  ('commandes', 'total_ttc_xaf', 'schéma historique'), ('commandes', 'condition_paiement_id', '20260607_conditions_paiement'),
  ('commandes', 'montant_acompte', 'schéma historique (écrite par POST /shop/commandes)'),
  ('commandes', 'date_echeance_solde', 'schéma historique'), ('commandes', 'notes', 'schéma historique'),

  ('commandes_lignes', 'id', 'schéma historique'), ('commandes_lignes', 'commande_id', 'schéma historique'),
  ('commandes_lignes', 'produit_id', 'schéma historique'), ('commandes_lignes', 'designation', 'schéma historique'),
  ('commandes_lignes', 'unite', 'schéma historique'), ('commandes_lignes', 'quantite', 'schéma historique'),
  ('commandes_lignes', 'prix_unitaire_ht_xaf', 'schéma historique'), ('commandes_lignes', 'total_ht_xaf', 'schéma historique'),
  ('commandes_lignes', 'ordre', 'schéma historique'),
  ('commandes_lignes', 'modele_id', '20261002_catalogue_hybride_phase2_modeles_shop'),

  -- ── Catalogue produits finis ──────────────────────────────────────────────
  ('familles', 'id', '20260926_catalogue_produits_finis'), ('familles', 'nom', '20260926_catalogue_produits_finis'),
  ('familles', 'parent_id', '20260926_catalogue_produits_finis'), ('familles', 'type_gamme', '20260926_catalogue_produits_finis'),
  ('familles', 'ordre', '20260926_catalogue_produits_finis'), ('familles', 'actif', '20260926_catalogue_produits_finis'),

  ('modeles', 'id', '20260926_catalogue_produits_finis'), ('modeles', 'famille_id', '20260926_catalogue_produits_finis'),
  ('modeles', 'reference', '20260926_catalogue_produits_finis'), ('modeles', 'designation', '20260926_catalogue_produits_finis'),
  ('modeles', 'description', '20260926_catalogue_produits_finis'), ('modeles', 'unite_facturation', '20260926_catalogue_produits_finis'),
  ('modeles', 'type_gamme', '20260926_catalogue_produits_finis'), ('modeles', 'actif', '20260926_catalogue_produits_finis'),
  ('modeles', 'unite_facturation_id', '20260928_modeles_unite_facturation_fk'),

  ('modele_specifications', 'modele_id', '20260926_catalogue_produits_finis'),
  ('unites_facturation', 'id', '20260925_phase1_gamme_fiche_technique'), ('unites_facturation', 'code', '20260925_phase1_gamme_fiche_technique'),

  ('fiche_technique', 'id', '20260925_phase1_gamme_fiche_technique'), ('fiche_technique', 'version', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique', 'statut', '20260925_phase1_gamme_fiche_technique'), ('fiche_technique', 'mode_calcul', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique', 'unite_facturation_id', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique', 'modele_id', '20260927_phase2_calcul_modele'),

  ('fiche_technique_ressources', 'id', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'fiche_technique_id', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'type', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'ressource_produit_id', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'ressource_equipement_id', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'designation', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'unite', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'quantite_par_unite', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'cout_unitaire_reference_xaf', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'temps_reference_h', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'ordre', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'actif', '20260925_phase1_gamme_fiche_technique'),
  ('fiche_technique_ressources', 'ressource_fournisseur_id', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('fiche_technique_ressources', 'delai_jours', '20261006_catalogue_hybride_phase4_cost_engine'),

  -- ── Catalogue Hybride : vitrine, configurateur, coûts, gamme ─────────────
  ('modeles_shop', 'modele_id', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('modeles_shop', 'visible_shop', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('modeles_shop', 'prix_public', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('modeles_shop', 'description_longue', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('modeles_shop', 'images', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('modeles_shop', 'tags', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('modeles_shop', 'delai_fabrication_jours', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('modeles_shop', 'min_commande', '20261002_catalogue_hybride_phase2_modeles_shop'),

  ('modele_parametres', 'id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'modele_id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'code', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'libelle', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'type', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'obligatoire', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'unite', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'min', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'max', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'pas', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'role_calcul', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'cout_si_oui_xaf', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'ordre', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'actif', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametres', 'categorie_cout', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('modele_parametres', 'cout_par_commande', '20261006_catalogue_hybride_phase4_cost_engine'),

  ('modele_parametre_valeurs', 'parametre_id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametre_valeurs', 'code', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametre_valeurs', 'libelle', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametre_valeurs', 'cout_supplementaire_xaf', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametre_valeurs', 'validation_requise', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametre_valeurs', 'ordre', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametre_valeurs', 'actif', '20261004_catalogue_hybride_phase3_configurateur'),
  ('modele_parametre_valeurs', 'categorie_cout', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('modele_parametre_valeurs', 'cout_par_commande', '20261006_catalogue_hybride_phase4_cost_engine'),

  ('regles_marge', 'id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('regles_marge', 'portee', '20261004_catalogue_hybride_phase3_configurateur'),
  ('regles_marge', 'famille_id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('regles_marge', 'modele_id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('regles_marge', 'taux_pct', '20261004_catalogue_hybride_phase3_configurateur'),
  ('regles_marge', 'actif', '20261004_catalogue_hybride_phase3_configurateur'),

  ('configurations', 'id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'numero', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'modele_id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'statut', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'quantite', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'valeurs', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'schema_snapshot', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'estimation_snapshot', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'prix_estime_ht_xaf', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'devis_id', '20261004_catalogue_hybride_phase3_configurateur'),
  ('configurations', 'demande_devis_web_id', '20261004_catalogue_hybride_phase3_configurateur'),

  ('frais_indirects', 'id', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'libelle', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'centre_cout', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'mode', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'valeur', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'base', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'portee', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'date_debut', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'date_fin', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('frais_indirects', 'actif', '20261006_catalogue_hybride_phase4_cost_engine'),

  ('postes_travail', 'id', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('postes_travail', 'code', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('postes_travail', 'libelle', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('postes_travail', 'cout_horaire_xaf', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('postes_travail', 'actif', '20261007_catalogue_hybride_phase5_gamme_equipements'),

  ('gamme_operations', 'id', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'fiche_technique_id', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'numero', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'libelle', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'poste_id', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'equipement_id', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'temps_unitaire_h', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'temps_fixe_h', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('gamme_operations', 'actif', '20261007_catalogue_hybride_phase5_gamme_equipements'),

  -- ── Production, équipements, RH ───────────────────────────────────────────
  ('jobs_production', 'id', 'schéma historique'), ('jobs_production', 'numero', 'schéma historique'),
  ('jobs_production', 'commande_id', '20260524_core_tables_complete → réparée par 20261008'), ('jobs_production', 'produit_designation', 'schéma historique'),
  ('jobs_production', 'machine_nom', 'schéma historique'), ('jobs_production', 'technicien_nom', 'schéma historique'),
  ('jobs_production', 'statut', 'schéma historique'), ('jobs_production', 'avancement_pct', 'schéma historique'),
  ('jobs_production', 'date_debut', 'schéma historique'), ('jobs_production', 'date_fin_prevue', 'schéma historique'),
  ('jobs_production', 'date_fin_reelle', 'schéma historique'), ('jobs_production', 'notes', 'schéma historique'),
  ('jobs_production', 'type_job', '20260925_phase4_production'), ('jobs_production', 'produit_id', '20260925_phase4_production'),
  ('jobs_production', 'unite', '20260925_phase4_production'), ('jobs_production', 'quantite_prevue', '20260925_phase4_production'),
  ('jobs_production', 'prix_unitaire_xaf', '20260925_phase4_production'), ('jobs_production', 'ressources_besoin', '20260925_phase4_production'),
  ('jobs_production', 'technicien_id', '20261007 (ajoutée si absente)'),
  ('jobs_production', 'equipement_id', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  -- colonnes écrites par l'API, garanties par la réparation 20261008 (commande_id manquait en prod)
  ('jobs_production', 'produit_ref', '20261008_reparation_jobs_production'),
  ('jobs_production', 'categorie', '20261008_reparation_jobs_production'),
  ('jobs_production', 'prix_public_xaf', '20261008_reparation_jobs_production'),
  ('jobs_production', 'publier_shop', '20261008_reparation_jobs_production'),
  ('jobs_production', 'description_produit', '20261008_reparation_jobs_production'),
  ('jobs_production', 'quantite_produite', '20261008_reparation_jobs_production'),
  ('jobs_production', 'created_by', '20261008_reparation_jobs_production'),
  ('jobs_production', 'sync_status', '20261008_reparation_jobs_production'),
  ('jobs_production', 'created_at', '20261008_reparation_jobs_production'),
  ('jobs_production', 'updated_at', '20261008_reparation_jobs_production'),

  -- Phase 6 : demandes de devis structurées
  ('demandes_devis_web', 'numero', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'source', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'client_id', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'famille_id', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'modele_id', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'quantite', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'dimensions', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'materiau', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'localisation', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'delai_souhaite', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'notes_internes', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'qualifie_par', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'qualifie_le', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_web', 'updated_at', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_documents', 'storage_path', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_documents', 'type_mime', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_historique', 'nouveau_statut', '20261009_catalogue_hybride_phase6_demandes_devis'),
  ('demandes_devis_historique', 'par', '20261009_catalogue_hybride_phase6_demandes_devis'),

  -- Phase 7 : l'OF reprend la gamme
  ('jobs_production', 'fiche_technique_id', '20261010_catalogue_hybride_phase7_production'),
  ('jobs_production', 'quantite_facturable', '20261010_catalogue_hybride_phase7_production'),
  ('jobs_production', 'gamme_chargee_le', '20261010_catalogue_hybride_phase7_production'),
  ('of_operations', 'temps_prevu_h', '20261010_catalogue_hybride_phase7_production'),
  ('of_operations', 'temps_reel_h', '20261010_catalogue_hybride_phase7_production'),
  ('of_operations', 'cout_horaire_poste_xaf', '20261010_catalogue_hybride_phase7_production'),
  ('of_operations', 'technicien_id', '20261010_catalogue_hybride_phase7_production'),
  ('of_consommations', 'quantite_prevue', '20261010_catalogue_hybride_phase7_production'),
  ('of_consommations', 'quantite_reelle', '20261010_catalogue_hybride_phase7_production'),
  ('of_consommations', 'quantite_sortie_stock', '20261010_catalogue_hybride_phase7_production'),

  ('equipements', 'id', '20260530_equipements'), ('equipements', 'code', '20260530_equipements'),
  ('equipements', 'designation', '20260530_equipements'), ('equipements', 'categorie', '20260530_equipements'),
  ('equipements', 'statut', '20260530_equipements'), ('equipements', 'numero_serie', '20260530_equipements'),
  ('equipements', 'emplacement', '20260530_equipements'), ('equipements', 'notes', '20260530_equipements'),
  ('equipements', 'prochaine_revision', '20260530_equipements'),
  ('equipements', 'cout_horaire_xaf', '20261007_catalogue_hybride_phase5_gamme_equipements'),
  ('equipements', 'ancienne_machine_id', '20261007_catalogue_hybride_phase5_gamme_equipements'),

  ('employes', 'id', 'schéma historique'), ('employes', 'nom', 'schéma historique'),
  ('employes', 'poste', 'schéma historique'), ('employes', 'departement', 'schéma historique'),
  ('employes', 'statut', 'schéma historique'),

  ('clients', 'id', 'schéma historique'),
  ('fournisseurs', 'id', 'schéma historique (FK optionnelle en 20261006)'),

  -- ── Audit ─────────────────────────────────────────────────────────────────
  ('rbac_audit_logs', 'user_id', '20260607_rbac_module'), ('rbac_audit_logs', 'action_type', '20260607_rbac_module'),
  ('rbac_audit_logs', 'module', '20260607_rbac_module'), ('rbac_audit_logs', 'resource_type', '20260607_rbac_module'),
  ('rbac_audit_logs', 'resource_id', '20260607_rbac_module'), ('rbac_audit_logs', 'payload_before', '20260607_rbac_module'),
  ('rbac_audit_logs', 'payload_after', '20260607_rbac_module')
),

enum_attendu (valeur, origine) AS (
  VALUES
  ('DEVIS_CREATED', '20260926_phase5_audit_devis'), ('DEVIS_UPDATED', '20260926_phase5_audit_devis'),
  ('DEVIS_LIGNE_AJUSTEE', '20260926_phase5_audit_devis'), ('DEVIS_VALIDATION_CLIENT', '20260926_phase5_audit_devis'),
  ('DEVIS_CONVERTI_COMMANDE', '20260926_phase5_audit_devis'),
  ('VENTE_PRIX_FORCE', '20260930_shop_securite_prix_rls'),
  ('PRIX_VITRINE_MODIFIE', '20261002_catalogue_hybride_phase2_modeles_shop'),
  ('MARGE_MODIFIEE', '20261004_catalogue_hybride_phase3_configurateur'),
  ('CONFIGURATION_CREEE', '20261004_catalogue_hybride_phase3_configurateur'),
  ('FRAIS_INDIRECTS_MODIFIES', '20261006_catalogue_hybride_phase4_cost_engine'),
  ('TAUX_HORAIRE_MODIFIE', '20261007_catalogue_hybride_phase5_gamme_equipements')
),

resultat AS (
  SELECT
    a.table_nom AS "table",
    a.colonne,
    CASE
      WHEN to_regclass('public.' || a.table_nom) IS NULL THEN 'TABLE ABSENTE'
      WHEN c.column_name IS NULL                         THEN 'COLONNE ABSENTE'
      ELSE 'OK'
    END AS statut,
    c.data_type::text AS type_reel,
    a.origine
  FROM attendu a
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = a.table_nom AND c.column_name = a.colonne

  UNION ALL

  SELECT
    'enum audit_action_type',
    e.valeur,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action_type') THEN 'TABLE ABSENTE'
      WHEN EXISTS (
        SELECT 1 FROM pg_enum en JOIN pg_type t ON t.oid = en.enumtypid
         WHERE t.typname = 'audit_action_type' AND en.enumlabel = e.valeur
      ) THEN 'OK'
      ELSE 'VALEUR ABSENTE'
    END,
    'enum',
    e.origine
  FROM enum_attendu e
)

SELECT *
FROM resultat
-- WHERE statut <> 'OK'
ORDER BY (statut = 'OK'), "table", colonne;
