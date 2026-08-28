-- Keep Phase 3A live provider reads authenticated-only. Supabase default
-- privileges may otherwise grant anon SELECT on newly created public tables.
revoke all on public.live_scoreboard_games from anon;
revoke all on public.live_scoreboard_snapshots from anon;
revoke all on public.live_scoreboard_poll_runs from anon;
revoke all on sequence public.live_scoreboard_snapshots_id_seq from anon, authenticated;
