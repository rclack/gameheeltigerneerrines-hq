revoke insert, update, delete on table
  public.draft_picks,
  public.scoring_events,
  public.weekly_lineups,
  public.weekly_lineup_entries,
  public.weekly_lineup_changes
from authenticated;

grant select on table
  public.draft_picks,
  public.scoring_events,
  public.weekly_lineups,
  public.weekly_lineup_entries,
  public.weekly_lineup_changes
to authenticated;

revoke execute on function public.submit_draft_pick(uuid, uuid) from anon;
