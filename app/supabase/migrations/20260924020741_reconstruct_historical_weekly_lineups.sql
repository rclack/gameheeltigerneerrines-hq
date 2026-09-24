-- Reconstruct seven approved, deterministic Week 2-3 lineups that were not
-- materialized before their games. This records the repair at its real time;
-- it does not backdate materialization, locks, or audit history.

do $repair$
declare
  v_lineup public.weekly_lineups%rowtype;
  v_entry public.weekly_lineup_entries%rowtype;
  v_expected_count integer;
  v_reason constant text :=
    'Historical reconstruction approved by product owner; derived from pre-kickoff draft, prior-lineup, and schedule state without using game results.';
  v_actor uuid;
  v_row record;
begin
  select id into strict v_actor
  from public.profiles
  where display_name = 'Randy Clack';

  create temporary table historical_lineup_repair (
    league_id uuid not null,
    week integer not null,
    owner_name text not null,
    team_name text not null,
    lineup_status text not null,
    primary key (league_id, week, owner_name, team_name)
  ) on commit drop;

  insert into historical_lineup_repair values
    ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 3, 'Lennon Murphy', 'SMU', 'starter'),
    ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 3, 'Lennon Murphy', 'LSU', 'starter'),
    ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 3, 'Lennon Murphy', 'Arizona', 'starter'),
    ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 3, 'Lennon Murphy', 'North Dakota State', 'starter'),
    ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 3, 'Lennon Murphy', 'Michigan', 'bench'),
    ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 3, 'Lennon Murphy', 'Indiana', 'bench'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'Carson Fiori', 'SMU', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'Carson Fiori', 'Ohio State', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'Carson Fiori', 'UNLV', 'bench'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'Nicholas Fiori', 'Notre Dame', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'Nicholas Fiori', 'LSU', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'Nicholas Fiori', 'Boise State', 'bench'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'WVU Mike', 'Indiana', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'WVU Mike', 'Navy', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 2, 'WVU Mike', 'BYU', 'bench'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'Erin', 'Oregon', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'Erin', 'Clemson', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'Erin', 'North Texas', 'bench'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'Nicholas Fiori', 'Notre Dame', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'Nicholas Fiori', 'LSU', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'Nicholas Fiori', 'Boise State', 'bench'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'WVU Mike', 'Indiana', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'WVU Mike', 'BYU', 'starter'),
    ('f4cefefc-dc19-4ca9-b7b6-74fe6357faeb', 3, 'WVU Mike', 'Navy', 'no_game');

  if (select count(*) from historical_lineup_repair) <> 24 then
    raise exception 'Historical lineup repair definition must contain exactly 24 entries';
  end if;

  if exists (
    select 1
    from (select distinct league_id, week, owner_name from historical_lineup_repair) target
    join public.league_members member on member.league_id = target.league_id
    join public.profiles profile on profile.id = member.user_id and profile.display_name = target.owner_name
    join public.weekly_lineups lineup on lineup.league_id = target.league_id
      and lineup.league_member_id = member.id and lineup.season = '2026' and lineup.week = target.week
  ) then
    raise exception 'Historical lineup repair target already exists';
  end if;

  for v_row in
    select distinct repair.league_id, repair.week, member.id as member_id,
      league.starters_per_week
    from historical_lineup_repair repair
    join public.leagues league on league.id = repair.league_id
    join public.league_members member on member.league_id = repair.league_id
    join public.profiles profile on profile.id = member.user_id
      and profile.display_name = repair.owner_name
  loop
    if v_row.starters_per_week is null then
      raise exception 'League % has no starter limit', v_row.league_id;
    end if;

    insert into public.weekly_lineups
      (league_id, league_member_id, season, week, starters_limit_snapshot)
    values
      (v_row.league_id, v_row.member_id, '2026', v_row.week, v_row.starters_per_week)
    returning * into v_lineup;

    for v_row in
      select repair.*, pick.id as draft_pick_id, team.id as team_id,
        game.id as game_id, game.start_at
      from historical_lineup_repair repair
      join public.league_members member on member.league_id = repair.league_id
      join public.profiles profile on profile.id = member.user_id
        and profile.display_name = repair.owner_name
      join public.draft_picks pick on pick.league_member_id = member.id
      join public.teams team on team.id = pick.team_id and team.school_name = repair.team_name
      left join public.cfb_games game on repair.lineup_status <> 'no_game'
        and game.league_id = repair.league_id and game.season = '2026' and game.week = repair.week
        and game.status <> 'canceled'
        and (game.home_team_id = team.id or game.away_team_id = team.id)
      where repair.league_id = v_lineup.league_id
        and repair.week = v_lineup.week
        and member.id = v_lineup.league_member_id
    loop
      if v_row.lineup_status <> 'no_game' and (v_row.game_id is null or v_row.start_at is null) then
        raise exception 'Missing eligible game for % week % %', v_row.owner_name, v_row.week, v_row.team_name;
      end if;
      if v_row.lineup_status = 'no_game' and v_row.game_id is not null then
        raise exception 'Unexpected game for no-game entry % week % %', v_row.owner_name, v_row.week, v_row.team_name;
      end if;

      insert into public.weekly_lineup_entries
        (weekly_lineup_id, draft_pick_id, team_id, game_id, status, selection_source,
         kickoff_at_snapshot, lock_at, locked_at)
      values
        (v_lineup.id, v_row.draft_pick_id, v_row.team_id, v_row.game_id,
         v_row.lineup_status, 'commissioner', v_row.start_at, v_row.start_at,
         case when v_row.game_id is not null then clock_timestamp() end)
      returning * into v_entry;

      insert into public.weekly_lineup_changes
        (weekly_lineup_entry_id, from_status, to_status, change_source, reason,
         actor_id, kickoff_at_snapshot)
      values
        (v_entry.id, null, v_entry.status, 'commissioner', v_reason,
         v_actor, v_entry.kickoff_at_snapshot);
    end loop;

    select count(*) into v_expected_count
    from historical_lineup_repair repair
    join public.league_members member on member.league_id = repair.league_id
    join public.profiles profile on profile.id = member.user_id and profile.display_name = repair.owner_name
    where repair.league_id = v_lineup.league_id and repair.week = v_lineup.week
      and member.id = v_lineup.league_member_id;

    if (select count(*) from public.weekly_lineup_entries where weekly_lineup_id = v_lineup.id) <> v_expected_count then
      raise exception 'Historical lineup entry count mismatch for lineup %', v_lineup.id;
    end if;
  end loop;

  if (select count(*) from public.weekly_lineups lineup
      join (select distinct league_id, week, owner_name from historical_lineup_repair) target
        on target.league_id = lineup.league_id and target.week = lineup.week
      join public.league_members member on member.id = lineup.league_member_id
      join public.profiles profile on profile.id = member.user_id and profile.display_name = target.owner_name
      where lineup.season = '2026') <> 7 then
    raise exception 'Historical lineup repair did not create exactly seven lineups';
  end if;

  if (select count(*) from public.weekly_lineup_entries entry
      join public.weekly_lineups lineup on lineup.id = entry.weekly_lineup_id
      join (select distinct league_id, week, owner_name from historical_lineup_repair) target
        on target.league_id = lineup.league_id and target.week = lineup.week
      join public.league_members member on member.id = lineup.league_member_id
      join public.profiles profile on profile.id = member.user_id and profile.display_name = target.owner_name
      where lineup.season = '2026') <> 24 then
    raise exception 'Historical lineup repair did not create exactly 24 entries';
  end if;
end
$repair$;
