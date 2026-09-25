-- Keep historical recap standings bounded to the requested season/week and
-- allow an unsent preview to be refreshed after authoritative scoring changes.
create or replace function public.create_weekly_recap_snapshot(target_league_id uuid, target_week integer)
returns setof public.weekly_recap_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare
  league_season text;
  target_week_end date;
begin
  if target_week < 0 then raise exception 'Recap week cannot be negative.'; end if;

  select league.season into league_season
  from public.leagues league
  where league.id = target_league_id;

  if league_season is null then raise exception 'League not found.'; end if;
  if not exists (
    select 1 from public.drafts draft
    where draft.league_id = target_league_id and draft.status = 'complete'
  ) then
    raise exception 'The league draft must be complete before a recap snapshot can be created.';
  end if;

  select max(game.game_date) into target_week_end
  from public.cfb_games game
  where game.league_id = target_league_id
    and game.season = league_season
    and game.week = target_week;

  if target_week_end is null then raise exception 'The requested recap week has no synchronized games.'; end if;

  -- Sent recaps are immutable delivery records. Corrections require an explicit
  -- later workflow rather than silently changing a delivered recap's facts.
  if exists (
    select 1 from public.sunday_recaps recap
    where recap.league_id = target_league_id
      and recap.season = league_season
      and recap.week = target_week
      and recap.status = 'sent'
  ) then
    return query
      select snapshot.*
      from public.weekly_recap_snapshots snapshot
      where snapshot.league_id = target_league_id
        and snapshot.season = league_season
        and snapshot.week = target_week
      order by snapshot.standing_position, snapshot.league_member_id;
    return;
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
      and event.team_id = owned.team_id
      and event.season = league_season
      and event.voided_at is null
      and event.counts_for_standings
      and (
        (event.week is not null and event.week between 0 and target_week)
        or (event.week is null and event.event_date <= target_week_end)
      )
    where member.league_id = target_league_id
    group by member.id
  ), ranked as (
    select score.*, rank() over (order by score.total_points desc)::integer as standing_position
    from member_scores score
  ), prior as (
    select distinct on (snapshot.league_member_id)
      snapshot.league_member_id, snapshot.standing_position
    from public.weekly_recap_snapshots snapshot
    where snapshot.league_id = target_league_id
      and snapshot.season = league_season
      and snapshot.week < target_week
    order by snapshot.league_member_id, snapshot.week desc
  )
  select target_league_id, league_season, target_week, ranked.league_member_id,
    ranked.total_points, ranked.standing_position, ranked.weekly_points, prior.standing_position
  from ranked
  left join prior using (league_member_id)
  on conflict (league_id, season, week, league_member_id) do update
  set total_points = excluded.total_points,
      standing_position = excluded.standing_position,
      weekly_points = excluded.weekly_points,
      prior_position = excluded.prior_position;

  return query
    select snapshot.*
    from public.weekly_recap_snapshots snapshot
    where snapshot.league_id = target_league_id
      and snapshot.season = league_season
      and snapshot.week = target_week
    order by snapshot.standing_position, snapshot.league_member_id;
end;
$$;

revoke all on function public.create_weekly_recap_snapshot(uuid, integer) from public, anon, authenticated;
grant execute on function public.create_weekly_recap_snapshot(uuid, integer) to service_role;
