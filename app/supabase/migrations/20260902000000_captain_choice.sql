-- Captain's Choice layered onto authoritative weekly lineup entries.

alter table public.leagues
  add column captain_uses_per_team integer,
  add column captain_usage_policy text not null default 'optional',
  add column captain_enabled_from_week integer,
  add constraint leagues_captain_uses_check check (captain_uses_per_team is null or captain_uses_per_team > 0),
  add constraint leagues_captain_policy_check check (captain_usage_policy in ('optional', 'required')),
  add constraint leagues_captain_enabled_week_check check (captain_enabled_from_week is null or captain_enabled_from_week >= 0),
  add constraint leagues_captain_configuration_check check (
    (captain_uses_per_team is null and captain_enabled_from_week is null)
    or (captain_uses_per_team is not null and captain_enabled_from_week is not null)
  );

alter table public.weekly_lineup_entries
  add column is_captain boolean not null default false,
  add column captain_selected_at timestamptz,
  add column captain_locked_at timestamptz,
  add column captain_selection_source text,
  add constraint weekly_lineup_entries_captain_source_check
    check (captain_selection_source is null or captain_selection_source in ('owner', 'commissioner')),
  add constraint weekly_lineup_entries_captain_state_check check (
    (not is_captain and captain_selected_at is null and captain_locked_at is null and captain_selection_source is null)
    or (is_captain and status = 'starter' and game_id is not null and lock_at is not null
        and captain_selected_at is not null and captain_selection_source is not null)
  );

create unique index weekly_lineup_entries_one_captain_idx
  on public.weekly_lineup_entries (weekly_lineup_id) where is_captain;
create index weekly_lineup_entries_captain_usage_idx
  on public.weekly_lineup_entries (draft_pick_id, is_captain, captain_locked_at) where is_captain;

create table public.weekly_captain_changes (
  id uuid primary key default gen_random_uuid(),
  weekly_lineup_id uuid not null references public.weekly_lineups(id) on delete restrict,
  from_weekly_lineup_entry_id uuid references public.weekly_lineup_entries(id) on delete restrict,
  to_weekly_lineup_entry_id uuid references public.weekly_lineup_entries(id) on delete restrict,
  action text not null check (action in ('select', 'change', 'clear', 'lock', 'commissioner_correct', 'schedule_clear')),
  change_source text not null check (change_source in ('owner', 'commissioner', 'schedule', 'scoring')),
  reason text check (reason is null or char_length(trim(reason)) between 2 and 500),
  actor_id uuid references public.profiles(id) on delete set null,
  request_key uuid not null default gen_random_uuid(),
  kickoff_at_snapshot timestamptz,
  changed_at timestamptz not null default transaction_timestamp(),
  constraint weekly_captain_changes_has_entry check (
    from_weekly_lineup_entry_id is not null or to_weekly_lineup_entry_id is not null
  ),
  constraint weekly_captain_changes_commissioner_reason check (
    change_source <> 'commissioner' or char_length(trim(coalesce(reason, ''))) >= 2
  )
);

create index weekly_captain_changes_lineup_idx
  on public.weekly_captain_changes (weekly_lineup_id, changed_at desc);
create index weekly_captain_changes_from_entry_idx
  on public.weekly_captain_changes (from_weekly_lineup_entry_id, changed_at desc);
create index weekly_captain_changes_to_entry_idx
  on public.weekly_captain_changes (to_weekly_lineup_entry_id, changed_at desc);

alter table public.weekly_captain_changes enable row level security;
create policy "League members can view weekly captain audit"
on public.weekly_captain_changes for select to authenticated
using (exists (
  select 1 from public.weekly_lineups lineup
  where lineup.id = weekly_captain_changes.weekly_lineup_id
    and private.is_league_member(lineup.league_id)
));
revoke all on public.weekly_captain_changes from public, anon;
grant select on public.weekly_captain_changes to authenticated;

alter table public.scoring_events
  add column base_points integer,
  add column scoring_multiplier smallint not null default 1,
  add column captain_at_scoring boolean not null default false,
  add constraint scoring_events_multiplier_check check (scoring_multiplier in (1, 2));
