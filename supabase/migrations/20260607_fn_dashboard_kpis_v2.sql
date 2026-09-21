-- Adds recent stock movements to fn_dashboard_kpis (was always returning []).
CREATE OR REPLACE FUNCTION fn_dashboard_kpis(debut_6mois text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  debut  text := COALESCE(debut_6mois, to_char(NOW() - INTERVAL '5 months', 'YYYY-MM-01'));
BEGIN
  SELECT json_build_object(
    'commandes_actives', (
      SELECT COUNT(*) FROM commandes WHERE statut IN ('confirmed','in_production','pret')
    ),
    'stocks_en_alerte', (
      SELECT COUNT(*) FROM produits WHERE statut IN ('alerte','critique','rupture')
    ),
    'apprenants_actifs', (
      SELECT COUNT(*) FROM apprenants WHERE statut = 'actif'
    ),
    'bons_en_attente', (
      SELECT COUNT(*) FROM bons_sortie WHERE statut = 'soumis'
    ),
    'credits_echus', (
      SELECT COUNT(*) FROM credits WHERE statut = 'echu'
    ),
    'recent_commandes', (
      SELECT COALESCE(json_agg(r), '[]'::json)
      FROM (
        SELECT id, numero, client_nom, total_ttc_xaf, statut, date_commande
        FROM commandes
        ORDER BY created_at DESC
        LIMIT 5
      ) r
    ),
    'ca_data', (
      SELECT COALESCE(json_agg(r), '[]'::json)
      FROM (
        SELECT total_ttc_xaf, date_commande
        FROM commandes
        WHERE date_commande >= debut AND statut != 'cancelled'
      ) r
    ),
    'recent_mouvements', (
      SELECT COALESCE(json_agg(r), '[]'::json)
      FROM (
        SELECT
          ms.id,
          ms.type,
          ms.quantite,
          ms.created_at,
          json_build_object(
            'designation', p.designation,
            'unite',       p.unite
          ) AS produits
        FROM mouvements_stock ms
        LEFT JOIN produits p ON p.id = ms.produit_id
        ORDER BY ms.created_at DESC
        LIMIT 5
      ) r
    )
  ) INTO result;

  RETURN result;
END;
$$;
