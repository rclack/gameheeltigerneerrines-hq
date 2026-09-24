-- User-scoped favorite team preference and cached CFBD team branding.

alter table public.teams
  add column primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.profiles
  add column favorite_team_id uuid references public.teams(id) on delete set null;

create index profiles_favorite_team_id_idx on public.profiles (favorite_team_id);

-- Keep the established commissioner authorization and mapping source of truth,
-- while caching the branding delivered by the same CFBD team catalog request.
create or replace function public.save_external_team_mappings(
  target_league_id uuid,
  target_provider text,
  target_mappings jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  saved_count integer := 0;
  mapped_team_id uuid;
begin
  if not exists (
    select 1 from public.leagues
    where id = target_league_id and commissioner_id = auth.uid()
  ) then
    raise exception 'League not found or access denied' using errcode = '42501';
  end if;
  if target_provider <> 'cfbd' or jsonb_typeof(target_mappings) <> 'array' then
    raise exception 'Invalid mappings payload' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(target_mappings) loop
    mapped_team_id := (item->>'team_id')::uuid;
    insert into public.external_team_mappings (provider, team_id, external_team_id, external_name)
    values (target_provider, mapped_team_id, trim(item->>'external_team_id'), trim(item->>'external_name'))
    on conflict do nothing;
    if found then saved_count := saved_count + 1; end if;

    update public.teams
    set primary_color = case
          when item->>'primary_color' ~ '^#[0-9A-Fa-f]{6}$' then upper(item->>'primary_color')
          else primary_color
        end,
        secondary_color = case
          when item->>'secondary_color' ~ '^#[0-9A-Fa-f]{6}$' then upper(item->>'secondary_color')
          else secondary_color
        end,
        logo_url = case
          when item->>'logo_url' ~ '^https://(a|a1)\.espncdn\.com/' then item->>'logo_url'
          else logo_url
        end
    where id = mapped_team_id;
  end loop;
  return saved_count;
end;
$$;

revoke all on function public.save_external_team_mappings(uuid, text, jsonb) from public, anon;
grant execute on function public.save_external_team_mappings(uuid, text, jsonb) to authenticated;