update public.scoring_events set base_points = points where base_points is null;
alter table public.scoring_events alter column base_points set not null;
alter table public.scoring_events add constraint scoring_events_final_points_check
  check (points = base_points * scoring_multiplier);

create or replace function private.lock_due_captain(target_entry_id uuid, target_now timestamptz, target_source text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_entry public.weekly_lineup_entries;
begin
  select * into v_entry from public.weekly_lineup_entries where id = target_entry_id for update;
  if v_entry.id is null or not v_entry.is_captain or v_entry.lock_at is null or v_entry.lock_at > target_now then return false; end if;
  if v_entry.captain_locked_at is null then
    update public.weekly_lineup_entries
    set locked_at = coalesce(locked_at, target_now), captain_locked_at = target_now
    where id = v_entry.id;
    insert into public.weekly_captain_changes
      (weekly_lineup_id, from_weekly_lineup_entry_id, to_weekly_lineup_entry_id, action, change_source, actor_id, kickoff_at_snapshot)
    values (v_entry.weekly_lineup_id, v_entry.id, v_entry.id, 'lock', target_source, auth.uid(), v_entry.kickoff_at_snapshot);
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.set_weekly_lineup_captain(
  target_lineup_id uuid,
  target_entry_id uuid,
  target_request_key uuid
)
returns public.weekly_lineups language plpgsql security definer set search_path = '' as $$
declare
  v_lineup public.weekly_lineups;
  v_league public.leagues;
  v_current public.weekly_lineup_entries;
  v_target public.weekly_lineup_entries;
  v_now timestamptz;
  v_reserved integer;
begin
  select lineup.* into v_lineup from public.weekly_lineups lineup
  join public.league_members member on member.id = lineup.league_member_id
  where lineup.id = target_lineup_id and member.user_id = auth.uid()
  for update of lineup;
  if v_lineup.id is null then raise exception 'Lineup not found or access denied' using errcode = '42501'; end if;
  if target_request_key is null then raise exception 'Request key is required' using errcode = '22023'; end if;
  select * into v_league from public.leagues where id = v_lineup.league_id;
  if v_league.captain_uses_per_team is null or v_league.captain_enabled_from_week is null
     or v_lineup.week < v_league.captain_enabled_from_week then
    raise exception 'Captain is not active for this week' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();
  update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now)
  where weekly_lineup_id = v_lineup.id and lock_at <= v_now and locked_at is null;
  select * into v_current from public.weekly_lineup_entries
  where weekly_lineup_id = v_lineup.id and is_captain for update;
  if v_current.id is not null then perform private.lock_due_captain(v_current.id, v_now, 'owner'); end if;
  select * into v_current from public.weekly_lineup_entries
  where weekly_lineup_id = v_lineup.id and is_captain for update;

  if v_current.id is not null and v_current.captain_locked_at is not null
     and target_entry_id is distinct from v_current.id then return null; end if;
  if target_entry_id is not null then
    select * into v_target from public.weekly_lineup_entries
    where id = target_entry_id and weekly_lineup_id = v_lineup.id for update;
    if v_target.id is null or v_target.status <> 'starter' or v_target.game_id is null
       or v_target.lock_at is null or v_target.lock_at <= v_now or v_target.locked_at is not null then
      return null;
    end if;
  end if;
  if target_entry_id is not distinct from v_current.id then return v_lineup; end if;

  -- Serialize reservations for both the released and requested teams across all weeks.
  perform 1 from public.draft_picks
  where id in (v_current.draft_pick_id, v_target.draft_pick_id) order by id for update;
  if v_target.id is not null then
    select count(*) into v_reserved from public.weekly_lineup_entries entry
    join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where entry.draft_pick_id = v_target.draft_pick_id and entry.is_captain
      and lineup.season = v_lineup.season and entry.id <> v_target.id;
    if v_reserved >= v_league.captain_uses_per_team then
      raise exception 'This team has no Captain opportunities remaining' using errcode = '23514';
    end if;
  end if;

  if v_current.id is not null then
    update public.weekly_lineup_entries set is_captain = false, captain_selected_at = null,
      captain_locked_at = null, captain_selection_source = null where id = v_current.id;
  end if;
  if v_target.id is not null then
    update public.weekly_lineup_entries set is_captain = true, captain_selected_at = v_now,
      captain_selection_source = 'owner' where id = v_target.id;
  end if;
  insert into public.weekly_captain_changes
    (weekly_lineup_id, from_weekly_lineup_entry_id, to_weekly_lineup_entry_id, action, change_source,
     actor_id, request_key, kickoff_at_snapshot)
  values (v_lineup.id, v_current.id, v_target.id,
    case when v_current.id is null then 'select' when v_target.id is null then 'clear' else 'change' end,
    'owner', auth.uid(), target_request_key, coalesce(v_target.kickoff_at_snapshot, v_current.kickoff_at_snapshot));
  return v_lineup;
