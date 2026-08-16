-- Authenticated application mutations already enforce user and league authority
-- internally. Remove PostgreSQL's default anonymous function access as an
-- additional boundary without changing their existing authenticated behavior.

revoke all on function public.accept_league_invitation(text) from public, anon;
revoke all on function public.add_manual_scoring_event(uuid, uuid, uuid, integer, date, text) from public, anon;
revoke all on function public.apply_external_game_sync(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.begin_external_sync(uuid, text, text) from public, anon;
revoke all on function public.create_league_invitation(uuid, text) from public, anon;
revoke all on function public.process_cfb_game_scoring(uuid) from public, anon;
revoke all on function public.randomize_draft_order(uuid) from public, anon;
revoke all on function public.reset_draft(uuid) from public, anon;
revoke all on function public.revoke_league_invitation(uuid) from public, anon;
revoke all on function public.set_draft_paused(uuid, boolean) from public, anon;
revoke all on function public.start_draft(uuid) from public, anon;
revoke all on function public.update_my_team_name(uuid, text) from public, anon;
revoke all on function public.void_manual_scoring_event(uuid, text) from public, anon;

grant execute on function public.accept_league_invitation(text) to authenticated;
grant execute on function public.add_manual_scoring_event(uuid, uuid, uuid, integer, date, text) to authenticated;
grant execute on function public.apply_external_game_sync(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.begin_external_sync(uuid, text, text) to authenticated;
grant execute on function public.create_league_invitation(uuid, text) to authenticated;
grant execute on function public.process_cfb_game_scoring(uuid) to authenticated;
grant execute on function public.randomize_draft_order(uuid) to authenticated;
grant execute on function public.reset_draft(uuid) to authenticated;
grant execute on function public.revoke_league_invitation(uuid) to authenticated;
grant execute on function public.set_draft_paused(uuid, boolean) to authenticated;
grant execute on function public.start_draft(uuid) to authenticated;
grant execute on function public.update_my_team_name(uuid, text) to authenticated;
grant execute on function public.void_manual_scoring_event(uuid, text) to authenticated;

-- Trigger functions are invoked by their triggers, not through the Data API.
revoke all on function public.add_league_commissioner_membership() from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
