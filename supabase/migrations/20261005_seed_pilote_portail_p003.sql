-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOGUE HYBRIDE — DONNÉES PILOTE : Portail métallique P003 (configurable)
-- À coller APRÈS 20261004_catalogue_hybride_phase3_configurateur.sql.
--
-- Crée, seulement s'ils n'existent pas déjà (rejouable sans doublon) :
--   - la famille « Portails » sous la catégorie « Portail / Grilles / Ferronnerie »
--   - le modèle P003 (mode CONFIGURABLE, facturé au m²)
--   - son configurateur : largeur 2000–6000 mm, hauteur 1500–2500 mm, type,
--     matériau, finition, couleur (« autre » = validation humaine), motorisation, serrure
--
-- NE crée PAS (volontairement, brief §49 « ne pas hardcoder les coûts ») :
--   - la fiche technique (matières, main-d'œuvre, équipements et leurs coûts)
--   - le taux de marge
--   - les coûts des options : laissés à 0, à saisir dans Catalogue → Configurateur
--   - la mise en ligne : à faire dans Boutique → Produits finis
-- Tant que la fiche technique et un taux de marge ne sont pas saisis, le site
-- n'affiche pas de prix automatique : les demandes partent en validation humaine.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_categorie UUID;
  v_famille   UUID;
  v_modele    UUID;
  v_param     UUID;
BEGIN
  SELECT id INTO v_categorie FROM public.familles
   WHERE nom = 'Portail / Grilles / Ferronnerie' AND parent_id IS NULL LIMIT 1;
  IF v_categorie IS NULL THEN
    RAISE EXCEPTION 'Catégorie racine « Portail / Grilles / Ferronnerie » introuvable (migration 20260926 appliquée ?)';
  END IF;

  SELECT id INTO v_famille FROM public.familles WHERE nom = 'Portails' AND parent_id = v_categorie LIMIT 1;
  IF v_famille IS NULL THEN
    INSERT INTO public.familles (nom, parent_id, type_gamme, ordre)
    VALUES ('Portails', v_categorie, 'configuration', 1)
    RETURNING id INTO v_famille;
  END IF;

  SELECT id INTO v_modele FROM public.modeles WHERE reference = 'P003';
  IF v_modele IS NULL THEN
    INSERT INTO public.modeles (famille_id, reference, designation, description, unite_facturation, unite_facturation_id, type_gamme)
    VALUES (
      v_famille, 'P003', 'Portail métallique P003',
      'Portail en acier sur mesure : dimensions, type d''ouverture, finition et options au choix.',
      'm2', (SELECT id FROM public.unites_facturation WHERE code = 'm2'), 'configuration'
    )
    RETURNING id INTO v_modele;
  END IF;

  -- Configurateur : seulement si le modèle n'en a pas encore (ne jamais écraser une saisie)
  IF EXISTS (SELECT 1 FROM public.modele_parametres WHERE modele_id = v_modele) THEN
    RAISE NOTICE 'P003 a déjà un configurateur : inchangé';
    RETURN;
  END IF;

  INSERT INTO public.modele_parametres (modele_id, code, libelle, type, obligatoire, unite, min, max, role_calcul, ordre) VALUES
    (v_modele, 'largeur', 'Largeur', 'nombre', true, 'mm', 2000, 6000, 'largeur', 0),
    (v_modele, 'hauteur', 'Hauteur', 'nombre', true, 'mm', 1500, 2500, 'hauteur', 1);

  INSERT INTO public.modele_parametres (modele_id, code, libelle, type, obligatoire, ordre)
  VALUES (v_modele, 'type', 'Type d''ouverture', 'choix', true, 2) RETURNING id INTO v_param;
  INSERT INTO public.modele_parametre_valeurs (parametre_id, code, libelle, ordre) VALUES
    (v_param, 'battant', 'Battant', 0), (v_param, 'coulissant', 'Coulissant', 1);

  INSERT INTO public.modele_parametres (modele_id, code, libelle, type, obligatoire, ordre)
  VALUES (v_modele, 'materiau', 'Matériau', 'choix', true, 3) RETURNING id INTO v_param;
  INSERT INTO public.modele_parametre_valeurs (parametre_id, code, libelle, ordre) VALUES (v_param, 'acier', 'Acier', 0);

  INSERT INTO public.modele_parametres (modele_id, code, libelle, type, obligatoire, ordre)
  VALUES (v_modele, 'finition', 'Finition', 'choix', true, 4) RETURNING id INTO v_param;
  INSERT INTO public.modele_parametre_valeurs (parametre_id, code, libelle, ordre) VALUES (v_param, 'peinture', 'Peinture', 0);

  INSERT INTO public.modele_parametres (modele_id, code, libelle, type, obligatoire, ordre)
  VALUES (v_modele, 'couleur', 'Couleur', 'choix', true, 5) RETURNING id INTO v_param;
  INSERT INTO public.modele_parametre_valeurs (parametre_id, code, libelle, validation_requise, ordre) VALUES
    (v_param, 'noir', 'Noir', false, 0),
    (v_param, 'blanc', 'Blanc', false, 1),
    (v_param, 'autre', 'Autre (à préciser)', true, 2);

  INSERT INTO public.modele_parametres (modele_id, code, libelle, type, obligatoire, ordre) VALUES
    (v_modele, 'motorisation', 'Motorisation', 'booleen', false, 6),
    (v_modele, 'serrure', 'Serrure', 'booleen', false, 7);

  RAISE NOTICE 'Pilote P003 créé : % paramètres (coûts d''options à 0, fiche technique et marge à saisir)',
    (SELECT count(*) FROM public.modele_parametres WHERE modele_id = v_modele);
END $$;
