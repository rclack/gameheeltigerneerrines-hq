import CommissionerDashboard from "@/components/commissioner/CommissionerDashboard";
import LeagueSetupWizard from "@/components/commissioner/LeagueSetupWizard";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { getOwnedLeague } from "@/services/leagueService";
import { getLeagueRoster } from "@/services/membershipService";
import { getDraftParticipants, getDraftPickCount, getLeagueDraft } from "@/services/draftService";
import { redirect } from "next/navigation";

export default async function CommissionerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/commissioner");

  const league = await getOwnedLeague(supabase, user.id);

  if (!league) return <LeagueSetupWizard userId={user.id} />;

  const roster = await getLeagueRoster(supabase, league.id);
  const draft = await getLeagueDraft(supabase, league.id);
  const participants = draft ? await getDraftParticipants(supabase, draft.id, roster.members) : [];
  const pickCount = draft ? await getDraftPickCount(supabase, draft.id) : 0;

  return <CommissionerDashboard league={league} roster={roster} draft={draft} participants={participants} pickCount={pickCount} siteOrigin={getSiteOrigin()} />;
}
