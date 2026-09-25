-- Target the only missing foreign-key indexes supported by current production
-- query patterns and plans: team-oriented schedule lookups currently scan all
-- league game rows. The tables are small enough for transactional index builds.
create index if not exists cfb_games_home_team_id_idx
on public.cfb_games (home_team_id);

create index if not exists cfb_games_away_team_id_idx
on public.cfb_games (away_team_id);

-- Cache stable request identity once per statement instead of reevaluating the
-- auth helper for every candidate row. These expressions are boolean-equivalent
-- to the existing policies and intentionally preserve all policy boundaries.
alter policy "Users can read their own profile"
on public.profiles
using (id = (select auth.uid()));

alter policy "Users can update their own profile"
on public.profiles
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

alter policy "Members can read their leagues"
on public.leagues
using (
  commissioner_id = (select auth.uid())
  or private.is_league_member(id)
);

alter policy "Commissioners can update their own leagues"
on public.leagues
using (commissioner_id = (select auth.uid()))
with check (commissioner_id = (select auth.uid()));

alter policy "Commissioners can delete their own leagues"
on public.leagues
using (commissioner_id = (select auth.uid()));

alter policy "Users can read relevant league memberships"
on public.league_members
using (
  user_id = (select auth.uid())
  or private.is_league_commissioner(league_id)
);

alter policy "Commissioners can add league memberships"
on public.league_members
with check (
  private.is_league_commissioner(league_id)
  and role = 'owner'::public.league_member_role
  and user_id <> (select auth.uid())
);

alter policy "Commissioners can update league memberships"
on public.league_members
using (
  private.is_league_commissioner(league_id)
  and role = 'owner'::public.league_member_role
)
with check (
  private.is_league_commissioner(league_id)
  and role = 'owner'::public.league_member_role
  and user_id <> (select auth.uid())
);

alter policy "Invitees can read invitations sent to their email"
on public.league_invitations
using (
  invited_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

alter policy "Users can read only their own draft queue"
on public.draft_queue_items
using (
  exists (
    select 1
    from public.league_members
    where league_members.id = draft_queue_items.league_member_id
      and league_members.user_id = (select auth.uid())
  )
);

alter policy "Commissioners can read scoped live poll diagnostics"
on public.live_scoreboard_poll_runs
using (
  exists (
    select 1
    from public.leagues league
    where league.id = any(live_scoreboard_poll_runs.league_ids)
      and league.commissioner_id = (select auth.uid())
  )
);
