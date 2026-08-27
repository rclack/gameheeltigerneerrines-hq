-- Authoritative weekly Start/Bench lineups with per-game kickoff locks.

alter table public.leagues
  add column starters_per_week integer,
  add column lineups_enabled_from_week integer,
  add constraint leagues_starters_per_week_check
    check (starters_per_week is null or starters_per_week between 1 and teams_per_owner),
  add constraint leagues_lineups_enabled_from_week_check
    check (lineups_enabled_from_week is null or lineups_enabled_from_week > 0);

create table public.weekly_lineups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  league_member_id uuid not null references public.league_members(id) on delete cascade,
  season text not null check (season ~ '^[0-9]{4}$'),
  week integer not null check (week > 0),
  starters_limit_snapshot integer not null check (starters_limit_snapshot > 0),
  materialization_version integer not null default 1 check (materialization_version > 0),
  materialized_at timestamptz not null default transaction_timestamp(),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  unique (league_id, league_member_id, season, week)
);

create table public.weekly_lineup_entries (
  id uuid primary key default gen_random_uuid(),
  weekly_lineup_id uuid not null references public.weekly_lineups(id) on delete cascade,
  draft_pick_id uuid not null references public.draft_picks(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  game_id uuid references public.cfb_games(id) on delete restrict,
  status text not null check (status in ('starter', 'bench', 'no_game')),
  selection_source text not null check (selection_source in ('week1_auto', 'carry_forward', 'bye_replacement', 'owner', 'commissioner')),
  kickoff_at_snapshot timestamptz,
  lock_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint weekly_lineup_entries_game_consistency check (
    (status = 'no_game' and lock_at is null)
    or (status in ('starter', 'bench') and game_id is not null and kickoff_at_snapshot is not null and lock_at is not null)
  ),
  unique (weekly_lineup_id, team_id),
  unique (weekly_lineup_id, game_id, team_id)
);

create table public.weekly_lineup_changes (
  id uuid primary key default gen_random_uuid(),
  weekly_lineup_entry_id uuid not null references public.weekly_lineup_entries(id) on delete restrict,
  from_status text check (from_status is null or from_status in ('starter', 'bench', 'no_game')),
  to_status text not null check (to_status in ('starter', 'bench', 'no_game')),
  change_source text not null check (change_source in ('materialization', 'schedule', 'owner', 'commissioner')),
  reason text check (reason is null or char_length(trim(reason)) between 2 and 500),
  actor_id uuid references public.profiles(id) on delete set null,
  request_key uuid not null default gen_random_uuid(),
  kickoff_at_snapshot timestamptz,
  changed_at timestamptz not null default transaction_timestamp()
);

create index weekly_lineups_member_week_idx on public.weekly_lineups (league_member_id, season, week);
create index weekly_lineup_entries_game_idx on public.weekly_lineup_entries (game_id, team_id);
create index weekly_lineup_entries_lock_idx on public.weekly_lineup_entries (lock_at) where locked_at is null;
create index weekly_lineup_changes_entry_idx on public.weekly_lineup_changes (weekly_lineup_entry_id, changed_at desc);

create trigger weekly_lineups_set_updated_at before update on public.weekly_lineups
for each row execute function public.set_updated_at();
create trigger weekly_lineup_entries_set_updated_at before update on public.weekly_lineup_entries
for each row execute function public.set_updated_at();

alter table public.weekly_lineups enable row level security;
alter table public.weekly_lineup_entries enable row level security;
alter table public.weekly_lineup_changes enable row level security;

create policy "League members can view weekly lineups"
on public.weekly_lineups for select to authenticated
using (private.is_league_member(league_id));

create policy "League members can view weekly lineup entries"
on public.weekly_lineup_entries for select to authenticated
using (exists (
  select 1 from public.weekly_lineups lineup
  where lineup.id = weekly_lineup_entries.weekly_lineup_id
    and private.is_league_member(lineup.league_id)
));

create policy "League members can view weekly lineup audit"
on public.weekly_lineup_changes for select to authenticated
using (exists (
  select 1 from public.weekly_lineup_entries entry
  join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
  where entry.id = weekly_lineup_changes.weekly_lineup_entry_id
    and private.is_league_member(lineup.league_id)
));

revoke all on public.weekly_lineups, public.weekly_lineup_entries, public.weekly_lineup_changes from public, anon;
grant select on public.weekly_lineups, public.weekly_lineup_entries, public.weekly_lineup_changes to authenticated;

alter table public.scoring_events
  add column league_member_id uuid references public.league_members(id) on delete restrict,
  add column weekly_lineup_entry_id uuid references public.weekly_lineup_entries(id) on delete restrict,
  add column lineup_status_at_scoring text check (lineup_status_at_scoring is null or lineup_status_at_scoring in ('starter', 'bench', 'no_game', 'legacy')),
  add column counts_for_standings boolean not null default true;

create index scoring_events_counting_idx
on public.scoring_events (league_id, season, week, league_member_id)
where voided_at is null and counts_for_standings;

create function private.apply_scoring_lineup_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_game_id uuid;
  v_entry public.weekly_lineup_entries;
  v_member_id uuid;
begin
  select * into v_league from public.leagues where id = new.league_id;
  if v_league.lineups_enabled_from_week is null or new.week is null
     or new.week < v_league.lineups_enabled_from_week then
    new.counts_for_standings := true;
    new.lineup_status_at_scoring := 'legacy';
    return new;
  end if;

  select pick.league_member_id into v_member_id
  from public.drafts draft
  join public.draft_picks pick on pick.draft_id = draft.id
  where draft.league_id = new.league_id and draft.status = 'complete' and pick.team_id = new.team_id
  order by draft.completed_at desc nulls last limit 1;

  -- Opponents which are not owned still retain factual events but cannot affect standings.
  if v_member_id is null then
    new.counts_for_standings := false;
    new.lineup_status_at_scoring := null;
    return new;
  end if;

  if new.source_type = 'game' then
    begin v_game_id := new.source_identifier::uuid;
    exception when invalid_text_representation then
      raise exception 'Game scoring event has an invalid source identifier' using errcode = '22023';
    end;
    select entry.* into v_entry
    from public.weekly_lineup_entries entry
    join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where lineup.league_id = new.league_id and lineup.league_member_id = v_member_id
      and lineup.season = new.season and lineup.week = new.week
      and entry.team_id = new.team_id and entry.game_id = v_game_id;
  else
    select entry.* into v_entry
    from public.weekly_lineup_entries entry
    join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where lineup.league_id = new.league_id and lineup.league_member_id = v_member_id
      and lineup.season = new.season and lineup.week = new.week and entry.team_id = new.team_id;
  end if;

  if v_entry.id is null then
    raise exception 'Authoritative weekly lineup entry is missing for drafted team scoring' using errcode = 'P0001';
  end if;
  if v_entry.lock_at is not null and v_entry.lock_at > transaction_timestamp() then
    raise exception 'Lineup entry has not reached its authoritative kickoff lock' using errcode = 'P0001';
  end if;

  update public.weekly_lineup_entries
  set locked_at = coalesce(locked_at, transaction_timestamp()) where id = v_entry.id;
  new.league_member_id := v_member_id;
  new.weekly_lineup_entry_id := v_entry.id;
  new.lineup_status_at_scoring := v_entry.status;
  new.counts_for_standings := v_entry.status = 'starter';
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'weekly_lineup_entry_id', v_entry.id,
    'lineup_status', v_entry.status,
    'counts_for_standings', v_entry.status = 'starter',
    'lineup_lock_at', v_entry.lock_at
  );
  return new;
