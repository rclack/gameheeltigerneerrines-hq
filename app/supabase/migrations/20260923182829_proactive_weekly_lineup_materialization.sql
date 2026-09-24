-- Scheduled lineup preparation is a distinct, service-role-only stage after
-- schedule synchronization. Owner clients may read and mutate existing
-- authority, but they no longer create it as a page-load side effect.

create function public.scheduled_materialize_weekly_lineups(
  target_league_id uuid,
  target_week integer
)
returns setof public.weekly_lineups
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bind_scheduled_cfbd_commissioner(target_league_id);
  return query
    select * from public.materialize_weekly_lineup(target_league_id, target_week, null);
end;
$$;

create function public.get_scheduled_weekly_lineup_readiness(
  target_league_id uuid,
  target_week integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.bind_scheduled_cfbd_commissioner(target_league_id);

  with league_context as (
    select league.id, league.season, league.teams_per_owner, league.starters_per_week
    from public.leagues league
    where league.id = target_league_id
  ),
  draft_context as (
    select draft.id, true as is_complete
    from public.drafts draft
    join league_context league on league.id = draft.league_id
    where draft.status = 'complete'
    order by draft.completed_at desc nulls last
    limit 1
  ),
  owners as (
    select member.id
    from public.league_members member
    where member.league_id = target_league_id
  ),
  owner_state as (
    select owner.id as member_id,
      lineup.id as lineup_id,
      count(entry.id)::integer as entry_count,
      count(entry.id) filter (where entry.status = 'starter')::integer as starter_count,
      count(distinct entry.draft_pick_id)::integer as distinct_pick_count,
      count(*) filter (
        where entry.id is not null and (
          pick.id is null
          or pick.league_member_id <> owner.id
          or pick.draft_id <> draft.id
          or pick.team_id <> entry.team_id
        )
      )::integer as foreign_entry_count,
      count(*) filter (
        where entry.id is not null and (
          (entry.status = 'no_game' and entry.game_id is not null)
          or (entry.status <> 'no_game' and (
            game.id is null
            or game.league_id <> target_league_id
            or game.season <> league.season
            or game.week <> target_week
            or entry.team_id not in (game.home_team_id, game.away_team_id)
          ))
        )
      )::integer as invalid_schedule_reference_count
    from owners owner
    cross join league_context league
    left join draft_context draft on true
    left join public.weekly_lineups lineup
      on lineup.league_id = target_league_id
      and lineup.league_member_id = owner.id
      and lineup.season = league.season
      and lineup.week = target_week
    left join public.weekly_lineup_entries entry on entry.weekly_lineup_id = lineup.id
    left join public.draft_picks pick on pick.id = entry.draft_pick_id
    left join public.cfb_games game on game.id = entry.game_id
    group by owner.id, lineup.id
  ),
  duplicate_entries as (
    select lineup.league_member_id, sum(duplicate.duplicate_count)::integer as duplicate_count
    from (
      select entry.weekly_lineup_id, entry.draft_pick_id, count(*)::integer as duplicate_count
      from public.weekly_lineup_entries entry
      group by entry.weekly_lineup_id, entry.draft_pick_id
      having count(*) > 1
    ) duplicate
    join public.weekly_lineups lineup on lineup.id = duplicate.weekly_lineup_id
    where lineup.league_id = target_league_id
      and lineup.season = (select season from league_context)
      and lineup.week = target_week
    group by lineup.league_member_id
  ),
  issues as (
    select state.member_id,
      case
        when not exists (select 1 from league_context) then 'league_not_found'
        when not exists (select 1 from draft_context) then 'complete_draft_missing'
        when state.lineup_id is null then 'missing_lineup'
        when state.entry_count <> league.teams_per_owner then 'missing_entries'
        when state.distinct_pick_count <> state.entry_count
          or coalesce(duplicate.duplicate_count, 0) > 0 then 'duplicate_draft_pick'
        when state.foreign_entry_count > 0 then 'foreign_draft_pick'
        when state.invalid_schedule_reference_count > 0 then 'invalid_schedule_reference'
        when state.starter_count > league.starters_per_week then 'starter_limit_exceeded'
        else null
      end as issue
    from owner_state state
    cross join league_context league
    left join duplicate_entries duplicate on duplicate.league_member_id = state.member_id
  )
  select jsonb_build_object(
    'league_id', target_league_id,
    'week', target_week,
    'ready', not exists (select 1 from issues where issue is not null),
    'expected_owners', (select count(*) from owners),
    'current_owners', (select count(*) from issues where issue is null),
    'missing_owner_ids', coalesce((select jsonb_agg(member_id order by member_id) from issues where issue = 'missing_lineup'), '[]'::jsonb),
    'failures', coalesce((select jsonb_agg(jsonb_build_object('member_id', member_id, 'category', issue) order by member_id) from issues where issue is not null), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create function public.record_scheduled_weekly_lineup_preparation(
  target_sync_run_id uuid,
  target_summary jsonb
)
returns public.external_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_league_id uuid;
  updated_run public.external_sync_runs;
begin
  select sync_run.league_id into target_league_id
  from public.external_sync_runs sync_run
  where sync_run.id = target_sync_run_id;
  if target_league_id is null then
    raise exception 'Sync run not found' using errcode = 'P0002';
  end if;
  perform private.bind_scheduled_cfbd_commissioner(target_league_id);
  update public.external_sync_runs sync_run
  set summary = coalesce(sync_run.summary, '{}'::jsonb)
    || jsonb_build_object('weekly_lineup_preparation', coalesce(target_summary, '{}'::jsonb))
  where sync_run.id = target_sync_run_id
  returning sync_run.* into updated_run;
  return updated_run;
end;
$$;

revoke all on function public.materialize_weekly_lineup(uuid, integer, uuid) from authenticated;
revoke all on function public.scheduled_materialize_weekly_lineups(uuid, integer) from public, anon, authenticated;
revoke all on function public.get_scheduled_weekly_lineup_readiness(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_scheduled_weekly_lineup_preparation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.materialize_weekly_lineup(uuid, integer, uuid) to service_role;
grant execute on function public.scheduled_materialize_weekly_lineups(uuid, integer) to service_role;
grant execute on function public.get_scheduled_weekly_lineup_readiness(uuid, integer) to service_role;
grant execute on function public.record_scheduled_weekly_lineup_preparation(uuid, jsonb) to service_role;
