-- Cover Phase 3B.2C foreign keys used for event attribution and cleanup.
drop index if exists public.league_chaos_events_game_idx;
create index league_chaos_events_game_idx on public.league_chaos_events(game_id);
create index league_chaos_events_team_idx on public.league_chaos_events(team_id);
create index league_chaos_events_member_idx on public.league_chaos_events(league_member_id);
create index league_chaos_events_opponent_team_idx on public.league_chaos_events(opponent_team_id);
create index league_chaos_events_opponent_member_idx on public.league_chaos_events(opponent_league_member_id);
create index league_chaos_transitions_game_idx on public.league_chaos_transitions(game_id);
create index league_chaos_transitions_team_idx on public.league_chaos_transitions(team_id);
create index league_chaos_transitions_member_idx on public.league_chaos_transitions(league_member_id);
