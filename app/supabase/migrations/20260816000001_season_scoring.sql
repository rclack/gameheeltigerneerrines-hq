-- Auditable season scoring ledger, manual game entry, and atomic scoring engine.

create table public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  code text not null check (code = upper(code) and code ~ '^[A-Z0-9_]+$'),
  display_name text not null check (char_length(trim(display_name)) between 2 and 120),
  description text not null check (char_length(trim(description)) between 2 and 500),
  category text not null check (category in ('game_result', 'postseason', 'awards', 'coaching', 'statistical_bonus', 'statistical_penalty')),
  points integer not null check (points <> 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index scoring_rules_official_code_key
on public.scoring_rules (code) where league_id is null;
create unique index scoring_rules_league_code_key
on public.scoring_rules (league_id, code) where league_id is not null;

create table public.conference_classifications (
  id uuid primary key default gen_random_uuid(),
  season text not null check (season ~ '^[0-9]{4}$'),
  conference text not null check (char_length(trim(conference)) between 2 and 80),
  classification text not null check (classification in ('POWER', 'G5', 'INDEPENDENT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conference_classifications_season_conference_key unique (season, conference)
);

create table public.cfb_games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  external_id text,
  season text not null check (season ~ '^[0-9]{4}$'),
  week integer not null check (week > 0),
  game_date date not null,
  home_team_id uuid not null references public.teams(id) on delete restrict,
  away_team_id uuid not null references public.teams(id) on delete restrict,
  home_score integer check (home_score is null or home_score >= 0),
  away_score integer check (away_score is null or away_score >= 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'final', 'canceled')),
  neutral_site boolean not null default false,
  postseason boolean not null default false,
  scoring_fingerprint text,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cfb_games_different_teams check (home_team_id <> away_team_id),
  constraint cfb_games_final_scores check (
    status <> 'final' or (home_score is not null and away_score is not null and home_score <> away_score)
  )
);

create unique index cfb_games_league_external_id_key
on public.cfb_games (league_id, external_id) where external_id is not null;
create index cfb_games_league_season_week_idx
on public.cfb_games (league_id, season, week, game_date);

create table public.team_ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  game_id uuid references public.cfb_games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  season text not null check (season ~ '^[0-9]{4}$'),
  week integer not null check (week > 0),
  ranking_source text not null check (char_length(trim(ranking_source)) between 2 and 80),
  rank integer not null check (rank between 1 and 999),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index team_ranking_snapshots_game_team_source_key
on public.team_ranking_snapshots (game_id, team_id, ranking_source)
where game_id is not null;
create index team_ranking_snapshots_league_week_idx
on public.team_ranking_snapshots (league_id, season, week, ranking_source, rank);

create table public.scoring_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  scoring_rule_id uuid not null references public.scoring_rules(id) on delete restrict,
  season text not null check (season ~ '^[0-9]{4}$'),
  week integer check (week is null or week > 0),
  points integer not null check (points <> 0),
  event_date date not null,
  source_type text not null check (source_type in ('game', 'manual')),
  source_identifier text,
  origin text not null check (origin in ('manual', 'automatic')),
  idempotency_key text not null unique,
  notes text check (notes is null or char_length(notes) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  void_reason text check (void_reason is null or char_length(trim(void_reason)) between 2 and 500),
  constraint scoring_events_void_consistent check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and void_reason is not null)
  )
);

create index scoring_events_league_week_idx
on public.scoring_events (league_id, season, week) where voided_at is null;
create index scoring_events_league_team_idx
on public.scoring_events (league_id, team_id, created_at desc) where voided_at is null;
create index scoring_events_source_idx
on public.scoring_events (league_id, source_type, source_identifier) where voided_at is null;
create index scoring_events_recent_idx
on public.scoring_events (league_id, created_at desc);

create trigger scoring_rules_set_updated_at
before update on public.scoring_rules
for each row execute function public.set_updated_at();

create trigger conference_classifications_set_updated_at
before update on public.conference_classifications
for each row execute function public.set_updated_at();

create trigger cfb_games_set_updated_at
before update on public.cfb_games
for each row execute function public.set_updated_at();

