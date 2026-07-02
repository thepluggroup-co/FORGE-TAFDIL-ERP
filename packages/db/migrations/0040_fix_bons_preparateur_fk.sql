-- Bons de sortie - corrige la FK preparateur_id pour pointer vers employes(id).

ALTER TABLE public.bons_sortie
  ADD COLUMN IF NOT EXISTS preparateur_id UUID;

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.bons_sortie'::regclass
      AND c.contype = 'f'
      AND a.attname = 'preparateur_id'
  LOOP
    EXECUTE format('ALTER TABLE public.bons_sortie DROP CONSTRAINT %I', fk.conname);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    WITH mapped AS (
      SELECT DISTINCT ON (p.id)
        p.id AS profile_id,
        e.id AS employe_id
      FROM public.profiles p
      JOIN public.employes e
        ON e.user_id = p.id
        OR (p.email IS NOT NULL AND e.email IS NOT NULL AND lower(p.email) = lower(e.email))
        OR (p.telephone IS NOT NULL AND e.telephone IS NOT NULL AND regexp_replace(p.telephone, '\D', '', 'g') = regexp_replace(e.telephone, '\D', '', 'g'))
        OR lower(trim(p.nom)) = lower(trim(e.nom))
      ORDER BY p.id,
        CASE
          WHEN e.user_id = p.id THEN 1
          WHEN p.email IS NOT NULL AND e.email IS NOT NULL AND lower(p.email) = lower(e.email) THEN 2
          WHEN p.telephone IS NOT NULL AND e.telephone IS NOT NULL AND regexp_replace(p.telephone, '\D', '', 'g') = regexp_replace(e.telephone, '\D', '', 'g') THEN 3
          ELSE 4
        END
    )
    UPDATE public.bons_sortie b
    SET preparateur_id = mapped.employe_id
    FROM mapped
    WHERE b.preparateur_id = mapped.profile_id
      AND NOT EXISTS (
        SELECT 1 FROM public.employes e WHERE e.id = b.preparateur_id
      );
  END IF;
END;
$$;

UPDATE public.bons_sortie b
SET preparateur_id = NULL
WHERE b.preparateur_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.employes e WHERE e.id = b.preparateur_id
  );

ALTER TABLE public.bons_sortie
  ADD CONSTRAINT bons_sortie_preparateur_id_fkey
  FOREIGN KEY (preparateur_id) REFERENCES public.employes(id) ON DELETE SET NULL;
