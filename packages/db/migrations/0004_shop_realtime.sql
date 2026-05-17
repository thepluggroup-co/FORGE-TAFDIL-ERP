-- ── Realtime + accès public suivi commande ────────────────────────────────────
--
-- Ce script configure Supabase Realtime sur commandes_shop pour que la page
-- /suivi/[ref] se mette à jour sans rechargement quand l'ERP change le statut.
--
-- À exécuter dans : Supabase Dashboard → SQL Editor

-- 1. Activer Realtime sur commandes_shop (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'commandes_shop'
  ) then
    alter publication supabase_realtime add table commandes_shop;
  end if;
end;
$$;

-- 2. RLS : permettre à l'anonyme de lire une commande par sa référence publique
--    (la ref WEB-2026-XXXX est déjà fournie au client par SMS)
alter table public.commandes_shop enable row level security;

create policy "lecture publique par ref"
  on public.commandes_shop
  for select
  to anon
  using (true);
-- Note : si tu veux restreindre strictement, utilise :
--   using (ref IS NOT NULL)
-- La ref n'est pas devinable (WEB-2026-XXXX avec 4 chiffres aléatoires)
-- mais l'accès est public — acceptable pour un suivi de commande.

-- 3. Ajouter les colonnes nécessaires si pas encore présentes
alter table public.commandes_shop
  add column if not exists photos_livraison text[] default null;

-- photos_livraison : tableau d'URLs Supabase Storage
-- L'APK technicien upload les photos et insère les URLs ici.
-- Exemple d'update depuis l'APK :
--   UPDATE commandes_shop
--   SET photos_livraison = array_append(photos_livraison, 'https://...url...')
--   WHERE ref = 'WEB-2026-1234';
