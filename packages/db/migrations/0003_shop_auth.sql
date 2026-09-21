-- ── Table : clients_shop ──────────────────────────────────────────────────────
-- Un client identifié par son numéro de téléphone (OTP, sans mot de passe)

create table if not exists public.clients_shop (
  id                  uuid primary key default gen_random_uuid(),
  telephone           text not null unique,
  nom                 text,
  email               text,
  derniere_connexion  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Index pour recherche par téléphone (déjà couvert par UNIQUE mais explicite)
create index if not exists idx_clients_shop_telephone on public.clients_shop (telephone);

-- RLS : lecture/écriture uniquement via service role (pas d'accès anon)
alter table public.clients_shop enable row level security;
-- Les policies côté anon sont volontairement absentes (accès via API + service key uniquement)


-- ── Table : otp_sessions ──────────────────────────────────────────────────────
-- Sessions OTP éphémères (TTL 5 min, nettoyage automatique)

create table if not exists public.otp_sessions (
  id          uuid primary key default gen_random_uuid(),
  telephone   text not null,
  code        text not null,          -- code à 6 chiffres
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_otp_sessions_telephone on public.otp_sessions (telephone);
create index if not exists idx_otp_sessions_expires_at on public.otp_sessions (expires_at);

alter table public.otp_sessions enable row level security;

-- Nettoyage automatique des OTP expirés (pg_cron si disponible, sinon via DELETE dans le code)
-- delete from public.otp_sessions where expires_at < now();


-- ── Trigger updated_at sur clients_shop ───────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_clients_shop_updated_at on public.clients_shop;
create trigger trg_clients_shop_updated_at
  before update on public.clients_shop
  for each row execute function public.set_updated_at();
