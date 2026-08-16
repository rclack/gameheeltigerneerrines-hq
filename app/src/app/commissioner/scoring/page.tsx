import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function CommissionerScoringCompatibilityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/commissioner/scoring");
  const { data: leagues, error } = await supabase.from("leagues").select("id").eq("commissioner_id", user.id).order("created_at");
  if (error) throw error;
  if (leagues.length === 1) redirect(`/commissioner/${leagues[0].id}/scoring`);
  redirect("/leagues");
}