end;
$$;

create trigger scoring_events_apply_lineup_eligibility
before insert on public.scoring_events
for each row execute function private.apply_scoring_lineup_eligibility();

create function private.reconcile_lineups_after_game_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_replacement uuid;
  v_now timestamptz := transaction_timestamp();
begin
  if (old.start_at, old.status, old.week, old.season) is not distinct from
     (new.start_at, new.status, new.week, new.season) then return new; end if;

  for v_entry in
    select entry.*, lineup.week as lineup_week, lineup.season as lineup_season
    from public.weekly_lineup_entries entry
    join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where entry.game_id = old.id for update of entry
  loop
    -- Never reopen or rewrite a team once its previously authoritative cutoff passed.
    if v_entry.locked_at is not null or (v_entry.lock_at is not null and v_entry.lock_at <= v_now) then
      update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now) where id = v_entry.id;
      continue;
    end if;

    if new.status in ('canceled', 'postponed') or new.start_at is null
       or new.week <> v_entry.lineup_week or new.season <> v_entry.lineup_season then
      if v_entry.status <> 'no_game' then
        insert into public.weekly_lineup_changes (weekly_lineup_entry_id, from_status, to_status, change_source, reason, actor_id, kickoff_at_snapshot)
        values (v_entry.id, v_entry.status, 'no_game', 'schedule', 'Eligible game was canceled, postponed, or moved to another scoring week', auth.uid(), v_entry.kickoff_at_snapshot);
      end if;
      update public.weekly_lineup_entries set status = 'no_game', kickoff_at_snapshot = new.start_at, lock_at = null where id = v_entry.id;
      if v_entry.status = 'starter' then
        select candidate.id into v_replacement
        from public.weekly_lineup_entries candidate
        where candidate.weekly_lineup_id = v_entry.weekly_lineup_id and candidate.status = 'bench'
          and candidate.locked_at is null and candidate.lock_at > v_now
        order by candidate.lock_at, candidate.game_id, candidate.team_id limit 1 for update;
        if v_replacement is not null then
          insert into public.weekly_lineup_changes (weekly_lineup_entry_id, from_status, to_status, change_source, reason, actor_id, kickoff_at_snapshot)
          select id, status, 'starter', 'schedule', 'Earliest-kickoff replacement for an unavailable starter', auth.uid(), kickoff_at_snapshot
          from public.weekly_lineup_entries where id = v_replacement;
          update public.weekly_lineup_entries set status = 'starter', selection_source = 'bye_replacement' where id = v_replacement;
        end if;
      end if;
    else
      update public.weekly_lineup_entries
      set kickoff_at_snapshot = new.start_at, lock_at = new.start_at,
          status = case when status = 'no_game' then 'bench' else status end
      where id = v_entry.id;
    end if;
  end loop;
  return new;
