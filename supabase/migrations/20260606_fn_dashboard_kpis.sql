-- Single-call dashboard aggregation function.
-- Replaces 7 parallel REST queries with one round trip, which is significantly
-- faster on cold-start connections (Supabase free tier pauses after inactivity).
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
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- Indexes to speed up the most common filter columns
CREATE INDEX IF NOT EXISTS idx_commandes_statut     ON commandes(statut);
CREATE INDEX IF NOT EXISTS idx_commandes_created_at ON commandes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commandes_date       ON commandes(date_commande);
CREATE INDEX IF NOT EXISTS idx_produits_statut      ON produits(statut);
CREATE INDEX IF NOT EXISTS idx_apprenants_statut    ON apprenants(statut);
CREATE INDEX IF NOT EXISTS idx_bons_sortie_statut   ON bons_sortie(statut);
CREATE INDEX IF NOT EXISTS idx_credits_statut       ON credits(statut);