insert into public.scoring_rules (code, display_name, description, category, points) values
  ('WIN', 'Win', 'Team wins a completed game.', 'game_result', 1),
  ('WIN_OVER_RANKED', 'Win over ranked team', 'Team defeats an opponent ranked in the configured pre-game ranking source.', 'game_result', 1),
  ('WIN_OVER_TOP_15', 'Win over Top 15 team', 'Team defeats an opponent ranked 15th or better.', 'game_result', 2),
  ('WIN_OVER_TOP_5', 'Win over Top 5 team', 'Team defeats an opponent ranked 5th or better.', 'game_result', 3),
  ('LOSS', 'Loss', 'Team loses a completed game.', 'game_result', -1),
  ('P5_LOSS_TO_G5', 'Power loss to G5', 'POWER-classified team loses to a G5-classified team.', 'game_result', -5),
  ('G5_WIN_OVER_P5', 'G5 win over Power', 'G5-classified team defeats a POWER-classified team.', 'game_result', 5),
  ('MAKE_CONFERENCE_CHAMPIONSHIP', 'Make conference championship', 'Team qualifies for its conference championship game.', 'postseason', 5),
  ('WIN_CONFERENCE', 'Win conference', 'Team wins its conference championship.', 'postseason', 10),
  ('BOWL_ELIGIBLE', 'Bowl eligible', 'Team becomes bowl eligible.', 'postseason', 5),
  ('NOT_BOWL_ELIGIBLE', 'Not bowl eligible', 'Team finishes the season without bowl eligibility.', 'postseason', -5),
  ('WIN_NON_CFP_BOWL', 'Win non-CFP bowl', 'Team wins a bowl outside the College Football Playoff.', 'postseason', 5),
  ('DECLINE_BOWL_INVITE', 'Decline bowl invite', 'Team declines a bowl invitation.', 'postseason', -1),
  ('MAKE_CFP', 'Make CFP', 'Team is selected for the College Football Playoff.', 'postseason', 5),
  ('MAKE_CFP_QUARTERFINAL', 'Make CFP quarterfinal', 'Team reaches a CFP quarterfinal.', 'postseason', 10),
  ('WIN_CFP_QUARTERFINAL', 'Win CFP quarterfinal', 'Team wins a CFP quarterfinal.', 'postseason', 10),
  ('WIN_CFP_SEMIFINAL', 'Win CFP semifinal', 'Team wins a CFP semifinal.', 'postseason', 15),
  ('WIN_CFP_CHAMPIONSHIP', 'Win CFP championship', 'Team wins the CFP national championship.', 'postseason', 25),
  ('HEISMAN_INVITEE', 'Heisman invitee', 'A player from the team is invited to the Heisman ceremony.', 'awards', 10),
  ('HEISMAN_WINNER', 'Heisman winner', 'A player from the team wins the Heisman Trophy.', 'awards', 10),
  ('COACH_FIRED', 'Coach fired', 'The team fires its head coach.', 'coaching', -5),
  ('COACH_FIRED_BEFORE_END_OF_SEASON', 'Coach fired before end of season', 'The team fires its head coach before the season ends.', 'coaching', -10),
  ('TOP_3_QBR', 'Top 3 QBR', 'Team finishes in the applicable Top 3 QBR statistic.', 'statistical_bonus', 3),
  ('TOP_3_RUSHING_TDS', 'Top 3 rushing TDs', 'Team finishes in the applicable Top 3 rushing touchdowns statistic.', 'statistical_bonus', 3),
  ('TOP_3_RECEIVING_TDS', 'Top 3 receiving TDs', 'Team finishes in the applicable Top 3 receiving touchdowns statistic.', 'statistical_bonus', 3),
  ('TOP_3_DEFENSIVE_INTERCEPTIONS', 'Top 3 defensive interceptions', 'Team finishes in the applicable Top 3 defensive interceptions statistic.', 'statistical_bonus', 3),
  ('TOP_3_DEFENSIVE_SACKS', 'Top 3 defensive sacks', 'Team finishes in the applicable Top 3 defensive sacks statistic.', 'statistical_bonus', 3),
  ('BOTTOM_3_QBR', 'Bottom 3 QBR', 'Team finishes in the applicable Bottom 3 QBR statistic.', 'statistical_penalty', -3),
  ('BOTTOM_3_RUSHING_TDS', 'Bottom 3 rushing TDs', 'Team finishes in the applicable Bottom 3 rushing touchdowns statistic.', 'statistical_penalty', -3),
  ('BOTTOM_3_RECEIVING_TDS', 'Bottom 3 receiving TDs', 'Team finishes in the applicable Bottom 3 receiving touchdowns statistic.', 'statistical_penalty', -3),
  ('TOP_3_INTERCEPTIONS_THROWN', 'Top 3 interceptions thrown', 'Team finishes in the applicable Top 3 interceptions thrown statistic.', 'statistical_penalty', -3),
  ('TOP_3_SACKS_ALLOWED', 'Top 3 sacks allowed', 'Team finishes in the applicable Top 3 sacks allowed statistic.', 'statistical_penalty', -3);

