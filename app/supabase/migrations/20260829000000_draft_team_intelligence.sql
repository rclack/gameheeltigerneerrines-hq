-- Read-only, deduplicated prior-season records for league draft participants.

create function public.get_draft_team_prior_records(target_league_id uuid)
returns table (
  team_id uuid,
  season text,
  wins integer,
  losses integer,
  ties integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorized_league as (
    select league.season
    from public.leagues league
    where league.id = target_league_id
      and private.is_league_member(league.id)
  ),
  prior_season as (
    select (season::integer - 1)::text as season
    from authorized_league
  ),
  unique_games as (
    select distinct on (game.external_provider, game.external_id)
      game.external_provider,
      game.external_id,
      game.home_team_id,
      game.away_team_id,
      game.home_score,
      game.away_score
    from public.cfb_games game
    join prior_season on prior_season.season = game.season
    where game.status = 'final'
      and game.external_provider is not null
      and game.external_id is not null
      and game.home_score is not null
      and game.away_score is not null
    order by game.external_provider, game.external_id, game.provider_synced_at desc nulls last, game.updated_at desc
  ),
  team_results as (
    select game.home_team_id as team_id,
      (game.home_score > game.away_score)::integer as wins,
      (game.home_score < game.away_score)::integer as losses,
      (game.home_score = game.away_score)::integer as ties
    from unique_games game
    where game.home_team_id is not null
    union all
    select game.away_team_id,
      (game.away_score > game.home_score)::integer,
      (game.away_score < game.home_score)::integer,
      (game.away_score = game.home_score)::integer
    from unique_games game
    where game.away_team_id is not null
  )
  select result.team_id, prior_season.season,
    sum(result.wins)::integer,
    sum(result.losses)::integer,
    sum(result.ties)::integer
  from team_results result
  cross join prior_season
  group by result.team_id, prior_season.season;
$$;

revoke all on function public.get_draft_team_prior_records(uuid) from public, anon;
grant execute on function public.get_draft_team_prior_records(uuid) to authenticated;
