-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3 — modeles.unite_facturation : rattacher au référentiel centralisé
-- unites_facturation (Master Prompt V3 §9/10 — unités de facturation
-- centralisées, pas de texte libre non validé).
--
-- Contexte : `modeles.unite_facturation` (migration Phase 1 catalogue du
-- 26/09) est resté un simple TEXT, sans lien avec `unites_facturation`
-- (référentiel créé la veille, 25/09, avec les codes 'unite','m2','ml','m3',
-- 'kg','l','h','forfait'). Bug latent trouvé au passage : le défaut appliqué
-- à la création d'un modèle (Zod, catalogue.ts) était 'unité' (avec accent),
-- qui ne correspond à AUCUN code réel ('unite', sans accent) — tout modèle
-- créé sans unité explicite ne pouvait donc jamais être rattaché au
-- référentiel. Corrigé ici (normalisation des données) et côté API dans le
-- même chantier (défaut Zod aligné sur le code réel).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Normaliser le texte existant avant le rattachement : 'unité' n'a jamais
--    été un code valide, seulement l'effet du défaut buggé ci-dessus.
UPDATE public.modeles SET unite_facturation = 'unite' WHERE unite_facturation = 'unité';

ALTER TABLE public.modeles
  ALTER COLUMN unite_facturation SET DEFAULT 'unite';

-- 2. Nouvelle colonne, nullable : le texte libre (`unite_facturation`) reste
--    la source affichée/écrite par le front existant (§46, rétrocompatibilité)
--    — la FK est dérivée automatiquement côté API à chaque écriture, pas
--    imposée au client de la route.
ALTER TABLE public.modeles
  ADD COLUMN IF NOT EXISTS unite_facturation_id UUID REFERENCES public.unites_facturation(id);

CREATE INDEX IF NOT EXISTS idx_modeles_unite_facturation ON public.modeles(unite_facturation_id);

-- 3. Backfill : rattache chaque modèle existant dont le texte correspond
--    exactement à un code déjà seedé.
UPDATE public.modeles m
SET unite_facturation_id = uf.id
FROM public.unites_facturation uf
WHERE uf.code = m.unite_facturation
  AND m.unite_facturation_id IS NULL;

-- ── Vérification ─────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Phase 3 (unite_facturation_id) appliquée : % modèles rattachés / % total',
    (SELECT count(*) FROM public.modeles WHERE unite_facturation_id IS NOT NULL),
    (SELECT count(*) FROM public.modeles);
END $$;