insert into public.conference_classifications (season, conference, classification) values
  ('2026', 'ACC', 'POWER'),
  ('2026', 'Big Ten', 'POWER'),
  ('2026', 'Big 12', 'POWER'),
  ('2026', 'SEC', 'POWER'),
  ('2026', 'American', 'G5'),
  ('2026', 'Conference USA', 'G5'),
  ('2026', 'MAC', 'G5'),
  ('2026', 'Mountain West', 'G5'),
  ('2026', 'Pac-12', 'G5'),
  ('2026', 'Sun Belt', 'G5'),
  ('2026', 'Independent', 'INDEPENDENT');

alter table public.scoring_rules enable row level security;
alter table public.conference_classifications enable row level security;
alter table public.cfb_games enable row level security;
alter table public.team_ranking_snapshots enable row level security;
alter table public.scoring_events enable row level security;

create policy "Authenticated users can read official scoring rules"
on public.scoring_rules for select to authenticated
using (league_id is null or private.is_league_member(league_id));

create policy "Authenticated users can read conference classifications"
on public.conference_classifications for select to authenticated
using (true);

create policy "League members can read games"
on public.cfb_games for select to authenticated
using (private.is_league_member(league_id));

create policy "League members can read ranking snapshots"
on public.team_ranking_snapshots for select to authenticated
using (private.is_league_member(league_id));

create policy "League members can read scoring events"
on public.scoring_events for select to authenticated
using (private.is_league_member(league_id));

create policy "League members can read fellow memberships"
on public.league_members for select to authenticated
using (private.is_league_member(league_id));

grant select on public.scoring_rules, public.conference_classifications, public.cfb_games,
  public.team_ranking_snapshots, public.scoring_events to authenticated;

create function public.save_cfb_game(
  target_game_id uuid,
  target_league_id uuid,
  target_season text,
  target_week integer,
  target_game_date date,
  target_home_team_id uuid,
  target_away_team_id uuid,
  target_home_score integer,
  target_away_score integer,
  target_status text,
  target_neutral_site boolean,
  target_postseason boolean,
  target_ranking_source text,
  target_home_rank integer,
  target_away_rank integer
)
returns public.cfb_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_game public.cfb_games;
  league_season text;
begin
  select season into league_season
  from public.leagues
  where id = target_league_id and commissioner_id = auth.uid();

  if league_season is null then raise exception 'League not found or access denied' using errcode = '42501'; end if;
  if target_season is distinct from league_season then raise exception 'Game season must match league season' using errcode = '22023'; end if;
  if target_home_team_id = target_away_team_id then raise exception 'A team cannot play itself' using errcode = '22023'; end if;
  if target_week is null or target_week < 1 then raise exception 'Week must be positive' using errcode = '22023'; end if;
  if target_status not in ('scheduled', 'final', 'canceled') then raise exception 'Invalid game status' using errcode = '22023'; end if;
  if target_status = 'final' and (target_home_score is null or target_away_score is null or target_home_score = target_away_score) then
    raise exception 'Final games require two different nonnegative scores' using errcode = '22023';
  end if;
  if target_ranking_source is not null and char_length(trim(target_ranking_source)) < 2 then
    raise exception 'Ranking source must contain at least two characters' using errcode = '22023';
  end if;
  if (target_home_rank is not null or target_away_rank is not null) and target_ranking_source is null then
    raise exception 'A ranking source is required when a rank is supplied' using errcode = '22023';
  end if;

  if target_game_id is null then
    insert into public.cfb_games (
      league_id, season, week, game_date, home_team_id, away_team_id,
      home_score, away_score, status, neutral_site, postseason
    ) values (
      target_league_id, target_season, target_week, target_game_date,
      target_home_team_id, target_away_team_id, target_home_score,
      target_away_score, target_status, target_neutral_site, target_postseason
    ) returning * into saved_game;
  else
    update public.cfb_games game
    set season = target_season,
        week = target_week,
        game_date = target_game_date,
        home_team_id = target_home_team_id,
        away_team_id = target_away_team_id,
        home_score = target_home_score,
        away_score = target_away_score,
        status = target_status,
        neutral_site = target_neutral_site,
        postseason = target_postseason
    where game.id = target_game_id and game.league_id = target_league_id
    returning * into saved_game;

    if saved_game.id is null then raise exception 'Game not found or access denied' using errcode = '42501'; end if;
  end if;

  delete from public.team_ranking_snapshots where game_id = saved_game.id;
  if target_ranking_source is not null and target_home_rank is not null then
    insert into public.team_ranking_snapshots (league_id, game_id, team_id, season, week, ranking_source, rank)
    values (target_league_id, saved_game.id, target_home_team_id, target_season, target_week, trim(target_ranking_source), target_home_rank);
  end if;
  if target_ranking_source is not null and target_away_rank is not null then
    insert into public.team_ranking_snapshots (league_id, game_id, team_id, season, week, ranking_source, rank)
    values (target_league_id, saved_game.id, target_away_team_id, target_season, target_week, trim(target_ranking_source), target_away_rank);
  end if;

  return saved_game;