end;
$$;

create trigger cfb_games_reconcile_weekly_lineups
after update of start_at, status, week, season on public.cfb_games
for each row execute function private.reconcile_lineups_after_game_change();

create or replace function public.materialize_weekly_lineup(
  target_league_id uuid,
  target_week integer,
  target_member_id uuid default null
)
returns setof public.weekly_lineups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_draft public.drafts;
  v_member public.league_members;
  v_lineup public.weekly_lineups;
  v_pick record;
  v_game record;
  v_prior_starters uuid[];
  v_starter_count integer;
  v_source text;
begin
  if target_week is null or target_week < 1 then
    raise exception 'Week must be positive' using errcode = '22023';
  end if;

  select * into v_league from public.leagues where id = target_league_id;
  if v_league.id is null or not private.is_league_member(v_league.id) then
    raise exception 'League not found or access denied' using errcode = '42501';
  end if;
  if v_league.starters_per_week is null or v_league.lineups_enabled_from_week is null
     or target_week < v_league.lineups_enabled_from_week then
    raise exception 'Weekly lineups are not active for this week' using errcode = 'P0001';
  end if;

  select * into v_draft from public.drafts where league_id = v_league.id and status = 'complete';
  if v_draft.id is null then raise exception 'Draft must be complete before lineups can be materialized' using errcode = 'P0001'; end if;

  for v_member in
    select member.* from public.league_members member
    where member.league_id = v_league.id and (target_member_id is null or member.id = target_member_id)
    order by member.id
  loop
    if (select count(*) from public.draft_picks pick where pick.draft_id = v_draft.id and pick.league_member_id = v_member.id) <> v_league.teams_per_owner then
      raise exception 'Every owner must have a complete roster before lineup materialization' using errcode = 'P0001';
    end if;

    insert into public.weekly_lineups (league_id, league_member_id, season, week, starters_limit_snapshot)
    values (v_league.id, v_member.id, v_league.season, target_week, v_league.starters_per_week)
    on conflict (league_id, league_member_id, season, week) do nothing;

    select * into v_lineup from public.weekly_lineups
    where league_id = v_league.id and league_member_id = v_member.id and season = v_league.season and week = target_week
    for update;

    if exists (select 1 from public.weekly_lineup_entries where weekly_lineup_id = v_lineup.id) then
      return next v_lineup;
      continue;
    end if;

    if target_week > 1 then
      select coalesce(array_agg(entry.team_id order by entry.team_id), '{}'::uuid[]) into v_prior_starters
      from public.weekly_lineup_entries entry
      join public.weekly_lineups prior on prior.id = entry.weekly_lineup_id
      where prior.league_id = v_league.id and prior.league_member_id = v_member.id
        and prior.season = v_league.season and prior.week = target_week - 1 and entry.status = 'starter';
    else
      v_prior_starters := '{}'::uuid[];
    end if;
    v_starter_count := 0;

    for v_pick in
      select pick.*, (pick.team_id = any(v_prior_starters)) as was_starter
      from public.draft_picks pick
      where pick.draft_id = v_draft.id and pick.league_member_id = v_member.id
      order by (pick.team_id = any(v_prior_starters)) desc, pick.overall_pick, pick.team_id
    loop
      select game.id, game.start_at into v_game
      from public.cfb_games game
      where game.league_id = v_league.id and game.season = v_league.season and game.week = target_week
        and game.status not in ('canceled', 'postponed') and game.start_at is not null
        and (game.home_team_id = v_pick.team_id or game.away_team_id = v_pick.team_id)
      order by game.start_at, coalesce(game.external_id, game.id::text), game.id
      limit 2;

      if (select count(*) from public.cfb_games game where game.league_id = v_league.id and game.season = v_league.season
          and game.week = target_week and game.status not in ('canceled', 'postponed') and game.start_at is not null
          and (game.home_team_id = v_pick.team_id or game.away_team_id = v_pick.team_id)) > 1 then
        raise exception 'Owned team has multiple eligible games in the same week' using errcode = 'P0001';
      end if;

      if v_game.id is null then
        insert into public.weekly_lineup_entries (weekly_lineup_id, draft_pick_id, team_id, status, selection_source)
        values (v_lineup.id, v_pick.id, v_pick.team_id, 'no_game', case when target_week = 1 then 'week1_auto' else 'bye_replacement' end)
        returning * into v_game;
      else
        if v_starter_count < v_league.starters_per_week then
          v_starter_count := v_starter_count + 1;
          v_source := case when target_week = 1 then 'week1_auto' when v_pick.was_starter then 'carry_forward' else 'bye_replacement' end;
        else
          v_source := case when target_week = 1 then 'week1_auto' when v_pick.was_starter then 'carry_forward' else 'bye_replacement' end;
        end if;
        insert into public.weekly_lineup_entries
          (weekly_lineup_id, draft_pick_id, team_id, game_id, status, selection_source, kickoff_at_snapshot, lock_at)
        values (v_lineup.id, v_pick.id, v_pick.team_id, v_game.id,
          case when v_starter_count <= v_league.starters_per_week and
            (v_starter_count > 0 and not exists (select 1 from public.weekly_lineup_entries e where e.weekly_lineup_id = v_lineup.id and e.team_id = v_pick.team_id))
            then case when (select count(*) from public.weekly_lineup_entries e where e.weekly_lineup_id = v_lineup.id and e.status = 'starter') < v_league.starters_per_week then 'starter' else 'bench' end
            else 'bench' end,
          v_source, v_game.start_at, v_game.start_at);
      end if;
    end loop;

    -- Deterministically repair the initial selection: prior eligible starters first, then earliest kickoff.
    with ranked as (
      select entry.id, row_number() over (
        order by (entry.team_id = any(v_prior_starters)) desc, entry.lock_at, coalesce(game.external_id, game.id::text), entry.team_id
      ) as position
      from public.weekly_lineup_entries entry
      left join public.cfb_games game on game.id = entry.game_id
      where entry.weekly_lineup_id = v_lineup.id and entry.status <> 'no_game'
    )
    update public.weekly_lineup_entries entry
    set status = case when ranked.position <= v_league.starters_per_week then 'starter' else 'bench' end,
        selection_source = case when target_week = 1 then 'week1_auto'
          when entry.team_id = any(v_prior_starters) then 'carry_forward' else 'bye_replacement' end
    from ranked where ranked.id = entry.id;

    insert into public.weekly_lineup_changes
      (weekly_lineup_entry_id, from_status, to_status, change_source, actor_id, kickoff_at_snapshot)
    select entry.id, null, entry.status, 'materialization', auth.uid(), entry.kickoff_at_snapshot
    from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id;
    return next v_lineup;
  end loop;
