import { notFound, redirect } from "next/navigation";

import DraftRoom from "@/components/draft/DraftRoom";
import { createClient } from "@/lib/supabase/server";
import { getDraftParticipants, getDraftPicks, getMyDraftQueue } from "@/services/draftService";
import { getLeagueRoster } from "@/services/membershipService";
import { getActiveTeams } from "@/services/teamService";

export default async function DraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/draft/${draftId}`)}`);

  const { data: draft } = await supabase.from("drafts").select("*").eq("id", draftId).maybeSingle();
  if (!draft) notFound();
  const { data: league } = await supabase.from("leagues").select("*").eq("id", draft.league_id).maybeSingle();
  if (!league) notFound();

  const roster = await getLeagueRoster(supabase, league.id);
  if (!roster.members.some((member) => member.user_id === user.id)) notFound();
  const [participants, teams] = await Promise.all([
    getDraftParticipants(supabase, draft.id, roster.members),
    getActiveTeams(supabase),
  ]);
  const picks = await getDraftPicks(supabase, draft.id, participants, teams);
  const queue = await getMyDraftQueue(supabase, draft.id, teams);

  return <DraftRoom data={{ draft, league, participants, picks, teams, currentUserId: user.id, queue }} />;
}