end;
$$;

create function public.process_cfb_game_scoring(target_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  game public.cfb_games;
  winner_id uuid;
  loser_id uuid;
  loser_rank integer;
  ranking_source text;
  winner_classification text;
  loser_classification text;
  winner_codes text[] := array['WIN'];
  loser_codes text[] := array['LOSS'];
  fingerprint text;
  inserted_count integer;
begin
  select game_row.* into game
  from public.cfb_games game_row
  join public.leagues league on league.id = game_row.league_id
  where game_row.id = target_game_id and league.commissioner_id = auth.uid()
  for update of game_row;

  if game.id is null then raise exception 'Game not found or access denied' using errcode = '42501'; end if;
  if game.status <> 'final' or game.home_score is null or game.away_score is null or game.home_score = game.away_score then
    raise exception 'Only a completed, non-tied game can be scored' using errcode = 'P0001';
  end if;

  if game.home_score > game.away_score then winner_id := game.home_team_id; loser_id := game.away_team_id;
  else winner_id := game.away_team_id; loser_id := game.home_team_id; end if;

  select snapshot.rank, snapshot.ranking_source into loser_rank, ranking_source
  from public.team_ranking_snapshots snapshot
  where snapshot.game_id = game.id and snapshot.team_id = loser_id
  order by snapshot.captured_at desc limit 1;

  select classification.classification into winner_classification
  from public.teams team
  left join public.conference_classifications classification
    on classification.season = game.season and classification.conference = team.conference
  where team.id = winner_id;

  select classification.classification into loser_classification
  from public.teams team
  left join public.conference_classifications classification
    on classification.season = game.season and classification.conference = team.conference
  where team.id = loser_id;

  if loser_rank is not null then winner_codes := array_append(winner_codes, 'WIN_OVER_RANKED'); end if;
  if loser_rank <= 15 then winner_codes := array_append(winner_codes, 'WIN_OVER_TOP_15'); end if;
  if loser_rank <= 5 then winner_codes := array_append(winner_codes, 'WIN_OVER_TOP_5'); end if;
  if winner_classification = 'G5' and loser_classification = 'POWER' then
    winner_codes := array_append(winner_codes, 'G5_WIN_OVER_P5');
    loser_codes := array_append(loser_codes, 'P5_LOSS_TO_G5');
  end if;

  fingerprint := md5(concat_ws('|', game.home_team_id, game.away_team_id, game.home_score,
    game.away_score, game.season, game.week, coalesce(loser_rank::text, ''),
    coalesce(ranking_source, ''), coalesce(winner_classification, ''), coalesce(loser_classification, '')));

  if game.scoring_fingerprint = fingerprint then
    select count(*) into inserted_count from public.scoring_events
    where league_id = game.league_id and source_type = 'game'
      and source_identifier = game.id::text and voided_at is null;
    return inserted_count;
  end if;

  update public.scoring_events
  set voided_at = now(), voided_by = auth.uid(), void_reason = 'Game scoring recalculated after result or context changed'
  where league_id = game.league_id and source_type = 'game'
    and source_identifier = game.id::text and voided_at is null;

  with awards(team_id, code) as (
    select winner_id, unnest(winner_codes)
    union all
    select loser_id, unnest(loser_codes)
  )
  insert into public.scoring_events (
    league_id, team_id, scoring_rule_id, season, week, points, event_date,
    source_type, source_identifier, origin, idempotency_key, notes, metadata, created_by
  )
  select game.league_id, awards.team_id, rule.id, game.season, game.week, rule.points,
    game.game_date, 'game', game.id::text, 'automatic',
    concat('game:', game.id, ':', awards.team_id, ':', rule.code, ':', fingerprint),
    null,
    jsonb_build_object('game_id', game.id, 'ranking_source', ranking_source,
      'opponent_rank', case when awards.team_id = winner_id then loser_rank else null end,
      'scoring_fingerprint', fingerprint),
    auth.uid()
  from awards
  join public.scoring_rules rule on rule.code = awards.code and rule.league_id is null and rule.active;

  get diagnostics inserted_count = row_count;
  update public.cfb_games set scoring_fingerprint = fingerprint, scored_at = now() where id = game.id;
  return inserted_count;
end;
$$;

create function public.add_manual_scoring_event(
  target_league_id uuid,
  target_team_id uuid,
  target_rule_id uuid,
  target_week integer,
  target_event_date date,
  target_notes text
)
returns public.scoring_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  league_season text;
  rule public.scoring_rules;
  created_event public.scoring_events;
  event_id uuid := gen_random_uuid();
begin
  select season into league_season from public.leagues
  where id = target_league_id and commissioner_id = auth.uid();
  if league_season is null then raise exception 'League not found or access denied' using errcode = '42501'; end if;
  if target_week is not null and target_week < 1 then raise exception 'Week must be positive' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.draft_picks pick
    join public.drafts draft on draft.id = pick.draft_id
    where draft.league_id = target_league_id and pick.team_id = target_team_id
  ) then raise exception 'Team was not drafted in this league' using errcode = '22023'; end if;

  select * into rule from public.scoring_rules
  where id = target_rule_id and active and (league_id is null or league_id = target_league_id);
  if rule.id is null then raise exception 'Scoring rule not found or inactive' using errcode = '22023'; end if;

  insert into public.scoring_events (
    id, league_id, team_id, scoring_rule_id, season, week, points, event_date,
    source_type, source_identifier, origin, idempotency_key, notes, created_by
  ) values (
    event_id, target_league_id, target_team_id, rule.id, league_season, target_week,
    rule.points, coalesce(target_event_date, current_date), 'manual', event_id::text,
    'manual', concat('manual:', event_id), nullif(trim(target_notes), ''), auth.uid()
  ) returning * into created_event;
  return created_event;
