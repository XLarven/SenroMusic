-- Norie Music — Supabase profil senkronu (opsiyonel)
-- Supabase Dashboard → SQL Editor'da çalıştırın.
-- Norie Music sunucusu (server/src/supabase.ts) presence bilgilerini bu tabloya yazar.

create table if not exists public.profiles (
  id uuid primary key,
  email text not null,
  display_name text default '',
  last_active_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles upsert service" on public.profiles;
create policy "profiles upsert service"
  on public.profiles for all
  using (true)
  with check (true);
-- Not: service_role anahtarı RLS'i bypass eder; anon ile yazma gerekmez.

create index if not exists idx_profiles_last_active on public.profiles(last_active_at desc);
