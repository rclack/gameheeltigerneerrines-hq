-- Phase 3B.2C: durable, league-scoped Chaos episodes and material transitions.
-- Inert until explicitly enabled per league through service-role configuration.

create table public.league_chaos_settings (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  enabled boolean not null default false,
  retention_months integer not null default 18 check (retention_months between 12 and 36),
  last_success_at timestamptz,
  last_observation_at timestamptz,
  last_observation_key text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error_category text,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.league_chaos_events (
  event_key text primary key check (char_length(event_key) between 16 and 128),
  episode_id uuid not null,
  league_id uuid not null references public.leagues(id) on delete cascade,
  season text not null,
  week integer not null check (week >= 0),
  event_type text not null check (event_type in (
    'CAPTAIN_POSITIVE','CAPTAIN_NEGATIVE','BENCH_POSITIVE','PROJECTED_LEAD_CHANGE',
    'PROJECTED_RANK_MOVE','UPSET_DANGER','G5_POWER_SWING','MAJOR_SCORING_SWING'
  )),
  severity text not null check (severity in ('info','notable','major','chaos')),
  lifecycle_state text not null check (lifecycle_state in ('active','suspended','resolved')),
  state_fingerprint text not null,
  source_identity jsonb not null default '{}'::jsonb check (jsonb_typeof(source_identity) = 'object'),
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  reason_codes text[] not null default '{}',
  game_id uuid references public.cfb_games(id) on delete set null,
  provider_game_id text,
  team_id uuid references public.teams(id) on delete set null,
  league_member_id uuid references public.league_members(id) on delete set null,
  opponent_team_id uuid references public.teams(id) on delete set null,
  opponent_league_member_id uuid references public.league_members(id) on delete set null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  last_changed_at timestamptz not null,
  resolved_at timestamptz,
  resolution_reason text,
  last_processed_observation_key text not null,
  transition_sequence integer not null default 1 check (transition_sequence >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (league_id, episode_id),
  check ((lifecycle_state = 'resolved') = (resolved_at is not null))
);

create table public.league_chaos_transitions (
  id uuid primary key default gen_random_uuid(),
  transition_identity text not null unique,
  event_key text not null,
  episode_id uuid not null,
  league_id uuid not null references public.leagues(id) on delete cascade,
  season text not null,
  week integer not null check (week >= 0),
  sequence integer not null check (sequence >= 1),
  transition_type text not null check (transition_type in (
    'created','updated','escalated','de_escalated','suspended','resumed','resolved'
  )),
  old_lifecycle_state text check (old_lifecycle_state is null or old_lifecycle_state in ('active','suspended','resolved')),
  new_lifecycle_state text not null check (new_lifecycle_state in ('active','suspended','resolved')),
  old_severity text check (old_severity is null or old_severity in ('info','notable','major','chaos')),
  new_severity text not null check (new_severity in ('info','notable','major','chaos')),
  state_fingerprint text not null,
  event_type text not null,
  game_id uuid references public.cfb_games(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  league_member_id uuid references public.league_members(id) on delete set null,
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  reason_codes text[] not null default '{}',
  source_observation jsonb not null default '{}'::jsonb check (jsonb_typeof(source_observation) = 'object'),
  resolution_reason text,
  observed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (event_key) references public.league_chaos_events(event_key) on delete cascade,
  unique (event_key, episode_id, sequence)
);

create table public.league_chaos_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  observation_key text not null,
  trigger_type text not null check (trigger_type in ('live_poll','schedule_sync','freshness','manual_validation')),
  authority_state text not null check (authority_state in ('fresh','stale','unavailable')),
  observed_at timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz not null default clock_timestamp(),
  status text not null default 'succeeded' check (status in ('succeeded','failed')),
  candidates_evaluated integer not null default 0 check (candidates_evaluated >= 0),
  transitions_inserted integer not null default 0 check (transitions_inserted >= 0),
  duplicate_observations integer not null default 0 check (duplicate_observations >= 0),
  episodes_created integer not null default 0 check (episodes_created >= 0),
  episodes_suspended integer not null default 0 check (episodes_suspended >= 0),
  episodes_resumed integer not null default 0 check (episodes_resumed >= 0),
  episodes_resolved integer not null default 0 check (episodes_resolved >= 0),
  error_category text,
  unique (league_id, observation_key)
);

create index league_chaos_events_active_idx on public.league_chaos_events(league_id, season, week, lifecycle_state, severity);
create index league_chaos_events_game_idx on public.league_chaos_events(league_id, game_id) where game_id is not null;
create index league_chaos_transitions_feed_idx on public.league_chaos_transitions(league_id, observed_at desc, id desc);
create index league_chaos_transitions_episode_idx on public.league_chaos_transitions(episode_id, sequence);
create index league_chaos_runs_recent_idx on public.league_chaos_reconciliation_runs(league_id, started_at desc);

alter table public.league_chaos_settings enable row level security;
alter table public.league_chaos_events enable row level security;
alter table public.league_chaos_transitions enable row level security;
alter table public.league_chaos_reconciliation_runs enable row level security;

create policy "League members can read current Chaos state"
on public.league_chaos_events for select to authenticated
using ((select private.is_league_member(league_id)));

create policy "League members can read Chaos transitions"
on public.league_chaos_transitions for select to authenticated
using ((select private.is_league_member(league_id)));

revoke all on public.league_chaos_settings, public.league_chaos_events,
  public.league_chaos_transitions, public.league_chaos_reconciliation_runs
from public, anon, authenticated;
grant select on public.league_chaos_events, public.league_chaos_transitions to authenticated;
grant select on public.league_chaos_settings, public.league_chaos_events,
  public.league_chaos_transitions, public.league_chaos_reconciliation_runs to service_role;

create function public.set_league_chaos_enabled(target_league_id uuid, should_enable boolean)
returns public.league_chaos_settings
language plpgsql security definer set search_path = '' as $$
declare v_setting public.league_chaos_settings;
begin
  if not exists (select 1 from public.leagues where id=target_league_id) then
    raise exception 'Unknown Chaos league' using errcode='22023';
  end if;
  insert into public.league_chaos_settings(league_id,enabled) values (target_league_id,should_enable)
  on conflict (league_id) do update set enabled=excluded.enabled,updated_at=clock_timestamp()
  returning * into v_setting;
  return v_setting;
end; $$;

revoke all on function public.set_league_chaos_enabled(uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_league_chaos_enabled(uuid,boolean) to service_role;

create function public.reconcile_league_chaos(
  target_league_id uuid,
  target_observation_key text,
  target_observed_at timestamptz,
  target_trigger text,
  target_authority_state text,
  target_candidates jsonb,
  target_stale_game_ids uuid[] default '{}',
  target_settled_game_ids uuid[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_setting public.league_chaos_settings;
  v_existing_run public.league_chaos_reconciliation_runs;
  v_event public.league_chaos_events;
  v_candidate jsonb;
  v_candidate_keys text[] := '{}';
  v_event_key text;
  v_episode_id uuid;
  v_transition text;
  v_sequence integer;
  v_severity text;
  v_old_severity text;
  v_lifecycle text;
  v_resolution text;
  v_transitions integer := 0;
  v_duplicates integer := 0;
  v_created integer := 0;
  v_suspended integer := 0;
  v_resumed integer := 0;
  v_resolved integer := 0;
  v_severity_order jsonb := '{"info":0,"notable":1,"major":2,"chaos":3}'::jsonb;
begin
  if target_trigger not in ('live_poll','schedule_sync','freshness','manual_validation')
     or target_authority_state not in ('fresh','stale','unavailable')
     or char_length(coalesce(target_observation_key, '')) < 16
     or jsonb_typeof(target_candidates) <> 'array' then
    raise exception 'Invalid Chaos reconciliation request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_league_id::text, 932));
  select * into v_setting from public.league_chaos_settings where league_id = target_league_id for update;
  if v_setting.league_id is null or not v_setting.enabled then
    return jsonb_build_object('enabled', false, 'transitionsInserted', 0);
  end if;
  select * into v_existing_run from public.league_chaos_reconciliation_runs
   where league_id = target_league_id and observation_key = target_observation_key;
  if v_existing_run.id is not null then
    return jsonb_build_object('enabled', true, 'duplicate', true, 'runId', v_existing_run.id,
      'transitionsInserted', v_existing_run.transitions_inserted);
  end if;

  for v_candidate in select value from jsonb_array_elements(target_candidates) loop
    if v_candidate->>'leagueId' is distinct from target_league_id::text
       or v_candidate->>'state' <> 'active'
       or v_candidate->>'eventKey' is null
       or v_candidate->>'stateFingerprint' is null then
      raise exception 'Invalid Chaos candidate scope or shape' using errcode = '22023';
    end if;
    v_event_key := v_candidate->>'eventKey';
    v_candidate_keys := array_append(v_candidate_keys, v_event_key);
    v_severity := v_candidate->>'severity';
    select * into v_event from public.league_chaos_events where event_key = v_event_key for update;

    if v_event.event_key is null or v_event.lifecycle_state = 'resolved' then
      v_episode_id := gen_random_uuid();
      v_sequence := 1;
      v_transition := 'created';
      insert into public.league_chaos_events(event_key,episode_id,league_id,season,week,event_type,severity,lifecycle_state,
        state_fingerprint,source_identity,facts,reason_codes,game_id,provider_game_id,team_id,league_member_id,
        opponent_team_id,opponent_league_member_id,first_observed_at,last_observed_at,last_changed_at,resolved_at,
        resolution_reason,last_processed_observation_key,transition_sequence)
      values (v_event_key,v_episode_id,target_league_id,v_candidate->>'season',(v_candidate->>'week')::integer,
        v_candidate->>'type',v_severity,'active',v_candidate->>'stateFingerprint',coalesce(v_candidate->'source','{}'),
        coalesce(v_candidate->'facts','{}'),array(select jsonb_array_elements_text(coalesce(v_candidate#>'{significance,reasonCodes}','[]'))),
        nullif(v_candidate->>'gameId','')::uuid,v_candidate->>'providerGameId',nullif(v_candidate->>'teamId','')::uuid,
        nullif(v_candidate->>'memberId','')::uuid,nullif(v_candidate->>'opponentTeamId','')::uuid,
        nullif(v_candidate->>'opponentMemberId','')::uuid,target_observed_at,target_observed_at,target_observed_at,null,null,
        target_observation_key,1)
      on conflict (event_key) do update set episode_id=excluded.episode_id,league_id=excluded.league_id,season=excluded.season,
        week=excluded.week,event_type=excluded.event_type,severity=excluded.severity,lifecycle_state='active',
        state_fingerprint=excluded.state_fingerprint,source_identity=excluded.source_identity,facts=excluded.facts,
        reason_codes=excluded.reason_codes,game_id=excluded.game_id,provider_game_id=excluded.provider_game_id,
        team_id=excluded.team_id,league_member_id=excluded.league_member_id,opponent_team_id=excluded.opponent_team_id,
        opponent_league_member_id=excluded.opponent_league_member_id,first_observed_at=excluded.first_observed_at,
        last_observed_at=excluded.last_observed_at,last_changed_at=excluded.last_changed_at,resolved_at=null,
        resolution_reason=null,last_processed_observation_key=excluded.last_processed_observation_key,transition_sequence=1,updated_at=clock_timestamp();
      v_created := v_created + 1;
    elsif v_event.state_fingerprint = v_candidate->>'stateFingerprint' and v_event.lifecycle_state = 'active' then
      update public.league_chaos_events set last_observed_at=target_observed_at,
        last_processed_observation_key=target_observation_key,source_identity=coalesce(v_candidate->'source','{}'),updated_at=clock_timestamp()
      where event_key=v_event_key;
      v_duplicates := v_duplicates + 1;
      continue;
    else
      v_episode_id := v_event.episode_id;
      v_sequence := v_event.transition_sequence + 1;
      v_old_severity := v_event.severity;
      if v_event.lifecycle_state = 'suspended' then v_transition := 'resumed'; v_resumed := v_resumed + 1;
      elsif (v_severity_order->>v_severity)::integer > (v_severity_order->>v_event.severity)::integer then v_transition := 'escalated';
      elsif (v_severity_order->>v_severity)::integer < (v_severity_order->>v_event.severity)::integer then v_transition := 'de_escalated';
      else v_transition := 'updated'; end if;
      update public.league_chaos_events set season=v_candidate->>'season',week=(v_candidate->>'week')::integer,
        event_type=v_candidate->>'type',severity=v_severity,lifecycle_state='active',state_fingerprint=v_candidate->>'stateFingerprint',
        source_identity=coalesce(v_candidate->'source','{}'),facts=coalesce(v_candidate->'facts','{}'),
        reason_codes=array(select jsonb_array_elements_text(coalesce(v_candidate#>'{significance,reasonCodes}','[]'))),
        game_id=nullif(v_candidate->>'gameId','')::uuid,provider_game_id=v_candidate->>'providerGameId',
        team_id=nullif(v_candidate->>'teamId','')::uuid,league_member_id=nullif(v_candidate->>'memberId','')::uuid,
        opponent_team_id=nullif(v_candidate->>'opponentTeamId','')::uuid,
        opponent_league_member_id=nullif(v_candidate->>'opponentMemberId','')::uuid,last_observed_at=target_observed_at,
        last_changed_at=target_observed_at,resolved_at=null,resolution_reason=null,last_processed_observation_key=target_observation_key,
        transition_sequence=v_sequence,updated_at=clock_timestamp() where event_key=v_event_key;
    end if;

    insert into public.league_chaos_transitions(transition_identity,event_key,episode_id,league_id,season,week,sequence,
      transition_type,old_lifecycle_state,new_lifecycle_state,old_severity,new_severity,state_fingerprint,event_type,
      game_id,team_id,league_member_id,facts,reason_codes,source_observation,observed_at)
    values (target_observation_key||':'||v_event_key||':'||v_episode_id||':'||v_sequence,v_event_key,v_episode_id,target_league_id,
      v_candidate->>'season',(v_candidate->>'week')::integer,v_sequence,v_transition,
      case when v_transition='created' then null else v_event.lifecycle_state end,'active',
      case when v_transition='created' then null else coalesce(v_old_severity,v_event.severity) end,v_severity,
      v_candidate->>'stateFingerprint',v_candidate->>'type',nullif(v_candidate->>'gameId','')::uuid,
      nullif(v_candidate->>'teamId','')::uuid,nullif(v_candidate->>'memberId','')::uuid,coalesce(v_candidate->'facts','{}'),
      array(select jsonb_array_elements_text(coalesce(v_candidate#>'{significance,reasonCodes}','[]'))),
      jsonb_build_object('observationKey',target_observation_key,'source',coalesce(v_candidate->'source','{}')),
      target_observed_at) on conflict (transition_identity) do nothing;
    v_transitions := v_transitions + 1;
  end loop;

  for v_event in select * from public.league_chaos_events
    where league_id=target_league_id and lifecycle_state in ('active','suspended')
      and not (event_key = any(v_candidate_keys)) for update
  loop
    if (v_event.game_id = any(target_stale_game_ids)) or (v_event.game_id is null and target_authority_state <> 'fresh') then
      if v_event.lifecycle_state = 'suspended' then continue; end if;
      v_lifecycle := 'suspended'; v_transition := 'suspended'; v_resolution := null; v_suspended := v_suspended + 1;
    elsif target_authority_state <> 'fresh' and coalesce(cardinality(target_stale_game_ids),0)=0 then
      if v_event.lifecycle_state = 'suspended' then continue; end if;
      v_lifecycle := 'suspended'; v_transition := 'suspended'; v_resolution := null; v_suspended := v_suspended + 1;
    else
      v_lifecycle := 'resolved'; v_transition := 'resolved';
      v_resolution := case when v_event.game_id = any(target_settled_game_ids) then 'OFFICIAL_SETTLED' else 'CONDITION_ENDED' end;
      v_resolved := v_resolved + 1;
    end if;
    v_sequence := v_event.transition_sequence + 1;
    update public.league_chaos_events set lifecycle_state=v_lifecycle,last_observed_at=target_observed_at,
      last_changed_at=target_observed_at,resolved_at=case when v_lifecycle='resolved' then target_observed_at else null end,
      resolution_reason=v_resolution,last_processed_observation_key=target_observation_key,transition_sequence=v_sequence,
      updated_at=clock_timestamp() where event_key=v_event.event_key;
    insert into public.league_chaos_transitions(transition_identity,event_key,episode_id,league_id,season,week,sequence,
      transition_type,old_lifecycle_state,new_lifecycle_state,old_severity,new_severity,state_fingerprint,event_type,
      game_id,team_id,league_member_id,facts,reason_codes,source_observation,resolution_reason,observed_at)
    values (target_observation_key||':'||v_event.event_key||':'||v_event.episode_id||':'||v_sequence,v_event.event_key,
      v_event.episode_id,target_league_id,v_event.season,v_event.week,v_sequence,v_transition,v_event.lifecycle_state,
      v_lifecycle,v_event.severity,v_event.severity,v_event.state_fingerprint,v_event.event_type,v_event.game_id,
      v_event.team_id,v_event.league_member_id,v_event.facts,v_event.reason_codes,
      jsonb_build_object('observationKey',target_observation_key,'authorityState',target_authority_state),v_resolution,target_observed_at);
    v_transitions := v_transitions + 1;
  end loop;

  insert into public.league_chaos_reconciliation_runs(league_id,observation_key,trigger_type,authority_state,observed_at,
    candidates_evaluated,transitions_inserted,duplicate_observations,episodes_created,episodes_suspended,episodes_resumed,episodes_resolved)
  values (target_league_id,target_observation_key,target_trigger,target_authority_state,target_observed_at,
    jsonb_array_length(target_candidates),v_transitions,v_duplicates,v_created,v_suspended,v_resumed,v_resolved)
  returning * into v_existing_run;
  update public.league_chaos_settings set last_success_at=clock_timestamp(),last_observation_at=target_observed_at,
    last_observation_key=target_observation_key,consecutive_failures=0,last_error_category=null,updated_at=clock_timestamp()
  where league_id=target_league_id;
  return jsonb_build_object('enabled',true,'duplicate',false,'runId',v_existing_run.id,'transitionsInserted',v_transitions,
    'episodesCreated',v_created,'episodesSuspended',v_suspended,'episodesResumed',v_resumed,'episodesResolved',v_resolved,
    'duplicateObservations',v_duplicates);
end; $$;

revoke all on function public.reconcile_league_chaos(uuid,text,timestamptz,text,text,jsonb,uuid[],uuid[]) from public, anon, authenticated;
grant execute on function public.reconcile_league_chaos(uuid,text,timestamptz,text,text,jsonb,uuid[],uuid[]) to service_role;

comment on table public.league_chaos_transitions is
  'Append-only material Chaos lifecycle history. Retain at least the current season plus 18 months; no purge is installed in Phase 3B.2C.';