end;
$$;

create or replace function public.set_weekly_lineup_starters(
  target_lineup_id uuid,
  target_starter_team_ids uuid[],
  target_request_key uuid
)
returns public.weekly_lineups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineup public.weekly_lineups;
  v_entry record;
  v_now timestamptz := transaction_timestamp();
  v_locked_starters integer;
begin
  select lineup.* into v_lineup from public.weekly_lineups lineup
  join public.league_members member on member.id = lineup.league_member_id
  where lineup.id = target_lineup_id and member.user_id = auth.uid()
  for update of lineup;
  if v_lineup.id is null then raise exception 'Lineup not found or access denied' using errcode = '42501'; end if;
  if target_request_key is null then raise exception 'Request key is required' using errcode = '22023'; end if;
  if cardinality(target_starter_team_ids) <> (select count(distinct value) from unnest(target_starter_team_ids) value) then
    raise exception 'Starter selection contains duplicates' using errcode = '22023';
  end if;

  update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now)
  where weekly_lineup_id = v_lineup.id and lock_at <= v_now and locked_at is null;

  if exists (
    select 1 from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id and entry.locked_at is not null
      and ((entry.status = 'starter') is distinct from (entry.team_id = any(target_starter_team_ids)))
  ) then raise exception 'A requested team has already locked' using errcode = 'P0001'; end if;

  if exists (select 1 from unnest(target_starter_team_ids) team_id where not exists (
    select 1 from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id
      and entry.team_id = team_id and entry.status <> 'no_game' and entry.locked_at is null
  ) and not exists (
    select 1 from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id
      and entry.team_id = team_id and entry.status = 'starter' and entry.locked_at is not null
  )) then raise exception 'Starter is not eligible or owned' using errcode = '22023'; end if;

  select count(*) into v_locked_starters from public.weekly_lineup_entries
  where weekly_lineup_id = v_lineup.id and locked_at is not null and status = 'starter';
  if cardinality(target_starter_team_ids) > v_lineup.starters_limit_snapshot
     or cardinality(target_starter_team_ids) < v_locked_starters then
    raise exception 'Starter limit would be violated' using errcode = '23514';
  end if;

  for v_entry in select * from public.weekly_lineup_entries where weekly_lineup_id = v_lineup.id and locked_at is null and status <> 'no_game' for update
  loop
    if v_entry.status is distinct from (case when v_entry.team_id = any(target_starter_team_ids) then 'starter' else 'bench' end) then
      insert into public.weekly_lineup_changes (weekly_lineup_entry_id, from_status, to_status, change_source, actor_id, request_key, kickoff_at_snapshot)
      values (v_entry.id, v_entry.status, case when v_entry.team_id = any(target_starter_team_ids) then 'starter' else 'bench' end,
        'owner', auth.uid(), target_request_key, v_entry.kickoff_at_snapshot);
      update public.weekly_lineup_entries set status = case when team_id = any(target_starter_team_ids) then 'starter' else 'bench' end,
        selection_source = 'owner' where id = v_entry.id;
    end if;
  end loop;
  return v_lineup;