end;
$$;

create or replace function public.get_my_captain_usage(target_lineup_id uuid)
returns table (
  draft_pick_id uuid, team_id uuid, allowed integer, used bigint, reserved bigint, remaining bigint
) language sql security definer set search_path = '' stable as $$
  select pick.id, pick.team_id, league.captain_uses_per_team,
    count(entry.id) filter (where entry.is_captain and entry.captain_locked_at is not null),
    count(entry.id) filter (where entry.is_captain and entry.captain_locked_at is null),
    greatest(league.captain_uses_per_team - count(entry.id) filter (where entry.is_captain), 0)
  from public.weekly_lineups requested
  join public.league_members member on member.id = requested.league_member_id and member.user_id = auth.uid()
  join public.leagues league on league.id = requested.league_id
  join public.drafts draft on draft.league_id = league.id and draft.status = 'complete'
  join public.draft_picks pick on pick.draft_id = draft.id and pick.league_member_id = member.id
  left join public.weekly_lineup_entries entry on entry.draft_pick_id = pick.id
  left join public.weekly_lineups historical on historical.id = entry.weekly_lineup_id and historical.season = requested.season
  where requested.id = target_lineup_id and league.captain_uses_per_team is not null
    and (entry.id is null or historical.id is not null)
  group by pick.id, pick.team_id, league.captain_uses_per_team;
$$;

create or replace function public.set_weekly_lineup_starters(
  target_lineup_id uuid, target_starter_team_ids uuid[], target_request_key uuid
)
returns public.weekly_lineups language plpgsql security definer set search_path = '' as $$
declare
  v_lineup public.weekly_lineups; v_entry record; v_now timestamptz; v_locked_starters integer;
  v_captain public.weekly_lineup_entries;
begin
  select lineup.* into v_lineup from public.weekly_lineups lineup
  join public.league_members member on member.id = lineup.league_member_id
  where lineup.id = target_lineup_id and member.user_id = auth.uid() for update of lineup;
  if v_lineup.id is null then raise exception 'Lineup not found or access denied' using errcode = '42501'; end if;
  if target_request_key is null then raise exception 'Request key is required' using errcode = '22023'; end if;
  if cardinality(target_starter_team_ids) <> (select count(distinct value) from unnest(target_starter_team_ids) value) then
    raise exception 'Starter selection contains duplicates' using errcode = '22023'; end if;
  v_now := clock_timestamp();
  update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now)
  where weekly_lineup_id = v_lineup.id and lock_at <= v_now and locked_at is null;
  select * into v_captain from public.weekly_lineup_entries
  where weekly_lineup_id = v_lineup.id and is_captain for update;
  if v_captain.id is not null then perform private.lock_due_captain(v_captain.id, v_now, 'owner'); end if;
  select * into v_captain from public.weekly_lineup_entries
  where weekly_lineup_id = v_lineup.id and is_captain for update;
  if v_captain.id is not null and not (v_captain.team_id = any(target_starter_team_ids))
     and v_captain.captain_locked_at is not null then return null; end if;
  if exists (select 1 from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id and entry.locked_at is not null
    and ((entry.status = 'starter') is distinct from (entry.team_id = any(target_starter_team_ids)))) then return null; end if;
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
    raise exception 'Starter limit would be violated' using errcode = '23514'; end if;
  if v_captain.id is not null and not (v_captain.team_id = any(target_starter_team_ids)) then
    update public.weekly_lineup_entries set is_captain = false, captain_selected_at = null,
      captain_locked_at = null, captain_selection_source = null where id = v_captain.id;
    insert into public.weekly_captain_changes
      (weekly_lineup_id, from_weekly_lineup_entry_id, action, change_source, actor_id, request_key, kickoff_at_snapshot)
    values (v_lineup.id, v_captain.id, 'clear', 'owner', auth.uid(), target_request_key, v_captain.kickoff_at_snapshot);
  end if;
  for v_entry in select * from public.weekly_lineup_entries
    where weekly_lineup_id = v_lineup.id and locked_at is null and status <> 'no_game' for update
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

