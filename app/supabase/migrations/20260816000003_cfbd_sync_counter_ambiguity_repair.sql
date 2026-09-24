-- Repair PL/pgSQL counter/column ambiguity in the CFBD game import audit update.

create or replace function public.apply_external_game_sync(
  target_sync_run_id uuid,
  target_games jsonb,
  target_mapping_summary jsonb
)
returns public.external_sync_runs language plpgsql security definer set search_path = '' as $$
declare
  v_run public.external_sync_runs;
  v_item jsonb;
  v_existing public.cfb_games;
  v_created_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_skipped_count integer := 0;
  v_error_count integer := 0;
  v_newly_final_count integer := 0;
  v_incoming_hash text;
  v_changed_result boolean;
begin
  select sync_run.* into v_run
  from public.external_sync_runs as sync_run
  join public.leagues as league on league.id = sync_run.league_id
  where sync_run.id = target_sync_run_id
    and sync_run.provider = 'cfbd'
    and sync_run.sync_type = 'schedule'
    and sync_run.status = 'running'
    and league.commissioner_id = auth.uid()
  for update of sync_run;

  if v_run.id is null then
    raise exception 'Sync run not found or access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(target_games) <> 'array' then
    raise exception 'Invalid games payload' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(target_games) loop
    begin
      v_incoming_hash := md5(v_item::text);
      select game.* into v_existing
      from public.cfb_games as game
      where game.league_id = v_run.league_id
        and game.external_provider = 'cfbd'
        and game.external_id = v_item->>'external_id'
      for update of game;

      if v_existing.id is null then
        insert into public.cfb_games (
          league_id, external_provider, external_id, data_source, season, week,
          game_date, home_team_id, away_team_id, home_score, away_score, status,
          neutral_site, postseason, provider_payload_hash, provider_synced_at
        ) values (
          v_run.league_id, 'cfbd', v_item->>'external_id', 'provider', v_item->>'season',
          (v_item->>'week')::integer, (v_item->>'game_date')::date,
          (v_item->>'home_team_id')::uuid, (v_item->>'away_team_id')::uuid,
          (v_item->>'home_score')::integer, (v_item->>'away_score')::integer,
          v_item->>'status', (v_item->>'neutral_site')::boolean,
          (v_item->>'postseason')::boolean, v_incoming_hash, now()
        );
        v_created_count := v_created_count + 1;
        if v_item->>'status' = 'final' then
          v_newly_final_count := v_newly_final_count + 1;
        end if;
      elsif v_existing.manual_override then
        v_skipped_count := v_skipped_count + 1;
      elsif v_existing.provider_payload_hash = v_incoming_hash then
        update public.cfb_games as game
        set provider_synced_at = now()
        where game.id = v_existing.id;
        v_unchanged_count := v_unchanged_count + 1;
      else
        if v_existing.status <> 'final' and v_item->>'status' = 'final' then
          v_newly_final_count := v_newly_final_count + 1;
        end if;
        v_changed_result := (
          v_existing.home_team_id, v_existing.away_team_id, v_existing.home_score,
          v_existing.away_score, v_existing.status, v_existing.season, v_existing.week
        ) is distinct from (
          (v_item->>'home_team_id')::uuid, (v_item->>'away_team_id')::uuid,
          (v_item->>'home_score')::integer, (v_item->>'away_score')::integer,
          v_item->>'status', v_item->>'season', (v_item->>'week')::integer
        );
        update public.cfb_games as game
        set season = v_item->>'season',
          week = (v_item->>'week')::integer,
          game_date = (v_item->>'game_date')::date,
          home_team_id = (v_item->>'home_team_id')::uuid,
          away_team_id = (v_item->>'away_team_id')::uuid,
          home_score = (v_item->>'home_score')::integer,
          away_score = (v_item->>'away_score')::integer,
          status = v_item->>'status',
          neutral_site = (v_item->>'neutral_site')::boolean,
          postseason = (v_item->>'postseason')::boolean,
          provider_payload_hash = v_incoming_hash,
          provider_synced_at = now(),
          scoring_fingerprint = case when v_changed_result then null else game.scoring_fingerprint end
        where game.id = v_existing.id;
        v_updated_count := v_updated_count + 1;
      end if;
    exception when others then
      v_error_count := v_error_count + 1;
      v_skipped_count := v_skipped_count + 1;
    end;
  end loop;

  update public.external_sync_runs as sync_run
  set completed_at = now(),
    status = case
      when v_error_count > 0
        or coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0) > 0
      then 'partial'
      else 'succeeded'
    end,
    fetched_count = jsonb_array_length(target_games)
      + coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0),
    created_count = v_created_count,
    updated_count = v_updated_count,
    unchanged_count = v_unchanged_count,
    skipped_count = v_skipped_count
      + coalesce(jsonb_array_length(target_mapping_summary->'unmapped_games'), 0),
    error_count = v_error_count,
    summary = coalesce(target_mapping_summary, '{}'::jsonb)
      || jsonb_build_object('newly_final_count', v_newly_final_count)
  where sync_run.id = v_run.id
  returning sync_run.* into v_run;

  return v_run;
end;
$$;

revoke all on function public.apply_external_game_sync(uuid, jsonb, jsonb) from public;
grant execute on function public.apply_external_game_sync(uuid, jsonb, jsonb) to authenticated;
