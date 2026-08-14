-- GameHeelTigerNeerRines HQ authentication and league ownership foundation.
-- Apply with the Supabase CLI (`supabase db push`) or paste this entire file into
-- the Supabase SQL Editor. It is intentionally safe to run as one transaction.

create extension if not exists pgcrypto;

create type public.league_member_role as enum ('commissioner', 'owner');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill profiles if this project already has Auth users before the trigger is
-- installed. Future users are handled by on_auth_user_created below.
insert into public.profiles (id, display_name, created_at, updated_at)
select
  id,
  coalesce(nullif(trim(raw_user_meta_data ->> 'display_name'), ''), split_part(email, '@', 1), 'User'),
  created_at,
  coalesce(updated_at, created_at)
from auth.users
on conflict (id) do nothing;

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  season text not null check (season ~ '^[0-9]{4}$'),
  commissioner_id uuid not null references public.profiles(id) on delete restrict,
  owner_count integer not null check (owner_count between 2 and 100),
  teams_per_owner integer not null check (teams_per_owner between 1 and 25),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leagues_commissioner_season_name_key unique (commissioner_id, season, name)
);

create table public.league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.league_member_role not null default 'owner',
  team_name text check (team_name is null or char_length(trim(team_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  constraint league_members_league_user_key unique (league_id, user_id)
);

create index leagues_commissioner_id_idx on public.leagues (commissioner_id);
create index leagues_season_idx on public.leagues (season);
create index league_members_user_id_idx on public.league_members (user_id);
create index league_members_league_role_idx on public.league_members (league_id, role);
create unique index league_members_one_commissioner_idx
on public.league_members (league_id) where role = 'commissioner';

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger leagues_set_updated_at
before update on public.leagues
for each row execute function public.set_updated_at();

-- Creating the profile in the database makes signup reliable even if the client
-- closes before a follow-up request. display_name is supplied as user metadata.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'User')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Every league owner is also represented as its commissioner membership.
create function public.add_league_commissioner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.league_members (league_id, user_id, role)
  values (new.id, new.commissioner_id, 'commissioner');
  return new;
end;
$$;

create trigger on_league_created
after insert on public.leagues
for each row execute function public.add_league_commissioner_membership();

-- SECURITY DEFINER helpers prevent RLS policies on leagues and league_members
-- from recursively querying one another. They expose booleans only.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.is_league_commissioner(target_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leagues
    where id = target_league_id and commissioner_id = auth.uid()
  );
$$;

create function private.is_league_member(target_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_members
    where league_id = target_league_id and user_id = auth.uid()
  );
$$;

revoke all on function private.is_league_commissioner(uuid) from public;
revoke all on function private.is_league_member(uuid) from public;
grant execute on function private.is_league_commissioner(uuid) to authenticated;
grant execute on function private.is_league_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;

-- Profiles: users can read and edit only their own profile. Inserts are owned by
-- the auth trigger, so clients cannot forge profiles for another auth user.
create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (id = auth.uid());

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Leagues: commissioners have full control over rows they own. Membership grants
-- read access only; it never grants mutation rights.
create policy "Members can read their leagues"
on public.leagues for select to authenticated
using (commissioner_id = auth.uid() or private.is_league_member(id));

create policy "Commissioners can create their own leagues"
on public.leagues for insert to authenticated
with check (commissioner_id = auth.uid());

create policy "Commissioners can update their own leagues"
on public.leagues for update to authenticated
using (commissioner_id = auth.uid())
with check (commissioner_id = auth.uid());

create policy "Commissioners can delete their own leagues"
on public.leagues for delete to authenticated
using (commissioner_id = auth.uid());

-- Memberships: users see their own membership; commissioners see and manage all
-- membership rows for leagues they own.
create policy "Users can read relevant league memberships"
on public.league_members for select to authenticated
using (user_id = auth.uid() or private.is_league_commissioner(league_id));

create policy "Commissioners can add league memberships"
on public.league_members for insert to authenticated
with check (
  private.is_league_commissioner(league_id)
  and role = 'owner'
  and user_id <> auth.uid()
);

create policy "Commissioners can update league memberships"
on public.league_members for update to authenticated
using (private.is_league_commissioner(league_id) and role = 'owner')
with check (
  private.is_league_commissioner(league_id)
  and role = 'owner'
  and user_id <> auth.uid()
);

create policy "Commissioners can remove league memberships"
on public.league_members for delete to authenticated
using (private.is_league_commissioner(league_id) and role = 'owner');

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.leagues to authenticated;
grant select, insert, update, delete on public.league_members to authenticated;