end;
$$;

create function public.void_manual_scoring_event(target_event_id uuid, target_reason text)
returns public.scoring_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  voided_event public.scoring_events;
begin
  if char_length(trim(coalesce(target_reason, ''))) < 2 then
    raise exception 'A void reason is required' using errcode = '22023';
  end if;

  update public.scoring_events event
  set voided_at = now(), voided_by = auth.uid(), void_reason = trim(target_reason)
  from public.leagues league
  where event.id = target_event_id
    and event.league_id = league.id
    and league.commissioner_id = auth.uid()
    and event.source_type = 'manual'
    and event.voided_at is null
  returning event.* into voided_event;

  if voided_event.id is null then raise exception 'Manual event not found or access denied' using errcode = '42501'; end if;
  return voided_event;
end;
$$;

revoke all on function public.save_cfb_game(uuid, uuid, text, integer, date, uuid, uuid, integer, integer, text, boolean, boolean, text, integer, integer) from public;
revoke all on function public.process_cfb_game_scoring(uuid) from public;
revoke all on function public.add_manual_scoring_event(uuid, uuid, uuid, integer, date, text) from public;
revoke all on function public.void_manual_scoring_event(uuid, text) from public;
grant execute on function public.save_cfb_game(uuid, uuid, text, integer, date, uuid, uuid, integer, integer, text, boolean, boolean, text, integer, integer) to authenticated;
grant execute on function public.process_cfb_game_scoring(uuid) to authenticated;
grant execute on function public.add_manual_scoring_event(uuid, uuid, uuid, integer, date, text) to authenticated;
grant execute on function public.void_manual_scoring_event(uuid, text) to authenticated;

alter publication supabase_realtime add table public.scoring_events;
