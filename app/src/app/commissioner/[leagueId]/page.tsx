import { notFound, redirect } from "next/navigation";

import CommissionerDashboard from "@/components/commissioner/CommissionerDashboard";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { getLeagueRoster } from "@/services/membershipService";
import { getDraftParticipants, getDraftPickCount, getDraftRosterRules, getLeagueDraft } from "@/services/draftService";

export default async function CommissionerLeaguePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/commissioner/${leagueId}`)}`);
  const { data: league } = await supabase.from("leagues").select("*").eq("id", leagueId).eq("commissioner_id", user.id).maybeSingle();
  if (!league) notFound();
  const roster = await getLeagueRoster(supabase, league.id);
  const [draft, rosterRules] = await Promise.all([getLeagueDraft(supabase, league.id), getDraftRosterRules(supabase, league.id)]);
  const participants = draft ? await getDraftParticipants(supabase, draft.id, roster.members) : [];
  const pickCount = draft ? await getDraftPickCount(supabase, draft.id) : 0;
  return <CommissionerDashboard league={league} roster={roster} draft={draft} participants={participants} pickCount={pickCount} rosterRules={rosterRules} siteOrigin={getSiteOrigin()} />;
}