create or replace function private.apply_scoring_lineup_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_league public.leagues; v_game_id uuid; v_entry public.weekly_lineup_entries;
  v_member_id uuid; v_now timestamptz := clock_timestamp();
begin
  new.base_points := coalesce(new.base_points, new.points);
  new.scoring_multiplier := 1; new.captain_at_scoring := false; new.points := new.base_points;
  select * into v_league from public.leagues where id = new.league_id;
  if v_league.lineups_enabled_from_week is null or new.week is null or new.week < v_league.lineups_enabled_from_week then
    new.counts_for_standings := true; new.lineup_status_at_scoring := 'legacy'; return new; end if;
  select pick.league_member_id into v_member_id from public.drafts draft
  join public.draft_picks pick on pick.draft_id = draft.id
  where draft.league_id = new.league_id and draft.status = 'complete' and pick.team_id = new.team_id
  order by draft.completed_at desc nulls last limit 1;
  if v_member_id is null then new.counts_for_standings := false; new.lineup_status_at_scoring := null; return new; end if;
  if new.source_type = 'game' then
    begin v_game_id := new.source_identifier::uuid;
    exception when invalid_text_representation then raise exception 'Game scoring event has an invalid source identifier' using errcode = '22023'; end;
    select entry.* into v_entry from public.weekly_lineup_entries entry
    join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where lineup.league_id = new.league_id and lineup.league_member_id = v_member_id
      and lineup.season = new.season and lineup.week = new.week and entry.team_id = new.team_id and entry.game_id = v_game_id;
  else
    select entry.* into v_entry from public.weekly_lineup_entries entry
    join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where lineup.league_id = new.league_id and lineup.league_member_id = v_member_id
      and lineup.season = new.season and lineup.week = new.week and entry.team_id = new.team_id;
  end if;
  if v_entry.id is null then raise exception 'Authoritative weekly lineup entry is missing for drafted team scoring' using errcode = 'P0001'; end if;
  if v_entry.lock_at is not null and v_entry.lock_at > v_now then
    raise exception 'Lineup entry has not reached its authoritative kickoff lock' using errcode = 'P0001'; end if;
  update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now) where id = v_entry.id;
  if v_entry.is_captain then perform private.lock_due_captain(v_entry.id, v_now, 'scoring'); end if;
  select * into v_entry from public.weekly_lineup_entries where id = v_entry.id;
  new.league_member_id := v_member_id; new.weekly_lineup_entry_id := v_entry.id;
  new.lineup_status_at_scoring := v_entry.status; new.counts_for_standings := v_entry.status = 'starter';
  if new.source_type = 'game' and v_entry.status = 'starter' and v_entry.is_captain and v_entry.captain_locked_at is not null then
    new.scoring_multiplier := 2; new.captain_at_scoring := true; new.points := new.base_points * 2;
  end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'weekly_lineup_entry_id', v_entry.id, 'lineup_status', v_entry.status,
    'counts_for_standings', new.counts_for_standings, 'lineup_lock_at', v_entry.lock_at,
    'base_points', new.base_points, 'scoring_multiplier', new.scoring_multiplier,
    'captain_applied', new.captain_at_scoring, 'captain_locked_at', v_entry.captain_locked_at);
  return new;
end;
$$;

