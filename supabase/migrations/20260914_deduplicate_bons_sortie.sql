-- Un seul bon de sortie peut être associé à une commande.
-- Les doublons historiques sont nettoyés avant la création des index.

WITH classes AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY commande_id
      ORDER BY
        CASE statut
          WHEN 'execute' THEN 0
          WHEN 'valide' THEN 1
          WHEN 'soumis' THEN 2
          WHEN 'en_attente' THEN 3
          ELSE 4
        END,
        created_at ASC,
        id ASC
    ) AS rang
  FROM public.bons_sortie
  WHERE commande_id IS NOT NULL
)
DELETE FROM public.bons_sortie AS b
USING classes AS c
WHERE b.id = c.id
  AND c.rang > 1;

-- Les commandes web sans liaison ERP utilisent leur référence comme demandeur.
WITH classes AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY numero
      ORDER BY
        CASE statut
          WHEN 'execute' THEN 0
          WHEN 'valide' THEN 1
          WHEN 'soumis' THEN 2
          WHEN 'en_attente' THEN 3
          ELSE 4
        END,
        created_at ASC,
        id ASC
    ) AS rang
  FROM public.bons_sortie
  WHERE numero LIKE 'WEB-%'
)
DELETE FROM public.bons_sortie AS b
USING classes AS c
WHERE b.id = c.id
  AND c.rang > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bons_sortie_commande_unique
  ON public.bons_sortie (commande_id)
  WHERE commande_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bons_sortie_web_numero_unique
  ON public.bons_sortie (numero)
  WHERE numero LIKE 'WEB-%';
