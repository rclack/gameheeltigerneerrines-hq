import { redirect } from "next/navigation";

import LeagueSetupWizard from "@/components/commissioner/LeagueSetupWizard";
import { createClient } from "@/lib/supabase/server";

export default async function RequestLeaguePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/leagues/request");
  const { data: pending } = await supabase.from("league_creation_requests").select("id").eq("requester_id", user.id).eq("status", "pending").gt("expires_at", new Date().toISOString()).maybeSingle();
  if (pending) redirect("/leagues");
  return <LeagueSetupWizard />;
}