end;
$$;

create or replace function public.correct_weekly_lineup_entry(
  target_entry_id uuid,
  target_status text,
  target_reason text
)
returns public.weekly_lineup_entries
language plpgsql
security definer
set search_path = ''
as $$
declare v_entry public.weekly_lineup_entries; v_before text; v_limit integer;
begin
  if target_status not in ('starter', 'bench') or char_length(trim(coalesce(target_reason, ''))) < 2 then
    raise exception 'A valid status and correction reason are required' using errcode = '22023';
  end if;
  select entry.* into v_entry from public.weekly_lineup_entries entry
  join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
  join public.leagues league on league.id = lineup.league_id
  where entry.id = target_entry_id and league.commissioner_id = auth.uid()
  for update of entry;
  if v_entry.id is null then raise exception 'Lineup entry not found or access denied' using errcode = '42501'; end if;
  if v_entry.status = 'no_game' then raise exception 'A no-game entry cannot be corrected into the lineup' using errcode = 'P0001'; end if;
  select starters_limit_snapshot into v_limit from public.weekly_lineups where id = v_entry.weekly_lineup_id for update;
  if target_status = 'starter' and v_entry.status <> 'starter' and
     (select count(*) from public.weekly_lineup_entries where weekly_lineup_id = v_entry.weekly_lineup_id and status = 'starter') >= v_limit then
    raise exception 'Bench another team before adding a starter' using errcode = '23514';
  end if;
  v_before := v_entry.status;
  update public.weekly_lineup_entries set status = target_status, selection_source = 'commissioner', locked_at = coalesce(locked_at, transaction_timestamp())
  where id = v_entry.id returning * into v_entry;
  insert into public.weekly_lineup_changes (weekly_lineup_entry_id, from_status, to_status, change_source, reason, actor_id, kickoff_at_snapshot)
  values (v_entry.id, v_before, target_status, 'commissioner', trim(target_reason), auth.uid(), v_entry.kickoff_at_snapshot);
  update public.scoring_events
  set voided_at = coalesce(voided_at, transaction_timestamp()),
      voided_by = auth.uid(),
      void_reason = coalesce(void_reason, 'Lineup eligibility corrected by commissioner'),
      idempotency_key = case when voided_at is null then idempotency_key || ':void:' || id::text else idempotency_key end
  where source_type = 'game' and source_identifier = v_entry.game_id::text and voided_at is null;
  update public.cfb_games set scoring_fingerprint = null where id = v_entry.game_id;
  return v_entry;