create or replace function private.reconcile_lineups_after_game_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_entry record; v_replacement uuid; v_now timestamptz := clock_timestamp();
begin
  if (old.start_at, old.status, old.week, old.season) is not distinct from (new.start_at, new.status, new.week, new.season) then return new; end if;
  for v_entry in select entry.*, lineup.week as lineup_week, lineup.season as lineup_season
    from public.weekly_lineup_entries entry join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where entry.game_id = old.id for update of entry
  loop
    if v_entry.locked_at is not null or (v_entry.lock_at is not null and v_entry.lock_at <= v_now) then
      update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now),
        captain_locked_at = case when is_captain then coalesce(captain_locked_at, v_now) else captain_locked_at end where id = v_entry.id;
      continue;
    end if;
    if new.status in ('canceled', 'postponed') or new.start_at is null or new.week <> v_entry.lineup_week or new.season <> v_entry.lineup_season then
      if v_entry.is_captain then
        insert into public.weekly_captain_changes (weekly_lineup_id, from_weekly_lineup_entry_id, action, change_source, reason, actor_id, kickoff_at_snapshot)
        values (v_entry.weekly_lineup_id, v_entry.id, 'schedule_clear', 'schedule',
          'Eligible game was canceled, postponed, or moved to another scoring week', auth.uid(), v_entry.kickoff_at_snapshot);
      end if;
      if v_entry.status <> 'no_game' then
        insert into public.weekly_lineup_changes (weekly_lineup_entry_id, from_status, to_status, change_source, reason, actor_id, kickoff_at_snapshot)
        values (v_entry.id, v_entry.status, 'no_game', 'schedule', 'Eligible game was canceled, postponed, or moved to another scoring week', auth.uid(), v_entry.kickoff_at_snapshot);
      end if;
      update public.weekly_lineup_entries set status = 'no_game', kickoff_at_snapshot = new.start_at, lock_at = null,
        is_captain = false, captain_selected_at = null, captain_locked_at = null, captain_selection_source = null where id = v_entry.id;
      if v_entry.status = 'starter' then
        select candidate.id into v_replacement from public.weekly_lineup_entries candidate
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
      update public.weekly_lineup_entries set kickoff_at_snapshot = new.start_at, lock_at = new.start_at,
        status = case when status = 'no_game' then 'bench' else status end where id = v_entry.id;
      if new.start_at <= v_now then
        update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now),
          captain_locked_at = case when is_captain then coalesce(captain_locked_at, v_now) else captain_locked_at end where id = v_entry.id;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.correct_weekly_lineup_captain(
  target_lineup_id uuid, target_entry_id uuid, target_reason text
)
returns public.weekly_lineups language plpgsql security definer set search_path = '' as $$
declare
  v_lineup public.weekly_lineups; v_league public.leagues; v_current public.weekly_lineup_entries;
  v_target public.weekly_lineup_entries; v_now timestamptz; v_reserved integer; v_game_id uuid;
