begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $test$
declare
  v_game record;
  v_before_ids text;
  v_after_ids text;
  v_live_hash text;
begin
  select md5(coalesce(string_agg(concat_ws('|', id, state_fingerprint, fetched_at), '' order by id), ''))
  into v_live_hash from public.live_scoreboard_snapshots;

  delete from public.scoring_events
  where league_id in (
    'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b',
    'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb'
  ) and week = 0;
  update public.cfb_games set scoring_fingerprint = null, scored_at = null
  where league_id in (
    'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b',
    'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb'
  ) and season = '2026' and week = 0;

  for v_game in
    select id from public.cfb_games
    where league_id in (
      'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b',
      'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb'
    ) and season = '2026' and week = 0 and status = 'final'
    order by league_id, id
  loop
    perform public.scheduled_process_cfb_game_scoring(v_game.id);
  end loop;

  if (select count(*) from public.cfb_games where league_id in (
    'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb'
  ) and season = '2026' and week = 0 and scoring_fingerprint is not null) <> 16 then
    raise exception 'fixture: not all finals became scoring current';
  end if;
  if (select count(*) from public.scoring_events where league_id in (
    'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb'
  ) and week = 0 and voided_at is null and counts_for_standings) <> 6 then
    raise exception 'fixture: counting event count mismatch';
  end if;

  if (select coalesce(sum(e.points), 0) from public.scoring_events e
      join public.league_members lm on lm.id = e.league_member_id join public.profiles p on p.id = lm.user_id
      where e.league_id = 'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b' and e.week = 0 and e.voided_at is null
        and e.counts_for_standings and p.display_name = 'Lennon Murphy') <> 2 then raise exception 'fixture: Lennon oracle mismatch'; end if;
  if (select coalesce(sum(e.points), 0) from public.scoring_events e
      join public.league_members lm on lm.id = e.league_member_id join public.profiles p on p.id = lm.user_id
      where e.league_id = 'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b' and e.week = 0 and e.voided_at is null
        and e.counts_for_standings and p.display_name = 'Alex Kalany') <> 1 then raise exception 'fixture: Alex oracle mismatch'; end if;
  if (select coalesce(sum(e.points), 0) from public.scoring_events e
      join public.league_members lm on lm.id = e.league_member_id join public.profiles p on p.id = lm.user_id
      where e.league_id = 'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b' and e.week = 0 and e.voided_at is null
        and e.counts_for_standings and p.display_name = 'Andrew') <> 1 then raise exception 'fixture: Andrew oracle mismatch'; end if;
  if (select coalesce(sum(e.points), 0) from public.scoring_events e
      join public.league_members lm on lm.id = e.league_member_id join public.profiles p on p.id = lm.user_id
      where e.league_id = 'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b' and e.week = 0 and e.voided_at is null
        and e.counts_for_standings and p.display_name = 'Jamey Sexbury') <> 0 then raise exception 'fixture: Jamey oracle mismatch'; end if;
  if (select coalesce(sum(e.points), 0) from public.scoring_events e
      join public.league_members lm on lm.id = e.league_member_id join public.profiles p on p.id = lm.user_id
      where e.league_id = 'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b' and e.week = 0 and e.voided_at is null
        and e.counts_for_standings and p.display_name = 'Randy Clack') <> -2 then raise exception 'fixture: Randy oracle mismatch'; end if;
  if (select coalesce(sum(e.points), 0) from public.scoring_events e
      join public.league_members lm on lm.id = e.league_member_id join public.profiles p on p.id = lm.user_id
      where e.league_id = 'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb' and e.week = 0 and e.voided_at is null
        and e.counts_for_standings and p.display_name = 'Carson Fiori') <> -1 then raise exception 'fixture: Carson oracle mismatch'; end if;

  if (select count(*) from public.scoring_events e join public.teams t on t.id = e.team_id
      where e.league_id = 'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b' and e.week = 0 and e.voided_at is null
        and e.counts_for_standings and t.school_name = 'North Dakota State' and e.base_points = 1
        and e.scoring_multiplier = 2 and e.points = 2 and e.captain_at_scoring) <> 1 then
    raise exception 'fixture: Captain multiplier mismatch';
  end if;

  select md5(string_agg(id::text, '' order by id)) into v_before_ids from public.scoring_events
  where league_id in ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb') and week = 0;
  for v_game in select id from public.cfb_games where league_id in (
    'f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb'
  ) and season = '2026' and week = 0 order by league_id, id loop
    perform public.scheduled_process_cfb_game_scoring(v_game.id);
  end loop;
  select md5(string_agg(id::text, '' order by id)) into v_after_ids from public.scoring_events
  where league_id in ('f2fbb2e2-1d46-4ee5-a72d-36f6c7d6508b', 'f4cefefc-dc19-4ca9-b7b6-74fe6357faeb') and week = 0;
  if v_before_ids is distinct from v_after_ids then raise exception 'fixture: repeated sweep was not idempotent'; end if;

  update public.cfb_games set home_score = 20, away_score = 15, scoring_fingerprint = null
  where id = '03cecc43-75ab-407f-b8ec-c140ba83169f';
  perform public.scheduled_process_cfb_game_scoring('03cecc43-75ab-407f-b8ec-c140ba83169f');
  if (select count(*) from public.scoring_events where source_identifier = '03cecc43-75ab-407f-b8ec-c140ba83169f'
      and voided_at is null and points = 1 and counts_for_standings) <> 1 then
    raise exception 'fixture: corrected final did not deterministically reprocess';
  end if;

  -- Emulate the existing audited commissioner-correction path before rescoring.
  update public.weekly_lineup_entries set status = 'bench' where id = '5c0c1ad4-255f-4705-8d3c-360b765261ab';
  update public.scoring_events set voided_at = now(), voided_by = auth.uid(),
    void_reason = 'Rollback fixture lineup correction', idempotency_key = idempotency_key || ':void:' || id::text
  where source_identifier = '2c4f8b3d-9875-4e0f-9050-abfc45cdbfe4' and voided_at is null;
  update public.cfb_games set scoring_fingerprint = null where id = '2c4f8b3d-9875-4e0f-9050-abfc45cdbfe4';
  perform public.scheduled_process_cfb_game_scoring('2c4f8b3d-9875-4e0f-9050-abfc45cdbfe4');
  if (select count(*) from public.scoring_events e join public.teams t on t.id = e.team_id
      where e.source_identifier = '2c4f8b3d-9875-4e0f-9050-abfc45cdbfe4' and e.voided_at is null
        and t.school_name = 'USC' and e.counts_for_standings = false and e.lineup_status_at_scoring = 'bench') <> 1 then
    raise exception 'fixture: bench event counted or lost attribution';
  end if;

  begin
    perform public.scheduled_process_cfb_game_scoring('00000000-0000-4000-8000-000000000099');
    raise exception 'fixture: missing game unexpectedly scored';
  exception when sqlstate 'P0002' then null;
  end;
  update public.cfb_games set away_score = 35, home_score = 34, scoring_fingerprint = null
  where id = 'fdd9c724-eec3-440e-80ea-1541c8ff6441';
  perform public.scheduled_process_cfb_game_scoring('fdd9c724-eec3-440e-80ea-1541c8ff6441');
  if (select scoring_fingerprint from public.cfb_games where id = 'fdd9c724-eec3-440e-80ea-1541c8ff6441') is null then
    raise exception 'fixture: later eligible game did not complete after failure';
  end if;

  if (select md5(coalesce(string_agg(concat_ws('|', id, state_fingerprint, fetched_at), '' order by id), ''))
      from public.live_scoreboard_snapshots) is distinct from v_live_hash then
    raise exception 'fixture: canonical live state was mutated';
  end if;
end;
$test$;

rollback;
select 'PASS: Week 0 automated scoring rollback fixture completed and rolled back' result;