end;
$$;

revoke all on function public.materialize_weekly_lineup(uuid, integer, uuid) from public, anon;
revoke all on function public.set_weekly_lineup_starters(uuid, uuid[], uuid) from public, anon;
revoke all on function public.correct_weekly_lineup_entry(uuid, text, text) from public, anon;
grant execute on function public.materialize_weekly_lineup(uuid, integer, uuid) to authenticated;
grant execute on function public.set_weekly_lineup_starters(uuid, uuid[], uuid) to authenticated;
grant execute on function public.correct_weekly_lineup_entry(uuid, text, text) to authenticated;

-- Preserve legacy behavior until each league crosses its explicit activation boundary.
update public.scoring_events set lineup_status_at_scoring = 'legacy' where lineup_status_at_scoring is null;

-- Recap snapshots are official standings artifacts and must exclude bench facts.
create or replace function public.create_weekly_recap_snapshot(target_league_id uuid, target_week integer)
returns setof public.weekly_recap_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare league_season text;
begin
  if target_week < 1 then raise exception 'Recap week must be positive.'; end if;
  select league.season into league_season from public.leagues league where league.id = target_league_id;
  if league_season is null then raise exception 'League not found.'; end if;
  if not exists (select 1 from public.drafts draft where draft.league_id = target_league_id and draft.status = 'complete') then
    raise exception 'The league draft must be complete before a recap snapshot can be created.';
  end if;

  insert into public.weekly_recap_snapshots
    (league_id, season, week, league_member_id, total_points, standing_position, weekly_points, prior_position)
  with owned_teams as (
    select pick.league_member_id, pick.team_id from public.draft_picks pick
    join public.drafts draft on draft.id = pick.draft_id
    where draft.league_id = target_league_id and draft.status = 'complete'
  ), member_scores as (
    select member.id as league_member_id,
      coalesce(sum(event.points), 0)::integer as total_points,
      coalesce(sum(event.points) filter (where event.week = target_week), 0)::integer as weekly_points
    from public.league_members member
    left join owned_teams owned on owned.league_member_id = member.id
    left join public.scoring_events event on event.league_id = target_league_id
      and event.team_id = owned.team_id and event.voided_at is null and event.counts_for_standings
    where member.league_id = target_league_id group by member.id
  ), ranked as (
    select score.*, rank() over (order by score.total_points desc)::integer as standing_position from member_scores score
  ), prior as (
    select distinct on (snapshot.league_member_id) snapshot.league_member_id, snapshot.standing_position
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
