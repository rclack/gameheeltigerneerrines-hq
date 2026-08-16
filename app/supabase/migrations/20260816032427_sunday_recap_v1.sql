-- Deterministic weekly standings history and guarded Sunday recap operations.

create table public.league_recap_settings (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.weekly_recap_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season text not null check (season ~ '^[0-9]{4}$'),
  week integer not null check (week > 0),
  league_member_id uuid not null references public.league_members(id) on delete cascade,
  total_points integer not null,
  standing_position integer not null check (standing_position > 0),
  weekly_points integer not null,
  prior_position integer check (prior_position is null or prior_position > 0),
  created_at timestamptz not null default now(),
  constraint weekly_recap_snapshots_member_key unique (league_id, season, week, league_member_id)
);

create index weekly_recap_snapshots_league_history_idx
on public.weekly_recap_snapshots (league_id, season, week desc);

create table public.sunday_recaps (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season text not null check (season ~ '^[0-9]{4}$'),
  week integer not null check (week > 0),
  status text not null default 'draft' check (status in ('draft', 'generating', 'generated', 'sending', 'sent', 'failed')),
  factual_payload jsonb not null check (jsonb_typeof(factual_payload) = 'object'),
  narrative jsonb check (narrative is null or jsonb_typeof(narrative) = 'object'),
  model text check (model is null or char_length(model) <= 80),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sunday_recaps_league_week_key unique (league_id, season, week)
);

create index sunday_recaps_league_recent_idx
on public.sunday_recaps (league_id, season desc, week desc);

create table public.sunday_recap_deliveries (
  id uuid primary key default gen_random_uuid(),
  recap_id uuid not null references public.sunday_recaps(id) on delete cascade,
  league_member_id uuid not null references public.league_members(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sunday_recap_deliveries_recipient_key unique (recap_id, league_member_id)
);

create trigger league_recap_settings_set_updated_at before update on public.league_recap_settings
for each row execute function public.set_updated_at();
create trigger sunday_recaps_set_updated_at before update on public.sunday_recaps
for each row execute function public.set_updated_at();
create trigger sunday_recap_deliveries_set_updated_at before update on public.sunday_recap_deliveries
for each row execute function public.set_updated_at();

alter table public.league_recap_settings enable row level security;
alter table public.weekly_recap_snapshots enable row level security;
alter table public.sunday_recaps enable row level security;
alter table public.sunday_recap_deliveries enable row level security;

create policy "Commissioners can read recap settings"
on public.league_recap_settings for select to authenticated
using (private.is_league_commissioner(league_id));

create policy "League members can read weekly snapshots"
on public.weekly_recap_snapshots for select to authenticated
using (private.is_league_member(league_id));

create policy "Commissioners can read Sunday recaps"
on public.sunday_recaps for select to authenticated
using (private.is_league_commissioner(league_id));

create policy "Commissioners can read recap deliveries"
on public.sunday_recap_deliveries for select to authenticated
using (
  exists (
    select 1 from public.sunday_recaps recap
    where recap.id = recap_id and private.is_league_commissioner(recap.league_id)
  )
);

grant select on public.league_recap_settings, public.weekly_recap_snapshots,
  public.sunday_recaps, public.sunday_recap_deliveries to authenticated;
grant select on public.weekly_recap_snapshots to service_role;
grant select, insert, update, delete on public.league_recap_settings,
  public.sunday_recaps, public.sunday_recap_deliveries to service_role;

create function public.set_sunday_recap_enabled(target_league_id uuid, should_enable boolean)
returns public.league_recap_settings
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.league_recap_settings;
begin
  if not private.is_league_commissioner(target_league_id) then
    raise exception 'Only the league commissioner can change Sunday Recap settings.';
  end if;

  insert into public.league_recap_settings (league_id, enabled, updated_by)
  values (target_league_id, should_enable, auth.uid())
  on conflict (league_id) do update
  set enabled = excluded.enabled, updated_by = auth.uid(), updated_at = now()
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.set_sunday_recap_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_sunday_recap_enabled(uuid, boolean) to authenticated;

create function public.create_weekly_recap_snapshot(target_league_id uuid, target_week integer)
returns setof public.weekly_recap_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare league_season text;
begin
  if target_week < 1 then raise exception 'Recap week must be positive.'; end if;

  select league.season into league_season
  from public.leagues league where league.id = target_league_id;
  if league_season is null then raise exception 'League not found.'; end if;
  if not exists (select 1 from public.drafts draft where draft.league_id = target_league_id and draft.status = 'complete') then
    raise exception 'The league draft must be complete before a recap snapshot can be created.';
  end if;

  insert into public.weekly_recap_snapshots
    (league_id, season, week, league_member_id, total_points, standing_position, weekly_points, prior_position)
  with owned_teams as (
    select pick.league_member_id, pick.team_id
    from public.draft_picks pick
    join public.drafts draft on draft.id = pick.draft_id
    where draft.league_id = target_league_id and draft.status = 'complete'
  ), member_scores as (
    select member.id as league_member_id,
      coalesce(sum(event.points), 0)::integer as total_points,
      coalesce(sum(event.points) filter (where event.week = target_week), 0)::integer as weekly_points
    from public.league_members member
    left join owned_teams owned on owned.league_member_id = member.id
    left join public.scoring_events event on event.league_id = target_league_id
      and event.team_id = owned.team_id and event.voided_at is null
    where member.league_id = target_league_id
    group by member.id
  ), ranked as (
    select score.*, rank() over (order by score.total_points desc)::integer as standing_position
    from member_scores score
  ), prior as (
    select distinct on (snapshot.league_member_id)
      snapshot.league_member_id, snapshot.standing_position
    from public.weekly_recap_snapshots snapshot
    where snapshot.league_id = target_league_id and snapshot.season = league_season and snapshot.week < target_week
    order by snapshot.league_member_id, snapshot.week desc
  )
  select target_league_id, league_season, target_week, ranked.league_member_id,
    ranked.total_points, ranked.standing_position, ranked.weekly_points, prior.standing_position
  from ranked left join prior using (league_member_id)
  on conflict (league_id, season, week, league_member_id) do nothing;

  return query select snapshot.* from public.weekly_recap_snapshots snapshot
  where snapshot.league_id = target_league_id and snapshot.season = league_season and snapshot.week = target_week
  order by snapshot.standing_position, snapshot.league_member_id;
end;
$$;

revoke all on function public.create_weekly_recap_snapshot(uuid, integer) from public, anon, authenticated;
grant execute on function public.create_weekly_recap_snapshot(uuid, integer) to service_role;