begin
  if char_length(trim(coalesce(target_reason, ''))) < 2 then raise exception 'A correction reason is required' using errcode = '22023'; end if;
  select lineup.* into v_lineup from public.weekly_lineups lineup join public.leagues league on league.id = lineup.league_id
  where lineup.id = target_lineup_id and league.commissioner_id = auth.uid() for update of lineup;
  if v_lineup.id is null then raise exception 'Lineup not found or access denied' using errcode = '42501'; end if;
  select * into v_league from public.leagues where id = v_lineup.league_id;
  if v_league.captain_uses_per_team is null then raise exception 'Captain is not active' using errcode = 'P0001'; end if;
  select * into v_current from public.weekly_lineup_entries where weekly_lineup_id = v_lineup.id and is_captain for update;
  if target_entry_id is not null then
    select * into v_target from public.weekly_lineup_entries where id = target_entry_id and weekly_lineup_id = v_lineup.id for update;
    if v_target.id is null or v_target.status <> 'starter' or v_target.game_id is null or v_target.lock_at is null then
      raise exception 'Captain correction requires an eligible starter' using errcode = '23514'; end if;
  end if;
  if target_entry_id is not distinct from v_current.id then return v_lineup; end if;
  perform 1 from public.draft_picks where id in (v_current.draft_pick_id, v_target.draft_pick_id) order by id for update;
  if v_target.id is not null then
    select count(*) into v_reserved from public.weekly_lineup_entries entry join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
    where entry.draft_pick_id = v_target.draft_pick_id and entry.is_captain and lineup.season = v_lineup.season and entry.id <> v_target.id;
    if v_reserved >= v_league.captain_uses_per_team then raise exception 'This team has no Captain opportunities remaining' using errcode = '23514'; end if;
  end if;
  v_now := clock_timestamp();
  if v_current.id is not null then
    update public.weekly_lineup_entries set is_captain = false, captain_selected_at = null, captain_locked_at = null, captain_selection_source = null where id = v_current.id;
  end if;
  if v_target.id is not null then
    update public.weekly_lineup_entries set is_captain = true, captain_selected_at = v_now,
      captain_locked_at = case when v_target.lock_at <= v_now then v_now else null end,
      locked_at = case when v_target.lock_at <= v_now then coalesce(v_target.locked_at, v_now) else v_target.locked_at end,
      captain_selection_source = 'commissioner' where id = v_target.id;
  end if;
  insert into public.weekly_captain_changes
    (weekly_lineup_id, from_weekly_lineup_entry_id, to_weekly_lineup_entry_id, action, change_source, reason, actor_id, kickoff_at_snapshot)
  values (v_lineup.id, v_current.id, v_target.id, 'commissioner_correct', 'commissioner', trim(target_reason), auth.uid(), coalesce(v_target.kickoff_at_snapshot, v_current.kickoff_at_snapshot));
  for v_game_id in select distinct game_id from public.weekly_lineup_entries
    where id in (v_current.id, v_target.id) and game_id is not null
  loop
    update public.scoring_events set voided_at = coalesce(voided_at, v_now), voided_by = auth.uid(),
      void_reason = coalesce(void_reason, 'Captain history corrected by commissioner'),
      idempotency_key = case when voided_at is null then idempotency_key || ':void:' || id::text else idempotency_key end
    where source_type = 'game' and source_identifier = v_game_id::text and voided_at is null;
    update public.cfb_games set scoring_fingerprint = null where id = v_game_id;
  end loop;
  return v_lineup;
end;
$$;

-- A commissioner cannot bench a Captain through the generic lineup correction path.
-- Captain history must first be corrected with the dedicated audited RPC.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.correct_weekly_lineup_entry(uuid,text,text)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    'if v_entry.status = ''no_game'' then raise exception',
    'if target_status = ''bench'' and v_entry.is_captain then raise exception ''Correct Captain history before benching this entry'' using errcode = ''P0001''; end if; if v_entry.status = ''no_game'' then raise exception');
  if position('Correct Captain history before benching this entry' in v_definition) = 0 then
    raise exception 'Captain migration could not safely extend correct_weekly_lineup_entry';
  end if;
  execute v_definition;
end;
$migration$;

-- Captain state is part of game-scoring idempotency.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.process_cfb_game_scoring(uuid)'::regprocedure) into v_definition;
  v_definition := replace(v_definition,
    'coalesce(ranking_source, ''''), coalesce(winner_classification, ''''), coalesce(loser_classification, '''')))',
    'coalesce(ranking_source, ''''), coalesce(winner_classification, ''''), coalesce(loser_classification, ''''), ''captain-v1'', coalesce((select string_agg(entry.id::text || '':'' || entry.is_captain::text, '','' order by entry.team_id) from public.weekly_lineup_entries entry where entry.game_id = game.id), '''')))' );
  if position('captain-v1' in v_definition) = 0 then
    raise exception 'Captain migration could not safely extend process_cfb_game_scoring';
  end if;
  execute v_definition;
end;
$migration$;

revoke all on function private.lock_due_captain(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.set_weekly_lineup_captain(uuid, uuid, uuid) from public, anon;
revoke all on function public.get_my_captain_usage(uuid) from public, anon;
revoke all on function public.correct_weekly_lineup_captain(uuid, uuid, text) from public, anon;
grant execute on function public.set_weekly_lineup_captain(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_my_captain_usage(uuid) to authenticated;
grant execute on function public.correct_weekly_lineup_captain(uuid, uuid, text) to authenticated;
